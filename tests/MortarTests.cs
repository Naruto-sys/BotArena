using System.Text.Json;
using Xunit;

namespace BotArena.Tests;

public class MortarTests
{
    private static readonly BotAction Idle = new(0, 0, default, false);
    private static readonly Vec2 EnemyPosition = new(14, 5);
    private static MatchConfig Config => MatchConfig.Classic with
    {
        Arena = new(16, 10, [new Wall(7, 0, 1, 10)]),
        Spawns = [new("player", new(2, 5), 0, Math.PI, WeaponType.Mortar),
            new("opponent", EnemyPosition, Math.PI, Math.PI)]
    };

    [Theory]
    [InlineData(10)]
    [InlineData(20)]
    [InlineData(40)]
    public void ShellCrossesWallsAndHitsOnlyAtItsScheduledLanding(int tickRate)
    {
        var duel = new Duel(Config with { TickRate = tickRate });
        Assert.Null(duel.Observe("player").Enemy);
        Assert.Equal(WeaponType.Mortar, duel.Observe("player").Self.Weapon);
        Step(duel, Shot(EnemyPosition));
        var shell = Assert.Single(duel.CaptureFrame().Bullets);
        Assert.Equal(WeaponType.Mortar, shell.Weapon);
        Assert.Equal(new Vec2(2, 5), shell.Position);
        Assert.Equal(new Vec2(1, 0), shell.Direction); // The turret points the other way.
        Assert.Equal(1 + 3 * tickRate, shell.ImpactTick);
        Assert.Equal(EnemyPosition, shell.TargetPoint);
        Assert.Contains(duel.CaptureFrame().Events, item => item.Type == GameEventType.ShotFired);

        AdvanceTo(duel, 1 + tickRate);
        Assert.Equal(6, Assert.Single(duel.CaptureFrame().Bullets).Position.X, 8);
        AdvanceTo(duel, shell.ImpactTick!.Value - 1);
        Assert.Equal(100, duel.Observe("opponent").Self.Hp);
        Step(duel);
        Assert.Empty(duel.CaptureFrame().Bullets);
        Assert.Equal(65, duel.Observe("opponent").Self.Hp);
        Assert.Contains(duel.CaptureFrame().Events, item =>
            item.Type == GameEventType.ProjectileLanded && item.Position == EnemyPosition && item.BulletId == shell.Id);
        Assert.Single(duel.CaptureFrame().Events, item => item.Type == GameEventType.BotHit);
    }

    [Fact]
    public void CannonStillStopsAtWallsWhileMortarCanPassOverThem()
    {
        var config = Config with
        {
            Spawns = [Config.Spawns[0] with { Weapon = WeaponType.Cannon, TurretAngle = 0 }, Config.Spawns[1]]
        };
        var duel = new Duel(config);
        Step(duel, Idle with { Shoot = true });
        Assert.Equal(WeaponType.Cannon, Assert.Single(duel.CaptureFrame().Bullets).Weapon);
        AdvanceTo(duel, 30);
        Assert.Empty(duel.CaptureFrame().Bullets);
        Assert.Equal(100, duel.Observe("opponent").Self.Hp);
    }

    [Fact]
    public void MovingTargetCanLeaveTheImpactPoint()
    {
        var duel = new Duel(Config);
        Step(duel, Shot(EnemyPosition));
        var landing = Assert.Single(duel.CaptureFrame().Bullets).ImpactTick!.Value;
        AdvanceTo(duel, landing, opponent: Idle with { LeftTrack = 1, RightTrack = 1 });
        Assert.True(duel.Observe("opponent").Self.Position.X < 13);
        Assert.Equal(100, duel.Observe("opponent").Self.Hp);
        Assert.Contains(duel.CaptureFrame().Events, item => item.Type == GameEventType.ProjectileLanded);
        Assert.DoesNotContain(duel.CaptureFrame().Events, item => item.Type == GameEventType.BotHit);
    }

