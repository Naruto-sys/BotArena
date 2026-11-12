import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { BehaviorSample, Bot, Frame, Point, Replay } from './contracts';
import { directorStateAt, VISUAL_TAIL_FRAMES } from './cinematicDirector';
import type { CinematicShot, ShotPlan } from './cinematicDirector';
import { botColor } from './botVisuals';
import { createPerceptionRig, updatePerceptionRig } from './perceptionLayer';
import type { LastKnownTarget } from './perceptionLayer';
import { createTimeTower, updateTimeTower } from './timeTower';
import { createSafeZoneRig, updateSafeZoneRig } from './safeZoneLayer';
import { gunnerPose } from './gunnerCamera';
import { VIDEO_WIDTH, VIDEO_HEIGHT } from './replayVideo';
import { createGameplayLayer } from './gameplayLayer';

export type CameraMode = 'auto' | 'adaptive' | 'plan' | 'overview' | 'perception' | 'timeline' | `bot:${string}`;

const palette = {
  grid: 0x1f759b,
  structure: 0x55c9ee,
};

interface RenderState {
  frame: Frame;
  next: Frame;
  fraction: number;
  position: number;
  cameraMode: CameraMode;
  showTrails: boolean;
  showChronoXray: boolean;
  showTacticalTrace: boolean;
  traceBotId: string;
  perceptionBotId: string;
  onSeek: (position: number) => void;
  shotPlan: ShotPlan;
  captureEpoch: number;
  captureActive: boolean;
  onRenderFrame?: (canvas: HTMLCanvasElement, epoch: number) => void;
}

interface TankRig {
  root: THREE.Group;
  hull: THREE.Group;
  turret: THREE.Group;
  materials: THREE.Material[];
  winnerHalo: THREE.Mesh;
  winnerMaterial: THREE.MeshBasicMaterial;
}

interface ReplayEffect {
  frame: number;
  type: string;
  sourceBotId?: string;
  group: THREE.Group;
  materials: THREE.MeshBasicMaterial[];
  lights: THREE.PointLight[];
}

interface WallRig {
  group: THREE.Group;
  surface: THREE.MeshStandardMaterial;
  edges: THREE.LineBasicMaterial;
  section: THREE.MeshBasicMaterial;
  box: THREE.Box3;
}

interface AdaptivePose {
  style: 'orbit' | 'shoulder';
  azimuth: number;
  radius: number;
  height: number;
  lateral: number;
  fov: number;
}

interface BulletFlight {
  id: number;
  owner: string;
  startFrame: number;
  endFrame: number;
  start: Point;
  end: Point;
}

interface GhostRig {
  hulls: THREE.InstancedMesh;
  turrets: THREE.InstancedMesh;
}

export type TacticalPhase = 'search' | 'approach' | 'aim' | 'fire';

interface TacticalTraceRig {
  botId: string;
  group: THREE.Group;
  aimGroup: THREE.Group;
  ribbon: THREE.Mesh;
  centerLine: THREE.Line;
  markers: Array<{ tick: number; group: THREE.Group }>;
  samples: BehaviorSample[];
}

function mixPoint(start: Point, end: Point, fraction: number): Point {
  return {
    x: start.x + (end.x - start.x) * fraction,
    y: start.y + (end.y - start.y) * fraction,
  };
}

function mixAngle(start: number, end: number, fraction: number): number {
  const turn = Math.atan2(Math.sin(end - start), Math.cos(end - start));
  return start + turn * fraction;
}

function toWorld(point: Point, replay: Replay, height = 0): THREE.Vector3 {
  return new THREE.Vector3(
    point.x - replay.arena.width / 2,
    height,
    point.y - replay.arena.height / 2,
  );
}

function blueprintBox(
  width: number,
  height: number,
  depth: number,
  color: number,
  opacity = 0.18,
): { group: THREE.Group; materials: THREE.Material[] } {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const surface = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.25,
    transparent: true,
    opacity,
    roughness: 0.72,
    metalness: 0.1,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, surface);
  const lineMaterial = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), lineMaterial);
  group.add(mesh, edges);
  return { group, materials: [surface, lineMaterial] };
}

function blueprintWall(width: number, height: number, depth: number): WallRig {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const surface = new THREE.MeshStandardMaterial({
    color: 0x09283a,
    emissive: 0x0b5772,
    emissiveIntensity: 0.32,
    roughness: 0.82,
    metalness: 0.08,
    transparent: true,
    opacity: 1,
  });
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: palette.structure,
    transparent: true,
    opacity: 0.88,
  });
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    edgeMaterial,
  );
  const sectionMaterial = new THREE.MeshBasicMaterial({
    color: 0x6ce6ff,
    transparent: true,
    opacity: 0,
    wireframe: true,
    depthWrite: false,
  });
  const sectionMesh = new THREE.Mesh(geometry, sectionMaterial);
  sectionMesh.scale.setScalar(1.004);
  sectionMesh.renderOrder = 3;
  group.add(new THREE.Mesh(geometry, surface), sectionMesh, edges);
  return { group, surface, edges: edgeMaterial, section: sectionMaterial, box: new THREE.Box3() };
}

function createTank(color: number, movement?: Bot['movement']): TankRig {
  const root = new THREE.Group();
  const hull = new THREE.Group();
  const turret = new THREE.Group();
  const materials: THREE.Material[] = [];

  const hovering = movement === 'hover';
  const wheeled = movement === 'wheeled';
  const omni = movement === 'omni';
  const chassis = blueprintBox(hovering ? 0.63 : 0.72, hovering ? 0.13 : 0.24,
    wheeled ? 0.38 : 0.52, color, 0.24);
  chassis.group.position.y = hovering ? 0.27 : 0.2;
  hull.add(chassis.group);
  materials.push(...chassis.materials);

  for (const side of [-1, 1]) {
    if (wheeled || omni) {
      for (const axle of [-1, 1]) {
        const wheel = blueprintBox(omni ? 0.12 : 0.22, 0.15, omni ? 0.18 : 0.12, color, 0.16);
        wheel.group.position.set(axle * 0.23, 0.13, side * 0.28);
        if (omni) wheel.group.rotation.y = axle * side * Math.PI / 4;
        hull.add(wheel.group);
        materials.push(...wheel.materials);
      }
    } else {
      const runner = blueprintBox(hovering ? 0.54 : 0.75, hovering ? 0.08 : 0.15,
        hovering ? 0.16 : 0.11, color, 0.1);
      runner.group.position.set(0, hovering ? 0.21 : 0.13, side * 0.31);
      hull.add(runner.group);
      materials.push(...runner.materials);
    }
  }

  if (omni) {
    const headingGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0.26, 0.34, -0.11),
      new THREE.Vector3(0.43, 0.34, 0),
      new THREE.Vector3(0.26, 0.34, 0.11),
    ]);
    const headingMaterial = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });
    hull.add(new THREE.Line(headingGeometry, headingMaterial));
    materials.push(headingMaterial);
  }

  const turretGeometry = new THREE.CylinderGeometry(0.19, 0.22, 0.16, 10);
  const turretSurface = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.35,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  });
  const turretMesh = new THREE.Mesh(turretGeometry, turretSurface);
  turretMesh.position.y = 0.39;
  const turretLines = new THREE.LineSegments(
    new THREE.EdgesGeometry(turretGeometry),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 }),
  );
  turretLines.position.copy(turretMesh.position);
  turret.add(turretMesh, turretLines);
  materials.push(turretSurface, turretLines.material as THREE.Material);

  const barrel = blueprintBox(0.54, 0.07, 0.075, color, 0.42);
  barrel.group.position.set(0.34, 0.4, 0);
  turret.add(barrel.group);
  materials.push(...barrel.materials);

  const axisGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0.02, 0),
    new THREE.Vector3(0.82, 0.02, 0),
  ]);
  const axisMaterial = new THREE.LineDashedMaterial({
    color,
    transparent: true,
    opacity: 0.32,
    dashSize: 0.12,
    gapSize: 0.07,
  });
  const aimAxis = new THREE.Line(axisGeometry, axisMaterial);
  aimAxis.computeLineDistances();
  aimAxis.position.y = 0.4;
  turret.add(aimAxis);
  materials.push(axisMaterial);

  root.add(hull, turret);
  const winnerMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const winnerHalo = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.88, 40), winnerMaterial);
  winnerHalo.rotation.x = -Math.PI / 2;
  winnerHalo.position.y = 0.025;
  winnerHalo.visible = false;
  root.add(winnerHalo);
  materials.forEach(material => {
    if ('opacity' in material) material.userData.blueprintOpacity = material.opacity;
  });
  return { root, hull, turret, materials, winnerHalo, winnerMaterial };
}

