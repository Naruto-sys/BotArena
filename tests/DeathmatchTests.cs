using System.Text.Json;
using Xunit;

namespace BotArena.Tests;

public class DeathmatchTests
{
    private static readonly BotAction Idle = new(0, 0, default, false);
    private static MatchConfig Config() => MatchConfig.Classic with
    {
        Mode = MatchMode.Deathmatch, MaxTicks = 2400, Arena = new(20, 12, []),
        Spawns = [Spawn("player", 2, 3), Spawn("opponent", 6, 3, Math.PI),
            Spawn("third", 12, 8), Spawn("fourth", 16, 8, Math.PI)],
        Deathmatch = new() { RespawnPoints = [Point("a", 2, 3), Point("b", 6, 3), Point("c", 12, 8), Point("d", 16, 8)] },
        GaussDamage = 100, GaussCooldownTicks = 1, BulletDamage = 100, BulletSpeed = 200,
        ShotCooldownTicks = 1, MortarDamage = 100, MortarMinFlightSeconds = 0.05, MortarSpeed = 200,
        ShrinkStartSeconds = 0, ShrinkDurationSeconds = .1,
    };

    private static BotSpawn Spawn(string id, double x, double y, double angle = 0, WeaponType weapon = WeaponType.Gauss) =>
        new(id, new(x, y), angle, angle, id, Weapon: weapon);
    private static RespawnPoint Point(string id, double x, double y) => new(id, new(x, y));
    private static DeathmatchStanding Row(Duel duel, string id) => duel.CaptureFrame().Deathmatch!.Standings.Single(row => row.BotId == id);

    private static void Step(Duel duel, params (string Id, BotAction Action)[] overrides)
    {
        var actions = duel.CaptureFrame().Bots.Where(bot => bot.Hp > 0 && !bot.Forfeited).ToDictionary(bot => bot.Id, _ => Idle);
        foreach (var (id, action) in overrides) actions[id] = action;
        duel.Step(actions);
    }

    private static MatchConfig HiddenSpawnConfig()
    {
        var config = Config();
        return config with
        {
            Arena = new(20, 12, [new(8.5, 0, .5, 12), new(3.5, 5, 2, 1)]),
            Deathmatch = config.Deathmatch! with
            {
                RespawnSeconds = .15,
                RespawnPoints = [.. config.Deathmatch.RespawnPoints, Point("hidden", 2, 9)],
            },
        };
    }

    [Theory]
    [InlineData(WeaponType.Cannon)]
    [InlineData(WeaponType.Gauss)]
    [InlineData(WeaponType.Mortar)]
    public void EveryWeaponCreditsOneKillAndOneDeath(WeaponType weapon)
    {
        var config = Config();
        var duel = new Duel(config with { Spawns = config.Spawns.Select(s => s.Id == "player" ? s with { Weapon = weapon } : s).ToArray() });
        Step(duel, ("player", Idle with { Shoot = true, TargetPoint = weapon == WeaponType.Mortar ? new(6, 3) : null }));
        Step(duel);
        Assert.Equal(1, Row(duel, "player").Score);
        Assert.Equal(1, Row(duel, "player").Kills);
        Assert.Equal(1, Row(duel, "opponent").Deaths);
        Assert.Null(duel.Result);
        Assert.False(Row(duel, "opponent").Alive);
    }

    [Fact]
    public void MortarMultikillCreditsEveryVictimBeforeEndingTheTick()
    {
        var config = Config();
        var duel = new Duel(config with
        {
            Spawns = [config.Spawns[0] with { Weapon = WeaponType.Mortar }, config.Spawns[1],
                Spawn("third", 6, 4.2), config.Spawns[3]],
            Deathmatch = config.Deathmatch! with { ScoreLimit = 1 },
        });
        Step(duel, ("player", Idle with { Shoot = true, TargetPoint = new(6, 3.6) }));
        Step(duel);
        Assert.Equal(2, Row(duel, "player").Score);
        Assert.Equal("player", duel.Result!.WinnerBotId);
        Assert.Equal(MatchEndReason.ScoreLimit, duel.Result.Reason);
        Assert.Equal(2, duel.CaptureFrame().Events.Count(e => e.Type == GameEventType.KillScored));
    }

