namespace BotArena;

public readonly record struct BotMotion(double Heading, double TurnRate, Vec2 Velocity, double Speed);

/// <summary>Proposes motion for one tick. The arena can retry the proposal with rotation blocked, so implementations must be pure.</summary>
public interface IMovementModel
{
    string Id { get; }
    BotMotion Propose(BotMotion current, BotAction action, Vec2 position, double seconds, bool canRotate);
}

public interface IEnvironmentMovementModel : IMovementModel
{
    BotMotion ProposeOnSurface(BotMotion current, BotAction action, Vec2 position, double seconds,
        bool canRotate, SurfaceModifiers modifiers);
}

internal static class MotionMath
{
    public static double Input(double value) => double.IsFinite(value) ? Math.Clamp(value, -1, 1) : 0;
    public static double Angle(double angle) => Math.Atan2(Math.Sin(angle), Math.Cos(angle));
    public static double ApproachRate(double current, double target, double seconds, double responseSeconds) =>
        current + (target - current) * (1 - Math.Exp(-seconds / responseSeconds));
    public static Vec2 Thrust(Vec2 value) =>
        double.IsFinite(value.X) && double.IsFinite(value.Y) ? ClampLength(value, 1) : default;

    public static Vec2 ClampLength(Vec2 vector, double limit)
    {
        if (double.Hypot(vector.X, vector.Y) <= limit) return vector;
        var scale = Math.Max(Math.Abs(vector.X), Math.Abs(vector.Y));
        var direction = new Vec2(vector.X / scale, vector.Y / scale);
        return direction * (limit / double.Hypot(direction.X, direction.Y));
    }

}

internal sealed class TrackedMovement(MatchConfig config) : IEnvironmentMovementModel
{
    public string Id => "tracked";

    public BotMotion Propose(BotMotion current, BotAction action, Vec2 position, double seconds, bool canRotate) =>
        ProposeOnSurface(current, action, position, seconds, canRotate, new());

    public BotMotion ProposeOnSurface(BotMotion current, BotAction action, Vec2 position, double seconds,
        bool canRotate, SurfaceModifiers modifiers)
    {
        var left = MotionMath.Input(action.LeftTrack);
        var right = MotionMath.Input(action.RightTrack);
        var throttle = (left + right) / 2;
        var targetSpeed = throttle * (throttle < 0 ? config.MaxReverseSpeed : config.MaxForwardSpeed) * modifiers.SpeedMultiplier;
        var braking = Math.Abs(targetSpeed) < Math.Abs(current.Speed) || targetSpeed * current.Speed < 0;
        var limit = (braking ? config.Deceleration * modifiers.DecelerationMultiplier : config.Acceleration * modifiers.AccelerationMultiplier) * seconds;
        var speed = current.Speed + Math.Clamp(targetSpeed - current.Speed, -limit, limit);
        var targetRate = (left - right) * 0.5 * config.MaxTurnSpeed * modifiers.TurnMultiplier;
        var turnRate = canRotate
            ? MotionMath.ApproachRate(current.TurnRate, targetRate, seconds, config.TurnResponseSeconds)
            : 0;
        var heading = canRotate ? MotionMath.Angle(current.Heading + turnRate * seconds) : current.Heading;
        return new(heading, turnRate, Vec2.FromAngle(heading) * speed, speed);
    }
}

public sealed class HoverMovement : IEnvironmentMovementModel
{
    private readonly double acceleration;
    private readonly double drag;
    private readonly double maxSpeed;
    private readonly double maxTurnRate;

    public HoverMovement(double acceleration = 7, double drag = 0.5, double maxSpeed = 5, double maxTurnRate = 3)
    {
        this.acceleration = NonNegative(acceleration, nameof(acceleration));
        this.drag = NonNegative(drag, nameof(drag));
        this.maxSpeed = NonNegative(maxSpeed, nameof(maxSpeed));
        this.maxTurnRate = NonNegative(maxTurnRate, nameof(maxTurnRate));
    }

    public string Id => "hover";

    public BotMotion Propose(BotMotion current, BotAction action, Vec2 position, double seconds, bool canRotate) =>
        ProposeOnSurface(current, action, position, seconds, canRotate, new());

