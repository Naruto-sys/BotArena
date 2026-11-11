using Xunit;

namespace BotArena.Tests;

public class TurretMovementCompatibilityTests
{
    private static readonly BotAction Idle = new(0, 0, default, false);

    [Theory]
    [InlineData("tracked")]
    [InlineData("hover")]
    [InlineData("wheeled")]
    [InlineData("omni")]
    public void TurretCommandsPreserveEachChassisMovement(string model)
    {
        foreach (var command in new[]
        {
            "aim: bot.scan({speed: 0.25, direction: 'counterclockwise'})",
            "aim: bot.aimAt({x: 10, y: 2})",
            "aim: bot.holdAim()",
            "turretTurn: -0.25"
        })
        {
            using var strategy = new JavaScriptBot("function tick() { return {" +
                "leftTrack: 0.8, rightTrack: 0.4, thrust: {x: 0, y: 1}, turn: 0.6, throttle: 0.7, " +
                command + "}; }");
            var actual = Arena(model);
            var expected = Arena(model);
            for (var tick = 0; tick < 12; tick++)
            {
                var observation = actual.Observe("player");
                var action = strategy.Decide(observation);
                var aim = command.Contains("aimAt") ? new Vec2(10, 2) - observation.Self.Position : default;
                double? turretTurn = command.Contains("scan") || command.StartsWith("turretTurn") ? -0.25 : null;
                var direct = new BotAction(0.8, 0.4, aim, false, turretTurn)
                {
                    Thrust = new(0, 1), Turn = 0.6, Throttle = 0.7
                };
                Assert.Equal(direct, action);
                Step(actual, action);
                Step(expected, direct);
                Assert.Equal(expected.Observe("player").Self, actual.Observe("player").Self);
            }
        }
    }

    private static Duel Arena(string model)
    {
        IMovementModel? movement = model switch
        {
            "hover" => new HoverMovement(),
            "wheeled" => new WheeledMovement(),
            "omni" => new OmniMovement(),
            _ => null
        };
        return new Duel(MatchConfig.Classic with
        {
            Arena = new(16, 10, []),
            Spawns = [new("player", new(2, 2), 0, 0) { Movement = movement }, new("opponent", new(14, 5), 0, 0)]
        });
    }

    private static void Step(Duel duel, BotAction action) =>
        duel.Step(new Dictionary<string, BotAction> { ["player"] = action, ["opponent"] = Idle });
}
