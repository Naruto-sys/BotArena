namespace BotArena;

public record BotSpawn(string Id, Vec2 Position, double BodyAngle, double TurretAngle, string TeamId = "", int Hp = 100)
{
    public IMovementModel? Movement { get; init; }
    public string ResolvedTeamId => string.IsNullOrWhiteSpace(TeamId) ? Id : TeamId;
    public int ResolvedHp => Math.Clamp(Hp <= 0 ? 100 : Hp, 1, 500);
}

public sealed record MatchConfig(int TickRate, int MaxTicks, ArenaState Arena, IReadOnlyList<BotSpawn> Spawns)
{
    public double MaxForwardSpeed { get; init; } = 3.6;
    public double MaxReverseSpeed { get; init; } = 2.0;
    public double Acceleration { get; init; } = 8.0;
    public double Deceleration { get; init; } = 12.0;
    public double MaxTurnSpeed { get; init; } = 3.0;
    public double TurnResponseSeconds { get; init; } = 0.20;
    public double MaxTurretTurnSpeed { get; init; } = 6.0;
    public double BotLength { get; init; } = 0.68;
    public double BotWidth { get; init; } = 0.58;
    public double BulletLength { get; init; } = 0.19;
    public double BulletWidth { get; init; } = 0.09;
    public double BulletSpeed { get; init; } = 13.0;
    public int BulletDamage { get; init; } = 20;
    public int ShotCooldownTicks { get; init; } = 12;
    public bool ShrinkZoneEnabled { get; init; } = true;
    public double ShrinkStartSeconds { get; init; } = 10;
    public int ShrinkOutsideDamagePerSecond { get; init; } = 10;
    public double ShrinkDurationSeconds { get; init; } = 20;
    public double ShrinkFinalScale { get; init; } = 0;

    public static MatchConfig Classic { get; } = new(20, 1000, new(16, 10, Array.AsReadOnly(new Wall[]
    {
        new(4.5, 1.9, 2.0, 1.3),
        new(7.25, 4.15, 1.5, 1.7),
        new(9.5, 6.8, 2.0, 1.3)
    })), Array.AsReadOnly(new BotSpawn[]
    {
        new("player", new(2, 5), 0, 0, "player"),
        new("opponent", new(14, 5), Math.PI, Math.PI, "opponent")
    }));
}

public interface ISimulationEngine
{
    BotObservation Observe(string botId);
    void Step(IReadOnlyDictionary<string, BotAction> actions);
    GameFrame CaptureFrame();
    MatchResult? Result { get; }
}

public sealed class Duel : ISimulationEngine
{
    private readonly MatchConfig config;
    private double StepSeconds => 1.0 / config.TickRate;
    private BotState[] bots;
    private readonly Dictionary<string, int> indices = new(StringComparer.Ordinal);
    private readonly Hitbox[] walls;
    private readonly List<BulletState> bullets = [];
    private readonly List<GameEvent> events = [];
    private readonly int[] cooldowns;
    private readonly IMovementModel[] movement;
    private readonly double[] bodyTurnRates;
    private readonly double[] turretTurnRates;
    private int nextBullet;
    private int tick;

