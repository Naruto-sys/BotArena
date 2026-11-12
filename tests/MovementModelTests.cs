using Xunit;

namespace BotArena.Tests;

public class MovementModelTests
{
    private static readonly BotAction Idle = new(0, 0, default, false);

    [Fact]
    public void JavaScriptHoverStrategyCoastsSidewaysAndBrakes()
    {
        using var strategy = new JavaScriptBot("""
            function tick({self, tick}) {
                if (self.movement !== "hover") throw new Error("Expected hover");
                if (tick < 10) return { thrust: { x: 0, y: 1 } };
                if (tick < 20) return { turn: 1 };
                return { thrust: { x: 0, y: -1 } };
            }
            """);
        var duel = Arena(new HoverMovement(acceleration: 4, drag: 0));
        for (var tick = 0; tick < 10; tick++) RunTick();
        var first = duel.Observe("player").Self;
        Assert.InRange(first.Position.Y, 2.54, 2.56);

        for (var tick = 10; tick < 20; tick++) RunTick();
        var second = duel.Observe("player").Self;
        Assert.True(second.BodyAngle > first.BodyAngle);
        Assert.Equal(first.Velocity, second.Velocity);
        Assert.Equal(2, second.Position.X);
        Assert.InRange(second.Position.Y, 3.54, 3.56);

        for (var tick = 20; tick < 30; tick++) RunTick();
        var stopped = duel.Observe("player").Self;
        Assert.Equal(0, stopped.Speed, 8);
        Assert.InRange(stopped.Position.Y, 3.99, 4.01);

        void RunTick() => Step(duel, strategy.Decide(duel.Observe("player")));
    }

    [Fact]
    public void SharedCollisionHandlingClearsHoverMomentumAtWall()
    {
        var duel = Arena(new HoverMovement(drag: 0), [new(3, 1, 1, 2)]);
        for (var tick = 0; tick < 30; tick++) Step(duel, Idle with { Thrust = new(1, 0) });
        var stopped = duel.Observe("player").Self;
        Assert.InRange(stopped.Position.X, 2.5, 2.66);
        Assert.Equal(default, stopped.Velocity);
        Step(duel, Idle);
        Assert.Equal(stopped.Position, duel.Observe("player").Self.Position);

        Step(duel, Idle with { Thrust = new(-1, 0) });
        Assert.True(duel.Observe("player").Self.Position.X < stopped.Position.X);
    }

    [Fact]
    public void ANewMovementModelCanBeInstalledForOnlyOneRobot()
    {
        var duel = Arena(new TestMovement());
        Step(duel, Idle with { LeftTrack = 1, RightTrack = 1 });
        Assert.Equal(new Vec2(2.05, 2), duel.Observe("player").Self.Position);
        Assert.Equal("test", duel.Observe("player").Self.Movement);
        Assert.Equal("tracked", duel.Observe("opponent").Self.Movement);
        Assert.Equal(new Vec2(14, 5), duel.Observe("opponent").Self.Position);
    }

    [Fact]
    public void OversizedThrustIsLimitedWithoutChangingDirection()
    {
        var movement = new HoverMovement(acceleration: 1, drag: 0);
        var motion = movement.Propose(default, Idle with { Thrust = new(2, 1) }, default, 1, canRotate: true);
        Assert.Equal(1, motion.Speed, 8);
        Assert.Equal(2 * motion.Velocity.Y, motion.Velocity.X, 8);
    }

    [PythonRuntimeFact]
    public void PythonStrategyCommandsDriveHoverModel()
    {
        using var strategy = new PythonBot("""
            def tick(state):
                assert state["self"]["movement"] == "hover"
                return {"thrust": {"x": 0, "y": 1}, "turn": 2}
            """, Environment.GetEnvironmentVariable("BOTARENA_PYTHON_RUNTIME"));
        var duel = Arena(new HoverMovement());
        Step(duel, strategy.Decide(duel.Observe("player")));

        var state = duel.Observe("player").Self;
        Assert.Equal(0, state.Velocity.X);
        Assert.True(state.Velocity.Y > 0);
        Assert.InRange(state.BodyAngle, 0.03, 0.04);
    }

    private static void Step(Duel duel, BotAction action) =>
        duel.Step(new Dictionary<string, BotAction> { ["player"] = action, ["opponent"] = Idle });

    private static Duel Arena(IMovementModel model, IReadOnlyList<Wall>? walls = null) =>
        new(MatchConfig.Classic with
        {
            Arena = new(16, 10, walls ?? []),
            Spawns = [new("player", new(2, 2), 0, 0) { Movement = model }, new("opponent", new(14, 5), 0, 0)],
        });

    private sealed class TestMovement : IMovementModel
    {
        public string Id => "test";
        public BotMotion Propose(BotMotion current, BotAction action, Vec2 position, double seconds, bool canRotate) =>
            current with { Velocity = new(position.X / 2, 0), Speed = position.X / 2 };
    }
}

public sealed class PythonRuntimeFactAttribute : FactAttribute
{
    public PythonRuntimeFactAttribute()
    {
        if (!PythonBot.IsAvailable(Environment.GetEnvironmentVariable("BOTARENA_PYTHON_RUNTIME")))
            Skip = "Set BOTARENA_PYTHON_RUNTIME to run the WASI integration test.";
    }
}
