using Microsoft.EntityFrameworkCore;

namespace BotArena;

public sealed class UgcDbContext(DbContextOptions<UgcDbContext> options) : DbContext(options)
{
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<OAuthIdentity> OAuthIdentities => Set<OAuthIdentity>();
    public DbSet<UserStrategy> Strategies => Set<UserStrategy>();
    public DbSet<UserStrategyVersion> StrategyVersions => Set<UserStrategyVersion>();
    public DbSet<ManeuverSnippet> Maneuvers => Set<ManeuverSnippet>();
    public DbSet<Friendship> Friendships => Set<Friendship>();
    public DbSet<StrategyPurchase> StrategyPurchases => Set<StrategyPurchase>();
    public DbSet<BalanceTransaction> BalanceTransactions => Set<BalanceTransaction>();
    public DbSet<BattleChallenge> BattleChallenges => Set<BattleChallenge>();
    public DbSet<StrategyTransfer> StrategyTransfers => Set<StrategyTransfer>();
    public DbSet<GameRoom> GameRooms => Set<GameRoom>();
    public DbSet<RoomParticipant> RoomParticipants => Set<RoomParticipant>();
    public DbSet<PveLevelProgress> PveLevelProgress => Set<PveLevelProgress>();
    public DbSet<BattleMap> BattleMaps => Set<BattleMap>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var users = modelBuilder.Entity<AppUser>();
        users.ToTable("users");
        users.HasKey(user => user.Id);
        users.HasIndex(user => user.YandexId).IsUnique();
        users.HasIndex(user => user.GitHubId).IsUnique();
        users.HasIndex(user => user.NormalizedLogin).IsUnique();
        users.HasIndex(user => user.NormalizedNickname).IsUnique();
        users.Property(user => user.YandexId).HasMaxLength(64);
        users.Property(user => user.GitHubId).HasMaxLength(64);
        users.Property(user => user.Login).HasMaxLength(40);
        users.Property(user => user.NormalizedLogin).HasMaxLength(40);
        users.Property(user => user.PasswordHash).HasMaxLength(500);
        users.Property(user => user.FirstName).HasMaxLength(100);
        users.Property(user => user.LastName).HasMaxLength(100);
        users.Property(user => user.Nickname).HasMaxLength(24);
        users.Property(user => user.NormalizedNickname).HasMaxLength(24);
        users.Property(user => user.AvatarUrl).HasMaxLength(500);
        users.Property(user => user.Balance).HasDefaultValue(1_000L);

