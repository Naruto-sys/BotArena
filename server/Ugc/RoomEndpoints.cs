using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace BotArena;

public static class RoomEndpoints
{
    public static void MapRoomEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/rooms").RequireAuthorization();

        group.MapGet("/", async (bool? clipboard, bool? presets, int? maxCharactersPerSecond,
            long? maxStake, UgcDbContext database) =>
        {
            var query = database.GameRooms.AsNoTracking().Include(item => item.Creator)
                .Where(item => item.Status == GameRoomStatus.Open && item.GuestId == null && !item.IsPrivate);
            if (clipboard is { } clipboardValue) query = query.Where(item => item.AllowClipboard == clipboardValue);
            if (presets is { } presetValue) query = query.Where(item => item.AllowPresetStrategies == presetValue);
            if (maxCharactersPerSecond is { } speed) query = query.Where(item => item.MaxCharactersPerSecond <= speed);
            if (maxStake is { } stake) query = query.Where(item => item.Stake <= stake);
            var rooms = await query.OrderByDescending(item => item.CreatedAt).Take(100).ToListAsync();
            return Results.Ok(rooms.Select(RoomView));
        });

        group.MapGet("/mine", async (ClaimsPrincipal principal, UgcDbContext database) =>
        {
            var rooms = await database.GameRooms.AsNoTracking().Include(item => item.Creator)
                .Where(item => (item.CreatorId == principal.UserId() || item.GuestId == principal.UserId()) &&
                    (item.Status == GameRoomStatus.Open || item.Status == GameRoomStatus.Running || item.Status == GameRoomStatus.Completed))
                .OrderByDescending(item => item.CreatedAt).ToListAsync();
            return Results.Ok(rooms.Select(RoomView));
        });

        group.MapGet("/{id:guid}", async (Guid id, int? afterMatchRoundNumber, ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (principal.UserId() is not { } userId) return Results.Unauthorized();
            var room = await database.GameRooms.AsNoTracking().Include(item => item.Creator).Include(item => item.Participants)
                .SingleOrDefaultAsync(item => item.Id == id && (item.CreatorId == userId || item.GuestId == userId));
            if (room is null) return Results.NotFound();
            var matchRoundNumber = room.MatchRoundNumber ?? (room.MatchResultJson is null ? (int?)null : room.RoundNumber);
            var match = room.MatchResultJson is null || matchRoundNumber <= afterMatchRoundNumber
                ? null : JsonSerializer.Deserialize<MatchResponse>(room.MatchResultJson);
            var own = room.Participants.SingleOrDefault(item => item.UserId == userId);
            return Results.Ok(new { room = RoomView(room), match, matchRoundNumber, room.WinnerId, readyCount = room.Participants.Count(item => item.IsReady), draft = own is null ? null : new { own.Code, own.Language, own.SourceStrategyId, own.IsReady } });
        });

        group.MapPost("/", async (CreateRoomRequest request, ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (principal.UserId() is not { } userId) return Results.Unauthorized();
            if (ValidateSettings(request.Name, request.MaxCharactersPerSecond, request.Stake) is { } error) return error;
            if (request.IsPrivate && (string.IsNullOrWhiteSpace(request.Password) || request.Password.Length is < 4 or > 128))
                return Results.BadRequest(new { error = "Для приватной комнаты задайте пароль от 4 до 128 символов." });
            // Serialize creates for the same account, including simultaneous browser tabs.
            await using var creation = await database.Database.BeginTransactionAsync();
            var creator = await database.Users.FromSqlInterpolated($"SELECT * FROM users WHERE \"Id\" = {userId} FOR UPDATE").SingleAsync();
            if (await database.GameRooms.AnyAsync(item => item.CreatorId == userId &&
                (item.Status == GameRoomStatus.Open || item.Status == GameRoomStatus.Running)))
                return Results.Conflict(new { error = "У вас уже есть активная комната. Откройте её или закройте перед созданием новой." });
            if (creator.Balance < request.Stake) return Results.BadRequest(new { error = "Недостаточно кредитов для ставки комнаты." });
            BattleMap? battleMap = null;
            if (request.MapId is { } mapId)
            {
                battleMap = await database.BattleMaps.AsNoTracking()
                    .SingleOrDefaultAsync(item => item.Id == mapId && item.OwnerId == userId);
                if (battleMap is null) return Results.BadRequest(new { error = "Выберите существующую личную карту." });
            }
            var room = new GameRoom
            {
                Name = request.Name.Trim(), Creator = creator, CreatorId = creator.Id, IsPrivate = request.IsPrivate,
                AllowClipboard = request.AllowClipboard, AllowPresetStrategies = request.AllowPresetStrategies,
                MaxCharactersPerSecond = request.MaxCharactersPerSecond, Stake = request.Stake,
                MapName = battleMap?.Name, ArenaJson = battleMap?.WallsJson
            };
            if (room.IsPrivate) room.PasswordHash = new PasswordHasher<GameRoom>().HashPassword(room, request.Password!);
            room.Participants.Add(new() { Room = room, User = creator, UserId = creator.Id });
            database.GameRooms.Add(room);
            await database.SaveChangesAsync();
            await creation.CommitAsync();
            return Results.Created($"/api/rooms/{room.Id}", RoomView(room));
        });

