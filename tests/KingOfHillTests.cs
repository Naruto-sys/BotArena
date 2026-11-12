using System.Text.Json;
using Xunit;

namespace BotArena.Tests;

public class KingOfHillTests
{
    private static readonly BotAction Idle = new(0, 0, default, false);
    private static MatchConfig Config(bool teams = false) => MatchConfig.Classic with
    {
        Mode = MatchMode.KingOfHill,
        KingOfHill = new(new(new(8, 5), 2)),
        Arena = new(16, 10, []), MaxTicks = 2400,
        // Keep shrinking enabled here to verify the mode overrides it.
        ShrinkStartSeconds = 0, ShrinkDurationSeconds = 0.1,
        Spawns = teams
            ? [Spawn("player", 5.8, 4, "player"), Spawn("player-2", 5.8, 6, "player"),
                Spawn("opponent", 10.2, 4, "opponent"), Spawn("opponent-2", 10.2, 6, "opponent")]
            : [Spawn("player", 5.8, 5, "player"), Spawn("opponent", 10.2, 5, "opponent")],
    };

    private static BotSpawn Spawn(string id, double x, double y, string team) =>
        new(id, new(x, y), team == "player" ? 0 : Math.PI, team == "player" ? 0 : Math.PI, team)
            { Movement = new TestMovement() };

    private sealed class TestMovement : IMovementModel
    {
        public string Id => "tracked";
        public BotMotion Propose(BotMotion current, BotAction action, Vec2 position, double seconds, bool canRotate) =>
            current with { Velocity = action.Thrust * (1 / seconds), Speed = Math.Sqrt(action.Thrust.Dot(action.Thrust)) / seconds };
    }

    private static void Step(Duel duel, params (string Id, BotAction Action)[] overrides)
    {
        var actions = duel.CaptureFrame().Bots.Where(bot => bot.Hp > 0 && !bot.Forfeited)
            .ToDictionary(bot => bot.Id, _ => Idle);
        foreach (var (id, action) in overrides) actions[id] = action;
        duel.Step(actions);
    }

    private static KingOfHillState Hill(Duel duel) => Assert.IsType<KingOfHillState>(duel.CaptureFrame().KingOfHill);
    private static double Score(Duel duel, string team = "player") => Hill(duel).Scores.Single(s => s.TeamId == team).Score;

    [Fact]
    public void EmptyZoneDoesNotScoreAndShrinkingIsDisabled()
    {
        var duel = new Duel(Config() with { MaxTicks = 40 });
        for (var i = 0; i < 40; i++) Step(duel);
        Assert.All(Hill(duel).Scores, score => Assert.Equal(0, score.Score));
        Assert.All(duel.CaptureFrame().Bots, bot => Assert.Equal(100, bot.Hp));
        Assert.Null(duel.CaptureFrame().SafeZone);
        Assert.Equal(MatchEndReason.TimeLimit, duel.Result!.Reason);
        Assert.Null(duel.Result.WinnerTeamId);
    }

    [Fact]
    public void OneSecondOfControlGivesOnePointAndLeavingStopsScoring()
    {
        var duel = new Duel(Config());
        Step(duel, ("player", Idle with { Thrust = new(1, 0) }));
        for (var i = 1; i < 20; i++) Step(duel);
        Assert.Equal(1, Score(duel));
        Assert.Equal("player", Hill(duel).ControllingTeamId);
        Assert.Contains(duel.CaptureFrame().Events, e => e.Type == GameEventType.ControlScoreChanged && e.Amount == 1);
        Step(duel, ("player", Idle with { Thrust = new(-1, 0) }));
        Step(duel);
        Assert.Equal(1, Score(duel));
        Assert.Null(Hill(duel).ControllingTeamId);
    }

    [Fact]
    public void TwoAlliesDoNotAccelerateScoring()
    {
        var duel = new Duel(Config(teams: true));
        Step(duel, ("player", Idle with { Thrust = new(1, 0) }), ("player-2", Idle with { Thrust = new(1, 0) }));
        for (var i = 1; i < 20; i++) Step(duel);
        Assert.Equal(1, Score(duel));
        Assert.False(Hill(duel).Contested);
    }

