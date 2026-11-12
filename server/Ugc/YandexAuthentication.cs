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

        foreach (var provider in OAuthProviderCatalog.Read(configuration).Where(item => item.IsConfigured))
        {
            authentication.AddOAuth(provider.Scheme, options =>
            {
                options.SignInScheme = CookieAuthenticationDefaults.AuthenticationScheme;
                options.ClientId = provider.ClientId;
                options.ClientSecret = provider.ClientSecret;
                options.CallbackPath = provider.CallbackPath;
                options.AuthorizationEndpoint = provider.AuthorizationEndpoint;
                options.TokenEndpoint = provider.TokenEndpoint;
                options.UserInformationEndpoint = provider.UserInformationEndpoint;
                options.UsePkce = provider.UsePkce;
                options.SaveTokens = false;
                foreach (var scope in provider.Scopes) options.Scope.Add(scope);
                options.Events = new OAuthEvents
                {
                    OnCreatingTicket = context => CreateOAuthTicket(context, provider),
                    OnRemoteFailure = context =>
                    {
                        context.HandleResponse();
                        context.Response.Redirect($"/?authError={Uri.EscapeDataString(provider.Id)}");
                        return Task.CompletedTask;
                    }
                };
            });
        }

        services.AddScoped<IPasswordHasher<AppUser>, PasswordHasher<AppUser>>();
        services.AddAuthorization();
        return services;
    }

    public static void MapAuthenticationEndpoints(this WebApplication app)
    {
        app.MapGet("/api/auth/providers", async (IConfiguration configuration, IAuthenticationSchemeProvider schemes) =>
            Results.Ok(await AvailableProviders(configuration, schemes))).AllowAnonymous();
        app.MapGet("/api/auth/oauth/{provider}/login", OAuthLogin).AllowAnonymous();
        app.MapGet("/api/auth/oauth/{provider}/link", OAuthLink).RequireAuthorization();

        // Compatibility routes for existing bookmarks. The frontend uses the generic routes above.
        app.MapGet("/api/auth/login", (string? returnUrl, ClaimsPrincipal principal, IConfiguration configuration,
            IAuthenticationSchemeProvider schemes) => OAuthChallenge("yandex", returnUrl, principal, configuration, schemes, false)).AllowAnonymous();
        app.MapGet("/api/auth/login/github", (string? returnUrl, ClaimsPrincipal principal, IConfiguration configuration,
            IAuthenticationSchemeProvider schemes) => OAuthChallenge("github", returnUrl, principal, configuration, schemes, false)).AllowAnonymous();
        app.MapGet("/api/auth/link/yandex", (string? returnUrl, ClaimsPrincipal principal, IConfiguration configuration,
            IAuthenticationSchemeProvider schemes) => OAuthChallenge("yandex", returnUrl, principal, configuration, schemes, true)).RequireAuthorization();
        app.MapGet("/api/auth/link/github", (string? returnUrl, ClaimsPrincipal principal, IConfiguration configuration,
            IAuthenticationSchemeProvider schemes) => OAuthChallenge("github", returnUrl, principal, configuration, schemes, true)).RequireAuthorization();

        app.MapPost("/api/auth/register", Register).AllowAnonymous();
        app.MapPost("/api/auth/password-login", PasswordLogin).AllowAnonymous();

        app.MapGet("/api/auth/session", async (ClaimsPrincipal principal, UgcDbContext database,
            IAuthenticationSchemeProvider schemes, IConfiguration configuration) =>
        {
            var providers = await AvailableProviders(configuration, schemes);
            if (principal.UserId() is not { } id)
                return Results.Ok(new { authenticated = false, loginAvailable = providers.Count > 0 });
            var user = await database.Users.AsNoTracking().Include(item => item.OAuthIdentities)
                .SingleOrDefaultAsync(item => item.Id == id);
            return user is null
                ? Results.Ok(new { authenticated = false, loginAvailable = providers.Count > 0 })
                : Results.Ok(Session(user));
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

    private static Task<IResult> OAuthLogin(string provider, string? returnUrl, ClaimsPrincipal principal,
        IConfiguration configuration, IAuthenticationSchemeProvider schemes) =>
        OAuthChallenge(provider, returnUrl, principal, configuration, schemes, false);

    private static Task<IResult> OAuthLink(string provider, string? returnUrl, ClaimsPrincipal principal,
        IConfiguration configuration, IAuthenticationSchemeProvider schemes) =>
        OAuthChallenge(provider, returnUrl, principal, configuration, schemes, true);

    private static async Task<IResult> OAuthChallenge(string providerId, string? returnUrl, ClaimsPrincipal principal,
        IConfiguration configuration, IAuthenticationSchemeProvider schemes, bool link)
    {
        if (link && principal.UserId() is null) return Results.Unauthorized();
        var provider = OAuthProviderCatalog.Find(configuration, providerId);
        if (provider is null || !provider.IsConfigured || await schemes.GetSchemeAsync(provider.Scheme) is null)
            return Results.NotFound(new { error = "OAuth-провайдер не найден или не настроен." });
        var properties = new AuthenticationProperties { RedirectUri = IsLocal(returnUrl) ? returnUrl! : "/" };
        if (link && principal.UserId() is { } id) properties.Items["linkUserId"] = id.ToString();
        return Results.Challenge(properties, [provider.Scheme]);
    }

    internal static async Task<IReadOnlyList<OAuthProviderView>> AvailableProviders(IConfiguration configuration,
        IAuthenticationSchemeProvider schemes)
    {
        var result = new List<OAuthProviderView>();
        foreach (var provider in OAuthProviderCatalog.Read(configuration).Where(item => item.IsConfigured))
            if (await schemes.GetSchemeAsync(provider.Scheme) is not null)
                result.Add(new(provider.Id, provider.DisplayName, provider.Badge, provider.Color));
        return result;
    }

    internal static async Task<bool> IsLoginAvailableAsync(IConfiguration configuration,
        IAuthenticationSchemeProvider schemes, string scheme = Scheme)
    {
        var id = scheme.Equals(GitHubScheme, StringComparison.OrdinalIgnoreCase) ? "github"
            : scheme.Equals(Scheme, StringComparison.OrdinalIgnoreCase) ? "yandex" : scheme;
        var provider = OAuthProviderCatalog.Find(configuration, id);
        return provider is { IsConfigured: true } && await schemes.GetSchemeAsync(provider.Scheme) is not null;
    }

    private static async Task CreateOAuthTicket(OAuthCreatingTicketContext context, OAuthProviderDefinition provider)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, provider.UserInformationEndpoint);
        request.Headers.Authorization = new(provider.AuthorizationHeaderScheme, context.AccessToken);
        request.Headers.Accept.ParseAdd("application/json");
        if (!string.IsNullOrWhiteSpace(provider.UserAgent)) request.Headers.UserAgent.ParseAdd(provider.UserAgent);
        using var response = await context.Backchannel.SendAsync(request, context.HttpContext.RequestAborted);
        response.EnsureSuccessStatusCode();
        using var payload = JsonDocument.Parse(await response.Content.ReadAsStringAsync(context.HttpContext.RequestAborted));
        var subject = Field(payload.RootElement, provider.SubjectField)
            ?? throw new InvalidOperationException($"{provider.DisplayName} did not return {provider.SubjectField}.");
        var firstName = Field(payload.RootElement, provider.FirstNameField) ?? "";
        var lastName = Field(payload.RootElement, provider.LastNameField) ?? "";
        if (firstName.Length == 0 && provider.NameField is { Length: > 0 } nameField)
        {
            var names = (Field(payload.RootElement, nameField) ?? "").Split(' ', 2, StringSplitOptions.RemoveEmptyEntries);
            firstName = names.FirstOrDefault() ?? "";
            lastName = names.Length > 1 ? names[1] : "";
        }
        var avatarValue = Field(payload.RootElement, provider.AvatarField);
        var avatarUrl = avatarValue is null ? null : string.IsNullOrWhiteSpace(provider.AvatarUrlTemplate)
            ? avatarValue : string.Format(System.Globalization.CultureInfo.InvariantCulture, provider.AvatarUrlTemplate, Uri.EscapeDataString(avatarValue));
        await CompleteOAuth(context, provider, subject, firstName, lastName, avatarUrl);
    }

    private static async Task CompleteOAuth(OAuthCreatingTicketContext context, OAuthProviderDefinition provider,
        string subject, string firstName, string lastName, string? avatarUrl)
    {
        var database = context.HttpContext.RequestServices.GetRequiredService<UgcDbContext>();
        AppUser user;
        if (context.Properties.Items.TryGetValue("linkUserId", out var linkValue) && Guid.TryParse(linkValue, out var linkId))
        {
            user = await database.Users.Include(item => item.OAuthIdentities).SingleAsync(item => item.Id == linkId);
            if (await database.OAuthIdentities.AnyAsync(item => item.Provider == provider.Id && item.Subject == subject && item.UserId != linkId))
                throw new InvalidOperationException("Этот внешний аккаунт уже привязан к другому пользователю.");
            if (user.OAuthIdentities.All(item => item.Provider != provider.Id))
                user.OAuthIdentities.Add(new() { User = user, UserId = user.Id, Provider = provider.Id, Subject = subject });
            user.AvatarUrl ??= avatarUrl;
        }
        else
        {
            var identity = await database.OAuthIdentities.Include(item => item.User)
                .SingleOrDefaultAsync(item => item.Provider == provider.Id && item.Subject == subject);
            user = identity?.User ?? await LegacyUser(database, provider.Id, subject)
                ?? new AppUser { FirstName = firstName, LastName = lastName, AvatarUrl = avatarUrl };
            if (identity is null)
            {
                if (user.Id == Guid.Empty) user.Id = Guid.NewGuid();
                database.OAuthIdentities.Add(new() { User = user, UserId = user.Id, Provider = provider.Id, Subject = subject });
            }
            if (database.Entry(user).State == EntityState.Detached) database.Users.Add(user);
            if (user.FirstName.Length == 0) user.FirstName = firstName;
            if (user.LastName.Length == 0) user.LastName = lastName;
            user.AvatarUrl = avatarUrl ?? user.AvatarUrl;
        }
        user.LastLoginAt = DateTimeOffset.UtcNow;
        await database.SaveChangesAsync();
        context.Identity!.AddClaim(new(ClaimTypes.NameIdentifier, user.Id.ToString()));
        context.Identity.AddClaim(new(ClaimTypes.Name, user.Nickname ?? user.Login ?? $"{firstName} {lastName}".Trim()));
        context.Identity.AddClaim(new("oauth_provider", provider.Id));
    }

    private static async Task<AppUser?> LegacyUser(UgcDbContext database, string provider, string subject) =>
        provider switch
        {
            "yandex" => await database.Users.SingleOrDefaultAsync(item => item.YandexId == subject),
            "github" => await database.Users.SingleOrDefaultAsync(item => item.GitHubId == subject),
            _ => null
        };

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

    private static object Session(AppUser user)
    {
        var linked = user.OAuthIdentities.Select(item => item.Provider).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (user.YandexId is not null) linked.Add("yandex");
        if (user.GitHubId is not null) linked.Add("github");
        return new
        {
            authenticated = true, loginAvailable = true, user = UserView(user), needsNickname = user.Nickname is null,
            hasPassword = user.PasswordHash is not null, linkedOAuthProviders = linked.Order().ToArray()
        };
    }

    private static object UserView(AppUser user) => new
    {
        user.Id, user.FirstName, user.LastName, user.AvatarUrl, user.Nickname, user.Balance, user.Login
    };

    private static string? Field(JsonElement value, string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return null;
        var current = value;
        foreach (var segment in path.Split('.', StringSplitOptions.RemoveEmptyEntries))
            if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out current)) return null;
        return current.ValueKind switch
        {
            JsonValueKind.String => current.GetString(),
            JsonValueKind.Number => current.GetRawText(),
            _ => null
        };
    }

    private static Task ApiStatus(RedirectContext<CookieAuthenticationOptions> context, int status)
    {
        if (context.Request.Path.StartsWithSegments("/api")) context.Response.StatusCode = status;
        else context.Response.Redirect(context.RedirectUri);
        return Task.CompletedTask;
    }

    private static bool IsLocal(string? value) => !string.IsNullOrWhiteSpace(value) && value[0] == '/'
        && (value.Length == 1 || value[1] is not '/' and not '\\');
}

