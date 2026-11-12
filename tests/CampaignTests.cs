using Xunit;

namespace BotArena.Tests;

public class CampaignTests
{
    [Fact]
    public void CampaignHubListsBeginnerAdvancedAndModesTracks()
    {
        Assert.Equal(
            new[] { "controls-beginner", "controls-advanced", "modes" },
            CampaignCatalog.TracksList.Select(track => track.Id));
        Assert.Equal(19, CampaignCatalog.All.Count);
        Assert.Equal(
            new[] { "move", "steer-short", "steer-long", "shoot-simple", "shoot-cover", "track", "duel" },
            CampaignCatalog.TracksList.Single(track => track.Id == "controls-beginner").Levels.Select(level => level.Id));
        Assert.Equal(
            new[] { "adv-move", "adv-steer-short", "adv-steer-long", "adv-shoot-simple", "adv-shoot-cover", "adv-track", "adv-duel" },
            CampaignCatalog.TracksList.Single(track => track.Id == "controls-advanced").Levels.Select(level => level.Id));
        Assert.Equal(
            new[] { "mode-duel", "mode-team-3v3", "mode-ffa", "mode-outnumbered", "mode-capture-point" },
            CampaignCatalog.TracksList.Single(track => track.Id == "modes").Levels.Select(level => level.Id));
        Assert.True(CampaignCatalog.TracksList.Single(track => track.Id == "modes").Available);
    }

    [Fact]
    public void ReachingMarkerCompletesMoveLevel()
    {
        var level = CampaignCatalog.Find("move")!;
        using var player = StrategyLanguages.Create(StrategyLanguages.JavaScript, """
            function tick() {
                return { leftTrack: 1, rightTrack: 1 };
            }
            """);
        using var opponent = StrategyLanguages.Create(StrategyLanguages.JavaScript, level.OpponentCode);

        var response = Match.Run(level.Config, player, opponent, level.Objective, level.Marker);

        Assert.Null(response.Error);
        Assert.Equal("player", response.Replay.Result.WinnerBotId);
        Assert.Equal("player", response.Replay.Result.WinnerTeamId);
        Assert.Equal(MatchEndReason.ObjectiveComplete, response.Replay.Result.Reason);
        Assert.NotNull(response.Replay.Marker);
    }

    [Fact]
    public void IdleTankFailsMoveLevelByTimeLimit()
    {
        var level = CampaignCatalog.Find("move")!;
        using var player = StrategyLanguages.Create(StrategyLanguages.JavaScript, """
            function tick() {
                return {};
            }
            """);
        using var opponent = StrategyLanguages.Create(StrategyLanguages.JavaScript, level.OpponentCode);

        var response = Match.Run(level.Config, player, opponent, level.Objective, level.Marker);

        Assert.Null(response.Replay.Result.WinnerBotId);
        Assert.Equal(MatchEndReason.TimeLimit, response.Replay.Result.Reason);
    }
}
