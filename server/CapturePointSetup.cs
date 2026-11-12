namespace BotArena;

internal static class CapturePointSetup
{
    public const string ModeDestroy = "destroy";
    public const string ModeCapturePoint = "capturePoint";

    public static readonly CaptureBase DefaultPlayerBase = new(Match.PlayerTeamId, 1.2, 4.0, 2.0, 2.0);
    public static readonly CaptureBase DefaultOpponentBase = new("opponent", 12.8, 4.0, 2.0, 2.0);

    public static IReadOnlyList<CaptureBase> DefaultBases { get; } =
        Array.AsReadOnly(new[] { DefaultPlayerBase, DefaultOpponentBase });

    public static bool IsCapturePoint(string? mode) =>
        string.Equals(mode, ModeCapturePoint, StringComparison.OrdinalIgnoreCase);

    public static CapturePointObjective CreateObjective(IReadOnlyList<CustomMatchBase>? bases) =>
        new(ResolveBases(bases));

    public static CapturePointObjective CreateObjective(IReadOnlyList<CaptureBase> bases) =>
        new(bases);

    public static IReadOnlyList<CaptureBase> ResolveBases(IReadOnlyList<CustomMatchBase>? bases)
    {
        if (bases is null || bases.Count == 0) return DefaultBases;
        return bases
            .Select(baseZone => new CaptureBase(
                baseZone.OwnerTeamId,
                baseZone.X,
                baseZone.Y,
                baseZone.Width,
                baseZone.Height))
            .ToArray();
    }

    public static string? ValidateBases(ArenaState arena, IReadOnlyList<CustomMatchBase>? bases)
    {
        if (bases is null || bases.Count == 0) return null;
        if (bases.Count != 2)
            return "Для захвата точки нужны ровно две базы.";
        var teams = new HashSet<string>(StringComparer.Ordinal);
        foreach (var zone in bases)
        {
            if (string.IsNullOrWhiteSpace(zone.OwnerTeamId) || !teams.Add(zone.OwnerTeamId))
                return "У каждой базы должен быть уникальный ownerTeamId.";
            if (zone.Width < 0.5 || zone.Height < 0.5 || zone.Width > arena.Width || zone.Height > arena.Height)
                return "Размер зоны захвата должен быть от 0.5 до размера арены.";
            if (zone.X < 0 || zone.Y < 0 ||
                zone.X + zone.Width > arena.Width ||
                zone.Y + zone.Height > arena.Height)
                return "Зоны захвата должны лежать внутри арены.";
        }

        if (!teams.Contains(Match.PlayerTeamId) || !teams.Contains("opponent"))
            return "Базы должны принадлежать командам player и opponent.";
        return null;
    }
}
