import * as THREE from 'three';
import type { Arena, CaptureZone } from './contracts';

const FENCE_HEIGHT = 0.42;
const BORDER_WIDTH = 0.045;
const DASH = 0.18;
const GAP = 0.1;
const FLOOR_Y = 0.03;
const POST_SIZE = 0.07;

interface ZoneMeshes {
  fill: THREE.Mesh;
  progress: THREE.Mesh;
  posts: THREE.Mesh[];
  border: THREE.InstancedMesh;
  dummy: THREE.Object3D;
  ownerTeamId: string;
}

export interface CaptureZoneRig {
  group: THREE.Group;
  zones: ZoneMeshes[];
}

function teamColors(ownerTeamId: string, capturingTeamId: string | null | undefined, contested: boolean) {
  const ownerIsPlayer = ownerTeamId === 'player';
  const base = ownerIsPlayer ? 0x3d7cff : 0xff6a45;
  const capture = capturingTeamId === 'player' ? 0x7eb6ff : capturingTeamId ? 0xff9a78 : base;
  return {
    fill: contested ? 0xffd166 : base,
    border: contested ? 0xffe08a : capture,
    progress: capturingTeamId === 'player' ? 0x6ea8ff : 0xff8f6b,
  };
}

function makeFillMaterial(color: number, opacity: number) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function createZoneMeshes(ownerTeamId: string): ZoneMeshes {
  const colors = teamColors(ownerTeamId, null, false);
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), makeFillMaterial(colors.fill, 0.28));
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = FLOOR_Y;
  fill.renderOrder = 1;

  const progress = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    makeFillMaterial(colors.progress, 0.42),
  );
  progress.renderOrder = 2;
  progress.visible = false;

  const postMaterial = new THREE.MeshBasicMaterial({
    color: colors.border,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  const posts = Array.from({ length: 4 }, () => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(POST_SIZE, FENCE_HEIGHT, POST_SIZE), postMaterial);
    post.geometry.translate(0, FENCE_HEIGHT / 2, 0);
    post.renderOrder = 3;
    return post;
  });

  // Four dashed edges + four top rails; size for the full arena diagonal.
  const capacity = 4 * (Math.ceil(20 / (DASH + GAP)) + 4);
  const border = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({
      color: colors.border,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    }),
    capacity,
  );
  border.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  border.count = 0;
  border.renderOrder = 3;
  border.frustumCulled = false;

  return { fill, progress, posts, border, dummy: new THREE.Object3D(), ownerTeamId };
}

function disposeZone(zone: ZoneMeshes) {
  zone.fill.geometry.dispose();
  (zone.fill.material as THREE.Material).dispose();
  zone.progress.geometry.dispose();
  (zone.progress.material as THREE.Material).dispose();
  for (const post of zone.posts) {
    post.geometry.dispose();
  }
  (zone.posts[0]?.material as THREE.Material | undefined)?.dispose();
  zone.border.geometry.dispose();
  (zone.border.material as THREE.Material).dispose();
}

function layoutBorder(zone: ZoneMeshes, rect: CaptureZone, arena: Arena) {
  const edges = [
    [rect.x, rect.y, rect.width, true],
    [rect.x, rect.y + rect.height, rect.width, true],
    [rect.x, rect.y, rect.height, false],
    [rect.x + rect.width, rect.y, rect.height, false],
  ] as const;
  let count = 0;
  const max = zone.border.instanceMatrix.count;
  const push = () => {
    if (count >= max) return false;
    zone.border.setMatrixAt(count++, zone.dummy.matrix);
    return true;
  };
  for (const [left, top, length, horizontal] of edges) {
    for (let start = 0; start < length; start += DASH + GAP) {
      const size = Math.min(DASH, length - start);
      if (size <= 0.02) continue;
      const center = start + size / 2;
      zone.dummy.position.set(
        left + (horizontal ? center : 0) - arena.width / 2,
        FENCE_HEIGHT * 0.55,
        top + (horizontal ? 0 : center) - arena.height / 2,
      );
      zone.dummy.scale.set(
        horizontal ? size : BORDER_WIDTH,
        FENCE_HEIGHT * 0.14,
        horizontal ? BORDER_WIDTH : size,
      );
      zone.dummy.updateMatrix();
      if (!push()) break;
    }
  }
  // Top rail for silhouette from the side (cinema / section cameras).
  for (const [left, top, length, horizontal] of edges) {
    zone.dummy.position.set(
      left + (horizontal ? length / 2 : 0) - arena.width / 2,
      FENCE_HEIGHT,
      top + (horizontal ? 0 : length / 2) - arena.height / 2,
    );
    zone.dummy.scale.set(
      horizontal ? Math.max(0.05, length) : BORDER_WIDTH * 0.85,
      BORDER_WIDTH,
      horizontal ? BORDER_WIDTH * 0.85 : Math.max(0.05, length),
    );
    zone.dummy.updateMatrix();
    if (!push()) break;
  }
  zone.border.count = count;
  zone.border.instanceMatrix.needsUpdate = true;
}

