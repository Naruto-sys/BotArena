using Xunit;

namespace BotArena.Tests;

public class StrategyTests
{
    private static MatchConfig Config => MatchConfig.Classic;
    private static readonly BotAction Idle = new(0, 0, default, false);

    [Fact]
    public void TankStopsAtWallAndCanBackAway()
    {
        var states = Drive("wall", 50);
        var contact = Config.Arena.Walls.Single(wall => wall.Y < 5 && wall.Y + wall.Height > 5);
        var maxX = contact.X - Config.BotLength / 2;
        Assert.All(states, state => Assert.InRange(state.Position.X, 2, maxX));
        Assert.InRange(states[40].Position.X, maxX - 0.03, maxX);
        Assert.Equal(0, states[40].Speed);
        Assert.True(states[50].Position.X < states[40].Position.X - 0.5);
    }

    [Fact]
    public void ReverseBrakesBeforeChangingDirection()
    {
        var states = Drive("reverse", 23);
        Assert.Equal(Config.MaxForwardSpeed, states[12].Speed, 8);
        Assert.InRange(states[13].Speed, 0.01, states[12].Speed - 0.01);
        Assert.Contains(states[13..23], state => Math.Abs(state.Speed) < 1e-8);
        Assert.Equal(-Config.MaxReverseSpeed, states[23].Speed, 8);
    }

    [Fact]
    public void SteeringResistsAlternatingCommands()
    {
        var states = Drive("steering", 70);
        Assert.All(states, state => Assert.Equal(states[0].Position, state.Position));
        Assert.True(states[1].TurretAngle < 0 && states[1].BodyAngle > 0);
        Assert.True(states[13].BodyAngle > states[12].BodyAngle);
        Assert.True(states[24].BodyAngle < states[20].BodyAngle);
        for (var tick = 50; tick < states.Length - 1; tick++)
        {
            Assert.InRange(Math.Abs(states[tick + 1].BodyAngle - states[tick].BodyAngle), 0, 0.025);
            Assert.InRange(Math.Abs(states[tick + 1].TurretAngle - states[tick].TurretAngle), 0, 0.05);
        }
    }

    [Fact]
    public void TenSecondLimitIsDrawEvenWithUnequalHealth()
    {
        var ticks = Config.TickRate * 10;
        var duel = new Duel(Config with
        {
            MaxTicks = ticks,
            ShrinkZoneEnabled = false,
            Arena = Config.Arena with { Walls = [] },
        });
        var fireOnce = new BotAction(0, 0, new(1, 0), true);
        for (var tick = 0; tick < ticks; tick++)
        {
            Assert.Null(duel.Result);
            duel.Step(Actions(tick == 0 ? fireOnce : Idle));
        }

        var frame = duel.CaptureFrame();
        Assert.NotEqual(frame.Bots[0].Hp, frame.Bots[1].Hp);
        Assert.Equal(new MatchResult(null, MatchEndReason.TimeLimit, ticks), duel.Result);
        Assert.Contains(frame.Events, item => item.Type == GameEventType.MatchFinished);
    }

    [Theory]
    [InlineData("sandbox")]
    [InlineData("clamped-tracks")]
    public void ValidStrategiesCanRun(string strategy)
    {
        using var bot = Load(strategy);
        var action = bot.Decide(new Duel(Config).Observe("player"));
        Assert.Equal(strategy == "sandbox" ? Idle : new BotAction(1, 1, default, false), action);
    }

    [Theory]
    [InlineData("invalid-action", 8)]
    [InlineData("instruction-limit", 0)]
    public void InvalidStrategiesReportTheFailingTick(string strategy, int tick)
    {
        using var bot = Load(strategy);
        var duel = new Duel(Config);
        for (var step = 0; step < tick; step++)
            duel.Step(Actions(bot.Decide(duel.Observe("player"))));

        var error = Assert.Throws<StrategyException>(() => bot.Decide(duel.Observe("player")));
        Assert.Equal(tick, error.Tick);
    }

    private static BotState[] Drive(string strategy, int ticks)
    {
        using var bot = Load(strategy);
        var duel = new Duel(Config);
        var states = new List<BotState> { duel.Observe("player").Self };
        for (var tick = 0; tick < ticks; tick++)
        {
            duel.Step(Actions(bot.Decide(duel.Observe("player"))));
            states.Add(duel.Observe("player").Self);
        }
        return [.. states];
    }

    private static Dictionary<string, BotAction> Actions(BotAction player) =>
        new() { ["player"] = player, ["opponent"] = Idle };

    private static JavaScriptBot Load(string name) =>
        new(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "strategies", name + ".js")));
}
