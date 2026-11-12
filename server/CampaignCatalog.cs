namespace BotArena;

internal sealed record CampaignBotScript(string BotId, string JavaScript, string Python);

internal sealed record CampaignLevel(
    string Id,
    int Order,
    string Name,
    string Summary,
    string Hint,
    string ObjectiveLabel,
    MatchObjective Objective,
    MatchConfig Config,
    string OpponentCode,
    string StarterJavaScript,
    string StarterPython,
    ReachMarker? Marker = null,
    IReadOnlyList<CampaignBotScript>? PlayerScripts = null,
    IReadOnlyDictionary<string, string>? OpponentScripts = null)
{
    public IReadOnlyList<CampaignBotScript> ResolvedPlayerScripts =>
        PlayerScripts ?? [new("player", StarterJavaScript, StarterPython)];

    public string OpponentCodeFor(string botId) =>
        OpponentScripts is not null && OpponentScripts.TryGetValue(botId, out var code)
            ? code
            : OpponentCode;
}

internal sealed record CampaignTrack(
    string Id,
    int Order,
    string Name,
    string Summary,
    bool Available,
    IReadOnlyList<CampaignLevel> Levels);

internal static class CampaignCatalog
{
    private const string Idle = """
        function tick() {
            return {};
        }
        """;

    private const string Patrol = """
        function tick(state) {
            const upper = Math.floor(state.tick / 55) % 2 === 0;
            const waypoint = { x: 12.5, y: upper ? 3.2 : 6.8 };
            const dx = waypoint.x - state.self.position.x;
            const dy = waypoint.y - state.self.position.y;
            const error = Math.atan2(Math.sin(Math.atan2(dy, dx) - state.self.bodyAngle),
                Math.cos(Math.atan2(dy, dx) - state.self.bodyAngle));
            const turn = Math.max(-1, Math.min(1, error * 2));
            const throttle = Math.abs(error) < 0.7 ? 1 : 0;
            return { leftTrack: throttle + turn, rightTrack: throttle - turn };
        }
        """;

