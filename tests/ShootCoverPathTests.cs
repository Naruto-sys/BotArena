using Xunit;

namespace BotArena.Tests;

public class ShootCoverPathTests
{
    [Fact]
    public void TwoStepBypassSeesAndDestroysEnemy()
    {
        var level = CampaignCatalog.Find("shoot-cover")!;
        using var bot = StrategyLanguages.Create(StrategyLanguages.JavaScript, """
            let step = 1;
            function tick({ self, enemy }) {
              const south = { x: 5, y: 2.0 };
              const peek = { x: 10.5, y: 2.2 };
              if (step === 1 && reached(self, south)) step = 2;
              if (!enemy) {
                return { driveTo: step === 1 ? south : peek };
              }
              return {
                aimAt: enemy.position,
                shoot: self.canShoot && facing(self, enemy.position)
              };
            }
            """);
        using var opponent = StrategyLanguages.Create(StrategyLanguages.JavaScript, level.OpponentCode);
        var response = Match.Run(level.Config, bot, opponent, level.Objective, level.Marker);
        Assert.Null(response.Error);
        Assert.Equal("player", response.Replay.Result.WinnerBotId);
        Assert.Equal(MatchEndReason.BotDestroyed, response.Replay.Result.Reason);
    }
}
