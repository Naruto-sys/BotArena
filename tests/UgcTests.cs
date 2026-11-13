using Xunit;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.AspNetCore.Identity;

namespace BotArena.Tests;

public class UgcTests
{
    [Theory]
    [InlineData("tank_master")]
    [InlineData("Пилот-17")]
    [InlineData("БоТ")]
    public void AcceptsValidNicknames(string nickname) => Assert.True(NicknameRules.Valid(nickname));

    [Theory]
    [InlineData("")]
    [InlineData("ab")]
    [InlineData("name with spaces")]
    [InlineData("name@example")]
    public void RejectsInvalidNicknames(string nickname) => Assert.False(NicknameRules.Valid(nickname));

    [Fact]
    public void NormalizationMakesNicknameComparisonCaseInsensitive() =>
        Assert.Equal(NicknameRules.Normalize("Пилот"), NicknameRules.Normalize("пилот"));

    [Fact]
    public void PaidStrategyCodeRequiresOwnershipOrPurchase()
    {
        var ownerId = Guid.NewGuid();
        var strategy = new UserStrategy { Owner = null!, OwnerId = ownerId, Name = "Premium", SalePrice = 100 };

        Assert.False(UgcEndpoints.CanReadCode(strategy, null, purchased: false));
        Assert.False(UgcEndpoints.CanReadCode(strategy, Guid.NewGuid(), purchased: false));
        Assert.True(UgcEndpoints.CanReadCode(strategy, ownerId, purchased: false));
        Assert.True(UgcEndpoints.CanReadCode(strategy, Guid.NewGuid(), purchased: true));
    }

    [Fact]
    public void FreeStrategyCodeIsPublic()
    {
        var strategy = new UserStrategy { Owner = null!, OwnerId = Guid.NewGuid(), Name = "Free" };

        Assert.True(UgcEndpoints.CanReadCode(strategy, null, purchased: false));
    }

    [Fact]
    public void SequentialTypingRemainsSingleCharacterChanges()
    {
        var states = new[] { "", "f", "fu", "fun", "func" };

        Assert.All(states.Zip(states.Skip(1)), pair =>
            Assert.Equal(1, RoomEndpoints.ChangedCharacters(pair.First, pair.Second)));
        Assert.Equal(4, RoomEndpoints.ChangedCharacters("", "func"));
    }

    [Fact]
    public void StrategyCodeLineLimitAcceptsOneThousandLines()
    {
        var code = string.Join('\n', Enumerable.Repeat("return {};", StrategyCodeLimits.MaxLines));

        Assert.Null(StrategyCodeLimits.Validate(code));
        Assert.Equal(StrategyCodeLimits.MaxLines, StrategyCodeLimits.CountLines(code));
    }

    [Fact]
    public void StrategyCodeLineLimitRejectsFinalMatchCodeAboveOneThousandLines()
    {
        var code = string.Join("\r\n", Enumerable.Repeat("return {};", StrategyCodeLimits.MaxLines + 1));
        var request = new MatchRequest(code, "rookie", StrategyLanguages.JavaScript);

        Assert.NotNull(StrategyCodeLimits.Validate(request));
        Assert.Equal(StrategyCodeLimits.MaxLines + 1, StrategyCodeLimits.CountLines(code));
    }

    [Fact]
    public void ProtectedApisChallengeTheSessionCookie()
    {
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder().AddInMemoryCollection().Build();
        services.AddYandexAuthentication(configuration);
        using var provider = services.BuildServiceProvider();

        var authentication = provider.GetRequiredService<IOptions<AuthenticationOptions>>().Value;

        Assert.Equal(CookieAuthenticationDefaults.AuthenticationScheme, authentication.DefaultChallengeScheme);
        Assert.NotEqual(YandexAuthentication.Scheme, authentication.DefaultChallengeScheme);
    }

    [Theory]
    [InlineData("pilot_17")]
    [InlineData("tank.master")]
    public void AcceptsSafeLocalLogins(string login) => Assert.True(LoginRules.Valid(login));

    [Theory]
    [InlineData("ab")]
    [InlineData("логин")]
    [InlineData("has spaces")]
    public void RejectsUnsafeLocalLogins(string login) => Assert.False(LoginRules.Valid(login));

    [Fact]
    public void LocalPasswordsAreStoredAsOneWayHashes()
    {
        var user = new AppUser { FirstName = "Test", LastName = "Pilot" };
        var hasher = new PasswordHasher<AppUser>();
        var hash = hasher.HashPassword(user, "correct-horse-battery");

        Assert.DoesNotContain("correct-horse-battery", hash, StringComparison.Ordinal);
        Assert.Equal(PasswordVerificationResult.Success, hasher.VerifyHashedPassword(user, hash, "correct-horse-battery"));
        Assert.Equal(PasswordVerificationResult.Failed, hasher.VerifyHashedPassword(user, hash, "wrong-password"));
    }
}
