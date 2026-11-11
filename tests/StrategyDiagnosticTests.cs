using Xunit;

namespace BotArena.Tests;

public class StrategyDiagnosticTests
{
    [Fact]
    public void SyntaxErrorIncludesParserDetailsAndLocation()
    {
        var error = Assert.Throws<StrategyException>(() =>
            StrategyLanguages.Create(StrategyLanguages.JavaScript, """
                function tick({ self }) {
                  return { driveTo { x: 10, y: 5 } };
                }
                """));

        Assert.Null(error.Tick);
        Assert.Equal(2, error.Line);
        Assert.Equal(20, error.Column);
        Assert.Contains("Ошибка JavaScript при загрузке стратегии", error.Message);
        Assert.Contains("Unexpected token '{'", error.Message);
        Assert.DoesNotContain("strategy.js:", error.Message);
        Assert.DoesNotContain("Не удалось загрузить код стратегии.", error.Message);
    }
}
