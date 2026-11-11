namespace BotArena;

internal enum PveTechnique { LeftTrack, RightTrack, AimDirection, Shoot, Combined, Victory }

internal sealed record PveLevel(
    string Id, int Order, string BlockId, int BlockOrder, int Stage, bool IsTraining,
    string Title, string Command, string Description, string Goal, string[] Hints, long Reward,
    string JavaScriptStarter, string PythonStarter, string JavaScriptSolution, string PythonSolution,
    string OpponentCode, PveTechnique Technique, MatchConfig Config);

internal sealed record PveBlockDefinition(
    string Id, int Order, string Title, string Description, bool IsTraining, IReadOnlyList<PveLevel> Levels);

internal static class PveCatalog
{
    private static readonly MatchConfig TrainingArena = OpenArena(180);
    private const string PassiveOpponent = "function tick() { return {}; }";

    public static IReadOnlyList<PveBlockDefinition> Blocks { get; } = BuildBlocks();
    public static IReadOnlyList<PveLevel> Levels { get; } = Blocks.SelectMany(block => block.Levels).ToArray();

    public static PveLevel Get(string id) => Levels.Single(level => level.Id == id);
    public static bool TryGet(string id, out PveLevel level)
    {
        level = Levels.FirstOrDefault(item => item.Id == id)!;
        return level is not null;
    }

    private static IReadOnlyList<PveBlockDefinition> BuildBlocks()
    {
        var blocks = new List<PveBlockDefinition> { TrainingBlock() };
        var themes = new (string Id, string Title, string Description, string Command)[]
        {
            ("range", "Открытая дистанция", "Неподвижные мишени учат быстро захватывать цель.", "дистанция"),
            ("pursuit", "Преследование", "Противник начинает двигаться и менять траекторию.", "погоня"),
            ("turning", "Манёвр", "Разная тяга гусениц и бой на смене курса.", "поворот"),
            ("timing", "Темп огня", "Побеждает точная работа с перезарядкой.", "перезарядка"),
            ("evasion", "Уклонение", "Не стой на линии огня — двигайся и атакуй.", "уклонение"),
            ("cover", "Контроль поля", "Ищи противника, удерживай дистанцию и возвращайся на линию атаки.", "навигация"),
            ("pressure", "Давление", "Соперник активно сокращает дистанцию.", "контроль дистанции"),
            ("duel", "Тактическая дуэль", "Сбалансированный противник использует все команды.", "тактика"),
            ("elite", "Элитный дивизион", "Маленькие ошибки сразу превращаются в полученный урон.", "адаптация"),
            ("champion", "Чемпионская серия", "Пять финальных боёв против самых быстрых алгоритмов.", "мастерство")
        };
        var globalOrder = 6;
        for (var blockIndex = 0; blockIndex < themes.Length; blockIndex++)
        {
            var theme = themes[blockIndex];
            var levels = new List<PveLevel>();
            for (var stage = 1; stage <= 5; stage++)
            {
                var difficulty = blockIndex * 5 + stage;
                // Рейтинговый урок должен проверять алгоритм, а не удачный обход
                // статичного препятствия. Сложность растёт за счёт поведения бота.
                var config = ScenarioArena(230 + difficulty * 2, blockIndex, stage);
                levels.Add(new PveLevel(
                    $"{theme.Id}-{stage}", globalOrder++, theme.Id, blockIndex + 2, stage, false,
                    $"{theme.Title} · {stage}", theme.Command,
                    $"Подуровень {stage}/5. Скорость реакции противника: {20 + difficulty}%.",
                    "Победи противника. В рейтинг попадут лучшее время и минимальный полученный урон.",
                    ChallengeHints(blockIndex, stage), 100 + difficulty * 12,
                    ChallengeStarterJs(), ChallengeStarterPy(), ReferenceJs(), ReferencePy(),
                    Opponent(blockIndex, stage), PveTechnique.Victory, config));
            }
            blocks.Add(new(theme.Id, blockIndex + 2, theme.Title, theme.Description, false, levels));
        }
        return blocks;
    }