    [Fact]
    public void ShellDoesNotHitTanksUnderItsFlightPath()
    {
        var config = Config with
        {
            Arena = Config.Arena with { Walls = [] },
            Spawns = [Config.Spawns[0], Config.Spawns[1] with { Position = new(8, 5) }]
        };
        var duel = new Duel(config);
        Step(duel, Shot(new(15, 5)));
        var landing = Assert.Single(duel.CaptureFrame().Bullets).ImpactTick!.Value;
        while (duel.CaptureFrame().Tick < landing)
        {
            Step(duel);
            Assert.Equal(100, duel.Observe("opponent").Self.Hp);
        }
        Assert.Empty(duel.CaptureFrame().Bullets);
    }

    [Theory]
    [InlineData(0, 14, 5.32, false)]
    [InlineData(Math.PI / 2, 14, 5.32, true)]
    [InlineData(0, 14.35, 5, false)]
    public void ZeroBlastRadiusTestsTheCurrentRotatedHull(double bodyAngle, double x, double y, bool hit)
    {
        var duel = new Duel(Config with
        {
            MortarBlastRadius = 0,
            Spawns = [Config.Spawns[0], Config.Spawns[1] with { BodyAngle = bodyAngle }]
        });
        Step(duel, Shot(new(x, y)));
        AdvanceTo(duel, Assert.Single(duel.CaptureFrame().Bullets).ImpactTick!.Value);
        Assert.Equal(hit ? 65 : 100, duel.Observe("opponent").Self.Hp);
    }

    [Theory]
    [InlineData(12.5, 5, true)]
    [InlineData(12.3, 5, false)]
    public void SplashCanHitNearTheTargetWithoutAPointHit(double x, double y, bool hit)
    {
        var duel = new Duel(Config);
        Step(duel, Shot(new(x, y)));
        var landing = Assert.Single(duel.CaptureFrame().Bullets).ImpactTick!.Value;
        AdvanceTo(duel, landing - 1);
        Assert.Equal(100, duel.Observe("opponent").Self.Hp);
        Step(duel);
        Assert.Equal(hit ? 65 : 100, duel.Observe("opponent").Self.Hp);
        var explosion = Assert.Single(duel.CaptureFrame().Events, item => item.Type == GameEventType.ProjectileLanded);
        Assert.Equal(1.25, explosion.Radius);
        Assert.Equal(WeaponType.Mortar, explosion.Weapon);
    }

    [Theory]
    [InlineData(15.5, 5, true)]
    [InlineData(15.5001, 5, false)]
    [InlineData(15.3, 6.3, false)]
    [InlineData(15.1, 6.1, true)]
    public void CircularSplashUsesHullEdgesAndCorners(double x, double y, bool hit)
    {
        var config = Config with
        {
            MortarBlastRadius = 1,
            BotLength = 1,
            BotWidth = 1,
            Spawns = [Config.Spawns[0], Config.Spawns[1] with { BodyAngle = 0 }]
        };
        var duel = new Duel(config);
        Step(duel, Shot(new(x, y)));
        AdvanceTo(duel, Assert.Single(duel.CaptureFrame().Bullets).ImpactTick!.Value);
        Assert.Equal(hit ? 65 : 100, duel.Observe("opponent").Self.Hp);
    }

    [Theory]
    [InlineData(0, false)]
    [InlineData(Math.PI / 2, true)]
    public void SplashUsesTheHullRotationAtLanding(double angle, bool hit)
    {
        var duel = new Duel(Config with
        {
            MortarBlastRadius = 0.25,
            Spawns = [Config.Spawns[0], Config.Spawns[1] with { BodyAngle = angle }]
        });
        Step(duel, Shot(new(14, 5.56)));
        AdvanceTo(duel, Assert.Single(duel.CaptureFrame().Bullets).ImpactTick!.Value);
        Assert.Equal(hit ? 65 : 100, duel.Observe("opponent").Self.Hp);
    }

