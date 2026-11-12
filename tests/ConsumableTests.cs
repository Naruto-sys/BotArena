using System.Text.Json;
using Xunit;

namespace BotArena.Tests;

public class ConsumableTests
{
    private static readonly BotAction Idle = new(0, 0, default, false);
    private static ConsumableRules Rules => new()
    {
        Enabled = true, InitialCount = 0, MinSpawnSeconds = 100, MaxSpawnSeconds = 100
    };
    private static MatchConfig Config => MatchConfig.Classic with
    {
        Arena = new(24, 12, []), Consumables = Rules, RandomSeed = 123,
        Spawns = [new("player", new(2, 5), 0, 0), new("opponent", new(20, 5), Math.PI, Math.PI)]
    };

    [Fact]
    public void SameSeedReproducesRandomPositionsTypesAndSpawnTimes()
    {
        var config = Config with { Consumables = new() { Enabled = true } };
        var first = new Duel(config);
        var second = new Duel(config);
        Assert.Equal(3, first.CaptureFrame().Items.Count);
        Assert.Equal(3, first.CaptureFrame().Events.Count(item => item.Type == GameEventType.ItemSpawned));
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        while (first.Result is null)
        {
            Assert.Equal(JsonSerializer.Serialize(first.CaptureFrame(), options), JsonSerializer.Serialize(second.CaptureFrame(), options));
            Step(first);
            Step(second);
        }
        var other = new Duel(config with { RandomSeed = 124 });
        Assert.NotEqual(first.CaptureFrame().Items[0].Position, other.CaptureFrame().Items[0].Position);
        Assert.Equal(6, first.CaptureFrame().Items.Count);
    }

    [Fact]
    public void RandomSpawnsRespectIntervalsCapacityWallsTankClearanceAndAllowedTypes()
    {
        var config = Config with
        {
            Arena = Config.Arena with { Walls = [new(8, 2, 2, 8)] },
            Consumables = Rules with { MinSpawnSeconds = 0.1, MaxSpawnSeconds = 0.2, MaxOnField = 4, AllowedTypes = [ConsumableType.Repair] }
        };
        var duel = new Duel(config);
        var spawnTicks = new List<int>();
        for (var step = 0; step < 40; step++)
        {
            Step(duel);
            spawnTicks.AddRange(duel.CaptureFrame().Events.Where(item => item.Type == GameEventType.ItemSpawned).Select(item => item.Tick));
            Assert.InRange(duel.CaptureFrame().Items.Count, 0, 4);
        }
        Assert.Equal(4, spawnTicks.Count);
        Assert.InRange(spawnTicks[0], 2, 4);
        Assert.All(spawnTicks.Zip(spawnTicks.Skip(1)), pair => Assert.InRange(pair.Second - pair.First, 2, 4));
        foreach (var item in duel.CaptureFrame().Items)
        {
            Assert.Equal(ConsumableType.Repair, item.Type);
            Assert.InRange(item.Position.X, 0.49, 23.51);
            Assert.InRange(item.Position.Y, 0.49, 11.51);
            Assert.False(item.Position.X >= 7.5 && item.Position.X <= 10.5 && item.Position.Y >= 1.5 && item.Position.Y <= 10.5);
            Assert.All(duel.CaptureFrame().Bots, bot => Assert.True((bot.Position - item.Position).Dot(bot.Position - item.Position) > 1));
        }
        Assert.Equal(4, duel.CaptureFrame().Items.Select(item => item.Id).Distinct().Count());
    }

    [Fact]
    public void BlockedMapSkipsSpawnsWithoutStalling()
    {
        var duel = new Duel(Config with
        {
            Arena = new(24, 12, [new(0, 0, 24, 12)]),
            Consumables = Rules with { InitialCount = 3, MinSpawnSeconds = 0.05, MaxSpawnSeconds = 0.05 }
        });
        while (duel.Result is null) Step(duel);
        Assert.Empty(duel.CaptureFrame().Items);
        Assert.Equal(MatchEndReason.TimeLimit, duel.Result.Reason);
    }

