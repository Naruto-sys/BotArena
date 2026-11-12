namespace BotArena;

internal static class Match
{
    private const string PlayerId = "player";
    private const string OpponentId = "opponent";

    public static MatchResponse Run(MatchConfig config, IBotRuntime player, IBotRuntime opponent)
    {
        var duel = new Duel(config);
        var frames = new List<GameFrame> { duel.CaptureFrame() };
        var actions = new Dictionary<string, BotAction>();
        ScriptError? error = null;
        while (duel.Result is null)
        {
            var decidingBot = PlayerId;
            try
            {
                actions[PlayerId] = player.Decide(duel.Observe(PlayerId));
                decidingBot = OpponentId;
                actions[OpponentId] = opponent.Decide(duel.Observe(OpponentId));
            }
            catch (StrategyException failure)
            {
                duel.Forfeit(decidingBot);
                error = new(decidingBot, failure.Tick, failure.Message, failure.Line, failure.Column);
                // The failed decision never advances the world. Record the finish on its current tick.
                frames[^1] = duel.CaptureFrame();
                break;
            }
            duel.Step(actions);
            frames.Add(duel.CaptureFrame());
        }
        return new(new(config.TickRate, config.Arena, frames, duel.Result!) { RandomSeed = config.RandomSeed }, error);
    }
}
