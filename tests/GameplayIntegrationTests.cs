using Xunit;

namespace BotArena.Tests;

public class GameplayIntegrationTests
{
    private static readonly BotAction Idle = new(0, 0, default, false);

    [Fact]
    public void MortarSplashHitsMultipleEnemiesAndPreservesAllies()
    {
        var config = MatchConfig.Classic with
        {
            Arena = new(20, 12, []), ShrinkZoneEnabled = false,
            Spawns = [new("player", new(2, 5), 0, 0, "blue", Weapon: WeaponType.Mortar),
                new("ally", new(12, 6), 0, 0, "blue"), new("enemy-a", new(11.5, 5), 0, 0, "red"),
                new("enemy-b", new(12.5, 5), 0, 0, "red")]
        };
        var duel = new Duel(config);
        Step(duel, config, new(0, 0, default, true, TargetPoint: new(12, 5)));
        for (var tick = 1; tick < 51; tick++) Step(duel, config);
        Assert.Equal(65, duel.Bot("enemy-a").Hp);
        Assert.Equal(65, duel.Bot("enemy-b").Hp);
        Assert.Equal(100, duel.Bot("ally").Hp);
        Assert.Equal(2, duel.CaptureFrame().Events.Count(e => e.Type == GameEventType.BotHit));
    }

    [Fact]
    public void GaussPassesThroughAlliesAndStopsAtTheNearestEnemy()
    {
        var config = MatchConfig.Classic with
        {
            Arena = new(20, 12, []), ShrinkZoneEnabled = false,
            Spawns = [new("player", new(2, 5), 0, 0, "blue", Weapon: WeaponType.Gauss),
                new("ally", new(5, 5), 0, 0, "blue"), new("enemy-a", new(8, 5), 0, 0, "red"),
                new("enemy-b", new(12, 5), 0, 0, "red")]
        };
        var duel = new Duel(config);
        Step(duel, config, Idle with { Shoot = true });
        Assert.Equal(100, duel.Bot("ally").Hp);
        Assert.Equal(40, duel.Bot("enemy-a").Hp);
        Assert.Equal(100, duel.Bot("enemy-b").Hp);
    }

    [Fact]
    public void EveryParticipantHasIndependentInventoryAndEnemiesNeverRevealIt()
    {
        var config = MatchConfig.Classic with
        {
            Arena = new(20, 12, []), ShrinkZoneEnabled = false,
            Consumables = new() { Enabled = true, InitialCount = 0, MinSpawnSeconds = 100, MaxSpawnSeconds = 100 },
            Spawns = [new("player", new(2, 5), 0, 0), new("two", new(8, 5), 0, 0), new("three", new(14, 5), 0, 0)],
            InitialItems = [new(ConsumableType.Shield, new(2, 5)), new(ConsumableType.Shield, new(8, 5)), new(ConsumableType.Shield, new(14, 5))]
        };
        var duel = new Duel(config);
        Step(duel, config);
        foreach (var spawn in config.Spawns)
        {
            Assert.Single(duel.Observe(spawn.Id).Self.Inventory);
            Assert.All(duel.Observe(spawn.Id).Enemies, enemy => Assert.Empty(enemy.Inventory));
        }
        duel.Step(config.Spawns.ToDictionary(s => s.Id, _ => Idle with { UseItem = ConsumableType.Shield }));
        Assert.All(duel.CaptureFrame().Bots, bot => Assert.Equal(40, bot.ShieldHp));
    }

    [Theory]
    [InlineData("tracked")]
    [InlineData("hover")]
    [InlineData("wheeled")]
    [InlineData("omni")]
    public void AllBuiltInChassisRespectSurfaceSpeedModifiers(string chassis)
    {
        MatchConfig Config(bool sand) => MatchConfig.Classic with
        {
            Arena = new(100, 100, []) { CellSize = 100, Cells = sand ? [new(0, 0, SurfaceType.Sand)] : [] },
            ShrinkZoneEnabled = false,
            Spawns = [new("player", new(2, 5), 0, 0) { Movement = MovementCatalog.Create(chassis) }, new("enemy", new(90, 90), 0, 0)]
        };
        var ground = Config(false); var terrain = Config(true);
        var first = new Duel(ground); var second = new Duel(terrain);
        var action = Idle with { LeftTrack = 1, RightTrack = 1, Throttle = 1, Thrust = new(1, 0) };
        for (var tick = 0; tick < 60; tick++) { Step(first, ground, action); Step(second, terrain, action); }
        Assert.InRange(second.Bot("player").Speed / first.Bot("player").Speed, 0.74, 0.76);
    }

    private static void Step(Duel duel, MatchConfig config, BotAction? player = null) =>
        duel.Step(config.Spawns.ToDictionary(spawn => spawn.Id, spawn => spawn.Id == "player" ? player ?? Idle : Idle));
}
