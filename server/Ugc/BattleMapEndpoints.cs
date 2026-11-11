using System.Security.Claims;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace BotArena;

public static class BattleMapEndpoints
{
    internal const double Width = 16;
    internal const double Height = 10;
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static void MapBattleMapEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/maps").RequireAuthorization();

        group.MapGet("/", async (ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (principal.UserId() is not { } userId) return Results.Unauthorized();
            var maps = await database.BattleMaps.AsNoTracking().Where(item => item.OwnerId == userId)
                .OrderByDescending(item => item.UpdatedAt).ToListAsync();
            return Results.Ok(maps.Select(View));
        });

        group.MapPost("/", async (SaveBattleMapRequest request, ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (principal.UserId() is not { } userId) return Results.Unauthorized();
            if (Validate(request) is { } error) return Results.BadRequest(new { error });
            var user = await database.Users.SingleAsync(item => item.Id == userId);
            var map = new BattleMap
            {
                Owner = user, OwnerId = userId, Name = request.Name.Trim(),
                WallsJson = JsonSerializer.Serialize(request.Walls, Json)
            };
            database.BattleMaps.Add(map);
            await database.SaveChangesAsync();
            return Results.Created($"/api/maps/{map.Id}", View(map));
        });

        group.MapPut("/{id:guid}", async (Guid id, SaveBattleMapRequest request, ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (principal.UserId() is not { } userId) return Results.Unauthorized();
            if (Validate(request) is { } error) return Results.BadRequest(new { error });
            var map = await database.BattleMaps.SingleOrDefaultAsync(item => item.Id == id && item.OwnerId == userId);
            if (map is null) return Results.NotFound();
            map.Name = request.Name.Trim();
            map.WallsJson = JsonSerializer.Serialize(request.Walls, Json);
            map.UpdatedAt = DateTimeOffset.UtcNow;
            await database.SaveChangesAsync();
            return Results.Ok(View(map));
        });

        group.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal principal, UgcDbContext database) =>
        {
            var deleted = await database.BattleMaps.Where(item => item.Id == id && item.OwnerId == principal.UserId())
                .ExecuteDeleteAsync();
            return deleted == 0 ? Results.NotFound() : Results.NoContent();
        });
    }

    internal static string? Validate(SaveBattleMapRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Trim().Length > 80)
            return "Название карты должно содержать от 1 до 80 символов.";
        if (request.Walls.Count > 20) return "На карте может быть не больше 20 препятствий.";
        var walls = request.Walls;
        for (var index = 0; index < walls.Count; index++)
        {
            var wall = walls[index];
            if (!Finite(wall.X, wall.Y, wall.Width, wall.Height)) return "Координаты препятствий должны быть конечными числами.";
            if (wall.Width is < .4 or > 5 || wall.Height is < .4 or > 5)
                return "Размер каждого препятствия должен быть от 0,4 до 5 клеток.";
            if (wall.X < .2 || wall.Y < .2 || wall.X + wall.Width > Width - .2 || wall.Y + wall.Height > Height - .2)
                return "Оставьте не меньше 0,2 клетки между препятствием и границей карты.";
            if (HitsSpawn(wall, 2, 5) || HitsSpawn(wall, 14, 5))
                return "Препятствие перекрывает безопасную зону старта игрока.";
            if (walls.Take(index).Any(other => Overlaps(wall, other, .15)))
                return "Препятствия не должны пересекаться или соприкасаться.";
        }
        if (walls.Sum(wall => wall.Width * wall.Height) > Width * Height * .32)
            return "Препятствия занимают слишком большую часть карты.";
        if (!HasRoute(walls)) return "Карта полностью разделена препятствиями: между стартами должен оставаться проход.";
        return null;
    }

    internal static ArenaState Arena(IReadOnlyList<Wall> walls) => new(Width, Height, walls);

    private static bool HasRoute(IReadOnlyList<Wall> walls)
    {
        const double cell = .25;
        var columns = (int)(Width / cell);
        var rows = (int)(Height / cell);
        var start = ((int)(2 / cell), (int)(5 / cell));
        var target = ((int)(14 / cell), (int)(5 / cell));
        var queue = new Queue<(int X, int Y)>();
        var visited = new HashSet<(int X, int Y)> { start };
        queue.Enqueue(start);
        while (queue.Count > 0)
        {
            var point = queue.Dequeue();
            if (point == target) return true;
            foreach (var next in new[] { (point.X + 1, point.Y), (point.X - 1, point.Y), (point.X, point.Y + 1), (point.X, point.Y - 1) })
            {
                if (next.Item1 < 2 || next.Item2 < 2 || next.Item1 >= columns - 2 || next.Item2 >= rows - 2 || visited.Contains(next)) continue;
                var x = (next.Item1 + .5) * cell;
                var y = (next.Item2 + .5) * cell;
                if (walls.Any(wall => x >= wall.X - .42 && x <= wall.X + wall.Width + .42
                    && y >= wall.Y - .42 && y <= wall.Y + wall.Height + .42)) continue;
                visited.Add(next); queue.Enqueue(next);
            }
        }
        return false;
    }

    private static bool HitsSpawn(Wall wall, double x, double y) =>
        x >= wall.X - 1 && x <= wall.X + wall.Width + 1 && y >= wall.Y - 1 && y <= wall.Y + wall.Height + 1;
    private static bool Overlaps(Wall a, Wall b, double gap) => a.X < b.X + b.Width + gap && a.X + a.Width + gap > b.X
        && a.Y < b.Y + b.Height + gap && a.Y + a.Height + gap > b.Y;
    private static bool Finite(params double[] values) => values.All(double.IsFinite);
    private static object View(BattleMap map) => new
    {
        map.Id, map.Name, width = Width, height = Height,
        walls = JsonSerializer.Deserialize<List<Wall>>(map.WallsJson, Json) ?? [], map.CreatedAt, map.UpdatedAt
    };
}

public sealed record SaveBattleMapRequest(string Name, List<Wall> Walls);
