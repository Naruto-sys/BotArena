namespace BotArena;

public record BehaviorPreset(string Id, string Name, string Description, string Strength);

internal static class BehaviorPresets
{
    private static readonly Dictionary<string, string> Aliases = new(StringComparer.OrdinalIgnoreCase)
    {
        ["idle"] = "blind-afraid",
        ["skirmisher"] = "assault",
        ["rusher"] = "assault",
        ["aggressive"] = "assault",
        ["defensive"] = "trench",
    };

    private static readonly (BehaviorPreset Info, string Script)[] Catalog =
    [
        (new("blind-afraid", "Слепой / боится",
            "Стоит на месте и палит в случайные стороны.", "weak"),
            """
            let aim = null;
            function tick({ self, tick }) {
              if (!aim || tick % 28 === 0) {
                const angle = Math.random() * Math.PI * 2;
                aim = {
                  x: self.position.x + Math.cos(angle) * 6,
                  y: self.position.y + Math.sin(angle) * 6
                };
              }
              return {
                aimAt: aim,
                shoot: self.canShoot
              };
            }
            """),
        (new("blind-berserk", "Слепой / обезумел",
            "Едет куда попало и стреляет в случайные стороны.", "weak"),
            """
            let goal = null;
            let aim = null;
            function clampPoint(point, arena) {
              return {
                x: Math.min(arena.width - 0.8, Math.max(0.8, point.x)),
                y: Math.min(arena.height - 0.8, Math.max(0.8, point.y))
              };
            }
            function tick({ self, tick, arena }) {
              if (!goal || reached(self, goal, 0.85) || tick % 90 === 0) {
                goal = clampPoint({
                  x: Math.random() * arena.width,
                  y: Math.random() * arena.height
                }, arena);
              }
              if (!aim || tick % 22 === 0) {
                const angle = Math.random() * Math.PI * 2;
                aim = {
                  x: self.position.x + Math.cos(angle) * 7,
                  y: self.position.y + Math.sin(angle) * 7
                };
              }
              return {
                driveTo: goal,
                aimAt: aim,
                shoot: self.canShoot
              };
            }
            """),
        (new("patrol", "Патрульный",
            "Патрулирует зону и стреляет по врагу, если видит его.", "standard"),
            """
            let route = null;
            let index = 0;
            function buildRoute(self, arena) {
              const left = self.position.x < arena.width * 0.5;
              const x1 = left ? Math.max(1.5, arena.width * 0.18) : Math.min(arena.width - 1.5, arena.width * 0.82);
              const x2 = left ? Math.max(2.5, arena.width * 0.34) : Math.min(arena.width - 2.5, arena.width * 0.66);
              const y1 = Math.max(1.6, arena.height * 0.22);
              const y2 = Math.min(arena.height - 1.6, arena.height * 0.78);
              return [
                { x: x1, y: y1 },
                { x: x2, y: y1 },
                { x: x2, y: y2 },
                { x: x1, y: y2 }
              ];
            }
            function tick({ self, enemy, arena }) {
              if (!route) route = buildRoute(self, arena);
              if (reached(self, route[index], 0.75)) index = (index + 1) % route.length;
              const waypoint = route[index];
              if (enemy) {
                return {
                  driveTo: waypoint,
                  aimAt: enemy.position,
                  shoot: self.canShoot && facing(self, enemy.position)
                };
              }
              return {
                driveTo: waypoint,
                aimAt: waypoint
              };
            }
            """),
        (new("trench", "Окопный",
            "Ищет укрытие, прячется, выглядывает, стреляет и снова прячется.", "standard"),
            """
            let mode = 'seek';
            let hold = null;
            let peek = null;
            let peekTicks = 0;

            function clamp(point, arena) {
              return {
                x: Math.min(arena.width - 0.7, Math.max(0.7, point.x)),
                y: Math.min(arena.height - 0.7, Math.max(0.7, point.y))
              };
            }

            function wallCenter(wall) {
              return { x: wall.x + wall.width / 2, y: wall.y + wall.height / 2 };
            }

            function pickCover(self, threat, walls, arena) {
              if (!walls || walls.length === 0) {
                const side = self.position.x < arena.width / 2 ? 1 : -1;
                const base = clamp({
                  x: self.position.x + side * 2.2,
                  y: self.position.y
                }, arena);
                return {
                  hold: base,
                  peek: clamp({ x: base.x + side * 1.1, y: base.y }, arena)
                };
              }

              let best = null;
              let bestScore = Infinity;
              for (const wall of walls) {
                const center = wallCenter(wall);
                const away = {
                  x: center.x - threat.x,
                  y: center.y - threat.y
                };
                const len = Math.hypot(away.x, away.y) || 1;
                const nx = away.x / len;
                const ny = away.y / len;
                const pad = 0.95;
                const holdPoint = clamp({
                  x: center.x + nx * (wall.width * 0.5 + pad),
                  y: center.y + ny * (wall.height * 0.5 + pad)
                }, arena);
                const peekPoint = clamp({
                  x: holdPoint.x - nx * 1.25,
                  y: holdPoint.y - ny * 1.25
                }, arena);
                const score = distance(self, holdPoint) + distance(holdPoint, threat) * 0.15;
                if (score < bestScore) {
                  bestScore = score;
                  best = { hold: holdPoint, peek: peekPoint };
                }
              }
              return best;
            }

            function tick({ self, enemy, arena }) {
              const threat = enemy
                ? enemy.position
                : { x: arena.width - self.position.x, y: arena.height - self.position.y };
              const cover = pickCover(self, threat, arena.walls, arena);
              if (!cover) return {};
              hold = cover.hold;
              peek = cover.peek;

              if (mode === 'seek' || mode === 'hide') {
                if (reached(self, hold, 0.65)) {
                  mode = 'hide';
                  if (enemy) {
                    mode = 'peek';
                    peekTicks = 0;
                  }
                }
                return {
                  driveTo: hold,
                  aimAt: enemy ? enemy.position : hold,
                  shoot: false
                };
              }

              if (mode === 'peek') {
                peekTicks += 1;
                const atPeek = reached(self, peek, 0.7);
                if (!enemy || peekTicks > 55) {
                  mode = 'hide';
                  return {
                    driveTo: hold,
                    aimAt: enemy ? enemy.position : hold,
                    shoot: false
                  };
                }
                return {
                  driveTo: atPeek ? peek : peek,
                  aimAt: enemy.position,
                  shoot: atPeek && self.canShoot && facing(self, enemy.position)
                };
              }

              mode = 'seek';
              return { driveTo: hold, aimAt: hold };
            }
            """),
        (new("assault", "Штурмовик",
            "Строит путь BFS вокруг стен, сближается с врагом и стреляет.", "standard"),
            """
            const CELL = 1;
            const MARGIN = 0.55;
            const DC = [1, -1, 0, 0];
            const DR = [0, 0, 1, -1];

            let occ = null;
            let cols = 0;
            let rows = 0;
            let path = null;
            let pathGoal = null;
            let pathTick = -999;
            let scout = null;
            let lastPos = null;
            let stuckFor = 0;
            let visited = null;
            let parent = null;
            let queue = null;

            function world(c, r) {
              return { x: (c + 0.5) * CELL, y: (r + 0.5) * CELL };
            }

            function buildOccupancy(arena, walls) {
              cols = Math.max(1, Math.ceil(arena.width / CELL));
              rows = Math.max(1, Math.ceil(arena.height / CELL));
              const size = cols * rows;
              occ = new Int8Array(size);
              visited = new Int8Array(size);
              parent = new Int16Array(size);
              queue = new Int16Array(size);

              const minC = Math.max(0, Math.floor(MARGIN / CELL));
              const maxC = Math.min(cols - 1, Math.floor((arena.width - MARGIN) / CELL));
              const minR = Math.max(0, Math.floor(MARGIN / CELL));
              const maxR = Math.min(rows - 1, Math.floor((arena.height - MARGIN) / CELL));
              for (let i = 0; i < size; i++) occ[i] = 1;
              for (let r = minR; r <= maxR; r++) {
                for (let c = minC; c <= maxC; c++) occ[r * cols + c] = 0;
              }

              for (let i = 0; i < walls.length; i++) {
                const wall = walls[i];
                const c0 = Math.max(0, Math.floor((wall.x - MARGIN) / CELL));
                const r0 = Math.max(0, Math.floor((wall.y - MARGIN) / CELL));
                const c1 = Math.min(cols - 1, Math.floor((wall.x + wall.width + MARGIN) / CELL));
                const r1 = Math.min(rows - 1, Math.floor((wall.y + wall.height + MARGIN) / CELL));
                for (let r = r0; r <= r1; r++) {
                  for (let c = c0; c <= c1; c++) occ[r * cols + c] = 1;
                }
              }
            }

            function cellOf(point) {
              return {
                c: Math.max(0, Math.min(cols - 1, Math.floor(point.x / CELL))),
                r: Math.max(0, Math.min(rows - 1, Math.floor(point.y / CELL)))
              };
            }

            function nearestFree(point) {
              const start = cellOf(point);
              if (!occ[start.r * cols + start.c]) return start;
              for (let radius = 1; radius <= 5; radius++) {
                for (let dc = -radius; dc <= radius; dc++) {
                  for (let dr = -radius; dr <= radius; dr++) {
                    if (Math.abs(dc) !== radius && Math.abs(dr) !== radius) continue;
                    const c = start.c + dc;
                    const r = start.r + dr;
                    if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
                    if (!occ[r * cols + c]) return { c, r };
                  }
                }
              }
              return start;
            }

            function bfsPath(startPoint, goalPoint) {
              const start = nearestFree(startPoint);
              const goal = nearestFree(goalPoint);
              const startIndex = start.r * cols + start.c;
              const goalIndex = goal.r * cols + goal.c;
              if (startIndex === goalIndex) return [world(goal.c, goal.r)];

              const size = cols * rows;
              for (let i = 0; i < size; i++) {
                visited[i] = 0;
                parent[i] = -1;
              }

              let head = 0;
              let tail = 0;
              queue[tail++] = startIndex;
              visited[startIndex] = 1;

              let found = -1;
              while (head < tail) {
                const current = queue[head++];
                if (current === goalIndex) {
                  found = current;
                  break;
                }
                const c = current % cols;
                const r = (current - c) / cols;
                for (let d = 0; d < 4; d++) {
                  const nc = c + DC[d];
                  const nr = r + DR[d];
                  if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
                  const next = nr * cols + nc;
                  if (visited[next] || occ[next]) continue;
                  visited[next] = 1;
                  parent[next] = current;
                  queue[tail++] = next;
                }
              }
              if (found < 0) return null;

              const cells = [];
              for (let node = found; node >= 0; node = parent[node]) {
                const c = node % cols;
                const r = (node - c) / cols;
                cells.push(world(c, r));
                if (node === startIndex) break;
              }
              cells.reverse();
              return cells;
            }

            function nextWaypoint(self, goal, arena, walls, tick, force) {
              if (!occ) buildOccupancy(arena, walls);
              const goalChanged = !pathGoal ||
                Math.hypot(goal.x - pathGoal.x, goal.y - pathGoal.y) > 1.5;
              if (force || !path || goalChanged || tick - pathTick > 24) {
                path = bfsPath(self.position, goal);
                pathGoal = { x: goal.x, y: goal.y };
                pathTick = tick;
              }
              if (!path || path.length === 0) return goal;
              let index = 0;
              while (index < path.length - 1 && distance(self, path[index]) < CELL * 0.75) index++;
              return path[Math.min(path.length - 1, index + 1)];
            }

            function explore(self, arena, walls) {
              if (!occ) buildOccupancy(arena, walls);
              for (let attempt = 0; attempt < 8; attempt++) {
                const point = {
                  x: MARGIN + Math.random() * (arena.width - MARGIN * 2),
                  y: MARGIN + Math.random() * (arena.height - MARGIN * 2)
                };
                const cell = cellOf(point);
                if (!occ[cell.r * cols + cell.c] && distance(self, point) > 2.2) return point;
              }
              const free = nearestFree({
                x: arena.width - self.position.x,
                y: arena.height - self.position.y
              });
              return world(free.c, free.r);
            }

            function tick({ self, enemy, arena, tick }) {
              const walls = arena.walls || [];
              if (!occ) buildOccupancy(arena, walls);
              if (lastPos) stuckFor = distance(self, lastPos) < 0.08 ? stuckFor + 1 : 0;
              lastPos = { x: self.position.x, y: self.position.y };
              const force = stuckFor > 25;
              if (force) {
                path = null;
                stuckFor = 0;
              }

              if (enemy) {
                const angle = Math.atan2(
                  enemy.position.y - self.position.y,
                  enemy.position.x - self.position.x
                );
                const dist = distance(self, enemy.position);
                const target = dist > 2.8
                  ? enemy.position
                  : {
                      x: enemy.position.x - Math.cos(angle) * 1.5,
                      y: enemy.position.y - Math.sin(angle) * 1.5
                    };
                return {
                  driveTo: nextWaypoint(self, target, arena, walls, tick, force),
                  aimAt: enemy.position,
                  shoot: self.canShoot && facing(self, enemy.position)
                };
              }

              if (!scout || reached(self, scout, 0.9) || tick % 100 === 0 || force) {
                scout = explore(self, arena, walls);
              }
              return {
                driveTo: nextWaypoint(self, scout, arena, walls, tick, force),
                aimAt: scout
              };
            }
            """)
    ];

    public static IReadOnlyList<BehaviorPreset> All { get; } =
        Array.AsReadOnly(Catalog.Select(item => item.Info).ToArray());

    public static bool Exists(string id) => Resolve(id) is not null;

    public static string GetCode(string id)
    {
        var resolved = Resolve(id) ?? throw new KeyNotFoundException(id);
        return Catalog.Single(item => item.Info.Id == resolved).Script;
    }

    private static string? Resolve(string id)
    {
        if (Catalog.Any(item => item.Info.Id == id)) return id;
        if (Aliases.TryGetValue(id, out var mapped) && Catalog.Any(item => item.Info.Id == mapped))
            return mapped;
        return null;
    }
}
