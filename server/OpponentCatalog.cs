namespace BotArena;

internal static class OpponentCatalog
{
    public static IReadOnlyList<Opponent> Opponents { get; } = Array.AsReadOnly(new Opponent[]
    {
        new("aggressive", "Штурмовик", "Обходит укрытия и сближается с целью."),
        new("defensive", "Дозорный", "Меняет позицию за укрытием и стреляет при удобном угле."),
    });

    public static bool Supports(string? id) => Opponents.Any(item => item.Id == id);
}
