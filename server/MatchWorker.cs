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
        if (request?.BotCode is null || request.OpponentId is null) return 1;

        MatchWorkerResult result;
        IBotRuntime? bot = null;
        IBotRuntime? opponent = null;
        try
        {
            try { bot = StrategyLanguages.Create(request.Language, request.BotCode); }
            catch (StrategyException error)
            {
                result = new(null, error.Message, new("player", error.Tick, error.Message, error.Line, error.Column));
                await JsonSerializer.SerializeAsync(Console.OpenStandardOutput(), result, Json);
                return 0;
            }
            try
            {
                opponent = request.OpponentCode is null
                    ? StrategyLanguages.Create(StrategyLanguages.JavaScript, OpponentCatalog.GetCode(request.OpponentId))
                    : StrategyLanguages.Create(request.OpponentLanguage, request.OpponentCode);
            }
            catch (StrategyException error)
            {
                result = new(null, error.Message, new("opponent", error.Tick, error.Message, error.Line, error.Column));
                await JsonSerializer.SerializeAsync(Console.OpenStandardOutput(), result, Json);
                return 0;
            }
            var config = request.PveLevelId is { } levelId ? PveCatalog.Get(levelId).Config
                : request.CustomArena is { } arena ? new MatchConfig(20, 240, arena,
                    Array.AsReadOnly(new BotSpawn[]
                    {
                        new("player", new(2, 5), 0, 0),
                        new("opponent", new(14, 5), Math.PI, Math.PI)
                    }))
                : MatchConfig.Classic;
            result = new(Match.Run(config, bot, opponent), null);
        }
        catch (StrategyException error)
        {
            result = new(null, error.Message, new("player", error.Tick, error.Message, error.Line, error.Column));
        }
        finally
        {
            opponent?.Dispose();
            bot?.Dispose();
        }
        await JsonSerializer.SerializeAsync(Console.OpenStandardOutput(), result, Json);
        return 0;
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

        var scratch = request.Language == StrategyLanguages.Python || request.OpponentLanguage == StrategyLanguages.Python
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
