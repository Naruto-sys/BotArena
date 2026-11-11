using System.Security.Claims;
using Microsoft.EntityFrameworkCore;

namespace BotArena;

public static class UgcEndpoints
{
    public static void MapUgcEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/ugc");

        group.MapGet("/strategies", async (string? q, string? tag, string? language, string? sort, UgcDbContext database) =>
        {
            var query = database.Strategies.AsNoTracking().Include(item => item.Owner)
                .Include(item => item.Versions).Include(item => item.ForkedFrom)
                .Where(item => item.Visibility == StrategyVisibility.Public && item.IsActive && !item.IsPendingTransfer);
            if (!string.IsNullOrWhiteSpace(q))
            {
                var pattern = $"%{q.Trim()}%";
                query = query.Where(item => EF.Functions.ILike(item.Name, pattern)
                    || EF.Functions.ILike(item.Description, pattern)
                    || EF.Functions.ILike(item.Owner.Nickname!, pattern));
            }
            if (!string.IsNullOrWhiteSpace(tag)) query = query.Where(item => item.Tags.Contains(tag));
            if (!string.IsNullOrWhiteSpace(language)) query = query.Where(item => item.Language == language);
            query = sort switch
            {
                "new" => query.OrderByDescending(item => item.UpdatedAt),
                "forks" => query.OrderByDescending(item => item.ForkCount),
                _ => query.OrderByDescending(item => item.LikeCount * 3 + item.ForkCount * 2 + item.RunCount / 10)
            };
            return Results.Ok((await query.Take(100).ToListAsync()).Select(Card));
        });

        group.MapGet("/strategies/{id:guid}", async (Guid id, ClaimsPrincipal principal, UgcDbContext database) =>
        {
            var strategy = await FullStrategy(database).SingleOrDefaultAsync(item => item.Id == id);
            if (strategy is null || strategy.Visibility != StrategyVisibility.Public && strategy.OwnerId != principal.UserId())
                return Results.NotFound();
            var viewerId = principal.UserId();
            var purchased = viewerId is { } buyerId && await database.StrategyPurchases.AsNoTracking()
                .AnyAsync(item => item.StrategyId == strategy.Id && item.BuyerId == buyerId);
            var canReadCode = CanReadCode(strategy, viewerId, purchased);
            return Results.Ok(Detail(strategy, viewerId, canReadCode));
        });

        group.MapGet("/shared/{token}", async (string token, UgcDbContext database) =>
        {
            var strategy = await FullStrategy(database).SingleOrDefaultAsync(item => item.ShareToken == token
                && item.Visibility == StrategyVisibility.Unlisted);
            return strategy is null ? Results.NotFound() : Results.Ok(Detail(strategy));
        });

        group.MapGet("/me/strategies", async (ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (principal.UserId() is not { } userId) return Results.Unauthorized();
            var items = await database.Strategies.AsNoTracking().Include(item => item.Owner)
                .Include(item => item.Versions).Include(item => item.ForkedFrom)
                .Where(item => item.OwnerId == userId && !item.IsPendingTransfer).OrderByDescending(item => item.UpdatedAt).ToListAsync();
            return Results.Ok(items.Select(Card));
        }).RequireAuthorization();

        group.MapPost("/strategies", async (SaveStrategyRequest request, ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (await Author(database, principal) is not { } owner) return Results.BadRequest(new { error = "Сначала выберите ник." });
            if (Validate(request) is { } error) return error;
            var language = request.Language ?? StrategyLanguages.JavaScript;
            var validation = StrategyValidator.Validate(language, request.Code);
            var strategy = new UserStrategy
            {
                Owner = owner, OwnerId = owner.Id, Name = request.Name.Trim(), Description = request.Description?.Trim() ?? "",
                Language = language, Code = request.Code, Tags = Tags(request.Tags), SalePrice = request.SalePrice,
                IsActive = validation.Active, ValidationError = validation.Error
            };
            database.Strategies.Add(strategy);
            await database.SaveChangesAsync();
            return Results.Created($"/api/ugc/strategies/{strategy.Id}", Detail(strategy, owner.Id));
        }).RequireAuthorization();