    [Fact]
    public void PickupIsAutomaticButCannotBeUsedUntilTheNextDecision()
    {
        var duel = WithItem(ConsumableType.Shield);
        Step(duel, Idle with { UseItem = ConsumableType.Shield });
        Assert.Equal(new[] { ConsumableType.Shield }, duel.Observe("player").Self.Inventory);
        Assert.Equal(0, duel.Observe("player").Self.ShieldHp);
        Assert.Empty(duel.CaptureFrame().Items);
        Assert.Single(duel.CaptureFrame().Events, item => item.Type == GameEventType.ItemPickedUp);
        Step(duel, Idle with { UseItem = ConsumableType.Shield });
        Assert.Empty(duel.Observe("player").Self.Inventory);
        Assert.Equal(40, duel.Observe("player").Self.ShieldHp);
        Assert.Single(duel.Observe("player").Self.ActiveEffects);
    }

    [Fact]
    public void FullInventoryLeavesTheItemOnTheGroundAndUsingOneFreesASlot()
    {
        var duel = new Duel(Config with
        {
            Consumables = Rules with { InventoryCapacity = 1 },
            InitialItems = [new(ConsumableType.Shield, new(1.4, 5)), new(ConsumableType.Coolant, new(2.6, 5))]
        });
        Step(duel);
        Assert.Equal(new[] { ConsumableType.Shield }, duel.Observe("player").Self.Inventory);
        Assert.Single(duel.CaptureFrame().Items);
        Step(duel, Idle with { UseItem = ConsumableType.Shield });
        Assert.Equal(new[] { ConsumableType.Coolant }, duel.Observe("player").Self.Inventory);
        Assert.Empty(duel.CaptureFrame().Items);
    }

    [Fact]
    public void ClosestEligibleTankWinsAndTiesAreIndependentOfSpawnOrder()
    {
        MatchConfig Contested(int seed) => Config with
        {
            RandomSeed = seed,
            Spawns = [new("player", new(5, 5), 0, 0), new("opponent", new(6, 5), Math.PI, Math.PI)],
            InitialItems = [new(ConsumableType.Repair, new(5.5, 5))]
        };
        var winners = new HashSet<string>();
        for (var seed = 1; seed <= 20; seed++)
        {
            var config = Contested(seed);
            var first = new Duel(config);
            var reversed = new Duel(config with { Spawns = config.Spawns.Reverse().ToArray() });
            Step(first);
            Step(reversed);
            var winner = first.CaptureFrame().Bots.Single(bot => bot.Inventory.Count == 1).Id;
            Assert.Equal(winner, reversed.CaptureFrame().Bots.Single(bot => bot.Inventory.Count == 1).Id);
            winners.Add(winner);
        }
        Assert.Equal(2, winners.Count);
        var nearer = new Duel(Contested(1) with { InitialItems = [new(ConsumableType.Repair, new(5.4, 5))] });
        Step(nearer);
        Assert.Single(nearer.Observe("player").Self.Inventory);
    }

    [Fact]
    public void ItemsCannotBePickedThroughWalls()
    {
        var duel = new Duel(Config with
        {
            Arena = Config.Arena with { Walls = [new(5.2, 4, 0.1, 2)] },
            Consumables = Rules with { PickupRadius = 2 },
            Spawns = [Config.Spawns[0] with { Position = new(4.5, 5) }, Config.Spawns[1]],
            InitialItems = [new(ConsumableType.Shield, new(6, 5))]
        });
        Step(duel);
        Assert.Empty(duel.Observe("player").Self.Inventory);
        Assert.Single(duel.CaptureFrame().Items);
    }

