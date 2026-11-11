using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OAuth;
using Microsoft.EntityFrameworkCore;

namespace BotArena;

public static class YandexAuthentication
{
    public const string Scheme = "Yandex";

    public static IServiceCollection AddYandexAuthentication(this IServiceCollection services, IConfiguration configuration)
    {
        var section = configuration.GetSection("Authentication:Yandex");
        var authentication = services.AddAuthentication(options =>
        {
            options.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme;
            // Protected API endpoints challenge the session cookie and therefore
            // return 401. The login endpoint explicitly challenges Yandex below.
            options.DefaultChallengeScheme = CookieAuthenticationDefaults.AuthenticationScheme;
        })
        .AddCookie(options =>
        {
            options.Cookie.Name = "botarena.session";
            options.Cookie.HttpOnly = true;
            options.Cookie.SameSite = SameSiteMode.Lax;
            options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
            options.ExpireTimeSpan = TimeSpan.FromDays(30);
            options.SlidingExpiration = true;
            options.Events.OnRedirectToLogin = context => ApiStatus(context, StatusCodes.Status401Unauthorized);
            options.Events.OnRedirectToAccessDenied = context => ApiStatus(context, StatusCodes.Status403Forbidden);
        });
        // Keep public pages and cookie challenges working before OAuth is configured.
        // The explicit login endpoint reports 503 until both credentials are provided.
        if (!string.IsNullOrWhiteSpace(section["ClientId"]) && !string.IsNullOrWhiteSpace(section["ClientSecret"]))
        authentication.AddOAuth(Scheme, options =>
        {
            options.SignInScheme = CookieAuthenticationDefaults.AuthenticationScheme;
            options.ClientId = section["ClientId"] ?? "";
            options.ClientSecret = section["ClientSecret"] ?? "";
            options.CallbackPath = section["CallbackPath"] ?? "/signin-yandex";
            options.AuthorizationEndpoint = "https://oauth.yandex.ru/authorize";
            options.TokenEndpoint = "https://oauth.yandex.ru/token";
            options.UserInformationEndpoint = "https://login.yandex.ru/info?format=json";
            options.UsePkce = true;
            options.Scope.Add("login:info");
            options.Scope.Add("login:avatar");
            options.SaveTokens = false;
            options.Events = new OAuthEvents
            {
                OnCreatingTicket = CreateTicket,
                OnRemoteFailure = context =>
                {
                    context.HandleResponse();
                    context.Response.Redirect("/?authError=yandex");
                    return Task.CompletedTask;
                }
            };
        });
        services.AddAuthorization();
        return services;
    }

    public static void MapAuthenticationEndpoints(this WebApplication app)
    {
        app.MapGet("/api/auth/login", (string? returnUrl, IConfiguration configuration) =>
        {
            if (string.IsNullOrWhiteSpace(configuration["Authentication:Yandex:ClientId"])
                || string.IsNullOrWhiteSpace(configuration["Authentication:Yandex:ClientSecret"]))
                return Results.Problem("Yandex ID не настроен на сервере.", statusCode: 503);
            var destination = IsLocal(returnUrl) ? returnUrl! : "/";
            return Results.Challenge(new AuthenticationProperties { RedirectUri = destination }, [Scheme]);
        }).AllowAnonymous();

        app.MapGet("/api/auth/session", async (ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (principal.UserId() is not { } id) return Results.Ok(new { authenticated = false });
            var user = await database.Users.AsNoTracking().SingleOrDefaultAsync(item => item.Id == id);
            return user is null ? Results.Ok(new { authenticated = false }) : Results.Ok(new
            {
                authenticated = true,
                user = new { user.Id, user.FirstName, user.LastName, user.AvatarUrl, user.Nickname, user.Balance },
                needsNickname = user.Nickname is null
            });
        }).AllowAnonymous();

        app.MapPost("/api/auth/nickname", async (NicknameRequest request, ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (principal.UserId() is not { } id) return Results.Unauthorized();
            var nickname = request.Nickname?.Normalize().Trim() ?? "";
            if (!NicknameRules.Valid(nickname))
                return Results.BadRequest(new { error = "Ник должен содержать 3–24 буквы, цифры, дефисы или знаки подчёркивания." });
            var normalized = NicknameRules.Normalize(nickname);
            if (await database.Users.AnyAsync(user => user.NormalizedNickname == normalized && user.Id != id))
                return Results.Conflict(new { error = "Этот ник уже занят." });
            var user = await database.Users.SingleAsync(item => item.Id == id);
            user.Nickname = nickname;
            user.NormalizedNickname = normalized;
            try { await database.SaveChangesAsync(); }
            catch (DbUpdateException) { return Results.Conflict(new { error = "Этот ник уже занят." }); }
            return Results.Ok(new { user.Id, user.FirstName, user.LastName, user.AvatarUrl, user.Nickname, user.Balance });
        }).RequireAuthorization();

        app.MapPost("/api/auth/logout", async (HttpContext context) =>
        {
            await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.NoContent();
        }).RequireAuthorization();
    }

