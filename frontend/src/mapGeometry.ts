import type { Wall } from './contracts';
import type { LabBot } from './labDraft';

// MatchConfig.Classic hull dimensions: 0.68 × 0.58, independent of chassis.
export function wallOverlapsBot(wall: Wall, bot: Pick<LabBot, 'position' | 'bodyAngle'>): boolean {
  const forward = { x: Math.cos(bot.bodyAngle), y: Math.sin(bot.bodyAngle) };
  const side = { x: -forward.y, y: forward.x };
  const dx = bot.position.x - (wall.x + wall.width / 2);
  const dy = bot.position.y - (wall.y + wall.height / 2);
  return [{ x: 1, y: 0 }, { x: 0, y: 1 }, forward, side].every(axis => {
    const robotExtent = .34 * Math.abs(forward.x * axis.x + forward.y * axis.y)
      + .29 * Math.abs(side.x * axis.x + side.y * axis.y);
    const wallExtent = wall.width / 2 * Math.abs(axis.x) + wall.height / 2 * Math.abs(axis.y);
    return Math.abs(dx * axis.x + dy * axis.y) <= robotExtent + wallExtent;
  });
}