        var oauthIdentities = modelBuilder.Entity<OAuthIdentity>();
        oauthIdentities.ToTable("oauth_identities");
        oauthIdentities.HasKey(item => item.Id);
        oauthIdentities.HasIndex(item => new { item.Provider, item.Subject }).IsUnique();
        oauthIdentities.HasIndex(item => new { item.UserId, item.Provider }).IsUnique();
        oauthIdentities.Property(item => item.Provider).HasMaxLength(40);
        oauthIdentities.Property(item => item.Subject).HasMaxLength(200);
        oauthIdentities.HasOne(item => item.User).WithMany(user => user.OAuthIdentities)
            .HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.Cascade);

        var friendships = modelBuilder.Entity<Friendship>();
        friendships.ToTable("friendships");
        friendships.HasKey(friendship => friendship.Id);
        friendships.HasIndex(friendship => new { friendship.UserAId, friendship.UserBId }).IsUnique();
        friendships.Property(friendship => friendship.Status).HasConversion<string>().HasMaxLength(16);
        friendships.HasOne(friendship => friendship.UserA).WithMany()
            .HasForeignKey(friendship => friendship.UserAId).OnDelete(DeleteBehavior.Cascade);
        friendships.HasOne(friendship => friendship.UserB).WithMany()
            .HasForeignKey(friendship => friendship.UserBId).OnDelete(DeleteBehavior.Cascade);

        var purchases = modelBuilder.Entity<StrategyPurchase>();
        purchases.ToTable("strategy_purchases");
        purchases.HasKey(purchase => purchase.Id);
        purchases.HasIndex(purchase => new { purchase.StrategyId, purchase.BuyerId }).IsUnique();
        purchases.HasOne(purchase => purchase.Strategy).WithMany().HasForeignKey(purchase => purchase.StrategyId)
            .OnDelete(DeleteBehavior.Restrict);
        purchases.HasOne(purchase => purchase.Buyer).WithMany().HasForeignKey(purchase => purchase.BuyerId)
            .OnDelete(DeleteBehavior.Cascade);

        var transfers = modelBuilder.Entity<StrategyTransfer>();
        transfers.ToTable("strategy_transfers");
        transfers.HasKey(item => item.Id);
        transfers.HasIndex(item => new { item.RecipientId, item.Status });
        transfers.Property(item => item.Status).HasConversion<string>().HasMaxLength(16);
        transfers.HasOne(item => item.Sender).WithMany().HasForeignKey(item => item.SenderId).OnDelete(DeleteBehavior.Restrict);
        transfers.HasOne(item => item.Recipient).WithMany().HasForeignKey(item => item.RecipientId).OnDelete(DeleteBehavior.Restrict);
        transfers.HasOne(item => item.SourceStrategy).WithMany().HasForeignKey(item => item.SourceStrategyId).OnDelete(DeleteBehavior.Restrict);
        transfers.HasOne(item => item.CopyStrategy).WithMany().HasForeignKey(item => item.CopyStrategyId).OnDelete(DeleteBehavior.Restrict);

        var ledger = modelBuilder.Entity<BalanceTransaction>();
        ledger.ToTable("balance_transactions");
        ledger.HasKey(item => item.Id);
        ledger.HasIndex(item => new { item.UserId, item.CreatedAt });
        ledger.Property(item => item.Type).HasMaxLength(40);
        ledger.HasOne(item => item.User).WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.Cascade);

        var challenges = modelBuilder.Entity<BattleChallenge>();
        challenges.ToTable("battle_challenges");
        challenges.HasKey(item => item.Id);
        challenges.HasIndex(item => new { item.OpponentId, item.Status });
        challenges.Property(item => item.Status).HasConversion<string>().HasMaxLength(16);
        challenges.Property(item => item.ChallengerCode).HasMaxLength(16_384);
        challenges.Property(item => item.ChallengerLanguage).HasMaxLength(20);
        challenges.HasOne(item => item.Challenger).WithMany().HasForeignKey(item => item.ChallengerId)
            .OnDelete(DeleteBehavior.Restrict);
        challenges.HasOne(item => item.Opponent).WithMany().HasForeignKey(item => item.OpponentId)
            .OnDelete(DeleteBehavior.Restrict);
        challenges.HasOne(item => item.ChallengerStrategy).WithMany().HasForeignKey(item => item.ChallengerStrategyId)
            .OnDelete(DeleteBehavior.Restrict);
        challenges.HasOne(item => item.OpponentStrategy).WithMany().HasForeignKey(item => item.OpponentStrategyId)
            .OnDelete(DeleteBehavior.Restrict);

        var rooms = modelBuilder.Entity<GameRoom>();
        rooms.ToTable("game_rooms");
        rooms.HasKey(item => item.Id);
        rooms.HasIndex(item => new { item.Status, item.CreatedAt });
        rooms.Property(item => item.Name).HasMaxLength(80);
        rooms.Property(item => item.MapName).HasMaxLength(80);
        rooms.Property(item => item.ArenaJson).HasMaxLength(8_192);
        rooms.Property(item => item.Status).HasConversion<string>().HasMaxLength(16);
        rooms.HasOne(item => item.Creator).WithMany().HasForeignKey(item => item.CreatorId).OnDelete(DeleteBehavior.Restrict);
        rooms.HasOne(item => item.Guest).WithMany().HasForeignKey(item => item.GuestId).OnDelete(DeleteBehavior.Restrict);

        var maps = modelBuilder.Entity<BattleMap>();
        maps.ToTable("battle_maps");
        maps.HasKey(item => item.Id);
        maps.HasIndex(item => new { item.OwnerId, item.UpdatedAt });
        maps.Property(item => item.Name).HasMaxLength(80);
        maps.Property(item => item.WallsJson).HasMaxLength(8_192);
        maps.HasOne(item => item.Owner).WithMany().HasForeignKey(item => item.OwnerId).OnDelete(DeleteBehavior.Cascade);

        var participants = modelBuilder.Entity<RoomParticipant>();
        participants.ToTable("room_participants");
        participants.HasKey(item => item.Id);
        participants.HasIndex(item => new { item.RoomId, item.UserId }).IsUnique();
        participants.Property(item => item.Code).HasMaxLength(16_384);
        participants.Property(item => item.Language).HasMaxLength(20);
        participants.HasOne(item => item.Room).WithMany(item => item.Participants).HasForeignKey(item => item.RoomId)
            .OnDelete(DeleteBehavior.Cascade);
        participants.HasOne(item => item.User).WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.Restrict);

        var progress = modelBuilder.Entity<PveLevelProgress>();
        progress.ToTable("pve_level_progress");
        progress.HasKey(item => item.Id);
        progress.HasIndex(item => new { item.UserId, item.LevelId }).IsUnique();
        progress.Property(item => item.LevelId).HasMaxLength(50);
        progress.HasOne(item => item.User).WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.Cascade);

        var strategies = modelBuilder.Entity<UserStrategy>();
        strategies.ToTable("strategies");
        strategies.HasKey(strategy => strategy.Id);
        strategies.HasQueryFilter(strategy => !strategy.IsDeleted);
        strategies.HasIndex(strategy => strategy.ShareToken).IsUnique();
        strategies.HasIndex(strategy => new { strategy.Visibility, strategy.UpdatedAt });
        strategies.Property(strategy => strategy.Name).HasMaxLength(80);
        strategies.Property(strategy => strategy.Description).HasMaxLength(1000);
        strategies.Property(strategy => strategy.Language).HasMaxLength(20);
        strategies.Property(strategy => strategy.Code).HasMaxLength(16_384);
        strategies.Property(strategy => strategy.Tags).HasColumnType("text[]");
        strategies.Property(strategy => strategy.Visibility).HasConversion<string>().HasMaxLength(16);
        strategies.Property(strategy => strategy.ShareToken).HasMaxLength(32);
        strategies.Property(strategy => strategy.SalePrice);
        strategies.Property(strategy => strategy.ValidationError).HasMaxLength(1000);
        strategies.HasOne(strategy => strategy.Owner).WithMany(user => user.Strategies)
            .HasForeignKey(strategy => strategy.OwnerId).OnDelete(DeleteBehavior.Cascade);
        strategies.HasOne(strategy => strategy.ForkedFrom).WithMany()
            .HasForeignKey(strategy => strategy.ForkedFromId).OnDelete(DeleteBehavior.SetNull);

        var versions = modelBuilder.Entity<UserStrategyVersion>();
        versions.ToTable("strategy_versions");
        versions.HasKey(version => version.Id);
        versions.HasIndex(version => new { version.StrategyId, version.Number }).IsUnique();
        versions.Property(version => version.Code).HasMaxLength(16_384);
        versions.Property(version => version.Description).HasMaxLength(1000);
        versions.Property(version => version.Tags).HasColumnType("text[]");
        versions.HasOne(version => version.Strategy).WithMany(strategy => strategy.Versions)
            .HasForeignKey(version => version.StrategyId).OnDelete(DeleteBehavior.Cascade);

        var maneuvers = modelBuilder.Entity<ManeuverSnippet>();
        maneuvers.ToTable("maneuvers");
        maneuvers.HasKey(maneuver => maneuver.Id);
        maneuvers.Property(maneuver => maneuver.Id).HasMaxLength(80);
        maneuvers.Property(maneuver => maneuver.Name).HasMaxLength(80);
        maneuvers.Property(maneuver => maneuver.Description).HasMaxLength(1000);
        maneuvers.Property(maneuver => maneuver.Category).HasMaxLength(30);
        maneuvers.Property(maneuver => maneuver.Language).HasMaxLength(20);
        maneuvers.Property(maneuver => maneuver.Code).HasMaxLength(16_384);
        maneuvers.Property(maneuver => maneuver.Usage).HasMaxLength(500);
        maneuvers.Property(maneuver => maneuver.Tags).HasColumnType("text[]");
        maneuvers.HasData(SeedManeuvers());
    }

    private static ManeuverSnippet[] SeedManeuvers() =>
    [
        new()
        {
            Id = "precise-aim-js", Name = "Точное наведение", Category = "combat", Language = "javascript",
            Description = "Наводит башню и стреляет после попадания цели в узкий сектор.",
            Usage = "preciseAim(state)", Tags = ["прицел", "стрельба"],
            Code = "function preciseAim({ self, enemy }) {\n  if (!enemy) return {};\n  const x = enemy.position.x - self.position.x;\n  const y = enemy.position.y - self.position.y;\n  const angle = Math.atan2(y, x);\n  const error = Math.atan2(Math.sin(angle - self.turretAngle), Math.cos(angle - self.turretAngle));\n  return { aimDirection: { x, y }, shoot: self.canShoot && Math.abs(error) < 0.05 };\n}"
        },
        new()
        {
            Id = "keep-distance-js", Name = "Удержание дистанции", Category = "movement", Language = "javascript",
            Description = "Подъезжает или отступает, сохраняя заданную дистанцию до цели.",
            Usage = "keepDistance(state, 4.5)", Tags = ["движение", "дистанция"],
            Code = "function keepDistance({ self, enemy }, target = 4.5) {\n  if (!enemy) return {};\n  const x = enemy.position.x - self.position.x;\n  const y = enemy.position.y - self.position.y;\n  const drive = Math.max(-1, Math.min(1, Math.hypot(x, y) - target));\n  const error = Math.atan2(y, x) - self.bodyAngle;\n  const turn = Math.max(-1, Math.min(1, error * 2));\n  return { leftTrack: drive + turn, rightTrack: drive - turn, aimDirection: { x, y } };\n}"
        }
    ];
}
