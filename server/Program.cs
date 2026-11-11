using BotArena;
using Microsoft.EntityFrameworkCore;
using System.Text.Json.Serialization;

if (args is ["--match-worker"]) return await MatchWorker.RunChildAsync();

var builder = WebApplication.CreateBuilder(args);
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: true)
    .AddEnvironmentVariables();
builder.WebHost.UseUrls(builder.Configuration["Urls"] ?? "http://localhost:5050");
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 128 * 1024);
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
app.MapGet("/api/strategy-languages", () => StrategyLanguages.Available());
app.MapPost("/api/match-jobs", (MatchRequest request, MatchQueue queue) =>
{
    if (Validate(request) is { } invalid) return invalid;
    var safeRequest = request with { OpponentCode = null, OpponentLanguage = null, PveLevelId = null, CustomArena = null };
    if (queue.Enqueue(safeRequest) is not { } job) return QueueFull();
    return Results.Accepted($"/api/match-jobs/{job.Id}", new { id = job.Id });
}).RequireAuthorization();
app.MapGet("/api/match-jobs/{id:guid}", (Guid id, MatchQueue queue, HttpResponse response) =>
{
    response.Headers.CacheControl = "no-store";
    return queue.GetStatus(id) is { } status ? Results.Ok(status) : Results.NotFound();
}).RequireAuthorization();
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
}).RequireAuthorization();

await app.RunAsync();
return 0;

static IResult? Validate(MatchRequest request)
{
    if (string.IsNullOrWhiteSpace(request.BotCode) || request.BotCode.Length > 16_384)
        return Results.BadRequest(new { error = "Нужен код стратегии длиной от 1 до 16 384 символов." });
    if (!OpponentCatalog.Opponents.Any(opponent => opponent.Id == request.OpponentId))
        return Results.BadRequest(new { error = "Выберите существующего противника." });
    if (request.Language is { } language && !StrategyLanguages.Available().Contains(language))
        return Results.BadRequest(new { error = "Выбранный язык стратегии недоступен." });
    return null;
}

static IResult QueueFull() => Results.Json(new { error = "Очередь расчётов заполнена." }, statusCode: 429);
