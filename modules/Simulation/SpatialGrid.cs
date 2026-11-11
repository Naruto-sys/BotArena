namespace BotArena;

internal readonly record struct Bounds(double MinX, double MinY, double MaxX, double MaxY)
{
    public Bounds Union(Bounds other) => new(
        Math.Min(MinX, other.MinX), Math.Min(MinY, other.MinY),
        Math.Max(MaxX, other.MaxX), Math.Max(MaxY, other.MaxY));
}

internal sealed class SpatialGrid
{
    private const double CellSize = 2;
    private const long LastCell = 1L << 52;
    private const int MaxCellsPerEntry = 64;
    private readonly Dictionary<(long X, long Y), List<int>> cells = new();
    private readonly List<int> oversized = [];

    public void Add(int index, Bounds bounds)
    {
        var range = CellRange.From(bounds);
        if (range.Count > MaxCellsPerEntry)
        {
            oversized.Add(index);
            return;
        }
        foreach (var cell in range.Cells())
        {
            if (!cells.TryGetValue(cell, out var entries))
                cells.Add(cell, entries = []);
            entries.Add(index);
        }
    }

    public void Find(Bounds bounds, HashSet<int> candidates)
    {
        candidates.Clear();
        candidates.UnionWith(oversized);
        var range = CellRange.From(bounds);
        // A long sweep may cross mostly empty cells. Scan the occupied cells in that case.
        if (range.Count > cells.Count)
        {
            foreach (var (cell, entries) in cells)
                if (range.Contains(cell)) candidates.UnionWith(entries);
            return;
        }
        foreach (var cell in range.Cells())
            if (cells.TryGetValue(cell, out var entries))
                candidates.UnionWith(entries);
    }

    private readonly record struct CellRange(long MinX, long MinY, long MaxX, long MaxY)
    {
        public double Count => (double)(MaxX - MinX + 1) * (MaxY - MinY + 1);

        public static CellRange From(Bounds bounds) => new(
            Cell(bounds.MinX), Cell(bounds.MinY), Cell(bounds.MaxX), Cell(bounds.MaxY));

        // Coalesce extreme coordinates into edge cells. This can add candidates,
        // but the exact hitbox test still decides whether they intersect.
        private static long Cell(double coordinate) =>
            (long)Math.Clamp(Math.Floor(coordinate / CellSize), -LastCell, LastCell);

        public bool Contains((long X, long Y) cell) =>
            cell.X >= MinX && cell.X <= MaxX && cell.Y >= MinY && cell.Y <= MaxY;

        public IEnumerable<(long, long)> Cells()
        {
            for (var x = MinX; x <= MaxX; x++)
                for (var y = MinY; y <= MaxY; y++)
                    yield return (x, y);
        }
    }
}
