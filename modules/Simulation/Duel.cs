namespace BotArena;

public record BotSpawn(string Id, Vec2 Position, double BodyAngle, double TurretAngle, string TeamId = "", int Hp = 100, WeaponType Weapon = WeaponType.Cannon)
{
    public IMovementModel? Movement { get; init; }
    public string ResolvedTeamId => string.IsNullOrWhiteSpace(TeamId) ? Id : TeamId;
    public int ResolvedHp => Math.Clamp(Hp <= 0 ? 100 : Hp, 1, 500);
}

public sealed record MatchConfig(int TickRate, int MaxTicks, ArenaState Arena, IReadOnlyList<BotSpawn> Spawns)
{
    public MatchMode Mode { get; init; } = MatchMode.Elimination;
    public KingOfHillRules? KingOfHill { get; init; }
    public DeathmatchRules? Deathmatch { get; init; }
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
    public double MortarSpeed { get; init; } = 4.0;
    public int MortarDamage { get; init; } = 35;
    public int MortarCooldownTicks { get; init; } = 30;
    public double MortarMinFlightSeconds { get; init; } = 0.5;
    public double MortarBlastRadius { get; init; } = 1.25;
    public int GaussDamage { get; init; } = 60;
    public int GaussCooldownTicks { get; init; } = 50;
    public ConsumableRules Consumables { get; init; } = new();
    public IReadOnlyList<ConsumableSpawn> InitialItems { get; init; } = [];
    public int RandomSeed { get; init; } = 1;

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
    public static MatchConfig Biomes { get; } = Classic with
    {
        Arena = Classic.Arena with { Cells = Array.AsReadOnly(CreateBiomeCells()) },
        Consumables = new() { Enabled = true }
    };

    private static ArenaCell[] CreateBiomeCells()
    {
        var cells = new List<ArenaCell>();
        foreach (var x in new[] { 4, 5, 10, 11 })
        foreach (var y in new[] { 3, 4 })
            cells.Add(new(x, y, SurfaceType.Sand, Fog: y == 4));
        foreach (var x in new[] { 3, 4, 11, 12 })
        foreach (var y in new[] { 7, 8 })
            cells.Add(new(x, y, SurfaceType.Snow));
        foreach (var x in new[] { 5, 6, 9, 10 })
        foreach (var y in new[] { 0, 1 })
            cells.Add(new(x, y, SurfaceType.Ice));
        foreach (var x in new[] { 7, 8 })
        foreach (var y in new[] { 8, 9 })
            cells.Add(new(x, y, Fog: true));
        return cells.ToArray();
    }
}

public interface ISimulationEngine
{
    BotObservation Observe(string botId);
    void Step(IReadOnlyDictionary<string, BotAction> actions);
    GameFrame CaptureFrame();
    MatchResult? Result { get; }
}

