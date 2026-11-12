using System.Security.Claims;
using Microsoft.EntityFrameworkCore;

namespace BotArena;

public static class FriendEndpoints
{
    public static void MapFriendEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/friends").RequireAuthorization();

        group.MapGet("/", async (ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (principal.UserId() is not { } userId) return Results.Unauthorized();
            var rows = await database.Friendships.AsNoTracking().Include(item => item.UserA).Include(item => item.UserB)
                .Where(item => item.UserAId == userId || item.UserBId == userId)
                .OrderByDescending(item => item.CreatedAt).ToListAsync();
            return Results.Ok(rows.Select(item => FriendView(item, userId)));
        });

        group.MapGet("/search", async (string? q, ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (principal.UserId() is not { } userId) return Results.Unauthorized();
            if (string.IsNullOrWhiteSpace(q) || q.Trim().Length < 2) return Results.Ok(Array.Empty<object>());
            var pattern = $"%{q.Trim()}%";
            var connected = database.Friendships.Where(item => item.UserAId == userId || item.UserBId == userId)
                .Select(item => item.UserAId == userId ? item.UserBId : item.UserAId);
            var users = await database.Users.AsNoTracking()
                .Where(user => user.Id != userId && user.Nickname != null && !connected.Contains(user.Id)
                    && EF.Functions.ILike(user.Nickname, pattern))
                .OrderBy(user => user.Nickname).Take(20)
                .Select(user => new { user.Id, user.Nickname, user.AvatarUrl }).ToListAsync();
            return Results.Ok(users);
        });

        group.MapPost("/{targetId:guid}", async (Guid targetId, ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (principal.UserId() is not { } userId) return Results.Unauthorized();
            if (targetId == userId) return Results.BadRequest(new { error = "Нельзя добавить в друзья самого себя." });
            if (!await database.Users.AnyAsync(user => user.Id == targetId && user.Nickname != null)) return Results.NotFound();
            var (a, b) = Pair(userId, targetId);
            var existing = await database.Friendships.Include(item => item.UserA).Include(item => item.UserB)
                .SingleOrDefaultAsync(item => item.UserAId == a && item.UserBId == b);
            if (existing is not null)
            {
                if (existing.Status == FriendshipStatus.Pending && existing.RequestedById == targetId)
                {
                    existing.Status = FriendshipStatus.Accepted;
                    existing.AcceptedAt = DateTimeOffset.UtcNow;
                    await database.SaveChangesAsync();
                    return Results.Ok(FriendView(existing, userId));
                }
                return Results.Conflict(new { error = existing.Status == FriendshipStatus.Accepted
                    ? "Пользователь уже в друзьях." : "Заявка уже отправлена." });
            }
            var friendship = new Friendship
            {
                UserAId = a, UserA = await database.Users.SingleAsync(user => user.Id == a),
                UserBId = b, UserB = await database.Users.SingleAsync(user => user.Id == b),
                RequestedById = userId
            };
            database.Friendships.Add(friendship);
            await database.SaveChangesAsync();
            return Results.Created($"/api/friends/{friendship.Id}", FriendView(friendship, userId));
        });

        group.MapPost("/{friendshipId:guid}/accept", async (Guid friendshipId, ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (principal.UserId() is not { } userId) return Results.Unauthorized();
            var friendship = await database.Friendships.Include(item => item.UserA).Include(item => item.UserB)
                .SingleOrDefaultAsync(item => item.Id == friendshipId);
            if (friendship is null) return Results.NotFound();
            if (friendship.Status != FriendshipStatus.Pending || friendship.RequestedById == userId
                || friendship.UserAId != userId && friendship.UserBId != userId) return Results.Forbid();
            friendship.Status = FriendshipStatus.Accepted;
            friendship.AcceptedAt = DateTimeOffset.UtcNow;
            await database.SaveChangesAsync();
            return Results.Ok(FriendView(friendship, userId));
        });

        group.MapDelete("/{friendshipId:guid}", async (Guid friendshipId, ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (principal.UserId() is not { } userId) return Results.Unauthorized();
            var friendship = await database.Friendships.SingleOrDefaultAsync(item => item.Id == friendshipId
                && (item.UserAId == userId || item.UserBId == userId));
            if (friendship is null) return Results.NotFound();
            database.Friendships.Remove(friendship);
            await database.SaveChangesAsync();
            return Results.NoContent();
        });