    private static readonly CampaignLevel[] BeginnerLevels =
    [
        new(
            "move",
            1,
            "Ход вперёд",
            "Доведите танк до маркера с помощью driveTo.",
            "В return нужен driveTo с координатами маркера (10, 5).",
            "ReachPoint",
            new ReachPointObjective(new(10, 5), 0.55),
            OpenArena(120, new("player", new(2.5, 5), 0, 0), new("opponent", new(14, 8.5), Math.PI, Math.PI)),
            Idle,
            """
            function tick({ self }) {
              const target = { x: 10, y: 5 };
              // Танк должен ехать к target.
              return { driveTo: { x: 0, y: 5 } };
            }
            """,
            """
            def tick(state):
                target = {"x": 10, "y": 5}
                # Танк должен ехать к target.
                return {"driveTo": {"x": 0, "y": 5}}
            """,
            new ReachMarker(10, 5, 0.55)),
        new(
            "steer-short",
            2,
            "Объезд короткой стены",
            "Тонкая стена. Съездите к точке обхода, затем к маркеру.",
            "Когда self.position.x станет больше 8, меняйте цель на маркер. В return используйте target.",
            "ReachPoint",
            new ReachPointObjective(new(12.5, 5), 0.6),
            MatchConfig.Classic with
            {
                MaxTicks = 180,
                Arena = new(16, 10, Array.AsReadOnly(new Wall[] { new(6.5, 3.6, 1.2, 2.8) })),
                Spawns = Array.AsReadOnly(new BotSpawn[]
                {
                    new("player", new(2.4, 5), 0, 0),
                    new("opponent", new(14.2, 8.4), Math.PI, Math.PI)
                }),
                ShrinkZoneEnabled = false,
            },
            Idle,
            """
            function tick({ self }) {
              const goal = { x: 12.5, y: 5 };
              const bypass = { x: 5, y: 2.0 };

              // Сначала обход, потом маркер.
              let target = bypass;
              if (self.position.x > 8) {
                target = goal;
              }

              // Сейчас всегда едем в bypass — исправьте на target.
              return { driveTo: bypass };
            }
            """,
            """
            def tick(state):
                self = state["self"]
                goal = {"x": 12.5, "y": 5}
                bypass = {"x": 5, "y": 2.0}

                # Сначала обход, потом маркер.
                target = bypass
                if self["position"]["x"] > 8:
                    target = goal

                # Сейчас всегда едем в bypass — исправьте на target.
                return {"driveTo": bypass}
            """,
            new ReachMarker(12.5, 5, 0.6)),
        new(
            "steer-long",
            3,
            "Объезд длинной стены",
            "Длинная стена. Мало проехать по x — нужно доехать до точки обхода.",
            "Храните шаг снаружи tick. reached(self, bypass) → шаг 2, reached(self, clear) → шаг 3, иначе танк забудет прогресс.",
            "ReachPoint",
            new ReachPointObjective(new(13, 5), 0.65),
            MatchConfig.Classic with
            {
                MaxTicks = 220,
                Arena = new(16, 10, Array.AsReadOnly(new Wall[] { new(7.0, 1.8, 1.6, 7.4) })),
                Spawns = Array.AsReadOnly(new BotSpawn[]
                {
                    new("player", new(2.4, 5), 0, 0),
                    new("opponent", new(14.2, 8.4), Math.PI, Math.PI)
                }),
                ShrinkZoneEnabled = false,
            },
            Idle,
            """
            // step живёт между тиками — так танк не забывает, куда уже доехал.
            let step = 1;

            function tick({ self }) {
              const goal = { x: 13, y: 5 };
              const bypass = { x: 5, y: 1.0 };
              const clear = { x: 10.5, y: 1.0 };

              if (step === 1 && reached(self, bypass)) {
                step = 2;
              }
              // Добавьте: если step === 2 и reached(self, clear) → step = 3.

              if (step === 1) {
                return { driveTo: bypass };
              }
              if (step === 2) {
                return { driveTo: clear };
              }
              return { driveTo: goal };
            }
            """,
            """
            # step живёт между тиками — так танк не забывает, куда уже доехал.
            step = 1

            def tick(state):
                global step
                self = state["self"]
                goal = {"x": 13, "y": 5}
                bypass = {"x": 5, "y": 1.0}
                clear = {"x": 10.5, "y": 1.0}

                if step == 1 and reached(self, bypass):
                    step = 2
                # Добавьте: если step == 2 и reached(self, clear) → step = 3.

                if step == 1:
                    return {"driveTo": bypass}
                if step == 2:
                    return {"driveTo": clear}
                return {"driveTo": goal}
            """,
            new ReachMarker(13, 5, 0.65)),
        new(
            "shoot-simple",
            4,
            "Первый выстрел",
            "Мишень на виду. Башня уже целится через aimAt — включите выстрел.",
            "Поменяйте shoot: false на shoot: true.",
            "DestroyEnemy",
            new DestroyEnemyObjective(),
            OpenArena(160, new("player", new(3, 5), 0, 0), new("opponent", new(12.5, 5), Math.PI, Math.PI)),
            Idle,
            """
            function tick({ self, enemy }) {
              if (!enemy) {
                return {};
              }

              // Башня целится. Включите выстрел.
              return {
                aimAt: enemy.position,
                shoot: false
              };
            }
            """,
            """
            def tick(state):
                enemy = state["enemy"]
                if enemy is None:
                    return {}

                # Башня целится. Включите выстрел.
                return {
                    "aimAt": enemy["position"],
                    "shoot": False,
                }
            """),
        new(
            "shoot-cover",
            5,
            "Выстрел из‑за укрытия",
            "Противник за стеной. Объезд уже написан — осталось навестись и выстрелить, когда враг виден.",
            "Когда enemy не null, добавьте aimAt и shoot: self.canShoot && facing(self, enemy.position).",
            "DestroyEnemy",
            new DestroyEnemyObjective(),
            MatchConfig.Classic with
            {
                MaxTicks = 220,
                Arena = new(16, 10, Array.AsReadOnly(new Wall[] { new(7.1, 3.2, 1.6, 3.6) })),
                Spawns = Array.AsReadOnly(new BotSpawn[]
                {
                    new("player", new(2.5, 5), 0, 0),
                    new("opponent", new(13.2, 5), Math.PI, Math.PI)
                }),
                ShrinkZoneEnabled = false,
            },
            Idle,
            """
            // Сначала вниз от стены, потом в точку обзора — иначе enemy так и останется null.
            let step = 1;

            function tick({ self, enemy }) {
              const south = { x: 5, y: 2.0 };
              const peek = { x: 10.5, y: 2.2 };

              if (step === 1 && reached(self, south)) {
                step = 2;
              }

              // Пока враг скрыт стеной, enemy равен null — едем в обход.
              if (!enemy) {
                if (step === 1) {
                  return { driveTo: south };
                }
                return { driveTo: peek };
              }

              // Враг виден. Подъезд есть — добавьте прицел и выстрел.
              return {
                // aimAt: ...
                // shoot: ...
              };
            }
            """,
            """
            # Сначала вниз от стены, потом в точку обзора — иначе enemy так и останется None.
            step = 1

            def tick(state):
                global step
                self = state["self"]
                enemy = state["enemy"]
                south = {"x": 5, "y": 2.0}
                peek = {"x": 10.5, "y": 2.2}

                if step == 1 and reached(self, south):
                    step = 2

                # Пока враг скрыт стеной, enemy равен None — едем в обход.
                if enemy is None:
                    if step == 1:
                        return {"driveTo": south}
                    return {"driveTo": peek}

                # Враг виден. Подъезд есть — добавьте прицел и выстрел.
                return {
                    # "aimAt": ...
                    # "shoot": ...
                }
            """),
        new(
            "track",
            6,
            "Сопровождение",
            "Мишень движется. Ведите башню через aimAt и стреляйте, когда facing.",
            "aimAt должен следить за enemy.position, а shoot — только при facing и canShoot.",
            "DestroyEnemy",
            new DestroyEnemyObjective(),
            OpenArena(200, new("player", new(3.2, 5), 0, 0), new("opponent", new(12.5, 5), Math.PI, Math.PI)),
            Patrol,
            """
            function tick({ self, enemy }) {
              if (!enemy) {
                return {};
              }

              // Цель бегает. Сейчас прицел смотрит в одну точку — исправьте.
              return {
                aimAt: { x: 12.5, y: 5 },
                shoot: self.canShoot && facing(self, enemy.position)
              };
            }
            """,
            """
            def tick(state):
                self = state["self"]
                enemy = state["enemy"]
                if enemy is None:
                    return {}

                # Цель бегает. Сейчас прицел смотрит в одну точку — исправьте.
                return {
                    "aimAt": {"x": 12.5, "y": 5},
                    "shoot": self["canShoot"] and facing(self, enemy["position"]),
                }
            """),
        new(
            "duel",
            7,
            "Первая дуэль",
            "Соберите хелперы вместе против активного соперника.",
            "Если враг скрыт, едьте к bypass. Если виден — цельтесь и стреляйте.",
            "DestroyEnemy",
            new DestroyEnemyObjective(),
            MatchConfig.Classic with { ShrinkZoneEnabled = false },
            BehaviorPresets.GetCode("trench"),
            """
            function tick({ self, enemy }) {
              let bypass = { x: 12, y: 3.5 };
              if (self.position.y > 3.65) {
                bypass = { x: 4.1, y: 3.45 };
              }

              if (!enemy) {
                return { driveTo: bypass };
              }

              // Враг виден. Добавьте aimAt и shoot.
              return {
                driveTo: enemy.position
              };
            }
            """,
            """
            def tick(state):
                self = state["self"]
                enemy = state["enemy"]

                bypass = {"x": 12, "y": 3.5}
                if self["position"]["y"] > 3.65:
                    bypass = {"x": 4.1, "y": 3.45}

                if enemy is None:
                    return {"driveTo": bypass}

                # Враг виден. Добавьте aimAt и shoot.
                return {
                    "driveTo": enemy["position"],
                }
            """)
    ];

