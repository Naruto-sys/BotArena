using Xunit;

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
}
