export interface Point { x: number; y: number }
export interface Wall extends Point { width: number; height: number }
export interface Arena { width: number; height: number; walls: Wall[] }
export type Movement = 'tracked' | 'hover' | 'wheeled' | 'omni';
export interface Bot {
  id: string;
  teamId?: string;
  position: Point;
  movement?: Movement;
  velocity?: Point;
  forfeited?: boolean;
  hp: number;
  maxHp: number;
  bodyAngle: number;
  turretAngle: number;
  speed: number;
  reloadingTime: number;
  canShoot: boolean;
}
export interface Bullet { id: number; ownerBotId: Bot['id']; position: Point; direction: Point }
export interface BotAction {
  leftTrack: number;
  rightTrack: number;
  aimDirection: Point;
  shoot: boolean;
  thrust?: Point;
  turn?: number;
  throttle?: number;
}
export interface BehaviorSample {
  tick: number;
  botId: Bot['id'];
  position: Point;
  bodyAngle: number;
  turretAngle: number;
  enemyVisible: boolean;
  action: BotAction;
}
export interface BattleEvent {
  tick: number;
  type: 'ShotFired' | 'BotHit' | 'BotDestroyed' | 'ZoneDamage' | 'MatchFinished';
  sourceBotId: string | null;
  targetBotId: string | null;
  position: Point | null;
  bulletId: number | null;
  damage: number | null;
}
export interface SafeZone { x: number; y: number; width: number; height: number }
export interface Frame {
  tick: number;
  bots: Bot[];
  bullets: Bullet[];
  events: BattleEvent[];
  safeZone?: SafeZone | null;
}
export interface ReachMarker { x: number; y: number; radius: number }
export interface Replay {
  tickRate: number;
  arena: Arena;
  result: {
    winnerBotId: string | null;
    winnerTeamId?: string | null;
    reason: 'BotDestroyed' | 'TimeLimit' | 'BotError' | 'ObjectiveComplete';
    durationTicks: number;
  };
  frames: Frame[];
  behaviorSamples?: BehaviorSample[];
  marker?: ReachMarker | null;
}
export interface CampaignSpawn {
  id: string;
  teamId?: string;
  position: Point;
  bodyAngle: number;
  turretAngle: number;
}
export interface CampaignLevel {
  id: string;
  order: number;
  name: string;
  summary: string;
  objective: string;
  hint: string;
  arena: Arena;
  marker?: ReachMarker | null;
  spawns: CampaignSpawn[];
  playerBotIds?: string[];
  starters?: Record<string, Record<StrategyLanguage, string>>;
  starter: Record<StrategyLanguage, string>;
}
export interface CampaignTrack {
  id: string;
  order: number;
  name: string;
  summary: string;
  available: boolean;
  levelCount: number;
  levels: CampaignLevel[];
}
export type AppMode = 'lab' | 'campaign';
export interface ScriptError {
  botId: string;
  tick: number | null;
  message: string;
  line?: number | null;
  column?: number | null;
}

export interface StrategyLogLine {
  tick: number | null;
  message: string;
}
export interface MatchResponse {
  replay: Replay;
  error: ScriptError | null;
  logs?: StrategyLogLine[] | null;
}
export interface OpponentSlot { id: string; movement: Movement }
export interface Opponent { id: string; name: string; description: string }

export type MatchJobStatus =
  | { state: 'queued'; position: number }
  | { state: 'running' }
  | { state: 'completed'; match: MatchResponse | null; error: string | null; diagnostic?: ScriptError | null };

export type StrategyLanguage = "javascript" | "python";

export interface ArenaUser {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  nickname: string | null;
  balance: number;
}
export type AuthSession =
  | { authenticated: false; loginAvailable?: boolean }
  | { authenticated: true; user: ArenaUser; needsNickname: boolean; loginAvailable?: boolean };
export type UgcVisibility = 'Private' | 'Unlisted' | 'Public';
export interface UgcAuthor { id: string; nickname: string; avatarUrl: string | null }
export interface UgcStrategyCard {
  id: string; name: string; description: string; language: StrategyLanguage; tags: string[];
  visibility: UgcVisibility; author: UgcAuthor; version: number; forks: number; runs: number; likes: number;
  forkedFromId: string | null; forkedFromName: string | null; updatedAt: string;
  salePrice: number | null;
  isPublished: boolean; isActive: boolean; validationError: string | null;
}
export interface UgcStrategy extends Omit<UgcStrategyCard, 'version' | 'forks' | 'runs' | 'likes'> {
  code: string | null; shareToken: string | null; versions: { number: number; publishedAt: string }[];
  isOwner: boolean; canReadCode: boolean;
}
export interface ManeuverSnippet {
  id: string; name: string; description: string; category: string; language: StrategyLanguage;
  code: string; usage: string; tags: string[];
}
export interface FriendUser { id: string; nickname: string; avatarUrl: string | null }
export interface Friendship { id: string; status: 'incoming' | 'outgoing' | 'accepted'; user: FriendUser }
export interface FriendStrategy { id: string; name: string; language: StrategyLanguage }
export interface BattleChallenge {
  id: string; status: 'Pending' | 'Running' | 'Completed' | 'Declined' | 'Cancelled'; stake: number; incoming: boolean;
  challenger: FriendUser; opponent: FriendUser; challengerStrategy: { id: string; name: string };
  opponentStrategy: { id: string; name: string } | null; winnerId: string | null;
  createdAt: string; completedAt: string | null;
}
export interface StrategyTransfer {
  id: string; status: 'Pending' | 'Accepted' | 'Declined'; sender: FriendUser;
  strategy: { id: string; name: string; language: StrategyLanguage }; createdAt: string;
}
export interface GameRoom {
  id: string; name: string; creator: FriendUser; allowClipboard: boolean; allowPresetStrategies: boolean;
  maxCharactersPerSecond: number; stake: number; status: 'Open' | 'Running' | 'Completed' | 'Cancelled';
  occupied: boolean; createdAt: string; mapName: string; arena: Arena;
}
export interface BattleMap {
  id: string; name: string; width: number; height: number; walls: Wall[]; createdAt: string; updatedAt: string;
}
export interface PveLevel {
  id: string; order: number; blockId: string; blockOrder: number; stage: number; isTraining: boolean;
  title: string; command: string; description: string; goal: string; hints: string[]; reward: number;
  starterCode: Record<StrategyLanguage, string>; solutionCode: Record<StrategyLanguage, string>;
  completed: boolean; locked: boolean; stats: PveStats | null;
}
export interface PveBlock {
  id: string; order: number; title: string; description: string; isTraining: boolean;
  completed: number; total: number; locked: boolean; levels: PveLevel[];
}
export interface PveCourse { completed: number; total: number; blocks: PveBlock[] }
export interface PveStats {
  attempts: number; bestDurationSeconds: number | null; lowestDamageTaken: number | null;
  lastDurationSeconds: number | null; lastDamageTaken: number | null;
}
export interface PveAttemptResult {
  match: MatchResponse; completed: boolean; techniquePassed: boolean; won: boolean;
  rewardAwarded: number; message: string; stats: PveStats;
}
export interface PveLeaderboardEntry {
  rank: number; user: FriendUser; durationSeconds: number; damageTaken: number; attempts: number; completedAt: string;
}
export interface PveLeaderboard { enabled: boolean; entries: PveLeaderboardEntry[] }
