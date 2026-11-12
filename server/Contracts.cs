namespace BotArena;

public record MatchReplay(int TickRate, ArenaState Arena, IReadOnlyList<GameFrame> Frames, MatchResult Result)
{
    public int RandomSeed { get; init; }
}
public record MatchRequest(string? BotCode, string? OpponentId, string? Language = null);
public record ScriptError(string BotId, int? Tick, string Message, int? Line = null, int? Column = null);
public record MatchResponse(MatchReplay Replay, ScriptError? Error = null);
public record Opponent(string Id, string Name, string Description);
