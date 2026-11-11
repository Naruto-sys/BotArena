using Xunit;

namespace BotArena.Tests;

public class FreeForAllTests
{
    [Fact]
    public void RemainingRobotsPlayAfterAForfeit()
    {
        var config = MatchSetup.Configure("hover", [new("aggressive", "wheeled"), new("defensive", "omni")])
            with { MaxTicks = 3 };
        using var player = new TestBot(_ => throw new StrategyException("Test failure", 0));
        using var first = new TestBot(state =>
        {
            if (state.Tick > 0) Assert.DoesNotContain(state.Enemies, bot => bot.Id == "player");
            return new(0, 0, default, false) { Throttle = 1 };
        });
        using var second = new TestBot(_ => new(0, 0, default, false) { Thrust = new(0, -1) });

        var response = Match.Run(config, new Dictionary<string, IBotRuntime>
        {
            ["player"] = player,
            ["opponent"] = first,
            ["opponent-2"] = second,
        });

        Assert.Equal("player", response.Error?.BotId);
        Assert.Equal(new MatchResult(null, MatchEndReason.TimeLimit, 3), response.Replay.Result);
        Assert.All(response.Replay.Frames, frame => Assert.True(frame.Bots[0].Forfeited));
        Assert.Equal(100, response.Replay.Frames[^1].Bots[0].Hp);
        Assert.True(response.Replay.Frames[^1].Bots[1].Speed > 0);
        Assert.True(response.Replay.Frames[^1].Bots[2].Speed > 0);
    }

    [Fact]
    public void SimultaneousFailuresLeaveNoWinner()
    {
        var config = MatchSetup.Configure(null, [new("aggressive"), new("defensive")]);
        using var failed = new TestBot(_ => throw new StrategyException("Test failure", 0));
        var response = Match.Run(config, config.Spawns.ToDictionary(spawn => spawn.Id, _ => (IBotRuntime)failed));
        Assert.Equal(new MatchResult(null, MatchEndReason.BotError, 0), response.Replay.Result);
        Assert.All(Assert.Single(response.Replay.Frames).Bots, bot => Assert.True(bot.Forfeited));
    }

    [Fact]
    public void WheelRequiresMotionToSteerWhileOmniActivelyBrakes()
    {
        var idle = new BotAction(0, 0, default, false);
        var wheel = new WheeledMovement();
        Assert.Equal(0, wheel.Propose(default, idle with { Turn = 1 }, default, 0.05, true).Heading);
        Assert.True(wheel.Propose(default, idle with { Turn = 1, Throttle = 1 }, default, 0.05, true).Heading > 0);
        Assert.True(wheel.Propose(default, idle with { Turn = 1, Throttle = -1 }, default, 0.05, true).Heading < 0);

        var moving = new BotMotion(0, 0, new(0, 2), 2);
        var omni = new OmniMovement().Propose(moving, idle, default, 0.2, true);
        var hover = new HoverMovement(drag: 0).Propose(moving, idle, default, 0.2, true);
        Assert.Equal(default, omni.Velocity);
        Assert.Equal(moving.Velocity, hover.Velocity);
    }

    private sealed class TestBot(Func<BotObservation, BotAction> decide) : IBotRuntime
    {
        public BotAction Decide(BotObservation state) => decide(state);
        public IReadOnlyList<StrategyLogLine> ConsumeLogs() => [];
        public void Dispose() { }
    }
}
