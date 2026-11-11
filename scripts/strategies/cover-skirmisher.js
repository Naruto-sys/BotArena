// Для JavaScript и гусеничного шасси «Танк». Вставить файл целиком.
// Размеры и динамика соответствуют стандартной симуляции BotArena.
const sk = { nodes: null, edges: null, goal: null, nav: null, planAt: -100,
  enemy: null, seenAt: -100, trail: [], prev: null, spin: 0,
  left: 0, right: 0, recoverUntil: 0, banned: null, bannedUntil: 0, visits: [] };
const sat = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const angle = a => Math.atan2(Math.sin(a), Math.cos(a));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Доля отрезка до входа в стену; Infinity означает отсутствие пересечения.
function entry(a, b, w, pad) {
  let near = 0, far = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - w.x + pad, w.x + w.width + pad - a.x,
    a.y - w.y + pad, w.y + w.height + pad - a.y];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-8) { if (q[i] < 0) return Infinity; }
    else {
      const t = q[i] / p[i];
      if (p[i] < 0) near = Math.max(near, t); else far = Math.min(far, t);
      if (near > far) return Infinity;
    }
  }
  return near;
}
function clear(a, b, walls, pad = 0.49) {
  return !walls.some(w => entry(a, b, w, pad) <= 1);
}
function free(p, arena, pad = 0.52) {
  return p.x > pad && p.y > pad && p.x < arena.width - pad && p.y < arena.height - pad
    && clear(p, p, arena.walls, pad);
}
function safe(p, zone, margin = 0.65) {
  return !zone || (p.x > zone.x + Math.min(margin, zone.width * 0.2)
    && p.x < zone.x + zone.width - Math.min(margin, zone.width * 0.2)
    && p.y > zone.y + Math.min(margin, zone.height * 0.2)
    && p.y < zone.y + zone.height - Math.min(margin, zone.height * 0.2));
}

function buildMap(arena) {
  const points = [];
  for (const w of arena.walls) {
    const l = w.x - 0.64, r = w.x + w.width + 0.64;
    const t = w.y - 0.64, b = w.y + w.height + 0.64;
    const x = (l + r) / 2, y = (t + b) / 2;
    points.push({ x: l, y: t }, { x: r, y: t }, { x: l, y: b }, { x: r, y: b },
      { x: l, y }, { x: r, y }, { x, y: t }, { x, y: b });
  }
  for (const u of [0.2, 0.5, 0.8]) for (const v of [0.2, 0.5, 0.8])
    points.push({ x: arena.width * u, y: arena.height * v });
  sk.nodes = points.filter(p => free(p, arena)).slice(0, 64);
  sk.edges = sk.nodes.map(() => []);
  for (let i = 0; i < sk.nodes.length; i++) for (let j = i + 1; j < sk.nodes.length; j++) {
    if (!clear(sk.nodes[i], sk.nodes[j], arena.walls)) continue;
    const length = dist(sk.nodes[i], sk.nodes[j]);
    sk.edges[i].push([j, length]); sk.edges[j].push([i, length]);
  }
}

