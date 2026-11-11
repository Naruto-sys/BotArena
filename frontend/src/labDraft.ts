import type { Arena, Point, StrategyLanguage, Wall } from './contracts';

export type BehaviorSource = 'preset' | 'code';

export interface LabBot {
  id: string;
  teamId: 'player' | 'opponent';
  name: string;
  position: Point;
  bodyAngle: number;
  turretAngle: number;
  hp: number;
  source: BehaviorSource;
  presetId: string;
  code: Partial<Record<StrategyLanguage, string>>;
}

export interface LabSetup {
  allyCount: number;
  enemyCount: number;
  arena: Arena;
  maxTicks: number;
  bots: LabBot[];
  activeBotId: string;
}

export interface BehaviorPresetInfo {
  id: string;
  name: string;
  description: string;
  strength: 'weak' | 'standard' | string;
}

const STORAGE_KEY = 'botarena.labSetup.v1';

const presetAliases: Record<string, string> = {
  idle: 'blind-afraid',
  skirmisher: 'assault',
  rusher: 'assault',
  aggressive: 'assault',
  defensive: 'trench',
};

export const classicWalls: Wall[] = [
  { x: 4.5, y: 1.9, width: 2.0, height: 1.3 },
  { x: 7.25, y: 4.15, width: 1.5, height: 1.7 },
  { x: 9.5, y: 6.8, width: 2.0, height: 1.3 },
];

const defaultAllyCode: Record<StrategyLanguage, string> = {
  javascript: `function tick({ self, enemy }) {
  if (!enemy) return { driveTo: { x: 10, y: 5 } };
  return {
    driveTo: enemy.position,
    aimAt: enemy.position,
    shoot: self.canShoot && facing(self, enemy.position)
  };
}`,
  python: `def tick(state):
    self = state["self"]
    enemy = state["enemy"]
    if enemy is None:
        return {"driveTo": {"x": 10, "y": 5}}
    return {
        "driveTo": enemy["position"],
        "aimAt": enemy["position"],
        "shoot": self["canShoot"] and facing(self, enemy["position"]),
    }
`,
};

function laneY(index: number, count: number): number {
  if (count <= 1) return 5;
  return 2 + (index * 6) / Math.max(1, count - 1);
}

export function layoutBots(
  allyCount: number,
  enemyCount: number,
  previous: LabBot[] = [],
): LabBot[] {
  const allies = Array.from({ length: allyCount }, (_, index) => {
    const id = index === 0 ? 'player' : `player-${index + 1}`;
    const prior = previous.find(bot => bot.id === id && bot.teamId === 'player');
    return {
      id,
      teamId: 'player' as const,
      name: prior?.name ?? '',
      position: { x: 2.2, y: laneY(index, allyCount) },
      bodyAngle: 0,
      turretAngle: 0,
      hp: prior?.hp ?? 100,
      source: prior?.source ?? (index === 0 ? 'code' as const : 'preset' as const),
      presetId: prior?.presetId ?? 'assault',
      code: prior?.code ?? { ...defaultAllyCode },
    };
  });
  const enemies = Array.from({ length: enemyCount }, (_, index) => {
    const id = index === 0 ? 'opponent' : `opponent-${index + 1}`;
    const prior = previous.find(bot => bot.id === id && bot.teamId === 'opponent');
    return {
      id,
      teamId: 'opponent' as const,
      name: prior?.name ?? '',
      position: { x: 13.8, y: laneY(index, enemyCount) },
      bodyAngle: Math.PI,
      turretAngle: Math.PI,
      hp: prior?.hp ?? 100,
      source: prior?.source ?? 'preset' as const,
      presetId: prior?.presetId ?? 'blind-afraid',
      code: prior?.code ?? { javascript: 'function tick() { return {}; }', python: 'def tick(state):\n    return {}\n' },
    };
  });
  return [...allies, ...enemies];
}

export function defaultLabSetup(): LabSetup {
  const bots = layoutBots(1, 1);
  return {
    allyCount: 1,
    enemyCount: 1,
    arena: { width: 16, height: 10, walls: classicWalls.map(wall => ({ ...wall })) },
    maxTicks: 1000,
    bots,
    activeBotId: bots[0].id,
  };
}

export function loadLabSetup(): LabSetup {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultLabSetup();
    const parsed = JSON.parse(raw) as LabSetup;
    if (!parsed?.bots?.length || !parsed.arena) return defaultLabSetup();
    return {
      ...defaultLabSetup(),
      ...parsed,
      maxTicks: Math.max(parsed.maxTicks ?? 0, 1000),
      arena: {
        width: 16,
        height: 10,
        walls: Array.isArray(parsed.arena.walls) ? parsed.arena.walls : classicWalls,
      },
      bots: parsed.bots.map(bot => ({
        ...bot,
        name: bot.name ?? '',
        presetId: presetAliases[bot.presetId] ?? bot.presetId,
      })),
      activeBotId: parsed.bots.some(bot => bot.id === parsed.activeBotId)
        ? parsed.activeBotId
        : parsed.bots[0].id,
    };
  } catch {
    return defaultLabSetup();
  }
}

export function saveLabSetup(setup: LabSetup) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(setup));
}

export function customBots(setup: LabSetup) {
  return setup.bots.filter(bot => bot.source === 'code');
}
