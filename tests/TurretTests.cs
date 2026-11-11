using Xunit;

namespace BotArena.Tests;

public class TurretTests
{
    private static readonly BotAction Idle = new(0, 0, default, false);
    private static MatchConfig Config => MatchConfig.Classic with
    {
        Arena = MatchConfig.Classic.Arena with { Walls = [] }
    };

    [Theory]
    [InlineData(1)]
    [InlineData(-1)]
    [InlineData(0.5)]
    public void RotationIsSmoothBoundedAndCrossesAngleBoundary(double turn)
    {
        var duel = new Duel(Config);
        var action = Idle with { TurretTurn = turn };
        var total = 0.0;
        var previousStep = 0.0;
        for (var tick = 0; tick < 60; tick++)
        {
            var before = duel.Observe("player").Self;
            Step(duel, action);
            var after = duel.Observe("player").Self;
            var delta = Difference(after.TurretAngle, before.TurretAngle);
            Assert.True(delta * turn > 0);
            Assert.InRange(Math.Abs(delta), Math.Abs(previousStep),
                Math.Abs(turn) * Config.MaxTurretTurnSpeed / Config.TickRate + 1e-12);
            Assert.Equal(before.Position, after.Position);
            Assert.Equal(before.BodyAngle, after.BodyAngle);
            Assert.InRange(after.TurretAngle, -Math.PI, Math.PI);
            total += delta;
            previousStep = delta;
        }
        Assert.True(Math.Abs(total) > Math.PI * 2);
        Assert.Equal(turn * Config.MaxTurretTurnSpeed / Config.TickRate, previousStep, 6);
    }

    [Fact]
    public void ZeroTurnBrakesAndOmissionHoldsTheCurrentWorldAngle()
    {
        var duel = new Duel(Config);
        for (var tick = 0; tick < 10; tick++) Step(duel, Idle with { TurretTurn = 1 });
        var before = duel.Observe("player").Self.TurretAngle;
        Step(duel, Idle with { TurretTurn = 0 });
        var after = duel.Observe("player").Self.TurretAngle;
        var firstBrakeStep = Difference(after, before);
        Assert.InRange(firstBrakeStep, 0.001, Config.MaxTurretTurnSpeed / Config.TickRate);
        for (var tick = 0; tick < 40; tick++) Step(duel, Idle with { TurretTurn = 0 });
        before = duel.Observe("player").Self.TurretAngle;
        Step(duel, Idle with { TurretTurn = 0 });
        after = duel.Observe("player").Self.TurretAngle;
        Assert.InRange(Math.Abs(Difference(after, before)), 0, firstBrakeStep / 1000);

        Step(duel, Idle with { LeftTrack = 1, RightTrack = -1 });
        Assert.Equal(after, duel.Observe("player").Self.TurretAngle);
        Assert.NotEqual(0, duel.Observe("player").Self.BodyAngle);
    }

    [Fact]
    public void DirectionAimingCanTakeOverFromRotation()
    {
        var duel = new Duel(Config);
        for (var tick = 0; tick < 10; tick++) Step(duel, Idle with { TurretTurn = 1 });
        for (var tick = 0; tick < 80; tick++) Step(duel, Idle with { AimDirection = new(1, 0) });
        Assert.Equal(0, duel.Observe("player").Self.TurretAngle, 8);
    }

    [Fact]
    public void RotationCanReverseWithoutAnInstantDirectionChange()
    {
        var duel = new Duel(Config);
        for (var tick = 0; tick < 10; tick++) Step(duel, Idle with { TurretTurn = 1 });
        var before = duel.Observe("player").Self.TurretAngle;
        Step(duel, Idle with { TurretTurn = -1 });
        var after = duel.Observe("player").Self.TurretAngle;
        Assert.True(Difference(after, before) > 0);
        for (var tick = 0; tick < 20; tick++) Step(duel, Idle with { TurretTurn = -1 });
        before = duel.Observe("player").Self.TurretAngle;
        Step(duel, Idle with { TurretTurn = -1 });
        Assert.True(Difference(duel.Observe("player").Self.TurretAngle, before) < 0);
    }

    [Fact]
    public void ShotUsesTheRotatedTurretAngle()
    {
        var duel = new Duel(Config);
        Step(duel, Idle with { TurretTurn = -1, Shoot = true });
        var frame = duel.CaptureFrame();
        var bullet = Assert.Single(frame.Bullets);
        Assert.Equal(Vec2.FromAngle(frame.Bots[0].TurretAngle), bullet.Direction);
        Assert.True(bullet.Direction.Y < 0);
    }

    [Theory]
    [InlineData("{}", null)]
    [InlineData("{turretTurn: 0}", 0.0)]
    [InlineData("{turretTurn: 0.5}", 0.5)]
    [InlineData("{turretTurn: 10}", 1.0)]
    [InlineData("{turretTurn: -10}", -1.0)]
    public void JavaScriptNormalizesRotation(string result, double? expected)
    {
        using var bot = new JavaScriptBot("function tick() { return " + result + "; }");
        var action = bot.Decide(new Duel(Config).Observe("player"));
        Assert.Equal(expected, action.TurretTurn);
    }

    [Theory]
    [InlineData("{turretTurn: null}")]
    [InlineData("{turretTurn: true}")]
    [InlineData("{turretTurn: '1'}")]
    [InlineData("{turretTurn: NaN}")]
    [InlineData("{turretTurn: Infinity}")]
    [InlineData("{turretTurn: 0, aimDirection: {x: 0, y: 0}}")]
    [InlineData("{get turretTurn() { while (true) {} }}")]
    public void JavaScriptRejectsInvalidOrConflictingRotation(string result)
    {
        using var bot = new JavaScriptBot("function tick() { return " + result + "; }");
        var error = Assert.Throws<StrategyException>(() => bot.Decide(new Duel(Config).Observe("player")));
        Assert.Equal(0, error.Tick);
    }

    private static double Difference(double a, double b) => Math.Atan2(Math.Sin(a - b), Math.Cos(a - b));

    private static void Step(Duel duel, BotAction action) =>
        duel.Step(new Dictionary<string, BotAction> { ["player"] = action, ["opponent"] = Idle });
}
