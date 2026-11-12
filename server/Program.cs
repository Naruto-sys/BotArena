using BotArena;
using Microsoft.EntityFrameworkCore;
using System.Text.Json.Serialization;

if (args is ["--match-worker"]) return await MatchWorker.RunChildAsync();

var builder = WebApplication.CreateBuilder(args);
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: true)
    .AddEnvironmentVariables();
builder.WebHost.UseUrls(builder.Configuration["Urls"] ?? "http://127.0.0.1:5050");
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 256 * 1024);
builder.Services.AddSingleton<MatchQueue>();
builder.Services.AddHostedService(services => services.GetRequiredService<MatchQueue>());
var connectionString = builder.Configuration.GetConnectionString("BotArena")
    ?? throw new InvalidOperationException("ConnectionStrings:BotArena is required.");
builder.Services.AddDbContext<UgcDbContext>(options => options.UseNpgsql(connectionString));
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddYandexAuthentication(builder.Configuration);

var app = builder.Build();
if (builder.Configuration.GetValue("Database:MigrateOnStartup", true))
{
    await using var scope = app.Services.CreateAsyncScope();
    await scope.ServiceProvider.GetRequiredService<UgcDbContext>().Database.MigrateAsync();
}
await StrategyValidationService.ValidateStoredStrategiesAsync(app.Services);
if (Directory.Exists(app.Environment.WebRootPath))
{
    app.UseDefaultFiles();
    app.UseStaticFiles();
}

app.UseAuthentication();
app.UseAuthorization();
app.MapAuthenticationEndpoints();
app.MapUgcEndpoints();
app.MapFriendEndpoints();
app.MapRoomEndpoints();
app.MapBattleMapEndpoints();
app.MapPveEndpoints();

app.MapGet("/api/opponents", () => OpponentCatalog.Opponents);
app.MapGet("/api/behavior-presets", () => BehaviorPresets.All);
app.MapGet("/api/campaign", () => CampaignCatalog.List());
app.MapGet("/api/strategy-languages", () => StrategyLanguages.Available());
app.MapPost("/api/match-jobs", (MatchRequest request, MatchQueue queue) =>
{
    if (Validate(request) is { } invalid) return invalid;
    var safeRequest = request with { OpponentCode = null, OpponentLanguage = null, PveLevelId = null, CustomArena = null };
    if (queue.Enqueue(safeRequest) is not { } job) return QueueFull();
    return Results.Accepted($"/api/match-jobs/{job.Id}", new { id = job.Id });
}).AllowAnonymous();
app.MapGet("/api/match-jobs/{id:guid}", (Guid id, MatchQueue queue, HttpResponse response) =>
{
    response.Headers.CacheControl = "no-store";
    return queue.GetStatus(id) is { } status ? Results.Ok(status) : Results.NotFound();
}).AllowAnonymous();
app.MapPost("/api/matches", async (MatchRequest request, MatchQueue queue, CancellationToken cancellation) =>
{
    if (Validate(request) is { } invalid) return invalid;
    var safeRequest = request with { OpponentCode = null, OpponentLanguage = null, PveLevelId = null, CustomArena = null };
    if (queue.Enqueue(safeRequest, cancellation) is not { } job) return QueueFull();

    using var registration = cancellation.Register(() => queue.CancelWaiting(job));
    var result = await job.Completion.Task;
    return result.Response is { } response
        ? Results.Ok(response)
        : Results.UnprocessableEntity(new { error = result.Error });
}).AllowAnonymous();

await app.RunAsync();
return 0;

static IResult? Validate(MatchRequest request)
{
    if (request.Language is { } language && !StrategyLanguages.Available().Contains(language))
        return Results.BadRequest(new { error = "Выбранный язык стратегии недоступен." });

    if (request.CampaignLevelId is { } levelId)
    {
        if (string.IsNullOrWhiteSpace(request.BotCode) || request.BotCode.Length > 16_384)
            return Results.BadRequest(new { error = "Нужен код стратегии длиной от 1 до 16 384 символов." });
        if (request.BotCodes is not null)
        {
            foreach (var code in request.BotCodes.Values)
            {
                if (string.IsNullOrWhiteSpace(code) || code.Length > 16_384)
                    return Results.BadRequest(new { error = "Код стратегии каждого танка должен быть от 1 до 16 384 символов." });
            }
        }
        if (CampaignCatalog.Find(levelId) is null)
            return Results.BadRequest(new { error = "Выберите существующий уровень кампании." });
        return null;
    }

    if (request.CustomMatch is { } custom)
        return ValidateCustomMatch(request, custom);

    if (string.IsNullOrWhiteSpace(request.BotCode) || request.BotCode.Length > 16_384)
        return Results.BadRequest(new { error = "Нужен код стратегии длиной от 1 до 16 384 символов." });
    if (MatchSetup.GetOpponents(request) is not null)
    {
        if (!MovementCatalog.Supports(request.Movement))
            return Results.BadRequest(new { error = "Выбранная модель движения недоступна." });
        return null;
    }
    if (!OpponentCatalog.Opponents.Any(opponent => opponent.Id == request.OpponentId))
        return Results.BadRequest(new { error = "Выберите существующего противника или от одного до трёх соперников с доступными моделями движения." });
    return null;
}

