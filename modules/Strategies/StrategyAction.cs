using System.Text.Json;

namespace BotArena;

// Both language adapters send the same sanitized action format.
internal static class StrategyAction
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static BotAction Decode(JsonElement value, BotObservation observation)
    {
        var action = value.Deserialize<BotAction>(Json)!;
        if (!value.TryGetProperty("aim", out var aim)) return action;

        if (aim.ValueKind != JsonValueKind.Object ||
            !aim.TryGetProperty("kind", out var kind) || kind.ValueKind != JsonValueKind.String)
            throw Invalid(observation.Tick);

        var mode = kind.GetString();
        foreach (var property in aim.EnumerateObject())
        {
            var allowed = property.Name == "kind" || (mode switch
            {
                "at" => property.Name == "target",
                "scan" => property.Name is "speed" or "direction",
                _ => false
            });
            if (!allowed) throw Invalid(observation.Tick);
        }

        switch (mode)
        {
            case "hold":
                return action with { AimDirection = default, TurretTurn = null };
            case "at":
                if (!aim.TryGetProperty("target", out var target) || target.ValueKind != JsonValueKind.Object ||
                    !Number(target, "x", out var x) || !Number(target, "y", out var y))
                    throw Invalid(observation.Tick);
                var direction = new Vec2(x, y) - observation.Self.Position;
                if (!double.IsFinite(direction.X) || !double.IsFinite(direction.Y))
                    throw Invalid(observation.Tick);
                return action with { AimDirection = direction, TurretTurn = null };
            case "scan":
                var speed = 0.5;
                if (aim.TryGetProperty("speed", out _) && !Number(aim, "speed", out speed))
                    throw Invalid(observation.Tick);
                if (speed <= 0 || speed > 1) throw Invalid(observation.Tick);
                var rotation = "clockwise";
                if (aim.TryGetProperty("direction", out var requested))
                {
                    if (requested.ValueKind != JsonValueKind.String) throw Invalid(observation.Tick);
                    rotation = requested.GetString();
                }
                if (rotation is not ("clockwise" or "counterclockwise")) throw Invalid(observation.Tick);
                return action with
                {
                    AimDirection = default,
                    TurretTurn = rotation == "clockwise" ? speed : -speed
                };
            default:
                throw Invalid(observation.Tick);
        }
    }

    private static bool Number(JsonElement value, string name, out double number)
    {
        number = 0;
        return value.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.Number &&
            property.TryGetDouble(out number) && double.IsFinite(number);
    }

    private static StrategyException Invalid(int tick) => new(
        "Некорректная команда aim. Используйте bot.scan({speed: 0.5, direction: 'clockwise'}), bot.aimAt({x, y}) или bot.holdAim().", tick);
}
