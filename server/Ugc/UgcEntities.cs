namespace BotArena;

public enum StrategyVisibility { Private, Unlisted, Public }
public enum FriendshipStatus { Pending, Accepted }
public enum BattleChallengeStatus { Pending, Running, Completed, Declined, Cancelled }
public enum StrategyTransferStatus { Pending, Accepted, Declined }
public enum GameRoomStatus { Open, Running, Completed, Cancelled }

public sealed class AppUser
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string? YandexId { get; set; }
    public string? GitHubId { get; set; }
    public string? Login { get; set; }
    public string? NormalizedLogin { get; set; }
    public string? PasswordHash { get; set; }
    public string FirstName { get; set; } = "";
    public string LastName { get; set; } = "";
    public string? AvatarUrl { get; set; }
    public string? Nickname { get; set; }
    public string? NormalizedNickname { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset LastLoginAt { get; set; } = DateTimeOffset.UtcNow;
    public long Balance { get; set; } = 1_000;
    public List<UserStrategy> Strategies { get; set; } = [];
    public List<OAuthIdentity> OAuthIdentities { get; set; } = [];
}

public sealed class OAuthIdentity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public required AppUser User { get; set; }
    public required string Provider { get; set; }
    public required string Subject { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class Friendship
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserAId { get; set; }
    public required AppUser UserA { get; set; }
    public Guid UserBId { get; set; }
    public required AppUser UserB { get; set; }
    public Guid RequestedById { get; set; }
    public FriendshipStatus Status { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? AcceptedAt { get; set; }
}

public sealed class UserStrategy
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OwnerId { get; set; }
    public required AppUser Owner { get; set; }
    public required string Name { get; set; }
    public string Description { get; set; } = "";
    public string Language { get; set; } = StrategyLanguages.JavaScript;
    public string Code { get; set; } = "";
    public string[] Tags { get; set; } = [];
    public StrategyVisibility Visibility { get; set; }
    public string? ShareToken { get; set; }
    public Guid? ForkedFromId { get; set; }
    public UserStrategy? ForkedFrom { get; set; }
    public int ForkCount { get; set; }
    public int RunCount { get; set; }
    public int LikeCount { get; set; }
    public long? SalePrice { get; set; }
    public bool IsActive { get; set; }
    public string? ValidationError { get; set; }
    public bool IsDeleted { get; set; }
    public bool IsPendingTransfer { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public List<UserStrategyVersion> Versions { get; set; } = [];
}

public sealed class StrategyPurchase
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StrategyId { get; set; }
    public required UserStrategy Strategy { get; set; }
    public Guid BuyerId { get; set; }
    public required AppUser Buyer { get; set; }
    public long Price { get; set; }
    public DateTimeOffset PurchasedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class StrategyTransfer
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid SenderId { get; set; }
    public required AppUser Sender { get; set; }
    public Guid RecipientId { get; set; }
    public required AppUser Recipient { get; set; }
    public Guid SourceStrategyId { get; set; }
    public required UserStrategy SourceStrategy { get; set; }
    public Guid CopyStrategyId { get; set; }
    public required UserStrategy CopyStrategy { get; set; }
    public StrategyTransferStatus Status { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? RespondedAt { get; set; }
}

public sealed class BalanceTransaction
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public required AppUser User { get; set; }
    public long Amount { get; set; }
    public required string Type { get; set; }
    public Guid? ReferenceId { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class BattleChallenge
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ChallengerId { get; set; }
    public required AppUser Challenger { get; set; }
    public Guid OpponentId { get; set; }
    public required AppUser Opponent { get; set; }
    public Guid ChallengerStrategyId { get; set; }
    public required UserStrategy ChallengerStrategy { get; set; }
    public required string ChallengerCode { get; set; }
    public required string ChallengerLanguage { get; set; }
    public Guid? OpponentStrategyId { get; set; }
    public UserStrategy? OpponentStrategy { get; set; }
    public long Stake { get; set; }
    public BattleChallengeStatus Status { get; set; }
    public Guid? WinnerId { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? CompletedAt { get; set; }
}

public sealed class GameRoom
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public required string Name { get; set; }
    public Guid CreatorId { get; set; }
    public required AppUser Creator { get; set; }
    public Guid? GuestId { get; set; }
    public AppUser? Guest { get; set; }
    public bool AllowClipboard { get; set; }
    public bool AllowPresetStrategies { get; set; }
    public int MaxCharactersPerSecond { get; set; }
    public long Stake { get; set; }
    public string? MapName { get; set; }
    public string? ArenaJson { get; set; }
    public GameRoomStatus Status { get; set; }
    public Guid? WinnerId { get; set; }
    public string? MatchResultJson { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? CompletedAt { get; set; }
    public List<RoomParticipant> Participants { get; set; } = [];
}

public sealed class BattleMap
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OwnerId { get; set; }
    public required AppUser Owner { get; set; }
    public required string Name { get; set; }
    public required string WallsJson { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class RoomParticipant
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid RoomId { get; set; }
    public required GameRoom Room { get; set; }
    public Guid UserId { get; set; }
    public required AppUser User { get; set; }
    public string Code { get; set; } = "";
    public string Language { get; set; } = StrategyLanguages.JavaScript;
    public Guid? SourceStrategyId { get; set; }
    public bool IsReady { get; set; }
    public DateTimeOffset RateWindowStartedAt { get; set; } = DateTimeOffset.UtcNow;
    public int CharactersInWindow { get; set; }
}

public sealed class PveLevelProgress
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public required AppUser User { get; set; }
    public required string LevelId { get; set; }
    public long Reward { get; set; }
    public int Attempts { get; set; }
    public int? BestDurationTicks { get; set; }
    public int? LowestDamageTaken { get; set; }
    public int? LastDurationTicks { get; set; }
    public int? LastDamageTaken { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
}

public sealed class UserStrategyVersion
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StrategyId { get; set; }
    public required UserStrategy Strategy { get; set; }
    public int Number { get; set; }
    public required string Code { get; set; }
    public required string Description { get; set; }
    public string[] Tags { get; set; } = [];
    public DateTimeOffset PublishedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class ManeuverSnippet
{
    public required string Id { get; set; }
    public required string Name { get; set; }
    public required string Description { get; set; }
    public required string Category { get; set; }
    public required string Language { get; set; }
    public required string Code { get; set; }
    public required string Usage { get; set; }
    public string[] Tags { get; set; } = [];
}