        group.MapPut("/strategies/{id:guid}", async (Guid id, SaveStrategyRequest request, ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (Validate(request) is { } error) return error;
            var strategy = await database.Strategies.Include(item => item.Owner).Include(item => item.Versions)
                .SingleOrDefaultAsync(item => item.Id == id);
            if (strategy is null) return Results.NotFound();
            if (strategy.OwnerId != principal.UserId()) return Results.Forbid();
            var language = request.Language ?? StrategyLanguages.JavaScript;
            var validation = StrategyValidator.Validate(language, request.Code);
            strategy.Name = request.Name.Trim(); strategy.Description = request.Description?.Trim() ?? "";
            strategy.Language = language; strategy.Code = request.Code;
            strategy.Tags = Tags(request.Tags); strategy.SalePrice = request.SalePrice;
            strategy.IsActive = validation.Active; strategy.ValidationError = validation.Error; strategy.UpdatedAt = DateTimeOffset.UtcNow;
            await database.SaveChangesAsync();
            return Results.Ok(Detail(strategy, principal.UserId()));
        }).RequireAuthorization();

        group.MapPost("/strategies/{id:guid}/publish", async (Guid id, PublishRequest request, ClaimsPrincipal principal, UgcDbContext database) =>
        {
            var strategy = await FullStrategy(database)
                .SingleOrDefaultAsync(item => item.Id == id);
            if (strategy is null) return Results.NotFound();
            if (strategy.OwnerId != principal.UserId()) return Results.Forbid();
            if (!strategy.IsActive) return Results.BadRequest(new { error = "Нельзя опубликовать неактивную стратегию. Исправьте ошибку выполнения." });
            var price = request.IsPaid ? request.Price : null;
            if (request.IsPaid && price is not (>= 1 and <= 1_000_000))
                return Results.BadRequest(new { error = "Для платной стратегии укажите цену от 1 до 1 000 000 кредитов." });
            await using var transaction = await database.Database.BeginTransactionAsync();
            var updated = await database.Strategies.Where(item => item.Id == id && item.OwnerId == principal.UserId())
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(item => item.Visibility, StrategyVisibility.Public)
                    .SetProperty(item => item.SalePrice, price)
                    .SetProperty(item => item.ShareToken, (string?)null)
                    .SetProperty(item => item.UpdatedAt, DateTimeOffset.UtcNow));
            if (updated == 0) return Results.Conflict(new { error = "Стратегия была изменена или удалена. Обновите страницу." });
            var versionNumber = (await database.StrategyVersions.Where(version => version.StrategyId == id)
                .MaxAsync(version => (int?)version.Number) ?? 0) + 1;
            database.StrategyVersions.Add(new UserStrategyVersion
            {
                Strategy = null!, StrategyId = strategy.Id, Number = versionNumber,
                Code = strategy.Code, Description = strategy.Description, Tags = [.. strategy.Tags]
            });
            try
            {
                await database.SaveChangesAsync();
                await transaction.CommitAsync();
            }
            catch (DbUpdateException)
            {
                await transaction.RollbackAsync();
                return Results.Conflict(new { error = "Стратегия уже публикуется в другом запросе. Обновите страницу." });
            }
            var published = await FullStrategy(database).SingleAsync(item => item.Id == id);
            return Results.Ok(Detail(published, principal.UserId()));
        }).RequireAuthorization();

        group.MapPost("/strategies/{id:guid}/unpublish", async (Guid id, ClaimsPrincipal principal, UgcDbContext database) =>
        {
            var updated = await database.Strategies.Where(item => item.Id == id && item.OwnerId == principal.UserId())
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(item => item.Visibility, StrategyVisibility.Private)
                    .SetProperty(item => item.SalePrice, (long?)null)
                    .SetProperty(item => item.UpdatedAt, DateTimeOffset.UtcNow));
            return updated == 0 ? Results.NotFound() : Results.NoContent();
        }).RequireAuthorization();

        group.MapDelete("/strategies/{id:guid}", async (Guid id, ClaimsPrincipal principal, UgcDbContext database) =>
        {
            var updated = await database.Strategies.Where(item => item.Id == id && item.OwnerId == principal.UserId())
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(item => item.IsDeleted, true)
                    .SetProperty(item => item.Visibility, StrategyVisibility.Private)
                    .SetProperty(item => item.SalePrice, (long?)null)
                    .SetProperty(item => item.UpdatedAt, DateTimeOffset.UtcNow));
            return updated == 0 ? Results.NotFound() : Results.NoContent();
        }).RequireAuthorization();

        group.MapPost("/strategies/{id:guid}/fork", async (Guid id, ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (await Author(database, principal) is not { } owner) return Results.BadRequest(new { error = "Сначала выберите ник." });
            var source = await database.Strategies.SingleOrDefaultAsync(item => item.Id == id && item.Visibility == StrategyVisibility.Public);
            if (source is null) return Results.NotFound();
            var purchased = await database.StrategyPurchases.AsNoTracking()
                .AnyAsync(item => item.StrategyId == source.Id && item.BuyerId == owner.Id);
            if (!CanReadCode(source, owner.Id, purchased))
                return Results.Forbid();
            source.ForkCount++;
            var fork = new UserStrategy
            {
                Owner = owner, OwnerId = owner.Id, Name = source.Name + " — ремикс", Description = source.Description,
                Language = source.Language, Code = source.Code, Tags = [.. source.Tags], ForkedFrom = source, ForkedFromId = source.Id,
                IsActive = source.IsActive, ValidationError = source.ValidationError
            };
            database.Strategies.Add(fork);
            await database.SaveChangesAsync();
            return Results.Created($"/api/ugc/strategies/{fork.Id}", Detail(fork, owner.Id));
        }).RequireAuthorization();

        group.MapPost("/strategies/{id:guid}/purchase", async (Guid id, ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (principal.UserId() is not { } buyerId) return Results.Unauthorized();
            var source = await database.Strategies.Include(item => item.Owner)
                .SingleOrDefaultAsync(item => item.Id == id && item.Visibility == StrategyVisibility.Public && item.IsActive && item.SalePrice != null);
            if (source is null) return Results.NotFound();
            if (source.OwnerId == buyerId) return Results.BadRequest(new { error = "Нельзя купить собственную стратегию." });
            if (await database.StrategyPurchases.AnyAsync(item => item.StrategyId == id && item.BuyerId == buyerId))
                return Results.Conflict(new { error = "Вы уже покупали эту стратегию." });
            var price = source.SalePrice!.Value;
            var buyer = await database.Users.SingleAsync(user => user.Id == buyerId);
            await using var transaction = await database.Database.BeginTransactionAsync();
            var debited = await database.Users.Where(user => user.Id == buyerId && user.Balance >= price)
                .ExecuteUpdateAsync(setters => setters.SetProperty(user => user.Balance, user => user.Balance - price));
            if (debited == 0)
            {
                await transaction.RollbackAsync();
                return Results.BadRequest(new { error = "Недостаточно кредитов для покупки." });
            }
            await database.Users.Where(user => user.Id == source.OwnerId)
                .ExecuteUpdateAsync(setters => setters.SetProperty(user => user.Balance, user => user.Balance + price));
            var purchase = new StrategyPurchase { Strategy = source, StrategyId = source.Id, Buyer = buyer, BuyerId = buyerId, Price = price };
            var copy = new UserStrategy
            {
                Owner = buyer, OwnerId = buyerId, Name = source.Name + " — куплено", Description = source.Description,
                Language = source.Language, Code = source.Code, Tags = [.. source.Tags], ForkedFrom = source, ForkedFromId = source.Id,
                IsActive = source.IsActive, ValidationError = source.ValidationError
            };
            database.StrategyPurchases.Add(purchase);
            database.Strategies.Add(copy);
            database.BalanceTransactions.AddRange(
                new() { User = buyer, UserId = buyerId, Amount = -price, Type = "strategy_purchase", ReferenceId = purchase.Id },
                new() { User = source.Owner, UserId = source.OwnerId, Amount = price, Type = "strategy_sale", ReferenceId = purchase.Id });
            source.ForkCount++;
            try
            {
                await database.SaveChangesAsync();
                await transaction.CommitAsync();
            }
            catch (DbUpdateException)
            {
                await transaction.RollbackAsync();
                return Results.Conflict(new { error = "Покупка уже была выполнена или данные изменились." });
            }
            return Results.Ok(new { strategy = Detail(copy, buyerId), balance = buyer.Balance - price });
        }).RequireAuthorization();

        group.MapPost("/strategies/{id:guid}/send/{friendId:guid}", async (Guid id, Guid friendId,
            ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (principal.UserId() is not { } senderId) return Results.Unauthorized();
            if (!await FriendEndpoints.AreFriends(database, senderId, friendId)) return Results.Forbid();
            var source = await database.Strategies.SingleOrDefaultAsync(item => item.Id == id && item.OwnerId == senderId);
            if (source is null) return Results.NotFound();
            var sender = await database.Users.SingleAsync(item => item.Id == senderId);
            var recipient = await database.Users.SingleAsync(item => item.Id == friendId);
            var copy = new UserStrategy
            {
                Owner = recipient, OwnerId = recipient.Id, Name = source.Name + " — от @" + sender.Nickname,
                Description = source.Description, Language = source.Language, Code = source.Code, Tags = [.. source.Tags],
                ForkedFrom = source, ForkedFromId = source.Id, IsActive = source.IsActive,
                ValidationError = source.ValidationError, IsPendingTransfer = true
            };
            var transfer = new StrategyTransfer
            {
                Sender = sender, SenderId = senderId, Recipient = recipient, RecipientId = recipient.Id,
                SourceStrategy = source, SourceStrategyId = source.Id, CopyStrategy = copy, CopyStrategyId = copy.Id
            };
            database.Strategies.Add(copy);
            database.StrategyTransfers.Add(transfer);
            await database.SaveChangesAsync();
            return Results.Created($"/api/ugc/transfers/{transfer.Id}", TransferView(transfer));
        }).RequireAuthorization();

        group.MapGet("/transfers", async (ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (principal.UserId() is not { } userId) return Results.Unauthorized();
            var items = await database.StrategyTransfers.AsNoTracking().IgnoreQueryFilters()
                .Include(item => item.Sender).Include(item => item.CopyStrategy)
                .Where(item => item.RecipientId == userId && item.Status == StrategyTransferStatus.Pending)
                .OrderByDescending(item => item.CreatedAt).ToListAsync();
            return Results.Ok(items.Select(TransferView));
        }).RequireAuthorization();

        group.MapPost("/transfers/{id:guid}/accept", async (Guid id, ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (principal.UserId() is not { } userId) return Results.Unauthorized();
            var transfer = await database.StrategyTransfers.Include(item => item.CopyStrategy)
                .SingleOrDefaultAsync(item => item.Id == id && item.RecipientId == userId && item.Status == StrategyTransferStatus.Pending);
            if (transfer is null) return Results.NotFound();
            transfer.Status = StrategyTransferStatus.Accepted;
            transfer.RespondedAt = DateTimeOffset.UtcNow;
            transfer.CopyStrategy.IsPendingTransfer = false;
            await database.SaveChangesAsync();
            return Results.Ok(new { strategyId = transfer.CopyStrategyId });
        }).RequireAuthorization();

        group.MapPost("/transfers/{id:guid}/decline", async (Guid id, ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (principal.UserId() is not { } userId) return Results.Unauthorized();
            var transfer = await database.StrategyTransfers.Include(item => item.CopyStrategy)
                .SingleOrDefaultAsync(item => item.Id == id && item.RecipientId == userId && item.Status == StrategyTransferStatus.Pending);
            if (transfer is null) return Results.NotFound();
            transfer.Status = StrategyTransferStatus.Declined;
            transfer.RespondedAt = DateTimeOffset.UtcNow;
            transfer.CopyStrategy.IsDeleted = true;
            await database.SaveChangesAsync();
            return Results.NoContent();
        }).RequireAuthorization();

        group.MapGet("/maneuvers", async (string? category, string? language, UgcDbContext database) =>
        {
            var query = database.Maneuvers.AsNoTracking().AsQueryable();
            if (!string.IsNullOrWhiteSpace(category)) query = query.Where(item => item.Category == category);
            if (!string.IsNullOrWhiteSpace(language)) query = query.Where(item => item.Language == language);
            return Results.Ok(await query.OrderBy(item => item.Name).ToListAsync());
        });
    }

    private static IQueryable<UserStrategy> FullStrategy(UgcDbContext database) => database.Strategies.AsNoTracking()
        .Include(item => item.Owner).Include(item => item.Versions).Include(item => item.ForkedFrom);
    private static object Card(UserStrategy item) => new
    {
        item.Id, item.Name, item.Description, item.Language, item.Tags, item.Visibility,
        author = new { item.Owner.Id, item.Owner.Nickname, item.Owner.AvatarUrl }, version = item.Versions.Count,
        forks = item.ForkCount, runs = item.RunCount, likes = item.LikeCount,
        item.ForkedFromId, forkedFromName = item.ForkedFrom?.Name, item.SalePrice,
        isPublished = item.Visibility == StrategyVisibility.Public, item.IsActive, item.ValidationError, item.UpdatedAt
    };
    private static object Detail(UserStrategy item, Guid? viewerId = null, bool includeCode = true) => new
    {
        item.Id, item.Name, item.Description, item.Language, code = includeCode ? item.Code : null,
        item.Tags, item.Visibility, item.ShareToken,
        author = new { item.Owner.Id, item.Owner.Nickname, item.Owner.AvatarUrl },
        versions = item.Versions.OrderBy(version => version.Number).Select(version => new { version.Number, version.PublishedAt }),
        item.ForkedFromId, forkedFromName = item.ForkedFrom?.Name, item.SalePrice,
        isPublished = item.Visibility == StrategyVisibility.Public, item.IsActive, item.ValidationError,
        isOwner = viewerId == item.OwnerId, canReadCode = includeCode, item.UpdatedAt
    };
    internal static bool CanReadCode(UserStrategy strategy, Guid? viewerId, bool purchased) =>
        strategy.SalePrice is null || viewerId == strategy.OwnerId || purchased;
    private static async Task<AppUser?> Author(UgcDbContext database, ClaimsPrincipal principal) => principal.UserId() is { } id
        ? await database.Users.SingleOrDefaultAsync(user => user.Id == id && user.Nickname != null) : null;
    private static IResult? Validate(SaveStrategyRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Trim().Length > 80)
            return Results.BadRequest(new { error = "Название должно содержать от 1 до 80 символов." });
        if (string.IsNullOrWhiteSpace(request.Code) || request.Code.Length > 16_384)
            return Results.BadRequest(new { error = "Код должен содержать от 1 до 16 384 символов." });
        if (request.Description?.Length > 1000) return Results.BadRequest(new { error = "Описание слишком длинное." });
        if (request.SalePrice is < 1 or > 1_000_000) return Results.BadRequest(new { error = "Цена должна быть от 1 до 1 000 000 кредитов." });
        if (request.Language is not null and not StrategyLanguages.JavaScript and not StrategyLanguages.Python)
            return Results.BadRequest(new { error = "Неизвестный язык стратегии." });
        return null;
    }
    private static string[] Tags(IEnumerable<string>? values) => values?.Select(value => value.Trim().ToLowerInvariant())
        .Where(value => value.Length is > 0 and <= 24).Distinct().Take(6).ToArray() ?? [];
    private static string NewToken() => Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
    private static object TransferView(StrategyTransfer item) => new
    {
        item.Id, item.Status, sender = new { item.Sender.Id, item.Sender.Nickname, item.Sender.AvatarUrl },
        strategy = new { item.CopyStrategy.Id, item.CopyStrategy.Name, item.CopyStrategy.Language }, item.CreatedAt
    };
}

public sealed record SaveStrategyRequest(string Name, string? Description, string? Language, string Code, string[]? Tags, long? SalePrice = null);
public sealed record PublishRequest(bool IsPaid, long? Price);
