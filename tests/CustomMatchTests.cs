using Xunit;

namespace BotArena.Tests;

public class CustomMatchTests
{
    [Fact]
    public void BehaviorPresetsCatalogIsAvailable()
    {
        Assert.Contains(BehaviorPresets.All, item => item.Id == "blind-afraid");
        Assert.Contains(BehaviorPresets.All, item => item.Id == "blind-berserk");
        Assert.Contains(BehaviorPresets.All, item => item.Id == "patrol" && item.Strength == "standard");
        Assert.Contains(BehaviorPresets.All, item => item.Id == "trench");
        Assert.Contains(BehaviorPresets.All, item => item.Id == "assault");
        Assert.True(BehaviorPresets.Exists("idle"));
        Assert.True(BehaviorPresets.Exists("skirmisher"));
        Assert.False(string.IsNullOrWhiteSpace(BehaviorPresets.GetCode("patrol")));
    }

    [Fact]
    public void CustomMatchWithPresetsRunsAndPlayerCanWin()
    {
        var arena = new ArenaState(16, 10, []);
        var config = MatchConfig.Classic with
        {
            MaxTicks = 220,
            Arena = arena,
            Spawns =
            [
                new("player", new(2.5, 5), 0, 0, "player", 100),
                new("opponent", new(13.5, 5), Math.PI, Math.PI, "opponent", 40),
            ]
        };

        using var player = StrategyLanguages.Create(StrategyLanguages.JavaScript, """
            function tick({ self, enemy }) {
              if (!enemy) return { driveTo: { x: 10, y: 5 } };
              return {
                driveTo: enemy.position,
                aimAt: enemy.position,
                shoot: self.canShoot && facing(self, enemy.position)
              };
            }
            """);
        using var opponent = StrategyLanguages.Create(StrategyLanguages.JavaScript, BehaviorPresets.GetCode("blind-afraid"));
        var response = Match.Run(config, new Dictionary<string, IBotRuntime>
        {
            ["player"] = player,
            ["opponent"] = opponent
        }, logBotIds: new HashSet<string> { "player" });

        Assert.Null(response.Error);
        Assert.Equal("player", response.Replay.Result.WinnerTeamId);
    }

    [Fact]
    public void AssaultPresetPathsAroundWallsWithoutScriptError()
    {
        var config = MatchConfig.Classic with
        {
            MaxTicks = 180,
            Spawns =
            [
                new("player", new(2.2, 5), 0, 0, "player"),
                new("opponent", new(13.8, 5), Math.PI, Math.PI, "opponent", 80),
            ]
        };

        using var player = StrategyLanguages.Create(StrategyLanguages.JavaScript, BehaviorPresets.GetCode("assault"));
        using var opponent = StrategyLanguages.Create(StrategyLanguages.JavaScript, BehaviorPresets.GetCode("blind-afraid"));
        var response = Match.Run(config, new Dictionary<string, IBotRuntime>
        {
            ["player"] = player,
            ["opponent"] = opponent
        }, logBotIds: new HashSet<string> { "player" });

        Assert.Null(response.Error);
        Assert.True(response.Replay.Frames.Count > 20);
        var moved = response.Replay.Frames.Any(frame =>
        {
            var bot = frame.Bots.Single(item => item.Id == "player");
            return double.Hypot(bot.Position.X - 2.2, bot.Position.Y - 5) > 1.5;
        });
        Assert.True(moved);
    }

    [Fact]
    public void TwoVsTwoPresetMatchCompletes()
    {
        var config = MatchConfig.Classic with
        {
            MaxTicks = 260,
            Arena = new(16, 10, []),
            Spawns =
            [
                new("player", new(2.2, 3), 0, 0, "player"),
                new("player-2", new(2.2, 7), 0, 0, "player"),
                new("opponent", new(13.8, 3), Math.PI, Math.PI, "opponent", 40),
                new("opponent-2", new(13.8, 7), Math.PI, Math.PI, "opponent", 40),
            ]
        };

        var owned = new List<IDisposable>();
        var runtimes = new Dictionary<string, IBotRuntime>();
        try
        {
            foreach (var spawn in config.Spawns)
            {
                var code = spawn.ResolvedTeamId == "player"
                    ? """
                      function tick({ self, enemy }) {
                        if (!enemy) return { driveTo: { x: 10, y: self.position.y } };
                        return {
                          driveTo: enemy.position,
                          aimAt: enemy.position,
                          shoot: self.canShoot && facing(self, enemy.position)
                        };
                      }
                      """
                    : BehaviorPresets.GetCode("blind-afraid");
                var runtime = StrategyLanguages.Create(StrategyLanguages.JavaScript, code);
                owned.Add(runtime);
                runtimes[spawn.Id] = runtime;
            }

            var response = Match.Run(config, runtimes, logBotIds: new HashSet<string> { "player", "player-2" });
            Assert.Null(response.Error);
            Assert.Equal("player", response.Replay.Result.WinnerTeamId);
        }
        finally
        {
            foreach (var item in owned) item.Dispose();
        }
    }
}
