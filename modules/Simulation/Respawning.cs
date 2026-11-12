namespace BotArena;

public record RespawnPoint(string Id, Vec2 Position, double BodyAngle = 0, double TurretAngle = 0);

public sealed partial class Duel
{
    private readonly int?[] respawnAt;

    private void ScheduleRespawns(double delaySeconds)
    {
        for (var i = 0; i < bots.Length; i++)
            if (!bots[i].Forfeited && bots[i].Hp <= 0 && respawnAt[i] is null)
                respawnAt[i] = tick + (int)Math.Ceiling(delaySeconds * config.TickRate);
    }

    private RespawnState[] CaptureRespawns() => Enumerable.Range(0, bots.Length)
        .Where(i => respawnAt[i].HasValue && !bots[i].Forfeited)
        .Select(i => new RespawnState(bots[i].Id, Math.Max(0, respawnAt[i]!.Value - tick) * StepSeconds,
            respawnAt[i] <= tick)).ToArray();

    private void RespawnBots(Func<int, IEnumerable<RespawnPoint>> pointsForBot, bool requireHidden)
    {
        foreach (var index in Enumerable.Range(0, bots.Length).OrderBy(i => bots[i].Id, StringComparer.Ordinal))
        {
            if (respawnAt[index] is not { } due || due > tick || bots[index].Forfeited) continue;
            var bot = bots[index];
            var candidates = pointsForBot(index).OrderBy(point => point.Id, StringComparer.Ordinal)
                .Select(point => OnTerrain(bot with
                {
                    Position = point.Position, BodyAngle = point.BodyAngle, TurretAngle = point.TurretAngle,
                    Hp = bot.MaxHp, Speed = 0, Velocity = default, ReloadingTime = 0,
                    ChargeStage = bot.Weapon == WeaponType.Gauss ? WeaponChargeStage.Ready : WeaponChargeStage.None,
                    ChargeProgress = bot.Weapon == WeaponType.Gauss ? 1 : 0,
                    Inventory = [], ActiveEffects = [], ShieldHp = 0,
                })).Where(candidate => Inside(Body(candidate)) && WallImpact(Body(candidate), default) > 1 &&
                    !bots.Where((_, i) => IsActive(i)).Any(other =>
                        Body(candidate).Impact(Body(other), default) <= 1 ||
                        requireHidden && other.TeamId != bot.TeamId &&
                        WallImpact(new Hitbox(other.Position, 0, 0, 0), candidate.Position - other.Position) > 1)).ToArray();
            if (candidates.Length == 0) continue;
            bots[index] = candidates[random.Next(candidates.Length)];
            cooldowns[index] = 0;
            bodyTurnRates[index] = turretTurnRates[index] = 0;
            respawnAt[index] = null;
            events.Add(new(tick, GameEventType.BotRespawned, TargetBotId: bot.Id,
                Position: bots[index].Position, TeamId: bot.TeamId));
        }
    }
}
