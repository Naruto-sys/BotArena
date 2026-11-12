using System.Text.Json.Serialization;

namespace BotArena;

[JsonConverter(typeof(JsonStringEnumConverter<ConsumableType>))]
public enum ConsumableType { Repair, Shield, SpeedBoost, Coolant, Smoke }

public record ItemState(int Id, ConsumableType Type, Vec2 Position);
public record ConsumableSpawn(ConsumableType Type, Vec2 Position);
public record ActiveEffect(ConsumableType Type, int ExpiresAtTick);
public record SmokeCloud(int Id, string OwnerBotId, Vec2 Position, double Radius, int ExpiresAtTick);

public sealed record ConsumableRules
{
    public bool Enabled { get; init; }
    public int InitialCount { get; init; } = 3;
    public int MaxOnField { get; init; } = 6;
    public int InventoryCapacity { get; init; } = 2;
    public double PickupRadius { get; init; } = 0.65;
    public double MinSpawnSeconds { get; init; } = 1;
    public double MaxSpawnSeconds { get; init; } = 2;
    public int RepairAmount { get; init; } = 30;
    public int ShieldAmount { get; init; } = 40;
    public double ShieldDurationSeconds { get; init; } = 4;
    public double SpeedMultiplier { get; init; } = 1.4;
    public double BoostDurationSeconds { get; init; } = 3;
    public int CooldownRecoveryTicks { get; init; } = 2;
    public double CoolantDurationSeconds { get; init; } = 3;
    public double SmokeRadius { get; init; } = 1.75;
    public double SmokeVisibilityRange { get; init; } = 2;
    public double SmokeDurationSeconds { get; init; } = 3;
    public IReadOnlyList<ConsumableType> AllowedTypes { get; init; } =
        Array.AsReadOnly(Enum.GetValues<ConsumableType>());
}