        group.MapPost("/{id:guid}/join", async (Guid id, JoinRoomRequest? request, ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (principal.UserId() is not { } userId) return Results.Unauthorized();
            var room = await database.GameRooms.AsNoTracking().Include(item => item.Creator)
                .SingleOrDefaultAsync(item => item.Id == id);
            if (room is null || room.Status != GameRoomStatus.Open || room.GuestId != null) return Results.Conflict(new { error = "Комната уже занята или закрыта." });
            if (room.CreatorId == userId) return Results.BadRequest(new { error = "Создатель уже находится в комнате." });
            if (room.IsPrivate && (room.PasswordHash is null || string.IsNullOrEmpty(request?.Password)
                || request.Password.Length > 128 || new PasswordHasher<GameRoom>().VerifyHashedPassword(room, room.PasswordHash, request.Password) == PasswordVerificationResult.Failed))
                return Results.Json(new { error = "Неверный пароль комнаты." }, statusCode: StatusCodes.Status403Forbidden);
            var guest = await database.Users.SingleAsync(user => user.Id == userId);
            if (guest.Balance < room.Stake) return Results.BadRequest(new { error = "Недостаточно кредитов для входа в комнату." });
            await using var transaction = await database.Database.BeginTransactionAsync();
            var claimed = await database.GameRooms.Where(item => item.Id == id && item.Status == GameRoomStatus.Open && item.GuestId == null)
                .ExecuteUpdateAsync(setters => setters.SetProperty(item => item.GuestId, guest.Id));
            if (claimed == 0) return Results.Conflict(new { error = "Комнату уже занял другой игрок." });
            database.RoomParticipants.Add(new() { Room = null!, RoomId = room.Id, User = guest, UserId = guest.Id });
            await database.SaveChangesAsync(); await transaction.CommitAsync();
            room.GuestId = guest.Id;
            return Results.Ok(RoomView(room));
        });

        group.MapPut("/{id:guid}/draft", async (Guid id, RoomDraftRequest request, ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (principal.UserId() is not { } userId) return Results.Unauthorized();
            await using var editing = await database.Database.BeginTransactionAsync();
            var room = await LockRoom(database, id);
            if (room is null || (room.CreatorId != userId && room.GuestId != userId)) return Results.NotFound();
            if (room.RoundNumber != request.RoundNumber) return StaleRound();
            var participant = await database.RoomParticipants.Include(item => item.Room)
                .SingleOrDefaultAsync(item => item.RoomId == id && item.UserId == userId);
            if (participant is null) return Results.NotFound();
            if (participant.Room.Status != GameRoomStatus.Open || participant.IsReady)
                return Results.Conflict(new { error = "Редактирование кода уже закрыто." });
            if (request.StrategyId is { } strategyId)
            {
                if (!participant.Room.AllowPresetStrategies)
                    return Results.BadRequest(new { error = "В этой комнате запрещены сохранённые стратегии." });
                var strategy = await database.Strategies.AsNoTracking().SingleOrDefaultAsync(item => item.Id == strategyId
                    && item.OwnerId == userId && item.IsActive && !item.IsPendingTransfer);
                if (strategy is null) return Results.BadRequest(new { error = "Выберите активную сохранённую стратегию." });
                participant.Code = strategy.Code; participant.Language = strategy.Language; participant.SourceStrategyId = strategy.Id;
            }
            else
            {
                if (string.IsNullOrWhiteSpace(request.Code) || request.Code.Length > 16_384)
                    return Results.BadRequest(new { error = "Код должен содержать от 1 до 16 384 символов." });
                if (request.Language is not StrategyLanguages.JavaScript and not StrategyLanguages.Python)
                    return Results.BadRequest(new { error = "Неизвестный язык стратегии." });
                var now = DateTimeOffset.UtcNow;
                if (now - participant.RateWindowStartedAt >= TimeSpan.FromSeconds(1))
                {
                    participant.RateWindowStartedAt = now;
                    participant.CharactersInWindow = 0;
                }
                var cost = ChangedCharacters(participant.Code, request.Code);
                if (!participant.Room.AllowClipboard && cost > 1)
                    return Results.BadRequest(new { error = "В этой комнате массовая вставка и вырезание запрещены." });
                if (participant.CharactersInWindow + cost > participant.Room.MaxCharactersPerSecond)
                    return Results.Json(new { error = "Превышено ограничение комнаты на ввод символов в секунду." }, statusCode: 429);
                participant.CharactersInWindow += cost;
                participant.Code = request.Code; participant.Language = request.Language; participant.SourceStrategyId = null;
            }
            await database.SaveChangesAsync();
            await editing.CommitAsync();
            return Results.Ok(new { participant.Code, participant.Language, participant.IsReady });
        });

