using Xunit;

namespace BotArena.Tests;

public class SpawnHpTests
{
    [Fact]
    public void SpawnHpIsAppliedAndTwoShotsDestroyFortyHpBot()
    {
        var duel = new Duel(MatchConfig.Classic with
        {
            Arena = new(16, 10, []),
            Spawns =
            [
                new("shooter", new(2, 5), 0, 0, "shooter"),
                new("target", new(5, 5), Math.PI, Math.PI, "target", Hp: 40),
            ],
            BulletSpeed = 100,
            BulletDamage = 20,
            ShotCooldownTicks = 1
        });

        Assert.Equal(40, duel.Bot("target").Hp);
        Assert.Equal(40, duel.Bot("target").MaxHp);

        var idle = new BotAction(0, 0, default, false);
        duel.Step(new Dictionary<string, BotAction>
        {
            ["shooter"] = idle with { Shoot = true },
            ["target"] = idle,
        });
        Assert.Equal(20, duel.Bot("target").Hp);
        Assert.Null(duel.Result);

        duel.Step(new Dictionary<string, BotAction>
        {
            ["shooter"] = idle with { Shoot = true },
            ["target"] = idle,
        });
        Assert.Equal(0, duel.Bot("target").Hp);
        Assert.Equal("shooter", duel.Result?.WinnerBotId);
    }
}
