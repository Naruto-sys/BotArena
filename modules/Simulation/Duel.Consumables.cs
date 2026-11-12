namespace BotArena;

public sealed partial class Duel
{
    private readonly Random random;
    private readonly List<ItemState> items = [];
    private readonly List<SmokeCloud> smokeClouds = [];
    private readonly List<ConsumableType>[] inventories;
    private readonly List<ActiveEffect>[] effects;
    private int nextItemId;
    private int nextSmokeId;
    private int nextItemSpawnTick;

    private void InitializeConsumables()
    {
        var rules = config.Consumables;
        if (!rules.Enabled) return;
        ValidateConsumableRules(rules);
        if (config.InitialItems.Count + rules.InitialCount > rules.MaxOnField)
            throw new ArgumentException("Initial consumables exceed the field capacity.", nameof(config.InitialItems));
        foreach (var spawn in config.InitialItems)
        {
            if (!Enum.IsDefined(spawn.Type) || !FreeItemPosition(spawn.Position, avoidBots: false))
                throw new ArgumentException("Initial items require distinct free positions inside the arena.", nameof(config.InitialItems));
            AddItem(spawn.Type, spawn.Position);
        }
        for (var i = 0; i < rules.InitialCount; i++) TrySpawnItem();
        nextItemSpawnTick = NextSpawnDelay();
    }

    private void ValidateConsumableRules(ConsumableRules rules)
    {
        bool Positive(double value) => double.IsFinite(value) && value > 0;
        bool Duration(double value) => Positive(value) && value * config.TickRate < int.MaxValue / 2;
        if (rules.InitialCount < 0 || rules.MaxOnField is < 1 or > 64 || rules.InitialCount > rules.MaxOnField ||
            rules.InventoryCapacity is < 1 or > 16 || !Positive(rules.PickupRadius) ||
            !Duration(rules.MinSpawnSeconds) || !Duration(rules.MaxSpawnSeconds) || rules.MinSpawnSeconds > rules.MaxSpawnSeconds ||
            rules.RepairAmount <= 0 || rules.ShieldAmount <= 0 || !Duration(rules.ShieldDurationSeconds) ||
            !Positive(rules.SpeedMultiplier) || !Duration(rules.BoostDurationSeconds) ||
            rules.CooldownRecoveryTicks is < 1 or > 16 || !Duration(rules.CoolantDurationSeconds) ||
            !Positive(rules.SmokeRadius) || !Positive(rules.SmokeVisibilityRange) || !Duration(rules.SmokeDurationSeconds) ||
            rules.AllowedTypes is null || rules.AllowedTypes.Count == 0 ||
            rules.AllowedTypes.Any(type => !Enum.IsDefined(type)) ||
            rules.AllowedTypes.Distinct().Count() != rules.AllowedTypes.Count)
            throw new ArgumentException("Invalid consumable limits, types, durations, or effect parameters.", nameof(rules));
    }

    private int DurationTicks(double seconds) => Math.Max(1, (int)Math.Ceiling(seconds * config.TickRate));

    private int NextSpawnDelay() => random.Next(DurationTicks(config.Consumables.MinSpawnSeconds),
        DurationTicks(config.Consumables.MaxSpawnSeconds) + 1);

    private void SpawnConsumables()
    {
        if (!config.Consumables.Enabled || tick < nextItemSpawnTick) return;
        if (items.Count < config.Consumables.MaxOnField) TrySpawnItem();
        nextItemSpawnTick = tick + NextSpawnDelay();
    }

