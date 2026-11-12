# BotArena

Учебная платформа для боёв программируемых танков. Напишите стратегию на JavaScript, выберите встроенного противника и запустите дуэль. Сервер C# полностью рассчитает бой, а интерфейс React воспроизведёт его по кадрам.

## Локальный запуск

Нужны .NET SDK 10, Node.js 22.12+ и npm.

```sh
npm --prefix frontend ci
npm --prefix frontend run build
dotnet run --project server
```

Откройте [http://127.0.0.1:5050](http://127.0.0.1:5050). Для разработки фронтенда запустите `npm --prefix frontend run dev` в отдельном терминале с работающим сервером и откройте [http://127.0.0.1:5173](http://127.0.0.1:5173).

## Python в редакторе

По умолчанию доступен JavaScript. Чтобы включить Python на macOS или Linux (ARM64 или x86-64), установите среду из корня репозитория. Для установщика нужен Python 3.11+.

```sh
python3 scripts/install_python_runtime.py
BOTARENA_PYTHON_RUNTIME="$PWD/.botarena/python" dotnet run --project server
```

Запускайте сервер от обычного пользователя. Установщик скачивает закреплённые версии CPython WASI и Wasmtime и сверяет SHA-256. После перезапуска выберите **Python** в поле «Язык стратегии». Редактор подставит пример и будет хранить отдельный черновик для каждого языка до перезагрузки страницы.

```python
def tick(state):
    return {"leftTrack": 1, "rightTrack": 1}
```

Поля команды одинаковы в обоих языках. В Python состояние и вложенные объекты приходят как словари, массивы как списки, а скрытый противник обозначен `None`.

## Стратегия

Редактор содержит готовую стратегию. Минимальный бот остаётся на месте и ведёт огонь по видимой цели:

```js
function tick({ self, enemy }) {
  if (!enemy) return {};
  const x = enemy.position.x - self.position.x;
  const y = enemy.position.y - self.position.y;
  const error = Math.atan2(y, x) - self.turretAngle;
  return {
    aimDirection: { x, y },
    shoot: self.canShoot && Math.abs(Math.atan2(Math.sin(error), Math.cos(error))) < 0.05
  };
}
```

`leftTrack` и `rightTrack` задают тягу гусениц в диапазоне от −1 до 1. Пропущенные команды эквивалентны нулевой тяге, сохранению направления башни и отсутствию выстрела. Состояние JavaScript сохраняется между тиками одного матча. `enemy` равен `null`, когда стена перекрывает обзор или противник слишком далеко для наблюдения через туман.

На карте есть клетки песка, снега и льда, а также туман поверх грунта.
`state.self.surface` и `state.self.inFog` описывают окружение танка;
`state.arena.cells` и `state.arena.terrainRules` содержат карту и коэффициенты.
[Правила и сравнение поверхностей](docs/biomes.md#8-сравнение-параметров).

На поле случайно появляются ремонт, щит, ускоритель, охлаждение и дымовые
шашки. Подбор автоматический, запас — до двух предметов. Для применения верните
`{ useItem: "Shield" }` (Python: `{"useItem": "Shield"}`). Собственный запас
доступен в `state.self.inventory`, видимые предметы — в `state.items`.
[Характеристики и правила расходников](docs/consumables.md).

Для непрерывного вращения башни вместо `aimDirection` используйте `turretTurn`
от −1 до 1: положительное значение вращает по часовой стрелке, отрицательное —
против. Например, `return { turretTurn: 0.5 };` вращает башню с половиной
максимальной угловой скорости после плавного разгона. `turretTurn: 0` плавно
тормозит вращение. Команду нужно возвращать каждый тик; одновременно задавать
`turretTurn` и `aimDirection` нельзя. Поле доступно в JavaScript и Python.

Готовые команды башни возвращаются в поле `aim`: `bot.scan()` вращает башню,
`bot.aimAt(point)` наводит на мировую точку, `bot.holdAim()` фиксирует угол.
Например, переключение с вращения на сопровождение видимого противника:

```js
function tick(state) {
  return {
    aim: state.enemy ? bot.aimAt(state.enemy.position) : bot.scan()
  };
}
```

В Python сначала выполните `import botarena as bot` и верните
`{"aim": bot.scan()}` либо другую команду. Настройки вращения:
`bot.scan({ speed: 0.5, direction: "counterclockwise" })`; в Python —
`bot.scan({"speed": 0.5, "direction": "counterclockwise"})`.
`speed` должна быть больше 0 и не больше 1; по умолчанию башня вращается
по часовой стрелке. Поля `aim`, `aimDirection`, `turretTurn` взаимоисключающие.
Готовые команды управляют только башней; стрельба задаётся отдельно через `shoot`.

## Проверки

```sh
dotnet build server
dotnet test tests
npm --prefix frontend run build
# При запущенном сервере
python3 scripts/smoke.py
python3 -B scripts/validate_strategies.py
python3 -B scripts/validate_queue.py
# При запущенном сервере с Python WASI
python3 -B scripts/validate_python.py
```

Готовые функции для ручной проверки и ожидаемое поведение описаны в [проверочных стратегиях](scripts/strategies/README.md).

Архитектура, контракт HTTP и согласованные допущения описаны в [контексте проекта](docs/project.md).

Текст интерфейса редактируется в [frontend/src/text.ts](frontend/src/text.ts). Диагностика движка приходит из API.
