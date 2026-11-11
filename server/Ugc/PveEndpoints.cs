using System.Security.Claims;
using Microsoft.EntityFrameworkCore;

namespace BotArena;

public static class PveEndpoints
{
    public static void MapPveEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/pve").RequireAuthorization();

        group.MapGet("/", async (ClaimsPrincipal principal, UgcDbContext database) =>
        {
            if (principal.UserId() is not { } userId) return Results.Unauthorized();
            var progressItems = await database.PveLevelProgress.AsNoTracking()
                .Where(item => item.UserId == userId).ToListAsync();
            var progress = progressItems.ToDictionary(item => item.LevelId, StringComparer.Ordinal);
            var completed = progressItems.Where(item => item.CompletedAt != null)
                .Select(item => item.LevelId).ToHashSet(StringComparer.Ordinal);
            return Results.Ok(new
            {
                completed = completed.Count, total = PveCatalog.Levels.Count,
                blocks = PveCatalog.Blocks.Select(block => new
                {
                    block.Id, block.Order, block.Title, block.Description, block.IsTraining,
                    completed = block.Levels.Count(level => completed.Contains(level.Id)), total = block.Levels.Count,
                    locked = block.Levels[0].Order > 1 && !completed.Contains(PveCatalog.Levels[block.Levels[0].Order - 2].Id),
                    levels = block.Levels.Select(level => View(level, progress.GetValueOrDefault(level.Id),
                        level.Order > 1 && !completed.Contains(PveCatalog.Levels[level.Order - 2].Id)))
                })
            });
        });

        group.MapGet("/levels/{id}/leaderboard", async (string id, UgcDbContext database) =>
        {
            if (!PveCatalog.TryGet(id, out var level)) return Results.NotFound();
            if (level.IsTraining) return Results.Ok(new { enabled = false, entries = Array.Empty<object>() });
            var items = await database.PveLevelProgress.AsNoTracking().Include(item => item.User)
                .Where(item => item.LevelId == id && item.CompletedAt != null && item.BestDurationTicks != null)
                .OrderBy(item => item.BestDurationTicks).ThenBy(item => item.LowestDamageTaken)
                .ThenBy(item => item.CompletedAt).Take(50).ToListAsync();
            return Results.Ok(new
            {
                enabled = true,
                entries = items.Select((item, index) => new
                {
                    rank = index + 1,
                    user = new { item.User.Id, item.User.Nickname, item.User.AvatarUrl },
                    durationSeconds = Math.Round(item.BestDurationTicks!.Value / (double)level.Config.TickRate, 2),
                    damageTaken = item.LowestDamageTaken ?? 0, item.Attempts, item.CompletedAt
                })
            });
        });