    private static readonly CampaignLevel[] AdvancedLevels =
    [
        Advanced("move", 1, "Ход вперёд",
            "Доведите танк до маркера. Гусеницы задают тягу от −1 до 1.",
            "Одинаковая тяга leftTrack и rightTrack двигает корпус вперёд без поворота.",
            BeginnerLevels[0],
            """
            function tick({ self }) {
              // Цель: оказаться около точки (10, 5).
              return {
                leftTrack: 0,
                rightTrack: 0
              };
            }
            """,
            """
            def tick(state):
                # Цель: оказаться около точки (10, 5).
                return {
                    "leftTrack": 0,
                    "rightTrack": 0,
                }
            """),
        Advanced("steer-short", 2, "Объезд короткой стены",
            "Тонкая стена. Разная тяга гусениц поворачивает корпус к точке обхода.",
            "Ошибка курса = atan2(dy, dx) − bodyAngle. После x > 8 целитесь на маркер.",
            BeginnerLevels[1],
            """
            function tick({ self }) {
              const goal = { x: 12.5, y: 5 };
              const bypass = { x: 5, y: 2.0 };
              const target = self.position.x > 8 ? goal : bypass;
              const dx = target.x - self.position.x;
              const dy = target.y - self.position.y;
              // Добавьте расчёт поворота через leftTrack / rightTrack.
              return {
                leftTrack: 1,
                rightTrack: 1
              };
            }
            """,
            """
            def tick(state):
                self = state["self"]
                goal = {"x": 12.5, "y": 5}
                bypass = {"x": 5, "y": 2.0}
                target = goal if self["position"]["x"] > 8 else bypass
                dx = target["x"] - self["position"]["x"]
                dy = target["y"] - self["position"]["y"]
                # Добавьте расчёт поворота через leftTrack / rightTrack.
                return {
                    "leftTrack": 1,
                    "rightTrack": 1,
                }
            """),
        Advanced("steer-long", 3, "Объезд длинной стены",
            "Длинная стена. Нужен надёжный критерий «доехали до обхода».",
            "Считайте курс вручную. Для смены точки используйте расстояние до bypass, а не ==.",
            BeginnerLevels[2],
            """
            function tick({ self }) {
              const goal = { x: 13, y: 5 };
              const bypass = { x: 5, y: 1.0 };
              const clear = { x: 10.5, y: 1.0 };
              const target = self.position.x > 8 ? goal : bypass;
              const dx = target.x - self.position.x;
              const dy = target.y - self.position.y;
              // Добавьте поворот гусеницами. Условие смены цели пока слишком грубое.
              return {
                leftTrack: 1,
                rightTrack: 1
              };
            }
            """,
            """
            def tick(state):
                self = state["self"]
                goal = {"x": 13, "y": 5}
                bypass = {"x": 5, "y": 1.0}
                clear = {"x": 10.5, "y": 1.0}
                target = goal if self["position"]["x"] > 8 else bypass
                dx = target["x"] - self["position"]["x"]
                dy = target["y"] - self["position"]["y"]
                # Добавьте поворот гусеницами. Условие смены цели пока слишком грубое.
                return {
                    "leftTrack": 1,
                    "rightTrack": 1,
                }
            """),
        Advanced("shoot-simple", 4, "Первый выстрел",
            "Мишень на виду. Посчитайте aimDirection и включите shoot.",
            "Поменяйте shoot: false на shoot: true.",
            BeginnerLevels[3],
            """
            function tick({ self, enemy }) {
              if (!enemy) return {};
              const aim = {
                x: enemy.position.x - self.position.x,
                y: enemy.position.y - self.position.y
              };
              // Башня целится. Включите выстрел.
              return {
                aimDirection: aim,
                shoot: false
              };
            }
            """,
            """
            def tick(state):
                enemy = state["enemy"]
                if enemy is None:
                    return {}
                self = state["self"]
                aim = {
                    "x": enemy["position"]["x"] - self["position"]["x"],
                    "y": enemy["position"]["y"] - self["position"]["y"],
                }
                # Башня целится. Включите выстрел.
                return {
                    "aimDirection": aim,
                    "shoot": False,
                }
            """),
        Advanced("shoot-cover", 5, "Выстрел из‑за укрытия",
            "Противник за стеной. Объезд напишите гусеницами; когда враг виден — aimDirection и shoot.",
            "Сначала едьте к south, потом к peek. Когда enemy не null — добавьте прицел и выстрел.",
            BeginnerLevels[4],
            """
            let step = 1;

            function tick({ self, enemy }) {
              const south = { x: 5, y: 2.0 };
              const peek = { x: 10.5, y: 2.2 };
              if (step === 1 && Math.hypot(self.position.x - south.x, self.position.y - south.y) < 0.7) {
                step = 2;
              }

              const target = enemy
                ? enemy.position
                : (step === 1 ? south : peek);
              const dx = target.x - self.position.x;
              const dy = target.y - self.position.y;
              const heading = Math.atan2(dy, dx);
              const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
              const turn = Math.max(-1, Math.min(1, wrap(heading - self.bodyAngle) * 2));
              const drive = Math.abs(wrap(heading - self.bodyAngle)) < 0.55 ? 1 : 0;

              // Подъезд уже есть. Когда враг виден — добавьте aimDirection и shoot.
              return {
                leftTrack: drive + turn,
                rightTrack: drive - turn
              };
            }
            """,
            """
            step = 1

            def tick(state):
                import math
                global step
                self = state["self"]
                enemy = state["enemy"]
                south = {"x": 5, "y": 2.0}
                peek = {"x": 10.5, "y": 2.2}
                if step == 1 and math.hypot(self["position"]["x"] - south["x"], self["position"]["y"] - south["y"]) < 0.7:
                    step = 2

                target = enemy["position"] if enemy is not None else (south if step == 1 else peek)
                dx = target["x"] - self["position"]["x"]
                dy = target["y"] - self["position"]["y"]
                heading = math.atan2(dy, dx)

                def wrap(angle):
                    return math.atan2(math.sin(angle), math.cos(angle))

                turn = max(-1, min(1, wrap(heading - self["bodyAngle"]) * 2))
                drive = 1 if abs(wrap(heading - self["bodyAngle"])) < 0.55 else 0

                # Подъезд уже есть. Когда враг виден — добавьте aimDirection и shoot.
                return {
                    "leftTrack": drive + turn,
                    "rightTrack": drive - turn,
                }
            """),
        Advanced("track", 6, "Сопровождение",
            "Мишень патрулирует по вертикали. Ведите башню вручную через aimDirection.",
            "Каждый тик заново считайте вектор на enemy.position и угол башни.",
            BeginnerLevels[5],
            """
            function tick({ self, enemy }) {
              if (!enemy) return {};
              const aim = {
                x: enemy.position.x - self.position.x,
                y: enemy.position.y - self.position.y
              };
              const error = Math.atan2(aim.y, aim.x) - self.turretAngle;
              const aligned = Math.abs(Math.atan2(Math.sin(error), Math.cos(error))) < 0.06;
              return {
                aimDirection: aim,
                shoot: self.canShoot && aligned
              };
            }
            """,
            """
            def tick(state):
                import math
                enemy = state["enemy"]
                if enemy is None:
                    return {}
                self = state["self"]
                aim = {
                    "x": enemy["position"]["x"] - self["position"]["x"],
                    "y": enemy["position"]["y"] - self["position"]["y"],
                }
                error = math.atan2(aim["y"], aim["x"]) - self["turretAngle"]
                aligned = abs(math.atan2(math.sin(error), math.cos(error))) < 0.06
                return {
                    "aimDirection": aim,
                    "shoot": self["canShoot"] and aligned,
                }
            """),
        Advanced("duel", 7, "Первая дуэль",
            "Полный бой на низкоуровневых командах против активного соперника.",
            "Считайте курс корпуса и башни сами через leftTrack/rightTrack и aimDirection.",
            BeginnerLevels[6],
            """
            function tick({ self, enemy }) {
              const { x, y } = self.position;
              const waypoint = enemy?.position ??
                (y > 3.65 ? { x: 4.1, y: 3.45 } : { x: 12, y: 3.5 });
              const dx = waypoint.x - x;
              const dy = waypoint.y - y;
              const heading = Math.atan2(dy, dx);
              const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
              const error = wrap(heading - self.bodyAngle);
              const turn = Math.max(-1, Math.min(1, error * 2));
              const far = !enemy || Math.hypot(dx, dy) > 5;
              const drive = far && Math.abs(error) < 0.55 ? 1 : 0;
              return {
                leftTrack: drive + turn,
                rightTrack: drive - turn,
                aimDirection: { x: dx, y: dy },
                shoot: !!enemy && self.canShoot &&
                  Math.abs(wrap(heading - self.turretAngle)) < 0.045
              };
            }
            """,
            """
            def tick(state):
                import math
                self = state["self"]
                enemy = state["enemy"]
                x = self["position"]["x"]
                y = self["position"]["y"]
                if enemy is not None:
                    waypoint = enemy["position"]
                elif y > 3.65:
                    waypoint = {"x": 4.1, "y": 3.45}
                else:
                    waypoint = {"x": 12, "y": 3.5}
                dx = waypoint["x"] - x
                dy = waypoint["y"] - y
                heading = math.atan2(dy, dx)

                def wrap(angle):
                    return math.atan2(math.sin(angle), math.cos(angle))

                error = wrap(heading - self["bodyAngle"])
                turn = max(-1, min(1, error * 2))
                far = enemy is None or math.hypot(dx, dy) > 5
                drive = 1 if far and abs(error) < 0.55 else 0
                return {
                    "leftTrack": drive + turn,
                    "rightTrack": drive - turn,
                    "aimDirection": {"x": dx, "y": dy},
                    "shoot": bool(enemy) and self["canShoot"] and abs(wrap(heading - self["turretAngle"])) < 0.045,
                }
            """)
    ];

