namespace BotArena;

internal static class Match
{
    public const string PlayerTeamId = "player";

    public static MatchResponse Run(
        MatchConfig config,
        IReadOnlyDictionary<string, IBotRuntime> runtimes,
        MatchObjective? objective = null,
        ReachMarker? marker = null,
        IReadOnlySet<string>? logBotIds = null)
    {
        objective ??= new DestroyEnemyObjective();
        logBotIds ??= runtimes.Keys
            .Where(id => config.Spawns.Any(spawn => spawn.Id == id && spawn.ResolvedTeamId == PlayerTeamId))
            .ToHashSet(StringComparer.Ordinal);
        if (logBotIds.Count == 0 && runtimes.ContainsKey("player"))
            logBotIds = new HashSet<string>(StringComparer.Ordinal) { "player" };

        var duel = new Duel(config);
        var frames = new List<GameFrame> { duel.CaptureFrame() };
        var behaviorSamples = new List<BehaviorSample>();
        var actions = new Dictionary<string, BotAction>(StringComparer.Ordinal);
        var failures = new List<string>();
        var logs = new List<StrategyLogLine>();
        ScriptError? error = null;

        while (duel.Result is null)
        {
            actions.Clear();
            failures.Clear();
            var tickSamples = new List<BehaviorSample>();
            foreach (var spawn in config.Spawns)
            {
                var bot = duel.Bot(spawn.Id);
                if (bot.Hp <= 0 || bot.Forfeited) continue;
                if (!runtimes.ContainsKey(spawn.Id)) continue;
                try
                {
                    var observation = duel.Observe(spawn.Id);
                    var action = runtimes[spawn.Id].Decide(observation);
                    actions[spawn.Id] = action;
                    tickSamples.Add(new(observation.Tick, spawn.Id, observation.Self.Position,
                        observation.Self.BodyAngle, observation.Self.TurretAngle,
                        observation.Enemy is not null, action));
                    if (logBotIds.Contains(spawn.Id))
                        logs.AddRange(runtimes[spawn.Id].ConsumeLogs());
                    else
                        runtimes[spawn.Id].ConsumeLogs();
                }
                catch (StrategyException failure)
                {
                    failures.Add(spawn.Id);
                    error ??= new(spawn.Id, failure.Tick, failure.Message, failure.Line, failure.Column);
                    if (runtimes.TryGetValue(spawn.Id, out var failedRuntime))
                    {
                        if (logBotIds.Contains(spawn.Id))
                            logs.AddRange(failedRuntime.ConsumeLogs());
                        else
                            failedRuntime.ConsumeLogs();
                    }
                }
            }

            if (failures.Count > 0)
            {
                duel.ForfeitAll(failures);
                frames[^1] = duel.CaptureFrame();
                if (duel.Result is not null) break;
            }

            duel.Step(actions);
            behaviorSamples.AddRange(tickSamples);

            if (objective is ReachPointObjective reach && duel.Result is null)
            {
                var bot = duel.Bot("player");
                var offset = bot.Position - reach.Point;
                if (bot.Hp > 0 && double.Hypot(offset.X, offset.Y) <= reach.Radius)
                    duel.CompleteObjective("player");
            }

            frames.Add(duel.CaptureFrame());
        }

        return new(new(config.TickRate, config.Arena, frames, duel.Result!, behaviorSamples, marker) { RandomSeed = config.RandomSeed }, error, logs);
    }

    public static MatchResponse Run(
        MatchConfig config,
        IBotRuntime player,
        IBotRuntime opponent,
        MatchObjective? objective = null,
        ReachMarker? marker = null) =>
        Run(config, new Dictionary<string, IBotRuntime>(StringComparer.Ordinal)
        {
            ["player"] = player,
            ["opponent"] = opponent
        }, objective, marker, new HashSet<string>(StringComparer.Ordinal) { "player" });
}