    [Fact]
    public void NonlethalHitGivesNoPointsAndTheLethalAttackerGetsCredit()
    {
        var config = Config();
        var duel = new Duel(config with
        {
            GaussDamage = 60,
            Spawns = [config.Spawns[0], config.Spawns[1], Spawn("third", 10, 3, Math.PI, WeaponType.Cannon), config.Spawns[3]],
        });
        Step(duel, ("player", Idle with { Shoot = true }));
        Assert.Equal(0, Row(duel, "player").Score);
        Step(duel, ("third", Idle with { Shoot = true }));
        Assert.Equal(0, Row(duel, "player").Score);
        Assert.Equal(1, Row(duel, "third").Score);
        Assert.Equal(1, Row(duel, "opponent").Deaths);
    }

    [Fact]
    public void MultipleAttacksCannotCreditTheSameLifeTwice()
    {
        var config = Config();
        var duel = new Duel(config with
        {
            Spawns = [config.Spawns[0], config.Spawns[1], Spawn("third", 10, 3, Math.PI), config.Spawns[3]],
        });
        Step(duel, ("player", Idle with { Shoot = true }), ("third", Idle with { Shoot = true }));
        Assert.Single(duel.CaptureFrame().Events, e => e.Type == GameEventType.KillScored && e.TargetBotId == "opponent");
        Assert.Equal(1, Row(duel, "opponent").Deaths);
    }

    [Fact]
    public void MutualKillsShareFirstPlaceAndPreserveBothFinalScores()
    {
        var config = Config();
        var duel = new Duel(config with { Deathmatch = config.Deathmatch! with { ScoreLimit = 1 } });
        Step(duel, ("player", Idle with { Shoot = true }), ("opponent", Idle with { Shoot = true }));
        Assert.Null(duel.Result!.WinnerBotId);
        Assert.Equal(new[] { "opponent", "player" }, duel.Result.WinnerBotIds);
        Assert.Equal(MatchEndReason.ScoreLimit, duel.Result.Reason);
        Assert.All(duel.Result.Standings.Where(s => s.BotId is "player" or "opponent"), row => Assert.Equal(1, row.Score));
    }

    [Fact]
    public void DeadPlayerCanScorePosthumouslyAndWinOnTime()
    {
        var config = Config();
        var duel = new Duel(config with
        {
            MaxTicks = 8, MortarMinFlightSeconds = .2,
            Spawns = config.Spawns.Select(s => s.Id == "player" ? s with { Weapon = WeaponType.Mortar }
                : s.Id == "fourth" ? s with { Position = new(12.8, 8) } : s).ToArray(),
        });
        Step(duel, ("player", Idle with { Shoot = true, TargetPoint = new(12.4, 8) }),
            ("opponent", Idle with { Shoot = true }));
        for (var i = 1; i < 8; i++) Step(duel);
        Assert.False(Row(duel, "player").Alive);
        Assert.Equal(2, Row(duel, "player").Score);
        Assert.Equal("player", duel.Result!.WinnerBotId);
        Assert.Equal(new[] { "player" }, duel.Result.WinnerBotIds);
        Assert.Equal(MatchEndReason.TimeLimit, duel.Result.Reason);
    }

    [Fact]
    public void AllDeadAndOneAliveDoNotFinishTheMatch()
    {
        var config = Config();
        var duel = new Duel(config with { Deathmatch = config.Deathmatch! with { RespawnSeconds = .1 } });
        Step(duel, config.Spawns.Select(s => (s.Id, Idle with { Shoot = true })).ToArray());
        Assert.All(duel.CaptureFrame().Bots, bot => Assert.Equal(0, bot.Hp));
        Assert.Null(duel.Result);
        Step(duel); Step(duel);
        // On an open map, the first return is visible from every other candidate.
        Assert.Single(duel.CaptureFrame().Bots, bot => bot.Hp > 0);
        Assert.Null(duel.Result);
        Assert.All(duel.CaptureFrame().Deathmatch!.Standings, row => Assert.Equal(1, row.Deaths));
    }

    [Fact]
    public void ShrinkingIsDisabledAndEqualScoresShareFirstPlaceAtTimeLimit()
    {
        var duel = new Duel(Config() with { MaxTicks = 20 });
        for (var i = 0; i < 20; i++) Step(duel);
        Assert.Null(duel.CaptureFrame().SafeZone);
        Assert.All(duel.CaptureFrame().Bots, bot => Assert.Equal(100, bot.Hp));
        Assert.Equal(4, duel.Result!.WinnerBotIds.Count);
        Assert.All(duel.Result.Standings, row => Assert.Equal(0, row.Score));
    }

