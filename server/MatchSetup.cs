namespace BotArena;

internal static class MatchSetup
{
    private static readonly BotSpawn[] ExtraSpawns =
    [
        new("opponent-2", new(2, 8), 0, 0),
        new("opponent-3", new(14, 2), Math.PI, Math.PI),
    ];

    public static IReadOnlyList<OpponentSlot>? GetOpponents(MatchRequest request)
    {
        var slots = request.Opponents ?? [new(request.OpponentId)];
        if (slots.Length is < 1 or > 3 ||
            slots.Any(slot => slot is null || !OpponentCatalog.Supports(slot.Id) || !MovementCatalog.Supports(slot.Movement)))
            return null;
        return slots.Select(slot => slot!).ToArray();
    }

    public static MatchConfig Configure(string? playerMovement, IReadOnlyList<OpponentSlot> opponents)
    {
        var classic = MatchConfig.Classic;
        var spawns = new List<BotSpawn> { classic.Spawns[0] with { Movement = MovementCatalog.Create(playerMovement) } };
        for (var i = 0; i < opponents.Count; i++)
        {
            var spawn = i == 0 ? classic.Spawns[1] : ExtraSpawns[i - 1];
            spawns.Add(spawn with { Movement = MovementCatalog.Create(opponents[i].Movement) });
        }
        return classic with { Spawns = spawns.AsReadOnly() };
    }
}
