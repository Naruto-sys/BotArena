using Xunit;

namespace BotArena.Tests;

public class MultiRobotTests
{
    private static readonly BotAction Idle = new(0, 0, default, false);
    private static readonly BotAction Forward = new(1, 1, default, false);

    [Fact]
    public void ObservationListsVisibleSurvivorsAndKeepsNearestEnemy()
    {
        var config = Config(Spawn("self", 2, 2), Spawn("hidden", 6, 2),
            Spawn("far", 7, 6), Spawn("near", 2, 5));
        var duel = new Duel(config with { Arena = config.Arena with { Walls = [new(4, 1, 1, 2)] } });

        var observation = duel.Observe("self");
        Assert.Equal("near", observation.Enemy?.Id);
        Assert.Equal(new[] { "far", "near" }, observation.Enemies.Select(bot => bot.Id));
        duel.Forfeit("near");
        Assert.Equal(100, duel.Observe("near").Self.Hp);
        Assert.Null(duel.Result);
        Assert.Equal("far", Assert.Single(duel.Observe("self").Enemies).Id);
    }

    [Fact]
    public void ShotHitsNearestRobotAndMatchContinuesAfterElimination()
    {
        var duel = new Duel(Config(Spawn("shooter", 2, 2), Spawn("far", 6, 2), Spawn("near", 4, 2))
            with { BulletSpeed = 100, BulletDamage = 100 });
        duel.Step(new Dictionary<string, BotAction>
        {
            ["shooter"] = Idle with { Shoot = true },
            ["far"] = Idle,
            ["near"] = Idle,
        });

        var frame = duel.CaptureFrame();
        Assert.Equal("near", Assert.Single(frame.Events, item => item.Type == GameEventType.BotHit).TargetBotId);
        Assert.Equal(100, duel.Observe("far").Self.Hp);
        Assert.False(duel.Observe("near").Self.CanShoot);
        Assert.Null(duel.Result);

        duel.Step(new Dictionary<string, BotAction> { ["shooter"] = Idle, ["far"] = Idle });
        duel.Forfeit("far");
        Assert.Equal(new MatchResult("shooter", MatchEndReason.BotError, 2, "shooter"), duel.Result);
    }

    [Fact]
    public void RobotsCanEliminateEachOtherInTheSameTick()
    {
        var duel = new Duel(Config(Spawn("left", 2, 2), new("right", new(4, 2), Math.PI, Math.PI),
            Spawn("survivor", 7, 5)) with { BulletSpeed = 100, BulletDamage = 100 });
        duel.Step(new Dictionary<string, BotAction>
        {
            ["left"] = Idle with { Shoot = true },
            ["right"] = Idle with { Shoot = true },
            ["survivor"] = Idle,
        });
        Assert.Equal(new MatchResult("survivor", MatchEndReason.BotDestroyed, 1, "survivor"), duel.Result);
        Assert.Equal(new[] { 0, 0, 100 }, duel.CaptureFrame().Bots.Select(bot => bot.Hp));
    }

    [Fact]
    public void CancelledMovementPropagatesToRobotsFollowingBehind()
    {
        // a and b would advance together, but b's proposed path hits the stationary c.
        var duel = new Duel(Config(Spawn("a", 1, 2), Spawn("b", 1.8, 2),
            Spawn("c", 2.6, 2), Spawn("free", 1, 5)) with { TickRate = 1, MaxForwardSpeed = 0.5 });
        duel.Step(new Dictionary<string, BotAction>
        {
            ["a"] = Forward, ["b"] = Forward, ["c"] = Idle, ["free"] = Forward,
        });
        var frame = duel.CaptureFrame();
        Assert.Equal(new[] { 1.0, 1.8, 2.6 }, frame.Bots.Take(3).Select(bot => bot.Position.X));
        Assert.True(frame.Bots[3].Position.X > 1);
    }

    [Fact]
    public void HundredsOfRobotsAdvanceAndReachTimeLimit()
    {
        var spawns = Enumerable.Range(0, 256)
            .Select(i => Spawn($"bot-{i}", 2 + i % 16 * 3, 2 + i / 16 * 3)).ToArray();
        var duel = new Duel(Config(spawns) with { MaxTicks = 100 });
        var actions = spawns.ToDictionary(bot => bot.Id, _ => Forward);

        for (var i = 0; i < 100; i++) duel.Step(actions);

        Assert.Equal(new MatchResult(null, MatchEndReason.TimeLimit, 100), duel.Result);
        Assert.All(duel.CaptureFrame().Bots, bot => Assert.Equal(100, bot.Hp));
        Assert.True(duel.Observe("bot-0").Self.Position.X > 2);
    }

    [Fact]
    public void LongProjectileSweepFindsRobotsAtLargeCoordinates()
    {
        var config = Config(Spawn("left", 2, 2), Spawn("right", 4_294_967_294, 2));
        var duel = new Duel(config with
        {
            Arena = new(5_000_000_000, 60, []),
            BulletSpeed = 100_000_000_000,
        });
        duel.Step(new Dictionary<string, BotAction> { ["left"] = Idle with { Shoot = true }, ["right"] = Idle });
        Assert.Equal(80, duel.Observe("right").Self.Hp);
    }

    [Fact]
    public void NearestEnemyIsSelectedEvenWhenSquaredDistanceOverflows()
    {
        var duel = new Duel(Config(Spawn("self", 2, 2), Spawn("far", 2e200, 2), Spawn("near", 1e200, 2))
            with { Arena = new(3e200, 60, []) });
        Assert.Equal("near", duel.Observe("self").Enemy?.Id);
    }

    private static BotSpawn Spawn(string id, double x, double y) => new(id, new(x, y), 0, 0);

    private static MatchConfig Config(params BotSpawn[] spawns) =>
        MatchConfig.Classic with { Arena = new(60, 60, []), Spawns = spawns };
}
