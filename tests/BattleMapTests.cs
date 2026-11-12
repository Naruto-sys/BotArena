using Xunit;

namespace BotArena.Tests;

public sealed class BattleMapTests
{
    [Fact]
    public void OpenLayoutIsAccepted()
    {
        var request = new SaveBattleMapRequest("Тактическая", [
            new Wall(5, 1, 1.5, 2),
            new Wall(9, 7, 2, 1)
        ]);

        Assert.Null(BattleMapEndpoints.Validate(request));
    }

    [Fact]
    public void WallAcrossWholeArenaIsRejected()
    {
        var request = new SaveBattleMapRequest("Барьер", [
            new Wall(7.6, .2, .8, 4.7),
            new Wall(7.6, 5.1, .8, 4.7)
        ]);

        Assert.Contains("разделена", BattleMapEndpoints.Validate(request));
    }

    [Fact]
    public void SpawnCannotBeBlocked()
    {
        var request = new SaveBattleMapRequest("Ловушка", [new Wall(2.5, 4.5, 1, 1)]);

        Assert.Contains("старта", BattleMapEndpoints.Validate(request));
    }

    [Fact]
    public void ObstaclesCannotOverlap()
    {
        var request = new SaveBattleMapRequest("Пересечение", [
            new Wall(5, 2, 2, 2),
            new Wall(6, 3, 2, 2)
        ]);

        Assert.Contains("пересекаться", BattleMapEndpoints.Validate(request));
    }
}