function plan(state, enemy) {
  const { self, arena, safeZone: zone } = state;
  const n = sk.nodes.length, costs = Array(n).fill(Infinity);
  const first = Array(n).fill(-1), visited = Array(n).fill(false);
  // Из тесного положения разрешаем сначала выйти из консервативного отступа.
  // Реальную безопасность повёрнутого корпуса всё равно проверяет maneuver().
  const startPad = free(self.position, arena, 0.49) ? 0.49 : 0.30;
  // Дейкстра: маршрут может огибать несколько стен, а не только одну.
  for (let i = 0; i < n; i++) if (clear(self.position, sk.nodes[i], arena.walls, startPad)) {
    costs[i] = dist(self.position, sk.nodes[i]); first[i] = i;
  }
  for (let step = 0; step < n; step++) {
    let at = -1;
    for (let i = 0; i < n; i++) if (!visited[i] && (at < 0 || costs[i] < costs[at])) at = i;
    if (at < 0 || !Number.isFinite(costs[at])) break;
    visited[at] = true;
    for (const [to, length] of sk.edges[at]) {
      const cost = costs[at] + length;
      if (cost < costs[to]) { costs[to] = cost; first[to] = first[at]; }
    }
  }
  const candidates = sk.nodes.map((p, i) => ({ p, cost: costs[i], first: first[i] }));
  const center = zone ? { x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 }
    : { x: arena.width / 2, y: arena.height / 2 };
  const extras = [center];
  if (enemy) {
    const bearing = Math.atan2(self.position.y - enemy.position.y, self.position.x - enemy.position.x);
    for (const offset of [-1.1, -0.55, 0.55, 1.1]) extras.push({
      x: enemy.position.x + Math.cos(bearing + offset) * 4.6,
      y: enemy.position.y + Math.sin(bearing + offset) * 4.6,
    });
  }
  for (const p of extras) {
    if (!free(p, arena)) continue;
    let cost = clear(self.position, p, arena.walls, startPad) ? dist(self.position, p) : Infinity;
    let via = -1;
    for (let i = 0; i < n; i++) if (costs[i] + dist(sk.nodes[i], p) < cost
      && clear(sk.nodes[i], p, arena.walls)) {
      cost = costs[i] + dist(sk.nodes[i], p); via = first[i];
    }
    candidates.push({ p, cost, first: via });
  }
  let best = null, bestScore = Infinity;
  for (const c of candidates) {
    if (!Number.isFinite(c.cost) || !safe(c.p, zone)) continue;
    let score = c.cost * 0.38;
    if (dist(self.position, c.p) < 1.15) score += 7;
    if (sk.banned && state.tick < sk.bannedUntil && dist(c.p, sk.banned) < 0.8) score += 15;
    if (sk.goal && dist(c.p, sk.goal) < 0.2) score -= 0.8;
    // Без контакта исследуем карту, вместо бесконечной езды вокруг одной стены.
    if (!state.enemy) for (const visit of sk.visits) {
      if (dist(c.p, visit.p) < 1.3)
        score += Math.max(0, 1 - (state.tick - visit.tick) / 240) * 5;
    }
    if (enemy) {
      const range = dist(enemy.position, c.p);
      const covered = !clear(enemy.position, c.p, arena.walls, 0.035);
      score += Math.abs(range - 4.8) * 0.65;
      // Во время перезарядки уходим за стену, к готовому выстрелу ищем прострел.
      score += covered ? (self.reloadingTime > 0.2 ? -3.2 : 0.4)
        : (self.reloadingTime > 0.2 ? 1.6 : -1.5);
      if (range < 2) score += 6;
    } else {
      score += dist(c.p, center) * 0.1;
    }
    if (score < bestScore) { bestScore = score; best = c; }
  }
  const fallback = sk.nodes.filter(p => safe(p, zone))
    .sort((a, b) => dist(self.position, a) - dist(self.position, b))[0] || center;
  sk.goal = best ? best.p : fallback;
  sk.nav = best && best.first >= 0 ? sk.nodes[best.first] : sk.goal;
  sk.planAt = state.tick;
}

// SAT-проверка повёрнутого корпуса: он шире точки, особенно у углов стен.
function collision(x, y, heading, arena) {
  const c = Math.cos(heading), s = Math.sin(heading), ac = Math.abs(c), as = Math.abs(s);
  const ex = ac * 0.35 + as * 0.30, ey = as * 0.35 + ac * 0.30;
  if (x < ex || y < ey || x > arena.width - ex || y > arena.height - ey) return true;
  for (const w of arena.walls) {
    const hx = w.width / 2, hy = w.height / 2;
    const dx = w.x + hx - x, dy = w.y + hy - y;
    if (Math.abs(dx) < ex + hx && Math.abs(dy) < ey + hy
      && Math.abs(dx * c + dy * s) < 0.35 + hx * ac + hy * as
      && Math.abs(-dx * s + dy * c) < 0.30 + hx * as + hy * ac) return true;
  }
  return false;
}

