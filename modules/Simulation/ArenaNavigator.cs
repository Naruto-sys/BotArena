namespace BotArena;

public sealed class ArenaNavigator(MatchConfig config)
{
    // Allow any hull orientation plus a small margin for tracking the path.
    private readonly double clearance = Clearance(config);
    private const double CornerGap = 0.12;
    private readonly Area[] obstacles = config.Arena.Walls.Select(wall => new Area(
        wall.X - Clearance(config), wall.Y - Clearance(config),
        wall.X + wall.Width + Clearance(config), wall.Y + wall.Height + Clearance(config))).ToArray();
    private readonly Hitbox[] physicalWalls = config.Arena.Walls.Select(wall => new Hitbox(
        new(wall.X + wall.Width / 2, wall.Y + wall.Height / 2), 0, wall.Width, wall.Height)).ToArray();

    private static double Clearance(MatchConfig config) => double.Hypot(config.BotLength, config.BotWidth) / 2 + 0.075;

    public Vec2 Waypoint(BotState self, Vec2 destination)
    {
        var start = self.Position;
        var goal = Clamp(destination);
        foreach (var obstacle in obstacles)
        {
            if (obstacle.Contains(start))
                return Escape(start, obstacle, new(start, self.BodyAngle, config.BotLength, config.BotWidth));
            if (obstacle.Contains(goal))
                goal = Escape(goal, obstacle, null);
        }
        if (Clear(start, goal)) return goal;

        var nodes = new List<Vec2> { start, goal };
        foreach (var obstacle in obstacles)
        {
            var left = obstacle.Left - CornerGap;
            var right = obstacle.Right + CornerGap;
            var top = obstacle.Top - CornerGap;
            var bottom = obstacle.Bottom + CornerGap;
            Add(new(left, top));
            Add(new(left, bottom));
            Add(new(right, top));
            Add(new(right, bottom));
        }

        var distances = Enumerable.Repeat(double.PositiveInfinity, nodes.Count).ToArray();
        var next = new int[nodes.Count];
        var visited = new bool[nodes.Count];
        distances[0] = 0;
        for (var iteration = 0; iteration < nodes.Count; iteration++)
        {
            var current = -1;
            for (var i = 0; i < nodes.Count; i++)
                if (!visited[i] && (current < 0 || distances[i] < distances[current]))
                    current = i;
            if (current < 0 || !double.IsFinite(distances[current])) break;
            if (current == 1) return nodes[next[current]];

            visited[current] = true;
            for (var i = 1; i < nodes.Count; i++)
            {
                if (visited[i]) continue;
                var offset = nodes[i] - nodes[current];
                var cost = distances[current] + double.Hypot(offset.X, offset.Y);
                if (cost >= distances[i] || !Clear(nodes[current], nodes[i])) continue;
                distances[i] = cost;
                next[i] = current == 0 ? i : next[current];
            }
        }
        return start;

        void Add(Vec2 point)
        {
            if (point == Clamp(point) && !obstacles.Any(obstacle => obstacle.Contains(point))) nodes.Add(point);
        }
    }

    private bool Clear(Vec2 from, Vec2 to) => !obstacles.Any(obstacle => obstacle.Crosses(from, to));

    private Vec2 Clamp(Vec2 point) => new(
        Math.Clamp(point.X, clearance, Math.Max(clearance, config.Arena.Width - clearance)),
        Math.Clamp(point.Y, clearance, Math.Max(clearance, config.Arena.Height - clearance)));

    private Vec2 Escape(Vec2 point, Area obstacle, Hitbox? hull)
    {
        Vec2[] exits =
        [
            new(obstacle.Left - CornerGap, point.Y), new(obstacle.Right + CornerGap, point.Y),
            new(point.X, obstacle.Top - CornerGap), new(point.X, obstacle.Bottom + CornerGap),
        ];
        return exits.Where(exit => exit == Clamp(exit) && !obstacles.Any(area => area.Contains(exit)))
            .Where(exit => hull is not { } box || !physicalWalls.Any(wall => box.Impact(wall, exit - point) <= 1))
            .OrderBy(exit => (exit - point).Dot(exit - point))
            .FirstOrDefault(point);
    }

    private readonly record struct Area(double Left, double Top, double Right, double Bottom)
    {
        public bool Contains(Vec2 point) => point.X >= Left && point.X <= Right && point.Y >= Top && point.Y <= Bottom;

        public bool Crosses(Vec2 from, Vec2 to)
        {
            var wall = new Hitbox(new((Left + Right) / 2, (Top + Bottom) / 2), 0, Right - Left, Bottom - Top);
            return new Hitbox(from, 0, 0, 0).Impact(wall, to - from) <= 1;
        }
    }
}
