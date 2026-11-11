using Xunit;

namespace BotArena.Tests;

public class ShrinkZoneTests
{
    [Fact]
    public void ShrinkZoneDamagesOnlyOutsideBotsOnSchedule()
    {
        var duel = new Duel(MatchConfig.Classic with
        {
            MaxTicks = 240,
            ShrinkZoneEnabled = true,
            ShrinkStartSeconds = 10,
            ShrinkOutsideDamagePerSecond = 10,
            ShrinkDurationSeconds = 0.05,
            ShrinkFinalScale = 0.15,
            Arena = new(16, 10, []),
            Spawns =
            [
                new("edge", new(0.9, 0.9), 0, 0, "player", 100),
                new("center", new(8, 5), Math.PI, Math.PI, "opponent", 100),
            ]
        });

        var idle = new BotAction(0, 0, default, false);
        var zoneEvents = 0;
        for (var tick = 0; tick < 220; tick++)
        {
            duel.Step(new Dictionary<string, BotAction> { ["edge"] = idle, ["center"] = idle });
            zoneEvents += duel.CaptureFrame().Events.Count(item => item.Type == GameEventType.ZoneDamage);
        }

        Assert.Equal(100, duel.Bot("center").Hp);
        Assert.True(duel.Bot("edge").Hp <= 90);
        Assert.True(zoneEvents >= 1);
        Assert.NotNull(duel.CaptureFrame().SafeZone);
        Assert.True(duel.CaptureFrame().SafeZone!.Width < 16);
    }

    [Fact]
    public void DisabledShrinkZoneLeavesFullArenaSafe()
    {
        var duel = new Duel(MatchConfig.Classic with
        {
            MaxTicks = 240,
            ShrinkZoneEnabled = false,
            Arena = new(16, 10, []),
            Spawns =
            [
                new("edge", new(0.9, 0.9), 0, 0, "player", 100),
                new("center", new(8, 5), Math.PI, Math.PI, "opponent", 100),
            ]
        });

        var idle = new BotAction(0, 0, default, false);
        for (var tick = 0; tick < 220; tick++)
            duel.Step(new Dictionary<string, BotAction> { ["edge"] = idle, ["center"] = idle });

        Assert.Equal(100, duel.Bot("edge").Hp);
        Assert.Null(duel.CaptureFrame().SafeZone);
    }
}