function threats(state) {
  return (state.bullets || []).filter(b => b.ownerBotId !== state.self.id)
    .map(b => {
      const vx = b.direction.x * 13, vy = b.direction.y * 13;
      const dx = state.self.position.x - b.position.x, dy = state.self.position.y - b.position.y;
      const closest = sat((dx * vx + dy * vy) / 169, 0, 0.85);
      let life = 0.85;
      const end = { x: b.position.x + vx * life, y: b.position.y + vy * life };
      for (const wall of state.arena.walls) life = Math.min(life, entry(b.position, end, wall, 0.045) * 0.85);
      return { x: b.position.x, y: b.position.y, vx, vy, life,
        rank: Math.hypot(dx - vx * closest, dy - vy * closest) + closest };
    }).filter(b => b.rank < 5).sort((a, b) => a.rank - b.rank).slice(0, 8);
}

function maneuver(state, target, bullets) {
  const { self, arena, safeZone: zone } = state;
  const p = self.position, nav = sk.nav;
  const error = angle(Math.atan2(nav.y - p.y, nav.x - p.x) - self.bodyAngle);
  const steer = sat(error * 1.6);
  const drive = Math.abs(error) > 1.3 ? 0 : Math.abs(error) > 0.65 ? 0.45 : 0.95;
  const actions = [[sat(drive + steer), sat(drive - steer)],
    [1, 1], [1, 0.4], [0.4, 1], [1, -0.35], [-0.35, 1],
    [1, -1], [-1, 1], [-0.85, -0.85], [-1, -0.25], [-0.25, -1], [0, 0]];
  let best = actions[0], bestScore = -Infinity;
  for (const action of actions) {
    const [left, right] = action;
    let x = p.x, y = p.y, h = self.bodyAngle, speed = self.speed, spin = sk.spin, penalty = 0;
    const throttle = (left + right) / 2, turnRate = (left - right) * 1.5;
    for (let step = 1; step <= 6; step++) {
      const dt = 0.12, time = step * dt, px = x, py = y;
      const wanted = throttle * (throttle < 0 ? 2 : 3.6);
      const braking = Math.abs(wanted) < Math.abs(speed) || wanted * speed < 0;
      speed += sat(wanted - speed, -(braking ? 12 : 8) * dt, (braking ? 12 : 8) * dt);
      spin += (turnRate - spin) * 0.4512;
      h += spin * dt; x += Math.cos(h) * speed * dt; y += Math.sin(h) * speed * dt;
      if (collision(x, y, h, arena)) {
        penalty += state.tick < sk.recoverUntil ? 75 / (step * step) : 50 + (7 - step) * 8;
        x = px; y = py; break;
      }
      if (!safe({ x, y }, zone, 0.35)) penalty += 5 + step;
      for (const b of bullets) {
        if (time - dt > b.life) continue;
        const t1 = Math.min(time, b.life), t0 = time - dt;
        const rx = b.x + b.vx * t0 - px, ry = b.y + b.vy * t0 - py;
        const vx = b.vx * (t1 - t0) - (x - px), vy = b.vy * (t1 - t0) - (y - py);
        const t = sat(-(rx * vx + ry * vy) / Math.max(1e-6, vx * vx + vy * vy), 0, 1);
        const d2 = (rx + vx * t) ** 2 + (ry + vy * t) ** 2;
        penalty += 65 * Math.exp(-d2 / 0.42) / (1 + time * 2);
      }
      if (target && clear(target.position, { x, y }, arena.walls, 0.025)) {
        const dx = x - target.position.x, dy = y - target.position.y;
        const forward = dx * Math.cos(target.turretAngle) + dy * Math.sin(target.turretAngle);
        const across = -dx * Math.sin(target.turretAngle) + dy * Math.cos(target.turretAngle);
        if (forward > 0) penalty += (target.reloadingTime < 0.65 ? 2.4 : 0.6) * Math.exp(-across * across / 0.55);
      }
    }
    const bearing = Math.atan2(nav.y - y, nav.x - x);
    let score = (dist(p, nav) - Math.hypot(nav.x - x, nav.y - y)) * 5
      + Math.cos(bearing - h) * 1.1 - penalty;
    score -= (Math.abs(left - sk.left) + Math.abs(right - sk.right)) * 0.12;
    if (throttle < 0) score -= 0.35;
    if (Math.abs(throttle) < 0.05) score -= 0.4;
    if (state.tick < sk.recoverUntil) score += throttle < -0.4 ? 3 : 0;
    if (score > bestScore) { bestScore = score; best = action; }
  }
  sk.left = best[0]; sk.right = best[1];
  return { leftTrack: best[0], rightTrack: best[1] };
}

