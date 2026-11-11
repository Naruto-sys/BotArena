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
public record ArenaState(double Width, double Height, IReadOnlyList<Wall> Walls);
public record BotState(string Id, string TeamId, Vec2 Position, double BodyAngle, double TurretAngle,
    double Speed, int Hp, int MaxHp, double ReloadingTime)
{
    public Vec2 Velocity { get; init; }
    public string Movement { get; init; } = "tracked";
    public bool Forfeited { get; init; }
    public bool CanShoot => !Forfeited && Hp > 0 && ReloadingTime <= 0;
}

public record BulletState(int Id, string OwnerBotId, Vec2 Position, Vec2 Direction);
[JsonConverter(typeof(JsonStringEnumConverter<GameEventType>))]
public enum GameEventType { ShotFired, BotHit, BotDestroyed, ZoneDamage, MatchFinished }

public record GameEvent(int Tick, GameEventType Type, string? SourceBotId = null,
    string? TargetBotId = null, int? BulletId = null, Vec2? Position = null, int? Damage = null);

public record SafeZoneState(double X, double Y, double Width, double Height);

public record GameFrame(int Tick, BotState[] Bots, BulletState[] Bullets, GameEvent[] Events,
    SafeZoneState? SafeZone = null);
public record BotObservation(int Tick, BotState Self, BotState? Enemy, BulletState[] Bullets, ArenaState Arena)
{
    public IReadOnlyList<BotState> Enemies { get; init; } = [];
    public SafeZoneState? SafeZone { get; init; }
}
public record BotAction(double LeftTrack, double RightTrack, Vec2 AimDirection, bool Shoot,
    double? TurretTurn = null)
{
    public Vec2 Thrust { get; init; }
    public double Turn { get; init; }
    public double Throttle { get; init; }
}
[JsonConverter(typeof(JsonStringEnumConverter<MatchEndReason>))]
public enum MatchEndReason { BotDestroyed, TimeLimit, BotError, ObjectiveComplete }

public record MatchResult(string? WinnerBotId, MatchEndReason Reason, int DurationTicks, string? WinnerTeamId = null);

public abstract record MatchObjective;

public sealed record DestroyEnemyObjective : MatchObjective;

public sealed record ReachPointObjective(Vec2 Point, double Radius) : MatchObjective;