    [Fact]
    public void HiddenItemsAndEnemyInventoryDoNotLeakThroughObservations()
    {
        var hidden = new Duel(Config with
        {
            Arena = Config.Arena with { Walls = [new(12, 0, 1, 12)] },
            InitialItems = [new(ConsumableType.Shield, new(20, 6))]
        });
        Assert.Empty(hidden.Observe("player").Items);
        Assert.Single(hidden.Observe("opponent").Items);
        Assert.Single(hidden.CaptureFrame().Items);
        var visible = WithItem(ConsumableType.Shield);
        Step(visible);
        Assert.Single(visible.Observe("player").Self.Inventory);
        Assert.Empty(visible.Observe("opponent").Enemy!.Inventory);
        Assert.Single(visible.CaptureFrame().Bots.Single(bot => bot.Id == "player").Inventory);
    }

    [Theory]
    [InlineData(20, 100, 20)]
    [InlineData(60, 70, 30)]
    public void RepairRestoresHpUpToTheMaximum(int incomingDamage, int expectedHp, int repair)
    {
        var duel = WithItem(ConsumableType.Repair, Config with
        {
            GaussDamage = incomingDamage,
            Spawns = [Config.Spawns[0], Config.Spawns[1] with { Weapon = WeaponType.Gauss }]
        });
        Step(duel, opponent: Idle with { Shoot = true });
        Step(duel, Idle with { UseItem = ConsumableType.Repair });
        Assert.Equal(expectedHp, duel.Observe("player").Self.Hp);
        Assert.Empty(duel.Observe("player").Self.Inventory);
        Assert.Equal(repair, Assert.Single(duel.CaptureFrame().Events, item => item.Type == GameEventType.BotRepaired).Amount);
    }

    [Fact]
    public void RepairAtFullHpIsNotConsumedAndActivationPrecedesIncomingDamage()
    {
        var full = WithItem(ConsumableType.Repair);
        Step(full);
        Step(full, Idle with { UseItem = ConsumableType.Repair });
        Assert.Single(full.Observe("player").Self.Inventory);
        Assert.DoesNotContain(full.CaptureFrame().Events, item => item.Type == GameEventType.ItemUsed);
        var ordered = WithItem(ConsumableType.Repair, Config with
        {
            GaussCooldownTicks = 1,
            Spawns = [Config.Spawns[0], Config.Spawns[1] with { Weapon = WeaponType.Gauss }]
        });
        Step(ordered, opponent: Idle with { Shoot = true });
        Step(ordered, Idle with { UseItem = ConsumableType.Repair }, Idle with { Shoot = true });
        Assert.Equal(10, ordered.Observe("player").Self.Hp);
        Assert.Null(ordered.Result);
    }

    [Theory]
    [InlineData(WeaponType.Cannon, 100, 20)]
    [InlineData(WeaponType.Mortar, 100, 5)]
    [InlineData(WeaponType.Gauss, 80, 0)]
    public void ShieldAbsorbsAllWeaponsAndOverflowDamagesHp(WeaponType weapon, int hp, int shield)
    {
        var duel = WithItem(ConsumableType.Shield, Config with
        {
            BulletSpeed = 1000, MortarSpeed = 1000, MortarMinFlightSeconds = 0.05,
            Spawns = [Config.Spawns[0], Config.Spawns[1] with { Weapon = weapon }]
        });
        Step(duel);
        Step(duel, Idle with { UseItem = ConsumableType.Shield }, Idle with
        {
            Shoot = true, TargetPoint = weapon == WeaponType.Mortar ? new Vec2(2, 5) : null
        });
        if (weapon == WeaponType.Mortar) Step(duel);
        Assert.Equal(hp, duel.Observe("player").Self.Hp);
        Assert.Equal(shield, duel.Observe("player").Self.ShieldHp);
        var hit = Assert.Single(duel.CaptureFrame().Events, item => item.Type == GameEventType.BotHit);
        Assert.Equal(weapon == WeaponType.Gauss ? 40 : weapon == WeaponType.Mortar ? 35 : 20, hit.ShieldDamage);
        if (shield == 0) Assert.Empty(duel.Observe("player").Self.ActiveEffects);
    }