    private static PveBlockDefinition TrainingBlock()
    {
        var levels = new[]
        {
            Training("left-track", 1, "Левая гусеница", "leftTrack", "Научись задавать тягу левой гусеницы и поворачивать корпус вправо.",
                "Поверни корпус минимум на 20° и уничтожь учебную мишень.",
                ["Значение тяги находится между −1 и 1.", "Если левая гусеница быстрее правой, корпус начнёт поворачивать.", "Замени leftTrack: 0 на leftTrack: 1."], 50,
                JsTrack("leftTrack", false), PyTrack("leftTrack", false), JsTrack("leftTrack", true), PyTrack("leftTrack", true), PveTechnique.LeftTrack),
            Training("right-track", 2, "Правая гусеница", "rightTrack", "Закрепи управление второй гусеницей и выполни поворот в другую сторону.",
                "Поверни корпус минимум на 20° влево и уничтожь мишень.",
                ["Теперь ведущей должна стать правая гусеница.", "Оставь leftTrack равным 0.", "Замени rightTrack: 0 на rightTrack: 1."], 60,
                JsTrack("rightTrack", false), PyTrack("rightTrack", false), JsTrack("rightTrack", true), PyTrack("rightTrack", true), PveTechnique.RightTrack),
            Training("aim-direction", 3, "Наведение башни", "aimDirection", "Передай башне вектор от своей позиции до позиции противника.",
                "Наведи башню, попади в мишень и победи.",
                ["aimDirection — объект с координатами x и y.", "Вычти позицию self из позиции enemy.", "Используй разницу координат как вектор."], 75,
                JsAim(false), PyAim(false), JsAim(true), PyAim(true), PveTechnique.AimDirection),
            Training("shoot", 4, "Условный выстрел", "shoot", "Стреляй только тогда, когда орудие перезаряжено и башня наведена.",
                "Сделай хотя бы один выстрел и уничтожь мишень.",
                ["self.canShoot сообщает о завершении перезарядки.", "Поле shoot принимает true или false.", "Используй self.canShoot."], 90,
                JsShoot(false), PyShoot(false), JsShoot(true), PyShoot(true), PveTechnique.Shoot),
            Training("first-bot", 5, "Первый боевой алгоритм", "tick(state)", "Соедини движение, наведение и стрельбу в одной функции.",
                "Сдвинься с места, попади в противника и выиграй бой.",
                ["Вычисли dx и dy до противника.", "Одинаковая тяга гусениц двигает танк прямо.", "Верни все четыре команды в одном объекте."], 125,
                JsCombined(false), PyCombined(false), JsCombined(true), PyCombined(true), PveTechnique.Combined)
        };
        return new("training", 1, "Обучение", "Освой команды бота и собери первый боевой алгоритм.", true, levels);
    }

    private static PveLevel Training(string id, int order, string title, string command, string description,
        string goal, string[] hints, long reward, string jsStarter, string pyStarter, string jsSolution,
        string pySolution, PveTechnique technique) => new(id, order, "training", 1, order, true, title, command,
        description, goal, hints, reward, jsStarter, pyStarter, jsSolution, pySolution, PassiveOpponent, technique, TrainingArena);

    private static MatchConfig OpenArena(int maxTicks) => new(20, maxTicks,
        new(12, 10, Array.AsReadOnly(Array.Empty<Wall>())),
        Array.AsReadOnly(new[]
        {
            new BotSpawn("player", new(2, 4), 0, 0),
            new BotSpawn("opponent", new(9, 7), Math.PI, Math.PI)
        }));