public sealed partial class Duel : ISimulationEngine
{
    private readonly MatchConfig config;
    private readonly TerrainMap terrain;
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
        if (!Enum.IsDefined(config.Mode)) throw new ArgumentException("Unknown match mode.", nameof(config));
        if (config.Spawns.Any(spawn => !Enum.IsDefined(spawn.Weapon)))
            throw new ArgumentException("Unknown weapon type.", nameof(config));
        terrain = new(config.Arena);
        if (!double.IsFinite(config.MortarBlastRadius) || config.MortarBlastRadius < 0)
            throw new ArgumentOutOfRangeException(nameof(config.MortarBlastRadius));
        if (config.GaussDamage <= 0) throw new ArgumentOutOfRangeException(nameof(config.GaussDamage));
        if (config.GaussCooldownTicks <= 0) throw new ArgumentOutOfRangeException(nameof(config.GaussCooldownTicks));
        var tracked = new TrackedMovement(config);
        movement = config.Spawns.Select(spawn => spawn.Movement ?? tracked).ToArray();
        bots = config.Spawns.Select((s, i) =>
        {
            var hp = s.ResolvedHp;
            return new BotState(s.Id, s.ResolvedTeamId, s.Position, s.BodyAngle, s.TurretAngle, 0, hp, hp, 0, s.Weapon,
                s.Weapon == WeaponType.Gauss ? WeaponChargeStage.Ready : WeaponChargeStage.None,
                s.Weapon == WeaponType.Gauss ? 1 : 0)
            {
                Movement = movement[i].Id,
            };
        }).Select(OnTerrain).ToArray();
        walls = config.Arena.Walls.Select(w =>
            new Hitbox(new(w.X + w.Width / 2, w.Y + w.Height / 2), 0, w.Width, w.Height)).ToArray();
        random = new(config.RandomSeed);
        inventories = Enumerable.Range(0, bots.Length).Select(_ => new List<ConsumableType>()).ToArray();
        effects = Enumerable.Range(0, bots.Length).Select(_ => new List<ActiveEffect>()).ToArray();
        cooldowns = new int[bots.Length];
        respawnAt = new int?[bots.Length];
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
        InitializeKingOfHill();
        InitializeDeathmatch();
        InitializeConsumables();
    }

    public MatchResult? Result { get; private set; }

    public BotObservation Observe(string botId)
    {
        var self = bots[FindBot(botId)];
        var observers = config.Mode == MatchMode.KingOfHill
            ? bots.Where((bot, i) => IsActive(i) && bot.TeamId == self.TeamId).ToArray() : [self];
        var enemies = new List<BotState>();
        BotState? nearest = null;
        var nearestDistance = double.PositiveInfinity;
        for (var i = 0; i < bots.Length; i++)
        {
            var candidate = bots[i];
            if (candidate.Id == botId || !IsActive(i) || candidate.TeamId == self.TeamId) continue;
            var offset = candidate.Position - self.Position;
            if (!observers.Any(observer => CanObserve(observer.Position, candidate.Position))) continue;
            candidate = candidate with { Inventory = [] };
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
            Allies = bots.Where(bot => bot.Id != self.Id && bot.TeamId == self.TeamId).ToArray(),
            KingOfHill = CaptureKingOfHill(),
            Deathmatch = CaptureDeathmatch(),
            SafeZone = CurrentSafeZone(),
            Items = items.Where(item => CanObserve(self.Position, item.Position)).ToArray(),
            SmokeClouds = smokeClouds.Where(cloud => CanObserve(self.Position, cloud.Position)).ToArray(),
            ConsumableRules = config.Consumables,
        };
    }

    public GameFrame CaptureFrame() => new(tick, [.. bots], [.. bullets], [.. events], CurrentSafeZone())
    {
        Items = items.ToArray(), SmokeClouds = smokeClouds.ToArray(), KingOfHill = CaptureKingOfHill(), Deathmatch = CaptureDeathmatch()
    };

    public void Step(IReadOnlyDictionary<string, BotAction> actions)
    {
        EnsureRunning();
        var commands = new BotAction?[bots.Length];
        for (var i = 0; i < bots.Length; i++)
        {
            if (IsActive(i))
            {
                commands[i] = actions[bots[i].Id];
                ValidateTarget(bots[i], commands[i]!);
            }
        }
        events.Clear();
        tick++;
        ExpireConsumables();
        for (var i = 0; i < bots.Length; i++)
            if (commands[i] is { } command) UseConsumable(i, command.UseItem);

        var next = (BotState[])bots.Clone();
        for (var i = 0; i < bots.Length; i++)
            if (commands[i] is { } action) next[i] = Advance(i, action);
        ResolveMovement(next);
        for (var i = 0; i < bots.Length; i++)
        {
            next[i] = OnTerrain(next[i]);
            RecordTerrainChanges(bots[i], next[i]);
        }
        bots = next;

        for (var i = 0; i < bots.Length; i++)
            if (commands[i] is { } action) Fire(i, action);
        AdvanceBullets();
        ApplyShrinkZoneDamage();
        CollectConsumables();
        if (config.Mode == MatchMode.KingOfHill)
        {
            UpdateKingOfHill();
            if (Result is null) SpawnConsumables();
            return;
        }
        if (config.Mode == MatchMode.Deathmatch)
        {
            UpdateDeathmatch();
            if (Result is null) SpawnConsumables();
            return;
        }
        if (tick < config.MaxTicks &&
            bots.Where((_, i) => IsActive(i)).Select(bot => bot.TeamId).Distinct().Take(2).Count() > 1)
            SpawnConsumables();
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
            if (bots[index].Forfeited) continue;
            bots[index] = bots[index] with { Forfeited = true, Speed = 0, Velocity = default };
            respawnAt[index] = null;
        }
        ClearInactiveConsumables();
        if (config.Mode == MatchMode.KingOfHill) FinishIfKingOfHillForfeited();
        else if (config.Mode == MatchMode.Deathmatch) FinishIfDeathmatchForfeited();
        else FinishIfEliminated(MatchEndReason.BotError);
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
        if (!config.ShrinkZoneEnabled || config.Mode != MatchMode.Elimination) return null;
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
        if (!config.ShrinkZoneEnabled || config.Mode != MatchMode.Elimination || config.ShrinkOutsideDamagePerSecond <= 0) return;
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

    private BotMotion ProposeMotion(int index, BotMotion current, BotAction action, bool canRotate)
    {
        var modifiers = terrain.Modifiers(bots[index].Surface);
        if (HasEffect(index, ConsumableType.SpeedBoost))
        {
            var boost = config.Consumables.SpeedMultiplier;
            modifiers = modifiers with { SpeedMultiplier = modifiers.SpeedMultiplier * boost,
                AccelerationMultiplier = modifiers.AccelerationMultiplier * boost,
                DecelerationMultiplier = modifiers.DecelerationMultiplier * boost };
        }
        return movement[index] is IEnvironmentMovementModel environmental
            ? environmental.ProposeOnSurface(current, action, bots[index].Position, StepSeconds, canRotate, modifiers)
            : movement[index].Propose(current, action, bots[index].Position, StepSeconds, canRotate);
    }

    private BotState Advance(int index, BotAction action)
    {
        var bot = bots[index];
        var current = new BotMotion(bot.BodyAngle, bodyTurnRates[index], bot.Velocity, bot.Speed);
        var proposed = ProposeMotion(index, current, action, canRotate: true);
        var turretAngle = TurnTurret(index, bot.TurretAngle, action);
        var hull = Body(bot with { BodyAngle = proposed.Heading });
        if (!Inside(hull) || WallImpact(hull, default) <= 1)
        {
            hull = Body(bot);
            var straight = ProposeMotion(index, current, action, canRotate: false);
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
            BulletState bullet;
            if (bot.Weapon == WeaponType.Mortar)
            {
                var target = action.TargetPoint!.Value;
                var offset = target - bot.Position;
                var distance = Math.Sqrt(offset.Dot(offset));
                var flightSeconds = Math.Max(config.MortarMinFlightSeconds, distance / config.MortarSpeed);
                var flightTicks = Math.Max(1, (int)Math.Ceiling(flightSeconds * config.TickRate));
                var direction = distance > 0 ? offset * (1 / distance) : default;
                bullet = new(++nextBullet, bot.Id, bot.Position, direction, WeaponType.Mortar,
                    target, tick, tick + flightTicks);
                cooldowns[index] = config.MortarCooldownTicks;
            }
            else if (bot.Weapon == WeaponType.Gauss)
            {
                // Resolve both bots' shots after both have fired, including lethal beams.
                bullet = new(++nextBullet, bot.Id, bot.Position, Vec2.FromAngle(bot.TurretAngle),
                    WeaponType.Gauss, LaunchTick: tick);
                cooldowns[index] = config.GaussCooldownTicks;
            }
            else
            {
                bullet = new(++nextBullet, bot.Id, bot.Position, Vec2.FromAngle(bot.TurretAngle), LaunchTick: tick);
                cooldowns[index] = config.ShotCooldownTicks;
            }
            bullets.Add(bullet);
            events.Add(new(tick, GameEventType.ShotFired, bot.Id, BulletId: bullet.Id,
                Position: bot.Position, Weapon: bot.Weapon));
            if (bot.Weapon == WeaponType.Gauss)
                events.Add(new(tick, GameEventType.WeaponChargeStarted, bot.Id,
                    Position: bot.Position, Weapon: bot.Weapon));
        }
        var wasCharging = cooldowns[index] > 0;
        var recovery = HasEffect(index, ConsumableType.Coolant) ? config.Consumables.CooldownRecoveryTicks : 1;
        cooldowns[index] = Math.Max(0, cooldowns[index] - recovery);
        bots[index] = bot with { ReloadingTime = cooldowns[index] * StepSeconds };
        if (bot.Weapon == WeaponType.Gauss)
        {
            bots[index] = bots[index] with
            {
                ChargeStage = cooldowns[index] > 0 ? WeaponChargeStage.Charging : WeaponChargeStage.Ready,
                ChargeProgress = 1.0 - (double)cooldowns[index] / config.GaussCooldownTicks
            };
            if (wasCharging && cooldowns[index] == 0)
                events.Add(new(tick, GameEventType.WeaponReady, bot.Id,
                    Position: bot.Position, Weapon: bot.Weapon));
        }
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
            if (bullet.Weapon == WeaponType.Mortar) { AdvanceMortar(bullet, survivors); continue; }
            if (bullet.Weapon == WeaponType.Gauss) { FireGaussBeam(bullet); continue; }
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
                if (!IsActive(candidate) || bots[candidate].Id == bullet.OwnerBotId || bots[candidate].TeamId == ownerTeam) continue;
                var impact = box.Impact(hulls[candidate], motion);
                if (impact > 1 || impact > hit || (impact == hit && candidate > targetIndex)) continue;
                targetIndex = candidate;
                hit = impact;
            }

            if (hit <= 1 && hit < wall)
            {
                Damage(targetIndex, bullet, bullet.Position + motion * hit, config.BulletDamage);
            }
            else if (wall > 1 && Inside(destination))
            {
                survivors.Add(bullet with { Position = bullet.Position + motion });
            }
        }
        bullets.Clear();
        bullets.AddRange(survivors);
    }

    private BotState OnTerrain(BotState bot)
    {
        var cell = terrain.At(bot.Position);
        return bot with { Surface = cell.Surface, InFog = cell.Fog };
    }

    private void RecordTerrainChanges(BotState previous, BotState current)
    {
        if (previous.Surface != current.Surface)
            events.Add(new(tick, GameEventType.SurfaceChanged, current.Id,
                Position: current.Position, Surface: current.Surface));
        if (previous.InFog != current.InFog)
            events.Add(new(tick, current.InFog ? GameEventType.FogEntered : GameEventType.FogExited,
                current.Id, Position: current.Position, Surface: current.Surface));
    }

    private void AdvanceMortar(BulletState shell, List<BulletState> survivors)
    {
        var target = shell.TargetPoint!.Value;
        var remaining = shell.ImpactTick!.Value - tick;
        if (remaining <= 0)
        {
            events.Add(new(tick, GameEventType.ProjectileLanded, shell.OwnerBotId,
                BulletId: shell.Id, Position: target, Radius: config.MortarBlastRadius, Weapon: shell.Weapon));
            var team = bots[FindBot(shell.OwnerBotId)].TeamId;
            for (var targetIndex = 0; targetIndex < bots.Length; targetIndex++)
                if (IsActive(targetIndex) && bots[targetIndex].TeamId != team &&
                    Body(bots[targetIndex]).DistanceSquaredTo(target) <= config.MortarBlastRadius * config.MortarBlastRadius)
                    Damage(targetIndex, shell, target, config.MortarDamage);
        }
        else
        {
            var position = shell.LaunchTick == tick ? shell.Position
                : shell.Position + (target - shell.Position) * (1.0 / (remaining + 1));
            survivors.Add(shell with { Position = position });
        }
    }

    private void FireGaussBeam(BulletState shot)
    {
        var direction = shot.Direction;
        var start = shot.Position;
        // Bound the ray at the arena edge, independent of the ordinary bullet speed.
        var distanceX = direction.X > 0 ? (config.Arena.Width - start.X) / direction.X
            : direction.X < 0 ? -start.X / direction.X : double.PositiveInfinity;
        var distanceY = direction.Y > 0 ? (config.Arena.Height - start.Y) / direction.Y
            : direction.Y < 0 ? -start.Y / direction.Y : double.PositiveInfinity;
        var motion = direction * Math.Min(distanceX, distanceY);
        var ray = new Hitbox(start, 0, 0, 0);
        var targetIndex = -1;
        var hit = double.PositiveInfinity;
        var team = bots[FindBot(shot.OwnerBotId)].TeamId;
        for (var i = 0; i < bots.Length; i++)
        {
            if (!IsActive(i) || bots[i].TeamId == team) continue;
            var impact = ray.Impact(Body(bots[i]), motion);
            if (impact <= 1 && impact < hit) { hit = impact; targetIndex = i; }
        }
        var wall = WallImpact(ray, motion);
        var end = start + motion * Math.Min(1, Math.Min(hit, wall));
        events.Add(new(tick, GameEventType.BeamFired, shot.OwnerBotId, BulletId: shot.Id,
            Position: start, EndPosition: end, Weapon: shot.Weapon));
        if (targetIndex >= 0 && hit <= 1 && hit < wall)
            Damage(targetIndex, shot, end, config.GaussDamage);
    }

    private void Damage(int targetIndex, BulletState bullet, Vec2 position, int amount)
    {
        var target = bots[targetIndex];
        if (target.Hp <= 0) return;
        var shieldDamage = Math.Min(target.ShieldHp, amount);
        var damage = Math.Min(target.Hp, amount - shieldDamage);
        bots[targetIndex] = target with { Hp = target.Hp - damage, ShieldHp = target.ShieldHp - shieldDamage,
            Speed = target.Hp == damage ? 0 : target.Speed, Velocity = target.Hp == damage ? default : target.Velocity };
        if (shieldDamage > 0 && bots[targetIndex].ShieldHp == 0) EndEffect(targetIndex, ConsumableType.Shield);
        if (damage <= 0 && shieldDamage <= 0) return;
        events.Add(new(tick, GameEventType.BotHit, bullet.OwnerBotId, target.Id, bullet.Id,
            position, damage, Weapon: bullet.Weapon, ShieldDamage: shieldDamage));
        if (target.Hp == damage)
        {
            events.Add(new(tick, GameEventType.BotDestroyed, bullet.OwnerBotId, target.Id, bullet.Id,
                position, Weapon: bullet.Weapon));
            RecordDeathmatchDeath(targetIndex, bullet.OwnerBotId);
        }
    }

    private void ValidateTarget(BotState bot, BotAction action)
    {
        if (action.UseItem is { } item && !Enum.IsDefined(item))
            throw new ArgumentException("useItem must name an existing consumable type.", nameof(action));
        if (action.TargetPoint is { } point &&
            (bot.Weapon != WeaponType.Mortar || !double.IsFinite(point.X) || !double.IsFinite(point.Y) ||
             point.X < 0 || point.X > config.Arena.Width || point.Y < 0 || point.Y > config.Arena.Height))
            throw new ArgumentException("targetPoint requires a mortar and a finite point inside the arena.", nameof(action));
        if (bot.Weapon == WeaponType.Mortar && action.Shoot && action.TargetPoint is null)
            throw new ArgumentException("A mortar shot requires targetPoint.", nameof(action));
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
