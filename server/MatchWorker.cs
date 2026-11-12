using System.Diagnostics;
using System.Reflection;
using System.Text.Json;

namespace BotArena;

internal record MatchWorkerResult(MatchResponse? Response, string? Error, ScriptError? Diagnostic = null);

internal static class MatchWorker
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static async Task<int> RunChildAsync()
    {
        var request = await JsonSerializer.DeserializeAsync<MatchRequest>(Console.OpenStandardInput(), Json);
        if (request is null) return 1;
        if (request.CustomMatch is null && request.BotCode is null) return 1;
        if (request.CustomMatch is null && request.PveLevelId is null && request.OpponentCode is null &&
            request.CampaignLevelId is null &&
            MatchSetup.GetOpponents(request) is null && request.OpponentId is null) return 1;

        MatchWorkerResult result;
        try
        {
            result = request.PveLevelId is not null || request.OpponentCode is not null || request.CustomArena is not null
                ? RunTrustedDuel(request)
                : request.CustomMatch is not null ? RunCustom(request, request.CustomMatch)
                : request.CampaignLevelId is { } levelId ? RunCampaign(request, levelId)
                : MatchSetup.GetOpponents(request) is { } opponents ? RunFfa(request, opponents)
                : RunLab(request);
        }
        catch (StrategyException error)
        {
            result = new(null, error.Message, new("player", error.Tick, error.Message, error.Line, error.Column));
        }
        await JsonSerializer.SerializeAsync(Console.OpenStandardOutput(), result, Json);
        return 0;
    }

    private static MatchWorkerResult RunTrustedDuel(MatchRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.BotCode) || string.IsNullOrWhiteSpace(request.OpponentCode))
            throw new StrategyException("Для доверенного боя нужен код обоих участников.");
        using var player = StrategyLanguages.Create(request.Language, request.BotCode);
        using var opponent = StrategyLanguages.Create(request.OpponentLanguage, request.OpponentCode);
        var config = request.PveLevelId is { } levelId ? PveCatalog.Get(levelId).Config
            : request.CustomArena is { } arena ? new MatchConfig(20, 240, arena,
                Array.AsReadOnly(new BotSpawn[]
                {
                    new("player", new(2, 5), 0, 0, "player"),
                    new("opponent", new(14, 5), Math.PI, Math.PI, "opponent")
                }))
            : MatchConfig.Classic;
        return new(Match.Run(config, player, opponent), null);
    }

    private static MatchWorkerResult RunFfa(MatchRequest request, IReadOnlyList<OpponentSlot> opponents)
    {
        if (!MovementCatalog.Supports(request.Movement))
            throw new StrategyException("Выбранная модель движения недоступна.");
        var config = MatchSetup.Configure(request.Movement, opponents);
        var navigator = new ArenaNavigator(config);
        var runtimes = new Dictionary<string, IBotRuntime>(StringComparer.Ordinal);
        var owned = new List<IDisposable>();
        try
        {
            var startingBotId = config.Spawns[0].Id;
            var player = StrategyLanguages.Create(request.Language, request.BotCode!);
            owned.Add(player);
            runtimes.Add(startingBotId, player);
            for (var i = 0; i < opponents.Count; i++)
            {
                var botId = config.Spawns[i + 1].Id;
                var opponent = new BuiltInOpponent(opponents[i].Id!, navigator);
                owned.Add(opponent);
                runtimes.Add(botId, opponent);
            }
            return new(Match.Run(config, runtimes), null);
        }
        finally
        {
            foreach (var runtime in owned) runtime.Dispose();
        }
    }

    private static MatchWorkerResult RunLab(MatchRequest request)
    {
        if (!OpponentCatalog.Supports(request.OpponentId))
            throw new StrategyException("Выбранный противник недоступен.");
        var config = MatchConfig.Classic;
        var navigator = new ArenaNavigator(config);
        using var bot = StrategyLanguages.Create(request.Language, request.BotCode!);
        using var opponent = new BuiltInOpponent(request.OpponentId!, navigator);
        return new(Match.Run(config, bot, opponent), null);
    }

    private static MatchWorkerResult RunCustom(MatchRequest request, CustomMatchSpec custom)
    {
        var spawns = custom.Spawns.Select(spawn =>
            new BotSpawn(
                spawn.Id,
                new(spawn.X, spawn.Y),
                spawn.BodyAngle,
                spawn.TurretAngle,
                spawn.TeamId,
                spawn.Hp) { Movement = MovementCatalog.Create(spawn.Movement) }).ToArray();
        var captureMode = CapturePointSetup.IsCapturePoint(custom.Mode);
        var config = MatchConfig.Classic with
        {
            MaxTicks = custom.MaxTicks ?? MatchConfig.Classic.MaxTicks,
            Arena = custom.Arena with { Walls = Array.AsReadOnly(custom.Arena.Walls.ToArray()) },
            Spawns = Array.AsReadOnly(spawns),
            ShrinkZoneEnabled = !captureMode && MatchConfig.Classic.ShrinkZoneEnabled,
        };

        MatchObjective? objective = captureMode
            ? CapturePointSetup.CreateObjective(custom.Bases)
            : null;

        var loadouts = custom.Loadouts.ToDictionary(item => item.BotId, StringComparer.Ordinal);
        var runtimes = new Dictionary<string, IBotRuntime>(StringComparer.Ordinal);
        var owned = new List<IDisposable>();
        try
        {
            foreach (var spawn in spawns)
            {
                if (!loadouts.TryGetValue(spawn.Id, out var loadout))
                    throw new StrategyException($"Нет loadout для бота {spawn.Id}.");
                var runtime = CreateLoadoutRuntime(request, spawn, loadout);
                owned.Add(runtime);
                runtimes[spawn.Id] = runtime;
            }

            var playerIds = spawns
                .Where(spawn => spawn.ResolvedTeamId == Match.PlayerTeamId)
                .Select(spawn => spawn.Id)
                .ToHashSet(StringComparer.Ordinal);
            return new(Match.Run(config, runtimes, objective, logBotIds: playerIds), null);
        }
        finally
        {
            foreach (var item in owned) item.Dispose();
        }
    }

    private static IBotRuntime CreateLoadoutRuntime(MatchRequest request, BotSpawn spawn, CustomMatchLoadout loadout)
    {
        if (string.Equals(loadout.Source, "preset", StringComparison.OrdinalIgnoreCase))
            return StrategyLanguages.Create(StrategyLanguages.JavaScript, BehaviorPresets.GetCode(loadout.PresetId!));

        return StrategyLanguages.Create(request.Language, loadout.Code!);
    }

    private static MatchWorkerResult RunCampaign(MatchRequest request, string levelId)
    {
        var level = CampaignCatalog.Find(levelId)
            ?? throw new StrategyException("Выбранный уровень кампании недоступен.");
        var runtimes = new Dictionary<string, IBotRuntime>(StringComparer.Ordinal);
        var owned = new List<IDisposable>();
        try
        {
            foreach (var spawn in level.Config.Spawns)
            {
                IBotRuntime runtime;
                if (spawn.ResolvedTeamId == Match.PlayerTeamId)
                {
                    var code = ResolvePlayerCode(request, spawn.Id, level);
                    runtime = StrategyLanguages.Create(request.Language, code);
                }
                else
                {
                    runtime = StrategyLanguages.Create(
                        StrategyLanguages.JavaScript, level.OpponentCodeFor(spawn.Id));
                }
                owned.Add(runtime);
                runtimes[spawn.Id] = runtime;
            }

            var playerIds = level.Config.Spawns
                .Where(spawn => spawn.ResolvedTeamId == Match.PlayerTeamId)
                .Select(spawn => spawn.Id)
                .ToHashSet(StringComparer.Ordinal);
            return new(Match.Run(level.Config, runtimes, level.Objective, level.Marker, playerIds), null);
        }
        finally
        {
            foreach (var item in owned) item.Dispose();
        }
    }

    private static string ResolvePlayerCode(MatchRequest request, string botId, CampaignLevel level)
    {
        if (request.BotCodes is not null &&
            request.BotCodes.TryGetValue(botId, out var mapped) &&
            !string.IsNullOrWhiteSpace(mapped))
            return mapped;
        if (botId == "player" && !string.IsNullOrWhiteSpace(request.BotCode))
            return request.BotCode!;
        var script = level.ResolvedPlayerScripts.FirstOrDefault(item => item.BotId == botId);
        if (script is not null)
        {
            return request.Language == StrategyLanguages.Python
                ? script.Python
                : script.JavaScript;
        }
        if (!string.IsNullOrWhiteSpace(request.BotCode)) return request.BotCode!;
        throw new StrategyException($"Нет кода стратегии для бота {botId}.");
    }

    public static async Task<MatchWorkerResult> RunAsync(MatchRequest request, CancellationToken cancellation)
    {
        var start = new ProcessStartInfo(Environment.ProcessPath!)
        {
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        if (Path.GetFileNameWithoutExtension(start.FileName) == "dotnet")
            start.ArgumentList.Add(Assembly.GetExecutingAssembly().Location);
        start.ArgumentList.Add("--match-worker");
        // Keep the worker's managed heap bounded even when a strategy retains state across ticks.
        start.Environment["DOTNET_GCHeapHardLimit"] = "0x8000000";
        start.Environment["DOTNET_gcServer"] = "0";

        var needsPython = request.OpponentLanguage == StrategyLanguages.Python || request.Language == StrategyLanguages.Python &&
            (request.CustomMatch?.Loadouts.Any(item =>
                string.Equals(item.Source, "code", StringComparison.OrdinalIgnoreCase) &&
                request.CustomMatch.Spawns.Any(spawn =>
                    spawn.Id == item.BotId && spawn.TeamId == Match.PlayerTeamId)) == true
            || request.CustomMatch is null);
        var scratch = needsPython
            ? Directory.CreateTempSubdirectory("botarena-match-")
            : null;
        if (scratch is not null) start.Environment[PythonBot.ScratchVariable] = scratch.FullName;
        try
        {
            return await RunProcessAsync(start, request, cancellation);
        }
        finally
        {
            if (scratch is not null)
            {
                PythonBot.DeleteScratch(new DirectoryInfo(Path.Combine(scratch.FullName, "guest")));
                scratch.Delete(recursive: true);
            }
        }
    }

    private static async Task<MatchWorkerResult> RunProcessAsync(
        ProcessStartInfo start, MatchRequest request, CancellationToken cancellation)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        timeout.CancelAfter(TimeSpan.FromSeconds(5));
        using var process = Process.Start(start) ?? throw new InvalidOperationException("Cannot start match worker.");
        var stderr = process.StandardError.BaseStream.CopyToAsync(Stream.Null);
        try
        {
            await JsonSerializer.SerializeAsync(process.StandardInput.BaseStream, request, Json, timeout.Token);
            process.StandardInput.Close();

            var result = await JsonSerializer.DeserializeAsync<MatchWorkerResult>(
                process.StandardOutput.BaseStream, Json, timeout.Token);
            await process.WaitForExitAsync(timeout.Token);
            return process.ExitCode == 0 && result is not null ? result : WorkerFailed();
        }
        catch (OperationCanceledException) when (!cancellation.IsCancellationRequested)
        {
            return new(null, "Матч превысил лимит в 5 секунд.");
        }
        catch (Exception error) when (error is IOException or JsonException)
        {
            cancellation.ThrowIfCancellationRequested();
            return WorkerFailed();
        }
        finally
        {
            if (!process.HasExited)
            {
                try { process.Kill(entireProcessTree: true); }
                catch (InvalidOperationException) { /* The worker already exited. */ }
            }
            await process.WaitForExitAsync();
            await stderr;
        }
    }

    private static MatchWorkerResult WorkerFailed() => new(null,
        "Процесс симуляции завершился досрочно. Проверьте стратегию и повторите запуск.");
}
