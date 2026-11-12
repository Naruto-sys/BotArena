namespace BotArena;

internal static class MovementCatalog
{
    private const string Default = "tracked";
    private static readonly Dictionary<string, Func<IMovementModel?>> Models = new(StringComparer.Ordinal)
    {
        [Default] = () => null,
        ["hover"] = () => new HoverMovement(),
        ["wheeled"] = () => new WheeledMovement(),
        ["omni"] = () => new OmniMovement(),
    };

    public static bool Supports(string? id) => Models.ContainsKey(id ?? Default);

    public static IMovementModel? Create(string? id) => Models[id ?? Default]();
}
