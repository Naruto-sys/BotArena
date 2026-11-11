using Xunit;

namespace BotArena.Tests;

public sealed class PveTests
{
    public static IEnumerable<object[]> AllLevelIds() =>
        PveCatalog.Levels.Select(level => new object[] { level.Id });

    [Fact]
    public void CampaignHasTrainingAndTenFiveStageBlocks()
    {
        Assert.Equal(11, PveCatalog.Blocks.Count);
        Assert.Equal(55, PveCatalog.Levels.Count);
        Assert.True(PveCatalog.Blocks[0].IsTraining);
        Assert.All(PveCatalog.Blocks, block => Assert.Equal(5, block.Levels.Count));
        Assert.Equal(Enumerable.Range(1, 55), PveCatalog.Levels.Select(level => level.Order));
        Assert.All(PveCatalog.Levels, level =>
        {
            Assert.NotEmpty(level.Hints);
            Assert.NotEmpty(level.JavaScriptSolution);
            Assert.NotEmpty(level.PythonSolution);
            Assert.True(level.Reward > 0);
        });
    }

    [Fact]
    public void RankedLevelsHaveDistinctScenarios()
    {
        var ranked = PveCatalog.Levels.Where(level => !level.IsTraining).ToArray();
        Assert.Equal(ranked.Length, ranked.Select(level => level.OpponentCode).Distinct().Count());
        Assert.All(ranked, level => Assert.NotEmpty(level.Config.Arena.Walls));
        Assert.Equal(ranked.Length, ranked.Select(level => string.Join('|', level.Config.Arena.Walls)).Distinct().Count());
    }

    [Theory]
    [MemberData(nameof(AllLevelIds))]
    public void CorrectCodeWinsEveryLevel(string id)
    {
        var level = PveCatalog.Get(id);
        using var player = StrategyLanguages.Create(StrategyLanguages.JavaScript, level.JavaScriptSolution);
        using var opponent = StrategyLanguages.Create(StrategyLanguages.JavaScript, level.OpponentCode);

        var response = Match.Run(level.Config, player, opponent);

        Assert.Equal("player", response.Replay.Result.WinnerBotId);
        Assert.True(PveEndpoints.TechniquePassed(level, response.Replay));
    }
}
