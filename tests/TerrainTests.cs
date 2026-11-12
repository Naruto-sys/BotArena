using System.Text.Json;
using Xunit;

namespace BotArena.Tests;

public class TerrainTests
{
    private static readonly BotAction Idle = new(0, 0, default, false);
    private static readonly BotAction Forward = Idle with { LeftTrack = 1, RightTrack = 1 };
    private static MatchConfig Config => MatchConfig.Classic with
    {
        Arena = new(40, 20, []),
        Spawns = [new("player", new(2.5, 5.5), 0, 0), new("opponent", new(35, 15), Math.PI, Math.PI)]
    };

    [Theory]
    [InlineData(SurfaceType.Ground, 3.6, 2, 8, 12)]
    [InlineData(SurfaceType.Sand, 2.7, 1.5, 4.4, 12)]
    [InlineData(SurfaceType.Snow, 2.16, 1.2, 6, 12)]
    [InlineData(SurfaceType.Ice, 3.6, 2, 8, 3)]
    public void SurfaceControlsForwardReverseAccelerationAndBraking(SurfaceType surface,
        double maxForward, double maxReverse, double acceleration, double braking)
    {
        var duel = new Duel(OnSurface(surface));
        Assert.Equal(surface, duel.Observe("player").Self.Surface);
        Step(duel, Forward);
        Assert.Equal(acceleration / 20, duel.Observe("player").Self.Speed, 8);
        AdvanceTo(duel, 20, Forward);
        Assert.Equal(maxForward, duel.Observe("player").Self.Speed, 8);
        Step(duel);
        Assert.Equal(maxForward - braking / 20, duel.Observe("player").Self.Speed, 8);

        var reverse = new Duel(OnSurface(surface));
        AdvanceTo(reverse, 20, Idle with { LeftTrack = -1, RightTrack = -1 });
        Assert.Equal(-maxReverse, reverse.Observe("player").Self.Speed, 8);
    }

    [Theory]
    [InlineData(SurfaceType.Ground, 1)]
    [InlineData(SurfaceType.Sand, 0.8)]
    [InlineData(SurfaceType.Snow, 1)]
    [InlineData(SurfaceType.Ice, 1)]
    public void SurfaceChangesHullTurnButNotTurretTurn(SurfaceType surface, double multiplier)
    {
        var ground = new Duel(Config);
        var actual = new Duel(OnSurface(surface));
        var action = Idle with { LeftTrack = 1, RightTrack = -1, TurretTurn = 0.5 };
        AdvanceTo(ground, 15, action);
        AdvanceTo(actual, 15, action);
        var expected = ground.Observe("player").Self;
        var bot = actual.Observe("player").Self;
        Assert.Equal(expected.BodyAngle * multiplier, bot.BodyAngle, 8);
        Assert.Equal(expected.TurretAngle, bot.TurretAngle, 8);
        Assert.Equal(expected.Position, bot.Position);
    }

    [Fact]
    public void IceIncreasesStoppingDistanceWithoutRandomDrift()
    {
        double StopDistance(SurfaceType surface)
        {
            var duel = new Duel(OnSurface(surface));
            AdvanceTo(duel, 20, Forward);
            var start = duel.Observe("player").Self.Position;
            while (duel.Observe("player").Self.Speed > 1e-9) Step(duel);
            var end = duel.Observe("player").Self.Position;
            Assert.Equal(start.Y, end.Y);
            Assert.Equal(0, duel.Observe("player").Self.BodyAngle);
            return end.X - start.X;
        }
        Assert.Equal(0.45, StopDistance(SurfaceType.Ground), 8);
        Assert.Equal(2.07, StopDistance(SurfaceType.Ice), 8);
    }

