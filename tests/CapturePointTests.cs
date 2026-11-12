using Xunit;

namespace BotArena.Tests;

public class CapturePointTests
{
    private static readonly BotAction Idle = new(0, 0, default, false);

    private static MatchConfig CaptureConfig(params BotSpawn[] spawns) => MatchConfig.Classic with
    {
        MaxTicks = 400,
        Arena = new(16, 10, []),
        Spawns = Array.AsReadOnly(spawns),
        ShrinkZoneEnabled = false,
        MaxForwardSpeed = 8,
        MaxReverseSpeed = 8,
        Acceleration = 40,
        Deceleration = 40,
    };

    private static CapturePointObjective Objective() =>
        new(CapturePointSetup.DefaultBases);

    private static void StepCapture(Duel duel, IReadOnlyDictionary<string, BotAction> actions)
    {
        duel.Step(actions);
        if (duel.Result is null) duel.TickCapture();
    }

    [Fact]
    public void StandingOnEnemyBaseCapturesInFiveSeconds()
    {
        var duel = new Duel(CaptureConfig(
            new("player", new(13.8, 5), 0, 0, "player"),
            new("opponent", new(8, 2), Math.PI, Math.PI, "opponent")));
        duel.ConfigureCapture(Objective());

        for (var i = 0; i < 100 && duel.Result is null; i++)
            StepCapture(duel, new Dictionary<string, BotAction>
            {
                ["player"] = Idle,
                ["opponent"] = Idle,
            });

        Assert.Equal("player", duel.Result?.WinnerTeamId);
        Assert.Equal(MatchEndReason.ObjectiveComplete, duel.Result?.Reason);
        Assert.Equal(100, duel.Result?.DurationTicks);
    }

    [Fact]
    public void DefenderInZonePausesCapture()
    {
        var duel = new Duel(CaptureConfig(
            new("player", new(13.8, 5), 0, 0, "player"),
            new("opponent", new(14.5, 5.5), Math.PI, Math.PI, "opponent")));
        duel.ConfigureCapture(Objective());

        for (var i = 0; i < 100; i++)
            StepCapture(duel, new Dictionary<string, BotAction>
            {
                ["player"] = Idle,
                ["opponent"] = Idle,
            });

        Assert.Null(duel.Result);
        var zone = duel.CaptureFrame().CaptureZones.Single(item => item.OwnerTeamId == "opponent");
        Assert.True(zone.Contested);
        Assert.Equal(0, zone.Progress);
    }

    [Fact]
    public void LeavingZoneDecaysProgress()
    {
        var response = Match.Run(
            CaptureConfig(
                new("player", new(13.8, 5), 0, 0, "player"),
                new("opponent", new(8, 2), Math.PI, Math.PI, "opponent")),
            new Dictionary<string, IBotRuntime>(StringComparer.Ordinal)
            {
                ["player"] = new ScriptedRuntime(observation =>
                    observation.Tick < 50
                        ? Idle
                        : Idle with { LeftTrack = -1, RightTrack = -1 }),
                ["opponent"] = new ScriptedRuntime(_ => Idle),
            },
            Objective());

        var peak = response.Replay.Frames
            .Select(frame => frame.CaptureZones.FirstOrDefault(zone => zone.OwnerTeamId == "opponent")?.Progress ?? 0)
            .Max();
        var last = response.Replay.Frames[^1].CaptureZones
            .Single(zone => zone.OwnerTeamId == "opponent").Progress;
        Assert.True(peak > 0.4);
        Assert.True(last < peak - 0.15);
        Assert.Null(response.Replay.Result.WinnerTeamId);
    }

    [Fact]
    public void TeamWipeStillWinsBeforeCapture()
    {
        var duel = new Duel(CaptureConfig(
            new("player", new(2.2, 5), 0, 0, "player"),
            new("opponent", new(5, 5), Math.PI, Math.PI, "opponent")) with
        {
            BulletSpeed = 100,
            BulletDamage = 100,
        });
        duel.ConfigureCapture(Objective());
        StepCapture(duel, new Dictionary<string, BotAction>
        {
            ["player"] = Idle with { Shoot = true },
            ["opponent"] = Idle,
        });

        Assert.Equal("player", duel.Result?.WinnerTeamId);
        Assert.Equal(MatchEndReason.BotDestroyed, duel.Result?.Reason);
    }

    [Fact]
    public void SimultaneousCaptureIsDraw()
    {
        var duel = new Duel(CaptureConfig(
            new("player", new(13.8, 5), 0, 0, "player"),
            new("opponent", new(2.2, 5), Math.PI, Math.PI, "opponent")));
        duel.ConfigureCapture(Objective());

        for (var i = 0; i < 200 && duel.Result is null; i++)
            StepCapture(duel, new Dictionary<string, BotAction>
            {
                ["player"] = Idle,
                ["opponent"] = Idle,
            });

        Assert.Equal(MatchEndReason.ObjectiveComplete, duel.Result?.Reason);
        Assert.Null(duel.Result?.WinnerTeamId);
        Assert.Null(duel.Result?.WinnerBotId);
    }

    private sealed class ScriptedRuntime(Func<BotObservation, BotAction> decide) : IBotRuntime
    {
        public BotAction Decide(BotObservation observation) => decide(observation);
        public IReadOnlyList<StrategyLogLine> ConsumeLogs() => [];
        public void Dispose() { }
    }
}