    [Fact]
    public void ShieldExpiresAndRepeatedActivationRefreshesWithoutStacking()
    {
        var expiry = WithItem(ConsumableType.Shield, Config with { Consumables = Rules with { ShieldDurationSeconds = 0.1 } });
        Step(expiry);
        Step(expiry, Idle with { UseItem = ConsumableType.Shield });
        Step(expiry);
        Assert.Equal(40, expiry.Observe("player").Self.ShieldHp);
        Step(expiry);
        Assert.Equal(0, expiry.Observe("player").Self.ShieldHp);
        Assert.Contains(expiry.CaptureFrame().Events, item => item.Type == GameEventType.EffectEnded);
        var refresh = new Duel(Config with
        {
            InitialItems = [new(ConsumableType.Shield, new(1.4, 5)), new(ConsumableType.Shield, new(2.6, 5))]
        });
        Step(refresh);
        Step(refresh, Idle with { UseItem = ConsumableType.Shield });
        AdvanceTo(refresh, 10);
        Step(refresh, Idle with { UseItem = ConsumableType.Shield });
        Assert.Equal(40, refresh.Observe("player").Self.ShieldHp);
        Assert.Equal(91, Assert.Single(refresh.Observe("player").Self.ActiveEffects).ExpiresAtTick);
    }

    [Fact]
    public void BoostCombinesWithSurfaceAndExpiresWithoutAnInstantSpeedReset()
    {
        var forward = Idle with { LeftTrack = 1, RightTrack = 1 };
        var duel = WithItem(ConsumableType.SpeedBoost, Config with { Consumables = Rules with { BoostDurationSeconds = 1 } });
        Step(duel);
        Step(duel, forward with { UseItem = ConsumableType.SpeedBoost });
        Assert.Equal(0.56, duel.Observe("player").Self.Speed, 8);
        AdvanceTo(duel, 21, forward);
        Assert.Equal(5.04, duel.Observe("player").Self.Speed, 8);
        Step(duel, forward);
        Assert.Equal(4.44, duel.Observe("player").Self.Speed, 8);
        Assert.Empty(duel.Observe("player").Self.ActiveEffects);
        var sand = WithItem(ConsumableType.SpeedBoost, Config with
        {
            Arena = Config.Arena with { Cells = Enumerable.Range(0, 24).Select(x => new ArenaCell(x, 5, SurfaceType.Sand)).ToArray() }
        });
        Step(sand);
        Step(sand, forward with { UseItem = ConsumableType.SpeedBoost });
        Assert.Equal(0.308, sand.Observe("player").Self.Speed, 8);
        AdvanceTo(sand, 30, forward);
        Assert.Equal(3.78, sand.Observe("player").Self.Speed, 8);
    }

    [Theory]
    [InlineData(WeaponType.Cannon, 8)]
    [InlineData(WeaponType.Mortar, 17)]
    [InlineData(WeaponType.Gauss, 27)]
    public void CoolantSpeedsReloadAndGaussCharge(WeaponType weapon, int secondShot)
    {
        var duel = WithItem(ConsumableType.Coolant, Config with
        {
            Spawns = [Config.Spawns[0] with { Weapon = weapon }, Config.Spawns[1]]
        });
        Step(duel);
        var shooting = Idle with { Shoot = true, TargetPoint = weapon == WeaponType.Mortar ? new Vec2(20, 5) : null };
        Step(duel, shooting with { UseItem = ConsumableType.Coolant });
        var launches = new List<int> { 2 };
        while (duel.CaptureFrame().Tick < secondShot)
        {
            Step(duel, shooting);
            if (duel.CaptureFrame().Events.Any(item => item.Type == GameEventType.ShotFired && item.SourceBotId == "player"))
                launches.Add(duel.CaptureFrame().Tick);
        }
        Assert.Equal(new[] { 2, secondShot }, launches);
        if (weapon == WeaponType.Gauss) Assert.InRange(duel.Observe("player").Self.ChargeProgress, 0, 1);
    }

