namespace BotArena;

public record DeathmatchRules
{
    public int ScoreLimit { get; init; } = 10;
    public double RespawnSeconds { get; init; } = 5;
    public IReadOnlyList<RespawnPoint> RespawnPoints { get; init; } = [];
}

public record DeathmatchStanding(string BotId, int Kills, int Deaths, bool Alive, bool Forfeited,
    double? RespawnSecondsRemaining, bool WaitingForSpace)
{
    public int Score => Kills;
}
public record DeathmatchState(int ScoreLimit, IReadOnlyList<DeathmatchStanding> Standings);

public sealed partial class Duel
{
    private int[] kills = [];
    private int[] deaths = [];

    private void InitializeDeathmatch()
    {
        if (config.Mode != MatchMode.Deathmatch) return;
        var rules = config.Deathmatch ?? throw new ArgumentException("Deathmatch rules are required.");
        if (bots.Length is < 4 or > 6 || bots.Select(bot => bot.TeamId).Distinct().Count() != bots.Length)
            throw new ArgumentException("Deathmatch requires 4–6 participants with distinct teams.");
        if (rules.ScoreLimit <= 0 || !double.IsFinite(rules.RespawnSeconds) || rules.RespawnSeconds <= 0 ||
            rules.RespawnSeconds * config.TickRate > int.MaxValue - (double)config.MaxTicks ||
            rules.RespawnPoints is null || rules.RespawnPoints.Count < bots.Length || rules.RespawnPoints.Count > 64)
            throw new ArgumentException("Invalid Deathmatch score limit, respawn delay or spawn pool.");
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var positions = new HashSet<Vec2>();
        var margin = Math.Sqrt(config.BotLength * config.BotLength + config.BotWidth * config.BotWidth) / 2 + 0.05;
        foreach (var point in rules.RespawnPoints)
        {
            if (point is null || string.IsNullOrWhiteSpace(point.Id) || !ids.Add(point.Id) || !positions.Add(point.Position) ||
                !double.IsFinite(point.Position.X) || !double.IsFinite(point.Position.Y) ||
                !double.IsFinite(point.BodyAngle) || !double.IsFinite(point.TurretAngle))
                throw new ArgumentException("Deathmatch respawn points must be finite and unique.");
            var clearance = new Hitbox(point.Position, 0, margin * 2, margin * 2);
            if (!Inside(clearance) || WallImpact(clearance, default) <= 1)
                throw new ArgumentException("Deathmatch respawn points need clearance from walls and arena edges.");
        }
        kills = new int[bots.Length];
        deaths = new int[bots.Length];
    }

    private DeathmatchState? CaptureDeathmatch() => config.Mode != MatchMode.Deathmatch ? null :
        new(config.Deathmatch!.ScoreLimit, Enumerable.Range(0, bots.Length)
            .Select(i => new DeathmatchStanding(bots[i].Id, kills[i], deaths[i], IsActive(i), bots[i].Forfeited,
                respawnAt[i] is { } due ? Math.Max(0, due - tick) * StepSeconds : null,
                respawnAt[i] <= tick)).ToArray());

    private void RecordDeathmatchDeath(int targetIndex, string? attackerId)
    {
        if (config.Mode != MatchMode.Deathmatch) return;
        deaths[targetIndex]++;
        if (attackerId is not null && attackerId != bots[targetIndex].Id)
        {
            var attacker = FindBot(attackerId);
            kills[attacker]++;
            events.Add(new(tick, GameEventType.KillScored, attackerId, bots[targetIndex].Id,
                Amount: kills[attacker]));
        }
    }

    private void UpdateDeathmatch()
    {
        ScheduleRespawns(config.Deathmatch!.RespawnSeconds);
        // Every projectile resolves before evaluating scores, including mutual/posthumous kills.
        if (kills.Where((_, i) => !bots[i].Forfeited).Any(score => score >= config.Deathmatch.ScoreLimit))
            FinishDeathmatch(MatchEndReason.ScoreLimit);
        else if (tick >= config.MaxTicks)
            FinishDeathmatch(MatchEndReason.TimeLimit);
        else
            RespawnBots(_ => config.Deathmatch.RespawnPoints, true);
    }

    private void FinishDeathmatch(MatchEndReason reason)
    {
        var eligible = Enumerable.Range(0, bots.Length).Where(i => !bots[i].Forfeited).ToArray();
        var leaders = eligible.Length == 0 ? [] : eligible.Where(i => kills[i] == eligible.Max(j => kills[j])).ToArray();
        var winners = leaders.Select(i => bots[i].Id).Order(StringComparer.Ordinal).ToArray();
        var soleWinner = leaders.Length == 1 ? bots[leaders[0]] : null;
        Finish(new(soleWinner?.Id, reason, tick, soleWinner?.TeamId)
        {
            WinnerBotIds = winners,
            Standings = CaptureDeathmatch()!.Standings,
        });
    }

    private void FinishIfDeathmatchForfeited()
    {
        if (bots.Count(bot => !bot.Forfeited) <= 1) FinishDeathmatch(MatchEndReason.BotError);
    }
}