    public BotMotion ProposeOnSurface(BotMotion current, BotAction action, Vec2 position, double seconds,
        bool canRotate, SurfaceModifiers modifiers)
    {
        // Thrust uses world coordinates. Turning the hull does not rotate momentum.
        var thrust = MotionMath.Thrust(action.Thrust);
        var damped = current.Velocity * Math.Exp(-drag * modifiers.DecelerationMultiplier * seconds);
        var limit = Math.Max(maxSpeed * modifiers.SpeedMultiplier, double.Hypot(damped.X, damped.Y));
        var velocity = MotionMath.ClampLength(damped + thrust * (acceleration * modifiers.AccelerationMultiplier * seconds), limit);
        var targetRate = MotionMath.Input(action.Turn) * maxTurnRate * modifiers.TurnMultiplier;
        var turnRate = canRotate ? MotionMath.ApproachRate(current.TurnRate, targetRate, seconds, 0.2) : 0;
        var heading = canRotate ? MotionMath.Angle(current.Heading + turnRate * seconds) : current.Heading;
        return new(heading, turnRate, velocity, double.Hypot(velocity.X, velocity.Y));
    }

    private static double NonNegative(double value, string name) =>
        double.IsFinite(value) && value >= 0 ? value : throw new ArgumentOutOfRangeException(name);
}

/// <summary>A wheeled chassis with a fixed wheelbase and steering proportional to speed.</summary>
public sealed class WheeledMovement : IEnvironmentMovementModel
{
    public string Id => "wheeled";

    public BotMotion Propose(BotMotion current, BotAction action, Vec2 position, double seconds, bool canRotate) =>
        ProposeOnSurface(current, action, position, seconds, canRotate, new());

    public BotMotion ProposeOnSurface(BotMotion current, BotAction action, Vec2 position, double seconds,
        bool canRotate, SurfaceModifiers modifiers)
    {
        var throttle = MotionMath.Input(action.Throttle);
        var targetSpeed = throttle * (throttle < 0 ? 2 : 5) * modifiers.SpeedMultiplier;
        var braking = Math.Abs(targetSpeed) < Math.Abs(current.Speed) || targetSpeed * current.Speed < 0;
        var delta = 8 * seconds * (braking ? modifiers.DecelerationMultiplier : modifiers.AccelerationMultiplier);
        var speed = current.Speed + Math.Clamp(targetSpeed - current.Speed, -delta, delta);
        var steering = MotionMath.Input(action.Turn) * 0.55;
        var turnRate = canRotate ? speed * Math.Tan(steering) / 0.8 * modifiers.TurnMultiplier : 0;
        var heading = MotionMath.Angle(current.Heading + turnRate * seconds);
        return new(heading, turnRate, Vec2.FromAngle(heading) * speed, speed);
    }
}

/// <summary>An omnidirectional chassis that actively tracks its requested velocity.</summary>
public sealed class OmniMovement : IEnvironmentMovementModel
{
    public string Id => "omni";

    public BotMotion Propose(BotMotion current, BotAction action, Vec2 position, double seconds, bool canRotate) =>
        ProposeOnSurface(current, action, position, seconds, canRotate, new());

    public BotMotion ProposeOnSurface(BotMotion current, BotAction action, Vec2 position, double seconds,
        bool canRotate, SurfaceModifiers modifiers)
    {
        var target = MotionMath.Thrust(action.Thrust) * (4 * modifiers.SpeedMultiplier);
        var difference = target - current.Velocity;
        var response = difference.Dot(current.Velocity) < 0 ? modifiers.DecelerationMultiplier : modifiers.AccelerationMultiplier;
        var velocity = current.Velocity + MotionMath.ClampLength(difference, 10 * seconds * response);
        var turnRate = canRotate ? MotionMath.ApproachRate(current.TurnRate, MotionMath.Input(action.Turn) * 3 * modifiers.TurnMultiplier, seconds, 0.2) : 0;
        var heading = MotionMath.Angle(current.Heading + turnRate * seconds);
        return new(heading, turnRate, velocity, double.Hypot(velocity.X, velocity.Y));
    }
}