    private static readonly BotSpawn[] PlayerTeam3 =
    [
        new("player-1", new(2.2, 2.4), 0, 0, "player"),
        new("player-2", new(2.2, 5.0), 0, 0, "player"),
        new("player-3", new(2.2, 7.6), 0, 0, "player")
    ];

    private static readonly BotSpawn[] PlayerTeam2 =
    [
        new("player-1", new(2.2, 3.2), 0, 0, "player"),
        new("player-2", new(2.2, 6.8), 0, 0, "player")
    ];

    private static readonly BotSpawn[] OpponentTeam3 =
    [
        new("opponent-1", new(13.8, 2.4), Math.PI, Math.PI, "opponent"),
        new("opponent-2", new(13.8, 5.0), Math.PI, Math.PI, "opponent"),
        new("opponent-3", new(13.8, 7.6), Math.PI, Math.PI, "opponent")
    ];

    private static readonly CampaignBotScript[] PlayerTeam3Scripts =
    [
        new("player-1", ModeTeamLaneJs("player-1", 2.4), ModeTeamLanePy("player-1", 2.4)),
        new("player-2", ModeTeamLaneJs("player-2", 5.0), ModeTeamLanePy("player-2", 5.0)),
        new("player-3", ModeTeamLaneJs("player-3", 7.6), ModeTeamLanePy("player-3", 7.6))
    ];

    private static readonly CampaignBotScript[] PlayerTeam2Scripts =
    [
        new("player-1", ModeCoverHoldJs("player-1", 2.2), ModeCoverHoldPy("player-1", 2.2)),
        new("player-2", ModeCoverHoldJs("player-2", 7.8), ModeCoverHoldPy("player-2", 7.8))
    ];

    // Активные противники: ездят и стреляют заметно, но целятся с промахом — демо всегда выигрывает игрок.
    private const string ModeSkirmisher = """
        function tick({ self, enemy }) {
          if (!enemy) {
            return { driveTo: { x: 9.5, y: self.position.y } };
          }
          const dist = distance(self, enemy.position);
          const side = self.position.y < 5 ? 1.6 : -1.6;
          const miss = { x: enemy.position.x, y: enemy.position.y + side };
          const approach = {
            x: self.position.x + (enemy.position.x - self.position.x) * 0.4,
            y: enemy.position.y + side * 0.5
          };
          return {
            driveTo: dist > 4.5 ? approach : {
              x: self.position.x,
              y: self.position.y + side * 0.2
            },
            aimAt: miss,
            shoot: self.canShoot && facing(self, miss, 0.08)
          };
        }
        """;