function createGrid(replay: Replay): THREE.Group {
  const group = new THREE.Group();
  const { width, height } = replay.arena;
  const points: THREE.Vector3[] = [];
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const step = 0.5;

  for (let x = -halfWidth; x <= halfWidth + 0.001; x += step) {
    points.push(new THREE.Vector3(x, 0.005, -halfHeight), new THREE.Vector3(x, 0.005, halfHeight));
  }
  for (let z = -halfHeight; z <= halfHeight + 0.001; z += step) {
    points.push(new THREE.Vector3(-halfWidth, 0.005, z), new THREE.Vector3(halfWidth, 0.005, z));
  }

  const gridMaterial = new THREE.LineBasicMaterial({
    color: palette.grid,
    transparent: true,
    opacity: 0.22,
  });
  group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), gridMaterial));

  const borderPoints = [
    new THREE.Vector3(-halfWidth, 0.025, -halfHeight),
    new THREE.Vector3(halfWidth, 0.025, -halfHeight),
    new THREE.Vector3(halfWidth, 0.025, halfHeight),
    new THREE.Vector3(-halfWidth, 0.025, halfHeight),
    new THREE.Vector3(-halfWidth, 0.025, -halfHeight),
  ];
  group.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(borderPoints),
    new THREE.LineBasicMaterial({ color: 0x70dcff, transparent: true, opacity: 0.9 }),
  ));
  return group;
}

export function tacticalPhase(sample: BehaviorSample): TacticalPhase {
  if (sample.action.shoot) return 'fire';
  if (!sample.enemyVisible) return 'search';
  const aim = sample.action.aimDirection;
  const aimAngle = Math.atan2(aim.y, aim.x);
  const aimError = Math.abs(Math.atan2(
    Math.sin(aimAngle - sample.turretAngle), Math.cos(aimAngle - sample.turretAngle),
  ));
  const throttle = actionThrottle(sample.action);
  if (aimError > 0.08 || throttle < 0.12) return 'aim';
  return 'approach';
}

function actionThrottle(action: BehaviorSample['action']) {
  const tracked = Math.abs((action.leftTrack + action.rightTrack) / 2);
  const thrust = action.thrust ? Math.hypot(action.thrust.x, action.thrust.y) : 0;
  return Math.min(1, Math.max(tracked, Math.abs(action.throttle ?? 0), thrust));
}

function actionTurn(action: BehaviorSample['action']) {
  return Math.min(1, Math.max(
    Math.abs(action.leftTrack - action.rightTrack) / 2,
    Math.abs(action.turn ?? 0),
  ));
}

function tacticalColor(phase: TacticalPhase, base: THREE.Color) {
  if (phase === 'search') return new THREE.Color(0x426b82);
  if (phase === 'aim') return new THREE.Color(0xb779ff);
  if (phase === 'fire') return new THREE.Color(0xffc46f);
  return base.clone();
}

export function tacticalPhaseLabel(phase: TacticalPhase) {
  return phase === 'search' ? 'ПОИСК'
    : phase === 'approach' ? 'СБЛИЖЕНИЕ'
    : phase === 'aim' ? 'НАВЕДЕНИЕ' : 'ОГОНЬ';
}

function createPhaseMarker(label: string, color: THREE.Color) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (context) {
    const cssColor = `#${color.getHexString()}`;
    context.fillStyle = 'rgba(3, 18, 29, .88)';
    context.fillRect(4, 4, 376, 88);
    context.strokeStyle = cssColor;
    context.lineWidth = 4;
    context.strokeRect(4, 4, 376, 88);
    context.fillStyle = cssColor;
    context.font = '700 32px monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, 192, 49);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  }));
  sprite.scale.set(1.45, 0.36, 1);
  sprite.renderOrder = 8;
  return sprite;
}

function createTacticalTrace(replay: Replay, botId: string, samples: BehaviorSample[]): TacticalTraceRig {
  const group = new THREE.Group();
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const base = new THREE.Color(botColor(botId));
  const centerPoints: THREE.Vector3[] = [];
  let previousSide = new THREE.Vector3(0, 0, 1);

  samples.forEach((sample, index) => {
    const previous = samples[Math.max(0, index - 1)];
    const next = samples[Math.min(samples.length - 1, index + 1)];
    const tangent = new THREE.Vector3(
      next.position.x - previous.position.x, 0, next.position.y - previous.position.y,
    );
    if (tangent.lengthSq() < 0.0001) tangent.set(Math.cos(sample.bodyAngle), 0, Math.sin(sample.bodyAngle));
    tangent.normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x);
    if (side.dot(previousSide) < 0) side.multiplyScalar(-1);
    previousSide = side.clone();
    const throttle = actionThrottle(sample.action);
    const turn = actionTurn(sample.action);
    const halfWidth = 0.075 + throttle * 0.11 + turn * 0.045;
    const center = toWorld(sample.position, replay, 0.048);
    centerPoints.push(center);
    const color = tacticalColor(tacticalPhase(sample), base);
    for (const point of [center.clone().addScaledVector(side, halfWidth), center.clone().addScaledVector(side, -halfWidth)]) {
      positions.push(point.x, point.y, point.z);
      colors.push(color.r, color.g, color.b);
    }
    if (index > 0) {
      const offset = index * 2;
      indices.push(offset - 2, offset - 1, offset, offset, offset - 1, offset + 1);
    }
  });

  const ribbonGeometry = new THREE.BufferGeometry();
  ribbonGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  ribbonGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  ribbonGeometry.setIndex(indices);
  const ribbon = new THREE.Mesh(ribbonGeometry, new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  ribbon.renderOrder = 2;
  group.add(ribbon);

  const centerLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(centerPoints),
    new THREE.LineDashedMaterial({ color: botColor(botId), transparent: true, opacity: 0.78, dashSize: 0.11, gapSize: 0.06 }),
  );
  centerLine.computeLineDistances();
  centerLine.renderOrder = 3;
  group.add(centerLine);

  const markers: Array<{ tick: number; group: THREE.Group }> = [];
  let previousPhase: TacticalPhase | undefined;
  let previousMarkerTick = -Infinity;
  let markerCount = 0;
  samples.forEach(sample => {
    const phase = tacticalPhase(sample);
    const importantTransition = phase !== previousPhase
      && (sample.tick - previousMarkerTick >= 5 || phase === 'fire');
    if (importantTransition && markerCount < 12) {
      const color = tacticalColor(phase, base);
      const marker = createPhaseMarker(tacticalPhaseLabel(phase), color);
      marker.position.y = 0.32;
      const stem = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0.06, 0), new THREE.Vector3(0, 0.25, 0),
        ]),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false }),
      );
      stem.renderOrder = 7;
      const markerGroup = new THREE.Group();
      markerGroup.position.copy(toWorld(sample.position, replay));
      markerGroup.add(marker, stem);
      markerGroup.visible = false;
      group.add(markerGroup);
      markers.push({ tick: sample.tick, group: markerGroup });
      previousMarkerTick = sample.tick;
      markerCount += 1;
    }
    previousPhase = phase;
  });

  const aimGroup = new THREE.Group();
  const coneGeometry = new THREE.BufferGeometry();
  coneGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 1.8, 0, -0.3, 1.8, 0, 0.3,
  ], 3));
  coneGeometry.setIndex([0, 1, 2]);
  const cone = new THREE.Mesh(coneGeometry, new THREE.MeshBasicMaterial({
    color: botColor(botId), transparent: true, opacity: 0.12,
    side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  const aimLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1.9, 0, 0)]),
    new THREE.LineDashedMaterial({
      color: botColor(botId), transparent: true, opacity: 0.65, dashSize: 0.12, gapSize: 0.07, depthWrite: false,
    }),
  );
  aimLine.computeLineDistances();
  aimGroup.add(cone, aimLine);
  aimGroup.visible = false;
  aimGroup.renderOrder = 4;
  group.add(aimGroup);
  group.visible = false;
  return { botId, group, aimGroup, ribbon, centerLine, markers, samples };
}

