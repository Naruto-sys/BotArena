import * as THREE from 'three';
import type { Frame, Replay, ConsumableType } from './contracts';

const colors: Record<ConsumableType, number> = {
  Repair: 0x79e6a5, Shield: 0x75c8ff, SpeedBoost: 0xffd06b, Coolant: 0xb7efff, Smoke: 0xd8c9f4,
};
const symbols: Record<ConsumableType, string> = { Repair: '+', Shield: '◇', SpeedBoost: '↑', Coolant: '❄', Smoke: '≈' };

/** Gameplay geometry shares the cinematic scene, so camera and video export stay aligned. */
export function createGameplayLayer(replay: Replay) {
  const group = new THREE.Group();
  const dynamic = new THREE.Group();
  group.add(dynamic);
  const world = (x: number, y: number, height: number) =>
    new THREE.Vector3(x - replay.arena.width / 2, height, y - replay.arena.height / 2);
  const cellSize = replay.arena.cellSize ?? 1;
  const surfaces = { Ground: 0x142234, Sand: 0x705432, Snow: 0x78929f, Ice: 0x245e7a };
  for (const cell of replay.arena.cells ?? []) {
    const width = Math.min(cellSize, replay.arena.width - cell.x * cellSize);
    const height = Math.min(cellSize, replay.arena.height - cell.y * cellSize);
    const tile = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ color: surfaces[cell.surface], transparent: true, opacity: 0.8, depthWrite: false }));
    tile.rotation.x = -Math.PI / 2;
    tile.position.copy(world(cell.x * cellSize + width / 2, cell.y * cellSize + height / 2, 0.012));
    group.add(tile);
    if (cell.fog) {
      const fog = new THREE.Mesh(new THREE.BoxGeometry(width, 0.55, height),
        new THREE.MeshBasicMaterial({ color: 0xd7e3ec, transparent: true, opacity: 0.15, depthWrite: false }));
      fog.position.copy(tile.position).add(new THREE.Vector3(0, 0.28, 0));
      group.add(fog);
    }
  }
  const items = new Map<number, THREE.Group>();
  const smoke = new Map<number, THREE.Mesh>();
  const shields = new Map<string, THREE.Mesh>();
  const effects: Array<{ tick: number; object: THREE.Object3D }> = [];
  for (const frame of replay.frames) {
    for (const item of frame.items ?? []) {
      if (items.has(item.id)) continue;
      const token = new THREE.Group();
      token.position.copy(world(item.position.x, item.position.y, 0.22));
      token.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.22),
        new THREE.MeshBasicMaterial({ color: colors[item.type], wireframe: true })));
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 64;
      const context = canvas.getContext('2d');
      if (context) {
        context.fillStyle = '#ffffff'; context.font = '48px sans-serif';
        context.textAlign = 'center'; context.textBaseline = 'middle';
        context.fillText(symbols[item.type], 32, 32);
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthWrite: false }));
        label.scale.set(0.3, 0.3, 1); token.add(label);
      }
      dynamic.add(token); items.set(item.id, token);
    }
    for (const cloud of frame.smokeClouds ?? []) {
      if (smoke.has(cloud.id)) continue;
      const volume = new THREE.Mesh(new THREE.SphereGeometry(cloud.radius, 20, 12),
        new THREE.MeshBasicMaterial({ color: 0xaeb7c9, transparent: true, opacity: 0.25, depthWrite: false }));
      volume.scale.y = 0.35;
      volume.position.copy(world(cloud.position.x, cloud.position.y, 0.45));
      dynamic.add(volume); smoke.set(cloud.id, volume);
    }
    for (const bot of frame.bots) {
      if (shields.has(bot.id)) continue;
      const shield = new THREE.Mesh(new THREE.SphereGeometry(0.52, 16, 10),
        new THREE.MeshBasicMaterial({ color: 0x75c8ff, wireframe: true, transparent: true, opacity: 0.35, depthWrite: false }));
      dynamic.add(shield); shields.set(bot.id, shield);
    }
    for (const event of frame.events) {
      if (!event.position) continue;
      let object: THREE.Mesh | undefined;
      if (event.type === 'BeamFired' && event.endPosition) {
        const start = world(event.position.x, event.position.y, 0.42);
        const end = world(event.endPosition.x, event.endPosition.y, 0.42);
        const delta = end.clone().sub(start);
        if (delta.length() <= 0) continue;
        object = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, delta.length(), 8),
          new THREE.MeshBasicMaterial({ color: 0xd9f5ff }));
        object.position.copy(start).add(end).multiplyScalar(0.5);
        object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
      } else if (event.type === 'ProjectileLanded' && event.radius != null && event.radius > 0) {
        object = new THREE.Mesh(new THREE.RingGeometry(event.radius * 0.92, event.radius, 32),
          new THREE.MeshBasicMaterial({ color: 0xe7ab55, side: THREE.DoubleSide, transparent: true, opacity: 0.75 }));
        object.rotation.x = -Math.PI / 2;
        object.position.copy(world(event.position.x, event.position.y, 0.025));
      }
      if (object) { dynamic.add(object); effects.push({ tick: frame.tick, object }); }
    }
  }
  return {
    group,
    update(frame: Frame, perception: boolean) {
      // The perception camera keeps its existing information masking; world objects remain spectator data.
      dynamic.visible = !perception;
      for (const object of items.values()) object.visible = false;
      for (const item of frame.items ?? []) { const object = items.get(item.id); if (object) object.visible = true; }
      for (const object of smoke.values()) object.visible = false;
      for (const cloud of frame.smokeClouds ?? []) { const object = smoke.get(cloud.id); if (object) object.visible = true; }
      for (const [id, object] of shields) {
        const bot = frame.bots.find(value => value.id === id);
        object.visible = (bot?.shieldHp ?? 0) > 0;
        if (bot) object.position.copy(world(bot.position.x, bot.position.y, 0.25));
      }
      for (const effect of effects) effect.object.visible = effect.tick === frame.tick;
    },
  };
}