    [Fact]
    public void EnteringSandPreservesVelocityAndBrakesToTheNewLimitOverTime()
    {
        var cells = Enumerable.Range(6, 15).Select(x => new ArenaCell(x, 5, SurfaceType.Sand)).ToArray();
        var duel = new Duel(Config with { Arena = Config.Arena with { Cells = cells } });
        for (var step = 0; duel.Observe("player").Self.Surface != SurfaceType.Sand && step < 60; step++)
            Step(duel, Forward);
        var entry = duel.Observe("player").Self;
        Assert.Equal(SurfaceType.Sand, entry.Surface);
        Assert.Equal(3.6, entry.Speed, 8);
        Assert.Single(duel.CaptureFrame().Events, item => item.Type == GameEventType.SurfaceChanged);
        Step(duel, Forward);
        Assert.Equal(3, duel.Observe("player").Self.Speed, 8);
        Step(duel, Forward);
        Assert.Equal(2.7, duel.Observe("player").Self.Speed, 8);
        Assert.DoesNotContain(duel.CaptureFrame().Events, item => item.Type == GameEventType.SurfaceChanged);
    }

    [Fact]
    public void SurfaceUsesTheCenterAndHalfOpenCellBounds()
    {
        var arena = Config.Arena with { Cells = [new(3, 5, SurfaceType.Snow)] };
        foreach (var (x, surface) in new[] { (2.9, SurfaceType.Ground), (3.0, SurfaceType.Snow), (4.0, SurfaceType.Ground) })
        {
            var duel = new Duel(Config with
            {
                Arena = arena,
                Spawns = [Config.Spawns[0] with { Position = new(x, 5.5) }, Config.Spawns[1]]
            });
            Assert.Equal(surface, duel.Observe("player").Self.Surface);
        }
    }

    [Fact]
    public void LeavingSurfaceAndFogRecordsBothChangesAtTheActualPosition()
    {
        var duel = new Duel(Config with
        {
            Arena = Config.Arena with { Cells = [new(2, 5, SurfaceType.Sand, true)] }
        });
        Assert.True(duel.Observe("player").Self.InFog);
        for (var step = 0; duel.Observe("player").Self.Surface != SurfaceType.Ground && step < 40; step++)
            Step(duel, Forward);
        var bot = duel.Observe("player").Self;
        Assert.Equal(SurfaceType.Ground, bot.Surface);
        Assert.False(bot.InFog);
        Assert.Equal(2, duel.CaptureFrame().Events.Length);
        Assert.Contains(duel.CaptureFrame().Events, item => item.Type == GameEventType.FogExited && item.Position == bot.Position);
        Assert.Contains(duel.CaptureFrame().Events, item => item.Type == GameEventType.SurfaceChanged && item.Surface == SurfaceType.Ground);
        var entry = new Duel(Config with { Arena = Config.Arena with { Cells = [new(3, 5, SurfaceType.Snow, true)] } });
        while (!entry.Observe("player").Self.InFog) Step(entry, Forward);
        Assert.Contains(entry.CaptureFrame().Events, item => item.Type == GameEventType.FogEntered);
    }

    [Fact]
    public void WallCollisionDoesNotFalselyEnterTheCellBehindIt()
    {
        var duel = new Duel(Config with
        {
            Arena = Config.Arena with { Walls = [new(3, 0, 1, 10)], Cells = [new(3, 5, SurfaceType.Ice, true)] }
        });
        AdvanceTo(duel, 20, Forward);
        var bot = duel.Observe("player").Self;
        Assert.Equal(0, bot.Speed);
        Assert.Equal(SurfaceType.Ground, bot.Surface);
        Assert.False(bot.InFog);
        Assert.DoesNotContain(duel.CaptureFrame().Events, item => item.Type == GameEventType.SurfaceChanged);
    }

    [Fact]
    public void CustomCellSizeRulesAndPartialEdgeCellsAreSupported()
    {
        var arena = new ArenaState(16.5, 10.5, [])
        {
            CellSize = 2,
            Cells = [new(1, 2, SurfaceType.Sand), new(8, 5, SurfaceType.Ice)],
            TerrainRules = new() { Sand = new(0.5, 0.25, 0.5, 0.75) }
        };
        var duel = new Duel(Config with { Arena = arena, Spawns = [Config.Spawns[0], new("opponent", new(14, 8), 0, 0)] });
        Step(duel, Forward);
        Assert.Equal(SurfaceType.Sand, duel.Observe("player").Self.Surface);
        Assert.Equal(0.1, duel.Observe("player").Self.Speed, 8);
        Assert.Equal(arena, duel.Observe("player").Arena);
        Assert.Equal(0.5, duel.Observe("player").Arena.TerrainRules.Sand.SpeedMultiplier);
    }