        group.MapGet("/{friendId:guid}/strategies", async (Guid friendId, ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (principal.UserId() is not { } userId) return Results.Unauthorized();
            if (!await AreFriends(database, userId, friendId)) return Results.Forbid();
            var strategies = await database.Strategies.AsNoTracking()
                .Where(item => item.OwnerId == friendId && item.Visibility == StrategyVisibility.Public && item.IsActive)
                .OrderByDescending(item => item.UpdatedAt)
                .Select(item => new { item.Id, item.Name, item.Language }).ToListAsync();
            return Results.Ok(strategies);
        });

        group.MapGet("/challenges", async (ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (principal.UserId() is not { } userId) return Results.Unauthorized();
            var items = await database.BattleChallenges.AsNoTracking()
                .Include(item => item.Challenger).Include(item => item.Opponent)
                .Include(item => item.ChallengerStrategy).Include(item => item.OpponentStrategy)
                .Where(item => item.ChallengerId == userId || item.OpponentId == userId)
                .OrderByDescending(item => item.CreatedAt).Take(50).ToListAsync();
            return Results.Ok(items.Select(item => ChallengeView(item, userId)));
        });

        group.MapPost("/{friendId:guid}/challenges", async (Guid friendId, CreateChallengeRequest request,
            ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (principal.UserId() is not { } userId) return Results.Unauthorized();
            if (!await AreFriends(database, userId, friendId)) return Results.Forbid();
            if (request.Stake is < 1 or > 100_000) return Results.BadRequest(new { error = "Ставка должна быть от 1 до 100 000 кредитов." });
            var challenger = await database.Users.SingleAsync(user => user.Id == userId);
            if (challenger.Balance < request.Stake) return Results.BadRequest(new { error = "Недостаточно кредитов для такой ставки." });
            var strategy = await database.Strategies.SingleOrDefaultAsync(item => item.Id == request.StrategyId && item.OwnerId == userId && item.IsActive);
            if (strategy is null) return Results.BadRequest(new { error = "Выберите свою сохранённую стратегию." });
            var opponent = await database.Users.SingleAsync(user => user.Id == friendId);
            var challenge = new BattleChallenge
            {
                Challenger = challenger, ChallengerId = userId, Opponent = opponent, OpponentId = friendId,
                ChallengerStrategy = strategy, ChallengerStrategyId = strategy.Id,
                ChallengerCode = strategy.Code, ChallengerLanguage = strategy.Language, Stake = request.Stake
            };
            database.BattleChallenges.Add(challenge);
            await database.SaveChangesAsync();
            return Results.Created($"/api/friends/challenges/{challenge.Id}", ChallengeView(challenge, userId));
        });

