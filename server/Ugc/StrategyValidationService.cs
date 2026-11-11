using Microsoft.EntityFrameworkCore;

namespace BotArena;

internal static class StrategyValidationService
{
    public static async Task ValidateStoredStrategiesAsync(IServiceProvider services)
    {
        await using var scope = services.CreateAsyncScope();
        var database = scope.ServiceProvider.GetRequiredService<UgcDbContext>();
        var strategies = await database.Strategies.Where(item => !item.IsPendingTransfer).ToListAsync();
        foreach (var strategy in strategies)
        {
            var result = StrategyValidator.Validate(strategy.Language, strategy.Code);
            strategy.IsActive = result.Active;
            strategy.ValidationError = result.Error;
        }
        await database.SaveChangesAsync();
    }
}
