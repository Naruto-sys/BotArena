(() => {
  const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
  const pointOf = value => {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
    const x = value.x, y = value.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  };
  const positionOf = value => {
    if (value == null || typeof value !== 'object') return null;
    return pointOf(value.position ?? value);
  };

  globalThis.distance = (a, b) => {
    const left = positionOf(a), right = positionOf(b);
    if (!left || !right) return Infinity;
    return Math.hypot(right.x - left.x, right.y - left.y);
  };

  globalThis.reached = (self, point, radius = 0.55) =>
    Number.isFinite(radius) && distance(self, point) <= radius;

  globalThis.driveTo = (self, point) => {
    const target = positionOf(point);
    if (!self?.position || !target) return { leftTrack: 0, rightTrack: 0 };
    const dx = target.x - self.position.x;
    const dy = target.y - self.position.y;
    const error = wrap(Math.atan2(dy, dx) - self.bodyAngle);
    const turn = Math.max(-1, Math.min(1, error * 2));
    const drive = Math.abs(error) < 0.55 ? 1 : 0;
    return { leftTrack: drive + turn, rightTrack: drive - turn };
  };

  globalThis.aimAt = (self, point) => {
    const target = positionOf(point);
    if (!self?.position || !target) return { aimDirection: { x: 0, y: 0 } };
    return {
      aimDirection: {
        x: target.x - self.position.x,
        y: target.y - self.position.y
      }
    };
  };

  globalThis.facing = (self, point, tolerance = 0.06) => {
    const target = positionOf(point);
    if (!self?.position || !target || !Number.isFinite(tolerance)) return false;
    const heading = Math.atan2(target.y - self.position.y, target.x - self.position.x);
    return Math.abs(wrap(heading - self.turretAngle)) <= tolerance;
  };
})();
