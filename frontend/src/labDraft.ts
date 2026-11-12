import type { Arena, ArenaCell, MatchMode, Movement, Point, StrategyLanguage, Wall, WeaponType } from './contracts';
import { deathmatchWalls, deathmatchStartPositions } from './deathmatchMap';
import { savedWeapon } from './weapons';

export type BehaviorSource = 'preset' | 'code';

export interface LabBot {
  id: string;
  teamId: string;
  name: string;
  position: Point;
  bodyAngle: number;
  turretAngle: number;
  hp: number;
  movement?: Movement;
  weapon: WeaponType;
  source: BehaviorSource;
  presetId: string;
  code: Partial<Record<StrategyLanguage, string>>;
}

export interface LabSetup {
  mode: MatchMode;
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

export function biomeCells(): ArenaCell[] {
  const cells: ArenaCell[] = [];
  for (const x of [4, 5, 10, 11]) for (const y of [3, 4]) cells.push({ x, y, surface: 'Sand', fog: y === 4 });
  for (const x of [3, 4, 11, 12]) for (const y of [7, 8]) cells.push({ x, y, surface: 'Snow', fog: false });
  for (const x of [5, 6, 9, 10]) for (const y of [0, 1]) cells.push({ x, y, surface: 'Ice', fog: false });
  for (const x of [7, 8]) for (const y of [8, 9]) cells.push({ x, y, surface: 'Ground', fog: true });
  return cells;
}

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

export const hillZone = { center: { x: 8, y: 5 }, radius: 1.5 };
export const hillWalls: Wall[] = [
  { x: 3.5, y: 3.2, width: 1, height: 3.6 },
  { x: 11.5, y: 3.2, width: 1, height: 3.6 },
];

const defaultAllyCode: Record<StrategyLanguage, string> = {
  javascript: `function tick({ self, enemy }) {
  if (!enemy) return { driveTo: { x: 10, y: 5 } };
  return {
    driveTo: enemy.position,
    aimAt: enemy.position,
    ...(self.weapon === 'Mortar' ? { targetPoint: enemy.position } : {}),
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
        **({"targetPoint": enemy["position"]} if self["weapon"] == "Mortar" else {}),
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
  hill = false,
): LabBot[] {
  const allies = Array.from({ length: allyCount }, (_, index) => {
    const id = index === 0 ? 'player' : `player-${index + 1}`;
    const prior = previous.find(bot => bot.id === id);
    return {
      id,
      teamId: 'player' as const,
      name: prior?.name ?? '',
      position: { x: 2.2, y: hill && allyCount === 2 ? 4 + index * 2 : laneY(index, allyCount) },
      bodyAngle: 0,
      turretAngle: 0,
      hp: prior?.hp ?? 100,
      movement: prior?.movement ?? 'tracked',
      weapon: prior?.weapon ?? 'Cannon',
      source: prior?.source ?? (index === 0 ? 'code' as const : 'preset' as const),
      presetId: prior?.presetId ?? 'assault',
      code: prior?.code ?? { ...defaultAllyCode },
    };
  });
  const enemies = Array.from({ length: enemyCount }, (_, index) => {
    const id = index === 0 ? 'opponent' : `opponent-${index + 1}`;
    const prior = previous.find(bot => bot.id === id);
    return {
      id,
      teamId: 'opponent' as const,
      name: prior?.name ?? '',
      position: { x: 13.8, y: hill && enemyCount === 2 ? 4 + index * 2 : laneY(index, enemyCount) },
      bodyAngle: Math.PI,
      turretAngle: Math.PI,
      hp: prior?.hp ?? 100,
      movement: prior?.movement ?? 'tracked',
      weapon: prior?.weapon ?? 'Cannon',
      source: prior?.source ?? 'preset' as const,
      presetId: prior?.presetId ?? 'blind-afraid',
      code: prior?.code ?? { javascript: 'function tick() { return {}; }', python: 'def tick(state):\n    return {}\n' },
    };
  });
  return [...allies, ...enemies];
}

export function layoutDeathmatchBots(count: number, previous: LabBot[] = []): LabBot[] {
  return deathmatchStartPositions(count).map((point, index) => {
    const id = index === 0 ? 'player' : index === 1 ? 'opponent' : `opponent-${index}`;
    const prior = previous.find(bot => bot.id === id);
    return {
      id, teamId: id, name: prior?.name ?? '', position: { ...point.position },
      bodyAngle: point.bodyAngle, turretAngle: point.turretAngle, hp: prior?.hp ?? 100,
      movement: prior?.movement ?? 'tracked', source: prior?.source ?? (index === 0 ? 'code' : 'preset'),
      weapon: prior?.weapon ?? 'Cannon',
      presetId: 'assault', code: prior?.code ?? { ...defaultAllyCode },
    };
  });
}

export function defaultLabSetup(): LabSetup {
  const bots = layoutBots(1, 1);
  return {
    mode: 'Elimination',
    allyCount: 1,
    enemyCount: 1,
    arena: { width: 16, height: 10, walls: classicWalls.map(wall => ({ ...wall })), cellSize: 1, cells: biomeCells() },
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
      mode: parsed.mode === 'KingOfHill' || parsed.mode === 'Deathmatch' ? parsed.mode : 'Elimination',
      maxTicks: Math.max(parsed.maxTicks ?? 0, 1000),
      arena: {
        width: 16,
        height: 10,
        walls: Array.isArray(parsed.arena.walls) ? parsed.arena.walls : classicWalls,
        cellSize: parsed.arena.cellSize ?? 1,
        cells: parsed.arena.cells ?? biomeCells(),
        terrainRules: parsed.arena.terrainRules,
      },
      bots: parsed.bots.map(bot => ({
        ...bot,
        name: bot.name ?? '',
        weapon: savedWeapon(bot.weapon),
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

export function changeLabMode(setup: LabSetup, mode: MatchMode): LabSetup {
  const hill = mode === 'KingOfHill';
  const dm = mode === 'Deathmatch';
  const count = Math.min(2, Math.max(setup.allyCount, setup.enemyCount));
  const allyCount = dm ? 1 : hill ? count : setup.allyCount;
  const enemyCount = dm ? Math.min(5, Math.max(3, setup.bots.length - 1)) : hill ? count : Math.min(4, setup.enemyCount);
  const bots = (dm ? layoutDeathmatchBots(enemyCount + 1, setup.bots) : layoutBots(allyCount, enemyCount, setup.bots, hill))
    .map(bot => hill && bot.source === 'preset' ? { ...bot, presetId: 'assault' } : bot);
  return {
    ...setup, mode, allyCount, enemyCount, bots,
    maxTicks: hill || dm ? 2400 : 1000,
    activeBotId: bots.some(bot => bot.id === setup.activeBotId) ? setup.activeBotId : bots[0].id,
    arena: { ...setup.arena, walls: (dm ? deathmatchWalls : hill ? hillWalls : classicWalls).map(wall => ({ ...wall })) },
  };
}

export function saveLabSetup(setup: LabSetup) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(setup));
}

export function customBots(setup: LabSetup) {
  return setup.bots.filter(bot => bot.source === 'code');
}