    private static MatchConfig ScenarioArena(int maxTicks, int block, int stage)
    {
        var difficulty = block * 5 + stage;
        var playerY = 4.65 + stage * .12;
        var opponentY = 5.35 - stage * .12;
        var playerX = stage % 2 == 0 ? 2.6 : 1.7;
        var opponentX = stage % 3 == 0 ? 8.7 : 10.3;
        var slots = new[] { 2.7, 4.45, 6.2, 7.95, 9.65 };
        var walls = Enumerable.Range(0, 1 + (difficulty - 1) % 5).Select(index =>
        {
            var width = .72 + ((difficulty + index * 2) % 4) * .16;
            var height = 1.15 + ((difficulty * 3 + index) % 5) * .18;
            var x = slots[index] + ((difficulty % 3) - 1) * .06;
            var y = index % 2 == 0
                ? .65 + ((difficulty + index) % 4) * .22
                : 10 - height - .65 - ((difficulty + index) % 4) * .22;
            return new Wall(x, y, width, height);
        }).ToArray();
        return new(20, maxTicks, new(12, 10, Array.AsReadOnly(walls)),
            Array.AsReadOnly(new[]
            {
                new BotSpawn("player", new(playerX, playerY), 0, 0),
                new BotSpawn("opponent", new(opponentX, opponentY), Math.PI, Math.PI)
            }));
    }

    private static string[] ChallengeHints(int block, int stage) =>
    [
        stage <= 2 ? "Начни с точного наведения и стрельбы по готовности." : "Добавь движение: неподвижная цель получает больше урона.",
        block >= 5 ? "Когда enemy равен null, двигайся к безопасной точке и ищи линию обзора." : "Корректируй курс через разницу bodyAngle и направления на цель.",
        "Сравни своё решение с эталонным кодом, а затем попробуй улучшить его время."
    ];

    private static string Opponent(int block, int stage)
    {
        var difficulty = block * 5 + stage;
        var throttle = Math.Min(.72, .08 + difficulty * .013).ToString("0.00", System.Globalization.CultureInfo.InvariantCulture);
        var tolerance = Math.Max(.075, .25 - difficulty * .0035).ToString("0.000", System.Globalization.CultureInfo.InvariantCulture);
        var delay = difficulty == 50 ? 28 : Math.Max(4, 42 - difficulty / 2);
        var cadence = difficulty == 50 ? 22 : Math.Max(14, 34 - difficulty / 3);
        var tactic = block switch
        {
            0 => "drive = 0; desired = heading;",
            1 => "desired = heading + Math.sin(state.tick / 16) * .55; drive = distance > 3.8 ? speed : -.16;",
            2 => "desired = heading + (state.tick % 80 < 40 ? .72 : -.72); drive = speed;",
            3 => "desired = heading; drive = distance > 6 ? speed : distance < 3.8 ? -speed * .7 : 0;",
            4 => "desired = heading + Math.sin(state.tick / 8) * .38; drive = state.tick % 65 < 48 ? speed : -speed * .5;",
            5 => "desired = heading + (distance < 4.5 ? 1.05 : .25); drive = speed * .85;",
            6 => "desired = distance < 5.5 ? heading + Math.PI : heading; drive = speed;",
            7 => "desired = heading + Math.sin(state.tick / 11) * .8; drive = state.tick % 50 < 25 ? speed : -speed * .65;",
            8 => "desired = heading + Math.sin(state.tick * .19 + 2) * .9; drive = distance > 3 ? speed : -speed;",
            _ => "const phase = Math.floor(state.tick / 45) % 3; desired = heading + (phase === 0 ? .8 : phase === 1 ? -.8 : 0); drive = phase === 2 ? -speed * .7 : speed;"
        };
        return $$"""
            function tick(state) {
              const { self, enemy } = state;
              const target = enemy?.position ?? { x: 6, y: 5 };
              const dx = target.x - self.position.x;
              const dy = target.y - self.position.y;
              const heading = Math.atan2(dy, dx);
              const distance = Math.hypot(dx, dy);
              const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
              const speed = {{throttle}};
              let desired = heading;
              let drive = 0;
              {{tactic}}
              const error = wrap(desired - self.bodyAngle);
              const turn = Math.max(-1, Math.min(1, error * 1.8));
              if (Math.abs(error) > 1.1) drive = 0;
              const aligned = Math.abs(wrap(heading - self.turretAngle)) < {{tolerance}};
              return {
                leftTrack: drive + turn,
                rightTrack: drive - turn,
                aimDirection: { x: dx, y: dy },
                shoot: !!enemy && state.tick >= {{delay}} && state.tick % {{cadence}} === 0 && aligned && self.canShoot
              };
            }
            """;
    }