        group.MapPost("/challenges/{challengeId:guid}/accept", async (Guid challengeId, AcceptChallengeRequest request,
            ClaimsPrincipal principal, UgcDbContext database, MatchQueue queue, CancellationToken cancellation) =>
        {
            if (principal.UserId() is not { } userId) return Results.Unauthorized();
            var challenge = await database.BattleChallenges
                .Include(item => item.Challenger).Include(item => item.Opponent).Include(item => item.ChallengerStrategy)
                .SingleOrDefaultAsync(item => item.Id == challengeId && item.OpponentId == userId);
            if (challenge is null) return Results.NotFound();
            if (challenge.Status != BattleChallengeStatus.Pending) return Results.Conflict(new { error = "Вызов уже обработан." });
            var opponentStrategy = await database.Strategies.SingleOrDefaultAsync(item => item.Id == request.StrategyId && item.OwnerId == userId && item.IsActive);
            if (opponentStrategy is null) return Results.BadRequest(new { error = "Выберите свою сохранённую стратегию." });
            var stake = challenge.Stake;
            await using (var payment = await database.Database.BeginTransactionAsync(cancellation))
            {
                var claimed = await database.BattleChallenges.Where(item => item.Id == challengeId && item.Status == BattleChallengeStatus.Pending)
                    .ExecuteUpdateAsync(setters => setters
                        .SetProperty(item => item.Status, BattleChallengeStatus.Running)
                        .SetProperty(item => item.OpponentStrategyId, opponentStrategy.Id), cancellation);
                if (claimed == 0) return Results.Conflict(new { error = "Вызов уже принят или отменён." });
                var firstDebit = await Debit(database, challenge.ChallengerId, stake, cancellation);
                var secondDebit = await Debit(database, challenge.OpponentId, stake, cancellation);
                if (!firstDebit || !secondDebit)
                {
                    await payment.RollbackAsync(cancellation);
                    return Results.BadRequest(new { error = !secondDebit
                        ? "Недостаточно кредитов для принятия вызова." : "У инициатора больше недостаточно кредитов." });
                }
                database.BalanceTransactions.AddRange(
                    Ledger(challenge.Challenger, -stake, "battle_stake", challenge.Id),
                    Ledger(challenge.Opponent, -stake, "battle_stake", challenge.Id));
                await database.SaveChangesAsync(cancellation);
                await payment.CommitAsync(cancellation);
            }

            var matchRequest = new MatchRequest(challenge.ChallengerCode, "friend",
                challenge.ChallengerLanguage, opponentStrategy.Code, opponentStrategy.Language);
            if (queue.Enqueue(matchRequest, cancellation) is not { } job)
            {
                await Refund(database, challenge, "battle_queue_refund", CancellationToken.None);
                return Results.Json(new { error = "Очередь расчётов заполнена. Ставки возвращены." }, statusCode: 429);
            }
            using var registration = cancellation.Register(() => queue.CancelWaiting(job));
            MatchWorkerResult result;
            try { result = await job.Completion.Task; }
            catch
            {
                await Refund(database, challenge, "battle_cancel_refund", CancellationToken.None);
                throw;
            }
            if (result.Response is null)
            {
                await Refund(database, challenge, "battle_error_refund", CancellationToken.None);
                return Results.UnprocessableEntity(new { error = result.Error, diagnostic = result.Diagnostic });
            }

            var winner = result.Response.Replay.Result.WinnerBotId switch
            {
                "player" => challenge.ChallengerId,
                "opponent" => challenge.OpponentId,
                _ => (Guid?)null
            };
            await using var settlement = await database.Database.BeginTransactionAsync(CancellationToken.None);
            if (winner is { } winnerId)
            {
                await Credit(database, winnerId, checked(stake * 2), CancellationToken.None);
                var winnerUser = winnerId == challenge.ChallengerId ? challenge.Challenger : challenge.Opponent;
                database.BalanceTransactions.Add(Ledger(winnerUser, checked(stake * 2), "battle_prize", challenge.Id));
            }
            else
            {
                await Credit(database, challenge.ChallengerId, stake, CancellationToken.None);
                await Credit(database, challenge.OpponentId, stake, CancellationToken.None);
                database.BalanceTransactions.AddRange(
                    Ledger(challenge.Challenger, stake, "battle_draw_refund", challenge.Id),
                    Ledger(challenge.Opponent, stake, "battle_draw_refund", challenge.Id));
            }
            challenge.Status = BattleChallengeStatus.Completed;
            challenge.OpponentStrategy = opponentStrategy;
            challenge.OpponentStrategyId = opponentStrategy.Id;
            challenge.WinnerId = winner;
            challenge.CompletedAt = DateTimeOffset.UtcNow;
            challenge.ChallengerStrategy.RunCount++;
            opponentStrategy.RunCount++;
            await database.SaveChangesAsync(CancellationToken.None);
            await settlement.CommitAsync(CancellationToken.None);
            return Results.Ok(new { match = result.Response, winnerId = winner });
        });

        group.MapPost("/challenges/{challengeId:guid}/decline", async (Guid challengeId, ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (principal.UserId() is not { } userId) return Results.Unauthorized();
            var updated = await database.BattleChallenges
                .Where(item => item.Id == challengeId && item.OpponentId == userId && item.Status == BattleChallengeStatus.Pending)
                .ExecuteUpdateAsync(setters => setters.SetProperty(item => item.Status, BattleChallengeStatus.Declined));
            return updated == 0 ? Results.NotFound() : Results.NoContent();
        });

