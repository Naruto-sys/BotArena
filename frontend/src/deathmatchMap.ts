import type { RespawnPoint, Wall } from './contracts';

export const deathmatchWalls: Wall[] = [
  { x: 3, y: 1.6, width: .6, height: 1.4 }, { x: 1.6, y: 3, width: 2, height: .6 },
  { x: 12.4, y: 1.6, width: .6, height: 1.4 }, { x: 12.4, y: 3, width: 2, height: .6 },
  { x: 3, y: 7, width: .6, height: 1.4 }, { x: 1.6, y: 6.4, width: 2, height: .6 },
  { x: 12.4, y: 7, width: .6, height: 1.4 }, { x: 12.4, y: 6.4, width: 2, height: .6 },
  { x: 6.5, y: 2.2, width: 3, height: .6 }, { x: 6.5, y: 7.2, width: 3, height: .6 },
  { x: 2.8, y: 4.1, width: .6, height: 1.8 }, { x: 12.6, y: 4.1, width: .6, height: 1.8 },
];

export const deathmatchSpawns: RespawnPoint[] = [
  [1.5, 2.2, 0], [8, 1.1, Math.PI / 2], [14.5, 2.2, Math.PI], [14.5, 5, Math.PI],
  [14.5, 7.8, Math.PI], [8, 8.9, -Math.PI / 2], [1.5, 7.8, 0], [1.5, 5, 0],
].map(([x, y, angle], index) => ({ id: `spawn-${index + 1}`, position: { x, y }, bodyAngle: angle, turretAngle: angle }));

export function deathmatchStartPositions(count: number) {
  const indices = count === 4 ? [0, 2, 4, 6] : count === 5 ? [0, 1, 2, 4, 6] : [0, 1, 2, 4, 5, 6];
  return indices.map(index => deathmatchSpawns[index]);
}