static IResult? ValidateCustomMatch(MatchRequest request, CustomMatchSpec custom)
{
    if (custom.Spawns is null || custom.Loadouts is null)
        return Results.BadRequest(new { error = "Для customMatch нужны spawns и loadouts." });
    if (custom.Spawns.Count is < 2 or > 8)
        return Results.BadRequest(new { error = "В матче должно быть от 2 до 8 танков." });
    if (custom.Arena is null || custom.Arena.Width != 16 || custom.Arena.Height != 10)
        return Results.BadRequest(new { error = "Арена customMatch должна быть 16×10." });
    if (custom.MaxTicks is { } ticks && ticks is < 40 or > 1200)
        return Results.BadRequest(new { error = "MaxTicks должен быть от 40 до 1200." });

    var ids = new HashSet<string>(StringComparer.Ordinal);
    var hasPlayer = false;
    var hasEnemy = false;
    foreach (var spawn in custom.Spawns)
    {
        if (string.IsNullOrWhiteSpace(spawn.Id) || !ids.Add(spawn.Id))
            return Results.BadRequest(new { error = "ID танков должны быть непустыми и уникальными." });
        if (string.IsNullOrWhiteSpace(spawn.TeamId))
            return Results.BadRequest(new { error = "У каждого танка должен быть teamId." });
        if (spawn.TeamId == Match.PlayerTeamId) hasPlayer = true;
        else hasEnemy = true;
        if (!MovementCatalog.Supports(spawn.Movement))
            return Results.BadRequest(new { error = "Выберите существующее шасси робота." });
        if (spawn.Hp is < 1 or > 500)
            return Results.BadRequest(new { error = "HP танка должен быть от 1 до 500." });
        if (spawn.X < 0.5 || spawn.Y < 0.5 || spawn.X > 15.5 || spawn.Y > 9.5)
            return Results.BadRequest(new { error = "Спавны должны быть внутри арены." });
    }
    if (!hasPlayer || !hasEnemy)
        return Results.BadRequest(new { error = "Нужна хотя бы одна команда player и один противник." });

    foreach (var wall in custom.Arena.Walls ?? [])
    {
        if (wall.Width <= 0 || wall.Height <= 0 ||
            wall.X < 0 || wall.Y < 0 ||
            wall.X + wall.Width > custom.Arena.Width ||
            wall.Y + wall.Height > custom.Arena.Height)
            return Results.BadRequest(new { error = "Стены должны лежать внутри арены." });
    }

    if (custom.Loadouts.Count != custom.Spawns.Count ||
        custom.Loadouts.Select(item => item.BotId).ToHashSet(StringComparer.Ordinal).Count != custom.Spawns.Count ||
        custom.Loadouts.Any(item => !ids.Contains(item.BotId)))
        return Results.BadRequest(new { error = "Loadouts должны покрывать каждый spawn ровно один раз." });

    var hasPlayerCode = false;
    foreach (var loadout in custom.Loadouts)
    {
        if (string.Equals(loadout.Source, "preset", StringComparison.OrdinalIgnoreCase))
        {
            if (string.IsNullOrWhiteSpace(loadout.PresetId) || !BehaviorPresets.Exists(loadout.PresetId))
                return Results.BadRequest(new { error = "Выберите существующий пресет поведения." });
            continue;
        }
        if (!string.Equals(loadout.Source, "code", StringComparison.OrdinalIgnoreCase))
            return Results.BadRequest(new { error = "Source loadout должен быть preset или code." });
        if (string.IsNullOrWhiteSpace(loadout.Code) || loadout.Code.Length > 16_384)
            return Results.BadRequest(new { error = "Код стратегии каждого танка должен быть от 1 до 16 384 символов." });
        var spawn = custom.Spawns.First(item => item.Id == loadout.BotId);
        if (spawn.TeamId == Match.PlayerTeamId) hasPlayerCode = true;
    }

    if (hasPlayerCode && request.Language is { } lang && !StrategyLanguages.Available().Contains(lang))
        return Results.BadRequest(new { error = "Выбранный язык стратегии недоступен." });

    return null;
}

static IResult QueueFull() => Results.Json(new { error = "Очередь расчётов заполнена." }, statusCode: 429);
