using Xunit;

namespace BotArena.Tests;

public class ModesCampaignTests
{
    [Fact]
    public void ModesTrackIsAvailableWithFourDemoLevels()
    {
        var track = CampaignCatalog.TracksList.Single(item => item.Id == "modes");
        Assert.True(track.Available);
        Assert.Equal(
            new[] { "mode-duel", "mode-team-3v3", "mode-ffa", "mode-outnumbered" },
            track.Levels.Select(level => level.Id));
    }

    [Theory]
    [InlineData("mode-duel")]
    [InlineData("mode-team-3v3")]
    [InlineData("mode-ffa")]
    [InlineData("mode-outnumbered")]
    public void ModesDemoStarterWins(string levelId)
    {
        var level = CampaignCatalog.Find(levelId)!;
        var response = RunLevel(level);
        Assert.Null(response.Error);
        Assert.Equal("player", response.Replay.Result.WinnerTeamId);
        Assert.Equal(MatchEndReason.BotDestroyed, response.Replay.Result.Reason);
    }

    private static MatchResponse RunLevel(CampaignLevel level)
    {
        var runtimes = new Dictionary<string, IBotRuntime>(StringComparer.Ordinal);
        var owned = new List<IDisposable>();
        try
        {
            foreach (var spawn in level.Config.Spawns)
            {
                IBotRuntime runtime;
                if (spawn.ResolvedTeamId == Match.PlayerTeamId)
                {
                    var script = level.ResolvedPlayerScripts.First(item => item.BotId == spawn.Id);
                    runtime = StrategyLanguages.Create(StrategyLanguages.JavaScript, script.JavaScript);
                }
                else
                {
                    runtime = StrategyLanguages.Create(
                        StrategyLanguages.JavaScript, level.OpponentCodeFor(spawn.Id));
                }
                owned.Add(runtime);
                runtimes[spawn.Id] = runtime;
            }

            var playerIds = level.Config.Spawns
                .Where(spawn => spawn.ResolvedTeamId == Match.PlayerTeamId)
                .Select(spawn => spawn.Id)
                .ToHashSet(StringComparer.Ordinal);
            return Match.Run(level.Config, runtimes, level.Objective, level.Marker, playerIds);
        }
        finally
        {
            foreach (var item in owned) item.Dispose();
        }
    }
}