        group.MapPost("/levels/{id}/attempt", async (string id, PveAttemptRequest request, ClaimsPrincipal principal,
            UgcDbContext database, MatchQueue queue, CancellationToken cancellation) =>
        {
            if (principal.UserId() is not { } userId) return Results.Unauthorized();
            if (!PveCatalog.TryGet(id, out var level)) return Results.NotFound();
            if (string.IsNullOrWhiteSpace(request.Code) || request.Code.Length > 16_384)
                return Results.BadRequest(new { error = "Код должен содержать от 1 до 16 384 символов." });
            if (request.Language is not StrategyLanguages.JavaScript and not StrategyLanguages.Python)
                return Results.BadRequest(new { error = "Неизвестный язык стратегии." });
            var previous = level.Order > 1 ? PveCatalog.Levels[level.Order - 2] : null;
            if (previous is not null && !await database.PveLevelProgress.AnyAsync(item =>
                    item.UserId == userId && item.LevelId == previous.Id && item.CompletedAt != null, cancellation))
                return Results.BadRequest(new { error = "Сначала пройдите предыдущий подуровень." });

            var matchRequest = new MatchRequest(request.Code, "pve-opponent", request.Language,
                level.OpponentCode, StrategyLanguages.JavaScript, level.Id);
            if (queue.Enqueue(matchRequest, cancellation) is not { } job)
                return Results.Json(new { error = "Очередь расчётов заполнена." }, statusCode: 429);
            using var registration = cancellation.Register(() => queue.CancelWaiting(job));
            var result = await job.Completion.Task;
            if (result.Response is null)
                return Results.UnprocessableEntity(new { error = result.Error, diagnostic = result.Diagnostic });

            var techniquePassed = TechniquePassed(level, result.Response.Replay);
            var won = result.Response.Replay.Result.WinnerBotId == "player" && result.Response.Error?.BotId != "player";
            var completed = won && techniquePassed;
            var finalPlayer = result.Response.Replay.Frames[^1].Bots.Single(bot => bot.Id == "player");
            var durationTicks = result.Response.Replay.Result.DurationTicks;
            var damageTaken = finalPlayer.MaxHp - finalPlayer.Hp;
            var rewardAwarded = 0L;

            await using var transaction = await database.Database.BeginTransactionAsync(cancellation);
            var progress = await database.PveLevelProgress.SingleOrDefaultAsync(item =>
                item.UserId == userId && item.LevelId == level.Id, cancellation);
            if (progress is null)
            {
                var user = await database.Users.SingleAsync(item => item.Id == userId, cancellation);
                progress = new() { User = user, UserId = userId, LevelId = level.Id, Reward = level.Reward };
                database.PveLevelProgress.Add(progress);
                // The row must exist before the conditional completion claim below.
                await database.SaveChangesAsync(cancellation);
            }
            progress.Attempts++;
            progress.LastDurationTicks = durationTicks;
            progress.LastDamageTaken = damageTaken;
            if (completed)
            {
                progress.BestDurationTicks = progress.BestDurationTicks is null
                    ? durationTicks : Math.Min(progress.BestDurationTicks.Value, durationTicks);
                progress.LowestDamageTaken = progress.LowestDamageTaken is null
                    ? damageTaken : Math.Min(progress.LowestDamageTaken.Value, damageTaken);
                if (progress.CompletedAt is null)
                {
                    var completedAt = DateTimeOffset.UtcNow;
                    var claimed = await database.PveLevelProgress
                        .Where(item => item.Id == progress.Id && item.CompletedAt == null)
                        .ExecuteUpdateAsync(setters => setters.SetProperty(item => item.CompletedAt, completedAt), cancellation);
                    if (claimed == 1)
                    {
                        progress.CompletedAt = completedAt;
                        var credited = await FriendEndpoints.Credit(database, userId, level.Reward, cancellation);
                        if (credited != 1) throw new InvalidOperationException("PvE reward recipient no longer exists.");
                        var user = await database.Users.SingleAsync(item => item.Id == userId, cancellation);
                        database.BalanceTransactions.Add(new()
                        {
                            User = user, UserId = userId, Amount = level.Reward,
                            Type = "pve_level_reward", ReferenceId = progress.Id
                        });
                        rewardAwarded = level.Reward;
                    }
                }
            }
            await database.SaveChangesAsync(cancellation);
            await transaction.CommitAsync(cancellation);

            return Results.Ok(new
            {
                match = result.Response, completed, techniquePassed, won, rewardAwarded,
                stats = Stats(progress, level.Config.TickRate),
                message = completed ? (level.IsTraining ? "Урок пройден! Следующий урок открыт." : "Испытание пройдено! Результат добавлен в таблицу.")
                    : !techniquePassed ? "Бой завершён, но изучаемый приём не выполнен. Открой подсказку и попробуй ещё раз."
                    : "Противник не побеждён. Измени алгоритм и повтори попытку."
            });
        });
    }

    private static object View(PveLevel level, PveLevelProgress? progress, bool locked) => new
    {
        level.Id, level.Order, level.BlockId, level.BlockOrder, level.Stage, level.IsTraining,
        level.Title, level.Command, level.Description, level.Goal, level.Hints, level.Reward,
        starterCode = new { javascript = level.JavaScriptStarter, python = level.PythonStarter },
        solutionCode = new { javascript = level.JavaScriptSolution, python = level.PythonSolution },
        completed = progress?.CompletedAt != null, locked,
        stats = progress is null ? null : Stats(progress, level.Config.TickRate)
    };

    private static object Stats(PveLevelProgress progress, int tickRate) => new
    {
        progress.Attempts,
        bestDurationSeconds = progress.BestDurationTicks is null ? (double?)null : Math.Round(progress.BestDurationTicks.Value / (double)tickRate, 2),
        lowestDamageTaken = progress.LowestDamageTaken,
        lastDurationSeconds = progress.LastDurationTicks is null ? (double?)null : Math.Round(progress.LastDurationTicks.Value / (double)tickRate, 2),
        lastDamageTaken = progress.LastDamageTaken
    };

    internal static bool TechniquePassed(PveLevel level, MatchReplay replay)
    {
        if (level.Technique == PveTechnique.Victory) return true;
        var playerFrames = replay.Frames.Select(frame => frame.Bots.Single(bot => bot.Id == "player")).ToArray();
        var start = playerFrames[0];
        var hits = replay.Frames.SelectMany(frame => frame.Events)
            .Count(item => item.Type == GameEventType.BotHit && item.SourceBotId == "player");
        var shots = replay.Frames.SelectMany(frame => frame.Events)
            .Count(item => item.Type == GameEventType.ShotFired && item.SourceBotId == "player");
        var displacement = playerFrames.Max(bot => Math.Sqrt(
            Math.Pow(bot.Position.X - start.Position.X, 2) + Math.Pow(bot.Position.Y - start.Position.Y, 2)));
        return level.Technique switch
        {
            PveTechnique.LeftTrack => playerFrames.Max(bot => AngleFrom(start.BodyAngle, bot.BodyAngle)) > 0.35,
            PveTechnique.RightTrack => playerFrames.Min(bot => AngleFrom(start.BodyAngle, bot.BodyAngle)) < -0.35,
            PveTechnique.AimDirection => hits > 0,
            PveTechnique.Shoot => shots > 0,
            PveTechnique.Combined => displacement > 0.8 && hits > 0 && shots > 0,
            _ => false
        };
    }

    private static double AngleFrom(double start, double current) => Math.Atan2(Math.Sin(current - start), Math.Cos(current - start));
}

public sealed record PveAttemptRequest(string Code, string Language);
