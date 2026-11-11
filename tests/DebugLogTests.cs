using Xunit;

namespace BotArena.Tests;

public class DebugLogTests
{
    [Fact]
    public void ConsoleLogAppearsInMatchResponse()
    {
        using var player = StrategyLanguages.Create(StrategyLanguages.JavaScript, """
            function tick({ self }) {
                console.log('x=', self.position.x, 'target', { x: 10, y: 5 });
                return { driveTo: { x: 10, y: 5 } };
            }
            """);
        using var opponent = StrategyLanguages.Create(StrategyLanguages.JavaScript, """
            function tick() { return {}; }
            """);

        var level = CampaignCatalog.Find("move")!;
        var response = Match.Run(level.Config, player, opponent, level.Objective, level.Marker);

        var lines = Assert.IsAssignableFrom<IReadOnlyList<StrategyLogLine>>(response.Logs);
        Assert.NotEmpty(lines);
        Assert.Contains(lines, line => line.Message.Contains("x=") && line.Tick is not null);
    }
}