    [Fact]
    public void RespawnWaitsExactlyTheDelayAndUsesTheOnlyHiddenFreePoint()
    {
        var duel = new Duel(HiddenSpawnConfig());
        Step(duel, ("opponent", Idle with { Shoot = true }));
        Assert.Equal(.15, Row(duel, "player").RespawnSecondsRemaining!.Value, 10);
        Step(duel); Step(duel);
        Assert.False(Row(duel, "player").Alive);
        Step(duel);
        Assert.Equal(new Vec2(2, 9), duel.Bot("player").Position);
        Assert.True(Row(duel, "player").Alive);
        Assert.Equal(100, duel.Bot("player").Hp);
        Assert.Equal(WeaponChargeStage.Ready, duel.Bot("player").ChargeStage);
        Assert.Equal(0, duel.Bot("player").Speed);
        Assert.Equal(default, duel.Bot("player").Velocity);
        Assert.Equal(1, Row(duel, "player").Deaths);
        Assert.Equal(1, Row(duel, "opponent").Score);
        Assert.Contains(duel.CaptureFrame().Events, e => e.Type == GameEventType.BotRespawned && e.TargetBotId == "player");
    }

    [Fact]
    public void OccupiedHiddenPointWaitsAndRetriesWithoutRestartingDelay()
    {
        var config = HiddenSpawnConfig();
        var duel = new Duel(config with
        {
            Spawns = config.Spawns.Select(s => s.Id == "third" ? s with { Position = new(2, 9) } : s).ToArray(),
        });
        Step(duel, ("opponent", Idle with { Shoot = true }));
        Step(duel); Step(duel); Step(duel);
        Assert.True(Row(duel, "player").WaitingForSpace);
        Assert.Equal(0, Row(duel, "player").RespawnSecondsRemaining);
        duel.Forfeit("third");
        Step(duel);
        Assert.True(Row(duel, "player").Alive);
        Assert.Equal(new Vec2(2, 9), duel.Bot("player").Position);
    }

    [Fact]
    public void FogAndSmokeCannotMakeAnExposedSpawnSafe()
    {
        var config = Config();
        var duel = new Duel(config with
        {
            Arena = config.Arena with { CellSize = 20, Cells = [new(0, 0, SurfaceType.Ground, Fog: true)] },
            Deathmatch = config.Deathmatch! with { RespawnSeconds = .1 },
            Consumables = new() { Enabled = true, InitialCount = 0, MinSpawnSeconds = 100, MaxSpawnSeconds = 100 },
            InitialItems = [new(ConsumableType.Smoke, new(6, 3))],
        });
        Step(duel);
        Step(duel, ("opponent", Idle with { Shoot = true, UseItem = ConsumableType.Smoke }));
        Step(duel); Step(duel);
        Assert.NotEmpty(duel.CaptureFrame().SmokeClouds);
        Assert.True(Row(duel, "player").WaitingForSpace);
        Assert.False(Row(duel, "player").Alive);
    }

    [Fact]
    public void RespawnDropsInventoryAndBuffsButKeepsWeaponAndCounters()
    {
        var config = HiddenSpawnConfig();
        var duel = new Duel(config with
        {
            GaussDamage = 200,
            Consumables = new() { Enabled = true, InitialCount = 0, MinSpawnSeconds = 100, MaxSpawnSeconds = 100 },
            InitialItems = [new(ConsumableType.Shield, new(1.55, 3)), new(ConsumableType.SpeedBoost, new(2.45, 3))],
        });
        Step(duel);
        Step(duel, ("player", Idle with { UseItem = ConsumableType.Shield }), ("opponent", Idle with { Shoot = true }));
        Step(duel); Step(duel); Step(duel);
        var bot = duel.Bot("player");
        Assert.Equal(100, bot.Hp);
        Assert.Equal(WeaponType.Gauss, bot.Weapon);
        Assert.True(bot.CanShoot);
        Assert.Empty(bot.Inventory);
        Assert.Empty(bot.ActiveEffects);
        Assert.Equal(0, bot.ShieldHp);
        Assert.Equal(1, Row(duel, "player").Deaths);
    }

