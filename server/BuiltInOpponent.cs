namespace BotArena;

internal sealed class BuiltInOpponent(string strategy, ArenaNavigator navigator) : IBotRuntime
{
    private const double AttackDistance = 2.7;

    public BotAction Decide(BotObservation state)
    {
        var self = state.Self;
        var enemy = state.Enemy;
        var target = strategy == "aggressive" ? AttackTarget(state) : PatrolTarget(state);
        var waypoint = navigator.Waypoint(self, target);
        var offset = waypoint - self.Position;
        var distance = Length(offset);
        var error = distance < 0.10 ? 0 : Wrap(Math.Atan2(offset.Y, offset.X) - self.BodyAngle);
        var aim = enemy is null ? offset : enemy.Position - self.Position;
        var aligned = Math.Abs(Wrap(Math.Atan2(aim.Y, aim.X) - self.TurretAngle)) < 0.055;
        var weapon = new BotAction(0, 0, aim, enemy is not null && aligned && self.CanShoot);
        var turn = Math.Clamp(error * 2, -1, 1);

        if (self.Movement is "hover" or "omni")
        {
            // Lower speed near waypoints so lateral momentum does not cut a corner.
            var thrust = self.Movement == "hover"
                ? offset * 1.35 - self.Velocity * 0.75
                : offset * 0.75;
            return weapon with { Turn = turn, Thrust = thrust };
        }
        if (self.Movement == "wheeled")
        {
            if (distance < 0.12) return weapon;
            var reverse = Math.Abs(error) > Math.PI / 2;
            var steeringError = reverse ? Wrap(error + Math.PI) : error;
            var steering = Math.Clamp(steeringError * 2.1, -1, 1);
            var throttle = Math.Min(reverse ? 0.7 : 0.62, distance * 0.8);
            return weapon with { Throttle = reverse ? -throttle : throttle, Turn = reverse ? -steering : steering };
        }

        var forward = Math.Abs(error) < 0.7 ? Math.Min(0.85, distance * 1.6) : 0;
        return weapon with { LeftTrack = forward + turn, RightTrack = forward - turn };
    }

    private static Vec2 AttackTarget(BotObservation state)
    {
        var self = state.Self;
        if (state.Enemy is not { } enemy)
            return state.Tick / 100 % 2 == 0 ? new(3.3, 3.65) : new(12.5, 3.65);
        var offset = enemy.Position - self.Position;
        var distance = Length(offset);
        return distance > AttackDistance
            ? self.Position + offset * ((distance - AttackDistance + 0.25) / distance)
            : self.Position;
    }

    private static Vec2 PatrolTarget(BotObservation state) =>
        new(10.05, state.Tick / 95 % 2 == 0 ? 3.55 : 6.18);

    private static double Length(Vec2 value) => double.Hypot(value.X, value.Y);
    private static double Wrap(double angle) => Math.Atan2(Math.Sin(angle), Math.Cos(angle));
    public IReadOnlyList<StrategyLogLine> ConsumeLogs() => [];
    public void Dispose() { }
}
