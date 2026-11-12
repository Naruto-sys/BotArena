import type { Arena, Bot, Point } from './contracts';

/** A sight mounted above the turret; arena XY maps to world XZ. */
export function gunnerPose(bot: Bot, arena: Arena, focus: Point | undefined, eventFrame: number, position: number) {
  const dx = Math.cos(bot.turretAngle);
  const dz = Math.sin(bot.turretAngle);
  const distance = focus ? Math.hypot(focus.x - bot.position.x, focus.y - bot.position.y) : 7;
  const lookAhead = Math.max(2.5, Math.min(12, distance));
  const age = position - eventFrame;
  // Recoil follows replay time, so pause and backwards scrubbing remain deterministic.
  const recoil = age >= 0 && age < 3 ? Math.sin(age * Math.PI) * Math.exp(-age * 1.8) : 0;
  const x = bot.position.x - arena.width / 2;
  const z = bot.position.y - arena.height / 2;
  return {
    position: { x: x + dx * (0.08 - recoil * 0.035), y: 0.56 + recoil * 0.012,
      z: z + dz * (0.08 - recoil * 0.035) },
    target: { x: x + dx * lookAhead, y: 0.34 - recoil * 0.025, z: z + dz * lookAhead },
    fov: 58,
  };
}