        group.MapPost("/{friendId:guid}/matches", async (Guid friendId, FriendMatchRequest request,
            ClaimsPrincipal principal, UgcDbContext database, MatchQueue queue, CancellationToken cancellation) =>
        {
            if (principal.UserId() is not { } userId) return Results.Unauthorized();
            if (!await AreFriends(database, userId, friendId)) return Results.Forbid();
            var player = await database.Strategies.SingleOrDefaultAsync(item => item.Id == request.PlayerStrategyId && item.OwnerId == userId && item.IsActive);
            var opponent = await database.Strategies.SingleOrDefaultAsync(item => item.Id == request.OpponentStrategyId
                && item.OwnerId == friendId && item.Visibility == StrategyVisibility.Public && item.IsActive);
            if (player is null || opponent is null) return Results.BadRequest(new { error = "Выберите доступные стратегии обоих игроков." });
            var available = StrategyLanguages.Available();
            if (!available.Contains(player.Language) || !available.Contains(opponent.Language))
                return Results.BadRequest(new { error = "Среда выбранного языка сейчас недоступна." });
            var matchRequest = new MatchRequest(player.Code, "friend", player.Language, opponent.Code, opponent.Language);
            if (queue.Enqueue(matchRequest, cancellation) is not { } job)
                return Results.Json(new { error = "Очередь расчётов заполнена." }, statusCode: 429);
            using var registration = cancellation.Register(() => queue.CancelWaiting(job));
            var result = await job.Completion.Task;
            if (result.Response is null) return Results.UnprocessableEntity(new { error = result.Error, diagnostic = result.Diagnostic });
            player.RunCount++; opponent.RunCount++;
            await database.SaveChangesAsync(cancellation);
            return Results.Ok(result.Response);
        });
    }

    internal static async Task<bool> AreFriends(UgcDbContext database, Guid first, Guid second)
    {
        var (a, b) = Pair(first, second);
        return await database.Friendships.AnyAsync(item => item.UserAId == a && item.UserBId == b
            && item.Status == FriendshipStatus.Accepted);
    }
    private static (Guid A, Guid B) Pair(Guid first, Guid second) => first.CompareTo(second) < 0 ? (first, second) : (second, first);
    internal static async Task<bool> Debit(UgcDbContext database, Guid userId, long amount, CancellationToken cancellation) =>
        await database.Users.Where(user => user.Id == userId && user.Balance >= amount)
            .ExecuteUpdateAsync(setters => setters.SetProperty(user => user.Balance, user => user.Balance - amount), cancellation) == 1;
    internal static Task<int> Credit(UgcDbContext database, Guid userId, long amount, CancellationToken cancellation) =>
        database.Users.Where(user => user.Id == userId)
            .ExecuteUpdateAsync(setters => setters.SetProperty(user => user.Balance, user => user.Balance + amount), cancellation);
    internal static BalanceTransaction Ledger(AppUser user, long amount, string type, Guid reference) =>
        new() { User = user, UserId = user.Id, Amount = amount, Type = type, ReferenceId = reference };
    private static async Task Refund(UgcDbContext database, BattleChallenge challenge, string type, CancellationToken cancellation)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellation);
        await Credit(database, challenge.ChallengerId, challenge.Stake, cancellation);
        await Credit(database, challenge.OpponentId, challenge.Stake, cancellation);
        database.BalanceTransactions.AddRange(
            Ledger(challenge.Challenger, challenge.Stake, type, challenge.Id),
            Ledger(challenge.Opponent, challenge.Stake, type, challenge.Id));
        challenge.Status = BattleChallengeStatus.Cancelled;
        challenge.CompletedAt = DateTimeOffset.UtcNow;
        await database.SaveChangesAsync(cancellation);
        await transaction.CommitAsync(cancellation);
    }
    private static object ChallengeView(BattleChallenge item, Guid viewerId) => new
    {
        item.Id, item.Status, item.Stake, incoming = item.OpponentId == viewerId,
        challenger = new { item.Challenger.Id, item.Challenger.Nickname, item.Challenger.AvatarUrl },
        opponent = new { item.Opponent.Id, item.Opponent.Nickname, item.Opponent.AvatarUrl },
        challengerStrategy = new { item.ChallengerStrategy.Id, item.ChallengerStrategy.Name },
        opponentStrategy = item.OpponentStrategy is null ? null : new { item.OpponentStrategy.Id, item.OpponentStrategy.Name },
        item.WinnerId, item.CreatedAt, item.CompletedAt
    };
    private static object FriendView(Friendship friendship, Guid viewerId)
    {
        var other = friendship.UserAId == viewerId ? friendship.UserB : friendship.UserA;
        var direction = friendship.Status == FriendshipStatus.Accepted ? "accepted"
            : friendship.RequestedById == viewerId ? "outgoing" : "incoming";
        return new { friendship.Id, status = direction, user = new { other.Id, other.Nickname, other.AvatarUrl } };
    }
}

public sealed record FriendMatchRequest(Guid PlayerStrategyId, Guid OpponentStrategyId);
public sealed record CreateChallengeRequest(Guid StrategyId, long Stake);
public sealed record AcceptChallengeRequest(Guid StrategyId);