internal static class OAuthProviderCatalog
{
    public static IReadOnlyList<OAuthProviderDefinition> Read(IConfiguration configuration) =>
        configuration.GetSection("Authentication:OAuth:Providers").GetChildren()
            .Select(OAuthProviderDefinition.From).Where(item => item is not null).Cast<OAuthProviderDefinition>()
            .Select(item => ApplyLegacyCredentials(configuration, item)).ToArray();

    public static OAuthProviderDefinition? Find(IConfiguration configuration, string id) =>
        Read(configuration).SingleOrDefault(item => item.Id.Equals(id, StringComparison.OrdinalIgnoreCase));

    private static OAuthProviderDefinition ApplyLegacyCredentials(IConfiguration configuration, OAuthProviderDefinition provider)
    {
        if (provider.ClientId.Length > 0 || provider.ClientSecret.Length > 0) return provider;
        var legacyName = provider.Id switch { "yandex" => "Yandex", "github" => "GitHub", _ => null };
        if (legacyName is null) return provider;
        var legacy = configuration.GetSection($"Authentication:{legacyName}");
        return provider with
        {
            ClientId = legacy["ClientId"]?.Trim() ?? "",
            ClientSecret = legacy["ClientSecret"] ?? "",
            CallbackPath = legacy["CallbackPath"]?.Trim() ?? provider.CallbackPath
        };
    }
}

