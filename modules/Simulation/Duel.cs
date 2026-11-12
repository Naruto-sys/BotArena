namespace BotArena;

public record BotSpawn(string Id, Vec2 Position, double BodyAngle, double TurretAngle,
    WeaponType Weapon = WeaponType.Cannon);

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

    public static MatchConfig Classic { get; } = new(20, 200, new(16, 10, Array.AsReadOnly(new Wall[]
    {
        new(4.5, 1.9, 2.0, 1.3),
        new(7.25, 4.15, 1.5, 1.7),
        new(9.5, 6.8, 2.0, 1.3)
    })), Array.AsReadOnly(new BotSpawn[]
    {
        new("player", new(2, 5), 0, 0),
        new("opponent", new(14, 5), Math.PI, Math.PI)
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
    private readonly Hitbox[] walls;
    private readonly List<BulletState> bullets = [];
    private readonly List<GameEvent> events = [];
    private readonly int[] cooldowns = new int[2];
    private readonly double[] bodyTurnRates = new double[2];
    private readonly double[] turretTurnRates = new double[2];
    private int nextBullet;
    private int tick;

    public MatchResult? Result { get; private set; }

    public Duel(MatchConfig config)
    {
        this.config = config;
        terrain = new(config.Arena);
        bots = CreateBots(config).Select(OnTerrain).ToArray();
        walls = config.Arena.Walls.Select(w =>
            new Hitbox(new(w.X + w.Width / 2, w.Y + w.Height / 2), 0, w.Width, w.Height)).ToArray();
        random = new(config.RandomSeed);
        InitializeConsumables();
    }

    private static BotState[] CreateBots(MatchConfig config)
    {
        if (!double.IsFinite(config.MortarBlastRadius) || config.MortarBlastRadius < 0)
            throw new ArgumentOutOfRangeException(nameof(config.MortarBlastRadius));
        if (config.GaussCooldownTicks <= 0)
            throw new ArgumentOutOfRangeException(nameof(config.GaussCooldownTicks));
        if (config.GaussDamage <= 0)
            throw new ArgumentOutOfRangeException(nameof(config.GaussDamage));
        return config.Spawns.Select(s => new BotState(s.Id, s.Position, s.BodyAngle, s.TurretAngle,
            0, 100, 100, 0, s.Weapon,
            s.Weapon == WeaponType.Gauss ? WeaponChargeStage.Ready : WeaponChargeStage.None,
            s.Weapon == WeaponType.Gauss ? 1 : 0)).ToArray();
    }

    public BotObservation Observe(string botId)
    {
        var index = Array.FindIndex(bots, bot => bot.Id == botId);
        if (index < 0) throw new ArgumentException("Unknown bot ID.", nameof(botId));
        var self = bots[index];
        var enemy = bots[1 - index];
        var visible = CanObserve(self.Position, enemy.Position);
        return new(tick, self, visible ? enemy with { Inventory = [] } : null, [.. bullets], config.Arena)
        {
            Items = items.Where(item => CanObserve(self.Position, item.Position)).ToArray(),
            SmokeClouds = smokeClouds.Where(cloud => CanObserve(self.Position, cloud.Position)).ToArray(),
            ConsumableRules = config.Consumables
        };
    }

    public GameFrame CaptureFrame() => new(tick, [.. bots], [.. bullets], [.. events])
    {
        Items = items.ToArray(), SmokeClouds = smokeClouds.ToArray()
    };

    public void Step(IReadOnlyDictionary<string, BotAction> actions)
    {
        if (Result is not null) throw new InvalidOperationException("The duel is finished.");
        var firstAction = actions[bots[0].Id];
        var secondAction = actions[bots[1].Id];
        ValidateTarget(bots[0], firstAction);
        ValidateTarget(bots[1], secondAction);
        events.Clear();
        tick++;
        ExpireConsumables();
        UseConsumable(0, firstAction.UseItem);
        UseConsumable(1, secondAction.UseItem);

        var first = Advance(0, firstAction);
        var second = Advance(1, secondAction);
        var firstStart = Body(first with { Position = bots[0].Position });
        var secondStart = Body(second with { Position = bots[1].Position });
        var relativeMotion = (first.Position - bots[0].Position) - (second.Position - bots[1].Position);
        if (firstStart.Impact(secondStart, relativeMotion) <= 1)
        {
            Array.Clear(bodyTurnRates);
            first = first with { Position = bots[0].Position, BodyAngle = bots[0].BodyAngle, Speed = 0 };
            second = second with { Position = bots[1].Position, BodyAngle = bots[1].BodyAngle, Speed = 0 };
        }
        first = OnTerrain(first);
        second = OnTerrain(second);
        RecordTerrainChanges(bots[0], first);
        RecordTerrainChanges(bots[1], second);
        bots = [first, second];
        Fire(0, firstAction);
        Fire(1, secondAction);
        AdvanceBullets();
        CollectConsumables();

        var destroyed = bots.Any(b => b.Hp == 0);
        if (!destroyed && tick < config.MaxTicks) SpawnConsumables();
        if (destroyed || tick == config.MaxTicks)
        {
            string? winner = !destroyed || bots.All(b => b.Hp == 0) ? null : bots.Single(b => b.Hp > 0).Id;
            Finish(new(winner, destroyed ? MatchEndReason.BotDestroyed : MatchEndReason.TimeLimit, tick));
        }
    }

    public void Forfeit(string botId) =>
        Finish(new(bots.Single(bot => bot.Id != botId).Id, MatchEndReason.BotError, tick));

    private void Finish(MatchResult result)
    {
        Result = result;
        events.Add(new(tick, GameEventType.MatchFinished));
    }

    private BotState Advance(int index, BotAction action)
    {
        var bot = bots[index];
        var modifiers = terrain.Modifiers(bot.Surface);
        var boost = HasEffect(index, ConsumableType.SpeedBoost) ? config.Consumables.SpeedMultiplier : 1;
        var left = Track(action.LeftTrack);
        var right = Track(action.RightTrack);
        var throttle = (left + right) / 2;
        var targetSpeed = throttle * (throttle < 0 ? config.MaxReverseSpeed : config.MaxForwardSpeed) * modifiers.SpeedMultiplier * boost;
        var braking = Math.Abs(targetSpeed) < Math.Abs(bot.Speed) || targetSpeed * bot.Speed < 0;
        var speedDelta = (braking ? config.Deceleration * modifiers.DecelerationMultiplier
            : config.Acceleration * modifiers.AccelerationMultiplier) * boost * StepSeconds;
        var speed = bot.Speed + Math.Clamp(targetSpeed - bot.Speed, -speedDelta, speedDelta);
        var targetTurnRate = (left - right) * 0.5 * config.MaxTurnSpeed * modifiers.TurnMultiplier;
        bodyTurnRates[index] = ApproachTurnRate(bodyTurnRates[index], targetTurnRate);
        var bodyAngle = NormalizeAngle(bot.BodyAngle + bodyTurnRates[index] * StepSeconds);
        var turretAngle = TurnTurret(index, bot.TurretAngle, action);
        var hull = Body(bot with { BodyAngle = bodyAngle });
        if (!Inside(hull) || WallImpact(hull, default) <= 1)
        {
            hull = Body(bot);
            bodyAngle = bot.BodyAngle;
            bodyTurnRates[index] = 0;
        }

        var delta = Vec2.FromAngle(bodyAngle) * (speed * StepSeconds);
        var destination = hull with { Center = hull.Center + delta };
        if (!Inside(destination) || WallImpact(hull, delta) <= 1)
            return bot with { BodyAngle = bodyAngle, TurretAngle = turretAngle, Speed = 0 };

        return bot with { Position = destination.Center, BodyAngle = bodyAngle, TurretAngle = turretAngle, Speed = speed };
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

    private double ApproachTurnRate(double current, double target)
    {
        // Scale the response by elapsed simulation time so changing the tick rate
        // does not change how quickly the hull and turret respond to a command.
        var blend = 1 - Math.Exp(-StepSeconds / config.TurnResponseSeconds);
        return current + (target - current) * blend;
    }

    private double TurnTurret(int index, double current, BotAction action)
    {
        if (action.TurretTurn is { } turn)
        {
            var target = Track(turn) * config.MaxTurretTurnSpeed;
            turretTurnRates[index] = ApproachTurnRate(turretTurnRates[index], target);
            return NormalizeAngle(current + turretTurnRates[index] * StepSeconds);
        }

        var aim = action.AimDirection;
        if (aim == default || !double.IsFinite(aim.X) || !double.IsFinite(aim.Y))
        {
            turretTurnRates[index] = 0;
            return current;
        }

        var remaining = NormalizeAngle(Math.Atan2(aim.Y, aim.X) - current);
        var limit = config.MaxTurretTurnSpeed;
        var targetRate = Math.Clamp(remaining / StepSeconds, -limit, limit);
        turretTurnRates[index] = ApproachTurnRate(turretTurnRates[index], targetRate);
        var step = turretTurnRates[index] * StepSeconds;
        if (remaining == 0 || (step * remaining > 0 && Math.Abs(step) >= Math.Abs(remaining)))
        {
            turretTurnRates[index] = 0;
            step = remaining;
        }

        return NormalizeAngle(current + step);
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
        var survivors = new List<BulletState>();
        foreach (var bullet in bullets)
        {
            if (bullet.Weapon == WeaponType.Mortar)
            {
                AdvanceMortar(bullet, survivors);
                continue;
            }
            if (bullet.Weapon == WeaponType.Gauss)
            {
                FireGaussBeam(bullet);
                continue;
            }
            var motion = bullet.Direction * (config.BulletSpeed * StepSeconds);
            var box = new Hitbox(bullet.Position, Math.Atan2(bullet.Direction.Y, bullet.Direction.X),
                config.BulletLength, config.BulletWidth);
            var targetIndex = bots[0].Id == bullet.OwnerBotId ? 1 : 0;
            var target = bots[targetIndex];
            var hit = box.Impact(Body(target), motion);
            var wall = WallImpact(box, motion);

            if (hit <= 1 && hit < wall)
            {
                var impact = bullet.Position + motion * hit;
                Damage(targetIndex, bullet, impact, config.BulletDamage);
            }
            else if (wall > 1 && Inside(box with { Center = bullet.Position + motion }))
            {
                survivors.Add(bullet with { Position = bullet.Position + motion });
            }
        }
        bullets.Clear();
        bullets.AddRange(survivors);
    }

    private void AdvanceMortar(BulletState shell, List<BulletState> survivors)
    {
        var target = shell.TargetPoint!.Value;
        var remaining = shell.ImpactTick!.Value - tick;
        if (remaining <= 0)
        {
            events.Add(new(tick, GameEventType.ProjectileLanded, shell.OwnerBotId,
                BulletId: shell.Id, Position: target, Radius: config.MortarBlastRadius, Weapon: shell.Weapon));
            var targetIndex = bots[0].Id == shell.OwnerBotId ? 1 : 0;
            // Test the circle against the current rotated hull, including its corners.
            // Splash shares the mortar's wall bypass and does not damage its owner.
            if (Body(bots[targetIndex]).DistanceSquaredTo(target) <= config.MortarBlastRadius * config.MortarBlastRadius)
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
        var targetIndex = bots[0].Id == shot.OwnerBotId ? 1 : 0;
        var hit = ray.Impact(Body(bots[targetIndex]), motion);
        var wall = WallImpact(ray, motion);
        var end = start + motion * Math.Min(1, Math.Min(hit, wall));
        events.Add(new(tick, GameEventType.BeamFired, shot.OwnerBotId, BulletId: shot.Id,
            Position: start, EndPosition: end, Weapon: shot.Weapon));
        if (hit <= 1 && hit < wall)
            Damage(targetIndex, shot, end, config.GaussDamage);
    }

    private void Damage(int targetIndex, BulletState bullet, Vec2 position, int amount)
    {
        var target = bots[targetIndex];
        if (target.Hp <= 0) return;
        var shieldDamage = Math.Min(target.ShieldHp, amount);
        var damage = Math.Min(target.Hp, amount - shieldDamage);
        bots[targetIndex] = target with { Hp = target.Hp - damage, ShieldHp = target.ShieldHp - shieldDamage };
        if (shieldDamage > 0 && bots[targetIndex].ShieldHp == 0) EndEffect(targetIndex, ConsumableType.Shield);
        if (damage <= 0 && shieldDamage <= 0) return;
        events.Add(new(tick, GameEventType.BotHit, bullet.OwnerBotId, target.Id, bullet.Id,
            position, damage, Weapon: bullet.Weapon, ShieldDamage: shieldDamage));
        if (target.Hp == damage)
            events.Add(new(tick, GameEventType.BotDestroyed, bullet.OwnerBotId, target.Id, bullet.Id,
                position, Weapon: bullet.Weapon));
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

    private static double Track(double value) => double.IsFinite(value) ? Math.Clamp(value, -1, 1) : 0;
    private static double NormalizeAngle(double angle) => Math.Atan2(Math.Sin(angle), Math.Cos(angle));
}