    private const string ModeRusher = """
        function tick({ self, enemy }) {
          // Рвутся к игроку мимо укрытий и палят мимо — зрелищно, но безопасно для демо.
          if (!enemy) {
            return { driveTo: { x: 3.2, y: self.position.y } };
          }
          const side = self.position.y < 5 ? 1.7 : -1.7;
          const miss = { x: enemy.position.x, y: enemy.position.y + side };
          return {
            driveTo: {
              x: enemy.position.x - 1.2,
              y: enemy.position.y + side * 0.45
            },
            aimAt: miss,
            shoot: self.canShoot && facing(self, miss, 0.08)
          };
        }
        """;

    private static readonly IReadOnlyDictionary<string, string> OpponentTeam3Scripts =
        new Dictionary<string, string>
        {
            ["opponent-1"] = ModeSkirmisher,
            ["opponent-2"] = ModeSkirmisher,
            ["opponent-3"] = ModeSkirmisher
        };

    private static readonly IReadOnlyDictionary<string, string> OutnumberedOpponentScripts =
        new Dictionary<string, string>
        {
            ["opponent-1"] = ModeRusher,
            ["opponent-2"] = ModeRusher,
            ["opponent-3"] = ModeRusher
        };

    private static readonly MatchConfig FfaArena = MatchConfig.Classic with
    {
        MaxTicks = 300,
        Arena = new(16, 10, []),
        Spawns = Array.AsReadOnly(new BotSpawn[]
        {
            new("player", new(2.2, 5), 0, 0, "player"),
            new("rival-a", new(13.8, 5), Math.PI, Math.PI, "rival-a"),
            new("rival-b", new(8, 2.2), Math.PI / 2, Math.PI / 2, "rival-b"),
            new("rival-c", new(8, 7.8), -Math.PI / 2, -Math.PI / 2, "rival-c")
        })
    };

    private static readonly MatchConfig OutnumberedArena = MatchConfig.Classic with
    {
        MaxTicks = 320,
        Arena = new(16, 10, Array.AsReadOnly(new Wall[]
        {
            // Укрытие между союзниками: peek сверху/снизу, центр поля открыт для огня.
            new(4.2, 3.7, 1.6, 2.6)
        })),
        Spawns = Array.AsReadOnly(new BotSpawn[]
        {
            new("player-1", new(2.2, 2.2), 0, 0, "player"),
            new("player-2", new(2.2, 7.8), 0, 0, "player"),
            new("opponent-1", new(13.8, 2.2), Math.PI, Math.PI, "opponent"),
            new("opponent-2", new(13.8, 5.0), Math.PI, Math.PI, "opponent"),
            new("opponent-3", new(13.8, 7.8), Math.PI, Math.PI, "opponent")
        })
    };

    private static readonly IReadOnlyDictionary<string, string> FfaOpponentScripts =
        new Dictionary<string, string>
        {
            ["rival-a"] = ModeSkirmisher,
            ["rival-b"] = ModeSkirmisher,
            ["rival-c"] = ModeSkirmisher
        };

    private const string ModeDuelJs = """
        // Демо 1×1: сближаемся и бьём точнее противника.
        function tick({ self, enemy }) {
          if (!enemy) {
            return { driveTo: { x: 10, y: 5 } };
          }
          const dist = distance(self, enemy.position);
          return {
            driveTo: dist > 3.2 ? enemy.position : {
              x: enemy.position.x - 2.4,
              y: enemy.position.y
            },
            aimAt: enemy.position,
            shoot: self.canShoot && facing(self, enemy.position)
          };
        }
        """;

    private const string ModeDuelPy = """
        # Демо 1×1: сближаемся и бьём точнее противника.
        def tick(state):
            self = state["self"]
            enemy = state["enemy"]
            if enemy is None:
                return {"driveTo": {"x": 10, "y": 5}}
            dist = distance(self, enemy["position"])
            return {
                "driveTo": enemy["position"] if dist > 3.2 else {
                    "x": enemy["position"]["x"] - 2.4,
                    "y": enemy["position"]["y"],
                },
                "aimAt": enemy["position"],
                "shoot": self["canShoot"] and facing(self, enemy["position"]),
            }
        """;

    private static readonly string ModeCaptureJs = BehaviorPresets.GetCode("base-captor");

