using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace BotArena;

public sealed class PythonBot : IBotRuntime
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly TimeSpan StartupLimit = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan TickLimit = TimeSpan.FromMilliseconds(150);
    public const string ScratchVariable = "BOTARENA_PYTHON_SCRATCH";
    private const int ReplyLimit = 4096;

    private readonly DirectoryInfo scratch;
    private Process? process;
    private Task? stderr;

    public static bool IsAvailable(string? runtime) =>
        (OperatingSystem.IsMacOS() || OperatingSystem.IsLinux()) && runtime is not null &&
        File.Exists(Path.Combine(runtime, "wasmtime")) &&
        File.Exists(Path.Combine(runtime, "python.wasm")) &&
        File.Exists(Path.Combine(runtime, "python315.zip"));

    public PythonBot(string source, string? runtime)
    {
        if (!IsAvailable(runtime))
            throw new StrategyException("Среда Python не установлена.");

        var parentScratch = Environment.GetEnvironmentVariable(ScratchVariable);
        scratch = parentScratch is null
            ? Directory.CreateTempSubdirectory("botarena-python-")
            : Directory.CreateDirectory(Path.Combine(parentScratch, "guest-" + Guid.NewGuid().ToString("N")));
        try
        {
            var lib = scratch.CreateSubdirectory("lib");
            // WASI sees only a read-only copy of the standard library.
            var archive = Path.Combine(lib.FullName, "python315.zip");
            File.Copy(Path.Combine(runtime!, "python315.zip"), archive);
            if (!OperatingSystem.IsWindows())
            {
                File.SetUnixFileMode(archive, UnixFileMode.UserRead);
                File.SetUnixFileMode(lib.FullName, UnixFileMode.UserRead | UnixFileMode.UserExecute);
                File.SetUnixFileMode(scratch.FullName, UnixFileMode.UserRead | UnixFileMode.UserExecute);
            }
            using var bridge = typeof(PythonBot).Assembly.GetManifestResourceStream("BotArena.PythonBridge.py")!;
            using var reader = new StreamReader(bridge);
            var start = new ProcessStartInfo(Path.Combine(runtime!, "wasmtime"))
            {
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            foreach (var argument in new[]
            {
                "run", "--dir", $"{scratch.FullName}::/runtime", "--env", "PYTHONHOME=/runtime",
                "-S", "inherit-network=n,tcp=n,udp=n,allow-ip-name-lookup=n",
                "-W", "max-memory-size=67108864,fuel=5000000000",
                Path.Combine(runtime!, "python.wasm"), "-P", "-s", "-S", "-B", "-u", "-c", reader.ReadToEnd(),
            })
                start.ArgumentList.Add(argument);

            process = Process.Start(start) ?? throw new StrategyException("Не удалось запустить среду Python.");
            stderr = process.StandardError.BaseStream.CopyToAsync(Stream.Null);
            var reply = Exchange(source, StartupLimit, null);
            if (!reply.Ready) throw new StrategyException("Среда Python не подтвердила загрузку стратегии.");
        }
        catch
        {
            Dispose();
            throw;
        }
    }

    public BotAction Decide(BotObservation observation)
    {
        var reply = Exchange(observation, TickLimit, observation.Tick);
        if (reply.Action is not { } action ||
            !double.IsFinite(action.LeftTrack) || !double.IsFinite(action.RightTrack) ||
            !double.IsFinite(action.AimDirection.X) || !double.IsFinite(action.AimDirection.Y))
            throw new StrategyException("Некорректная команда Python.", observation.Tick);
        return action with { LeftTrack = Math.Clamp(action.LeftTrack, -1, 1), RightTrack = Math.Clamp(action.RightTrack, -1, 1) };
    }

    private Reply Exchange<T>(T input, TimeSpan limit, int? tick)
    {
        using var deadline = new CancellationTokenSource(limit);
        try
        {
            var reply = ExchangeAsync(JsonSerializer.Serialize(input, Json), deadline.Token).GetAwaiter().GetResult();
            if (reply.Error is not null) throw new StrategyException(reply.Error, tick, reply.Line, reply.Column);
            return reply;
        }
        catch (OperationCanceledException) when (deadline.IsCancellationRequested)
        {
            throw new StrategyException("Превышен лимит исполнения Python.", tick);
        }
        catch (Exception error) when (error is IOException or JsonException)
        {
            throw new StrategyException("Среда Python завершила расчёт или вернула некорректный ответ.", tick);
        }
    }

    private async Task<Reply> ExchangeAsync(string request, CancellationToken cancellation)
    {
        await process!.StandardInput.WriteLineAsync(request.AsMemory(), cancellation);
        await process.StandardInput.FlushAsync(cancellation);
        var output = process.StandardOutput;
        var reply = new StringBuilder();
        var character = new char[1];
        while (reply.Length < ReplyLimit && await output.ReadAsync(character.AsMemory(), cancellation) != 0)
        {
            if (character[0] == '\n')
                return JsonSerializer.Deserialize<Reply>(reply.ToString(), Json) ?? throw new JsonException();
            reply.Append(character[0]);
        }
        throw new IOException("Missing or oversized Python response.");
    }

    public void Dispose()
    {
        if (process is not null)
        {
            if (!process.HasExited)
            {
                try { process.Kill(entireProcessTree: true); }
                catch (InvalidOperationException) { }
            }
            process.WaitForExit();
            stderr?.GetAwaiter().GetResult();
            process.Dispose();
            process = null;
        }
        DeleteScratch(scratch);
    }

    public static void DeleteScratch(DirectoryInfo directory)
    {
        if (!directory.Exists) return;
        if (!OperatingSystem.IsWindows())
        {
            const UnixFileMode writable = UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute;
            File.SetUnixFileMode(directory.FullName, writable);
            var lib = Path.Combine(directory.FullName, "lib");
            if (Directory.Exists(lib)) File.SetUnixFileMode(lib, writable);
        }
        directory.Delete(recursive: true);
    }

    private sealed record Reply(bool Ready, BotAction? Action, string? Error, int? Line, int? Column);
}
