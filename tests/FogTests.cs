using Xunit;

namespace BotArena.Tests;

public class FogTests
{
    private static readonly BotAction Idle = new(0, 0, default, false);
    private static MatchConfig Config => MatchConfig.Classic with
    {
        Arena = new(16, 10, []) { Cells = [new(7, 5, Fog: true)] },
        Spawns = [new("player", new(2.5, 5.5), 0, 0), new("opponent", new(14.5, 5.5), Math.PI, Math.PI)]
    };

    [Fact]
    public void FogBetweenTwoOutsideTanksLimitsSightSymmetrically()
    {
        var duel = new Duel(Config);
        Assert.False(duel.Observe("player").Self.InFog);
        Assert.False(duel.Observe("opponent").Self.InFog);
        Assert.Null(duel.Observe("player").Enemy);
        Assert.Null(duel.Observe("opponent").Enemy);
        var clear = new Duel(Config with { Arena = Config.Arena with { Cells = [] } });
        Assert.NotNull(clear.Observe("player").Enemy);
        Assert.NotNull(clear.Observe("opponent").Enemy);
    }

    [Theory]
    [InlineData(10.5, true)]
    [InlineData(10.5001, false)]
    public void FogRangeIncludesTheExactBoundary(double targetX, bool visible)
    {
        var duel = new Duel(Config with
        {
            Spawns = [Config.Spawns[0] with { Position = new(6.5, 5.5) }, Config.Spawns[1] with { Position = new(targetX, 5.5) }]
        });
        Assert.Equal(visible, duel.Observe("player").Enemy is not null);
        Assert.Equal(visible, duel.Observe("opponent").Enemy is not null);
    }

    [Fact]
    public void BeingInsideFogAlsoLimitsSightAndCanCombineWithAnySurface()
    {
        foreach (var surface in Enum.GetValues<SurfaceType>())
        {
            var duel = new Duel(Config with
            {
                Arena = Config.Arena with { Cells = [new(2, 5, surface, true)] }
            });
            var self = duel.Observe("player").Self;
            Assert.True(self.InFog);
            Assert.Equal(surface, self.Surface);
            Assert.Null(duel.Observe("player").Enemy);
            Assert.Null(duel.Observe("opponent").Enemy);
        }
    }

    [Fact]
    public void CloseTargetsRemainHiddenByWalls()
    {
        var duel = new Duel(Config with
        {
            Arena = Config.Arena with { Walls = [new(8, 5, 1, 1)] },
            Spawns = [Config.Spawns[0] with { Position = new(6.5, 5.5) }, Config.Spawns[1] with { Position = new(10.5, 5.5) }]
        });
        Assert.Null(duel.Observe("player").Enemy);
    }

    [Theory]
    [InlineData(5, false)]
    [InlineData(6, true)]
    [InlineData(7, true)]
    public void OnlyFogCrossedByTheSightLineAffectsVisibility(double y, bool visible)
    {
        var duel = new Duel(Config with
        {
            Spawns = [Config.Spawns[0] with { Position = new(2.5, y) }, Config.Spawns[1] with { Position = new(14.5, y) }]
        });
        Assert.Equal(visible, duel.Observe("player").Enemy is not null);
    }

    [Fact]
    public void TouchingAFogCornerWithoutEnteringDoesNotBlockSight()
    {
        var duel = new Duel(Config with
        {
            Spawns = [Config.Spawns[0] with { Position = new(4, 8) }, Config.Spawns[1] with { Position = new(11, 1) }]
        });
        Assert.NotNull(duel.Observe("player").Enemy);
        Assert.NotNull(duel.Observe("opponent").Enemy);
    }

    [Theory]
    [InlineData(WeaponType.Cannon, 80, 25)]
    [InlineData(WeaponType.Mortar, 65, 61)]
    [InlineData(WeaponType.Gauss, 40, 1)]
    public void FogDoesNotBlockAnyWeaponOrRevealTheHitTarget(WeaponType weapon, int expectedHp, int steps)
    {
        var duel = new Duel(Config with { Spawns = [Config.Spawns[0] with { Weapon = weapon }, Config.Spawns[1]] });
        Step(duel, Idle with { Shoot = true, TargetPoint = weapon == WeaponType.Mortar ? new Vec2(14.5, 5.5) : null });
        if (weapon != WeaponType.Gauss)
            Assert.Single(duel.Observe("opponent").Bullets);
        while (duel.CaptureFrame().Tick < steps) Step(duel);
        Assert.Equal(expectedHp, duel.Observe("opponent").Self.Hp);
        Assert.Null(duel.Observe("player").Enemy);
        Assert.Null(duel.Observe("opponent").Enemy);
    }

    [Fact]
    public void FogRangeIsConfigurableAndPublishedWithoutHiddenTankData()
    {
        var duel = new Duel(Config with
        {
            Arena = Config.Arena with { TerrainRules = new() { FogVisibilityRange = 13 } }
        });
        Assert.NotNull(duel.Observe("player").Enemy);
        Assert.Equal(13, duel.Observe("player").Arena.TerrainRules.FogVisibilityRange);
    }

    [Fact]
    public void JavaScriptCanReadCellsRulesAndItsOwnSurfaceWhileEnemyIsHidden()
    {
        var config = Config with { Arena = Config.Arena with { Cells = [new(2, 5, SurfaceType.Sand, true)] } };
        using var player = new JavaScriptBot("""
            function tick(state) {
              if (state.enemy !== null) throw new Error('hidden target leaked');
              if (state.self.surface !== 'Sand' || !state.self.inFog) throw new Error('missing terrain');
              if (state.arena.cells[0].x !== 2 || state.arena.cellSize !== 1) throw new Error('missing grid');
              return {leftTrack: state.arena.terrainRules.sand.speedMultiplier};
            }
            """);
        Assert.Equal(0.75, player.Decide(new Duel(config).Observe("player")).LeftTrack);
    }

    private static void Step(Duel duel, BotAction? player = null) =>
        duel.Step(new Dictionary<string, BotAction> { ["player"] = player ?? Idle, ["opponent"] = Idle });
}