    private const string ModeCapturePy = """
        # Универсальный захватчик базы: рейд / удержание / защита / дуэль / отход.
        import math

        last_enemy = None
        last_enemy_tick = -999
        hold_phase = 0.0
        mode = "raid"
        last_pos = None
        stuck_for = 0

        def zone_center(zone):
            return {
                "x": zone["x"] + zone["width"] * 0.5,
                "y": zone["y"] + zone["height"] * 0.5,
            }

        def inside_zone(point, zone):
            return (
                zone["x"] <= point["x"] <= zone["x"] + zone["width"]
                and zone["y"] <= point["y"] <= zone["y"] + zone["height"]
            )

        def clamp_point(point, arena):
            return {
                "x": min(arena["width"] - 0.5, max(0.5, point["x"])),
                "y": min(arena["height"] - 0.5, max(0.5, point["y"])),
            }

        def approach(self, zone, arena):
            center = zone_center(zone)
            if distance(self, center) < max(zone["width"], zone["height"]) * 0.85:
                return center
            if abs(self["position"]["x"] - center["x"]) > 3.2 and abs(self["position"]["y"] - arena["height"] * 0.5) > 1.1:
                return clamp_point(
                    {
                        "x": (self["position"]["x"] + center["x"]) * 0.5,
                        "y": arena["height"] * 0.5,
                    },
                    arena,
                )
            return center

        def orbit(zone, tick):
            center = zone_center(zone)
            radius = max(0.28, min(zone["width"], zone["height"]) * 0.22)
            angle = hold_phase + tick * 0.13
            return {
                "x": center["x"] + math.cos(angle) * radius,
                "y": center["y"] + math.sin(angle) * radius,
            }

        def tick(state):
            global last_enemy, last_enemy_tick, hold_phase, mode, last_pos, stuck_for
            self = state["self"]
            enemy = state["enemy"]
            arena = state["arena"]
            tick_n = state["tick"]
            zones = state.get("captureZones") or []
            own = next((z for z in zones if z["ownerTeamId"] == self["teamId"]), None)
            enemy_zone = next((z for z in zones if z["ownerTeamId"] != self["teamId"]), None)

            if last_pos is not None:
                stuck_for = stuck_for + 1 if distance(self, last_pos) < 0.07 else 0
            last_pos = {"x": self["position"]["x"], "y": self["position"]["y"]}
            force = stuck_for > 16
            if force:
                stuck_for = 0
                hold_phase += math.pi * 0.85

            if enemy is not None:
                last_enemy = {
                    "x": enemy["position"]["x"],
                    "y": enemy["position"]["y"],
                    "hp": enemy["hp"],
                }
                last_enemy_tick = tick_n

            enemy_on_our_base = bool(
                own is not None
                and (
                    (own.get("progress") or 0) > 0.05
                    or own.get("contested")
                    or (own.get("capturingTeamId") not in (None, self["teamId"]))
                    or (enemy is not None and inside_zone(enemy["position"], own))
                )
            )
            we_capturing = enemy_zone is not None and inside_zone(self["position"], enemy_zone)
            capture_progress = (enemy_zone.get("progress") or 0) if enemy_zone else 0
            hp_ratio = self["hp"] / max(1, self["maxHp"])
            enemy_close = enemy is not None and distance(self, enemy["position"]) < 2.05
            enemy_weak = enemy is not None and enemy["hp"] <= self["hp"] * 0.55
            enemy_guarding = bool(
                enemy_zone is not None and enemy is not None and inside_zone(enemy["position"], enemy_zone)
            )
            near_enemy_base = bool(
                enemy_zone is not None and distance(self, zone_center(enemy_zone)) < 4.5
            )

            contested = bool(enemy_zone and enemy_zone.get("contested"))

            if enemy_on_our_base and (not we_capturing or capture_progress < 0.6):
                mode = "defend"
            elif we_capturing and (enemy_guarding or contested):
                mode = "clear"
            elif we_capturing or capture_progress >= 0.12:
                mode = "hold"
            elif near_enemy_base and enemy_guarding:
                mode = "breach"
            elif enemy_zone is None and enemy_close and (enemy_weak or hp_ratio > 0.55):
                mode = "duel"
            elif (
                enemy_zone is None
                and hp_ratio < 0.28
                and enemy is not None
                and distance(self, enemy["position"]) < 3.0
            ):
                mode = "recover"
            else:
                mode = "raid"

            if mode == "defend" and own is not None:
                if enemy is not None and inside_zone(enemy["position"], own):
                    drive = {
                        "x": (enemy["position"]["x"] + zone_center(own)["x"]) * 0.5,
                        "y": (enemy["position"]["y"] + zone_center(own)["y"]) * 0.5,
                    }
                else:
                    drive = zone_center(own)
            elif mode == "recover" and own is not None:
                center = zone_center(own)
                drive = {
                    "x": center["x"] * 0.55 + self["position"]["x"] * 0.45,
                    "y": arena["height"] * 0.5,
                }
            elif mode in ("clear", "breach") and enemy_zone is not None:
                center = zone_center(enemy_zone)
                if mode == "breach" and not inside_zone(self["position"], enemy_zone):
                    drive = center
                elif enemy is not None:
                    push = {
                        "x": enemy["position"]["x"] * 0.65 + center["x"] * 0.35,
                        "y": enemy["position"]["y"] * 0.65 + center["y"] * 0.35,
                    }
                    drive = push if inside_zone(push, enemy_zone) else center
                else:
                    drive = center
            elif mode == "duel" and enemy is not None:
                dist = distance(self, enemy["position"])
                angle = math.atan2(
                    enemy["position"]["y"] - self["position"]["y"],
                    enemy["position"]["x"] - self["position"]["x"],
                )
                side = 1 if math.sin(tick_n * 0.2) >= 0 else -1
                if dist > 2.6:
                    drive = enemy["position"]
                else:
                    drive = clamp_point(
                        {
                            "x": enemy["position"]["x"] - math.cos(angle) * 1.55 + math.cos(angle + math.pi / 2) * 1.15 * side,
                            "y": enemy["position"]["y"] - math.sin(angle) * 1.55 + math.sin(angle + math.pi / 2) * 1.15 * side,
                        },
                        arena,
                    )
            elif mode == "hold" and enemy_zone is not None:
                if inside_zone(self["position"], enemy_zone):
                    drive = orbit(enemy_zone, tick_n)
                else:
                    drive = zone_center(enemy_zone)
            elif enemy_zone is not None:
                drive = approach(self, enemy_zone, arena)
            elif last_enemy is not None and tick_n - last_enemy_tick < 50:
                drive = {"x": last_enemy["x"], "y": last_enemy["y"]}
            else:
                drive = {"x": arena["width"] * 0.72, "y": arena["height"] * 0.5}

            if force:
                drive = clamp_point(
                    {
                        "x": drive["x"] + math.cos(hold_phase) * 1.8,
                        "y": arena["height"] * 0.5 + math.sin(hold_phase) * 1.2,
                    },
                    arena,
                )

            enemy_in_fight = bool(
                enemy is not None
                and (
                    mode in ("clear", "defend", "duel", "breach")
                    or (mode == "hold" and enemy_zone is not None and inside_zone(enemy["position"], enemy_zone))
                    or (mode == "raid" and distance(self, enemy["position"]) < 1.9)
                    or (mode == "recover" and distance(self, enemy["position"]) < 2.8)
                )
            )
            if enemy_in_fight:
                aim = enemy["position"]
                shoot = self["canShoot"] and facing(
                    self, enemy["position"], 0.12 if mode in ("raid", "hold") else 0.08
                )
            elif last_enemy is not None and tick_n - last_enemy_tick < 50:
                aim = {"x": last_enemy["x"], "y": last_enemy["y"]}
                shoot = False
            else:
                aim = drive
                shoot = False

            return {"driveTo": drive, "aimAt": aim, "shoot": shoot}
        """;