    [Fact]
    public void CoolantAffectsTheCurrentCycleAndExpiryRestoresNormalRecovery()
    {
        var duel = WithItem(ConsumableType.Coolant, Config with
        {
            Consumables = Rules with { CoolantDurationSeconds = 0.1 },
            Spawns = [Config.Spawns[0] with { Weapon = WeaponType.Gauss }, Config.Spawns[1]]
        });
        Step(duel, Idle with { Shoot = true });
        Step(duel, Idle with { UseItem = ConsumableType.Coolant });
        Assert.Equal(47.0 / 20, duel.Observe("player").Self.ReloadingTime, 8);
        Step(duel);
        Step(duel);
        Assert.Equal(44.0 / 20, duel.Observe("player").Self.ReloadingTime, 8);
    }

    [Theory]
    [InlineData(1.9, true)]
    [InlineData(2, true)]
    [InlineData(2.1, false)]
    public void SmokeHasSymmetricLimitedSight(double distance, bool visible)
    {
        var duel = WithItem(ConsumableType.Smoke, Config with
        {
            Spawns = [Config.Spawns[0], Config.Spawns[1] with { Position = new(2 + distance, 5) }]
        });
        Step(duel);
        Step(duel, Idle with { UseItem = ConsumableType.Smoke });
        Assert.Equal(visible, duel.Observe("player").Enemy is not null);
        Assert.Equal(visible, duel.Observe("opponent").Enemy is not null);
        Assert.Single(duel.CaptureFrame().SmokeClouds);
    }

    [Theory]
    [InlineData(WeaponType.Cannon, 80)]
    [InlineData(WeaponType.Mortar, 65)]
    [InlineData(WeaponType.Gauss, 40)]
    public void SmokeDoesNotBlockWeaponsOrRevealHiddenEnemies(WeaponType weapon, int hp)
    {
        var duel = WithItem(ConsumableType.Smoke, Config with
        {
            BulletSpeed = 1000, MortarSpeed = 1000, MortarMinFlightSeconds = 0.05,
            Spawns = [Config.Spawns[0] with { Weapon = weapon }, Config.Spawns[1]]
        });
        Step(duel);
        Step(duel, Idle with
        {
            Shoot = true, UseItem = ConsumableType.Smoke, TargetPoint = weapon == WeaponType.Mortar ? new Vec2(20, 5) : null
        });
        if (weapon == WeaponType.Mortar) Step(duel);
        Assert.Equal(hp, duel.Observe("opponent").Self.Hp);
        Assert.Null(duel.Observe("player").Enemy);
    }

    [Fact]
    public void SmokeExpiresAndNeverFollowsItsOwner()
    {
        var duel = WithItem(ConsumableType.Smoke, Config with { Consumables = Rules with { SmokeDurationSeconds = 0.1 } });
        Step(duel);
        Step(duel, Idle with { UseItem = ConsumableType.Smoke, LeftTrack = 1, RightTrack = 1 });
        Assert.Equal(new Vec2(2, 5), Assert.Single(duel.CaptureFrame().SmokeClouds).Position);
        Assert.True(duel.Observe("player").Self.Position.X > 2);
        Assert.Null(duel.Observe("player").Enemy);
        Step(duel);
        Step(duel);
        Assert.Empty(duel.CaptureFrame().SmokeClouds);
        Assert.NotNull(duel.Observe("player").Enemy);
        Assert.Contains(duel.CaptureFrame().Events, item => item.Type == GameEventType.SmokeExpired);
    }

