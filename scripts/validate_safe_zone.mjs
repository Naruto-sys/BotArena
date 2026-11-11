// Node 22+: node --experimental-strip-types scripts/validate_safe_zone.mjs
import assert from 'node:assert/strict';
import { createSafeZoneRig, updateSafeZoneRig } from '../frontend/src/safeZoneLayer.ts';

const arena = { width: 16, height: 10, walls: [] };
const full = { x: 0, y: 0, width: 16, height: 10 };
const small = { x: 4, y: 2, width: 8, height: 6 };
const rig = createSafeZoneRig(arena);
const update = (current, next = current, fraction = 0) =>
  updateSafeZoneRig(rig, arena, current, next, fraction);

update(null);
assert.equal(rig.group.visible, false);
update(full);
assert.equal(rig.group.visible, true);
assert(rig.outside.every(patch => !patch.visible), 'Full-size zone must not tint safe ground');
assert(rig.boundary.count > 0 && rig.boundary.count <= rig.boundary.instanceMatrix.count);

update(full, small, 0.5);
assert.deepEqual(rig.bounds, { x: 2, y: 1, width: 12, height: 8 });
const dangerArea = rig.outside.filter(patch => patch.visible)
  .reduce((area, patch) => area + patch.scale.x * patch.scale.y, 0);
assert.equal(dangerArea, arena.width * arena.height - 12 * 8);
assert(rig.outside.every(patch => patch.rotation.x === -Math.PI / 2 && patch.position.y > 0),
  'Danger fill must lie parallel to and slightly above the arena floor');
assert(rig.boundary.material.depthTest && !rig.boundary.material.depthWrite,
  'Walls should occlude the zone instead of the zone obscuring tanks');

const matrices = rig.boundary.instanceMatrix.array;
for (let i = 0; i < rig.boundary.count; i++) {
  const x = matrices[i * 16 + 12];
  const height = matrices[i * 16 + 13];
  const z = matrices[i * 16 + 14];
  assert(Math.abs(x) <= 6.00001 && Math.abs(z) <= 4.00001);
  assert(Math.abs(height - 0.045) < 0.00001, 'Boundary dashes must stay on the floor');
  assert(Math.abs(Math.abs(x) - 6) < 0.00001 || Math.abs(Math.abs(z) - 4) < 0.00001,
    'Each dash belongs to the actual world-space zone perimeter');
}
update(small);
assert.deepEqual(rig.bounds, small);
update(full); // Reverse scrubbing must restore the original border, not retain a shrunken zone.
assert.deepEqual(rig.bounds, full);
assert(rig.outside.every(patch => !patch.visible));
update(undefined, small);
assert.equal(rig.group.visible, false, 'Do not show a future zone before its first frame');
update(small, undefined, 1);
assert.deepEqual(rig.bounds, small, 'A terminal frame must retain its last zone');
update({ x: -5, y: -2, width: 99, height: 99 });
assert.deepEqual(rig.bounds, full, 'Danger geometry must be clipped to the playable arena');
rig.boundary.dispose();
rig.group.traverse(object => {
  object.geometry?.dispose();
  object.material?.dispose();
});
console.log('Safe zone geometry, interpolation, occlusion and scrubbing checks passed');
