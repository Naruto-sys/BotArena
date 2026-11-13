namespace BotArena;

internal static class StrategyValidator
{
    public static (bool Active, string? Error) Validate(string language, string code)
    {
        if (StrategyCodeLimits.Validate(code) is { } limitError) return (false, limitError);
        try
        {
            using var runtime = StrategyLanguages.Create(language, code);
            runtime.Decide(new Duel(MatchConfig.Classic).Observe("player"));
            return (true, null);
        }
        catch (StrategyException error)
        {
            return (false, error.Message.Length <= 1000 ? error.Message : error.Message[..1000]);
        }
        catch (Exception)
        {
            return (false, "Не удалось проверить выполнение стратегии.");
        }
    }
}