    [Fact]
    public void EmptyGridPreservesTheOriginalDuelPhysics()
    {
        var empty = new Duel(Config);
        var explicitGround = new Duel(OnSurface(SurfaceType.Ground));
        for (var step = 0; step < 70; step++)
        {
            var action = Idle with { LeftTrack = 1, RightTrack = step % 4 == 0 ? 0.7 : 1, TurretTurn = 0.3 };
            Step(empty, action);
            Step(explicitGround, action);
            Assert.Equal(empty.Observe("player").Self, explicitGround.Observe("player").Self);
        }
    }

    [Fact]
    public void DemoMapContainsAllSurfacesAndSymmetricFogOverlays()
    {
        var arena = MatchConfig.Biomes.Arena;
        Assert.Empty(MatchConfig.Classic.Arena.Cells);
        foreach (var surface in new[] { SurfaceType.Sand, SurfaceType.Snow, SurfaceType.Ice })
            Assert.Contains(arena.Cells, cell => cell.Surface == surface);
        Assert.Contains(arena.Cells, cell => cell.Fog && cell.Surface == SurfaceType.Sand);
        Assert.All(arena.Cells, cell => Assert.Contains(arena.Cells, other =>
            other.X == 15 - cell.X && other.Y == cell.Y && other.Surface == cell.Surface && other.Fog == cell.Fog));
        var duel = new Duel(MatchConfig.Biomes);
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var encoded = JsonSerializer.Serialize(duel.Observe("player"), options);
        var decoded = JsonSerializer.Deserialize<BotObservation>(encoded, options)!;
        Assert.Equal(arena.Cells, decoded.Arena.Cells);
        Assert.Equal(arena.TerrainRules, decoded.Arena.TerrainRules);
        Assert.Contains("\"surface\":\"Sand\"", encoded);
    }

    [Fact]
    public void InvalidGridsAndRulesAreRejected()
    {
        var invalid = new[]
        {
            Config.Arena with { CellSize = 0 }, Config.Arena with { CellSize = double.NaN },
            Config.Arena with { Cells = [new(-1, 0)] }, Config.Arena with { Cells = [new(40, 0)] },
            Config.Arena with { Cells = [new(0, 20)] }, Config.Arena with { Cells = [new(1, 1), new(1, 1)] },
            Config.Arena with { Cells = [new(1, 1, (SurfaceType)100)] },
            Config.Arena with { TerrainRules = new() { FogVisibilityRange = double.PositiveInfinity } },
            Config.Arena with { TerrainRules = new() { FogVisibilityRange = 0 } },
            Config.Arena with { TerrainRules = new() { Sand = new(0) } },
            Config.Arena with { TerrainRules = new() { Ice = new(DecelerationMultiplier: -1) } }
        };
        foreach (var arena in invalid) Assert.Throws<ArgumentException>(() => new Duel(Config with { Arena = arena }));
    }

    private static MatchConfig OnSurface(SurfaceType surface) => Config with
    {
        Arena = Config.Arena with
        {
            Cells = Enumerable.Range(0, 20).SelectMany(x => Enumerable.Range(0, 10).Select(y => new ArenaCell(x, y, surface))).ToArray()
        }
    };

    private static void Step(Duel duel, BotAction? player = null) =>
        duel.Step(new Dictionary<string, BotAction> { ["player"] = player ?? Idle, ["opponent"] = Idle });

    private static void AdvanceTo(Duel duel, int tick, BotAction? player = null)
    {
        while (duel.CaptureFrame().Tick < tick) Step(duel, player);
    }
}
