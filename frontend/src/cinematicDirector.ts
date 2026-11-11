import type { Bot, Point, Replay, Wall } from './contracts';
import { botDirectorLabel } from './botVisuals';

export const VISUAL_TAIL_FRAMES = 15;

export type ShotKind = 'establishing' | 'duel' | 'follow' | 'projectile' | 'gunner' | 'impact' | 'finale';

export interface CinematicShot {
  id: string;
  kind: ShotKind;
  label: string;
  startFrame: number;
  endFrame: number;
  eventFrame?: number;
  subject?: Bot['id'];
  focus?: Point;
  bulletId?: number;
  azimuth: number;
  playbackRate: number;
  transitionFrames: number;
  hardCut?: boolean;
}

export interface ShotPlan {
  shots: CinematicShot[];
  lastFrame: number;
}

interface Highlight {
  kind: 'projectile' | 'impact' | 'finale';
  startFrame: number;
  endFrame: number;
  eventFrame?: number;
  focus?: Point;
  subject?: Bot['id'];
  bulletId?: number;
  label: string;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function frameBots(replay: Replay, frameIndex: number) {
  return replay.frames[clamp(Math.round(frameIndex), 0, replay.frames.length - 1)]?.bots ?? [];
}

function midpoint(points: Point[]): Point {
  if (!points.length) return { x: 0, y: 0 };
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function pointInsideWall(point: Point, wall: Wall, padding = 0) {
  return point.x >= wall.x - padding && point.x <= wall.x + wall.width + padding
    && point.y >= wall.y - padding && point.y <= wall.y + wall.height + padding;
}

// Liang–Barsky clipping: true means that the line of sight enters a wall rectangle.
function segmentHitsWall(from: Point, to: Point, wall: Wall) {
  const padding = 0.16;
  const minX = wall.x - padding;
  const maxX = wall.x + wall.width + padding;
  const minY = wall.y - padding;
  const maxY = wall.y + wall.height + padding;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let near = 0;
  let far = 1;
  const bounds = [
    [-dx, from.x - minX],
    [dx, maxX - from.x],
    [-dy, from.y - minY],
    [dy, maxY - from.y],
  ];

  for (const [p, q] of bounds) {
    if (Math.abs(p) < 1e-8) {
      if (q < 0) return false;
      continue;
    }
    const ratio = q / p;
    if (p < 0) near = Math.max(near, ratio);
    else far = Math.min(far, ratio);
    if (near > far) return false;
  }
  return far > 0.02 && near < 0.98;
}

function angularDistance(a: number, b: number) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

function chooseAzimuth(replay: Replay, shot: Omit<CinematicShot, 'id' | 'azimuth'>, previous: number) {
  const bots = frameBots(replay, (shot.startFrame + shot.endFrame) / 2);
  const subject = shot.subject ? bots.find(bot => bot.id === shot.subject) : undefined;
  const focus = shot.focus ?? subject?.position ?? midpoint(bots.map(bot => bot.position));
  const radius = shot.kind === 'impact' ? 3.15 : shot.kind === 'finale' ? 3.7
    : Math.max(replay.arena.width, replay.arena.height) * 0.72;
  const candidates = [-2.75, -2.05, -1.35, -0.65, 0.05, 0.75, 1.45, 2.15, 2.85];
  let best = previous;
  let bestScore = -Infinity;

  for (const azimuth of candidates) {
    const camera = {
      x: focus.x + Math.cos(azimuth) * radius,
      y: focus.y + Math.sin(azimuth) * radius,
    };
    let score = -angularDistance(azimuth, previous) * 0.55;
    const sightAngles: number[] = [];

    for (const bot of bots) {
      const blocked = replay.arena.walls.some(wall => segmentHitsWall(camera, bot.position, wall));
      score += blocked ? -5 : 4;
      sightAngles.push(Math.atan2(bot.position.y - camera.y, bot.position.x - camera.x));
    }
    if (shot.focus) {
      const focusBlocked = replay.arena.walls.some(wall => segmentHitsWall(camera, shot.focus!, wall));
      score += focusBlocked ? -16 : 8;
    }
    if (sightAngles.length === 2) {
      score += Math.min(angularDistance(sightAngles[0], sightAngles[1]) / 0.38, 1) * 2.2;
    }
    if (replay.arena.walls.some(wall => pointInsideWall(camera, wall, 0.3))) score -= 20;
    if (shot.kind === 'follow' && subject) {
      const subjectAngle = Math.atan2(subject.position.y - camera.y, subject.position.x - camera.x);
      score += Math.cos(subjectAngle - subject.bodyAngle) * 0.35;
    }
    if (score > bestScore) {
      bestScore = score;
      best = azimuth;
    }
  }
  return best;
}

function collectHighlights(replay: Replay, lastFrame: number, multiple: boolean): Highlight[] {
  const hits: Array<{
    frame: number;
    focus?: Point;
    subject?: Bot['id'];
    damage: number;
    bulletId?: number;
  }> = [];
  const fired = new Map<number, { frame: number; subject?: Bot['id']; focus?: Point }>();
  const destructions: Array<{
    frame: number;
    focus?: Point;
    subject?: Bot['id'];
    bulletId?: number;
  }> = [];

  replay.frames.forEach((frame, frameIndex) => frame.events.forEach(event => {
    if (event.type === 'ShotFired' && event.bulletId != null) {
      fired.set(event.bulletId, {
        frame: frameIndex,
        subject: event.sourceBotId ?? undefined,
        focus: event.position ?? undefined,
      });
    } else if (event.type === 'BotDestroyed') {
      destructions.push({
        frame: frameIndex,
        focus: event.position ?? undefined,
        subject: event.sourceBotId ?? undefined,
        bulletId: event.bulletId ?? undefined,
      });
    } else if (event.type === 'BotHit') {
      hits.push({
        frame: frameIndex,
        focus: event.position ?? undefined,
        subject: event.sourceBotId ?? undefined,
        damage: event.damage ?? 0,
        bulletId: event.bulletId ?? undefined,
      });
    }
  }));

  const lastDestructionFrame = destructions.reduce((latest, item) => Math.max(latest, item.frame), -1);
  const finalDestructions = destructions.filter(item => item.frame === lastDestructionFrame);
  const endedByDestruction = replay.result.reason === 'BotDestroyed' && lastDestructionFrame === lastFrame;
  const simultaneousKnockout = endedByDestruction && finalDestructions.length > 1 && replay.result.winnerBotId == null;
  const finalDestruction = endedByDestruction ? finalDestructions.at(-1) : undefined;
  const destruction: Highlight | undefined = finalDestruction ? {
    kind: 'finale',
    startFrame: Math.max(0, finalDestruction.frame - 13),
    endFrame: lastFrame,
    eventFrame: finalDestruction.frame,
    focus: simultaneousKnockout
      ? midpoint(finalDestructions.flatMap(item => item.focus ? [item.focus] : []))
      : finalDestruction.focus,
    subject: simultaneousKnockout ? undefined : finalDestruction.subject,
    bulletId: simultaneousKnockout ? undefined : finalDestruction.bulletId,
    label: simultaneousKnockout ? (multiple ? 'ВСЕ РОБОТЫ ВЫБЫЛИ' : 'ДВОЙНОЙ НОКАУТ')
      : finalDestruction.subject ? `ФИНАЛЬНЫЙ УДАР · ${botDirectorLabel(finalDestruction.subject, multiple)}`
      : 'ФИНАЛЬНЫЙ УДАР',
  } : undefined;
  const finaleStart = destruction?.startFrame ?? Math.max(0, lastFrame - 12);
  const eligible = hits.filter(hit => hit.frame >= 14 && hit.frame < finaleStart - 10);
  const selected: typeof eligible = [];
  for (const hit of eligible) {
    if (selected.every(previous => hit.frame - previous.frame >= 22)) selected.push(hit);
  }

  // Two impact inserts are enough to create a rhythm without turning the replay into a slideshow.
  const impacts = selected
    .sort((a, b) => b.damage - a.damage || a.frame - b.frame)
    .slice(0, 2)
    .sort((a, b) => a.frame - b.frame)
    .flatMap<Highlight>(hit => {
      const shot = hit.bulletId == null ? undefined : fired.get(hit.bulletId);
      const sequence: Highlight[] = [];
      const impactStart = shot && hit.frame === shot.frame ? hit.frame + 0.75 : hit.frame;
      if (shot) {
        sequence.push({
          kind: 'projectile',
          // Give the camera two frames of anticipation even for point-blank shots.
          startFrame: Math.max(0, shot.frame - 2),
          endFrame: impactStart,
          eventFrame: shot.frame,
          focus: shot.focus,
          subject: shot.subject ?? hit.subject,
          bulletId: hit.bulletId,
          label: shot.subject ? `ВЫСТРЕЛ · ${botDirectorLabel(shot.subject, multiple)}` : 'ПОЛЁТ СНАРЯДА',
        });
      }
      sequence.push({
        kind: 'impact',
        startFrame: impactStart,
        endFrame: Math.min(finaleStart, impactStart + 8),
        eventFrame: hit.frame,
        focus: hit.focus,
        subject: hit.subject,
        bulletId: hit.bulletId,
        label: hit.subject ? `ПОПАДАНИЕ · ${botDirectorLabel(hit.subject, multiple)}` : 'ПОПАДАНИЕ',
      });
      return sequence;
    });

  const fallbackFinale: Highlight = {
    kind: 'finale',
    startFrame: Math.max(0, lastFrame - 12),
    endFrame: lastFrame,
    eventFrame: lastFrame,
    subject: replay.result.winnerBotId ?? undefined,
    label: replay.result.winnerBotId ? `ФИНАЛ · ${botDirectorLabel(replay.result.winnerBotId, multiple)}` : 'ФИНАЛ БОЯ',
  };
  return [...impacts, destruction ?? fallbackFinale];
}

function fillerShots(startFrame: number, endFrame: number, serial: number, botIds: string[]) {
  const result: Array<Omit<CinematicShot, 'id' | 'azimuth'>> = [];
  const duration = endFrame - startFrame;
  if (duration <= 0.01) return result;
  const chunks = Math.max(1, Math.ceil(duration / 36));

  for (let chunk = 0; chunk < chunks; chunk += 1) {
    const start = startFrame + duration * chunk / chunks;
    const end = startFrame + duration * (chunk + 1) / chunks;
    const absolute = serial + chunk;
    const isOpening = startFrame === 0 && chunk === 0;
    const subject = botIds.length ? botIds[absolute % botIds.length] : undefined;
    result.push({
      kind: isOpening ? 'establishing' : absolute % 3 === 0 && subject ? 'follow' : 'duel',
      label: isOpening ? 'ОБЩИЙ ПЛАН' : absolute % 3 === 0
        ? `СОПРОВОЖДЕНИЕ · ${subject ? botDirectorLabel(subject, botIds.length > 2) : 'ЦЕЛЬ'}` : 'БОЕВОЙ КОНТАКТ',
      startFrame: start,
      endFrame: end,
      subject: isOpening ? undefined : subject,
      playbackRate: 1,
      transitionFrames: Math.min(7, Math.max(3, (end - start) * 0.22)),
    });
  }
  return result;
}

type PlannedShot = Omit<CinematicShot, 'id' | 'azimuth'>;

function gunnerFocus(replay: Replay, subjectId: string, start: number, eventFrame: number, end: number) {
  const bots = frameBots(replay, eventFrame);
  const subject = bots.find(bot => bot.id === subjectId);
  if (!subject || subject.hp <= 0 || subject.forfeited) return;
  const targets = bots.filter(bot => bot.id !== subjectId && bot.hp > 0 && !bot.forfeited
    && (!bot.teamId || bot.teamId !== subject.teamId));
  const target = targets.filter(bot => {
    const dx = bot.position.x - subject.position.x;
    const dy = bot.position.y - subject.position.y;
    return Math.hypot(dx, dy) >= 2.3
      && angularDistance(Math.atan2(dy, dx), subject.turretAngle) < 0.2;
  }).sort((a, b) => Math.hypot(a.position.x - subject.position.x, a.position.y - subject.position.y)
    - Math.hypot(b.position.x - subject.position.x, b.position.y - subject.position.y))[0];
  if (!target) return;
  let previousAngle: number | undefined;
  // Validate the entire insert, including anticipation and interpolation endpoints.
  for (let i = Math.floor(start); i <= Math.ceil(end); i++) {
    const frame = replay.frames[Math.min(i, replay.frames.length - 1)];
    const shooter = frame.bots.find(bot => bot.id === subjectId);
    const victim = frame.bots.find(bot => bot.id === target.id);
    if (!shooter || shooter.hp <= 0 || shooter.forfeited || !victim || victim.hp <= 0) return;
    if (previousAngle != null && angularDistance(shooter.turretAngle, previousAngle) > 0.12) return;
    previousAngle = shooter.turretAngle;
    const eye = { x: shooter.position.x + Math.cos(shooter.turretAngle) * 0.08,
      y: shooter.position.y + Math.sin(shooter.turretAngle) * 0.08 };
    if (eye.x < 0.15 || eye.y < 0.15 || eye.x > replay.arena.width - 0.15
      || eye.y > replay.arena.height - 0.15) return;
    if (replay.arena.walls.some(wall => pointInsideWall(eye, wall, 0.12)
      || segmentHitsWall(eye, victim.position, wall))) return;
    const bearing = Math.atan2(victim.position.y - eye.y, victim.position.x - eye.x);
    if (angularDistance(bearing, shooter.turretAngle) > 0.3) return;
  }
  return target.position;
}

function addGunnerInserts(replay: Replay, shots: PlannedShot[]): PlannedShot[] {
  const result = shots.slice();
  const lastFrame = replay.frames.length - 1;
  // A second insert is available a little earlier, but external coverage stays dominant.
  const maximum = lastFrame >= replay.tickRate * 12 ? 2 : 1;
  let count = 0;
  let lastInsert = -Infinity;
  let budget = Math.floor(lastFrame * 0.1);
  const opening = Math.min(replay.tickRate * 1.2, lastFrame * 0.2);
  for (let frameIndex = 0; frameIndex < replay.frames.length && count < maximum; frameIndex++) {
    if (frameIndex - lastInsert < replay.tickRate * 6) continue;
    for (const event of replay.frames[frameIndex].events) {
      if (count >= maximum || event.type !== 'ShotFired' || !event.sourceBotId) continue;
      const index = result.findIndex(shot => shot.startFrame <= frameIndex && frameIndex < shot.endFrame);
      const shot = result[index];
      if (!shot || !['establishing', 'duel', 'follow', 'projectile'].includes(shot.kind)) continue;
      if (shot.kind === 'projectile' && shot.bulletId !== event.bulletId) continue;
      const start = Math.max(shot.startFrame, frameIndex - 2);
      const end = Math.min(shot.endFrame, frameIndex + 4, start + budget);
      if (start < opening || end - start < 4 || end < frameIndex + 2) continue;
      const focus = gunnerFocus(replay, event.sourceBotId, start, frameIndex, end);
      if (!focus) continue;
      const replacement: PlannedShot[] = [];
      if (start > shot.startFrame) replacement.push({ ...shot, endFrame: start });
      replacement.push({
        kind: 'gunner', startFrame: start, endFrame: end, eventFrame: frameIndex,
        subject: event.sourceBotId, focus, bulletId: event.bulletId ?? undefined,
        label: `ОТ ЛИЦА НАВОДЧИКА · ${botDirectorLabel(event.sourceBotId, frameBots(replay, frameIndex).length > 2)}`,
        playbackRate: 0.5, hardCut: true, transitionFrames: 0,
      });
      if (end < shot.endFrame) replacement.push({ ...shot, startFrame: end, hardCut: true, transitionFrames: 0 });
      result.splice(index, 1, ...replacement);
      count += 1;
      lastInsert = frameIndex;
      budget -= end - start;
      break;
    }
  }
  // Never interpolate the external camera through the turret when leaving POV.
  return result.map((shot, index) => result[index - 1]?.kind === 'gunner'
    ? { ...shot, hardCut: true, transitionFrames: 0 } : shot);
}

export function buildShotPlan(replay: Replay): ShotPlan {
  const lastFrame = Math.max(0, replay.frames.length - 1);
  if (lastFrame === 0) return { shots: [], lastFrame };
  const raw: Array<Omit<CinematicShot, 'id' | 'azimuth'>> = [];
  const botIds = [...new Set(replay.frames.flatMap(frame => frame.bots.map(bot => bot.id)))];
  const highlights = collectHighlights(replay, lastFrame, botIds.length > 2).sort((a, b) => a.startFrame - b.startFrame);
  let cursor = 0;
  let fillerSerial = 0;

  for (const highlight of highlights) {
    const start = clamp(highlight.startFrame, cursor, lastFrame);
    raw.push(...fillerShots(cursor, start, fillerSerial, botIds));
    fillerSerial += 1;
    if (highlight.endFrame > start) {
      raw.push({
        ...highlight,
        startFrame: start,
        endFrame: clamp(highlight.endFrame, start, lastFrame),
        playbackRate: highlight.kind === 'projectile' ? 0.22
          : highlight.kind === 'impact' ? 0.34 : 0.36,
        transitionFrames: highlight.kind === 'projectile' || highlight.kind === 'impact' ? 0 : 4,
        hardCut: highlight.kind === 'projectile' || highlight.kind === 'impact',
      });
    }
    cursor = Math.max(cursor, highlight.endFrame);
  }
  raw.push(...fillerShots(cursor, lastFrame, fillerSerial, botIds));

  let previousAzimuth = 0.75;
  const shots = addGunnerInserts(replay, raw).filter(shot => shot.endFrame - shot.startFrame > 0.01).map((shot, index) => {
    const azimuth = chooseAzimuth(replay, shot, previousAzimuth);
    previousAzimuth = azimuth;
    return { ...shot, id: `shot-${String(index + 1).padStart(2, '0')}`, azimuth };
  });
  return { shots, lastFrame };
}

export function shotAt(plan: ShotPlan, position: number) {
  return plan.shots.find((shot, index) => position < shot.endFrame || index === plan.shots.length - 1);
}

export function directorStateAt(plan: ShotPlan, position: number) {
  const index = plan.shots.findIndex((shot, shotIndex) => position < shot.endFrame || shotIndex === plan.shots.length - 1);
  const shot = plan.shots[Math.max(0, index)];
  const previous = index > 0 ? plan.shots[index - 1] : undefined;
  if (!shot) return { shot: undefined, previous: undefined, mix: 1 };
  if (shot.hardCut) return { shot, previous, mix: 1 };
  const progress = clamp((position - shot.startFrame) / Math.max(0.001, shot.transitionFrames), 0, 1);
  const mix = progress * progress * (3 - 2 * progress);
  return { shot, previous, mix: previous ? mix : 1 };
}

export function directorPlaybackRate(plan: ShotPlan, position: number) {
  return shotAt(plan, position)?.playbackRate ?? 1;
}
