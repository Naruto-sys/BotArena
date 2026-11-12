export interface Point { x: number; y: number }
export interface Wall extends Point { width: number; height: number }
export type SurfaceType = 'Ground' | 'Sand' | 'Snow' | 'Ice';
export interface ArenaCell { x: number; y: number; surface: SurfaceType; fog: boolean }
export interface SurfaceModifiers {
  speedMultiplier: number;
  accelerationMultiplier: number;
  decelerationMultiplier: number;
  turnMultiplier: number;
}
export interface Arena {
  width: number;
  height: number;
  walls: Wall[];
  cellSize: number;
  cells: ArenaCell[];
  terrainRules: {
    sand: SurfaceModifiers;
    snow: SurfaceModifiers;
    ice: SurfaceModifiers;
    fogVisibilityRange: number;
  };
}
export type WeaponType = 'Cannon' | 'Mortar' | 'Gauss';
export type ConsumableType = 'Repair' | 'Shield' | 'SpeedBoost' | 'Coolant' | 'Smoke';
export interface Item { id: number; type: ConsumableType; position: Point }
export interface ActiveEffect { type: ConsumableType; expiresAtTick: number }
export interface SmokeCloud { id: number; ownerBotId: Bot['id']; position: Point; radius: number; expiresAtTick: number }
export interface Bot {
  id: 'player' | 'opponent';
  position: Point;
  hp: number;
  maxHp: number;
  bodyAngle: number;
  turretAngle: number;
  speed: number;
  reloadingTime: number;
  canShoot: boolean;
  weapon: WeaponType;
  chargeStage: 'None' | 'Charging' | 'Ready';
  chargeProgress: number;
  surface: SurfaceType;
  inFog: boolean;
  inventory: ConsumableType[];
  activeEffects: ActiveEffect[];
  shieldHp: number;
}
export interface Bullet {
  id: number;
  ownerBotId: Bot['id'];
  position: Point;
  direction: Point;
  weapon: WeaponType;
  targetPoint: Point | null;
  launchTick: number;
  impactTick: number | null;
}
export interface BattleEvent {
  tick: number;
  type: 'ShotFired' | 'BotHit' | 'BotDestroyed' | 'MatchFinished' | 'ProjectileLanded'
    | 'BeamFired' | 'WeaponChargeStarted' | 'WeaponReady' | 'SurfaceChanged' | 'FogEntered' | 'FogExited'
    | 'ItemSpawned' | 'ItemPickedUp' | 'ItemUsed' | 'EffectStarted' | 'EffectEnded' | 'BotRepaired'
    | 'SmokeCreated' | 'SmokeExpired';
  sourceBotId: Bot['id'] | null;
  targetBotId: Bot['id'] | null;
  position: Point | null;
  bulletId: number | null;
  damage: number | null;
  endPosition: Point | null;
  radius: number | null;
  weapon: WeaponType | null;
  surface: SurfaceType | null;
  itemType: ConsumableType | null;
  itemId: number | null;
  amount: number | null;
  shieldDamage: number | null;
}
export interface Frame { tick: number; bots: Bot[]; bullets: Bullet[]; events: BattleEvent[]; items: Item[]; smokeClouds: SmokeCloud[] }
export interface Replay {
  tickRate: number;
  arena: Arena;
  result: { winnerBotId: Bot['id'] | null; reason: 'BotDestroyed' | 'TimeLimit' | 'BotError'; durationTicks: number };
  frames: Frame[];
  randomSeed: number;
}
export interface ScriptError {
  botId: Bot['id'];
  tick: number | null;
  message: string;
  line?: number | null;
  column?: number | null;
}

export interface MatchResponse {
  replay: Replay;
  error: ScriptError | null;
}
export interface Opponent { id: string; name: string; description: string }

export type MatchJobStatus =
  | { state: 'queued'; position: number }
  | { state: 'running' }
  | { state: 'completed'; match: MatchResponse | null; error: string | null; diagnostic?: ScriptError | null };

export type StrategyLanguage = "javascript" | "python";
