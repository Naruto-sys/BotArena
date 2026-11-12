using System.Text.Json.Serialization;

namespace BotArena;

public readonly record struct Vec2(double X, double Y)
{
    public static Vec2 operator +(Vec2 a, Vec2 b) => new(a.X + b.X, a.Y + b.Y);
    public static Vec2 operator -(Vec2 a, Vec2 b) => new(a.X - b.X, a.Y - b.Y);
    public static Vec2 operator *(Vec2 a, double scale) => new(a.X * scale, a.Y * scale);
    public double Dot(Vec2 other) => X * other.X + Y * other.Y;
    public static Vec2 FromAngle(double angle) => new(Math.Cos(angle), Math.Sin(angle));
}

public record Wall(double X, double Y, double Width, double Height);
public record ArenaState(double Width, double Height, IReadOnlyList<Wall> Walls)
{
    public double CellSize { get; init; } = 1;
    public IReadOnlyList<ArenaCell> Cells { get; init; } = [];
    public TerrainRules TerrainRules { get; init; } = new();
    public void ValidateTerrain() => _ = new TerrainMap(this);
}
[JsonConverter(typeof(JsonStringEnumConverter<WeaponType>))]
public enum WeaponType { Cannon, Mortar, Gauss }

[JsonConverter(typeof(JsonStringEnumConverter<WeaponChargeStage>))]
public enum WeaponChargeStage { None, Charging, Ready }

public record BotState(string Id, string TeamId, Vec2 Position, double BodyAngle, double TurretAngle,
    double Speed, int Hp, int MaxHp, double ReloadingTime, WeaponType Weapon = WeaponType.Cannon,
    WeaponChargeStage ChargeStage = WeaponChargeStage.None, double ChargeProgress = 0,
    SurfaceType Surface = SurfaceType.Ground, bool InFog = false)
{
    public Vec2 Velocity { get; init; }
    public string Movement { get; init; } = "tracked";
    public bool Forfeited { get; init; }
    public bool CanShoot => !Forfeited && Hp > 0 && ReloadingTime <= 0;
    public IReadOnlyList<ConsumableType> Inventory { get; init; } = [];
    public IReadOnlyList<ActiveEffect> ActiveEffects { get; init; } = [];
    public int ShieldHp { get; init; }
}

public record BulletState(int Id, string OwnerBotId, Vec2 Position, Vec2 Direction,
    WeaponType Weapon = WeaponType.Cannon, Vec2? TargetPoint = null, int LaunchTick = 0, int? ImpactTick = null);
[JsonConverter(typeof(JsonStringEnumConverter<GameEventType>))]
public enum GameEventType
{
    ShotFired, BotHit, BotDestroyed, ZoneDamage, MatchFinished, ProjectileLanded,
    BeamFired, WeaponChargeStarted, WeaponReady, SurfaceChanged, FogEntered, FogExited,
    ItemSpawned, ItemPickedUp, ItemUsed, EffectStarted, EffectEnded, BotRepaired, SmokeCreated, SmokeExpired,
    ControlChanged, ControlScoreChanged, BotRespawned, KillScored
}

public record GameEvent(int Tick, GameEventType Type, string? SourceBotId = null,
    string? TargetBotId = null, int? BulletId = null, Vec2? Position = null, int? Damage = null,
    Vec2? EndPosition = null, double? Radius = null, WeaponType? Weapon = null,
    SurfaceType? Surface = null, ConsumableType? ItemType = null, int? ItemId = null,
    int? Amount = null, int? ShieldDamage = null, string? TeamId = null);

public record SafeZoneState(double X, double Y, double Width, double Height);

public record GameFrame(int Tick, BotState[] Bots, BulletState[] Bullets, GameEvent[] Events, SafeZoneState? SafeZone = null)
{
    public IReadOnlyList<ItemState> Items { get; init; } = [];
    public IReadOnlyList<SmokeCloud> SmokeClouds { get; init; } = [];
    public KingOfHillState? KingOfHill { get; init; }
    public DeathmatchState? Deathmatch { get; init; }
}
public record BotObservation(int Tick, BotState Self, BotState? Enemy, BulletState[] Bullets, ArenaState Arena)
{
    public IReadOnlyList<ItemState> Items { get; init; } = [];
    public IReadOnlyList<SmokeCloud> SmokeClouds { get; init; } = [];
    public ConsumableRules ConsumableRules { get; init; } = new();
    public IReadOnlyList<BotState> Enemies { get; init; } = [];
    public IReadOnlyList<BotState> Allies { get; init; } = [];
    public SafeZoneState? SafeZone { get; init; }
    public KingOfHillState? KingOfHill { get; init; }
    public DeathmatchState? Deathmatch { get; init; }
}
public record BotAction(double LeftTrack, double RightTrack, Vec2 AimDirection, bool Shoot,
    double? TurretTurn = null, Vec2? TargetPoint = null, ConsumableType? UseItem = null)
{
    public Vec2 Thrust { get; init; }
    public double Turn { get; init; }
    public double Throttle { get; init; }
}
[JsonConverter(typeof(JsonStringEnumConverter<MatchEndReason>))]
public enum MatchEndReason { BotDestroyed, TimeLimit, BotError, ObjectiveComplete, ScoreLimit }

public record MatchResult(string? WinnerBotId, MatchEndReason Reason, int DurationTicks, string? WinnerTeamId = null)
{
    public IReadOnlyList<TeamControlScore> Scores { get; init; } = [];
    public IReadOnlyList<DeathmatchStanding> Standings { get; init; } = [];
    public IReadOnlyList<string> WinnerBotIds { get; init; } = [];
}

public abstract record MatchObjective;
public sealed record DestroyEnemyObjective : MatchObjective;
public sealed record ReachPointObjective(Vec2 Point, double Radius) : MatchObjective;
