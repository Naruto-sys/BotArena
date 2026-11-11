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
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Authentication:Yandex:ClientId"] = "test-client",
            ["Authentication:Yandex:ClientSecret"] = "test-secret"
        }).Build();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddYandexAuthentication(config);
        await using var provider = services.BuildServiceProvider();
        var schemes = provider.GetRequiredService<IAuthenticationSchemeProvider>();
        Assert.True(await YandexAuthentication.IsLoginAvailableAsync(config, schemes));
        config["Authentication:Yandex:ClientSecret"] = "";
        Assert.False(await YandexAuthentication.IsLoginAvailableAsync(config, schemes));
        config["Authentication:Yandex:ClientSecret"] = "test-secret";
        Assert.True(await YandexAuthentication.IsLoginAvailableAsync(config, schemes));
    }

    [Fact]
    public async Task AddingCredentialsAfterStartupRequiresSchemeRegistration()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection().Build();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddYandexAuthentication(config);
        await using var provider = services.BuildServiceProvider();
        var schemes = provider.GetRequiredService<IAuthenticationSchemeProvider>();
        Assert.False(await YandexAuthentication.IsLoginAvailableAsync(config, schemes));
        config["Authentication:Yandex:ClientId"] = "test-client";
        config["Authentication:Yandex:ClientSecret"] = "test-secret";
        Assert.False(await YandexAuthentication.IsLoginAvailableAsync(config, schemes));
    }

    [Fact]
    public async Task GitHubAvailabilityUsesItsOwnOAuthScheme()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Authentication:GitHub:ClientId"] = "github-client",
            ["Authentication:GitHub:ClientSecret"] = "github-secret"
        }).Build();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddYandexAuthentication(config);
        await using var provider = services.BuildServiceProvider();
        var schemes = provider.GetRequiredService<IAuthenticationSchemeProvider>();

        Assert.True(await YandexAuthentication.IsLoginAvailableAsync(config, schemes, YandexAuthentication.GitHubScheme));
        Assert.False(await YandexAuthentication.IsLoginAvailableAsync(config, schemes, YandexAuthentication.Scheme));
    }
}