    [Fact]
    public void ScoreAndRespawnSnapshotsArePublicWithoutLeakingHiddenPositions()
    {
        var duel = new Duel(HiddenSpawnConfig());
        Step(duel, ("opponent", Idle with { Shoot = true }));
        var observation = duel.Observe("fourth");
        Assert.Empty(observation.Allies);
        Assert.DoesNotContain(observation.Enemies, bot => bot.Id == "opponent");
        Assert.Equal(1, observation.Deathmatch!.Standings.Single(row => row.BotId == "opponent").Score);
        var json = JsonSerializer.Serialize(observation.Deathmatch, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.DoesNotContain("position", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("respawnPoints", json);
        Assert.All(observation.Enemies, enemy => Assert.Empty(enemy.Inventory));
    }

    [Fact]
    public void ForfeitsDoNotAwardKillsAndExcludeLeadersFromVictory()
    {
        var duel = new Duel(Config() with { MaxTicks = 3 });
        Step(duel, ("player", Idle with { Shoot = true }));
        duel.Forfeit("player");
        Step(duel); Step(duel);
        Assert.DoesNotContain("player", duel.Result!.WinnerBotIds);
        Assert.Equal(1, Row(duel, "player").Score);
        Assert.True(Row(duel, "player").Forfeited);
        Assert.Equal(0, Row(duel, "player").Deaths);
        Assert.Equal(0, Row(duel, "third").Score);
    }

    [Fact]
    public void LastEligibleParticipantWinsEvenWhileWaitingForRespawn()
    {
        var duel = new Duel(Config());
        Step(duel, ("opponent", Idle with { Shoot = true }));
        duel.ForfeitAll(["opponent", "third", "fourth"]);
        Assert.Equal("player", duel.Result!.WinnerBotId);
        Assert.Equal(MatchEndReason.BotError, duel.Result.Reason);
        Assert.False(Row(duel, "player").Alive);
    }

    [Fact]
    public void AllForfeitedHasNoWinner()
    {
        var config = Config();
        var duel = new Duel(config);
        duel.ForfeitAll(config.Spawns.Select(spawn => spawn.Id));
        Assert.Empty(duel.Result!.WinnerBotIds);
        Assert.Null(duel.Result.WinnerBotId);
    }

    [Fact]
    public void WinningTickDoesNotCreateMoreItemsOrRespawnBots()
    {
        var config = Config();
        var duel = new Duel(config with
        {
            TickRate = 1, Deathmatch = config.Deathmatch! with { ScoreLimit = 1 },
            Consumables = new() { Enabled = true, InitialCount = 0, MinSpawnSeconds = 1, MaxSpawnSeconds = 1 },
        });
        Step(duel, ("player", Idle with { Shoot = true }));
        Assert.Equal(MatchEndReason.ScoreLimit, duel.Result!.Reason);
        Assert.Empty(duel.CaptureFrame().Items);
        Assert.DoesNotContain(duel.CaptureFrame().Events, e => e.Type == GameEventType.BotRespawned);
    }

    [Fact]
    public void SameSeedAndCommandsProduceSameRespawnChoice()
    {
        var config = HiddenSpawnConfig();
        config = config with { Deathmatch = config.Deathmatch! with { RespawnPoints = [.. config.Deathmatch.RespawnPoints, Point("other-hidden", 2, 10)] } };
        var first = new Duel(config);
        var second = new Duel(config with { Spawns = config.Spawns.Reverse().ToArray(),
            Deathmatch = config.Deathmatch! with { RespawnPoints = config.Deathmatch.RespawnPoints.Reverse().ToArray() } });
        Step(first, ("opponent", Idle with { Shoot = true }));
        Step(second, ("opponent", Idle with { Shoot = true }));
        for (var i = 0; i < 3; i++) { Step(first); Step(second); }
        Assert.Equal(first.Bot("player").Position, second.Bot("player").Position);
        Assert.True(Row(first, "player").Alive);
    }

    [Fact]
    public void StrategyMemorySurvivesRespawnAndDeadTicksAreSkipped()
    {
        var config = HiddenSpawnConfig() with { MaxTicks = 8 };
        using var player = StrategyLanguages.Create("javascript", """
            let calls = 0;
            function tick(s) {
              if (s.deathmatch.standings.length !== 4 || s.allies.length) throw new Error('bad observation');
              console.log(++calls);
              return {};
            }
            """);
        using var opponent = StrategyLanguages.Create("javascript", "function tick(s) { return { shoot: s.tick === 0 }; }");
        using var idle = StrategyLanguages.Create("javascript", "function tick() { return {}; }");
        var response = Match.Run(config, new Dictionary<string, IBotRuntime>
            { ["player"] = player, ["opponent"] = opponent, ["third"] = idle, ["fourth"] = idle });
        Assert.Null(response.Error);
        Assert.Equal(MatchMode.Deathmatch, response.Replay.Mode);
        Assert.Contains(response.Logs!, log => log.Tick == 4 && log.Message == "2");
        Assert.DoesNotContain(response.Logs!, log => log.Tick is > 0 and < 4);
    }

    [Fact]
    public void ForfeitedPlayersProjectilesStillResolveButCannotWin()
    {
        var config = Config();
        var duel = new Duel(config with
        {
            MaxTicks = 8, MortarMinFlightSeconds = .2,
            Spawns = config.Spawns.Select(s => s.Id == "player" ? s with { Weapon = WeaponType.Mortar } : s).ToArray(),
        });
        Step(duel, ("player", Idle with { Shoot = true, TargetPoint = new(12, 8) }));
        duel.Forfeit("player");
        for (var i = 1; i < 8; i++) Step(duel);
        Assert.Equal(1, Row(duel, "player").Kills);
        Assert.Equal(1, Row(duel, "third").Deaths);
        Assert.DoesNotContain("player", duel.Result!.WinnerBotIds);
    }

    [Theory]
    [InlineData(4)]
    [InlineData(5)]
    [InlineData(6)]
    public void CustomMatchDefaultsSupportEveryRosterSize(int count)
    {
        var positions = new Vec2[] { new(2, 2), new(14, 2), new(14, 8), new(2, 8), new(8, 1), new(8, 9) };
        var spawns = positions.Take(count).Select((point, i) =>
            new CustomMatchSpawn(i == 0 ? "player" : $"bot-{i}", i == 0 ? "player" : $"bot-{i}", point.X, point.Y)).ToArray();
        var config = CustomMatchConfiguration.Create(new(new(16, 10, []), spawns, [], Mode: MatchMode.Deathmatch), 42);
        Assert.Equal(2400, config.MaxTicks);
        Assert.False(config.ShrinkZoneEnabled);
        var duel = new Duel(config);
        Assert.Equal(count, duel.Observe("player").Deathmatch!.Standings.Count);
    }

    [Fact]
    public async Task FullDeathmatchCompletesInTheBoundedWorker()
    {
        var spawns = new CustomMatchSpawn[] { new("player", "player", 2, 3), new("opponent", "opponent", 4, 3),
            new("third", "third", 10, 8), new("fourth", "fourth", 14, 8) };
        var loadouts = spawns.Select(spawn => new CustomMatchLoadout(spawn.Id, "code", Code: spawn.Id == "player"
            ? "function tick(s) { return { shoot: s.self.canShoot }; }" : "function tick() { return {}; }")).ToArray();
        var spec = new CustomMatchSpec(new(16, 10, []), spawns, loadouts, Mode: MatchMode.Deathmatch);
        var result = await MatchWorker.RunAsync(new(null, Language: "javascript", CustomMatch: spec), CancellationToken.None);
        Assert.Null(result.Error);
        Assert.NotNull(result.Response);
        Assert.Null(result.Response.Error);
        Assert.Equal(MatchMode.Deathmatch, result.Response.Replay.Mode);
        Assert.Equal(MatchEndReason.TimeLimit, result.Response.Replay.Result.Reason);
        Assert.Equal(2400, result.Response.Replay.Result.DurationTicks);
        Assert.Equal("player", result.Response.Replay.Result.WinnerBotId);
        Assert.Equal(1, result.Response.Replay.Result.Standings.Single(row => row.BotId == "player").Score);
    }

    [Fact]
    public void InvalidRosterRulesAndSpawnPoolsAreRejected()
    {
        var config = Config();
        Assert.Throws<ArgumentException>(() => new Duel(config with { Spawns = config.Spawns.Take(3).ToArray() }));
        Assert.Throws<ArgumentException>(() => new Duel(config with { Spawns = config.Spawns.Select(s => s with { TeamId = "same" }).ToArray() }));
        Assert.Throws<ArgumentException>(() => new Duel(config with { Deathmatch = null }));
        Assert.Throws<ArgumentException>(() => new Duel(config with { Deathmatch = config.Deathmatch! with { ScoreLimit = 0 } }));
        Assert.Throws<ArgumentException>(() => new Duel(config with { Deathmatch = config.Deathmatch! with { RespawnSeconds = double.NaN } }));
        Assert.Throws<ArgumentException>(() => new Duel(config with { Deathmatch = config.Deathmatch! with { RespawnPoints = [] } }));
        Assert.Throws<ArgumentException>(() => new Duel(config with { Deathmatch = config.Deathmatch! with { RespawnPoints = [Point("edge", .1, .1), .. config.Deathmatch.RespawnPoints] } }));
        Assert.Throws<ArgumentException>(() => new Duel(config with { Deathmatch = config.Deathmatch! with { RespawnPoints = [config.Deathmatch.RespawnPoints[0], .. config.Deathmatch.RespawnPoints] } }));
    }
}
