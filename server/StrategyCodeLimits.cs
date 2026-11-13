namespace BotArena;

internal static class StrategyCodeLimits
{
    public const int MaxLines = 1_000;

    public static string? Validate(MatchRequest request)
    {
        foreach (var code in Codes(request))
        {
            if (CountLines(code) > MaxLines)
                return $"Финальный код стратегии не может содержать больше {MaxLines} строк.";
        }
        return null;
    }

    public static string? Validate(string code) => CountLines(code) > MaxLines
        ? $"Код стратегии не может содержать больше {MaxLines} строк."
        : null;

    internal static int CountLines(string code)
    {
        if (code.Length == 0) return 0;
        var lines = 1;
        for (var index = 0; index < code.Length; index++)
        {
            if (code[index] == '\n' || code[index] == '\r' && (index + 1 == code.Length || code[index + 1] != '\n'))
                lines++;
        }
        return lines;
    }

    private static IEnumerable<string> Codes(MatchRequest request)
    {
        if (!string.IsNullOrWhiteSpace(request.BotCode)) yield return request.BotCode;
        if (!string.IsNullOrWhiteSpace(request.OpponentCode)) yield return request.OpponentCode;
        if (request.BotCodes is not null)
            foreach (var code in request.BotCodes.Values.Where(code => !string.IsNullOrWhiteSpace(code))) yield return code;
        if (request.CustomMatch is not null)
            foreach (var code in request.CustomMatch.Loadouts.Select(item => item.Code).Where(code => !string.IsNullOrWhiteSpace(code)))
                yield return code!;
    }
}