    [Fact]
    public void ContestedZonePausesAndControlResumesWhenEnemyLeaves()
    {
        var duel = new Duel(Config());
        Step(duel, ("player", Idle with { Thrust = new(1, 0) }), ("opponent", Idle with { Thrust = new(-1, 0) }));
        for (var i = 0; i < 20; i++) Step(duel);
        Assert.True(Hill(duel).Contested);
        Assert.All(Hill(duel).Scores, s => Assert.Equal(0, s.Score));
        Step(duel, ("opponent", Idle with { Thrust = new(1, 0) }));
        Assert.Equal(0.05, Score(duel));
        Assert.Equal("player", Hill(duel).ControllingTeamId);
        Assert.Contains(duel.CaptureFrame().Events, e => e.Type == GameEventType.ControlChanged && e.TeamId == "player");
    }

    [Fact]
    public void ZoneIncludesItsBoundaryAndChecksTheTankCenter()
    {
        var duel = new Duel(Config());
        Step(duel, ("player", Idle with { Thrust = new(0.2, 0) }));
        Assert.Equal(0.05, Score(duel));
        Step(duel, ("player", Idle with { Thrust = new(-0.01, 0) }));
        Assert.Equal(0.05, Score(duel));
    }

    [Fact]
    public void ReachingScoreLimitWinsWithoutDestroyingTheOtherTeam()
    {
        var config = Config() with { KingOfHill = Config().KingOfHill! with { ScoreLimit = 1 } };
        var duel = new Duel(config);
        Step(duel, ("player", Idle with { Thrust = new(1, 0) }));
        for (var i = 1; i < 20; i++) Step(duel);
        Assert.Equal(MatchEndReason.ScoreLimit, duel.Result!.Reason);
        Assert.Equal("player", duel.Result.WinnerTeamId);
        Assert.All(duel.CaptureFrame().Bots, bot => Assert.True(bot.Hp > 0));
        Assert.Equal(1, duel.Result.Scores.Single(s => s.TeamId == "player").Score);
    }

    [Fact]
    public void WinningTickDoesNotSpawnMoreConsumables()
    {
        var config = Config();
        var duel = new Duel(config with
        {
            TickRate = 1, KingOfHill = config.KingOfHill! with { ScoreLimit = 1 },
            Consumables = new() { Enabled = true, InitialCount = 0, MinSpawnSeconds = 1, MaxSpawnSeconds = 1 },
        });
        Step(duel, ("player", Idle with { Thrust = new(1, 0) }));
        Assert.Equal(MatchEndReason.ScoreLimit, duel.Result!.Reason);
        Assert.Empty(duel.CaptureFrame().Items);
        Assert.DoesNotContain(duel.CaptureFrame().Events, e => e.Type == GameEventType.ItemSpawned);
    }

    [Fact]
    public void TimeLimitUsesControlScore()
    {
        var duel = new Duel(Config() with { MaxTicks = 10 });
        Step(duel, ("opponent", Idle with { Thrust = new(-1, 0) }));
        for (var i = 1; i < 10; i++) Step(duel);
        Assert.Equal("opponent", duel.Result!.WinnerTeamId);
        Assert.Equal(MatchEndReason.TimeLimit, duel.Result.Reason);
        Assert.Equal(0.5, Score(duel, "opponent"));
    }

    [Fact]
    public void EqualNonzeroControlScoresAreADraw()
    {
        var duel = new Duel(Config() with { MaxTicks = 5 });
        Step(duel, ("player", Idle with { Thrust = new(1, 0) }));
        Step(duel, ("player", Idle with { Thrust = new(-1, 0) }), ("opponent", Idle with { Thrust = new(-1, 0) }));
        Step(duel, ("opponent", Idle with { Thrust = new(1, 0) }));
        Step(duel); Step(duel);
        Assert.Null(duel.Result!.WinnerTeamId);
        Assert.All(duel.Result.Scores, score => Assert.Equal(0.05, score.Score));
    }