    public Duel(MatchConfig config)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(config.TickRate);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(config.MaxTicks);
        if (config.Spawns.Count < 2)
            throw new ArgumentException("At least two robot spawns are required.", nameof(config));
        this.config = config;
        var tracked = new TrackedMovement(config);
        movement = config.Spawns.Select(spawn => spawn.Movement ?? tracked).ToArray();
        bots = config.Spawns.Select((s, i) =>
        {
            var hp = s.ResolvedHp;
            return new BotState(s.Id, s.ResolvedTeamId, s.Position, s.BodyAngle, s.TurretAngle, 0, hp, hp, 0)
            {
                Movement = movement[i].Id,
            };
        }).ToArray();
        walls = config.Arena.Walls.Select(w =>
            new Hitbox(new(w.X + w.Width / 2, w.Y + w.Height / 2), 0, w.Width, w.Height)).ToArray();
        cooldowns = new int[bots.Length];
        bodyTurnRates = new double[bots.Length];
        turretTurnRates = new double[bots.Length];
        var grid = new SpatialGrid();
        var neighbors = new HashSet<int>();
        for (var i = 0; i < bots.Length; i++)
        {
            if (string.IsNullOrWhiteSpace(bots[i].Id) || !indices.TryAdd(bots[i].Id, i))
                throw new ArgumentException("Robot IDs must be non-empty and unique.", nameof(config));
            var hull = Body(bots[i]);
            if (!Inside(hull) || WallImpact(hull, default) <= 1)
                throw new ArgumentException("Robot spawns must be clear of walls and inside the arena.", nameof(config));
            var bounds = hull.Bounds();
            grid.Find(bounds, neighbors);
            if (neighbors.Any(j => hull.Impact(Body(bots[j]), default) <= 1))
                throw new ArgumentException("Robot spawns must not overlap.", nameof(config));
            grid.Add(i, bounds);
        }
    }

    public MatchResult? Result { get; private set; }

    public BotObservation Observe(string botId)
    {
        var self = bots[FindBot(botId)];
        var sightLine = new Hitbox(self.Position, 0, 0, 0);
        var enemies = new List<BotState>();
        BotState? nearest = null;
        var nearestDistance = double.PositiveInfinity;
        for (var i = 0; i < bots.Length; i++)
        {
            var candidate = bots[i];
            if (candidate.Id == botId || !IsActive(i) || candidate.TeamId == self.TeamId) continue;
            var offset = candidate.Position - self.Position;
            if (WallImpact(sightLine, offset) <= 1) continue;
            enemies.Add(candidate);
            var distance = double.Hypot(offset.X, offset.Y);
            if (nearest is null || distance < nearestDistance)
            {
                nearest = candidate;
                nearestDistance = distance;
            }
        }

        return new(tick, self, nearest, [.. bullets], config.Arena)
        {
            Enemies = enemies.AsReadOnly(),
            SafeZone = CurrentSafeZone(),
        };
    }

    public GameFrame CaptureFrame() => new(tick, [.. bots], [.. bullets], [.. events], CurrentSafeZone());

    public void Step(IReadOnlyDictionary<string, BotAction> actions)
    {
        EnsureRunning();
        var commands = new BotAction?[bots.Length];
        for (var i = 0; i < bots.Length; i++)
        {
            if (IsActive(i))
                commands[i] = actions[bots[i].Id];
        }
        events.Clear();
        tick++;

        var next = (BotState[])bots.Clone();
        for (var i = 0; i < bots.Length; i++)
            if (commands[i] is { } action) next[i] = Advance(i, action);
        ResolveMovement(next);
        bots = next;

        for (var i = 0; i < bots.Length; i++)
            if (commands[i] is { } action) Fire(i, action);
        AdvanceBullets();
        ApplyShrinkZoneDamage();

        if (!FinishIfEliminated(MatchEndReason.BotDestroyed) && tick == config.MaxTicks)
            Finish(new(null, MatchEndReason.TimeLimit, tick));
    }

    public void Forfeit(string botId) => ForfeitAll([botId]);

    public void ForfeitAll(IEnumerable<string> botIds)
    {
        EnsureRunning();
        var failed = botIds.Select(FindBot).ToArray();
        foreach (var index in failed)
        {
            if (!IsActive(index)) continue;
            bots[index] = bots[index] with { Forfeited = true, Speed = 0, Velocity = default };
        }
        FinishIfEliminated(MatchEndReason.BotError);
    }

    public void CompleteObjective(string winnerBotId)
    {
        EnsureRunning();
        var winner = bots[FindBot(winnerBotId)];
        Finish(new(winnerBotId, MatchEndReason.ObjectiveComplete, tick, winner.TeamId));
    }

    public BotState Bot(string botId) => bots[FindBot(botId)];

    private bool IsActive(int index) => !bots[index].Forfeited && bots[index].Hp > 0;

    private int FindBot(string id) => indices.TryGetValue(id, out var index)
        ? index : throw new ArgumentException("Unknown bot ID.", nameof(id));

    private void EnsureRunning()
    {
        if (Result is not null) throw new InvalidOperationException("The match is finished.");
    }

    private SafeZoneState? CurrentSafeZone()
    {
        if (!config.ShrinkZoneEnabled) return null;
        var arena = config.Arena;
        var startTick = Math.Max(0, (int)Math.Round(config.ShrinkStartSeconds * config.TickRate));
        if (tick < startTick)
            return new(0, 0, arena.Width, arena.Height);

        var durationTicks = Math.Max(1, (int)Math.Round(config.ShrinkDurationSeconds * config.TickRate));
        var progress = Math.Clamp((tick - startTick) / (double)durationTicks, 0, 1);
        var finalScale = Math.Clamp(config.ShrinkFinalScale, 0, 1);
        var scale = 1 + (finalScale - 1) * progress;
        var width = arena.Width * scale;
        var height = arena.Height * scale;
        return new((arena.Width - width) / 2, (arena.Height - height) / 2, width, height);
    }

    private static bool OutsideSafeZone(BotState bot, SafeZoneState zone) =>
        bot.Position.X < zone.X || bot.Position.X > zone.X + zone.Width ||
        bot.Position.Y < zone.Y || bot.Position.Y > zone.Y + zone.Height;

    private void ApplyShrinkZoneDamage()
    {
        if (!config.ShrinkZoneEnabled || config.ShrinkOutsideDamagePerSecond <= 0) return;
        var startTick = Math.Max(0, (int)Math.Round(config.ShrinkStartSeconds * config.TickRate));
        if (tick < startTick) return;
        if ((tick - startTick) % config.TickRate != 0) return;

        var zone = CurrentSafeZone();
        if (zone is null) return;

        for (var i = 0; i < bots.Length; i++)
        {
            if (!IsActive(i)) continue;
            var bot = bots[i];
            if (!OutsideSafeZone(bot, zone)) continue;
            var damage = Math.Min(bot.Hp, config.ShrinkOutsideDamagePerSecond);
            if (damage <= 0) continue;
            bots[i] = bot with { Hp = bot.Hp - damage, Speed = bot.Hp == damage ? 0 : bot.Speed };
            events.Add(new(tick, GameEventType.ZoneDamage, null, bot.Id, null, bot.Position, damage));
            if (bot.Hp == damage)
                events.Add(new(tick, GameEventType.BotDestroyed, null, bot.Id, null, bot.Position, damage));
        }
    }

    private bool FinishIfEliminated(MatchEndReason reason)
    {
        BotState? survivor = null;
        string? survivingTeam = null;
        for (var i = 0; i < bots.Length; i++)
        {
            if (!IsActive(i)) continue;
            var team = bots[i].TeamId;
            if (survivingTeam is null)
            {
                survivingTeam = team;
                survivor = bots[i];
                continue;
            }
            if (survivingTeam != team) return false;
        }
        Finish(new(survivor?.Id, reason, tick, survivingTeam));
        return true;
    }

    private void ResolveMovement(BotState[] next)
    {
        var grid = new SpatialGrid();
        var start = new Hitbox[bots.Length];
        var motion = new Vec2[bots.Length];
        var bounds = new Bounds[bots.Length];
        var blocked = new bool[bots.Length];
        var stopped = new Queue<int>();
        var neighbors = new HashSet<int>();

        for (var i = 0; i < bots.Length; i++)
        {
            if (!IsActive(i)) continue;
            var oldHull = Body(bots[i]);
            start[i] = Body(next[i]) with { Center = oldHull.Center };
            motion[i] = next[i].Position - bots[i].Position;
            bounds[i] = oldHull.Bounds().Union(start[i].Bounds()).Union(Body(next[i]).Bounds());
            grid.Add(i, bounds[i]);
        }

        for (var i = 0; i < bots.Length; i++)
        {
            if (!IsActive(i)) continue;
            grid.Find(bounds[i], neighbors);
            foreach (var j in neighbors)
            {
                if (j <= i || start[i].Impact(start[j], motion[i] - motion[j]) > 1) continue;
                Block(i);
                Block(j);
            }
        }

        // A canceled move leaves its old hull in the way of robots that expected it
        // to move. Recheck only those neighbors until no additional move is canceled.
        while (stopped.TryDequeue(out var i))
        {
            var oldHull = Body(bots[i]);
            grid.Find(oldHull.Bounds(), neighbors);
            foreach (var j in neighbors)
                if (!blocked[j] && start[j].Impact(oldHull, motion[j]) <= 1)
                    Block(j);
        }

        void Block(int i)
        {
            if (blocked[i]) return;
            blocked[i] = true;
            bodyTurnRates[i] = 0;
            next[i] = next[i] with { Position = bots[i].Position, BodyAngle = bots[i].BodyAngle, Speed = 0, Velocity = default };
            stopped.Enqueue(i);
        }
    }

    private void Finish(MatchResult result)
    {
        Result = result;
        events.Add(new(tick, GameEventType.MatchFinished));
    }

    private BotState Advance(int index, BotAction action)
    {
        var bot = bots[index];
        var current = new BotMotion(bot.BodyAngle, bodyTurnRates[index], bot.Velocity, bot.Speed);
        var proposed = movement[index].Propose(current, action, bot.Position, StepSeconds, canRotate: true);
        var turretAngle = TurnTurret(index, bot.TurretAngle, action);
        var hull = Body(bot with { BodyAngle = proposed.Heading });
        if (!Inside(hull) || WallImpact(hull, default) <= 1)
        {
            hull = Body(bot);
            var straight = movement[index].Propose(current, action, bot.Position, StepSeconds, canRotate: false);
            proposed = straight with { Heading = current.Heading, TurnRate = 0 };
        }

        bodyTurnRates[index] = proposed.TurnRate;
        var delta = proposed.Velocity * StepSeconds;
        var destination = hull with { Center = hull.Center + delta };
        if (!Inside(destination) || WallImpact(hull, delta) <= 1)
            return bot with { BodyAngle = proposed.Heading, TurretAngle = turretAngle, Speed = 0, Velocity = default };

        return bot with
        {
            Position = destination.Center, BodyAngle = proposed.Heading, TurretAngle = turretAngle,
            Speed = proposed.Speed, Velocity = proposed.Velocity,
        };
    }

    private double TurnTurret(int index, double current, BotAction action)
    {
        if (action.TurretTurn is { } turn)
        {
            var target = MotionMath.Input(turn) * config.MaxTurretTurnSpeed;
            turretTurnRates[index] = MotionMath.ApproachRate(turretTurnRates[index], target, StepSeconds, config.TurnResponseSeconds);
            return MotionMath.Angle(current + turretTurnRates[index] * StepSeconds);
        }

        var aim = action.AimDirection;
        if (aim == default || !double.IsFinite(aim.X) || !double.IsFinite(aim.Y))
        {
            turretTurnRates[index] = 0;
            return current;
        }

        var remaining = MotionMath.Angle(Math.Atan2(aim.Y, aim.X) - current);
        var limit = config.MaxTurretTurnSpeed;
        var targetRate = Math.Clamp(remaining / StepSeconds, -limit, limit);
        turretTurnRates[index] = MotionMath.ApproachRate(turretTurnRates[index], targetRate, StepSeconds, config.TurnResponseSeconds);
        var step = turretTurnRates[index] * StepSeconds;
        if (remaining == 0 || (step * remaining > 0 && Math.Abs(step) >= Math.Abs(remaining)))
        {
            turretTurnRates[index] = 0;
            step = remaining;
        }

        return MotionMath.Angle(current + step);
    }

    private void Fire(int index, BotAction action)
    {
        var bot = bots[index];
        if (action.Shoot && bot.CanShoot)
        {
            var direction = Vec2.FromAngle(bot.TurretAngle);
            var bullet = new BulletState(++nextBullet, bot.Id, bot.Position, direction);
            bullets.Add(bullet);
            cooldowns[index] = config.ShotCooldownTicks;
            events.Add(new(tick, GameEventType.ShotFired, bot.Id, BulletId: bullet.Id, Position: bot.Position));
        }
        cooldowns[index] = Math.Max(0, cooldowns[index] - 1);
        bots[index] = bot with { ReloadingTime = cooldowns[index] * StepSeconds };
    }

    private void AdvanceBullets()
    {
        if (bullets.Count == 0) return;
        var survivors = new List<BulletState>();
        var grid = new SpatialGrid();
        var hulls = new Hitbox[bots.Length];
        var neighbors = new HashSet<int>();
        for (var i = 0; i < bots.Length; i++)
        {
            if (!IsActive(i)) continue;
            hulls[i] = Body(bots[i]);
            grid.Add(i, hulls[i].Bounds());
        }

        foreach (var bullet in bullets)
        {
            var motion = bullet.Direction * (config.BulletSpeed * StepSeconds);
            var box = new Hitbox(bullet.Position, Math.Atan2(bullet.Direction.Y, bullet.Direction.X),
                config.BulletLength, config.BulletWidth);
            var destination = box with { Center = bullet.Position + motion };
            var wall = WallImpact(box, motion);
            var hit = double.PositiveInfinity;
            var targetIndex = -1;
            grid.Find(box.Bounds().Union(destination.Bounds()), neighbors);
            var ownerTeam = bots[FindBot(bullet.OwnerBotId)].TeamId;
            foreach (var candidate in neighbors)
            {
                if (bots[candidate].Id == bullet.OwnerBotId || bots[candidate].TeamId == ownerTeam) continue;
                var impact = box.Impact(hulls[candidate], motion);
                if (impact > 1 || impact > hit || (impact == hit && candidate > targetIndex)) continue;
                targetIndex = candidate;
                hit = impact;
            }

            if (hit <= 1 && hit < wall)
            {
                var target = bots[targetIndex];
                var impact = bullet.Position + motion * hit;
                var damage = Math.Min(target.Hp, config.BulletDamage);
                bots[targetIndex] = target.Hp == damage
                    ? target with { Hp = 0, Speed = 0, Velocity = default }
                    : target with { Hp = target.Hp - damage };
                if (damage > 0)
                {
                    events.Add(new(tick, GameEventType.BotHit, bullet.OwnerBotId, target.Id, bullet.Id, impact, damage));
                    if (target.Hp == damage)
                        events.Add(new(tick, GameEventType.BotDestroyed, bullet.OwnerBotId, target.Id, bullet.Id, impact));
                }
            }
            else if (wall > 1 && Inside(destination))
            {
                survivors.Add(bullet with { Position = bullet.Position + motion });
            }
        }
        bullets.Clear();
        bullets.AddRange(survivors);
    }

    private Hitbox Body(BotState bot) => new(bot.Position, bot.BodyAngle, config.BotLength, config.BotWidth);

    private bool Inside(Hitbox box)
    {
        var x = box.Extent(new(1, 0));
        var y = box.Extent(new(0, 1));
        return box.Center.X >= x && box.Center.X <= config.Arena.Width - x
            && box.Center.Y >= y && box.Center.Y <= config.Arena.Height - y;
    }

    private double WallImpact(Hitbox box, Vec2 motion)
    {
        var impact = double.PositiveInfinity;
        foreach (var wall in walls) impact = Math.Min(impact, box.Impact(wall, motion));
        return impact;
    }
}