    [Fact]
    public void SplashBypassesWallsWithoutRevealingTheHiddenTarget()
    {
        var duel = new Duel(Config with
        {
            Spawns = [Config.Spawns[0], Config.Spawns[1] with { Position = new(8.5, 5) }]
        });
        Assert.Null(duel.Observe("player").Enemy);
        Step(duel, Shot(new(7, 5)));
        AdvanceTo(duel, Assert.Single(duel.CaptureFrame().Bullets).ImpactTick!.Value);
        Assert.Equal(65, duel.Observe("opponent").Self.Hp);
        Assert.Null(duel.Observe("player").Enemy);
    }

    [Fact]
    public void LaterCommandsDoNotRetargetOrCancelAnAirborneShell()
    {
        var duel = new Duel(Config);
        Step(duel, Shot(EnemyPosition));
        var shell = Assert.Single(duel.CaptureFrame().Bullets);
        AdvanceTo(duel, shell.ImpactTick!.Value,
            player: Idle with { TargetPoint = new(1, 1), TurretTurn = 1 });
        Assert.Equal(65, duel.Observe("opponent").Self.Hp);
        Assert.Contains(duel.CaptureFrame().Events, item =>
            item.Type == GameEventType.ProjectileLanded && item.Position == EnemyPosition);
    }

    [Fact]
    public void MinimumFlightTimeAppliesAtTheLaunchPositionWithoutSelfDamage()
    {
        var duel = new Duel(Config);
        Step(duel, Shot(new(2, 5)));
        var shell = Assert.Single(duel.CaptureFrame().Bullets);
        Assert.Equal(11, shell.ImpactTick);
        Assert.Equal(default, shell.Direction);
        AdvanceTo(duel, 10);
        Assert.Single(duel.CaptureFrame().Bullets);
        Step(duel);
        Assert.Empty(duel.CaptureFrame().Bullets);
        Assert.All(duel.CaptureFrame().Bots, bot => Assert.Equal(100, bot.Hp));
    }

    [Fact]
    public void NonIntegralFlightDurationRoundsUpToTheNextTick()
    {
        var duel = new Duel(Config);
        Step(duel, Shot(new(3.01, 5))); // 1.01 / 4 < the 0.5 second minimum.
        Assert.Equal(11, Assert.Single(duel.CaptureFrame().Bullets).ImpactTick);
        var other = new Duel(Config);
        Step(other, Shot(new(4.01, 5))); // 2.01 / 4 * 20 = 10.05 ticks.
        Assert.Equal(12, Assert.Single(other.CaptureFrame().Bullets).ImpactTick);
    }

    [Fact]
    public void ReloadingLimitsLaunchesAndDoesNotStoreDelayedShots()
    {
        var duel = new Duel(Config);
        var launches = new List<int>();
        for (var step = 0; step < 62; step++)
        {
            Step(duel, Shot(EnemyPosition));
            if (duel.CaptureFrame().Events.Any(item => item.Type == GameEventType.ShotFired))
                launches.Add(duel.CaptureFrame().Tick);
        }
        Assert.Equal(new[] { 1, 31, 61 }, launches);

        var once = new Duel(Config);
        Step(once, Shot(EnemyPosition));
        Step(once, Shot(new(10, 1))); // Rejected while reloading; no queued shot.
        AdvanceTo(once, 40);
        Assert.Single(once.CaptureFrame().Bullets);
        Assert.Equal(EnemyPosition, once.CaptureFrame().Bullets[0].TargetPoint);
        Assert.True(once.Observe("player").Self.CanShoot);
    }

    [Fact]
    public void RepeatedHitsDestroyTheTargetAndClampDamageToRemainingHp()
    {
        var duel = new Duel(Config);
        var damage = new List<int>();
        while (duel.Result is null)
        {
            Step(duel, Shot(EnemyPosition));
            damage.AddRange(duel.CaptureFrame().Events.Where(item => item.Type == GameEventType.BotHit)
                .Select(item => item.Damage!.Value));
        }
        Assert.Equal(new[] { 35, 35, 30 }, damage);
        Assert.Equal(0, duel.Observe("opponent").Self.Hp);
        Assert.Equal(new MatchResult("player", MatchEndReason.BotDestroyed, 121), duel.Result);
        Assert.Contains(duel.CaptureFrame().Events, item => item.Type == GameEventType.BotDestroyed);
    }

