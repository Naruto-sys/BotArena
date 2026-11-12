using System.Text.Json;
using Xunit;

namespace BotArena.Tests;

public class GaussTests
{
    private static readonly BotAction Idle = new(0, 0, default, false);
    private static readonly BotAction Shoot = Idle with { Shoot = true };
    private static MatchConfig Config => MatchConfig.Classic with
    {
        Arena = new(16, 10, []),
        Spawns = [new("player", new(2, 5), 0, 0, WeaponType.Gauss),
            new("opponent", new(14, 5), Math.PI, Math.PI)]
    };

    [Fact]
    public void StartsChargedAndHitsAcrossTheArenaOnTheFiringTick()
    {
        var duel = new Duel(Config with { BulletSpeed = 0.01 });
        var ready = duel.Observe("player").Self;
        Assert.Equal(WeaponChargeStage.Ready, ready.ChargeStage);
        Assert.Equal(1, ready.ChargeProgress);
        Assert.True(ready.CanShoot);
        Step(duel, Shoot);
        var frame = duel.CaptureFrame();
        Assert.Equal(40, duel.Observe("opponent").Self.Hp);
        Assert.Empty(frame.Bullets);
        var beam = Assert.Single(frame.Events, item => item.Type == GameEventType.BeamFired);
        Assert.Equal(new Vec2(2, 5), beam.Position);
        Assert.Equal(13.66, beam.EndPosition!.Value.X, 8);
        Assert.Equal(5, beam.EndPosition.Value.Y, 8);
        Assert.Equal(WeaponType.Gauss, beam.Weapon);
        Assert.Equal(beam.BulletId, Assert.Single(frame.Events, item => item.Type == GameEventType.BotHit).BulletId);
        Assert.Equal(WeaponChargeStage.Charging, duel.Observe("player").Self.ChargeStage);
        Assert.Equal(0.02, duel.Observe("player").Self.ChargeProgress, 8);
        Assert.Contains(frame.Events, item => item.Type == GameEventType.WeaponChargeStarted);
    }

    [Fact]
    public void BeamStopsAtTheFirstWallWithoutPenetration()
    {
        var duel = new Duel(Config with { Arena = new(16, 10, [new(9, 0, 1, 10), new(7, 0, 1, 10)]) });
        Assert.Null(duel.Observe("player").Enemy);
        Step(duel, Shoot);
        Assert.Equal(100, duel.Observe("opponent").Self.Hp);
        var beam = Assert.Single(duel.CaptureFrame().Events, item => item.Type == GameEventType.BeamFired);
        Assert.Equal(7, beam.EndPosition!.Value.X, 8);
        Assert.DoesNotContain(duel.CaptureFrame().Events, item => item.Type == GameEventType.BotHit);
        Assert.Null(duel.Observe("player").Enemy);
    }

    [Fact]
    public void TargetBeforeTheWallIsHitAndStopsTheBeam()
    {
        var duel = new Duel(Config with
        {
            Arena = new(16, 10, [new(9, 0, 1, 10)]),
            Spawns = [Config.Spawns[0], Config.Spawns[1] with { Position = new(6, 5) }]
        });
        Step(duel, Shoot);
        Assert.Equal(40, duel.Observe("opponent").Self.Hp);
        var beam = Assert.Single(duel.CaptureFrame().Events, item => item.Type == GameEventType.BeamFired);
        Assert.Equal(5.66, beam.EndPosition!.Value.X, 8);
    }

    [Theory]
    [InlineData(0, 16, 5)]
    [InlineData(Math.PI, 0, 5)]
    [InlineData(Math.PI / 2, 2, 10)]
    [InlineData(-Math.PI / 2, 2, 0)]
    [InlineData(Math.PI / 4, 7, 10)]
    public void MissEndsAtTheArenaEdgeAndConsumesTheCharge(double angle, double x, double y)
    {
        var duel = new Duel(Config with
        {
            Spawns = [Config.Spawns[0] with { TurretAngle = angle }, Config.Spawns[1] with { Position = new(14, 8) }]
        });
        Step(duel, Shoot);
        Assert.Equal(100, duel.Observe("opponent").Self.Hp);
        Assert.False(duel.Observe("player").Self.CanShoot);
        var end = Assert.Single(duel.CaptureFrame().Events, item => item.Type == GameEventType.BeamFired).EndPosition!.Value;
        Assert.Equal(x, end.X, 8);
        Assert.Equal(y, end.Y, 8);
        Assert.Empty(duel.CaptureFrame().Bullets);
    }