        // Upgrade old one-shot rooms on demand; never reopen a cancelled room.
        group.MapPost("/{id:guid}/next-round", async (Guid id, RoomRoundRequest request, ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (principal.UserId() is not { } userId) return Results.Unauthorized();
            await using var reopening = await database.Database.BeginTransactionAsync();
            var room = await LockRoom(database, id);
            if (room is null || (room.CreatorId != userId && room.GuestId != userId)) return Results.NotFound();
            if (room.RoundNumber != request.RoundNumber) return StaleRound();
            await database.Entry(room).Reference(item => item.Creator).LoadAsync();
            if (room.Status == GameRoomStatus.Open) return Results.Ok(RoomView(room));
            if (room.Status != GameRoomStatus.Completed) return Results.Conflict(new { error = "Дождитесь завершения раунда." });
            // Same account lock as room creation: reopening cannot bypass the one-active-room limit.
            await database.Users.FromSqlInterpolated($"SELECT * FROM users WHERE \"Id\" = {room.CreatorId} FOR UPDATE").SingleAsync();
            if (await database.GameRooms.AnyAsync(item => item.Id != id && item.CreatorId == room.CreatorId &&
                (item.Status == GameRoomStatus.Open || item.Status == GameRoomStatus.Running)))
                return Results.Conflict(new { error = "У создателя уже есть другая активная комната. Сначала закройте её." });
            await database.Entry(room).Reference(item => item.Creator).LoadAsync();
            await database.Entry(room).Collection(item => item.Participants).LoadAsync();
            room.MatchRoundNumber ??= room.MatchResultJson is null ? null : room.RoundNumber;
            BeginNextRound(room);
            await database.SaveChangesAsync(); await reopening.CommitAsync();
            return Results.Ok(RoomView(room));
        });

