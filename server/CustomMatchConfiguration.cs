namespace BotArena;

internal static class CustomMatchConfiguration
{
    public static MatchConfig Create(CustomMatchSpec custom, int randomSeed)
    {
        var hill = custom.Mode == MatchMode.KingOfHill;
        var deathmatch = custom.Mode == MatchMode.Deathmatch;
        return MatchConfig.Classic with
        {
            Mode = custom.Mode,
            MaxTicks = custom.MaxTicks ?? (hill || deathmatch ? 120 * MatchConfig.Classic.TickRate : MatchConfig.Classic.MaxTicks),
            Arena = custom.Arena with { Walls = Array.AsReadOnly(custom.Arena.Walls.ToArray()) },
            Spawns = custom.Spawns.Select(spawn => new BotSpawn(spawn.Id, new(spawn.X, spawn.Y),
                spawn.BodyAngle, spawn.TurretAngle, spawn.TeamId, spawn.Hp, spawn.Weapon)
                { Movement = MovementCatalog.Create(spawn.Movement) }).ToArray(),
            KingOfHill = hill ? new(custom.ControlZone ?? new(new(custom.Arena.Width / 2, custom.Arena.Height / 2), 1.5)) : null,
            Deathmatch = deathmatch ? new()
            {
                RespawnPoints = custom.RespawnPoints ?? custom.Spawns.Select(spawn =>
                    new RespawnPoint(spawn.Id, new(spawn.X, spawn.Y), spawn.BodyAngle, spawn.TurretAngle)).ToArray(),
            } : null,
            ShrinkZoneEnabled = !hill && !deathmatch,
            Consumables = MatchConfig.Biomes.Consumables,
            RandomSeed = randomSeed,
        };
    }
}