    [Theory]
    [InlineData(0, false)]
    [InlineData(Math.PI / 2, true)]
    public void RayTestsTheRotatedHull(double angle, bool hit)
    {
        var duel = new Duel(Config with
        {
            Spawns = [Config.Spawns[0], Config.Spawns[1] with { Position = new(14, 5.32), BodyAngle = angle }]
        });
        Step(duel, Shoot);
        Assert.Equal(hit ? 40 : 100, duel.Observe("opponent").Self.Hp);
    }

    [Fact]
    public void RayUsesTheActualTurretAngleAfterItsTurn()
    {
        var duel = new Duel(Config);
        Step(duel, Shoot with { AimDirection = new(0, 1) });
        var self = duel.Observe("player").Self;
        var end = Assert.Single(duel.CaptureFrame().Events, item => item.Type == GameEventType.BeamFired).EndPosition!.Value;
        var offset = end - self.Position;
        Assert.Equal(self.TurretAngle, Math.Atan2(offset.Y, offset.X), 8);
        Assert.InRange(self.TurretAngle, 0.001, Config.MaxTurretTurnSpeed / Config.TickRate);
        Assert.Equal(100, duel.Observe("opponent").Self.Hp);
    }

    [Fact]
    public void RechargeHasProgressAndOneReadyEventAndDoesNotQueueShots()
    {
        var duel = new Duel(Config);
        Step(duel, Shoot);
        Step(duel, Shoot); // No queued shot while charging.
        AdvanceTo(duel, 25);
        Assert.Equal(0.5, duel.Observe("player").Self.ChargeProgress, 8);
        AdvanceTo(duel, 49);
        Assert.False(duel.Observe("player").Self.CanShoot);
        Assert.Equal(0.98, duel.Observe("player").Self.ChargeProgress, 8);
        Step(duel);
        var self = duel.Observe("player").Self;
        Assert.True(self.CanShoot);
        Assert.Equal(WeaponChargeStage.Ready, self.ChargeStage);
        Assert.Equal(1, self.ChargeProgress);
        Assert.Single(duel.CaptureFrame().Events, item => item.Type == GameEventType.WeaponReady);
        Step(duel);
        Assert.Empty(duel.CaptureFrame().Events);
        Assert.Equal(40, duel.Observe("opponent").Self.Hp);
    }

    [Fact]
    public void ContinuousFireRespectsTheCooldownAndClampsLethalDamage()
    {
        var duel = new Duel(Config);
        var shots = new List<int>();
        var damage = new List<int>();
        while (duel.Result is null)
        {
            Step(duel, Shoot);
            var frame = duel.CaptureFrame();
            if (frame.Events.Any(item => item.Type == GameEventType.ShotFired)) shots.Add(frame.Tick);
            damage.AddRange(frame.Events.Where(item => item.Type == GameEventType.BotHit).Select(item => item.Damage!.Value));
        }
        Assert.Equal(new[] { 1, 51 }, shots);
        Assert.Equal(new[] { 60, 40 }, damage);
        Assert.Equal(new MatchResult("player", MatchEndReason.BotDestroyed, 51), duel.Result);
    }

