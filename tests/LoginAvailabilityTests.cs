using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace BotArena.Tests;

public class LoginAvailabilityTests
{
    [Fact]
    public async Task RemovingAndRestoringCredentialsUpdatesLoginAvailability()
    {
        var values = Provider("yandex", "test-client", "test-secret");
        var config = new ConfigurationBuilder().AddInMemoryCollection(values).Build();
        var services = new ServiceCollection(); services.AddLogging(); services.AddYandexAuthentication(config);
        await using var container = services.BuildServiceProvider();
        var schemes = container.GetRequiredService<IAuthenticationSchemeProvider>();

        Assert.True(await YandexAuthentication.IsLoginAvailableAsync(config, schemes));
        config["Authentication:OAuth:Providers:yandex:ClientSecret"] = "";
        Assert.False(await YandexAuthentication.IsLoginAvailableAsync(config, schemes));
        config["Authentication:OAuth:Providers:yandex:ClientSecret"] = "test-secret";
        Assert.True(await YandexAuthentication.IsLoginAvailableAsync(config, schemes));
    }

    [Fact]
    public async Task AddingCredentialsAfterStartupRequiresSchemeRegistration()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(Provider("yandex", "", "")).Build();
        var services = new ServiceCollection(); services.AddLogging(); services.AddYandexAuthentication(config);
        await using var container = services.BuildServiceProvider();
        var schemes = container.GetRequiredService<IAuthenticationSchemeProvider>();

        Assert.False(await YandexAuthentication.IsLoginAvailableAsync(config, schemes));
        config["Authentication:OAuth:Providers:yandex:ClientId"] = "test-client";
        config["Authentication:OAuth:Providers:yandex:ClientSecret"] = "test-secret";
        Assert.False(await YandexAuthentication.IsLoginAvailableAsync(config, schemes));
    }

    [Fact]
    public async Task AnyConfiguredProvidersAreExposedWithoutFrontendHardcoding()
    {
        var values = Provider("github", "github-client", "github-secret")
            .Concat(Provider("google", "google-client", "google-secret"))
            .ToDictionary(item => item.Key, item => item.Value);
        values["Authentication:OAuth:Providers:github:DisplayName"] = "GitHub";
        values["Authentication:OAuth:Providers:google:DisplayName"] = "Google";
        var config = new ConfigurationBuilder().AddInMemoryCollection(values).Build();
        var services = new ServiceCollection(); services.AddLogging(); services.AddYandexAuthentication(config);
        await using var container = services.BuildServiceProvider();
        var schemes = container.GetRequiredService<IAuthenticationSchemeProvider>();

        var providers = await YandexAuthentication.AvailableProviders(config, schemes);

        Assert.Equal(["github", "google"], providers.Select(item => item.Id).Order().ToArray());
    }

    private static Dictionary<string, string?> Provider(string id, string clientId, string secret)
    {
        var root = $"Authentication:OAuth:Providers:{id}";
        return new()
        {
            [$"{root}:DisplayName"] = id,
            [$"{root}:ClientId"] = clientId,
            [$"{root}:ClientSecret"] = secret,
            [$"{root}:CallbackPath"] = $"/auth/{id}/callback",
            [$"{root}:AuthorizationEndpoint"] = $"https://auth.{id}.example/authorize",
            [$"{root}:TokenEndpoint"] = $"https://auth.{id}.example/token",
            [$"{root}:UserInformationEndpoint"] = $"https://api.{id}.example/user",
            [$"{root}:SubjectField"] = "id"
        };
    }
}
