import * as THREE from 'three';
import type { BehaviorSample, Bot, Point, Replay } from './contracts';
import { botColor } from './botVisuals';

export interface LastKnownTarget {
  position: Point;
  ageFrames: number;
  botId: string;
}

export interface PerceptionRig {
  group: THREE.Group;
  rangeDisc: THREE.Mesh;
  selectedHalo: THREE.Mesh;
  shadows: THREE.Mesh[];
  sightLine: THREE.Line;
  memoryLine: THREE.Line;
  ghost: THREE.Group;
  ghostMaterials: THREE.MeshBasicMaterial[];
}

function toWorld(point: Point, replay: Replay, height = 0) {
  return new THREE.Vector3(
    point.x - replay.arena.width / 2,
    height,
    point.y - replay.arena.height / 2,
  );
}

function setLine(line: THREE.Line, from: THREE.Vector3, to: THREE.Vector3) {
  const positions = line.geometry.getAttribute('position') as THREE.BufferAttribute;
  positions.setXYZ(0, from.x, from.y, from.z);
  positions.setXYZ(1, to.x, to.y, to.z);
  positions.needsUpdate = true;
  line.geometry.computeBoundingSphere();
  if (line.material instanceof THREE.LineDashedMaterial) line.computeLineDistances();
}

export function createPerceptionRig(replay: Replay): PerceptionRig {
  const group = new THREE.Group();
  const rangeDisc = new THREE.Mesh(
    new THREE.PlaneGeometry(replay.arena.width, replay.arena.height),
    new THREE.MeshBasicMaterial({
      color: 0x2fdcff,
      transparent: true,
      opacity: 0.065,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  rangeDisc.rotation.x = -Math.PI / 2;
  rangeDisc.position.y = 0.041;
  rangeDisc.renderOrder = 1;
  group.add(rangeDisc);

  const selectedHalo = new THREE.Mesh(
    new THREE.RingGeometry(0.52, 0.62, 44),
    new THREE.MeshBasicMaterial({
      color: 0x8cf1ff,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  selectedHalo.rotation.x = -Math.PI / 2;
  selectedHalo.position.y = 0.075;
  selectedHalo.renderOrder = 4;
  group.add(selectedHalo);

  const shadows = replay.arena.walls.map(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Array(18).fill(0), 3));
    const shadow = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color: 0x01060c,
      transparent: true,
      opacity: 0.68,
      side: THREE.DoubleSide,
      depthWrite: false,
    }));
    shadow.renderOrder = 2;
    group.add(shadow);
    return shadow;
  });

  const sightLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineDashedMaterial({
      color: 0x9effbc, transparent: true, opacity: 0.92,
      dashSize: 0.18, gapSize: 0.08, depthWrite: false,
    }),
  );
  sightLine.computeLineDistances();
  sightLine.renderOrder = 5;
  group.add(sightLine);

  const memoryLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineDashedMaterial({
      color: 0xffc46f, transparent: true, opacity: 0.48,
      dashSize: 0.12, gapSize: 0.14, depthWrite: false,
    }),
  );
  memoryLine.computeLineDistances();
  memoryLine.renderOrder = 4;
  group.add(memoryLine);

  const ghost = new THREE.Group();
  const ghostMaterials: THREE.MeshBasicMaterial[] = [];
  const ghostSurface = new THREE.MeshBasicMaterial({
    color: 0xffc46f,
    transparent: true,
    opacity: 0.18,
    wireframe: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ghostHull = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.24, 0.52), ghostSurface);
  ghostHull.position.y = 0.2;
  ghostMaterials.push(ghostSurface);
  const ghostRingMaterial = new THREE.MeshBasicMaterial({
    color: 0xffc46f,
    transparent: true,
    opacity: 0.65,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ghostRing = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 36), ghostRingMaterial);
  ghostRing.rotation.x = -Math.PI / 2;
  ghostRing.position.y = 0.055;
  ghostMaterials.push(ghostRingMaterial);
  const crossMaterial = new THREE.LineBasicMaterial({
    color: 0xffd89b, transparent: true, opacity: 0.68, depthWrite: false,
  });
  const cross = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.62, 0.07, 0), new THREE.Vector3(0.62, 0.07, 0),
    new THREE.Vector3(0, 0.07, -0.62), new THREE.Vector3(0, 0.07, 0.62),
  ]), crossMaterial);
  ghost.add(ghostHull, ghostRing, cross);
  ghost.visible = false;
  ghost.renderOrder = 6;
  group.add(ghost);

  group.visible = false;
  return { group, rangeDisc, selectedHalo, shadows, sightLine, memoryLine, ghost, ghostMaterials };
}

