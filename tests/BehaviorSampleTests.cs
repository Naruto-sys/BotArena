using Xunit;

namespace BotArena.Tests;

public class BehaviorSampleTests
{
    [Fact]
    public void MatchRecordsOnlyActionsAppliedToTheSimulation()
    {
        var playerAction = new BotAction(0.75, 0.25, new(1, 0), true);
        var opponentAction = new BotAction(-0.2, 0.4, new(-1, 0), false);
        using var player = new FixedBot(playerAction);
        using var opponent = new FixedBot(opponentAction);

        var response = Match.Run(MatchConfig.Classic with { MaxTicks = 1 }, new Dictionary<string, IBotRuntime>
        {
            ["player"] = player,
            ["opponent"] = opponent,
        });

        Assert.Collection(response.Replay.BehaviorSamples,
            sample =>
            {
                Assert.Equal("player", sample.BotId);
                Assert.Equal(0, sample.Tick);
                Assert.Equal(new Vec2(2, 5), sample.Position);
                Assert.False(sample.EnemyVisible);
                Assert.Equal(playerAction, sample.Action);
            },
            sample =>
            {
                Assert.Equal("opponent", sample.BotId);
                Assert.Equal(0, sample.Tick);
                Assert.Equal(new Vec2(14, 5), sample.Position);
                Assert.False(sample.EnemyVisible);
                Assert.Equal(opponentAction, sample.Action);
            });
    }

    private sealed class FixedBot(BotAction action) : IBotRuntime
    {
        public BotAction Decide(BotObservation observation) => action;
        public IReadOnlyList<StrategyLogLine> ConsumeLogs() => [];
        public void Dispose() { }
    }
}