export function createCaptureZoneRig(_arena: Arena): CaptureZoneRig {
  const group = new THREE.Group();
  group.name = 'capture-zones';
  group.visible = false;
  return { group, zones: [] };
}

export function updateCaptureZoneRig(
  rig: CaptureZoneRig,
  arena: Arena,
  zones: CaptureZone[] | null | undefined,
) {
  const list = zones ?? [];
  while (rig.zones.length > list.length) {
    const zone = rig.zones.pop()!;
    rig.group.remove(zone.fill, zone.progress, zone.border, ...zone.posts);
    disposeZone(zone);
  }
  while (rig.zones.length < list.length) {
    const source = list[rig.zones.length];
    const meshes = createZoneMeshes(source.ownerTeamId);
    rig.group.add(meshes.fill, meshes.progress, meshes.border, ...meshes.posts);
    rig.zones.push(meshes);
  }

  rig.group.visible = list.length > 0;
  list.forEach((zone, index) => {
    const meshes = rig.zones[index];
    const progress = Math.max(0, Math.min(1, zone.progress ?? 0));
    const colors = teamColors(zone.ownerTeamId, zone.capturingTeamId, !!zone.contested);
    const cx = zone.x + zone.width / 2 - arena.width / 2;
    const cz = zone.y + zone.height / 2 - arena.height / 2;

    const fillMat = meshes.fill.material as THREE.MeshBasicMaterial;
    fillMat.color.setHex(colors.fill);
    fillMat.opacity = zone.contested ? 0.34 : 0.22 + progress * 0.2;
    meshes.fill.position.set(cx, FLOOR_Y, cz);
    meshes.fill.scale.set(Math.max(0.05, zone.width), Math.max(0.05, zone.height), 1);

    const progressMat = meshes.progress.material as THREE.MeshBasicMaterial;
    progressMat.color.setHex(colors.progress);
    progressMat.opacity = 0.36 + progress * 0.3;
    meshes.progress.visible = progress > 0.01;
    const inset = 0.04;
    const usableWidth = Math.max(0.05, zone.width - inset * 2);
    const fillWidth = Math.max(0.04, usableWidth * progress);
    const fillDepth = Math.max(0.05, zone.height - inset * 2);
    const barHeight = 0.07;
    meshes.progress.position.set(
      zone.x + inset + fillWidth / 2 - arena.width / 2,
      FLOOR_Y + barHeight / 2,
      cz,
    );
    meshes.progress.scale.set(fillWidth, barHeight, fillDepth);

    const borderMat = meshes.border.material as THREE.MeshBasicMaterial;
    borderMat.color.setHex(colors.border);
    borderMat.opacity = zone.contested ? 1 : 0.92;
    (meshes.posts[0].material as THREE.MeshBasicMaterial).color.setHex(colors.border);

    const corners = [
      [zone.x, zone.y],
      [zone.x + zone.width, zone.y],
      [zone.x, zone.y + zone.height],
      [zone.x + zone.width, zone.y + zone.height],
    ] as const;
    corners.forEach(([x, y], cornerIndex) => {
      meshes.posts[cornerIndex].position.set(
        x - arena.width / 2,
        FLOOR_Y,
        y - arena.height / 2,
      );
    });

    layoutBorder(meshes, zone, arena);
  });
}

export function disposeCaptureZoneRig(rig: CaptureZoneRig) {
  for (const zone of rig.zones) {
    rig.group.remove(zone.fill, zone.progress, zone.border, ...zone.posts);
    disposeZone(zone);
  }
  rig.zones.length = 0;
}