    private static async Task CreateTicket(OAuthCreatingTicketContext context)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, context.Options.UserInformationEndpoint);
        request.Headers.Authorization = new("OAuth", context.AccessToken);
        using var response = await context.Backchannel.SendAsync(request, context.HttpContext.RequestAborted);
        response.EnsureSuccessStatusCode();
        using var payload = JsonDocument.Parse(await response.Content.ReadAsStringAsync(context.HttpContext.RequestAborted));
        var root = payload.RootElement;
        var yandexId = Required(root, "id");
        var firstName = Optional(root, "first_name") ?? "";
        var lastName = Optional(root, "last_name") ?? "";
        var avatarId = Optional(root, "default_avatar_id");
        var avatarUrl = string.IsNullOrWhiteSpace(avatarId) ? null
            : $"https://avatars.yandex.net/get-yapic/{Uri.EscapeDataString(avatarId)}/islands-200";

        var database = context.HttpContext.RequestServices.GetRequiredService<UgcDbContext>();
        var user = await database.Users.SingleOrDefaultAsync(item => item.YandexId == yandexId);
        if (user is null)
        {
            user = new AppUser { YandexId = yandexId, FirstName = firstName, LastName = lastName, AvatarUrl = avatarUrl };
            database.Users.Add(user);
        }
        else
        {
            user.FirstName = firstName;
            user.LastName = lastName;
            user.AvatarUrl = avatarUrl;
            user.LastLoginAt = DateTimeOffset.UtcNow;
        }
        await database.SaveChangesAsync();

        context.Identity!.AddClaim(new(ClaimTypes.NameIdentifier, user.Id.ToString()));
        context.Identity.AddClaim(new(ClaimTypes.Name, user.Nickname ?? $"{firstName} {lastName}".Trim()));
        context.Identity.AddClaim(new("yandex_id", yandexId));
    }

    private static Task ApiStatus(RedirectContext<CookieAuthenticationOptions> context, int status)
    {
        if (context.Request.Path.StartsWithSegments("/api")) context.Response.StatusCode = status;
        else context.Response.Redirect(context.RedirectUri);
        return Task.CompletedTask;
    }

    private static string Required(JsonElement value, string property) =>
        value.TryGetProperty(property, out var item) ? item.GetString() ?? throw new InvalidOperationException($"Yandex ID did not return {property}.")
            : throw new InvalidOperationException($"Yandex ID did not return {property}.");
    private static string? Optional(JsonElement value, string property) =>
        value.TryGetProperty(property, out var item) && item.ValueKind == JsonValueKind.String ? item.GetString() : null;
    private static bool IsLocal(string? value) => !string.IsNullOrWhiteSpace(value) && value[0] == '/'
        && (value.Length == 1 || value[1] is not '/' and not '\\');
}

public sealed record NicknameRequest(string? Nickname);

internal static class NicknameRules
{
    private static readonly System.Text.RegularExpressions.Regex Pattern =
        new(@"^[\p{L}\p{N}_-]{3,24}$", System.Text.RegularExpressions.RegexOptions.CultureInvariant);
    public static bool Valid(string value) => Pattern.IsMatch(value);
    public static string Normalize(string value) => value.Normalize().ToUpperInvariant();
}

internal static class ClaimsExtensions
{
    public static Guid? UserId(this ClaimsPrincipal principal) =>
        Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : null;
}
