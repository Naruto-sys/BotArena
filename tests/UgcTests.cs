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
}