    [Fact]
    public void SimultaneousLethalLandingsAreADraw()
    {
        var duel = new Duel(Config with
        {
            MortarDamage = 100,
            Spawns = [Config.Spawns[0], Config.Spawns[1] with { Weapon = WeaponType.Mortar }]
        });
        Step(duel, Shot(EnemyPosition), Shot(new(2, 5)));
        AdvanceTo(duel, 61);
        Assert.All(duel.CaptureFrame().Bots, bot => Assert.Equal(0, bot.Hp));
        Assert.Equal(new MatchResult(null, MatchEndReason.BotDestroyed, 61), duel.Result);
    }

    [Fact]
    public void InvalidDirectCommandsFailBeforeAdvancingTheWorld()
    {
        var invalid = new[]
        {
            Idle with { Shoot = true }, Shot(new(-1, 5)), Shot(new(17, 5)),
            Shot(new(5, -1)), Shot(new(5, 11)), Shot(new(double.NaN, 5)), Shot(new(5, double.PositiveInfinity))
        };
        foreach (var action in invalid)
        {
            var duel = new Duel(Config);
            Assert.Throws<ArgumentException>(() => Step(duel, action));
            Assert.Equal(0, duel.CaptureFrame().Tick);
            Assert.Empty(duel.CaptureFrame().Bullets);
            Assert.True(duel.Observe("player").Self.CanShoot);
        }
        var cannon = new Duel(MatchConfig.Classic);
        Assert.Throws<ArgumentException>(() => Step(cannon, Shot(EnemyPosition)));
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(16, 10)]
    public void ArenaEdgesAreValidTargetsAndLandingIsRecordedOnAMiss(double x, double y)
    {
        var duel = new Duel(Config);
        Step(duel, Shot(new(x, y)));
        AdvanceTo(duel, Assert.Single(duel.CaptureFrame().Bullets).ImpactTick!.Value);
        Assert.Empty(duel.CaptureFrame().Bullets);
        Assert.Single(duel.CaptureFrame().Events, item => item.Type == GameEventType.ProjectileLanded);
        Assert.DoesNotContain(duel.CaptureFrame().Events, item => item.Type == GameEventType.BotHit);
    }

    [Fact]
    public void CannonAndMortarCanFireTogetherAndReplayDataRoundTrips()
    {
        var duel = new Duel(Config with { Arena = Config.Arena with { Walls = [] } });
        Step(duel, Shot(EnemyPosition), Idle with { Shoot = true });
        var frame = duel.CaptureFrame();
        Assert.Contains(frame.Bullets, bullet => bullet.Weapon == WeaponType.Cannon);
        Assert.Contains(frame.Bullets, bullet => bullet.Weapon == WeaponType.Mortar);
        Assert.All(frame.Bullets, bullet => Assert.Equal(1, bullet.LaunchTick));
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var encoded = JsonSerializer.Serialize(frame, options);
        var decoded = JsonSerializer.Deserialize<GameFrame>(encoded, options)!;
        Assert.Equal(frame.Bullets, decoded.Bullets);
        Assert.Equal(JsonSerializer.Serialize(frame.Bots, options), JsonSerializer.Serialize(decoded.Bots, options));
        Assert.Contains("\"weapon\":\"Mortar\"", encoded);
    }

    private static BotAction Shot(Vec2 target) => Idle with { Shoot = true, TargetPoint = target };

    private static void Step(Duel duel, BotAction? player = null, BotAction? opponent = null) =>
        duel.Step(new Dictionary<string, BotAction> { ["player"] = player ?? Idle, ["opponent"] = opponent ?? Idle });

    private static void AdvanceTo(Duel duel, int tick, BotAction? player = null, BotAction? opponent = null)
    {
        while (duel.CaptureFrame().Tick < tick) Step(duel, player, opponent);
    }
}
