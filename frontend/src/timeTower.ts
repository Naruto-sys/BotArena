import * as THREE from 'three';
import type { Bot, Point, Replay } from './contracts';
import { botColor } from './botVisuals';

export interface TimeTowerRig {
  group: THREE.Group;
  height: number;
  timeScale: number;
  timePlane: THREE.Group;
  cursors: Map<string, THREE.Group>;
}

function toWorld(point: Point, replay: Replay, height: number) {
  return new THREE.Vector3(
    point.x - replay.arena.width / 2,
    height,
    point.y - replay.arena.height / 2,
  );
}

function timeLabel(text: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = 'rgba(3, 18, 29, .88)';
    context.fillRect(2, 2, 252, 60);
    context.strokeStyle = '#68ddff';
    context.lineWidth = 3;
    context.strokeRect(2, 2, 252, 60);
    context.fillStyle = '#b7f3ff';
    context.font = '700 24px monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, 128, 33);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, depthWrite: false, depthTest: false,
  }));
  sprite.scale.set(1.2, 0.3, 1);
  sprite.renderOrder = 9;
  return sprite;
}

function addCausalShot(
  group: THREE.Group,
  replay: Replay,
  startFrame: number,
  start: Point,
  endFrame: number,
  end: Point,
  timeScale: number,
) {
  const from = toWorld(start, replay, startFrame * timeScale + 0.12);
  const to = toWorld(end, replay, endFrame * timeScale + 0.12);
  const midpoint = from.clone().lerp(to, 0.5);
  const lateral = new THREE.Vector3(-(to.z - from.z), 0, to.x - from.x)
    .normalize().multiplyScalar(0.14);
  midpoint.add(lateral);
  const curve = new THREE.QuadraticBezierCurve3(from, midpoint, to);
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 18, 0.025, 5, false),
    new THREE.MeshBasicMaterial({
      color: 0xffc46f,
      transparent: true,
      opacity: 0.76,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  tube.userData.timePickable = true;
  tube.renderOrder = 5;
  group.add(tube);

  const impact = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.13, 1),
    new THREE.MeshBasicMaterial({
      color: 0xffe0a8,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  impact.position.copy(to);
  impact.userData.timePickable = true;
  impact.renderOrder = 6;
  group.add(impact);
}

export function createTimeTower(replay: Replay): TimeTowerRig {
  const group = new THREE.Group();
  const lastFrame = Math.max(1, replay.frames.length - 1);
  const maxDimension = Math.max(replay.arena.width, replay.arena.height);
  const height = Math.max(7.5, maxDimension * 0.78);
  const timeScale = height / lastFrame;
  const botIds = [...new Set(replay.frames.flatMap(frame => frame.bots.map(bot => bot.id)))];

  for (const wall of replay.arena.walls) {
    const geometry = new THREE.BoxGeometry(wall.width, height, wall.height);
    const column = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color: 0x2a9fc3,
      transparent: true,
      opacity: 0.035,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
    column.position.set(
      wall.x + wall.width / 2 - replay.arena.width / 2,
      height / 2,
      wall.y + wall.height / 2 - replay.arena.height / 2,
    );
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: 0x50c8ea, transparent: true, opacity: 0.14, depthWrite: false }),
    );
    edges.position.copy(column.position);
    group.add(column, edges);
  }

  for (const id of botIds) {
    const points = replay.frames.flatMap((frame, frameIndex) => {
      const bot = frame.bots.find(candidate => candidate.id === id);
      return bot ? [toWorld(bot.position, replay, frameIndex * timeScale + 0.08)] : [];
    });
    if (points.length < 2) continue;
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, Math.max(24, points.length * 2), 0.052, 7, false),
      new THREE.MeshBasicMaterial({
        color: botColor(id),
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    tube.userData.timePickable = true;
    tube.renderOrder = 4;
    group.add(tube);

    const tickPoints: THREE.Vector3[] = [];
    for (let index = 0; index < points.length; index += Math.max(5, Math.round(replay.tickRate / 2))) {
      const point = points[index];
      tickPoints.push(
        point.clone().add(new THREE.Vector3(-0.12, 0, 0)),
        point.clone().add(new THREE.Vector3(0.12, 0, 0)),
      );
    }
    group.add(new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(tickPoints),
      new THREE.LineBasicMaterial({ color: botColor(id), transparent: true, opacity: 0.52, depthWrite: false }),
    ));
  }

  const pending = new Map<number, { frame: number; position: Point }>();
  replay.frames.forEach((frame, frameIndex) => frame.events.forEach(event => {
    if (event.type === 'ShotFired' && event.bulletId != null) {
      const source = event.sourceBotId
        ? frame.bots.find(bot => bot.id === event.sourceBotId)?.position
        : event.position;
      if (source) pending.set(event.bulletId, { frame: frameIndex, position: source });
    } else if ((event.type === 'BotHit' || event.type === 'BotDestroyed')
      && event.bulletId != null && event.position) {
      const start = pending.get(event.bulletId);
      if (start) {
        addCausalShot(group, replay, start.frame, start.position, frameIndex, event.position, timeScale);
        pending.delete(event.bulletId);
      }
    }
  }));

  const axisX = -replay.arena.width / 2 - 0.48;
  const axisZ = -replay.arena.height / 2 - 0.42;
  const axisPoints = [new THREE.Vector3(axisX, 0, axisZ), new THREE.Vector3(axisX, height, axisZ)];
  const tickPoints: THREE.Vector3[] = [];
  const labels = 4;
  for (let index = 0; index <= labels; index += 1) {
    const y = height * index / labels;
    tickPoints.push(new THREE.Vector3(axisX - 0.18, y, axisZ), new THREE.Vector3(axisX + 0.18, y, axisZ));
    const label = timeLabel(`T+${(lastFrame * index / labels / replay.tickRate).toFixed(1)}s`);
    label.position.set(axisX - 0.85, y, axisZ);
    group.add(label);
  }
  group.add(
    new THREE.Line(new THREE.BufferGeometry().setFromPoints(axisPoints),
      new THREE.LineBasicMaterial({ color: 0x68ddff, transparent: true, opacity: 0.75 })),
    new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(tickPoints),
      new THREE.LineBasicMaterial({ color: 0x68ddff, transparent: true, opacity: 0.75 })),
  );

  const planeMaterial = new THREE.MeshBasicMaterial({
    color: 0x55dfff,
    transparent: true,
    opacity: 0.075,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(replay.arena.width, replay.arena.height), planeMaterial);
  plane.rotation.x = -Math.PI / 2;
  const planeEdgesGeometry = new THREE.EdgesGeometry(new THREE.PlaneGeometry(replay.arena.width, replay.arena.height));
  const planeEdges = new THREE.LineSegments(
    planeEdgesGeometry,
    new THREE.LineBasicMaterial({ color: 0x7ce8ff, transparent: true, opacity: 0.52, depthWrite: false }),
  );
  planeEdges.rotation.x = -Math.PI / 2;
  const timePlane = new THREE.Group();
  timePlane.add(plane, planeEdges);
  timePlane.renderOrder = 3;
  group.add(timePlane);

  const cursors = new Map<string, THREE.Group>();
  for (const id of botIds) {
    const cursor = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.15, 1),
      new THREE.MeshBasicMaterial({
        color: botColor(id), transparent: true, opacity: 0.95,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.25, 28),
      new THREE.MeshBasicMaterial({
        color: botColor(id), transparent: true, opacity: 0.72,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    halo.rotation.x = -Math.PI / 2;
    cursor.add(core, halo);
    core.userData.timePickable = true;
    halo.userData.timePickable = true;
    cursor.renderOrder = 7;
    cursors.set(id, cursor);
    group.add(cursor);
  }

  group.visible = false;
  return { group, height, timeScale, timePlane, cursors };
}

export function updateTimeTower(rig: TimeTowerRig, replay: Replay, position: number, bots: Map<string, Bot>) {
  const y = THREE.MathUtils.clamp(position, 0, replay.frames.length - 1) * rig.timeScale + 0.08;
  rig.timePlane.position.y = y;
  for (const [id, cursor] of rig.cursors) {
    const bot = bots.get(id);
    cursor.visible = bot != null;
    if (!bot) continue;
    cursor.position.copy(toWorld(bot.position, replay, y + 0.03));
    cursor.rotation.y = performance.now() * 0.00055;
  }
}
