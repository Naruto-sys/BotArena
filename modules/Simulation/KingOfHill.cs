using System.Text.Json.Serialization;

namespace BotArena;

[JsonConverter(typeof(JsonStringEnumConverter<MatchMode>))]
public enum MatchMode { Elimination, KingOfHill, Deathmatch }

public record ControlZone(Vec2 Center, double Radius);
public record KingOfHillRules(ControlZone Zone)
{
    public int ScoreLimit { get; init; } = 30;
    public double RespawnSeconds { get; init; } = 5;
}
public record TeamControlScore(string TeamId, double Score);
public record RespawnState(string BotId, double SecondsRemaining, bool WaitingForSpace);
public record KingOfHillState(ControlZone Zone, int ScoreLimit, string? ControllingTeamId,
    bool Contested, IReadOnlyList<TeamControlScore> Scores, IReadOnlyList<RespawnState> Respawns);

public sealed partial class Duel
{
    private readonly Dictionary<string, int> controlTicks = new(StringComparer.Ordinal);
    private string? controllingTeam;
    private bool controlContested;

    private void InitializeKingOfHill()
    {
        if (config.Mode != MatchMode.KingOfHill) return;
        var rules = config.KingOfHill ?? throw new ArgumentException("KingOfHill rules are required.");
        var zone = rules.Zone;
        if (zone is null || !double.IsFinite(zone.Center.X) || !double.IsFinite(zone.Center.Y) ||
            !double.IsFinite(zone.Radius) || zone.Radius <= 0 ||
            zone.Center.X < zone.Radius || zone.Center.Y < zone.Radius ||
            zone.Center.X + zone.Radius > config.Arena.Width || zone.Center.Y + zone.Radius > config.Arena.Height ||
            rules.ScoreLimit <= 0 || rules.ScoreLimit > int.MaxValue / config.TickRate ||
            !double.IsFinite(rules.RespawnSeconds) || rules.RespawnSeconds <= 0 ||
            rules.RespawnSeconds * config.TickRate > int.MaxValue - (double)config.MaxTicks)
            throw new ArgumentException("Invalid KingOfHill zone, score limit or respawn delay.");
        if (walls.Any(wall => wall.DistanceSquaredTo(zone.Center) <= zone.Radius * zone.Radius))
            throw new ArgumentException("The control zone must be clear of walls.");
        var teams = bots.GroupBy(bot => bot.TeamId).ToArray();
        if (teams.Length != 2 || teams[0].Count() != teams[1].Count() || teams[0].Count() is < 1 or > 2)
            throw new ArgumentException("KingOfHill requires 1v1 or 2v2 teams.");
        foreach (var team in teams) controlTicks.Add(team.Key, 0);
        if (bots.Any(bot => InControlZone(bot.Position)))
            throw new ArgumentException("KingOfHill spawns must be outside the control zone.");
    }

    private bool InControlZone(Vec2 point)
    {
        var zone = config.KingOfHill!.Zone;
        var delta = point - zone.Center;
        return delta.Dot(delta) <= zone.Radius * zone.Radius;
    }

    private TeamControlScore[] ControlScores() => controlTicks.OrderBy(entry => entry.Key, StringComparer.Ordinal)
        .Select(entry => new TeamControlScore(entry.Key, entry.Value / (double)config.TickRate)).ToArray();

    private KingOfHillState? CaptureKingOfHill() => config.Mode != MatchMode.KingOfHill ? null :
        new(config.KingOfHill!.Zone, config.KingOfHill.ScoreLimit, controllingTeam, controlContested, ControlScores(),
            CaptureRespawns());

    private void UpdateKingOfHill()
    {
        var rules = config.KingOfHill!;
        // Deaths are resolved before control: a destroyed tank cannot contest this tick.
        ScheduleRespawns(rules.RespawnSeconds);

        var occupants = bots.Where((bot, i) => IsActive(i) && InControlZone(bot.Position))
            .Select(bot => bot.TeamId).Distinct().ToArray();
        var owner = occupants.Length == 1 ? occupants[0] : null;
        var contested = occupants.Length > 1;
        if (owner != controllingTeam || contested != controlContested)
            events.Add(new(tick, GameEventType.ControlChanged, Position: rules.Zone.Center,
                Radius: rules.Zone.Radius, TeamId: owner));
        controllingTeam = owner;
        controlContested = contested;
        if (owner is not null)
        {
            controlTicks[owner]++;
            if (controlTicks[owner] % config.TickRate == 0)
                events.Add(new(tick, GameEventType.ControlScoreChanged, TeamId: owner,
                    Amount: controlTicks[owner] / config.TickRate));
        }

        if (controlTicks.Values.Any(value => value >= rules.ScoreLimit * config.TickRate))
            FinishKingOfHill(MatchEndReason.ScoreLimit);
        else if (tick >= config.MaxTicks)
            FinishKingOfHill(MatchEndReason.TimeLimit);
        else
            RespawnBots(index => config.Spawns.Where(spawn => spawn.ResolvedTeamId == bots[index].TeamId)
                .Select(spawn => new RespawnPoint(spawn.Id, spawn.Position, spawn.BodyAngle, spawn.TurretAngle)), false);
    }

    private void FinishKingOfHill(MatchEndReason reason, string? technicalWinner = null)
    {
        var leaders = controlTicks.Where(entry => entry.Value == controlTicks.Values.Max()).ToArray();
        var winner = reason == MatchEndReason.BotError ? technicalWinner : leaders.Length == 1 ? leaders[0].Key : null;
        var representative = bots.FirstOrDefault(bot => bot.TeamId == winner && !bot.Forfeited);
        Finish(new(representative?.Id, reason, tick, winner) { Scores = ControlScores() });
    }

    private bool FinishIfKingOfHillForfeited()
    {
        var eligible = bots.Where(bot => !bot.Forfeited).Select(bot => bot.TeamId).Distinct().ToArray();
        if (eligible.Length > 1) return false;
        FinishKingOfHill(MatchEndReason.BotError, eligible.FirstOrDefault());
        return true;
    }
}