function createEffect(replay: Replay, event: Frame['events'][number], frame: number): ReplayEffect | null {
  if (!event.position || event.type === 'MatchFinished') return null;
  const hit = event.type === 'BotHit' || event.type === 'BotDestroyed';
  const muzzle = event.type === 'ShotFired';
  const color = hit ? 0xffd79a : event.sourceBotId ? botColor(event.sourceBotId) : 0x8deaff;
  let effectPosition = event.position;
  if (muzzle && event.sourceBotId) {
    const source = replay.frames[frame]?.bots.find(bot => bot.id === event.sourceBotId);
    if (source) {
      effectPosition = {
        x: source.position.x + Math.cos(source.turretAngle) * 0.62,
        y: source.position.y + Math.sin(source.turretAngle) * 0.62,
      };
    }
  }
  const group = new THREE.Group();
  group.position.copy(toWorld(effectPosition, replay, muzzle ? 0.4 : 0.08));
  const materials: THREE.MeshBasicMaterial[] = [];
  const lights: THREE.PointLight[] = [];

  const ringMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.15, 32), ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  group.add(ring);
  materials.push(ringMaterial);

  if (muzzle) {
    ring.rotation.x = 0;
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: 0xfff0bd,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 1), coreMaterial);
    const haloMaterial = coreMaterial.clone();
    haloMaterial.color.setHex(color);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), haloMaterial);
    halo.scale.set(1.8, 0.65, 1.8);
    const light = new THREE.PointLight(0xffc56e, 0, 3.8, 2);
    group.add(core, halo, light);
    materials.push(coreMaterial, haloMaterial);
    lights.push(light);
  } else if (hit) {
    const verticalMaterial = ringMaterial.clone();
    const verticalRing = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.135, 24), verticalMaterial);
    verticalRing.position.y = 0.18;
    group.add(verticalRing);
    materials.push(verticalMaterial);
    const light = new THREE.PointLight(0xffb35e, 0, 3.2, 2);
    light.position.y = 0.22;
    group.add(light);
    lights.push(light);
  }

  group.visible = false;
  return { frame, type: event.type, sourceBotId: event.sourceBotId ?? undefined, group, materials, lights };
}

function interpolatedBot(state: RenderState, id: Bot['id']): Bot | undefined {
  const start = state.frame.bots.find(bot => bot.id === id);
  if (!start) return undefined;
  const end = state.next.bots.find(bot => bot.id === id) ?? start;
  return {
    ...start,
    position: mixPoint(start.position, end.position, state.fraction),
    bodyAngle: mixAngle(start.bodyAngle, end.bodyAngle, state.fraction),
    turretAngle: mixAngle(start.turretAngle, end.turretAngle, state.fraction),
  };
}

function disposeScene(scene: THREE.Scene) {
  const disposeMaterial = (material: THREE.Material) => {
    Object.values(material).forEach(value => {
      if (value instanceof THREE.Texture) value.dispose();
    });
    material.dispose();
  };
  scene.traverse(object => {
    const renderable = object as THREE.Mesh;
    renderable.geometry?.dispose();
    const material = renderable.material;
    if (Array.isArray(material)) material.forEach(disposeMaterial);
    else if (material) disposeMaterial(material);
  });
}

