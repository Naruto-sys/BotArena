using System.Text.Json;
using Xunit;

namespace BotArena.Tests;

public class WeaponSelectionTests
{
    private static CustomMatchSpec DuelSpec(CustomMatchSpawn player) => new(new(16, 10, []),
        [player, new("opponent", "opponent", 14, 5, Math.PI, Math.PI)], []);

    [Fact]
    public void ExistingRequestsWithoutWeaponKeepTheOrdinaryCannon()
    {
        var player = JsonSerializer.Deserialize<CustomMatchSpawn>(
            """{"id":"player","teamId":"player","x":2,"y":5}""", MatchWorker.Json)!;
        var duel = new Duel(CustomMatchConfiguration.Create(DuelSpec(player), 42));
        Assert.Equal(WeaponType.Cannon, duel.Observe("player").Self.Weapon);
    }

    [Theory]
    [InlineData("Cannon", WeaponType.Cannon)]
    [InlineData("Mortar", WeaponType.Mortar)]
    [InlineData("Gauss", WeaponType.Gauss)]
    public void JsonSelectionReachesTheSimulationAndObservation(string name, WeaponType weapon)
    {
        var json = $$"""{"id":"player","teamId":"player","x":2,"y":5,"weapon":"{{name}}"}""";
        var player = JsonSerializer.Deserialize<CustomMatchSpawn>(json, MatchWorker.Json)!;
        var duel = new Duel(CustomMatchConfiguration.Create(DuelSpec(player), 42));
        Assert.Equal(weapon, duel.Observe("player").Self.Weapon);
        Assert.Equal(weapon, duel.CaptureFrame().Bots[0].Weapon);
    }

    [Theory]
    [InlineData("\"Laser\"")]
    [InlineData("null")]
    [InlineData("true")]
    [InlineData("{}")]
    public void InvalidJsonWeaponValuesAreRejected(string value)
    {
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<CustomMatchSpawn>(
            $$"""{"id":"player","teamId":"player","x":2,"y":5,"weapon":{{value}}}""", MatchWorker.Json));
    }

    [Fact]
    public void UndefinedNumericWeaponIsRejectedBeforeTheMatchStarts()
    {
        var spec = DuelSpec(new("player", "player", 2, 5, Weapon: (WeaponType)999));
        Assert.Throws<ArgumentException>(() => new Duel(CustomMatchConfiguration.Create(spec, 42)));
    }

    public static IEnumerable<object[]> PresetWeapons => BehaviorPresets.All.SelectMany(preset =>
        Enum.GetValues<WeaponType>().Select(weapon => new object[] { preset.Id, weapon }));

    [Theory]
    [MemberData(nameof(PresetWeapons))]
    public void EveryPresetCanRunWithEveryWeapon(string preset, WeaponType weapon)
    {
        var config = CustomMatchConfiguration.Create(DuelSpec(new("player", "player", 2, 5, Weapon: weapon)), 42)
            with { MaxTicks = 100 };
        using var player = StrategyLanguages.Create("javascript", BehaviorPresets.GetCode(preset));
        using var opponent = StrategyLanguages.Create("javascript", "function tick() { return {}; }");
        var response = Match.Run(config, player, opponent);
        Assert.Null(response.Error);
        Assert.All(response.Replay.Frames, frame => Assert.Equal(weapon, frame.Bots[0].Weapon));
        foreach (var shell in response.Replay.Frames.SelectMany(frame => frame.Bullets).Where(bullet => bullet.Weapon == WeaponType.Mortar))
        {
            Assert.NotNull(shell.TargetPoint);
            Assert.InRange(shell.TargetPoint.Value.X, 0, 16);
            Assert.InRange(shell.TargetPoint.Value.Y, 0, 10);
        }
    }

    [Fact]
    public void MortarPresetClampsRandomAimToTheArena()
    {
        using var preset = StrategyLanguages.Create("javascript", "Math.random = () => 0.5;\n" + BehaviorPresets.GetCode("blind-afraid"));
        var observation = new BotObservation(0,
            new("player", "player", new(1, 1), 0, 0, 0, 100, 100, 0, WeaponType.Mortar),
            null, [], new(16, 10, []));
        var action = preset.Decide(observation);
        Assert.True(action.Shoot);
        Assert.Equal(0, action.TargetPoint!.Value.X);
        Assert.InRange(action.TargetPoint.Value.Y, .999999, 1.000001);
    }

    [Theory]
    [InlineData(MatchMode.Elimination)]
    [InlineData(MatchMode.KingOfHill)]
    [InlineData(MatchMode.Deathmatch)]
    public async Task WorkerPreservesMixedWeaponsAndRunsAllThreeModes(MatchMode mode)
    {
        var spawns = new[]
        {
            new CustomMatchSpawn("player", "player", 2, 2, Weapon: WeaponType.Mortar),
            new CustomMatchSpawn("player-2", mode == MatchMode.Deathmatch ? "player-2" : "player", 2, 8, Weapon: WeaponType.Gauss),
            new CustomMatchSpawn("opponent", "opponent", 14, 2, Math.PI, Math.PI, Weapon: WeaponType.Cannon),
            new CustomMatchSpawn("opponent-2", mode == MatchMode.Deathmatch ? "opponent-2" : "opponent", 14, 8, Math.PI, Math.PI, Weapon: WeaponType.Mortar),
        };
        var spec = new CustomMatchSpec(new(16, 10, []), spawns,
            spawns.Select(spawn => new CustomMatchLoadout(spawn.Id, "preset", "blind-berserk")).ToArray(), 80, mode);
        var result = await MatchWorker.RunAsync(new(null, Language: "javascript", CustomMatch: spec), CancellationToken.None);
        Assert.Null(result.Error);
        Assert.NotNull(result.Response);
        Assert.Null(result.Response.Error);
        Assert.Equal(mode, result.Response.Replay.Mode);
        foreach (var weapon in Enum.GetValues<WeaponType>())
            Assert.Contains(result.Response.Replay.Frames.SelectMany(frame => frame.Events),
                e => e.Type == GameEventType.ShotFired && e.Weapon == weapon);
        foreach (var frame in result.Response.Replay.Frames)
            Assert.All(frame.Bots, bot => Assert.Equal(spawns.Single(spawn => spawn.Id == bot.Id).Weapon, bot.Weapon));
    }
}