    private const string ModeFfaJs = """
        // FFA: берём ближайшую цель и не даём ей отойти.
        function tick({ self, enemy }) {
          if (!enemy) {
            return { driveTo: { x: 8, y: 5 } };
          }
          return {
            driveTo: enemy.position,
            aimAt: enemy.position,
            shoot: self.canShoot && facing(self, enemy.position)
          };
        }
        """;

    private const string ModeFfaPy = """
        # FFA: берём ближайшую цель и не даём ей отойти.
        def tick(state):
            self = state["self"]
            enemy = state["enemy"]
            if enemy is None:
                return {"driveTo": {"x": 8, "y": 5}}
            return {
                "driveTo": enemy["position"],
                "aimAt": enemy["position"],
                "shoot": self["canShoot"] and facing(self, enemy["position"]),
            }
        """;

    private static string ModeTeamLaneJs(string botId, double laneY) => $$"""
        // Командный режим ({{botId}}): полоса + точный огонь.
        function tick({ self, enemy }) {
          const lane = { x: 7.5, y: {{laneY.ToString(System.Globalization.CultureInfo.InvariantCulture)}} };
          if (!enemy) {
            return { driveTo: lane };
          }
          const dist = distance(self, enemy.position);
          return {
            driveTo: dist > 3.5
              ? { x: enemy.position.x - 2.2, y: lane.y }
              : { x: self.position.x, y: lane.y },
            aimAt: enemy.position,
            shoot: self.canShoot && facing(self, enemy.position)
          };
        }
        """;

    private static string ModeTeamLanePy(string botId, double laneY) => $$"""
        # Командный режим ({{botId}}): полоса + точный огонь.
        def tick(state):
            self = state["self"]
            enemy = state["enemy"]
            lane = {"x": 7.5, "y": {{laneY.ToString(System.Globalization.CultureInfo.InvariantCulture)}}}
            if enemy is None:
                return {"driveTo": lane}
            dist = distance(self, enemy["position"])
            return {
                "driveTo": {"x": enemy["position"]["x"] - 2.2, "y": lane["y"]} if dist > 3.5 else {
                    "x": self["position"]["x"],
                    "y": lane["y"],
                },
                "aimAt": enemy["position"],
                "shoot": self["canShoot"] and facing(self, enemy["position"]),
            }
        """;

    private static string ModeCoverHoldJs(string botId, double peekY) => """
        // Меньшинство (__BOT__): peek у укрытия, затем дожимаем всех видимых.
        let ready = false;
        function tick({ self, enemy }) {
          const peek = { x: 6.2, y: __Y__ };
          if (!ready && reached(self, peek, 0.7)) ready = true;
          if (!ready) {
            return {
              driveTo: peek,
              aimAt: enemy ? enemy.position : peek,
              shoot: !!enemy && self.canShoot && facing(self, enemy.position)
            };
          }
          if (!enemy) {
            return { driveTo: { x: 11, y: 5 } };
          }
          return {
            driveTo: distance(self, enemy.position) > 3.8 ? enemy.position : peek,
            aimAt: enemy.position,
            shoot: self.canShoot && facing(self, enemy.position)
          };
        }
        """
        .Replace("__BOT__", botId, StringComparison.Ordinal)
        .Replace("__Y__", peekY.ToString(System.Globalization.CultureInfo.InvariantCulture), StringComparison.Ordinal);

    private static string ModeCoverHoldPy(string botId, double peekY) => """
        # Меньшинство (__BOT__): peek у стены, затем обходим блок и дожимаем.
        ready = False
        def tick(state):
            global ready
            self = state["self"]
            enemy = state["enemy"]
            peek = {"x": 6.2, "y": __Y__}
            hunt = {"x": 11, "y": 5}
            if not ready and reached(self, peek, 0.7):
                ready = True
            if not ready:
                return {
                    "driveTo": peek,
                    "aimAt": enemy["position"] if enemy is not None else peek,
                    "shoot": bool(enemy) and self["canShoot"] and facing(self, enemy["position"]),
                }
            if enemy is None:
                return {"driveTo": hunt}
            return {
                "driveTo": enemy["position"],
                "aimAt": enemy["position"],
                "shoot": self["canShoot"] and facing(self, enemy["position"]),
            }
        """
        .Replace("__BOT__", botId, StringComparison.Ordinal)
        .Replace("__Y__", peekY.ToString(System.Globalization.CultureInfo.InvariantCulture), StringComparison.Ordinal);

    private const string ModeCaptureGuard = """
        // Патруль у своей половины вне зоны: стреляет мимо, чтобы захватчик успел удержать базу.
        let patrol = null;
        function tick({ self, enemy, tick }) {
          if (!patrol || reached(self, patrol, 0.8) || tick % 80 === 0) {
            patrol = {
              x: 9.6,
              y: tick % 160 < 80 ? 2.4 : 7.6
            };
          }
          const aim = enemy
            ? { x: enemy.position.x, y: enemy.position.y + (self.position.y < 5 ? 2.4 : -2.4) }
            : patrol;
          return {
            driveTo: patrol,
            aimAt: aim,
            shoot: !!enemy && self.canShoot && facing(self, aim, 0.12) && tick % 3 === 0
          };
        }
        """;

    private static readonly MatchConfig CaptureArena = MatchConfig.Classic with
    {
        MaxTicks = 700,
        Arena = new(16, 10, []),
        Spawns = Array.AsReadOnly(new BotSpawn[]
        {
            new("player", new(2.2, 5), 0, 0, "player"),
            new("opponent", new(9.6, 7.6), Math.PI, Math.PI, "opponent"),
        }),
        ShrinkZoneEnabled = false,
    };

