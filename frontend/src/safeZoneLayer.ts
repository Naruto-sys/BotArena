import * as THREE from 'three';
import type { Arena, SafeZone } from './contracts';

const DASH = 0.22;
const GAP = 0.12;
const BORDER_WIDTH = 0.035;

export interface SafeZoneRig {
  group: THREE.Group;
  outside: THREE.Mesh[];
  boundary: THREE.InstancedMesh;
  bounds?: SafeZone;
  dummy: THREE.Object3D;
}

export function createSafeZoneRig(arena: Arena): SafeZoneRig {
  const group = new THREE.Group();
  group.name = 'safe-zone';
  group.visible = false;
  const fillMaterial = new THREE.MeshBasicMaterial({
    color: 0x7a1f24,
    opacity: 0.22,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const outside = Array.from({ length: 4 }, () => {
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fillMaterial);
    patch.rotation.x = -Math.PI / 2;
    patch.renderOrder = -2;
    group.add(patch);
    return patch;
  });
  const capacity = 2 * (Math.ceil(arena.width / (DASH + GAP))
    + Math.ceil(arena.height / (DASH + GAP))) + 4;
  // World-space dash meshes keep their thickness in perspective. Native WebGL
  // lines only support a one-pixel width on many browsers.
  const boundary = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xff8f8f, transparent: true, depthWrite: false }),
    capacity,
  );
  boundary.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  boundary.count = 0;
  boundary.renderOrder = -1;
  boundary.frustumCulled = false;
  group.add(boundary);
  return { group, outside, boundary, dummy: new THREE.Object3D() };
}

export function updateSafeZoneRig(
  rig: SafeZoneRig,
  arena: Arena,
  current: SafeZone | null | undefined,
  next: SafeZone | null | undefined,
  fraction: number,
) {
  rig.group.visible = current != null;
  if (!current) return;
  const end = next ?? current;
  const mix = THREE.MathUtils.clamp(fraction, 0, 1);
  const x = THREE.MathUtils.clamp(THREE.MathUtils.lerp(current.x, end.x, mix), 0, arena.width);
  const y = THREE.MathUtils.clamp(THREE.MathUtils.lerp(current.y, end.y, mix), 0, arena.height);
  const width = THREE.MathUtils.clamp(THREE.MathUtils.lerp(current.width, end.width, mix), 0, arena.width - x);
  const height = THREE.MathUtils.clamp(THREE.MathUtils.lerp(current.height, end.height, mix), 0, arena.height - y);
  const previous = rig.bounds;
  if (previous && previous.x === x && previous.y === y && previous.width === width && previous.height === height) return;
  rig.bounds = { x, y, width, height };

  // Four non-overlapping rectangles cover only the danger area, inside the arena.
  const patches = [
    [0, 0, arena.width, y],
    [0, y + height, arena.width, arena.height - y - height],
    [0, y, x, height],
    [x + width, y, arena.width - x - width, height],
  ];
  patches.forEach(([left, top, patchWidth, patchHeight], index) => {
    const patch = rig.outside[index];
    patch.visible = patchWidth > 0 && patchHeight > 0;
    patch.position.set(left + patchWidth / 2 - arena.width / 2, 0.014,
      top + patchHeight / 2 - arena.height / 2);
    patch.scale.set(patchWidth, patchHeight, 1);
  });

  let count = 0;
  const edges = [
    [x, y, width, true],
    [x, y + height, width, true],
    [x, y, height, false],
    [x + width, y, height, false],
  ] as const;
  for (const [left, top, length, horizontal] of edges) {
    for (let start = 0; start < length; start += DASH + GAP) {
      const size = Math.min(DASH, length - start);
      const center = start + size / 2;
      rig.dummy.position.set(
        left + (horizontal ? center : 0) - arena.width / 2,
        0.045,
        top + (horizontal ? 0 : center) - arena.height / 2,
      );
      rig.dummy.scale.set(horizontal ? size : BORDER_WIDTH, 0.006, horizontal ? BORDER_WIDTH : size);
      rig.dummy.updateMatrix();
      rig.boundary.setMatrixAt(count++, rig.dummy.matrix);
    }
  }
  rig.boundary.count = count;
  rig.boundary.instanceMatrix.needsUpdate = true;
}
