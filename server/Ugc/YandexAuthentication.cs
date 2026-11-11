using System.Security.Claims;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OAuth;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace BotArena;

public static class YandexAuthentication
{
    public const string Scheme = "Yandex";
    public const string GitHubScheme = "GitHub";

    public static IServiceCollection AddYandexAuthentication(this IServiceCollection services, IConfiguration configuration)
    {
        var authentication = services.AddAuthentication(options =>
        {
            options.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme;
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

        var yandex = configuration.GetSection("Authentication:Yandex");
        if (Configured(yandex)) authentication.AddOAuth(Scheme, options => ConfigureYandex(options, yandex));
        var github = configuration.GetSection("Authentication:GitHub");
        if (Configured(github)) authentication.AddOAuth(GitHubScheme, options => ConfigureGitHub(options, github));

        services.AddScoped<IPasswordHasher<AppUser>, PasswordHasher<AppUser>>();
        services.AddAuthorization();
        return services;
    }

    public static void MapAuthenticationEndpoints(this WebApplication app)
    {
        app.MapGet("/api/auth/login", async (string? returnUrl, ClaimsPrincipal principal,
            IConfiguration configuration, IAuthenticationSchemeProvider schemes) =>
            await OAuthChallenge(Scheme, returnUrl, principal, configuration, schemes, false)).AllowAnonymous();
        app.MapGet("/api/auth/login/github", async (string? returnUrl, ClaimsPrincipal principal,
            IConfiguration configuration, IAuthenticationSchemeProvider schemes) =>
            await OAuthChallenge(GitHubScheme, returnUrl, principal, configuration, schemes, false)).AllowAnonymous();
        app.MapGet("/api/auth/link/yandex", async (string? returnUrl, ClaimsPrincipal principal,
            IConfiguration configuration, IAuthenticationSchemeProvider schemes) =>
            await OAuthChallenge(Scheme, returnUrl, principal, configuration, schemes, true)).RequireAuthorization();
        app.MapGet("/api/auth/link/github", async (string? returnUrl, ClaimsPrincipal principal,
            IConfiguration configuration, IAuthenticationSchemeProvider schemes) =>
            await OAuthChallenge(GitHubScheme, returnUrl, principal, configuration, schemes, true)).RequireAuthorization();

        app.MapPost("/api/auth/register", Register).AllowAnonymous();
        app.MapPost("/api/auth/password-login", PasswordLogin).AllowAnonymous();

        app.MapGet("/api/auth/session", async (ClaimsPrincipal principal, UgcDbContext database,
            IAuthenticationSchemeProvider schemes, IConfiguration configuration) =>
        {
            var yandexAvailable = await IsLoginAvailableAsync(configuration, schemes, Scheme);
            var githubAvailable = await IsLoginAvailableAsync(configuration, schemes, GitHubScheme);
            if (principal.UserId() is not { } id)
                return Results.Ok(new { authenticated = false, loginAvailable = yandexAvailable, yandexAvailable, githubAvailable });
            var user = await database.Users.AsNoTracking().SingleOrDefaultAsync(item => item.Id == id);
            return user is null
                ? Results.Ok(new { authenticated = false, loginAvailable = yandexAvailable, yandexAvailable, githubAvailable })
                : Results.Ok(Session(user, yandexAvailable, githubAvailable));
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
            return Results.Ok(UserView(user));
        }).RequireAuthorization();

        app.MapPut("/api/auth/profile", async (ProfileRequest request, ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (principal.UserId() is not { } id) return Results.Unauthorized();
            var firstName = request.FirstName?.Trim() ?? "";
            var lastName = request.LastName?.Trim() ?? "";
            if (!NameRules.Valid(firstName) || !NameRules.Valid(lastName))
                return Results.BadRequest(new { error = "Имя и фамилия должны быть не длиннее 100 символов." });
            var user = await database.Users.SingleAsync(item => item.Id == id);
            user.FirstName = firstName;
            user.LastName = lastName;
            await database.SaveChangesAsync();
            return Results.Ok(UserView(user));
        }).RequireAuthorization();

        app.MapPost("/api/auth/change-password", async (ChangePasswordRequest request, ClaimsPrincipal principal,
            UgcDbContext database, IPasswordHasher<AppUser> hasher) =>
        {
            if (principal.UserId() is not { } id) return Results.Unauthorized();
            if (!PasswordRules.Valid(request.NewPassword)) return Results.BadRequest(new { error = PasswordRules.Message });
            var user = await database.Users.SingleAsync(item => item.Id == id);
            if (user.PasswordHash is not null && (string.IsNullOrEmpty(request.CurrentPassword)
                || hasher.VerifyHashedPassword(user, user.PasswordHash, request.CurrentPassword) == PasswordVerificationResult.Failed))
                return Results.BadRequest(new { error = "Текущий пароль указан неверно." });
            user.PasswordHash = hasher.HashPassword(user, request.NewPassword);
            await database.SaveChangesAsync();
            return Results.NoContent();
        }).RequireAuthorization();

        app.MapPost("/api/auth/logout", async (HttpContext context) =>
        {
            await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.NoContent();
        }).RequireAuthorization();
    }

    private static async Task<IResult> Register(RegisterRequest request, HttpContext context, UgcDbContext database,
        IPasswordHasher<AppUser> hasher, CancellationToken cancellation)
    {
        var login = request.Login?.Trim() ?? "";
        var nickname = request.Nickname?.Normalize().Trim() ?? "";
        var firstName = request.FirstName?.Trim() ?? "";
        var lastName = request.LastName?.Trim() ?? "";
        if (!LoginRules.Valid(login)) return Results.BadRequest(new { error = LoginRules.Message });
        if (!PasswordRules.Valid(request.Password)) return Results.BadRequest(new { error = PasswordRules.Message });
        if (!NicknameRules.Valid(nickname)) return Results.BadRequest(new { error = "Ник должен содержать 3–24 буквы, цифры, дефисы или знаки подчёркивания." });
        if (!NameRules.Valid(firstName) || !NameRules.Valid(lastName))
            return Results.BadRequest(new { error = "Имя и фамилия должны быть не длиннее 100 символов." });

        var normalizedLogin = LoginRules.Normalize(login);
        var normalizedNickname = NicknameRules.Normalize(nickname);
        if (await database.Users.AnyAsync(item => item.NormalizedLogin == normalizedLogin, cancellation))
            return Results.Conflict(new { error = "Этот логин уже занят." });
        if (await database.Users.AnyAsync(item => item.NormalizedNickname == normalizedNickname, cancellation))
            return Results.Conflict(new { error = "Этот ник уже занят." });

        var user = new AppUser
        {
            Login = login, NormalizedLogin = normalizedLogin, Nickname = nickname,
            NormalizedNickname = normalizedNickname, FirstName = firstName, LastName = lastName
        };
        user.PasswordHash = hasher.HashPassword(user, request.Password!);
        database.Users.Add(user);
        try { await database.SaveChangesAsync(cancellation); }
        catch (DbUpdateException) { return Results.Conflict(new { error = "Логин или ник уже занят." }); }
        await SignIn(context, user);
        return Results.Ok(UserView(user));
    }

    private static async Task<IResult> PasswordLogin(PasswordLoginRequest request, HttpContext context,
        UgcDbContext database, IPasswordHasher<AppUser> hasher, CancellationToken cancellation)
    {
        var normalized = LoginRules.Normalize(request.Login?.Trim() ?? "");
        var user = await database.Users.SingleOrDefaultAsync(item => item.NormalizedLogin == normalized, cancellation);
        if (user?.PasswordHash is null
            || hasher.VerifyHashedPassword(user, user.PasswordHash, request.Password ?? "") == PasswordVerificationResult.Failed)
            return Results.Json(new { error = "Неверный логин или пароль." }, statusCode: StatusCodes.Status401Unauthorized);
        user.LastLoginAt = DateTimeOffset.UtcNow;
        await database.SaveChangesAsync(cancellation);
        await SignIn(context, user);
        return Results.Ok(UserView(user));
    }

    private static async Task SignIn(HttpContext context, AppUser user)
    {
        var identity = new ClaimsIdentity(CookieAuthenticationDefaults.AuthenticationScheme);
        identity.AddClaim(new(ClaimTypes.NameIdentifier, user.Id.ToString()));
        identity.AddClaim(new(ClaimTypes.Name, user.Nickname ?? user.Login ?? user.Id.ToString()));
        await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity),
            new AuthenticationProperties { IsPersistent = true });
    }