    private void TrySpawnItem()
    {
        var margin = Math.Sqrt(config.BotLength * config.BotLength + config.BotWidth * config.BotWidth) * 0.5 + 0.05;
        if (config.Arena.Width <= margin * 2 || config.Arena.Height <= margin * 2) return;
        // Bounded rejection sampling also handles densely blocked maps without stalling a match.
        for (var attempt = 0; attempt < 64; attempt++)
        {
            var position = new Vec2(margin + random.NextDouble() * (config.Arena.Width - margin * 2),
                margin + random.NextDouble() * (config.Arena.Height - margin * 2));
            if (!FreeItemPosition(position, avoidBots: true)) continue;
            var allowed = config.Consumables.AllowedTypes;
            AddItem(allowed[random.Next(allowed.Count)], position);
            return;
        }
    }

    private bool FreeItemPosition(Vec2 point, bool avoidBots)
    {
        var clearance = Math.Sqrt(config.BotLength * config.BotLength + config.BotWidth * config.BotWidth) * 0.5 + 0.05;
        if (!double.IsFinite(point.X) || !double.IsFinite(point.Y) || point.X < clearance || point.Y < clearance ||
            point.X > config.Arena.Width - clearance || point.Y > config.Arena.Height - clearance ||
            walls.Any(wall => wall.DistanceSquaredTo(point) <= clearance * clearance) ||
            items.Any(item => (item.Position - point).Dot(item.Position - point) < 0.8 * 0.8)) return false;
        var tankClearance = config.Consumables.PickupRadius + clearance;
        return !avoidBots || bots.All(bot => bot.Hp <= 0 || bot.Forfeited ||
            (bot.Position - point).Dot(bot.Position - point) > tankClearance * tankClearance);
    }

    private void AddItem(ConsumableType type, Vec2 position)
    {
        var item = new ItemState(++nextItemId, type, position);
        items.Add(item);
        events.Add(new(tick, GameEventType.ItemSpawned, Position: position, ItemType: type, ItemId: item.Id));
    }

    private void CollectConsumables()
    {
        if (!config.Consumables.Enabled) return;
        ClearInactiveConsumables();
        foreach (var item in items.ToArray())
        {
            var candidates = Enumerable.Range(0, bots.Length).Where(index => IsActive(index) &&
                inventories[index].Count < config.Consumables.InventoryCapacity &&
                (bots[index].Position - item.Position).Dot(bots[index].Position - item.Position) <=
                    config.Consumables.PickupRadius * config.Consumables.PickupRadius &&
                WallImpact(new Hitbox(bots[index].Position, 0, 0, 0), item.Position - bots[index].Position) > 1)
                .Select(index => (Index: index, Distance: (bots[index].Position - item.Position).Dot(bots[index].Position - item.Position)))
                .OrderBy(candidate => candidate.Distance).ToArray();
            if (candidates.Length == 0) continue;
            var tied = candidates.Where(candidate => Math.Abs(candidate.Distance - candidates[0].Distance) < 1e-12)
                .OrderBy(candidate => bots[candidate.Index].Id, StringComparer.Ordinal).ToArray();
            var winner = tied.Length == 1 ? tied[0].Index : tied[random.Next(tied.Length)].Index;
            inventories[winner].Add(item.Type);
            items.Remove(item);
            SyncConsumables(winner);
            events.Add(new(tick, GameEventType.ItemPickedUp, bots[winner].Id,
                Position: item.Position, ItemType: item.Type, ItemId: item.Id));
        }
    }

    private void ClearInactiveConsumables()
    {
        if (!config.Consumables.Enabled) return;
        for (var i = 0; i < bots.Length; i++)
        {
            if (IsActive(i)) continue;
            inventories[i].Clear();
            foreach (var effect in effects[i].ToArray()) EndEffect(i, effect.Type);
            SyncConsumables(i);
        }
    }

