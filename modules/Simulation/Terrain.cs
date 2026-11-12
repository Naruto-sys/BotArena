using System.Text.Json.Serialization;

namespace BotArena;

[JsonConverter(typeof(JsonStringEnumConverter<SurfaceType>))]
public enum SurfaceType { Ground, Sand, Snow, Ice }

public record ArenaCell(int X, int Y, SurfaceType Surface = SurfaceType.Ground, bool Fog = false);

public record SurfaceModifiers(double SpeedMultiplier = 1, double AccelerationMultiplier = 1,
    double DecelerationMultiplier = 1, double TurnMultiplier = 1);

public sealed record TerrainRules
{
    public SurfaceModifiers Sand { get; init; } = new(0.75, 0.55, 1, 0.8);
    public SurfaceModifiers Snow { get; init; } = new(0.6, 0.75, 1, 1);
    public SurfaceModifiers Ice { get; init; } = new(1, 1, 0.25, 1);
    public double FogVisibilityRange { get; init; } = 4;
}

internal sealed class TerrainMap
{
    private static readonly SurfaceModifiers Ground = new();
    private readonly ArenaState arena;
    private readonly Dictionary<(int X, int Y), ArenaCell> cells = [];
    private readonly ArenaCell[] fogCells;

    public TerrainMap(ArenaState arena)
    {
        this.arena = arena;
        if (!Positive(arena.Width) || !Positive(arena.Height) || !Positive(arena.CellSize) ||
            Math.Ceiling(arena.Width / arena.CellSize) > int.MaxValue ||
            Math.Ceiling(arena.Height / arena.CellSize) > int.MaxValue)
            throw new ArgumentException("Arena dimensions and cell size must define a finite positive grid.", nameof(arena));
        if (arena.Cells is null || arena.TerrainRules is null || !Positive(arena.TerrainRules.FogVisibilityRange))
            throw new ArgumentException("Terrain rules and a positive finite fog range are required.", nameof(arena));
        Validate(arena.TerrainRules.Sand);
        Validate(arena.TerrainRules.Snow);
        Validate(arena.TerrainRules.Ice);
        foreach (var cell in arena.Cells)
        {
            if (cell is null || cell.X < 0 || cell.Y < 0 ||
                cell.X * arena.CellSize >= arena.Width || cell.Y * arena.CellSize >= arena.Height ||
                !Enum.IsDefined(cell.Surface) || !cells.TryAdd((cell.X, cell.Y), cell))
                throw new ArgumentException("Terrain cells must be unique, valid, and inside the arena.", nameof(arena));
        }
        fogCells = cells.Values.Where(cell => cell.Fog).ToArray();
    }

    public (SurfaceType Surface, bool Fog) At(Vec2 point)
    {
        var x = (int)Math.Floor(point.X / arena.CellSize);
        var y = (int)Math.Floor(point.Y / arena.CellSize);
        return cells.TryGetValue((x, y), out var cell) ? (cell.Surface, cell.Fog) : (SurfaceType.Ground, false);
    }

    public SurfaceModifiers Modifiers(SurfaceType surface) => surface switch
    {
        SurfaceType.Sand => arena.TerrainRules.Sand,
        SurfaceType.Snow => arena.TerrainRules.Snow,
        SurfaceType.Ice => arena.TerrainRules.Ice,
        _ => Ground
    };

    public bool AllowsSight(Vec2 start, Vec2 end)
    {
        var delta = end - start;
        var range = arena.TerrainRules.FogVisibilityRange;
        if (delta.Dot(delta) <= range * range) return true;
        if (At(start).Fog || At(end).Fog) return false;
        // Even observers outside the fog cannot see a distant target through it.
        return !fogCells.Any(cell => CrossesCell(start, delta, cell));
    }

    private bool CrossesCell(Vec2 start, Vec2 delta, ArenaCell cell)
    {
        var left = cell.X * arena.CellSize;
        var top = cell.Y * arena.CellSize;
        var right = Math.Min(arena.Width, left + arena.CellSize);
        var bottom = Math.Min(arena.Height, top + arena.CellSize);
        var enter = 0.0;
        var exit = 1.0;
        return Clip(start.X, delta.X, left, right) && Clip(start.Y, delta.Y, top, bottom) && enter < exit;

        bool Clip(double position, double motion, double min, double max)
        {
            // Grid cells include the top/left edge and exclude the bottom/right edge.
            if (motion == 0) return position >= min && position < max;
            var a = (min - position) / motion;
            var b = (max - position) / motion;
            enter = Math.Max(enter, Math.Min(a, b));
            exit = Math.Min(exit, Math.Max(a, b));
            return enter < exit;
        }
    }

    private static bool Positive(double value) => double.IsFinite(value) && value > 0;

    private static void Validate(SurfaceModifiers modifiers)
    {
        if (modifiers is null || !Positive(modifiers.SpeedMultiplier) || !Positive(modifiers.AccelerationMultiplier) ||
            !Positive(modifiers.DecelerationMultiplier) || !Positive(modifiers.TurnMultiplier))
            throw new ArgumentException("Surface multipliers must be finite and positive.", nameof(modifiers));
    }
}