    [Fact]
    public void LethalDamageIsResolvedBeforeControlAndDoesNotEndMatch()
    {
        var original = Config();
        var duel = new Duel(original with
        {
            Spawns = original.Spawns.Select(spawn => spawn with { Weapon = WeaponType.Gauss }).ToArray(), GaussDamage = 100,
        });
        Step(duel, ("player", Idle with { Thrust = new(1, 0) }));
        Step(duel, ("opponent", Idle with { Shoot = true }));
        Assert.Equal(0, duel.Bot("player").Hp);
        Assert.Equal(0.05, Score(duel));
        Assert.Equal(0, Score(duel, "opponent"));
        Assert.Null(duel.Result);
        Assert.Equal(5, Assert.Single(Hill(duel).Respawns).SecondsRemaining);
    }

    [Fact]
    public void SimultaneousDeathsWaitForRespawnsRatherThanEndingMatch()
    {
        var config = Config();
        var duel = new Duel(config with
        {
            Spawns = config.Spawns.Select(spawn => spawn with { Weapon = WeaponType.Gauss }).ToArray(), GaussDamage = 100,
            KingOfHill = config.KingOfHill! with { RespawnSeconds = 0.15 },
        });
        Step(duel, ("player", Idle with { Shoot = true }), ("opponent", Idle with { Shoot = true }));
        Assert.All(duel.CaptureFrame().Bots, bot => Assert.Equal(0, bot.Hp));
        Assert.Null(duel.Result);
        Step(duel); Step(duel);
        Assert.All(duel.CaptureFrame().Bots, bot => Assert.Equal(0, bot.Hp));
        Step(duel);
        Assert.All(duel.CaptureFrame().Bots, bot => { Assert.Equal(100, bot.Hp); Assert.True(bot.CanShoot); });
        Assert.Equal(2, duel.CaptureFrame().Events.Count(e => e.Type == GameEventType.BotRespawned));
        Assert.Empty(Hill(duel).Respawns);
        Assert.Null(duel.Result);
    }

    [Fact]
    public void BlockedSpawnWaitsAndRetriesWithoutResettingDelay()
    {
        var config = Config();
        var duel = new Duel(config with
        {
            Spawns = config.Spawns.Select(spawn => spawn with { Weapon = WeaponType.Gauss }).ToArray(), GaussDamage = 100,
            KingOfHill = config.KingOfHill! with { RespawnSeconds = 0.1 },
        });
        Step(duel, ("opponent", Idle with { Shoot = true }));
        Step(duel, ("opponent", Idle with { Thrust = new(-4.4, 0) }));
        Step(duel);
        Assert.Equal(0, duel.Bot("player").Hp);
        Assert.True(Assert.Single(Hill(duel).Respawns).WaitingForSpace);
        Step(duel, ("opponent", Idle with { Thrust = new(4.4, 0) }));
        Assert.Equal(100, duel.Bot("player").Hp);
        Assert.Equal(config.Spawns[0].Position, duel.Bot("player").Position);
    }

    [Fact]
    public void RespawnRestoresWeaponAndClearsConsumablesAndMotion()
    {
        var config = Config();
        var duel = new Duel(config with
        {
            Spawns = config.Spawns.Select(spawn => spawn with
                { Weapon = WeaponType.Gauss, Hp = spawn.Id == "player" ? 100 : 500 }).ToArray(), GaussDamage = 200,
            KingOfHill = config.KingOfHill! with { RespawnSeconds = 0.1 },
            Consumables = new() { Enabled = true, InitialCount = 0, MinSpawnSeconds = 100, MaxSpawnSeconds = 100 },
            InitialItems = [new(ConsumableType.Shield, config.Spawns[0].Position)],
        });
        Step(duel);
        Step(duel, ("player", Idle with { UseItem = ConsumableType.Shield, Shoot = true }));
        Assert.Equal(40, duel.Bot("player").ShieldHp);
        Step(duel, ("opponent", Idle with { Shoot = true }));
        Step(duel); Step(duel);
        var bot = duel.Bot("player");
        Assert.Equal(100, bot.Hp);
        Assert.Equal(WeaponChargeStage.Ready, bot.ChargeStage);
        Assert.Equal(1, bot.ChargeProgress);
        Assert.Equal(0, bot.ReloadingTime);
        Assert.Equal(default, bot.Velocity);
        Assert.Equal(0, bot.Speed);
        Assert.Equal(0, bot.ShieldHp);
        Assert.Empty(bot.Inventory);
        Assert.Empty(bot.ActiveEffects);
    }