    private static readonly CampaignLevel[] ModesLevels =
    [
        new(
            "mode-duel",
            1,
            "Дуэль 1×1",
            "Классическая дуэль: противник тоже ездит и стреляет — ваш код целится точнее.",
            "Код уже готов — просто запустите матч и посмотрите дуэль.",
            "DestroyEnemy",
            new DestroyEnemyObjective(),
            OpenArena(220,
                new("player", new(2.5, 5), 0, 0, "player"),
                new("opponent", new(13.5, 5), Math.PI, Math.PI, "opponent")),
            ModeSkirmisher,
            ModeDuelJs,
            ModeDuelPy),
        new(
            "mode-team-3v3",
            2,
            "Команда 3×3",
            "Три ваших танка против трёх активных противников. У каждого своя вкладка.",
            "Переключайте вкладки танков, затем запустите матч. Править код не нужно.",
            "DestroyEnemy",
            new DestroyEnemyObjective(),
            TeamArena(260, PlayerTeam3, OpponentTeam3),
            ModeSkirmisher,
            ModeTeamLaneJs("player-2", 5),
            ModeTeamLanePy("player-2", 5),
            PlayerScripts: PlayerTeam3Scripts,
            OpponentScripts: OpponentTeam3Scripts),
        new(
            "mode-ffa",
            3,
            "Каждый сам за себя",
            "Свободная схватка: соперники катаются и стреляют друг в друга. Вы управляете одним танком.",
            "Запустите матч — ваш танк уже настроен на поиск ближайшей цели.",
            "DestroyEnemy",
            new DestroyEnemyObjective(),
            FfaArena,
            ModeSkirmisher,
            ModeFfaJs,
            ModeFfaPy,
            OpponentScripts: FfaOpponentScripts),
        new(
            "mode-outnumbered",
            4,
            "Меньшинство 2×3",
            "Двое против трёх: держите укрытие слева, пока враги лезут в открытую.",
            "Две вкладки — два peek у стены. Запустите матч без правок.",
            "DestroyEnemy",
            new DestroyEnemyObjective(),
            OutnumberedArena,
            ModeRusher,
            ModeCoverHoldJs("player-1", 2.2),
            ModeCoverHoldPy("player-1", 2.2),
            PlayerScripts: PlayerTeam2Scripts,
            OpponentScripts: OutnumberedOpponentScripts),
        new(
            "mode-capture-point",
            5,
            "Захват точки",
            "У каждой команды база. Сложный захватчик сам выбирает рейд, удержание, защиту и дуэль.",
            "Стартовый код — пресет «Захватчик базы». Запустите матч и смотрите захват.",
            "CapturePoint",
            CapturePointSetup.CreateObjective(CapturePointSetup.DefaultBases),
            CaptureArena,
            ModeCaptureGuard,
            ModeCaptureJs,
            ModeCapturePy)
    ];

    private static readonly CampaignTrack[] Tracks =
    [
        new("controls-beginner", 1, "Управление танком (beginner)",
            "Обучение на хелперах driveTo, aimAt и facing — без ручной математики углов.",
            true, Array.AsReadOnly(BeginnerLevels)),
        new("controls-advanced", 2, "Управление танком (advanced)",
            "Тот же путь, но через leftTrack, rightTrack и aimDirection.",
            true, Array.AsReadOnly(AdvancedLevels)),
        new("modes", 3, "Режимы",
            "Знакомство с режимами боя: 1×1, команды, FFA, меньшинство и захват точки.",
            true, Array.AsReadOnly(ModesLevels))
    ];

    public static IReadOnlyList<CampaignTrack> TracksList { get; } = Array.AsReadOnly(Tracks);

    public static IReadOnlyList<CampaignLevel> All { get; } =
        Array.AsReadOnly(Tracks.SelectMany(track => track.Levels).ToArray());

    public static CampaignLevel? Find(string id) =>
        All.FirstOrDefault(level => level.Id == id);

    public static object List() => Tracks
        .OrderBy(track => track.Order)
        .Select(track => new
        {
            track.Id,
            track.Order,
            track.Name,
            track.Summary,
            available = track.Available,
            levelCount = track.Levels.Count,
            levels = track.Levels
                .OrderBy(level => level.Order)
                .Select(DescribeLevel)
                .ToArray()
        })
        .ToArray();

    private static CampaignLevel Advanced(
        string id, int order, string name, string summary, string hint,
        CampaignLevel template, string starterJs, string starterPy) =>
        template with
        {
            Id = "adv-" + id,
            Order = order,
            Name = name,
            Summary = summary,
            Hint = hint,
            StarterJavaScript = starterJs,
            StarterPython = starterPy
        };

    private static MatchConfig OpenArena(int maxTicks, BotSpawn player, BotSpawn opponent) =>
        MatchConfig.Classic with
        {
            MaxTicks = maxTicks,
            Arena = new(16, 10, []),
            Spawns = Array.AsReadOnly(new[] { player, opponent }),
            ShrinkZoneEnabled = false,
        };

    private static MatchConfig TeamArena(int maxTicks, BotSpawn[] players, BotSpawn[] opponents) =>
        MatchConfig.Classic with
        {
            MaxTicks = maxTicks,
            Arena = new(16, 10, []),
            Spawns = Array.AsReadOnly(players.Concat(opponents).ToArray()),
            ShrinkZoneEnabled = false,
        };

    private static object DescribeLevel(CampaignLevel level)
    {
        var scripts = level.ResolvedPlayerScripts;
        var starters = scripts.ToDictionary(
            script => script.BotId,
            script => new Dictionary<string, string>
            {
                ["javascript"] = script.JavaScript.Trim(),
                ["python"] = script.Python.Trim()
            },
            StringComparer.Ordinal);
        var primary = scripts[0];
        return new
        {
            level.Id,
            level.Order,
            level.Name,
            level.Summary,
            objective = level.ObjectiveLabel,
            level.Hint,
            arena = level.Config.Arena,
            marker = level.Marker,
            captureZones = level.Objective is CapturePointObjective capture
                ? capture.Bases.Select(zone => new
                {
                    ownerTeamId = zone.OwnerTeamId,
                    x = zone.X,
                    y = zone.Y,
                    width = zone.Width,
                    height = zone.Height,
                    progress = 0,
                })
                : null,
            spawns = level.Config.Spawns.Select(spawn => new
            {
                spawn.Id,
                teamId = spawn.ResolvedTeamId,
                spawn.Position,
                spawn.BodyAngle,
                spawn.TurretAngle
            }),
            playerBotIds = scripts.Select(script => script.BotId).ToArray(),
            starters,
            starter = new Dictionary<string, string>
            {
                ["javascript"] = primary.JavaScript.Trim(),
                ["python"] = primary.Python.Trim()
            }
        };
    }
}
