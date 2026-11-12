using Xunit;

namespace BotArena.Tests;

public class ConsumableApiTests
{
    [Theory]
    [InlineData("Repair", ConsumableType.Repair)]
    [InlineData("Shield", ConsumableType.Shield)]
    [InlineData("SpeedBoost", ConsumableType.SpeedBoost)]
    [InlineData("Coolant", ConsumableType.Coolant)]
    [InlineData("Smoke", ConsumableType.Smoke)]
    public void JavaScriptDecodesAllItemCommandsWithoutChangingOtherChannels(string name, ConsumableType expected)
    {
        using var bot = new JavaScriptBot("function tick() { return {useItem: '" + name + "', leftTrack: 1, aim: bot.scan(), shoot: true}; }");
        var action = bot.Decide(new Duel(MatchConfig.Classic).Observe("player"));
        Assert.Equal(expected, action.UseItem);
        Assert.Equal(1, action.LeftTrack);
        Assert.Equal(0.5, action.TurretTurn);
        Assert.True(action.Shoot);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("true")]
    [InlineData("0")]
    [InlineData("[]")]
    [InlineData("{}")]
    [InlineData("'unknown'")]
    [InlineData("'0'")]
    [InlineData("'repair'")]
    [InlineData("''")]
    public void MalformedItemCommandsReportAStrategyError(string value)
    {
        using var bot = new JavaScriptBot("function tick() { return {useItem: " + value + "}; }");
        Assert.Equal(0, Assert.Throws<StrategyException>(() => bot.Decide(new Duel(MatchConfig.Classic).Observe("player"))).Tick);
    }

    [Fact]
    public void ItemPropertyGettersRemainInsideTheExecutionBudget()
    {
        using var bot = new JavaScriptBot("function tick() { return {get useItem() { while (true) {} }}; }");
        Assert.Throws<StrategyException>(() => bot.Decide(new Duel(MatchConfig.Classic).Observe("player")));
    }

    [Fact]
    public void MatchStrategiesCanObserveAndUseInventoryAndEffects()
    {
        var config = MatchConfig.Classic with
        {
            Arena = new(16, 10, []),
            Consumables = new() { Enabled = true, InitialCount = 0 },
            InitialItems = [new(ConsumableType.Shield, new(2, 5))]
        };
        using var bot = new JavaScriptBot("""
            function tick(state) {
              if (state.tick === 0 && state.items.length !== 1) throw new Error('missing item');
              if (state.consumableRules.inventoryCapacity !== 2) throw new Error('missing rules');
              return {useItem: state.self.inventory.includes('Shield') ? 'Shield' : undefined};
            }
            """);
        using var other = new JavaScriptBot("function tick() { return {}; }");
        var result = Match.Run(config, bot, other);
        Assert.Null(result.Error);
        Assert.Contains(result.Replay.Frames, frame => frame.Bots[0].ShieldHp == 40);
        Assert.Contains(result.Replay.Frames, frame => frame.Events.Any(item => item.Type == GameEventType.ItemUsed));
    }
}