    [Fact]
    public void PosthumousMortarStillDamagesButKillsGiveNoControlPoints()
    {
        var config = Config();
        var duel = new Duel(config with
        {
            Spawns = [config.Spawns[0] with { Weapon = WeaponType.Mortar }, config.Spawns[1] with { Weapon = WeaponType.Gauss }],
            MortarSpeed = 100, MortarMinFlightSeconds = 0.1, MortarDamage = 100, GaussDamage = 100,
        });
        Step(duel, ("player", Idle with { Shoot = true, TargetPoint = config.Spawns[1].Position }),
            ("opponent", Idle with { Shoot = true }));
        Step(duel); Step(duel);
        Assert.All(duel.CaptureFrame().Bots, bot => Assert.Equal(0, bot.Hp));
        Assert.All(Hill(duel).Scores, s => Assert.Equal(0, s.Score));
        Assert.Null(duel.Result);
    }

    [Fact]
    public void StrategyMemorySurvivesAndDeadBotsAreNotCalled()
    {
        var config = Config();
        config = config with
        {
            MaxTicks = 8, GaussDamage = 100,
            Spawns = config.Spawns.Select(spawn => spawn with { Weapon = WeaponType.Gauss }).ToArray(),
            KingOfHill = config.KingOfHill! with { RespawnSeconds = 0.15 },
        };
        using var player = StrategyLanguages.Create("javascript", """
            let calls = 0;
            function tick(state) {
              if (!state.kingOfHill || !state.allies) throw new Error('missing mode observation');
              console.log(++calls);
              return {};
            }
            """);
        using var enemy = StrategyLanguages.Create("javascript", "function tick(s) { return { shoot: s.tick === 0 }; }");
        var response = Match.Run(config, player, enemy);
        Assert.Null(response.Error);
        Assert.Equal(MatchMode.KingOfHill, response.Replay.Mode);
        Assert.Contains(response.Logs!, log => log.Tick == 4 && log.Message == "2");
        Assert.DoesNotContain(response.Logs!, log => log.Tick is > 0 and < 4);
        var json = JsonSerializer.Serialize(response.Replay, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.Contains("\"kingOfHill\"", json);
        Assert.Contains("\"scores\"", json);
    }

    [Fact]
    public void OneFailedAllyDoesNotEliminateTeamButFailedBotsNeverRespawn()
    {
        var duel = new Duel(Config(teams: true));
        duel.Forfeit("player");
        Assert.Null(duel.Result);
        for (var i = 0; i < 101; i++) Step(duel);
        Assert.True(duel.Bot("player").Forfeited);
        Assert.DoesNotContain(Hill(duel).Respawns, r => r.BotId == "player");
        duel.Forfeit("player-2");
        Assert.Equal("opponent", duel.Result!.WinnerTeamId);
        Assert.Equal(MatchEndReason.BotError, duel.Result.Reason);
    }

    [Fact]
    public void AlliedVisionIncludesOnlyLivingObserversAndRedactsEnemyInventory()
    {
        var config = Config(teams: true) with
        {
            Arena = new(16, 10, [new(7, 3, 0.5, 0.5)]),
            KingOfHill = new(new(new(8, 7), 1)),
            Spawns = [Spawn("player", 4, 3, "player"), Spawn("player-2", 4, 6, "player"),
                Spawn("opponent", 12, 3, "opponent"), Spawn("opponent-2", 12, 6, "opponent")],
        };
        var duel = new Duel(config);
        Assert.Contains(duel.Observe("player").Enemies, bot => bot.Id == "opponent");
        Assert.Single(duel.Observe("player").Allies);
        Assert.All(duel.Observe("player").Enemies, bot => Assert.Empty(bot.Inventory));
        duel.Forfeit("player-2");
        Assert.DoesNotContain(duel.Observe("player").Enemies, bot => bot.Id == "opponent");
    }

    [Fact]
    public void CustomMatchUsesModeDefaultsAndPresetsCanReachTheHill()
    {
        var spec = new CustomMatchSpec(new(16, 10, [new(3.5, 3.2, 1, 3.6), new(11.5, 3.2, 1, 3.6)]),
            [new("player", "player", 2.2, 5), new("opponent", "opponent", 13.8, 5, Math.PI, Math.PI)],
            [new("player", "preset", "assault"), new("opponent", "preset", "blind-afraid")], Mode: MatchMode.KingOfHill);
        var config = CustomMatchConfiguration.Create(spec, 42);
        Assert.Equal(2400, config.MaxTicks);
        Assert.False(config.ShrinkZoneEnabled);
        using var player = StrategyLanguages.Create("javascript", BehaviorPresets.GetCode("assault"));
        using var opponent = StrategyLanguages.Create("javascript", "function tick() { return {}; }");
        var response = Match.Run(config, player, opponent);
        Assert.Null(response.Error);
        Assert.True(response.Replay.Result.WinnerTeamId == "player",
            JsonSerializer.Serialize(new { response.Replay.Result, Last = response.Replay.Frames[^1].Bots,
                Trail = response.Replay.Frames.Where(f => f.Tick % 200 == 0).Select(f => f.Bots[0].Position) }));
        Assert.Equal(MatchEndReason.ScoreLimit, response.Replay.Result.Reason);
    }

    [Fact]
    public async Task FourBotControlMatchRunsInTheBoundedWorker()
    {
        var spawns = new[]
        {
            new CustomMatchSpawn("player", "player", 2.2, 4),
            new CustomMatchSpawn("player-2", "player", 2.2, 6),
            new CustomMatchSpawn("opponent", "opponent", 13.8, 4, Math.PI, Math.PI),
            new CustomMatchSpawn("opponent-2", "opponent", 13.8, 6, Math.PI, Math.PI),
        };
        var spec = new CustomMatchSpec(new(16, 10, [new(3.5, 3.2, 1, 3.6), new(11.5, 3.2, 1, 3.6)]), spawns,
            spawns.Select(spawn => new CustomMatchLoadout(spawn.Id, "preset", "assault")).ToArray(), Mode: MatchMode.KingOfHill);
        var result = await MatchWorker.RunAsync(new(null, Language: "javascript", CustomMatch: spec), CancellationToken.None);
        Assert.Null(result.Error);
        Assert.NotNull(result.Response);
        Assert.Null(result.Response.Error);
        Assert.Equal(MatchMode.KingOfHill, result.Response.Replay.Mode);
        Assert.Equal(2, result.Response.Replay.Result.Scores.Count);
        Assert.True(result.Response.Replay.Frames.Count > 600);
    }

    [Fact]
    public void InvalidZoneAndUnsupportedRostersAreRejected()
    {
        var config = Config();
        Assert.Throws<ArgumentException>(() => new Duel(config with { KingOfHill = null }));
        Assert.Throws<ArgumentException>(() => new Duel(config with { KingOfHill = new(new(new(0, 5), 2)) }));
        Assert.Throws<ArgumentException>(() => new Duel(config with { KingOfHill = new(new(new(8, 5), double.NaN)) }));
        Assert.Throws<ArgumentException>(() => new Duel(config with { KingOfHill = config.KingOfHill! with { RespawnSeconds = 0 } }));
        Assert.Throws<ArgumentException>(() => new Duel(config with { Arena = new(16, 10, [new(7.5, 4.5, 1, 1)]) }));
        Assert.Throws<ArgumentException>(() => new Duel(config with { Spawns = [config.Spawns[0], config.Spawns[1] with { TeamId = "player" }] }));
    }
}