    private void UseConsumable(int index, ConsumableType? requested)
    {
        if (!config.Consumables.Enabled || requested is not { } type || !inventories[index].Contains(type)) return;
        var bot = bots[index];
        var rules = config.Consumables;
        if (type == ConsumableType.Repair && bot.Hp == bot.MaxHp) return;
        inventories[index].Remove(type);
        events.Add(new(tick, GameEventType.ItemUsed, bot.Id, Position: bot.Position, ItemType: type));
        switch (type)
        {
            case ConsumableType.Repair:
                var amount = Math.Min(rules.RepairAmount, bot.MaxHp - bot.Hp);
                bots[index] = bot with { Hp = bot.Hp + amount };
                events.Add(new(tick, GameEventType.BotRepaired, bot.Id,
                    Position: bot.Position, ItemType: type, Amount: amount));
                break;
            case ConsumableType.Shield:
                bots[index] = bot with { ShieldHp = rules.ShieldAmount };
                StartEffect(index, type, rules.ShieldDurationSeconds);
                break;
            case ConsumableType.SpeedBoost:
                StartEffect(index, type, rules.BoostDurationSeconds);
                break;
            case ConsumableType.Coolant:
                StartEffect(index, type, rules.CoolantDurationSeconds);
                break;
            case ConsumableType.Smoke:
                var cloud = new SmokeCloud(++nextSmokeId, bot.Id, bot.Position, rules.SmokeRadius,
                    tick + DurationTicks(rules.SmokeDurationSeconds));
                smokeClouds.Add(cloud);
                events.Add(new(tick, GameEventType.SmokeCreated, bot.Id, Position: bot.Position,
                    Radius: cloud.Radius, ItemType: type, ItemId: cloud.Id));
                break;
        }
        SyncConsumables(index);
    }

    private bool HasEffect(int index, ConsumableType type) => effects[index].Any(effect => effect.Type == type);

    private void StartEffect(int index, ConsumableType type, double seconds)
    {
        effects[index].RemoveAll(effect => effect.Type == type);
        effects[index].Add(new(type, tick + DurationTicks(seconds)));
        events.Add(new(tick, GameEventType.EffectStarted, bots[index].Id,
            Position: bots[index].Position, ItemType: type));
    }

    private void EndEffect(int index, ConsumableType type)
    {
        if (effects[index].RemoveAll(effect => effect.Type == type) == 0) return;
        if (type == ConsumableType.Shield) bots[index] = bots[index] with { ShieldHp = 0 };
        SyncConsumables(index);
        events.Add(new(tick, GameEventType.EffectEnded, bots[index].Id,
            Position: bots[index].Position, ItemType: type));
    }

    private void ExpireConsumables()
    {
        if (!config.Consumables.Enabled) return;
        for (var i = 0; i < bots.Length; i++)
        foreach (var effect in effects[i].Where(effect => effect.ExpiresAtTick <= tick).ToArray())
            EndEffect(i, effect.Type);
        foreach (var cloud in smokeClouds.Where(cloud => cloud.ExpiresAtTick <= tick).ToArray())
        {
            smokeClouds.Remove(cloud);
            events.Add(new(tick, GameEventType.SmokeExpired, cloud.OwnerBotId,
                Position: cloud.Position, Radius: cloud.Radius, ItemType: ConsumableType.Smoke, ItemId: cloud.Id));
        }
    }

    private void SyncConsumables(int index) => bots[index] = bots[index] with
    {
        Inventory = inventories[index].ToArray(), ActiveEffects = effects[index].ToArray()
    };

    private bool CanObserve(Vec2 start, Vec2 end)
    {
        if (WallImpact(new Hitbox(start, 0, 0, 0), end - start) <= 1 || !terrain.AllowsSight(start, end)) return false;
        var delta = end - start;
        var distanceSquared = delta.Dot(delta);
        if (distanceSquared <= config.Consumables.SmokeVisibilityRange * config.Consumables.SmokeVisibilityRange) return true;
        foreach (var cloud in smokeClouds)
        {
            var t = distanceSquared == 0 ? 0 : Math.Clamp((cloud.Position - start).Dot(delta) / distanceSquared, 0, 1);
            var offset = cloud.Position - (start + delta * t);
            if (offset.Dot(offset) < cloud.Radius * cloud.Radius) return false;
        }
        return true;
    }
}