    private static string ChallengeStarterJs() => """
        function tick({ self, enemy, tick }) {
          if (!enemy) return { leftTrack: 0.6, rightTrack: 0.2 };
          const dx = enemy.position.x - self.position.x;
          const dy = enemy.position.y - self.position.y;
          // Улучши движение, наведение и момент выстрела.
          return { leftTrack: 0, rightTrack: 0, aimDirection: { x: dx, y: dy }, shoot: self.canShoot };
        }
        """;

    private static string ChallengeStarterPy() => """
        def tick(state):
            self_bot = state["self"]
            enemy = state["enemy"]
            if enemy is None:
                return {"leftTrack": 0.6, "rightTrack": 0.2}
            dx = enemy["position"]["x"] - self_bot["position"]["x"]
            dy = enemy["position"]["y"] - self_bot["position"]["y"]
            return {"leftTrack": 0, "rightTrack": 0, "aimDirection": {"x": dx, "y": dy}, "shoot": self_bot["canShoot"]}
        """;

    private static string ReferenceJs() => """
        function tick({ self, enemy, tick }) {
          const waypoint = enemy?.position ?? (self.position.y > 3.65 ? { x: 4.1, y: 3.45 } : { x: 12, y: 3.5 });
          const dx = waypoint.x - self.position.x;
          const dy = waypoint.y - self.position.y;
          const heading = Math.atan2(dy, dx);
          const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
          const error = wrap(heading - self.bodyAngle);
          const turn = Math.max(-1, Math.min(1, error * 2));
          const distance = Math.hypot(dx, dy);
          const drive = Math.abs(error) < .65 ? (distance > 4 ? .9 : .28) : 0;
          const aligned = Math.abs(wrap(heading - self.turretAngle)) < .055;
          return {
            leftTrack: drive + turn,
            rightTrack: drive - turn,
            aimDirection: { x: dx, y: dy },
            shoot: !!enemy && aligned && self.canShoot
          };
        }
        """;

    private static string ReferencePy() => """
        import math
        def tick(state):
            self_bot, enemy = state["self"], state["enemy"]
            waypoint = enemy["position"] if enemy else ({"x": 4.1, "y": 3.45} if self_bot["position"]["y"] > 3.65 else {"x": 12, "y": 3.5})
            dx, dy = waypoint["x"] - self_bot["position"]["x"], waypoint["y"] - self_bot["position"]["y"]
            heading = math.atan2(dy, dx)
            error = math.atan2(math.sin(heading - self_bot["bodyAngle"]), math.cos(heading - self_bot["bodyAngle"]))
            turn = max(-1, min(1, error * 2))
            distance = math.hypot(dx, dy)
            drive = (0.9 if distance > 4 else 0.28) if abs(error) < 0.65 else 0
            aligned = abs(math.atan2(math.sin(heading - self_bot["turretAngle"]), math.cos(heading - self_bot["turretAngle"]))) < 0.055
            return {"leftTrack": drive + turn, "rightTrack": drive - turn, "aimDirection": {"x": dx, "y": dy}, "shoot": enemy is not None and aligned and self_bot["canShoot"]}
        """;

    private static string JsTrack(string command, bool solved) => $$"""
        function tick({ self, enemy }) {
          if (!enemy) return {};
          const aim = { x: enemy.position.x - self.position.x, y: enemy.position.y - self.position.y };
          return {
            leftTrack: {{(solved && command == "leftTrack" ? "1" : "0")}}, {{(!solved && command == "leftTrack" ? "// TODO" : "")}}
            rightTrack: {{(solved && command == "rightTrack" ? "1" : "0")}}, {{(!solved && command == "rightTrack" ? "// TODO" : "")}}
            aimDirection: aim,
            shoot: Math.abs(self.bodyAngle) > 0.35 && self.canShoot
          };
        }
        """;