        group.MapPost("/{id:guid}/ready", async (Guid id, RoomRoundRequest? request, ClaimsPrincipal principal, UgcDbContext database,
            MatchQueue queue, CancellationToken cancellation) =>
        {
            if (principal.UserId() is not { } userId) return Results.Unauthorized();
            GameRoom room;
            await using (var payment = await database.Database.BeginTransactionAsync(cancellation))
            {
                // Serialize draft/ready/round transitions on the room row, not just launch claiming.
                var locked = await LockRoom(database, id, cancellation);
                if (locked is null || locked.Status != GameRoomStatus.Open) return Results.Conflict(new { error = "Комната уже закрыта или рассчитывается." });
                room = locked;
                if (room.RoundNumber != (request?.RoundNumber ?? 1)) return StaleRound();
                await database.Entry(room).Collection(item => item.Participants).Query().Include(item => item.User).LoadAsync(cancellation);
                var participant = room.Participants.SingleOrDefault(item => item.UserId == userId);
                if (participant is null) return Results.Forbid();
                if (participant.IsReady) return Results.Ok(new { waiting = true, room.RoundNumber });
                var validation = StrategyValidator.Validate(participant.Language, participant.Code);
                if (!validation.Active) return Results.BadRequest(new { error = validation.Error ?? "Стратегия неактивна." });
                participant.IsReady = true;
                if (room.GuestId is null || room.Participants.Count != 2 || room.Participants.Any(item => !item.IsReady))
                {
                    await database.SaveChangesAsync(cancellation); await payment.CommitAsync(cancellation);
                    return Results.Ok(new { waiting = true, room.RoundNumber });
                }
                // Lock balances in a stable order even if users occupy several different rooms.
                foreach (var player in room.Participants.OrderBy(item => item.UserId))
                    if (!await FriendEndpoints.Debit(database, player.UserId, room.Stake, cancellation))
                        return Results.BadRequest(new { error = "У одного из игроков недостаточно кредитов для ставки." });
                room.Status = GameRoomStatus.Running;
                database.BalanceTransactions.AddRange(room.Participants.Select(player =>
                    FriendEndpoints.Ledger(player.User, -room.Stake, "room_stake", room.Id)));
                await database.SaveChangesAsync(cancellation); await payment.CommitAsync(cancellation);
            }

            // Once stakes are committed, finish the match even if the browser disconnects.
            // ExecuteUpdate bypasses tracked entities; reload the winning launch request with fresh drafts.
            database.ChangeTracker.Clear();
            room = await database.GameRooms.Include(item => item.Creator).Include(item => item.Guest)
                .Include(item => item.Participants).ThenInclude(item => item.User)
                .SingleAsync(item => item.Id == id, CancellationToken.None);
            var activeGuestId = room.GuestId ?? throw new InvalidOperationException("Running room has no guest.");

            var creator = room.Participants.Single(item => item.UserId == room.CreatorId);
            var guest = room.Participants.Single(item => item.UserId == room.GuestId);
            ArenaState? customArena = null;
            if (room.ArenaJson is { } arenaJson)
            {
                var walls = JsonSerializer.Deserialize<List<Wall>>(arenaJson, BattleMapEndpoints.Json) ?? [];
                customArena = BattleMapEndpoints.Arena(walls);
            }
            var matchRequest = new MatchRequest(creator.Code, "room", creator.Language, guest.Code, guest.Language,
                CustomArena: customArena);
            if (queue.Enqueue(matchRequest, CancellationToken.None) is not { } job)
            {
                await Refund(database, room, "room_queue_refund");
                return Results.Json(new { error = "Очередь заполнена. Ставки возвращены." }, statusCode: 429);
            }
            MatchWorkerResult result;
            try { result = await job.Completion.Task; }
            catch { await Refund(database, room, "room_cancel_refund"); throw; }
            if (result.Response is null)
            {
                await Refund(database, room, "room_error_refund");
                return Results.UnprocessableEntity(new { error = result.Error });
            }
            var winnerId = result.Response.Replay.Result.WinnerBotId switch
            {
                "player" => room.CreatorId,
                "opponent" => room.GuestId,
                _ => null
            };
            await using var settlement = await database.Database.BeginTransactionAsync(CancellationToken.None);
            if (winnerId is { } winner)
            {
                await FriendEndpoints.Credit(database, winner, checked(room.Stake * 2), CancellationToken.None);
                var winnerUser = winner == room.CreatorId ? room.Creator : room.Guest!;
                database.BalanceTransactions.Add(FriendEndpoints.Ledger(winnerUser, checked(room.Stake * 2), "room_prize", room.Id));
            }
            else
            {
                await FriendEndpoints.Credit(database, room.CreatorId, room.Stake, CancellationToken.None);
                await FriendEndpoints.Credit(database, activeGuestId, room.Stake, CancellationToken.None);
                database.BalanceTransactions.AddRange(
                    FriendEndpoints.Ledger(room.Creator, room.Stake, "room_draw_refund", room.Id),
                    FriendEndpoints.Ledger(room.Guest!, room.Stake, "room_draw_refund", room.Id));
            }
            var completedRoundNumber = room.RoundNumber;
            room.WinnerId = winnerId; room.MatchRoundNumber = completedRoundNumber;
            room.MatchResultJson = JsonSerializer.Serialize(result.Response); room.CompletedAt = DateTimeOffset.UtcNow;
            BeginNextRound(room);
            await database.SaveChangesAsync(CancellationToken.None); await settlement.CommitAsync(CancellationToken.None);
            return Results.Ok(new { waiting = false, match = result.Response, winnerId, roundNumber = completedRoundNumber });
        });

