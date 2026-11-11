using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace BotArena;

public sealed class UgcDbContextFactory : IDesignTimeDbContextFactory<UgcDbContext>
{
    public UgcDbContext CreateDbContext(string[] args)
    {
        var configuration = new ConfigurationBuilder()
            .SetBasePath(Directory.GetCurrentDirectory())
            .AddJsonFile("appsettings.json", optional: false)
            .AddJsonFile("appsettings.Local.json", optional: true)
            .AddEnvironmentVariables()
            .Build();
        var connectionString = configuration.GetConnectionString("BotArena")
            ?? throw new InvalidOperationException("ConnectionStrings:BotArena is required.");
        var options = new DbContextOptionsBuilder<UgcDbContext>().UseNpgsql(connectionString).Options;
        return new(options);
    }
}