    private static string PyTrack(string command, bool solved) => $$"""
        def tick(state):
            self_bot, enemy = state["self"], state["enemy"]
            if enemy is None: return {}
            aim = {"x": enemy["position"]["x"] - self_bot["position"]["x"], "y": enemy["position"]["y"] - self_bot["position"]["y"]}
            return {"leftTrack": {{(solved && command == "leftTrack" ? "1" : "0")}}, "rightTrack": {{(solved && command == "rightTrack" ? "1" : "0")}}, "aimDirection": aim, "shoot": abs(self_bot["bodyAngle"]) > 0.35 and self_bot["canShoot"]}
        """;

    private static string JsAim(bool solved) => $$"""
        function tick({ self, enemy }) {
          if (!enemy) return {};
          const dx = enemy.position.x - self.position.x, dy = enemy.position.y - self.position.y;
          const desired = Math.atan2(dy, dx);
          const error = Math.atan2(Math.sin(desired - self.turretAngle), Math.cos(desired - self.turretAngle));
          // TODO: замени нулевой вектор направлением на противника.
          return { aimDirection: {{(solved ? "{ x: dx, y: dy }" : "{ x: 0, y: 0 }")}}, shoot: Math.abs(error) < .05 && self.canShoot };
        }
        """;

    private static string PyAim(bool solved) => solved ? """
        import math
        def tick(state):
            self_bot, enemy = state["self"], state["enemy"]
            if enemy is None: return {}
            dx, dy = enemy["position"]["x"] - self_bot["position"]["x"], enemy["position"]["y"] - self_bot["position"]["y"]
            desired = math.atan2(dy, dx)
            error = math.atan2(math.sin(desired - self_bot["turretAngle"]), math.cos(desired - self_bot["turretAngle"]))
            return {"aimDirection": {"x": dx, "y": dy}, "shoot": abs(error) < .05 and self_bot["canShoot"]}
        """ : """
        import math
        def tick(state):
            self_bot, enemy = state["self"], state["enemy"]
            if enemy is None: return {}
            dx, dy = enemy["position"]["x"] - self_bot["position"]["x"], enemy["position"]["y"] - self_bot["position"]["y"]
            desired = math.atan2(dy, dx)
            error = math.atan2(math.sin(desired - self_bot["turretAngle"]), math.cos(desired - self_bot["turretAngle"]))
            return {"aimDirection": {"x": 0, "y": 0}, "shoot": abs(error) < .05 and self_bot["canShoot"]} # TODO
        """;

    private static string JsShoot(bool solved) => $$"""
        function tick({ self, enemy }) {
          if (!enemy) return {};
          // TODO: разреши выстрел после перезарядки.
          return { aimDirection: { x: enemy.position.x - self.position.x, y: enemy.position.y - self.position.y }, shoot: {{(solved ? "self.canShoot" : "false")}} };
        }
        """;

    private static string PyShoot(bool solved) => $$"""
        def tick(state):
            self_bot, enemy = state["self"], state["enemy"]
            if enemy is None: return {}
            return {"aimDirection": {"x": enemy["position"]["x"] - self_bot["position"]["x"], "y": enemy["position"]["y"] - self_bot["position"]["y"]}, "shoot": {{(solved ? "self_bot[\"canShoot\"]" : "False")}}}
        """;

    private static string JsCombined(bool solved) => solved ? ReferenceJs() : """
        function tick({ self, enemy }) {
          if (!enemy) return {};
          const dx = enemy.position.x - self.position.x, dy = enemy.position.y - self.position.y;
          return { leftTrack: 0, rightTrack: 0, aimDirection: { x: 0, y: 0 }, shoot: false }; // TODO
        }
        """;

    private static string PyCombined(bool solved) => solved ? ReferencePy() : """
        def tick(state):
            self_bot, enemy = state["self"], state["enemy"]
            if enemy is None: return {}
            return {"leftTrack": 0, "rightTrack": 0, "aimDirection": {"x": 0, "y": 0}, "shoot": False} # TODO
        """;
}
