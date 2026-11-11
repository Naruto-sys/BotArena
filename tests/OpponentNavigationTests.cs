using Xunit;

namespace BotArena.Tests;

public class OpponentNavigationTests
{
    [Theory]
    [InlineData("tracked")]
    [InlineData("hover")]
    [InlineData("wheeled")]
    [InlineData("omni")]
    public void AttackerGetsAroundWallOnEachChassis(string movement)
    {
        var arena = new ArenaState(16, 10, [new(7, 3, 1.5, 3)]);
        var config = MatchConfig.Classic with
        {
            Arena = arena,
            Spawns = [new("player", new(2, 5), 0, 0),
                new("opponent", new(12, 5), Math.PI, Math.PI) { Movement = MovementCatalog.Create(movement) }],
        };
        using var attacker = new BuiltInOpponent("aggressive", new(config));
        var response = Match.Run(config, new Dictionary<string, IBotRuntime>
        {
            ["player"] = new IdleBot(),
            ["opponent"] = attacker,
        });

        Assert.Null(response.Error);
        var path = response.Replay.Frames.Select(frame => frame.Bots[1].Position).ToArray();
        Assert.Contains(path, point => point.X < 7);
        Assert.Contains(path, point => point.Y < 2.55 || point.Y > 6.45);
    }

    [Theory]
    [InlineData("tracked")]
    [InlineData("hover")]
    [InlineData("wheeled")]
    [InlineData("omni")]
    public void DefenderReachesPatrolSideWithoutStickingToWall(string movement)
    {
        var arena = new ArenaState(16, 10, [new(11, 3, 1, 3)]);
        var config = MatchConfig.Classic with
        {
            Arena = arena,
            Spawns = [new("player", new(2, 5), 0, 0),
                new("opponent", new(14, 5), Math.PI, Math.PI) { Movement = MovementCatalog.Create(movement) }],
        };
        using var defender = new BuiltInOpponent("defensive", new(config));
        var response = Match.Run(config, new Dictionary<string, IBotRuntime>
        {
            ["player"] = new IdleBot(),
            ["opponent"] = defender,
        });

        Assert.Null(response.Error);
        var path = response.Replay.Frames.Take(96).Select(frame => frame.Bots[1].Position).ToArray();
        Assert.True(path.Any(point => point.X < 10.5 && point.Y < 4), string.Join(", ", path.Where((_, index) => index % 10 == 0)));
    }

    [Fact]
    public void NoRouteReturnsCurrentPosition()
    {
        var navigator = new ArenaNavigator(MatchConfig.Classic with { Arena = new(16, 10, [new(7, 0, 1, 10)]) });
        var start = new Vec2(4, 5);
        Assert.Equal(start, navigator.Waypoint(BotAt(start), new(12, 5)));
    }

    [Fact]
    public void EscapeBetweenPaddedWallsDoesNotCrossThePhysicalWall()
    {
        var navigator = new ArenaNavigator(MatchConfig.Classic);
        var start = new Vec2(6.76, 3.67);
        var waypoint = navigator.Waypoint(BotAt(start), new(12, 3));
        Assert.True(waypoint.X < start.X);
        Assert.Equal(start.Y, waypoint.Y);
    }

    [Fact]
    public void RotatedRobotCanEscapeAConvexCorner()
    {
        var navigator = new ArenaNavigator(MatchConfig.Classic);
        var start = new Vec2(4.25, 1.65);
        var waypoint = navigator.Waypoint(BotAt(start, -Math.PI / 4), new(12, 3));
        Assert.True(waypoint.X < start.X || waypoint.Y < start.Y);
    }

    private static BotState BotAt(Vec2 position, double angle = 0) =>
        new("opponent", "opponent", position, angle, angle, 0, 100, 100, 0);

    private sealed class IdleBot : IBotRuntime
    {
        public BotAction Decide(BotObservation state) => new(0, 0, default, false);
        public IReadOnlyList<StrategyLogLine> ConsumeLogs() => [];
        public void Dispose() { }
    }
}