    private static async Task<IResult> OAuthChallenge(string scheme, string? returnUrl, ClaimsPrincipal principal,
        IConfiguration configuration, IAuthenticationSchemeProvider schemes, bool link)
    {
        if (link && principal.UserId() is null) return Results.Unauthorized();
        var section = configuration.GetSection($"Authentication:{scheme}");
        if (!Configured(section) || await schemes.GetSchemeAsync(scheme) is null)
            return Results.Problem($"{scheme} OAuth не настроен на сервере.", statusCode: 503);
        var properties = new AuthenticationProperties { RedirectUri = IsLocal(returnUrl) ? returnUrl! : "/" };
        if (link && principal.UserId() is { } id) properties.Items["linkUserId"] = id.ToString();
        return Results.Challenge(properties, [scheme]);
    }

    internal static async Task<bool> IsLoginAvailableAsync(IConfiguration configuration,
        IAuthenticationSchemeProvider schemes, string scheme = Scheme) =>
        Configured(configuration.GetSection($"Authentication:{scheme}")) && await schemes.GetSchemeAsync(scheme) is not null;

    private static bool Configured(IConfiguration section) =>
        !string.IsNullOrWhiteSpace(section["ClientId"]) && !string.IsNullOrWhiteSpace(section["ClientSecret"]);

