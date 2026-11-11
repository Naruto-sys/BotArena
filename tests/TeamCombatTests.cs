using Xunit;

namespace BotArena.Tests;

public class TeamCombatTests
{
    private static readonly BotAction Idle = new(0, 0, default, false);

    [Fact]
    public void TeamWipeWinsEvenWithMultipleAlliesAlive()
    {
        var duel = new Duel(MatchConfig.Classic with
        {
            Arena = new(16, 10, []),
            Spawns =
            [
                new("player-1", new(2, 3), 0, 0, "player"),
                new("player-2", new(2, 7), 0, 0, "player"),
                new("opponent-1", new(5, 3), Math.PI, Math.PI, "opponent"),
                new("opponent-2", new(5, 7), Math.PI, Math.PI, "opponent"),
            ],
            BulletSpeed = 100,
            BulletDamage = 100
        });

        duel.Step(new Dictionary<string, BotAction>
        {
            ["player-1"] = Idle with { Shoot = true },
            ["player-2"] = Idle with { Shoot = true },
            ["opponent-1"] = Idle,
            ["opponent-2"] = Idle,
        });

        Assert.Equal("player", duel.Result?.WinnerTeamId);
        Assert.Contains(duel.Result?.WinnerBotId, new[] { "player-1", "player-2" });
        Assert.Equal(MatchEndReason.BotDestroyed, duel.Result?.Reason);
        Assert.Equal(new[] { 100, 100, 0, 0 }, duel.CaptureFrame().Bots.Select(bot => bot.Hp));
    }

    [Fact]
    public void AlliesAreHiddenFromObservationAndImmuneToFriendlyFire()
    {
        var duel = new Duel(MatchConfig.Classic with
        {
            Arena = new(16, 10, []),
            Spawns =
            [
                new("player-1", new(2, 5), 0, 0, "player"),
                new("player-2", new(4.2, 5), 0, 0, "player"),
                new("opponent-1", new(6.5, 5), Math.PI, Math.PI, "opponent"),
            ],
            BulletSpeed = 100,
            BulletDamage = 20
        });

        var observation = duel.Observe("player-1");
        Assert.Equal("opponent-1", observation.Enemy?.Id);
        Assert.DoesNotContain(observation.Enemies, bot => bot.Id == "player-2");

        duel.Step(new Dictionary<string, BotAction>
        {
            ["player-1"] = Idle with { Shoot = true },
            ["player-2"] = Idle,
            ["opponent-1"] = Idle,
        });

        Assert.Equal(100, duel.Bot("player-2").Hp);
        Assert.Equal(80, duel.Bot("opponent-1").Hp);
    }

    [Fact]
    public void FfaUsesPerBotTeamsAndLastSurvivorWins()
    {
        var duel = new Duel(MatchConfig.Classic with
        {
            Arena = new(16, 10, []),
            Spawns =
            [
                new("a", new(2, 5), 0, 0, "a"),
                new("b", new(4.5, 5), Math.PI, Math.PI, "b"),
                new("c", new(7, 5), Math.PI, Math.PI, "c"),
            ],
            BulletSpeed = 100,
            BulletDamage = 100,
            ShotCooldownTicks = 1
        });

        duel.Step(new Dictionary<string, BotAction>
        {
            ["a"] = Idle with { Shoot = true },
            ["b"] = Idle,
            ["c"] = Idle,
        });
        Assert.Null(duel.Result);
        Assert.Equal(0, duel.Bot("b").Hp);

        duel.Step(new Dictionary<string, BotAction>
        {
            ["a"] = Idle with { AimDirection = new(1, 0), Shoot = true },
            ["c"] = Idle,
        });

        Assert.Equal("a", duel.Result?.WinnerBotId);
        Assert.Equal("a", duel.Result?.WinnerTeamId);
    }
}
