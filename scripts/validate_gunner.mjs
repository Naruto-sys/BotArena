// Node 22+: node scripts/validate_gunner.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { rolldown } = await import(pathToFileURL(require.resolve('rolldown')));
async function sourceModule(file) {
  const bundle = await rolldown({ input: fileURLToPath(new URL(file, import.meta.url)), platform: 'node' });
  try {
    const { output } = await bundle.generate({ format: 'esm' });
    return await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`);
  } finally { await bundle.close(); }
}
const { buildShotPlan, shotAt, directorStateAt } = await sourceModule('../frontend/src/cinematicDirector.ts');
const { gunnerPose } = await sourceModule('../frontend/src/gunnerCamera.ts');

function fixture(length = 250) {
  const shots = [30, 60, 90, 150, 180, 230, 350, 500].filter(tick => tick < length - 30);
  return { tickRate: 20, arena: { width: 16, height: 10, walls: [] },
    result: { winnerBotId: null, reason: 'TimeLimit', durationTicks: length },
    frames: Array.from({ length: length + 1 }, (_, tick) => ({
      tick, bullets: [],
      bots: [{ id: 'player', teamId: 'player', position: { x: 3, y: 5 }, bodyAngle: Math.PI,
        turretAngle: 0, hp: 100, maxHp: 100, speed: 0 },
      { id: 'opponent', teamId: 'enemy', position: { x: 12, y: 5 }, bodyAngle: Math.PI,
        turretAngle: Math.PI, hp: 100, maxHp: 100, speed: 0 }],
      events: shots.includes(tick) ? [{ tick, type: 'ShotFired', sourceBotId: 'player', targetBotId: null,
        position: { x: 3.62, y: 5 }, bulletId: tick, damage: null }]
        : shots.includes(tick - 12) ? [{ tick, type: 'BotHit', sourceBotId: 'player', targetBotId: 'opponent',
          position: { x: 12, y: 5 }, bulletId: tick - 12, damage: 20 }] : [],
    })),
  };
}

function continuity(plan) {
  assert.equal(plan.shots[0].startFrame, 0);
  assert.equal(plan.shots.at(-1).endFrame, plan.lastFrame);
  for (let i = 0; i < plan.shots.length; i++) {
    const shot = plan.shots[i];
    assert(shot.endFrame > shot.startFrame, 'No empty shots');
    if (i) assert.equal(shot.startFrame, plan.shots[i - 1].endFrame, 'No replay gaps or overlaps');
    if (shot.kind !== 'gunner') continue;
    assert(shot.startFrame <= shot.eventFrame && shot.endFrame > shot.eventFrame + 1);
    assert(shot.endFrame - shot.startFrame <= 6, 'POV remains a short insert');
    assert.equal(shot.subject, 'player');
    assert.equal(directorStateAt(plan, shot.startFrame).mix, 1, 'Entry is a hard cut');
    assert.notEqual(shotAt(plan, shot.endFrame).kind, 'gunner');
    assert.equal(directorStateAt(plan, shot.endFrame).mix, 1, 'Exit never flies through the tank');
  }
}

const normal = fixture();
const plan = buildShotPlan(normal);
continuity(plan);
assert.equal(plan.shots.filter(shot => shot.kind === 'gunner').length, 2,
  'A medium-length fight may now have a second brief POV insert');
const short = buildShotPlan(fixture(180));
continuity(short);
assert.equal(short.shots.filter(shot => shot.kind === 'gunner').length, 1,
  'Short battles keep a single POV accent');
assert(plan.shots.some(shot => shot.kind === 'projectile') && plan.shots.some(shot => shot.kind === 'impact'),
  'External flight and impact coverage survives POV insertion');
const long = buildShotPlan(fixture(700));
continuity(long);
const inserts = long.shots.filter(shot => shot.kind === 'gunner');
assert.equal(inserts.length, 2);
assert(inserts[1].eventFrame - inserts[0].eventFrame >= 120, 'At least six simulation seconds between inserts');
const mediumInserts = plan.shots.filter(shot => shot.kind === 'gunner');
assert.equal(mediumInserts[1].eventFrame - mediumInserts[0].eventFrame, 120,
  'A suitable second shot can appear after six rather than seven seconds');
assert(inserts.reduce((sum, shot) => sum + shot.endFrame - shot.startFrame, 0) <= long.lastFrame * 0.1);
for (const montage of [short, plan, long]) {
  const duration = montage.shots.reduce((sum, shot) => sum + (shot.endFrame - shot.startFrame) / shot.playbackRate, 0);
  const povDuration = montage.shots.filter(shot => shot.kind === 'gunner')
    .reduce((sum, shot) => sum + (shot.endFrame - shot.startFrame) / shot.playbackRate, 0);
  assert(povDuration / duration < 0.1, 'Third-person shots dominate playback even after accounting for slow motion');
}
for (const kind of ['wall', 'point-blank', 'dead', 'fast-turret', 'no-shots']) {
  const replay = fixture();
  if (kind === 'wall') replay.arena.walls.push({ x: 7, y: 0, width: 1, height: 10 });
  for (const frame of replay.frames) {
    if (kind === 'point-blank') frame.bots[1].position.x = 4.9;
    if (kind === 'dead') frame.bots[0].hp = 0;
    if (kind === 'fast-turret') frame.bots[0].turretAngle = (frame.tick % 2) * 0.25;
    if (kind === 'no-shots') frame.events = [];
  }
  const unsafePlan = buildShotPlan(replay);
  continuity(unsafePlan);
  assert(!unsafePlan.shots.some(shot => shot.kind === 'gunner'), `${kind}: unsafe or empty POV rejected`);
}
const bot = normal.frames[30].bots[0];
const pose = gunnerPose(bot, normal.arena, { x: 12, y: 5 }, 30, 30);
const beforeFirstShot = gunnerPose(bot, normal.arena, undefined, 30, 28);
assert(Object.values(beforeFirstShot.position).every(Number.isFinite)
  && Object.values(beforeFirstShot.target).every(Number.isFinite), 'Anticipation before firing has a valid camera pose');
assert(pose.position.x > bot.position.x - 8, 'Camera follows turret, not chassis heading');
assert(pose.position.y > 0.47, 'Sight is above the shooter turret');
assert(pose.target.x > pose.position.x && pose.target.z === pose.position.z);
assert.deepEqual(gunnerPose(bot, normal.arena, { x: 12, y: 5 }, 30, 30.5),
  gunnerPose(bot, normal.arena, { x: 12, y: 5 }, 30, 30.5), 'Recoil is deterministic under pause and seek');
assert.deepEqual(buildShotPlan(normal), plan, 'The same replay always gets the same montage');
console.log('Gunner inserts: rarity, sightlines, turret motion, continuity, cuts and camera mount passed');