    private static void ConfigureYandex(OAuthOptions options, IConfiguration section)
    {
        CommonOAuth(options, section, "/auth/callback", "https://oauth.yandex.ru/authorize",
            "https://oauth.yandex.ru/token", "https://login.yandex.ru/info?format=json", ["login:info", "login:avatar"]);
        options.Events = Events(Scheme, CreateYandexTicket);
    }

    private static void ConfigureGitHub(OAuthOptions options, IConfiguration section)
    {
        CommonOAuth(options, section, "/auth/github/callback", "https://github.com/login/oauth/authorize",
            "https://github.com/login/oauth/access_token", "https://api.github.com/user", ["read:user"]);
        options.Events = Events(GitHubScheme, CreateGitHubTicket);
    }

    private static void CommonOAuth(OAuthOptions options, IConfiguration section, string callback,
        string authorization, string token, string userInfo, string[] scopes)
    {
        options.SignInScheme = CookieAuthenticationDefaults.AuthenticationScheme;
        options.ClientId = section["ClientId"]!;
        options.ClientSecret = section["ClientSecret"]!;
        options.CallbackPath = section["CallbackPath"] ?? callback;
        options.AuthorizationEndpoint = authorization;
        options.TokenEndpoint = token;
        options.UserInformationEndpoint = userInfo;
        options.UsePkce = true;
        options.SaveTokens = false;
        foreach (var scope in scopes) options.Scope.Add(scope);
    }

    private static OAuthEvents Events(string provider, Func<OAuthCreatingTicketContext, Task> create) => new()
    {
        OnCreatingTicket = create,
        OnRemoteFailure = context =>
        {
            context.HandleResponse();
            context.Response.Redirect($"/?authError={provider.ToLowerInvariant()}");
            return Task.CompletedTask;
        }
    };

    private static async Task CreateYandexTicket(OAuthCreatingTicketContext context)
    {
        using var root = await UserInfo(context, "OAuth", null);
        var yandexId = Required(root.RootElement, "id");
        var avatarId = Optional(root.RootElement, "default_avatar_id");
        var avatar = string.IsNullOrWhiteSpace(avatarId) ? null
            : $"https://avatars.yandex.net/get-yapic/{Uri.EscapeDataString(avatarId)}/islands-200";
        await CompleteOAuth(context, Scheme, yandexId, Optional(root.RootElement, "first_name") ?? "",
            Optional(root.RootElement, "last_name") ?? "", avatar);
    }

    private static async Task CreateGitHubTicket(OAuthCreatingTicketContext context)
    {
        using var root = await UserInfo(context, "Bearer", "BotArena");
        var githubId = root.RootElement.GetProperty("id").GetInt64().ToString(System.Globalization.CultureInfo.InvariantCulture);
        var displayName = Optional(root.RootElement, "name") ?? Optional(root.RootElement, "login") ?? "";
        var names = displayName.Split(' ', 2, StringSplitOptions.RemoveEmptyEntries);
        await CompleteOAuth(context, GitHubScheme, githubId, names.FirstOrDefault() ?? "",
            names.Length > 1 ? names[1] : "", Optional(root.RootElement, "avatar_url"));
    }