internal sealed record OAuthProviderDefinition(
    string Id, string Scheme, string DisplayName, string Badge, string Color,
    string ClientId, string ClientSecret, string CallbackPath,
    string AuthorizationEndpoint, string TokenEndpoint, string UserInformationEndpoint,
    string[] Scopes, bool UsePkce, string AuthorizationHeaderScheme, string? UserAgent,
    string SubjectField, string? FirstNameField, string? LastNameField, string? NameField,
    string? AvatarField, string? AvatarUrlTemplate)
{
    public bool IsConfigured => ClientId.Length > 0 && ClientSecret.Length > 0
        && Uri.IsWellFormedUriString(AuthorizationEndpoint, UriKind.Absolute)
        && Uri.IsWellFormedUriString(TokenEndpoint, UriKind.Absolute)
        && Uri.IsWellFormedUriString(UserInformationEndpoint, UriKind.Absolute)
        && CallbackPath.StartsWith('/');

    public static OAuthProviderDefinition? From(IConfigurationSection section)
    {
        var id = section.Key.Trim().ToLowerInvariant();
        if (!Regex.IsMatch(id, "^[a-z0-9_-]{2,40}$")) return null;
        return new(
            id, $"OAuth.{id}", section["DisplayName"]?.Trim() ?? section.Key,
            section["Badge"]?.Trim() ?? section.Key[..Math.Min(2, section.Key.Length)].ToUpperInvariant(),
            section["Color"]?.Trim() ?? "#55dfc0", section["ClientId"]?.Trim() ?? "",
            section["ClientSecret"] ?? "", section["CallbackPath"]?.Trim() ?? $"/auth/oauth/{id}/callback",
            section["AuthorizationEndpoint"]?.Trim() ?? "", section["TokenEndpoint"]?.Trim() ?? "",
            section["UserInformationEndpoint"]?.Trim() ?? "",
            section.GetSection("Scopes").Get<string[]>() ?? [], section.GetValue("UsePkce", true),
            section["AuthorizationHeaderScheme"]?.Trim() ?? "Bearer", section["UserAgent"]?.Trim(),
            section["SubjectField"]?.Trim() ?? "id", section["FirstNameField"]?.Trim(),
            section["LastNameField"]?.Trim(), section["NameField"]?.Trim(), section["AvatarField"]?.Trim(),
            section["AvatarUrlTemplate"]?.Trim());
    }
}

public sealed record OAuthProviderView(string Id, string DisplayName, string Badge, string Color);
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