        group.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal principal, UgcDbContext database) =>
        {
            var updated = await database.GameRooms.Where(item => item.Id == id && item.CreatorId == principal.UserId()
                    && item.Status == GameRoomStatus.Open)
                .ExecuteUpdateAsync(setters => setters.SetProperty(item => item.Status, GameRoomStatus.Cancelled));
            return updated == 0 ? Results.NotFound() : Results.NoContent();
        });
    }

    private static Task<GameRoom?> LockRoom(UgcDbContext database, Guid id, CancellationToken cancellation = default) =>
        database.GameRooms.FromSqlInterpolated($"SELECT * FROM game_rooms WHERE \"Id\" = {id} FOR UPDATE").SingleOrDefaultAsync(cancellation);

    private static IResult StaleRound() => Results.Conflict(new { error = "Раунд уже изменился. Обновите состояние комнаты и подтвердите готовность заново." });

    private static void BeginNextRound(GameRoom room)
    {
        room.Status = GameRoomStatus.Open;
        room.RoundNumber = checked(room.RoundNumber + 1);
        foreach (var player in room.Participants)
        {
            player.IsReady = false;
            player.CharactersInWindow = 0;
            player.RateWindowStartedAt = DateTimeOffset.UtcNow;
        }
    }

    private static IResult? ValidateSettings(string? name, int speed, long stake)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Trim().Length > 80)
            return Results.BadRequest(new { error = "Название комнаты должно содержать от 1 до 80 символов." });
        if (speed is < 1 or > 1_000) return Results.BadRequest(new { error = "Ограничение ввода должно быть от 1 до 1000 символов в секунду." });
        if (stake is < 0 or > 100_000) return Results.BadRequest(new { error = "Ставка должна быть от 0 до 100 000 кредитов." });
        return null;
    }
    internal static int ChangedCharacters(string previous, string current)
    {
        var prefix = 0;
        while (prefix < previous.Length && prefix < current.Length && previous[prefix] == current[prefix]) prefix++;
        var suffix = 0;
        while (suffix < previous.Length - prefix && suffix < current.Length - prefix
            && previous[^(suffix + 1)] == current[^(suffix + 1)]) suffix++;
        var removed = Math.Max(0, previous.Length - prefix - suffix);
        var inserted = Math.Max(0, current.Length - prefix - suffix);
        return Math.Max(removed, inserted);
    }
    private static object RoomView(GameRoom room) => new
    {
        room.Id, room.Name, creator = new { room.Creator.Id, room.Creator.Nickname, room.Creator.AvatarUrl },
        room.AllowClipboard, room.AllowPresetStrategies, room.MaxCharactersPerSecond, room.Stake, room.IsPrivate,
        mapName = room.MapName ?? "Классическая арена",
        arena = room.ArenaJson is null ? MatchConfig.Classic.Arena : BattleMapEndpoints.Arena(
            JsonSerializer.Deserialize<List<Wall>>(room.ArenaJson, BattleMapEndpoints.Json) ?? []),
        room.Status, room.RoundNumber, occupied = room.GuestId != null, room.CreatedAt
    };
    private static async Task Refund(UgcDbContext database, GameRoom room, string type)
    {
        await using var transaction = await database.Database.BeginTransactionAsync();
        await FriendEndpoints.Credit(database, room.CreatorId, room.Stake, CancellationToken.None);
        await FriendEndpoints.Credit(database, room.GuestId!.Value, room.Stake, CancellationToken.None);
        database.BalanceTransactions.AddRange(
            FriendEndpoints.Ledger(room.Creator, room.Stake, type, room.Id),
            FriendEndpoints.Ledger(room.Guest!, room.Stake, type, room.Id));
        room.Status = GameRoomStatus.Cancelled; room.CompletedAt = DateTimeOffset.UtcNow;
        await database.SaveChangesAsync(); await transaction.CommitAsync();
    }
}

public sealed record CreateRoomRequest(
    string Name, bool AllowClipboard, bool AllowPresetStrategies, int MaxCharactersPerSecond, long Stake, Guid? MapId = null, bool IsPrivate = false, string? Password = null);
public sealed record RoomDraftRequest(string Code, string Language, Guid? StrategyId = null, int RoundNumber = 1);
public sealed record RoomRoundRequest(int RoundNumber);

public sealed record JoinRoomRequest(string? Password);