export function BlueprintArena({
  replay,
  frame,
  next,
  fraction,
  position,
  cameraMode,
  showTrails,
  showChronoXray,
  showTacticalTrace,
  traceBotId,
  perceptionBotId,
  onSeek,
  shotPlan,
  captureEpoch = 0,
  captureActive = false,
  onRenderFrame,
}: {
  replay: Replay;
  frame: Frame;
  next: Frame;
  fraction: number;
  position: number;
  cameraMode: CameraMode;
  showTrails: boolean;
  showChronoXray: boolean;
  showTacticalTrace: boolean;
  traceBotId: string;
  perceptionBotId: string;
  onSeek: (position: number) => void;
  shotPlan: ShotPlan;
  captureEpoch?: number;
  captureActive?: boolean;
  onRenderFrame?: (canvas: HTMLCanvasElement, epoch: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const renderState = useRef<RenderState>({
    frame, next, fraction, position, cameraMode, showTrails,
    showChronoXray, showTacticalTrace, traceBotId, perceptionBotId, onSeek, shotPlan, captureEpoch, captureActive, onRenderFrame,
  });
  const [webglError, setWebglError] = useState(false);

  useEffect(() => {
    renderState.current = {
      frame, next, fraction, position, cameraMode, showTrails,
      showChronoXray, showTacticalTrace, traceBotId, perceptionBotId, onSeek, shotPlan, captureEpoch, captureActive, onRenderFrame,
    };
  }, [frame, next, fraction, position, cameraMode, showTrails,
    showChronoXray, showTacticalTrace, traceBotId, perceptionBotId, onSeek, shotPlan, captureEpoch, captureActive, onRenderFrame]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch {
      setWebglError(true);
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.domElement.className = 'blueprint-canvas';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x04121f);
    scene.fog = new THREE.FogExp2(0x04121f, 0.032);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
    const maxDimension = Math.max(replay.arena.width, replay.arena.height);
    camera.position.set(maxDimension * 0.35, maxDimension * 0.72, maxDimension * 0.5);

    const ambient = new THREE.HemisphereLight(0x8ce7ff, 0x03101d, 1.4);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0x7fe7ff, 2.3);
    key.position.set(-4, 10, 5);
    scene.add(key);

    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x071e30,
      emissive: 0x06182a,
      emissiveIntensity: 0.8,
      roughness: 0.9,
    });
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(replay.arena.width, replay.arena.height),
      floorMaterial,
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor, createGrid(replay));
    const gameplayLayer = createGameplayLayer(replay);
    scene.add(gameplayLayer.group);

    const safeZoneRig = createSafeZoneRig(replay.arena);
    scene.add(safeZoneRig.group);

    const wallRigs: WallRig[] = [];
    for (const wall of replay.arena.walls) {
      const blueprint = blueprintWall(wall.width, 0.95, wall.height);
      blueprint.group.position.set(
        wall.x + wall.width / 2 - replay.arena.width / 2,
        0.475,
        wall.y + wall.height / 2 - replay.arena.height / 2,
      );
      scene.add(blueprint.group);
      blueprint.group.updateMatrixWorld(true);
      blueprint.box.setFromObject(blueprint.group);
      wallRigs.push(blueprint);
    }

    const roster = new Map<string, Bot['movement']>();
    for (const frame of replay.frames)
      for (const bot of frame.bots)
        if (!roster.has(bot.id)) roster.set(bot.id, bot.movement);
    const botIds = [...roster.keys()];
    const tanks = new Map<string, TankRig>();
    for (const [id, movement] of roster) {
      const tank = createTank(botColor(id), movement);
      tanks.set(id, tank);
      scene.add(tank.root);
    }

    const ghostRigs = new Map<string, GhostRig>();
    const ghostCount = 9;
    for (const id of botIds) {
      const material = new THREE.MeshBasicMaterial({
        color: botColor(id),
        transparent: true,
        opacity: 0.13,
        wireframe: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const hulls = new THREE.InstancedMesh(new THREE.BoxGeometry(0.72, 0.24, 0.52), material, ghostCount);
      const turrets = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.19, 0.22, 0.16, 10), material.clone(), ghostCount,
      );
      hulls.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      turrets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      hulls.count = 0;
      turrets.count = 0;
      hulls.renderOrder = 4;
      turrets.renderOrder = 4;
      ghostRigs.set(id, { hulls, turrets });
      scene.add(hulls, turrets);
    }

    const samplesByBot = new Map<string, BehaviorSample[]>();
    for (const sample of replay.behaviorSamples ?? []) {
      const samples = samplesByBot.get(sample.botId) ?? [];
      samples.push(sample);
      samplesByBot.set(sample.botId, samples);
    }
    const tacticalTraces: TacticalTraceRig[] = [];
    for (const id of botIds) {
      const samples = samplesByBot.get(id);
      if (!samples?.length) continue;
      const trace = createTacticalTrace(replay, id, samples);
      tacticalTraces.push(trace);
      scene.add(trace.group);
    }
    const perceptionRig = createPerceptionRig(replay);
    scene.add(perceptionRig.group);
    const timeTowerRig = createTimeTower(replay);
    scene.add(timeTowerRig.group);

    const bulletOwners = new Map<number, string>();
    replay.frames.forEach(item => item.bullets.forEach(bullet => bulletOwners.set(bullet.id, bullet.ownerBotId)));
    replay.frames.forEach(item => item.events.forEach(event => {
      if (event.type === 'ShotFired' && event.bulletId != null && event.sourceBotId) {
        bulletOwners.set(event.bulletId, event.sourceBotId);
      }
    }));
    const bulletFlights = new Map<number, BulletFlight>();
    const pendingShots = new Map<number, Omit<BulletFlight, 'endFrame' | 'end'>>();
    replay.frames.forEach((item, frameIndex) => item.events.forEach(event => {
      if (event.type === 'ShotFired' && event.bulletId != null && event.sourceBotId && event.position) {
        const source = item.bots.find(bot => bot.id === event.sourceBotId);
        const start = source ? {
          x: source.position.x + Math.cos(source.turretAngle) * 0.62,
          y: source.position.y + Math.sin(source.turretAngle) * 0.62,
        } : event.position;
        pendingShots.set(event.bulletId, {
          id: event.bulletId,
          owner: event.sourceBotId,
          startFrame: frameIndex,
          start,
        });
      } else if (event.type === 'BotHit' && event.bulletId != null && event.position) {
        const shot = pendingShots.get(event.bulletId);
        if (shot) {
          bulletFlights.set(event.bulletId, {
            ...shot,
            endFrame: frameIndex === shot.startFrame ? frameIndex + 0.75 : frameIndex,
            end: event.position,
          });
        }
      }
    }));
    const bullets = new Map<number, THREE.Group>();
    for (const [id, owner] of bulletOwners) {
      const bullet = blueprintBox(0.22, 0.075, 0.08, botColor(owner), 0.7).group;
      bullet.visible = false;
      bullets.set(id, bullet);
      scene.add(bullet);
    }

    const chronoProjectileMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd28a,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const chronoProjectileSlices = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.2, 0.065, 0.065), chronoProjectileMaterial, 14,
    );
    chronoProjectileSlices.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    chronoProjectileSlices.count = 0;
    chronoProjectileSlices.renderOrder = 5;
    scene.add(chronoProjectileSlices);

    const chronoReticle = new THREE.Group();
    const chronoReticleMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd28a,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    for (const rotation of [
      new THREE.Euler(-Math.PI / 2, 0, 0),
      new THREE.Euler(0, 0, 0),
      new THREE.Euler(0, Math.PI / 2, 0),
    ]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.35, 40), chronoReticleMaterial.clone());
      ring.rotation.copy(rotation);
      chronoReticle.add(ring);
    }
    chronoReticle.visible = false;
    chronoReticle.renderOrder = 6;
    scene.add(chronoReticle);

    const trailLines = new Map<string, THREE.Line>();
    for (const id of botIds) {
      const points = replay.frames
        .map(item => item.bots.find(bot => bot.id === id))
        .filter((bot): bot is Bot => bot !== undefined)
        .map(bot => toWorld(bot.position, replay, 0.035));
      const material = new THREE.LineDashedMaterial({
        color: botColor(id),
        transparent: true,
        opacity: 0.42,
        dashSize: 0.16,
        gapSize: 0.1,
      });
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
      line.computeLineDistances();
      line.geometry.setDrawRange(0, 1);
      trailLines.set(id, line);
      scene.add(line);
    }

    const effects: ReplayEffect[] = [];
    replay.frames.forEach((item, frameIndex) => item.events.forEach(event => {
      const effect = createEffect(replay, event, frameIndex);
      if (effect) {
        effects.push(effect);
        scene.add(effect.group);
      }
    }));

    const cameraTarget = new THREE.Vector3();
    const desiredTarget = new THREE.Vector3();
    const desiredPosition = new THREE.Vector3();
    const desiredUp = new THREE.Vector3(0, 1, 0);
    const previousTarget = new THREE.Vector3();
    const previousPosition = new THREE.Vector3();
    const previousUp = new THREE.Vector3(0, 1, 0);

    const setDirectorGoal = (
      shot: CinematicShot,
      bots: Map<string, Bot>,
      state: RenderState,
      timelinePosition: number,
      outputPosition: THREE.Vector3,
      outputTarget: THREE.Vector3,
      outputUp: THREE.Vector3,
    ) => {
      const visibleBots = [...bots.values()];
      const subject = shot.subject ? bots.get(shot.subject) : undefined;
      const botPositions = visibleBots.map(bot => toWorld(bot.position, replay, 0.2));
      const subjectPosition = subject ? toWorld(subject.position, replay, 0.24) : undefined;
      const progress = THREE.MathUtils.clamp(
        (timelinePosition - shot.startFrame) / Math.max(1, shot.endFrame - shot.startFrame), 0, 1,
      );
      let radius = maxDimension * 0.52;
      let height = maxDimension * 0.56;
      let azimuth = shot.azimuth;
      let fov = 38;

      outputUp.set(0, 1, 0);
      if (shot.kind === 'gunner' && subject) {
        const pose = gunnerPose(subject, replay.arena, shot.focus, shot.eventFrame ?? shot.startFrame, timelinePosition);
        outputPosition.set(pose.position.x, pose.position.y, pose.position.z);
        outputTarget.set(pose.target.x, pose.target.y, pose.target.z);
        return pose.fov;
      }
      if (shot.kind === 'projectile' && subjectPosition && subject) {
        const forward = new THREE.Vector3(Math.cos(subject.turretAngle), 0, Math.sin(subject.turretAngle));
        const shoulder = new THREE.Vector3(-forward.z, 0, forward.x).multiplyScalar(
          botColor(subject.id) % 2 === 0 ? 0.36 : -0.36,
        );
        const bulletStart = state.frame.bullets.find(bullet => bullet.id === shot.bulletId);
        const bulletEnd = state.next.bullets.find(bullet => bullet.id === shot.bulletId) ?? bulletStart;
        let bulletPosition = bulletStart && bulletEnd
          ? toWorld(mixPoint(bulletStart.position, bulletEnd.position, state.fraction), replay, 0.31)
          : undefined;
        const syntheticFlight = shot.bulletId == null ? undefined : bulletFlights.get(shot.bulletId);
        if (!bulletPosition && syntheticFlight && timelinePosition >= syntheticFlight.startFrame) {
          const flightProgress = THREE.MathUtils.clamp(
            (timelinePosition - syntheticFlight.startFrame)
              / Math.max(0.001, syntheticFlight.endFrame - syntheticFlight.startFrame),
            0, 1,
          );
          bulletPosition = toWorld(mixPoint(syntheticFlight.start, syntheticFlight.end, flightProgress), replay, 0.31);
        }
        const muzzleTarget = subjectPosition.clone().addScaledVector(forward, 1.25);
        outputTarget.copy(muzzleTarget);
        if (bulletPosition) outputTarget.lerp(bulletPosition, 0.38 + progress * 0.16);
        outputPosition.copy(subjectPosition)
          .addScaledVector(forward, -2.15 + progress * 0.32)
          .add(shoulder)
          .add(new THREE.Vector3(0, 0.92 + progress * 0.08, 0));
        return 47;
      }
      if (shot.kind === 'establishing') {
        outputTarget.set(0, 0.08, 0);
        radius = maxDimension * 0.64;
        height = maxDimension * 0.68;
        fov = 40;
      } else if (shot.kind === 'duel') {
        if (botPositions.length) {
          outputTarget.copy(botPositions.reduce((sum, point) => sum.add(point), new THREE.Vector3()))
            .multiplyScalar(1 / botPositions.length);
          let separation = 0;
          for (let first = 0; first < botPositions.length; first += 1) {
            for (let second = first + 1; second < botPositions.length; second += 1) {
              separation = Math.max(separation, botPositions[first].distanceTo(botPositions[second]));
            }
          }
          radius = Math.max(maxDimension * 0.32, separation * 0.72 + 2.2);
          height = Math.max(maxDimension * 0.3, separation * 0.36 + 1.7);
        } else {
          outputTarget.set(0, 0.18, 0);
        }
        fov = 36;
      } else if (shot.kind === 'follow' && subjectPosition) {
        const forward = new THREE.Vector3(Math.cos(subject!.bodyAngle), 0, Math.sin(subject!.bodyAngle));
        outputTarget.copy(subjectPosition).addScaledVector(forward, 0.65);
        radius = 3.1;
        height = 1.65;
        fov = 42;
      } else {
        const eventFocus = shot.focus ? toWorld(shot.focus, replay, 0.3) : undefined;
        outputTarget.copy(eventFocus ?? subjectPosition ?? botPositions[0] ?? new THREE.Vector3());
        if (shot.kind === 'impact') {
          radius = 3.15;
          height = 1.55;
          fov = 31;
        } else {
          radius = 3.7;
          height = 1.85;
          azimuth += progress * 0.24;
          fov = 29;
        }
      }

      outputPosition.copy(outputTarget).add(new THREE.Vector3(
        Math.cos(azimuth) * radius,
        height,
        Math.sin(azimuth) * radius,
      ));
      return fov;
    };

    const candidateCamera = new THREE.PerspectiveCamera(45, 1, 0.05, 80);
    const ray = new THREE.Ray();
    const rayDirection = new THREE.Vector3();
    const rayHit = new THREE.Vector3();
    const closestPoint = new THREE.Vector3();
    const normalWallColor = new THREE.Color(0x09283a);
    const cutWallColor = new THREE.Color(0x08799c);

    const wallBlocks = (from: THREE.Vector3, to: THREE.Vector3, box: THREE.Box3) => {
      const distance = from.distanceTo(to);
      if (distance < 0.01) return false;
      rayDirection.subVectors(to, from).normalize();
      ray.set(from, rayDirection);
      const intersection = ray.intersectBox(box, rayHit);
      return intersection !== null && from.distanceTo(intersection) < distance - 0.12;
    };

    const predictedBots = (position: number) => {
      const frameIndex = THREE.MathUtils.clamp(
        Math.round(position + 6), 0, replay.frames.length - 1,
      );
      return replay.frames[frameIndex]?.bots ?? [];
    };

    const selectAdaptivePose = (
      shot: CinematicShot,
      state: RenderState,
      currentTarget: THREE.Vector3,
    ): AdaptivePose => {
      const futureBots = predictedBots(state.position);
      const subject = shot.subject ? futureBots.find(bot => bot.id === shot.subject) : undefined;
      const points = futureBots.map(bot => toWorld(bot.position, replay, 0.28));
      if (shot.focus) points.push(toWorld(shot.focus, replay, 0.3));
      const predictedTarget = points.length
        ? points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / points.length)
        : currentTarget.clone();
      if (shot.kind === 'impact' || shot.kind === 'finale') predictedTarget.copy(currentTarget);

      const poses: AdaptivePose[] = [];
      if (shot.kind === 'projectile' && subject) {
        for (const radius of [1.45, 1.9, 2.4]) {
          for (const height of [0.78, 1.12, 1.52]) {
            for (const lateral of [-0.44, 0.44]) {
              poses.push({ style: 'shoulder', azimuth: 0, radius, height, lateral, fov: radius < 1.7 ? 56 : 49 });
            }
          }
        }
      }
      for (let index = 0; index < 12; index += 1) {
        const azimuth = shot.azimuth + index * Math.PI / 6;
        for (const radius of [2.15, 3.05, 4.35]) {
          for (const height of [1.25, 2.2, 3.75]) {
            poses.push({
              style: 'orbit',
              azimuth,
              radius,
              height,
              lateral: 0,
              fov: radius < 2.5 ? 56 : radius < 3.5 ? 47 : 39,
            });
          }
        }
      }

      let best = poses[0];
      let bestScore = -Infinity;
      const subjectPosition = subject ? toWorld(subject.position, replay, 0.24) : undefined;
      const forward = subject
        ? new THREE.Vector3(Math.cos(subject.turretAngle), 0, Math.sin(subject.turretAngle))
        : new THREE.Vector3(1, 0, 0);

      for (const pose of poses) {
        const candidatePosition = new THREE.Vector3();
        if (pose.style === 'shoulder' && subjectPosition) {
          const shoulder = new THREE.Vector3(-forward.z, 0, forward.x).multiplyScalar(pose.lateral);
          candidatePosition.copy(subjectPosition).addScaledVector(forward, -pose.radius)
            .add(shoulder).add(new THREE.Vector3(0, pose.height, 0));
        } else {
          candidatePosition.copy(predictedTarget).add(new THREE.Vector3(
            Math.cos(pose.azimuth) * pose.radius,
            pose.height,
            Math.sin(pose.azimuth) * pose.radius,
          ));
        }

        let score = pose.style === 'shoulder' && shot.kind === 'projectile' ? 11 : 0;
        for (const wall of wallRigs) {
          const padded = wall.box.clone().expandByScalar(0.18);
          if (padded.containsPoint(candidatePosition)) score -= 200;
          padded.clampPoint(candidatePosition, closestPoint);
          const clearance = closestPoint.distanceTo(candidatePosition);
          if (clearance < 0.7) score -= (0.7 - clearance) * 22;
        }

        for (const point of points) {
          const blocked = wallRigs.some(wall => wallBlocks(candidatePosition, point, wall.box));
          score += blocked ? -17 : 7;
        }

        candidateCamera.position.copy(candidatePosition);
        candidateCamera.up.set(0, 1, 0);
        candidateCamera.aspect = camera.aspect;
        candidateCamera.fov = pose.fov;
        candidateCamera.lookAt(predictedTarget);
        candidateCamera.updateProjectionMatrix();
        candidateCamera.updateMatrixWorld(true);
        const projected: THREE.Vector3[] = [];
        for (const point of points) {
          const screen = point.clone().project(candidateCamera);
          projected.push(screen);
          const safe = screen.z > 0 && screen.z < 1 && Math.abs(screen.x) < 0.88 && Math.abs(screen.y) < 0.8;
          score += safe ? 6 : -15;
        }
        if (projected.length >= 2) {
          let spread = 0;
          for (let first = 0; first < projected.length; first += 1) {
            for (let second = first + 1; second < projected.length; second += 1) {
              spread = Math.max(spread, Math.hypot(
                projected[first].x - projected[second].x,
                projected[first].y - projected[second].y,
              ));
            }
          }
          score += Math.min(spread, 0.72) * 8;
          if (spread > 1.45) score -= 12;
        }
        score -= candidatePosition.distanceTo(camera.position) * 0.06;
        if (score > bestScore) {
          bestScore = score;
          best = pose;
        }
      }
      return best;
    };

    const applyAdaptivePose = (
      pose: AdaptivePose,
      shot: CinematicShot,
      bots: Map<string, Bot>,
      outputPosition: THREE.Vector3,
      outputTarget: THREE.Vector3,
    ) => {
      const subject = shot.subject ? bots.get(shot.subject) : undefined;
      if (pose.style === 'shoulder' && subject) {
        const subjectPosition = toWorld(subject.position, replay, 0.24);
        const forward = new THREE.Vector3(Math.cos(subject.turretAngle), 0, Math.sin(subject.turretAngle));
        const shoulder = new THREE.Vector3(-forward.z, 0, forward.x).multiplyScalar(pose.lateral);
        outputPosition.copy(subjectPosition).addScaledVector(forward, -pose.radius)
          .add(shoulder).add(new THREE.Vector3(0, pose.height, 0));
      } else {
        outputPosition.copy(outputTarget).add(new THREE.Vector3(
          Math.cos(pose.azimuth) * pose.radius,
          pose.height,
          Math.sin(pose.azimuth) * pose.radius,
        ));
      }
      return pose.fov;
    };
    const resize = () => {
      const recording = renderState.current.captureActive;
      const width = recording ? VIDEO_WIDTH : Math.max(1, host.clientWidth);
      const height = recording ? VIDEO_HEIGHT : Math.max(1, host.clientHeight);
      renderer.setPixelRatio(recording ? 1 : Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    const timeRaycaster = new THREE.Raycaster();
    const timePointer = new THREE.Vector2();
    const seekFromTower = (event: PointerEvent) => {
      const state = renderState.current;
      if (state.cameraMode !== 'timeline') return;
      const bounds = renderer.domElement.getBoundingClientRect();
      timePointer.set(
        (event.clientX - bounds.left) / bounds.width * 2 - 1,
        -(event.clientY - bounds.top) / bounds.height * 2 + 1,
      );
      timeRaycaster.setFromCamera(timePointer, camera);
      const hit = timeRaycaster.intersectObjects(timeTowerRig.group.children, true)
        .find(intersection => intersection.object.userData.timePickable === true);
      if (!hit) return;
      const framePosition = THREE.MathUtils.clamp(
        (hit.point.y - 0.08) / timeTowerRig.timeScale,
        0,
        replay.frames.length - 1,
      );
      state.onSeek(framePosition);
    };
    renderer.domElement.addEventListener('pointerdown', seekFromTower);

    const clock = new THREE.Clock();
    let animationFrame = 0;
    let activeDirectorShotId = '';
    let lastCaptureEpoch = 0;
    let renderingCapture = false;
    let adaptiveShotId = '';
    let adaptivePose: AdaptivePose | undefined;
    let activeChronoShotId = '';
    let chronoElapsed = 0;
    const chronoDummy = new THREE.Object3D();
    const verticalAxis = new THREE.Vector3(0, 1, 0);

    const render = () => {
      animationFrame = requestAnimationFrame(render);
      const state = renderState.current;
      if (renderingCapture !== state.captureActive) { renderingCapture = state.captureActive; resize(); }
      const delta = Math.min(clock.getDelta(), 0.05);
      const resetCaptureCamera = state.captureEpoch !== lastCaptureEpoch;
      if (resetCaptureCamera) {
        lastCaptureEpoch = state.captureEpoch;
        activeDirectorShotId = ''; adaptiveShotId = ''; adaptivePose = undefined;
      }
      updateSafeZoneRig(safeZoneRig, replay.arena, state.frame.safeZone, state.next.safeZone, state.fraction);
      gameplayLayer.update(state.frame, state.cameraMode === 'perception');
      const currentBots = new Map<string, Bot>();
      const perceptionMode = state.cameraMode === 'perception';
      const timelineMode = state.cameraMode === 'timeline';
      const director = state.cameraMode === 'auto' || state.cameraMode === 'adaptive'
        ? directorStateAt(state.shotPlan, state.position) : undefined;
      const gunnerSubjectId = director?.shot?.kind === 'gunner' ? director.shot.subject : undefined;
      const gunnerActive = gunnerSubjectId != null;
      const chronoEventFrame = director?.shot?.eventFrame;
      const chronoActive = state.showChronoXray
        && chronoEventFrame != null
        && (director?.shot?.kind === 'impact' || director?.shot?.kind === 'finale')
        && state.position >= chronoEventFrame
        && state.position <= chronoEventFrame + 1.35;
      if (chronoActive && director?.shot) {
        if (activeChronoShotId !== director.shot.id) {
          activeChronoShotId = director.shot.id;
          chronoElapsed = 0;
        } else {
          chronoElapsed += delta;
        }
      } else {
        activeChronoShotId = '';
        chronoElapsed = 0;
      }
      const lastReplayFrame = replay.frames.length - 1;
      const matchEnded = state.position >= lastReplayFrame;

      for (const id of botIds) {
        const bot = interpolatedBot(state, id);
        const tank = tanks.get(id);
        if (!bot || !tank) continue;
        currentBots.set(id, bot);
        tank.root.position.copy(toWorld(bot.position, replay));
        tank.hull.rotation.y = -bot.bodyAngle;
        tank.turret.rotation.y = -bot.turretAngle;
        const dead = bot.hp <= 0;
        const winner = replay.result.winnerBotId === id;
        const faded = dead || bot.forfeited || (matchEnded && replay.result.winnerBotId != null && !winner);
        tank.root.rotation.z = THREE.MathUtils.lerp(tank.root.rotation.z, dead ? 0.22 : 0, 0.08);
        tank.materials.forEach(material => {
          if ('opacity' in material) {
            const baseOpacity = Number(material.userData.blueprintOpacity ?? material.opacity);
            material.opacity = faded ? baseOpacity * 0.35 : baseOpacity;
          }
        });
        tank.winnerHalo.visible = matchEnded && winner;
        if (tank.winnerHalo.visible) {
          const tailProgress = THREE.MathUtils.clamp(
            (state.position - lastReplayFrame) / VISUAL_TAIL_FRAMES, 0, 1,
          );
          tank.winnerMaterial.opacity = 0.28 + Math.sin(tailProgress * Math.PI * 3) * 0.08;
          tank.winnerHalo.scale.setScalar(0.88 + tailProgress * 0.2);
        }
      }

      const perceptionSamples = samplesByBot.get(state.perceptionBotId) ?? [];
      const perceptionSampleIndex = THREE.MathUtils.clamp(
        Math.floor(state.position), 0, Math.max(0, perceptionSamples.length - 1),
      );
      const perceptionSample = perceptionSamples[perceptionSampleIndex];
      const perceptionBot = currentBots.get(state.perceptionBotId);
      const perceptionEnemy = [...currentBots.values()].find(bot => bot.id !== state.perceptionBotId);
      let lastKnownTarget: LastKnownTarget | undefined;
      if (perceptionBot && perceptionSamples.length) {
        for (let index = perceptionSampleIndex; index >= 0; index -= 1) {
          const knownSample = perceptionSamples[index];
          if (!knownSample.enemyVisible) continue;
          const knownEnemy = replay.frames[Math.min(knownSample.tick, replay.frames.length - 1)]?.bots
            .find(bot => bot.id !== state.perceptionBotId);
          if (knownEnemy) {
            lastKnownTarget = {
              position: knownEnemy.position,
              ageFrames: Math.max(0, state.position - knownSample.tick),
              botId: knownEnemy.id,
            };
          }
          break;
        }
      }
      perceptionRig.group.visible = perceptionMode && perceptionBot != null && perceptionSamples.length > 0;
      if (perceptionRig.group.visible && perceptionBot) {
        updatePerceptionRig(
          perceptionRig, replay, perceptionBot, perceptionEnemy,
          perceptionSample, lastKnownTarget, clock.elapsedTime,
        );
      }

      timeTowerRig.group.visible = timelineMode;
      if (timelineMode) updateTimeTower(timeTowerRig, replay, state.position, currentBots);
      if (scene.fog instanceof THREE.FogExp2) scene.fog.density = timelineMode ? 0.014 : 0.032;

      tanks.forEach((tank, id) => {
        if (timelineMode) {
          tank.root.visible = false;
        } else if (perceptionMode) {
          const bot = currentBots.get(id);
          const visibleEnemy = !perceptionSamples.length
            || perceptionSample?.enemyVisible === true || (bot?.hp ?? 1) <= 0;
          tank.root.visible = id === state.perceptionBotId || visibleEnemy;
        } else {
          tank.root.visible = true;
        }
      });

      for (const [id, rig] of ghostRigs) {
        if (!chronoActive || chronoEventFrame == null) {
          rig.hulls.count = 0;
          rig.turrets.count = 0;
          continue;
        }
        let count = 0;
        for (let sampleIndex = 0; sampleIndex < ghostCount; sampleIndex += 1) {
          const sampleFrame = Math.max(0, Math.round(
            chronoEventFrame - 12 + sampleIndex * 12 / (ghostCount - 1),
          ));
          const bot = replay.frames[Math.min(sampleFrame, replay.frames.length - 1)]?.bots
            .find(candidate => candidate.id === id);
          if (!bot) continue;
          const world = toWorld(bot.position, replay);
          chronoDummy.position.set(world.x, 0.2, world.z);
          chronoDummy.rotation.set(0, -bot.bodyAngle, 0);
          chronoDummy.scale.setScalar(0.94 + sampleIndex / (ghostCount - 1) * 0.06);
          chronoDummy.updateMatrix();
          rig.hulls.setMatrixAt(count, chronoDummy.matrix);
          chronoDummy.position.y = 0.39;
          chronoDummy.rotation.set(0, -bot.turretAngle, 0);
          chronoDummy.updateMatrix();
          rig.turrets.setMatrixAt(count, chronoDummy.matrix);
          count += 1;
        }
        rig.hulls.count = count;
        rig.turrets.count = count;
        rig.hulls.instanceMatrix.needsUpdate = true;
        rig.turrets.instanceMatrix.needsUpdate = true;
      }

      tacticalTraces.forEach(trace => {
        const visible = state.showTacticalTrace && !perceptionMode && !timelineMode && !gunnerActive
          && trace.botId === state.traceBotId;
        trace.group.visible = visible;
        if (!visible) return;
        const sampleIndex = THREE.MathUtils.clamp(
          Math.floor(state.position), 0, Math.max(0, trace.samples.length - 1),
        );
        trace.ribbon.geometry.setDrawRange(0, Math.max(0, sampleIndex) * 6);
        trace.centerLine.geometry.setDrawRange(0, sampleIndex + 1);
        trace.markers.forEach(marker => { marker.group.visible = marker.tick <= state.position; });
        const sample = trace.samples[sampleIndex];
        const bot = currentBots.get(trace.botId);
        if (!sample || !bot) {
          trace.aimGroup.visible = false;
          return;
        }
        const aim = sample.action.aimDirection;
        trace.aimGroup.visible = Math.hypot(aim.x, aim.y) > 0.001;
        trace.aimGroup.position.copy(toWorld(bot.position, replay, 0.075));
        trace.aimGroup.rotation.y = -Math.atan2(aim.y, aim.x);
      });

      chronoProjectileSlices.count = 0;
      if (chronoActive && director?.shot?.bulletId != null) {
        const flight = bulletFlights.get(director.shot.bulletId);
        if (flight) {
          const direction = Math.atan2(flight.end.y - flight.start.y, flight.end.x - flight.start.x);
          const sliceCount = 14;
          for (let slice = 0; slice < sliceCount; slice += 1) {
            const progress = slice / (sliceCount - 1);
            const point = mixPoint(flight.start, flight.end, progress);
            chronoDummy.position.copy(toWorld(point, replay, 0.31));
            chronoDummy.rotation.set(0, -direction, 0);
            chronoDummy.scale.setScalar(0.55 + progress * 0.65);
            chronoDummy.updateMatrix();
            chronoProjectileSlices.setMatrixAt(slice, chronoDummy.matrix);
          }
          chronoProjectileSlices.count = sliceCount;
          chronoProjectileSlices.instanceMatrix.needsUpdate = true;
        }
      }
      chronoReticle.visible = chronoActive && director?.shot?.focus != null;
      if (chronoReticle.visible && director?.shot?.focus) {
        chronoReticle.position.copy(toWorld(director.shot.focus, replay, 0.32));
        chronoReticle.rotation.y = chronoElapsed * 0.55;
        chronoReticle.scale.setScalar(1 + Math.sin(chronoElapsed * 4.5) * 0.1);
      }

      const visibleBullets = new Set<number>();
      for (const bullet of state.frame.bullets) {
        const object = bullets.get(bullet.id);
        if (!object) continue;
        const end = state.next.bullets.find(item => item.id === bullet.id) ?? bullet;
        object.visible = true;
        object.position.copy(toWorld(mixPoint(bullet.position, end.position, state.fraction), replay, 0.31));
        object.rotation.y = -Math.atan2(bullet.direction.y, bullet.direction.x);
        object.scale.setScalar(director?.shot?.kind === 'projectile'
          && director.shot.bulletId === bullet.id ? 1.65 : 1);
        visibleBullets.add(bullet.id);
      }
      const trackedFlight = director?.shot?.bulletId == null
        ? undefined : bulletFlights.get(director.shot.bulletId);
      if (trackedFlight && !visibleBullets.has(trackedFlight.id)
        && state.position >= trackedFlight.startFrame && state.position <= trackedFlight.endFrame) {
        const object = bullets.get(trackedFlight.id);
        if (object) {
          const progress = THREE.MathUtils.clamp(
            (state.position - trackedFlight.startFrame)
              / Math.max(0.001, trackedFlight.endFrame - trackedFlight.startFrame),
            0, 1,
          );
          const point = mixPoint(trackedFlight.start, trackedFlight.end, progress);
          object.visible = true;
          object.position.copy(toWorld(point, replay, 0.31));
          object.rotation.y = -Math.atan2(
            trackedFlight.end.y - trackedFlight.start.y,
            trackedFlight.end.x - trackedFlight.start.x,
          );
          object.scale.setScalar(1.65);
          visibleBullets.add(trackedFlight.id);
        }
      }
      bullets.forEach((object, id) => { if (!visibleBullets.has(id)) object.visible = false; });
      if (timelineMode) bullets.forEach(object => { object.visible = false; });

      const currentFrame = Math.min(replay.frames.length, Math.floor(state.position) + 1);
      trailLines.forEach(line => {
        line.visible = state.showTrails && !perceptionMode && !timelineMode && !gunnerActive;
        line.geometry.setDrawRange(0, currentFrame);
      });

      for (const effect of effects) {
        const age = state.position - effect.frame;
        const duration = effect.type === 'BotDestroyed' ? 15 : effect.type === 'BotHit' ? 9 : 3.2;
        effect.group.visible = age >= 0 && age <= duration;
        if (timelineMode) effect.group.visible = false;
        if (!effect.group.visible) continue;
        const progress = age / duration;
        const muzzle = effect.type === 'ShotFired';
        const scale = effect.type === 'BotDestroyed' ? 0.8 + progress * 5.2
          : muzzle ? 0.72 + progress * 2.1 : 0.65 + progress * 2.6;
        const ownGunnerFlash = muzzle && gunnerActive && effect.sourceBotId === gunnerSubjectId;
        effect.group.scale.setScalar(scale * (ownGunnerFlash ? 0.52 : 1));
        effect.group.rotation.y = progress * Math.PI * 2.2;
        effect.materials.forEach(material => {
          material.opacity = Math.pow(1 - progress, muzzle ? 2 : 1) * (muzzle ? 1 : 0.9);
        });
        effect.lights.forEach(light => {
          light.intensity = Math.pow(1 - progress, 2.5) * (muzzle ? 9 : 5);
        });
      }

      const arenaCenter = new THREE.Vector3(0, 0, 0);
      const mode = state.cameraMode;
      let desiredFov = 38;
      let hardDirectorCut = resetCaptureCamera;

      if (mode === 'timeline') {
        desiredTarget.set(0, timeTowerRig.height * 0.46, 0);
        desiredPosition.set(
          maxDimension * 0.78,
          timeTowerRig.height * 0.7,
          maxDimension * 0.96,
        );
        desiredUp.set(0, 1, 0);
        desiredFov = 43;
      } else if (mode === 'perception') {
        const observed = currentBots.get(state.perceptionBotId);
        desiredUp.set(0, 1, 0);
        if (observed) {
          const observedPosition = toWorld(observed.position, replay, 0.12);
          desiredTarget.copy(observedPosition);
          desiredPosition.copy(observedPosition).add(new THREE.Vector3(
            maxDimension * 0.24, maxDimension * 0.48, maxDimension * 0.34,
          ));
        } else {
          desiredTarget.copy(arenaCenter);
          desiredPosition.set(maxDimension * 0.24, maxDimension * 0.6, maxDimension * 0.34);
        }
        desiredFov = 43;
      } else if (mode === 'plan') {
        desiredTarget.copy(arenaCenter);
        desiredPosition.set(maxDimension * 0.18, maxDimension * 0.92, maxDimension * 0.58);
        desiredUp.set(0, 1, 0);
        desiredFov = 38;
      } else if (mode === 'overview') {
        desiredTarget.copy(arenaCenter);
        desiredPosition.set(0, maxDimension * 1.02, 0.001);
        desiredUp.set(0, 0, -1);
        desiredFov = 35;
      } else if (mode.startsWith('bot:')) {
        desiredUp.set(0, 1, 0);
        const followed = currentBots.get(mode.slice(4));
        if (followed) {
          const botPosition = toWorld(followed.position, replay, 0.25);
          const forward = new THREE.Vector3(Math.cos(followed.bodyAngle), 0, Math.sin(followed.bodyAngle));
          desiredTarget.copy(botPosition).addScaledVector(forward, 0.8);
          desiredPosition.copy(botPosition).addScaledVector(forward, -2.25).add(new THREE.Vector3(0, 1.55, 0));
        }
        desiredFov = 44;
      } else {
        if (director?.shot) {
          const changedShot = activeDirectorShotId !== director.shot.id;
          hardDirectorCut ||= changedShot && (director.shot.hardCut || activeDirectorShotId === '');
          activeDirectorShotId = director.shot.id;
          desiredFov = setDirectorGoal(
            director.shot, currentBots, state, state.position, desiredPosition, desiredTarget, desiredUp,
          );
          if (mode === 'adaptive' && !gunnerActive) {
            if (adaptiveShotId !== director.shot.id || !adaptivePose) {
              adaptivePose = selectAdaptivePose(director.shot, state, desiredTarget);
              adaptiveShotId = director.shot.id;
            }
            desiredFov = applyAdaptivePose(
              adaptivePose, director.shot, currentBots, desiredPosition, desiredTarget,
            );
          } else if (director.previous && director.mix < 1) {
            const previousFov = setDirectorGoal(
              director.previous, currentBots, state, state.position, previousPosition, previousTarget, previousUp,
            );
            desiredPosition.lerpVectors(previousPosition, desiredPosition, director.mix);
            desiredTarget.lerpVectors(previousTarget, desiredTarget, director.mix);
            desiredUp.lerpVectors(previousUp, desiredUp, director.mix).normalize();
            desiredFov = THREE.MathUtils.lerp(previousFov, desiredFov, director.mix);
          }
        } else if (currentBots.size) {
          const positions = [...currentBots.values()].map(bot => toWorld(bot.position, replay, 0.18));
          desiredTarget.copy(positions.reduce((sum, point) => sum.add(point), new THREE.Vector3()))
            .multiplyScalar(1 / positions.length);
          desiredPosition.copy(desiredTarget).add(new THREE.Vector3(
            maxDimension * 0.28, maxDimension * 0.68, maxDimension * 0.46,
          ));
        } else {
          desiredTarget.copy(arenaCenter);
          desiredPosition.set(maxDimension * 0.25, maxDimension * 0.75, maxDimension * 0.5);
        }
      }

      if (chronoActive) {
        const orbitOffset = desiredPosition.clone().sub(desiredTarget)
          .applyAxisAngle(verticalAxis, chronoElapsed * 0.24);
        desiredPosition.copy(desiredTarget).add(orbitOffset);
        desiredFov = Math.min(desiredFov, 34);
      }

      const directorMode = mode === 'auto' || mode === 'adaptive';
      const smoothing = 1 - Math.exp(-delta * (mode === 'auto' ? 2.35 : mode === 'adaptive' ? 3.1 : 4.2));
      if (hardDirectorCut || gunnerActive) {
        camera.position.copy(desiredPosition);
        cameraTarget.copy(desiredTarget);
        camera.up.copy(desiredUp).normalize();
        camera.fov = desiredFov;
      } else {
        camera.position.lerp(desiredPosition, smoothing);
        cameraTarget.lerp(desiredTarget, smoothing);
        camera.up.lerp(desiredUp, smoothing).normalize();
        camera.fov = THREE.MathUtils.lerp(camera.fov, desiredFov, smoothing);
      }
      if (!directorMode) {
        activeDirectorShotId = '';
        adaptiveShotId = '';
        adaptivePose = undefined;
      }
      camera.updateProjectionMatrix();
      camera.lookAt(cameraTarget);

      const cutawayTargets = [...currentBots.values()].map(bot => toWorld(bot.position, replay, 0.28));
      if (director?.shot?.bulletId != null) {
        const trackedBullet = bullets.get(director.shot.bulletId);
        if (trackedBullet?.visible) cutawayTargets.push(trackedBullet.position.clone());
      }
      if (!cutawayTargets.length) cutawayTargets.push(cameraTarget.clone());
      const wallFade = 1 - Math.exp(-delta * 8.5);
      for (const wall of wallRigs) {
        const cut = ((mode === 'adaptive' && !gunnerActive) || chronoActive)
          && cutawayTargets.some(target => wallBlocks(camera.position, target, wall.box));
        const surfaceOpacity = timelineMode ? 0.14 : cut ? 0.07 : 1;
        const edgeOpacity = timelineMode ? 0.42 : cut ? 1 : 0.88;
        const sectionOpacity = timelineMode ? 0.08 : cut ? 0.24 : 0;
        wall.surface.opacity = THREE.MathUtils.lerp(wall.surface.opacity, surfaceOpacity, wallFade);
        wall.edges.opacity = THREE.MathUtils.lerp(wall.edges.opacity, edgeOpacity, wallFade);
        wall.section.opacity = THREE.MathUtils.lerp(wall.section.opacity, sectionOpacity, wallFade);
        wall.surface.emissiveIntensity = THREE.MathUtils.lerp(
          wall.surface.emissiveIntensity, timelineMode ? 0.48 : cut ? 1.15 : 0.32, wallFade,
        );
        wall.surface.color.lerp(cut || timelineMode ? cutWallColor : normalWallColor, wallFade);
        wall.surface.depthWrite = wall.surface.opacity > 0.42;
      }
      renderer.render(scene, camera);
      state.onRenderFrame?.(renderer.domElement, state.captureEpoch);
    };

    render();
    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', seekFromTower);
      safeZoneRig.boundary.dispose();
      disposeScene(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [replay]);

  return (
    <div ref={hostRef} className="blueprint-viewport" role="img" aria-label="Трёхмерный чертёж арены">
      {webglError && <p className="webgl-error">WebGL недоступен в этом браузере.</p>}
    </div>
  );
}