function updateShadow(
  shadow: THREE.Mesh,
  replay: Replay,
  observer: Point,
  wall: Replay['arena']['walls'][number],
) {
  const corners = [
    { x: wall.x, y: wall.y },
    { x: wall.x + wall.width, y: wall.y },
    { x: wall.x + wall.width, y: wall.y + wall.height },
    { x: wall.x, y: wall.y + wall.height },
  ];
  const center = { x: wall.x + wall.width / 2, y: wall.y + wall.height / 2 };
  const centerAngle = Math.atan2(center.y - observer.y, center.x - observer.x);
  const angular = corners.map(corner => ({
    corner,
    relative: Math.atan2(
      Math.sin(Math.atan2(corner.y - observer.y, corner.x - observer.x) - centerAngle),
      Math.cos(Math.atan2(corner.y - observer.y, corner.x - observer.x) - centerAngle),
    ),
  })).sort((first, second) => first.relative - second.relative);
  const nearA = angular[0].corner;
  const nearB = angular[angular.length - 1].corner;
  const farDistance = Math.max(replay.arena.width, replay.arena.height) * 3;
  const project = (point: Point) => {
    const dx = point.x - observer.x;
    const dy = point.y - observer.y;
    const length = Math.max(0.001, Math.hypot(dx, dy));
    return { x: observer.x + dx / length * farDistance, y: observer.y + dy / length * farDistance };
  };
  const farA = project(nearA);
  const farB = project(nearB);
  const world = [nearA, nearB, farB, nearA, farB, farA]
    .map(point => toWorld(point, replay, 0.052));
  const attribute = shadow.geometry.getAttribute('position') as THREE.BufferAttribute;
  world.forEach((point, index) => attribute.setXYZ(index, point.x, point.y, point.z));
  attribute.needsUpdate = true;
  shadow.geometry.computeBoundingSphere();
}

export function updatePerceptionRig(
  rig: PerceptionRig,
  replay: Replay,
  selected: Bot,
  enemy: Bot | undefined,
  sample: BehaviorSample | undefined,
  lastKnown: LastKnownTarget | undefined,
  elapsed: number,
) {
  const selectedWorld = toWorld(selected.position, replay, 0.08);
  rig.selectedHalo.position.set(selectedWorld.x, 0.075, selectedWorld.z);
  rig.selectedHalo.rotation.z = elapsed * 0.32;
  replay.arena.walls.forEach((wall, index) => updateShadow(rig.shadows[index], replay, selected.position, wall));

  const enemyVisible = sample?.enemyVisible === true && enemy != null && enemy.hp > 0;
  rig.sightLine.visible = enemyVisible;
  if (enemyVisible && enemy) {
    setLine(rig.sightLine, selectedWorld, toWorld(enemy.position, replay, 0.18));
  }

  rig.ghost.visible = !enemyVisible && lastKnown != null && (enemy?.hp ?? 1) > 0;
  rig.memoryLine.visible = rig.ghost.visible;
  if (rig.ghost.visible && lastKnown) {
    const ghostWorld = toWorld(lastKnown.position, replay);
    rig.ghost.position.copy(ghostWorld);
    rig.ghost.rotation.y = elapsed * 0.22;
    const fade = Math.max(0.16, Math.exp(-lastKnown.ageFrames / (replay.tickRate * 2.8)));
    rig.ghostMaterials[0].opacity = 0.08 + fade * 0.16;
    rig.ghostMaterials[1].opacity = 0.22 + fade * 0.52;
    rig.ghost.scale.setScalar(0.94 + Math.sin(elapsed * 3) * 0.05);
    setLine(rig.memoryLine, selectedWorld, toWorld(lastKnown.position, replay, 0.11));
  }

  const color = botColor(selected.id);
  (rig.rangeDisc.material as THREE.MeshBasicMaterial).color.setHex(color);
  (rig.selectedHalo.material as THREE.MeshBasicMaterial).color.setHex(color);
}
