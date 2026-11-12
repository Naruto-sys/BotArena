using Xunit;

namespace BotArena.Tests;

public class MortarApiTests
{
    private static BotObservation Observation => new Duel(MatchConfig.Classic with
    {
        Spawns = [MatchConfig.Classic.Spawns[0] with { Weapon = WeaponType.Mortar }, MatchConfig.Classic.Spawns[1]]
    }).Observe("player");

    [Fact]
    public void JavaScriptCanTargetAMortarWithoutSeeingTheEnemy()
    {
        using var bot = new JavaScriptBot("""
            function tick(state) {
              if (state.self.weapon !== 'Mortar') throw new Error('wrong weapon');
              return {shoot: true, targetPoint: {x: 14, y: 5}, aim: bot.scan()};
            }
            """);
        var action = bot.Decide(Observation);
        Assert.True(action.Shoot);
        Assert.Equal(new Vec2(14, 5), action.TargetPoint);
        Assert.Equal(0.5, action.TurretTurn);
    }

    [Fact]
    public void TargetGettersRunInsideTheBudgetAndToJsonIsNotCalled()
    {
        using var bot = Strategy("{shoot: true, targetPoint: {x: 14, y: 5, toJSON() { while (true) {} }}}");
        Assert.Equal(new Vec2(14, 5), bot.Decide(Observation).TargetPoint);
        using var getter = Strategy("{targetPoint: {get x() { while (true) {} }, y: 5}}");
        Assert.Throws<StrategyException>(() => getter.Decide(Observation));
    }

    [Theory]
    [InlineData("{shoot: true}")]
    [InlineData("{targetPoint: null}")]
    [InlineData("{targetPoint: []}")]
    [InlineData("{targetPoint: {x: 5}}")]
    [InlineData("{targetPoint: {x: '5', y: 5}}")]
    [InlineData("{targetPoint: {x: true, y: 5}}")]
    [InlineData("{targetPoint: {x: NaN, y: 5}}")]
    [InlineData("{targetPoint: {x: Infinity, y: 5}}")]
    [InlineData("{targetPoint: {x: -1, y: 5}}")]
    [InlineData("{targetPoint: {x: 17, y: 5}}")]
    [InlineData("{targetPoint: {x: 5, y: -1}}")]
    [InlineData("{targetPoint: {x: 5, y: 11}}")]
    public void InvalidMortarCommandsReportAStrategyError(string command)
    {
        using var bot = Strategy(command);
        Assert.Equal(0, Assert.Throws<StrategyException>(() => bot.Decide(Observation)).Tick);
    }

    [Fact]
    public void CannonRejectsTargetPointAndMortarCanRemainIdleWithoutATarget()
    {
        using var bot = Strategy("{targetPoint: {x: 14, y: 5}}");
        Assert.Throws<StrategyException>(() => bot.Decide(new Duel(MatchConfig.Classic).Observe("player")));
        using var idle = Strategy("{}");
        Assert.Null(idle.Decide(Observation).TargetPoint);
        using var targeted = Strategy("{targetPoint: {x: 14, y: 5}}");
        Assert.False(targeted.Decide(Observation).Shoot);
    }

    [Fact]
    public void MatchCanRunAMortarStrategyAgainstAHiddenCannonOpponent()
    {
        var config = MatchConfig.Classic with
        {
            Arena = new(16, 10, [new Wall(7, 0, 1, 10)]),
            Spawns = [MatchConfig.Classic.Spawns[0] with { Weapon = WeaponType.Mortar }, MatchConfig.Classic.Spawns[1]]
        };
        using var player = new JavaScriptBot("""
            function tick(state) {
              if (state.enemy !== null) throw new Error('unexpected visibility');
              return {shoot: true, targetPoint: {x: 14, y: 5}};
            }
            """);
        using var opponent = Strategy("{shoot: true}");
        var response = Match.Run(config, player, opponent);
        Assert.Null(response.Error);
        Assert.Equal("player", response.Replay.Result.WinnerBotId);
        Assert.Equal(MatchEndReason.BotDestroyed, response.Replay.Result.Reason);
        Assert.Contains(response.Replay.Frames, frame => frame.Events.Any(item => item.Type == GameEventType.ProjectileLanded));
    }

    private static JavaScriptBot Strategy(string command) => new("function tick() { return " + command + "; }");
}