    [Fact]
    public void DestructionClearsInventoryAndPersonalEffectsBeforePickup()
    {
        var duel = new Duel(Config with
        {
            GaussDamage = 100,
            Spawns = [Config.Spawns[0], Config.Spawns[1] with { Weapon = WeaponType.Gauss }],
            InitialItems = [new(ConsumableType.SpeedBoost, new(1.4, 5)), new(ConsumableType.Shield, new(2.6, 5))]
        });
        Step(duel);
        Step(duel, Idle with { UseItem = ConsumableType.SpeedBoost }, Idle with { Shoot = true });
        var bot = duel.Observe("player").Self;
        Assert.Equal(0, bot.Hp);
        Assert.Empty(bot.Inventory);
        Assert.Empty(bot.ActiveEffects);
        Assert.Contains(duel.CaptureFrame().Events, item => item.Type == GameEventType.EffectEnded);
    }

    [Fact]
    public void MissingItemIsANoOpAndSnapshotsAndReplayRemainIndependent()
    {
        var duel = WithItem(ConsumableType.Shield);
        var before = duel.CaptureFrame();
        Step(duel, Idle with { UseItem = ConsumableType.Coolant });
        var pickedUp = duel.CaptureFrame();
        Step(duel, Idle with { UseItem = ConsumableType.Shield });
        Assert.Single(before.Items);
        Assert.Empty(before.Bots[0].Inventory);
        Assert.Single(pickedUp.Bots[0].Inventory);
        Assert.Empty(pickedUp.Bots[0].ActiveEffects);
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var json = JsonSerializer.Serialize(duel.CaptureFrame(), options);
        var decoded = JsonSerializer.Deserialize<GameFrame>(json, options)!;
        Assert.Equal(json, JsonSerializer.Serialize(decoded, options));
        using var bot = new JavaScriptBot("function tick() { return {}; }");
        using var other = new JavaScriptBot("function tick() { return {}; }");
        Assert.Equal(Config.RandomSeed, Match.Run(Config, bot, other).Replay.RandomSeed);
    }

    [Fact]
    public void InvalidSettingsAndPresetsAreRejected()
    {
        var invalid = new[]
        {
            Rules with { InventoryCapacity = 0 }, Rules with { MaxOnField = 0 }, Rules with { InitialCount = 7 },
            Rules with { MinSpawnSeconds = 2, MaxSpawnSeconds = 1 }, Rules with { MinSpawnSeconds = double.NaN },
            Rules with { PickupRadius = -1 }, Rules with { AllowedTypes = [] }, Rules with { AllowedTypes = [(ConsumableType)100] },
            Rules with { SpeedMultiplier = double.PositiveInfinity }, Rules with { ShieldDurationSeconds = 0 },
            Rules with { CooldownRecoveryTicks = 0 }, Rules with { SmokeVisibilityRange = 0 }
        };
        foreach (var rules in invalid) Assert.Throws<ArgumentException>(() => new Duel(Config with { Consumables = rules }));
        Assert.Throws<ArgumentException>(() => new Duel(Config with { InitialItems = [new(ConsumableType.Repair, new(-1, 5))] }));
        Assert.Throws<ArgumentException>(() => new Duel(Config with { InitialItems = [new(ConsumableType.Repair, new(2, 5)), new(ConsumableType.Shield, new(2, 5))] }));
    }

    private static Duel WithItem(ConsumableType type, MatchConfig? config = null) =>
        new((config ?? Config) with { InitialItems = [new(type, new(2, 5))] });

    private static void Step(Duel duel, BotAction? player = null, BotAction? opponent = null) =>
        duel.Step(new Dictionary<string, BotAction> { ["player"] = player ?? Idle, ["opponent"] = opponent ?? Idle });

    private static void AdvanceTo(Duel duel, int tick, BotAction? player = null)
    {
        while (duel.CaptureFrame().Tick < tick) Step(duel, player);
    }
}
