using Xunit;

namespace BotArena.Tests;

public class TurretApiTests
{
    private static readonly BotAction Idle = new(0, 0, default, false);
    private static MatchConfig Config => MatchConfig.Classic with
    {
        Arena = MatchConfig.Classic.Arena with { Walls = [] }
    };

    [Theory]
    [InlineData("bot.scan()", 0.5)]
    [InlineData("bot.scan({speed: 1})", 1.0)]
    [InlineData("bot.scan({speed: 0.25, direction: 'counterclockwise'})", -0.25)]
    [InlineData("{kind: 'scan'}", 0.5)]
    public void ScanUsesTheExistingRotationMechanism(string command, double expected)
    {
        using var bot = Strategy(command);
        var duel = new Duel(Config);
        for (var tick = 0; tick < 60; tick++)
        {
            var action = bot.Decide(duel.Observe("player"));
            Assert.Equal(expected, action.TurretTurn);
            var direct = Idle with { TurretTurn = expected };
            Assert.Equal(direct, action);
            Step(duel, action);
        }
    }

    [Fact]
    public void AimAtConvertsWorldCoordinatesUsingEachNewObservation()
    {
        using var bot = Strategy("bot.aimAt({x: 10, y: 2})");
        var duel = new Duel(Config);
        Step(duel, Idle with { LeftTrack = 1, RightTrack = 1 });
        var observation = duel.Observe("player");
        var action = bot.Decide(observation);
        Assert.Equal(new Vec2(10, 2) - observation.Self.Position, action.AimDirection);
        Assert.Null(action.TurretTurn);
    }

    [Fact]
    public void HoldAndCoincidentTargetStopScanAndKeepTheWorldAngle()
    {
        using var scan = Strategy("bot.scan()");
        using var hold = Strategy("bot.holdAim()");
        using var atSelf = new JavaScriptBot("function tick(state) { return {aim: bot.aimAt(state.self.position)}; }");
        var duel = new Duel(Config);
        for (var tick = 0; tick < 15; tick++) Step(duel, scan.Decide(duel.Observe("player")));
        var angle = duel.Observe("player").Self.TurretAngle;
        Step(duel, hold.Decide(duel.Observe("player")) with { LeftTrack = 1, RightTrack = -1 });
        Assert.Equal(angle, duel.Observe("player").Self.TurretAngle);
        Step(duel, atSelf.Decide(duel.Observe("player")));
        Assert.Equal(angle, duel.Observe("player").Self.TurretAngle);
    }

    [Fact]
    public void ScanCanSwitchToAimingAndBackWithoutResettingAngle()
    {
        using var scan = Strategy("bot.scan({speed: 1})");
        using var aim = Strategy("bot.aimAt({x: 10, y: 5})");
        var duel = new Duel(Config);
        for (var tick = 0; tick < 10; tick++) Step(duel, scan.Decide(duel.Observe("player")));
        for (var tick = 0; tick < 80; tick++) Step(duel, aim.Decide(duel.Observe("player")));
        var before = duel.Observe("player").Self.TurretAngle;
        Assert.Equal(0, before, 8);
        Step(duel, scan.Decide(duel.Observe("player")));
        var after = duel.Observe("player").Self.TurretAngle;
        Assert.InRange(after - before, 0.001, Config.MaxTurretTurnSpeed / Config.TickRate);
    }

    [Fact]
    public void OnlyReturnedCommandsExecuteAndInputMutationCannotMoveTheAimOrigin()
    {
        using var bot = new JavaScriptBot("""
            function tick(state) {
              bot.scan();
              state.self.position.x = 500;
              return {aim: bot.aimAt({x: 10, y: 5}), shoot: true};
            }
            """);
        var duel = new Duel(Config);
        var action = bot.Decide(duel.Observe("player"));
        Assert.Equal(new Vec2(8, 0), action.AimDirection);
        Assert.Null(action.TurretTurn);
        Assert.True(action.Shoot);
    }

    [Fact]
    public void HelpersDoNotInvokeUserToJsonAndReadGettersWithinTheBudget()
    {
        using var bot = new JavaScriptBot("""
            function tick() {
              Object.prototype.toJSON = () => { while (true) {} };
              return {aim: bot.aimAt({x: 10, y: 5, toJSON() { while (true) {} }})};
            }
            """);
        Assert.Equal(new Vec2(8, 0), bot.Decide(new Duel(Config).Observe("player")).AimDirection);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("{kind: 'unknown'}")]
    [InlineData("{kind: 'hold', speed: 1}")]
    [InlineData("{kind: 'at'}")]
    [InlineData("bot.aimAt(null)")]
    [InlineData("bot.aimAt({x: NaN, y: 1})")]
    [InlineData("bot.aimAt({x: '1', y: 1})")]
    [InlineData("bot.scan({speed: 0})")]
    [InlineData("bot.scan({speed: 2})")]
    [InlineData("bot.scan({speed: null})")]
    [InlineData("bot.scan({speed: true})")]
    [InlineData("bot.scan({direction: 'left'})")]
    [InlineData("bot.scan({unknown: 1})")]
    [InlineData("bot.scan(null)")]
    [InlineData("{kind: 'scan', get speed() { while (true) {} }}")]
    [InlineData("bot.aimAt({get x() { while (true) {} }, y: 1})")]
    public void InvalidCommandsAndUnboundedGettersReportStrategyErrors(string command)
    {
        using var bot = Strategy(command);
        var error = Assert.Throws<StrategyException>(() => bot.Decide(new Duel(Config).Observe("player")));
        Assert.Equal(0, error.Tick);
    }

    [Theory]
    [InlineData("aimDirection: {x: 0, y: 0}")]
    [InlineData("turretTurn: 0")]
    public void AimConflictsWithLowLevelTurretFields(string extra)
    {
        using var bot = new JavaScriptBot("function tick() { return {aim: bot.holdAim(), " + extra + "}; }");
        Assert.Throws<StrategyException>(() => bot.Decide(new Duel(Config).Observe("player")));
    }

    private static JavaScriptBot Strategy(string command) =>
        new("function tick() { return {aim: " + command + "}; }");

    private static void Step(Duel duel, BotAction action) =>
        duel.Step(new Dictionary<string, BotAction> { ["player"] = action, ["opponent"] = Idle });
}