    [Fact]
    public void MovementAndTurretRotationContinueDuringRecharge()
    {
        var duel = new Duel(Config);
        Step(duel, Shoot);
        AdvanceTo(duel, 12, Idle with { LeftTrack = 1, RightTrack = 1, TurretTurn = 1 });
        var self = duel.Observe("player").Self;
        Assert.True(self.Position.X > 3);
        Assert.True(self.TurretAngle > 1);
        Assert.Equal(WeaponChargeStage.Charging, self.ChargeStage);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void SimultaneousLethalBeamsAreADrawRegardlessOfSpawnOrder(bool reverse)
    {
        var spawns = new[] { Config.Spawns[0], Config.Spawns[1] with { Weapon = WeaponType.Gauss } };
        var duel = new Duel(Config with { GaussDamage = 100, Spawns = reverse ? spawns.Reverse().ToArray() : spawns });
        Step(duel, Shoot, Shoot);
        Assert.All(duel.CaptureFrame().Bots, bot => Assert.Equal(0, bot.Hp));
        Assert.Equal(new MatchResult(null, MatchEndReason.BotDestroyed, 1), duel.Result);
        Assert.Equal(2, duel.CaptureFrame().Events.Count(item => item.Type == GameEventType.BeamFired));
    }

    [Fact]
    public void LethalBeamDoesNotCancelTheOtherBotsShotOnTheSameTick()
    {
        var duel = new Duel(Config with { GaussDamage = 100, BulletDamage = 100, BulletSpeed = 1000 });
        Step(duel, Shoot, Shoot);
        Assert.All(duel.CaptureFrame().Bots, bot => Assert.Equal(0, bot.Hp));
        Assert.Equal(new MatchResult(null, MatchEndReason.BotDestroyed, 1), duel.Result);
    }

    [Fact]
    public void ChargeInformationIsVisibleOnlyWithTheTankAndReplayRoundTrips()
    {
        var duel = new Duel(Config);
        Step(duel, Shoot);
        Assert.Equal(WeaponChargeStage.Charging, duel.Observe("opponent").Enemy!.ChargeStage);
        Assert.Equal(0.02, duel.Observe("opponent").Enemy!.ChargeProgress, 8);
        var frame = duel.CaptureFrame();
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var encoded = JsonSerializer.Serialize(frame, options);
        var decoded = JsonSerializer.Deserialize<GameFrame>(encoded, options)!;
        Assert.Equal(JsonSerializer.Serialize(frame.Bots, options), JsonSerializer.Serialize(decoded.Bots, options));
        Assert.Equal(frame.Events, decoded.Events);
        Assert.Contains("\"weapon\":\"Gauss\"", encoded);
        Assert.Contains("\"chargeStage\":\"Charging\"", encoded);
        var hidden = new Duel(Config with { Arena = new(16, 10, [new(7, 0, 1, 10)]) });
        Step(hidden, Shoot);
        Assert.Null(hidden.Observe("opponent").Enemy);
    }

    [Fact]
    public void JavaScriptUsesTheExistingShootAndAimCommandsForGauss()
    {
        using var player = new JavaScriptBot("""
            function tick(state) {
              if (state.self.weapon !== 'Gauss') throw new Error('wrong weapon');
              if (state.self.canShoot !== (state.self.chargeStage === 'Ready')) throw new Error('wrong stage');
              if (state.self.chargeProgress < 0 || state.self.chargeProgress > 1) throw new Error('wrong progress');
              return {shoot: state.self.canShoot, aim: bot.aimAt(state.enemy.position)};
            }
            """);
        using var opponent = new JavaScriptBot("function tick() { return {}; }");
        var response = Match.Run(Config, player, opponent);
        Assert.Null(response.Error);
        Assert.Equal(new MatchResult("player", MatchEndReason.BotDestroyed, 51), response.Replay.Result);
        using var invalid = new JavaScriptBot("function tick() { return {targetPoint: {x: 14, y: 5}}; }");
        Assert.Throws<StrategyException>(() => invalid.Decide(new Duel(Config).Observe("player")));
    }

    [Fact]
    public void NewWeaponParametersRejectInvalidValues()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new Duel(Config with { MortarBlastRadius = -1 }));
        Assert.Throws<ArgumentOutOfRangeException>(() => new Duel(Config with { MortarBlastRadius = double.NaN }));
        Assert.Throws<ArgumentOutOfRangeException>(() => new Duel(Config with { MortarBlastRadius = double.PositiveInfinity }));
        Assert.Throws<ArgumentOutOfRangeException>(() => new Duel(Config with { GaussCooldownTicks = 0 }));
        Assert.Throws<ArgumentOutOfRangeException>(() => new Duel(Config with { GaussDamage = 0 }));
    }

    private static void Step(Duel duel, BotAction? player = null, BotAction? opponent = null) =>
        duel.Step(new Dictionary<string, BotAction> { ["player"] = player ?? Idle, ["opponent"] = opponent ?? Idle });

    private static void AdvanceTo(Duel duel, int tick, BotAction? player = null)
    {
        while (duel.CaptureFrame().Tick < tick) Step(duel, player);
    }
}
