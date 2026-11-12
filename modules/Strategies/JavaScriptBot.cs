using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using Jint;
using Jint.Native;
using Jint.Runtime;
using Jint.Runtime.Interop;

namespace BotArena;

public sealed class JavaScriptBot : IBotRuntime
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly string HelpersSource = ReadResource("BotArena.StrategyHelpers.js");
    private const string StrategySource = "strategy.js";
    private const string HelpersFile = "helpers.js";
    private const int LogLimit = 200;
    private const int LogMessageLimit = 200;

    private readonly Engine engine = new(options =>
    {
        options.Strict();
        options.MaxStatements(500_000);
        options.LimitMemory(8_000_000);
        options.TimeoutInterval(TimeSpan.FromMilliseconds(250));
        options.LimitRecursion(48);
        options.Constraints.RegexTimeout = TimeSpan.FromMilliseconds(30);
        options.Constraints.MaxArraySize = 20_000;
        options.Host.StringCompilationAllowed = false;
    });
    private readonly JsValue execute;
    private readonly JsValue tick;
    private readonly List<StrategyLogLine> logs = [];
    private int? logTick;

    public JavaScriptBot(string source)
    {
        try
        {
            engine.SetValue("__botarenaLog", new ClrFunction(engine, "__botarenaLog", WriteLog));
            engine.Execute("""
                (() => {
                  const format = value => {
                    if (value === undefined) return 'undefined';
                    if (value === null) return 'null';
                    if (typeof value === 'string') return value;
                    try { return JSON.stringify(value); } catch { return String(value); }
                  };
                  const write = (...args) => __botarenaLog(args.map(format).join(' '));
                  globalThis.log = write;
                  globalThis.console = Object.freeze({
                    log: write, info: write, warn: write, error: write, debug: write
                  });
                })();
                """, "console.js");
            engine.Execute(HelpersSource, HelpersFile);
            // Capture the intrinsics before user code can change them. Read user getters
            // inside Invoke so property access consumes the same budget as tick().
            execute = engine.Evaluate("""
                ((parse, stringify, finite, isArray, min, max, keys, driveTo, aimAt) => (tick, input) => {
                    const state = parse(input);
                    const action = tick(state);
                    if (action === null || typeof action !== 'object' ||
                        isArray(action) || typeof action.then === 'function') return '';
                    const pointOf = value => {
                        if (value == null || typeof value !== 'object' || isArray(value)) return null;
                        if (!finite(value.x) || !finite(value.y)) return null;
                        return value;
                    };
                    const readVector = value => {
                        if (value === undefined) return { __proto__: null, x: 0, y: 0 };
                        if (value === null || typeof value !== 'object' || isArray(value)) return null;
                        const x = value.x;
                        const y = value.y;
                        return finite(x) && finite(y) ? { __proto__: null, x, y } : null;
                    };
                    let left = action.leftTrack;
                    let right = action.rightTrack;
                    const driveTarget = action.driveTo === undefined ? null : pointOf(action.driveTo);
                    if (driveTarget && left === undefined && right === undefined) {
                        const steered = driveTo(state.self, driveTarget);
                        left = steered.leftTrack;
                        right = steered.rightTrack;
                    }
                    const aimDir = action.aimDirection;
                    const turretTurn = action.turretTurn;
                    const high = action.aim;
                    const useItem = action.useItem;
                    if (useItem !== undefined && typeof useItem !== 'string') return '';
                    const shotTarget = action.targetPoint === undefined ? undefined : readVector(action.targetPoint);
                    if (shotTarget === null) return '';
                    let highAim;
                    if (high !== undefined) {
                        if (aimDir !== undefined || turretTurn !== undefined || high === null ||
                            typeof high !== 'object' || isArray(high)) return '';
                        const kind = high.kind;
                        if (kind !== 'at' && kind !== 'hold' && kind !== 'scan') return '';
                        const names = keys(high);
                        for (let i = 0; i < names.length; i++) {
                            const name = names[i];
                            if (name !== 'kind' && !(kind === 'at' && name === 'target') &&
                                !(kind === 'scan' && (name === 'speed' || name === 'direction'))) return '';
                        }
                        if (kind === 'at') {
                            const target = high.target;
                            if (target === null || typeof target !== 'object' || isArray(target)) return '';
                            const tx = target.x, ty = target.y;
                            if (!finite(tx) || !finite(ty)) return '';
                            highAim = { __proto__: null, kind, target: { __proto__: null, x: tx, y: ty } };
                        } else if (kind === 'scan') {
                            const speed = high.speed;
                            const direction = high.direction;
                            if ((speed !== undefined && !finite(speed)) ||
                                (direction !== undefined && typeof direction !== 'string')) return '';
                            highAim = { __proto__: null, kind, speed, direction };
                        } else {
                            highAim = { __proto__: null, kind };
                        }
                    }
                    let x = 0;
                    let y = 0;
                    const aimTarget = action.aimAt === undefined ? null : pointOf(action.aimAt);
                    if (aimTarget) {
                        x = aimTarget.x - state.self.position.x;
                        y = aimTarget.y - state.self.position.y;
                    } else if (aimDir !== undefined) {
                        if (aimDir === null || typeof aimDir !== 'object' || isArray(aimDir)) return '';
                        x = aimDir.x;
                        y = aimDir.y;
                    }
                    if (turretTurn !== undefined && (aimDir !== undefined || aimTarget || !finite(turretTurn))) return '';
                    const thrust = readVector(action.thrust);
                    const bodyTurn = action.turn;
                    const throttle = action.throttle;
                    const shoot = action.shoot;
                    if ((left !== undefined && !finite(left)) || (right !== undefined && !finite(right)) ||
                        !finite(x) || !finite(y) || !thrust ||
                        (bodyTurn !== undefined && !finite(bodyTurn)) ||
                        (throttle !== undefined && !finite(throttle)) ||
                        (shoot !== undefined && typeof shoot !== 'boolean')) return '';
                    return stringify({
                        __proto__: null,
                        leftTrack: min(1, max(-1, left ?? 0)),
                        rightTrack: min(1, max(-1, right ?? 0)),
                        aimDirection: { __proto__: null, x, y },
                        turretTurn: turretTurn === undefined ? null : min(1, max(-1, turretTurn)),
                        aim: highAim,
                        targetPoint: shotTarget,
                        useItem,
                        thrust,
                        turn: min(1, max(-1, bodyTurn ?? 0)),
                        throttle: min(1, max(-1, throttle ?? 0)),
                        shoot: shoot === true
                    });
                })(JSON.parse, JSON.stringify, Number.isFinite, Array.isArray, Math.min, Math.max, Object.keys,
                   globalThis.driveTo, globalThis.aimAt)
                """);
            using var api = typeof(JavaScriptBot).Assembly.GetManifestResourceStream("BotArena.BotApi.js")!;
            using var reader = new StreamReader(api);
            engine.Execute(reader.ReadToEnd(), "botarena.js");
            engine.Execute(source, StrategySource);
            tick = engine.Evaluate("typeof tick === 'function' ? tick : null");
            if (tick.IsNull()) throw new StrategyException("Объявите функцию tick(state).");
        }
        catch (Exception error)
        {
            engine.Dispose();
            if (!IsScriptError(error)) throw;
            throw Describe(error, "при загрузке стратегии");
        }
    }

    public BotAction Decide(BotObservation observation)
    {
        logTick = observation.Tick;
        try
        {
            var input = JsonSerializer.Serialize(observation, Json);
            var output = engine.Invoke(execute, tick, new JsString(input)).AsString();
            if (output.Length == 0)
            {
                throw new StrategyException(
                    "tick(state) должна вернуть объект команды: leftTrack/rightTrack или driveTo, throttle/turn/thrust, aimAt или aimDirection, логический shoot и только один способ управления башней — aim, aimDirection { x, y } или числовой turretTurn.",
                    observation.Tick);
            }
            using var document = JsonDocument.Parse(output);
            return StrategyAction.Decode(document.RootElement, observation);
        }
        catch (Exception error) when (IsScriptError(error))
        {
            throw Describe(error, "при вызове tick(state)", observation.Tick);
        }
    }

    public IReadOnlyList<StrategyLogLine> ConsumeLogs()
    {
        var snapshot = logs.ToArray();
        logs.Clear();
        return snapshot;
    }

    private JsValue WriteLog(JsValue thisObject, JsValue[] arguments)
    {
        if (logs.Count >= LogLimit || arguments.Length == 0) return JsValue.Undefined;
        var message = arguments[0].ToString();
        if (message.Length > LogMessageLimit) message = message[..LogMessageLimit];
        logs.Add(new(logTick, message));
        return JsValue.Undefined;
    }

    private static string ReadResource(string name)
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name)
            ?? throw new InvalidOperationException($"Missing resource {name}.");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    private static bool IsScriptError(Exception error) =>
        error is JavaScriptException or TimeoutException or RegexMatchTimeoutException
            or StatementsCountOverflowException or MemoryLimitExceededException or RecursionDepthOverflowException
            or Acornima.ParseErrorException;

    private static StrategyException Describe(Exception error, string phase, int? tick = null)
    {
        if (error is JavaScriptException scriptError)
        {
            var detail = CleanErrorDetail(scriptError.Message);
            var message = string.IsNullOrWhiteSpace(detail)
                ? $"Ошибка JavaScript {phase}."
                : $"Ошибка JavaScript {phase}: {detail}";
            var location = scriptError.Location;
            if (location.SourceFile == StrategySource && location.Start.Line > 0)
            {
                var line = location.Start.Line;
                var column = location.Start.Column + 1;
                return new(message, tick, line, column);
            }
            return new(message, tick);
        }
        if (error is Acornima.ParseErrorException parseError)
        {
            var detail = CleanErrorDetail(parseError.Message);
            var message = string.IsNullOrWhiteSpace(detail)
                ? $"Синтаксическая ошибка {phase}."
                : $"Синтаксическая ошибка {phase}: {detail}";
            var line = parseError.LineNumber > 0 ? parseError.LineNumber : (int?)null;
            var column = parseError.Column >= 0 ? parseError.Column + 1 : (int?)null;
            return new(message, tick, line, column);
        }
        return new($"Превышен лимит исполнения {phase}.", tick);
    }

    private static string CleanErrorDetail(string? detail)
    {
        if (string.IsNullOrWhiteSpace(detail)) return "";
        var text = detail.Trim();
        // Drop noisy engine prefixes like "Error: " while keeping the useful part.
        if (text.StartsWith("Error:", StringComparison.OrdinalIgnoreCase))
            text = text["Error:".Length..].Trim();
        // Location is shown separately as line/column in the UI.
        var sourceMarker = text.LastIndexOf(" (strategy.js:", StringComparison.Ordinal);
        if (sourceMarker > 0 && text.EndsWith(')'))
            text = text[..sourceMarker].TrimEnd();
        if (text.Length > 240) text = text[..240].TrimEnd() + "…";
        return text;
    }

    public void Dispose() => engine.Dispose();
}