function tick(state) {
  const { self, arena } = state;
  if (!sk.nodes) buildMap(arena);
  if (sk.prev) sk.spin = angle(self.bodyAngle - sk.prev.bodyAngle) * 20;
  const visible = (state.enemies || (state.enemy ? [state.enemy] : []))
    .filter(e => e.hp > 0 && !e.forfeited);
  visible.sort((a, b) => dist(self.position, a.position) - dist(self.position, b.position));
  const enemy = visible[0] || state.enemy;
  const appeared = enemy && (!sk.enemy || enemy.id !== sk.enemy.id || state.tick - sk.seenAt > 10);
  if (enemy) { sk.enemy = enemy; sk.seenAt = state.tick; }
  const memory = state.tick - sk.seenAt < 70 ? sk.enemy : null;

  if (sk.goal && dist(self.position, sk.goal) < 0.8
    && (!sk.visits.length || dist(sk.visits[sk.visits.length - 1].p, sk.goal) > 0.5)) {
    sk.visits.push({ p: sk.goal, tick: state.tick });
    if (sk.visits.length > 16) sk.visits.shift();
  }

  sk.trail.push({ ...self.position });
  if (sk.trail.length > 22) sk.trail.shift();
  if (sk.trail.length === 22 && state.tick >= sk.recoverUntil
    && dist(sk.trail[0], self.position) < 0.22) {
    sk.recoverUntil = state.tick + 16;
    sk.banned = sk.goal; sk.bannedUntil = state.tick + 90;
    sk.planAt = -100; sk.trail = [];
  }
  if (!sk.nav || appeared || state.tick - sk.planAt >= 16 || dist(self.position, sk.nav) < 0.55)
    plan(state, memory);
  const move = maneuver(state, enemy, threats(state));
  sk.prev = self;

  if (!enemy) return { ...move, aimDirection: memory
    ? { x: memory.position.x - self.position.x, y: memory.position.y - self.position.y }
    : { x: sk.nav.x - self.position.x, y: sk.nav.y - self.position.y }, shoot: false };
  const velocity = enemy.velocity || { x: Math.cos(enemy.bodyAngle) * enemy.speed,
    y: Math.sin(enemy.bodyAngle) * enemy.speed };
  let flight = Math.max(0, (dist(self.position, enemy.position) - 0.62) / 13), aim = enemy.position;
  for (let i = 0; i < 3; i++) {
    aim = { x: enemy.position.x + velocity.x * flight, y: enemy.position.y + velocity.y * flight };
    flight = sat((dist(self.position, aim) - 0.62) / 13, 0, 1.2);
  }
  const aimDirection = { x: aim.x - self.position.x, y: aim.y - self.position.y };
  const tolerance = sat(Math.atan2(0.22, dist(self.position, aim)), 0.025, 0.075);
  return { ...move, aimDirection, shoot: self.canShoot
    && Math.abs(angle(Math.atan2(aimDirection.y, aimDirection.x) - self.turretAngle)) < tolerance
    && clear(self.position, aim, arena.walls, 0.05) };
}