    private static async Task<JsonDocument> UserInfo(OAuthCreatingTicketContext context, string authorization, string? userAgent)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, context.Options.UserInformationEndpoint);
        request.Headers.Authorization = new(authorization, context.AccessToken);
        request.Headers.Accept.ParseAdd("application/json");
        if (userAgent is not null) request.Headers.UserAgent.ParseAdd(userAgent);
        using var response = await context.Backchannel.SendAsync(request, context.HttpContext.RequestAborted);
        response.EnsureSuccessStatusCode();
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync(context.HttpContext.RequestAborted));
    }

    private static async Task CompleteOAuth(OAuthCreatingTicketContext context, string provider, string externalId,
        string firstName, string lastName, string? avatarUrl)
    {
        var database = context.HttpContext.RequestServices.GetRequiredService<UgcDbContext>();
        AppUser? user;
        if (context.Properties.Items.TryGetValue("linkUserId", out var linkValue) && Guid.TryParse(linkValue, out var linkId))
        {
            user = await database.Users.SingleAsync(item => item.Id == linkId);
            var occupied = provider == Scheme
                ? await database.Users.AnyAsync(item => item.YandexId == externalId && item.Id != linkId)
                : await database.Users.AnyAsync(item => item.GitHubId == externalId && item.Id != linkId);
            if (occupied) throw new InvalidOperationException("Этот внешний аккаунт уже привязан к другому пользователю.");
            if (provider == Scheme) user.YandexId = externalId; else user.GitHubId = externalId;
            user.AvatarUrl ??= avatarUrl;
        }
        else
        {
            user = provider == Scheme
                ? await database.Users.SingleOrDefaultAsync(item => item.YandexId == externalId)
                : await database.Users.SingleOrDefaultAsync(item => item.GitHubId == externalId);
            if (user is null)
            {
                user = new AppUser { FirstName = firstName, LastName = lastName, AvatarUrl = avatarUrl };
                if (provider == Scheme) user.YandexId = externalId; else user.GitHubId = externalId;
                database.Users.Add(user);
            }
            else
            {
                user.FirstName = firstName;
                user.LastName = lastName;
                user.AvatarUrl = avatarUrl;
            }
        }
        user.LastLoginAt = DateTimeOffset.UtcNow;
        await database.SaveChangesAsync();
        context.Identity!.AddClaim(new(ClaimTypes.NameIdentifier, user.Id.ToString()));
        context.Identity.AddClaim(new(ClaimTypes.Name, user.Nickname ?? user.Login ?? $"{firstName} {lastName}".Trim()));
        context.Identity.AddClaim(new(provider == Scheme ? "yandex_id" : "github_id", externalId));
    }

    private static object Session(AppUser user, bool yandexAvailable, bool githubAvailable) => new
    {
        authenticated = true, loginAvailable = yandexAvailable, yandexAvailable, githubAvailable,
        user = UserView(user), needsNickname = user.Nickname is null,
        hasPassword = user.PasswordHash is not null, yandexLinked = user.YandexId is not null,
        githubLinked = user.GitHubId is not null
    };

    private static object UserView(AppUser user) => new
    {
        user.Id, user.FirstName, user.LastName, user.AvatarUrl, user.Nickname, user.Balance, user.Login
    };

    private static Task ApiStatus(RedirectContext<CookieAuthenticationOptions> context, int status)
    {
        if (context.Request.Path.StartsWithSegments("/api")) context.Response.StatusCode = status;
        else context.Response.Redirect(context.RedirectUri);
        return Task.CompletedTask;
    }

    private static string Required(JsonElement value, string property) =>
        value.TryGetProperty(property, out var item) ? item.GetString() ?? throw new InvalidOperationException($"OAuth did not return {property}.")
            : throw new InvalidOperationException($"OAuth did not return {property}.");
    private static string? Optional(JsonElement value, string property) =>
        value.TryGetProperty(property, out var item) && item.ValueKind == JsonValueKind.String ? item.GetString() : null;
    private static bool IsLocal(string? value) => !string.IsNullOrWhiteSpace(value) && value[0] == '/'
        && (value.Length == 1 || value[1] is not '/' and not '\\');
}

public sealed record NicknameRequest(string? Nickname);
public sealed record RegisterRequest(string? Login, string? Password, string? FirstName, string? LastName, string? Nickname);
public sealed record PasswordLoginRequest(string? Login, string? Password);
public sealed record ChangePasswordRequest(string? CurrentPassword, string NewPassword);
public sealed record ProfileRequest(string? FirstName, string? LastName);

internal static class NicknameRules
{
    private static readonly Regex Pattern = new(@"^[\p{L}\p{N}_-]{3,24}$", RegexOptions.CultureInvariant);
    public static bool Valid(string value) => Pattern.IsMatch(value);
    public static string Normalize(string value) => value.Normalize().ToUpperInvariant();
}

internal static class LoginRules
{
    private static readonly Regex Pattern = new(@"^[A-Za-z0-9_.-]{3,40}$", RegexOptions.CultureInvariant);
    public const string Message = "Логин должен содержать 3–40 латинских букв, цифр, точек, дефисов или знаков подчёркивания.";
    public static bool Valid(string value) => Pattern.IsMatch(value);
    public static string Normalize(string value) => value.Normalize().ToUpperInvariant();
}

internal static class PasswordRules
{
    public const string Message = "Пароль должен содержать от 8 до 128 символов.";
    public static bool Valid(string? value) => value is { Length: >= 8 and <= 128 };
}

internal static class NameRules
{
    public static bool Valid(string value) => value.Length <= 100;
}

internal static class ClaimsExtensions
{
    public static Guid? UserId(this ClaimsPrincipal principal) =>
        Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : null;
}
