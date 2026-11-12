using Xunit;

namespace BotArena.Tests;

public class HelperStrategyTests
{
    [Fact]
    public void DriveToHelperReachesMoveMarker()
    {
        var level = CampaignCatalog.Find("move")!;
        using var player = StrategyLanguages.Create(StrategyLanguages.JavaScript, """
            function tick({ self }) {
                return { driveTo: { x: 10, y: 5 } };
            }
            """);
        using var opponent = StrategyLanguages.Create(StrategyLanguages.JavaScript, level.OpponentCode);

        var response = Match.Run(level.Config, player, opponent, level.Objective, level.Marker);

        Assert.Equal("player", response.Replay.Result.WinnerBotId);
        Assert.Equal(MatchEndReason.ObjectiveComplete, response.Replay.Result.Reason);
    }

    [Fact]
    public void AimAtHelperCanDestroyIdleTarget()
    {
        var level = CampaignCatalog.Find("shoot-simple")!;
        using var player = StrategyLanguages.Create(StrategyLanguages.JavaScript, """
            function tick({ self, enemy }) {
                if (!enemy) return {};
                return {
                    aimAt: enemy.position,
                    shoot: self.canShoot && facing(self, enemy.position)
                };
            }
            """);
        using var opponent = StrategyLanguages.Create(StrategyLanguages.JavaScript, level.OpponentCode);

        var response = Match.Run(level.Config, player, opponent, level.Objective, level.Marker);

        Assert.Equal("player", response.Replay.Result.WinnerBotId);
        Assert.Equal(MatchEndReason.BotDestroyed, response.Replay.Result.Reason);
    }

    [Fact]
    public void LowLevelTracksStillWorkAlongsideHelpers()
    {
        using var bot = StrategyLanguages.Create(StrategyLanguages.JavaScript, """
            function tick() {
                return { leftTrack: 1, rightTrack: 1 };
            }
            """);
        var action = bot.Decide(new Duel(MatchConfig.Classic).Observe("player"));
        Assert.Equal(new BotAction(1, 1, default, false), action);
    }
}
