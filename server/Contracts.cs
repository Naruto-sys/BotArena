namespace BotArena;

public record BehaviorSample(int Tick, string BotId, Vec2 Position, double BodyAngle, double TurretAngle,
    bool EnemyVisible, BotAction Action);
public record ReachMarker(double X, double Y, double Radius);
public record MatchReplay(
    int TickRate,
    ArenaState Arena,
    IReadOnlyList<GameFrame> Frames,
    MatchResult Result,
    IReadOnlyList<BehaviorSample> BehaviorSamples,
    ReachMarker? Marker = null);
public record CustomMatchSpawn(
    string Id,
    string TeamId,
    double X,
    double Y,
    double BodyAngle = 0,
    double TurretAngle = 0,
    int Hp = 100,
    string? Movement = null);
public record CustomMatchLoadout(
    string BotId,
    string Source,
    string? PresetId = null,
    string? Code = null);
public record CustomMatchBase(string OwnerTeamId, double X, double Y, double Width, double Height);

public record CustomMatchSpec(
    ArenaState Arena,
    IReadOnlyList<CustomMatchSpawn> Spawns,
    IReadOnlyList<CustomMatchLoadout> Loadouts,
    int? MaxTicks = null,
    string? Mode = null,
    IReadOnlyList<CustomMatchBase>? Bases = null);
public record MatchRequest(
    string? BotCode,
    string? OpponentId = null,
    string? Language = null,
    string? OpponentCode = null,
    string? OpponentLanguage = null,
    string? PveLevelId = null,
    ArenaState? CustomArena = null,
    string? Movement = null,
    OpponentSlot?[]? Opponents = null,
    string? CampaignLevelId = null,
    Dictionary<string, string>? BotCodes = null,
    CustomMatchSpec? CustomMatch = null);
public record OpponentSlot(string? Id, string? Movement = null);
public record ScriptError(string BotId, int? Tick, string Message, int? Line = null, int? Column = null);
public record MatchResponse(MatchReplay Replay, ScriptError? Error = null, IReadOnlyList<StrategyLogLine>? Logs = null);
public record Opponent(string Id, string Name, string Description);
