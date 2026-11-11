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

## PostgreSQL и Yandex ID

Раздел «Сообщество» хранит пользователей, стратегии, версии и библиотеку манёвров в PostgreSQL. Для локального запуска поднимите базу и укажите настройки авторизации:

```sh
docker compose -f server/compose.postgres.yml up -d
```

Создайте `server/appsettings.Local.json` по примеру `server/appsettings.Local.example.json`. Этот файл исключён из Git. В приложении Yandex OAuth запросите права `login:info` и `login:avatar`, а Callback URL задайте **точно** как `http://localhost:5050/auth/callback` для локальной разработки. Протокол, домен, порт и путь должны совпадать посимвольно. В production используйте HTTPS и соответствующий публичный адрес.

Те же настройки можно передать переменными среды:

```text
ConnectionStrings__BotArena=Host=localhost;Port=5432;Database=botarena;Username=botarena;Password=...
Database__MigrateOnStartup=true
Authentication__Yandex__ClientId=...
Authentication__Yandex__ClientSecret=...
Authentication__Yandex__CallbackPath=/auth/callback
```

При запуске сервер применяет миграции EF Core. После первого входа через Yandex ID пользователь обязан выбрать уникальный ник. Имя, фамилия и фотография профиля обновляются из Yandex ID при последующих входах.

Новый пользователь получает 1000 виртуальных кредитов. Кредиты можно получить за победы в дружеских боях на ставку и продажу опубликованных стратегий. Все списания и начисления записываются в журнал операций PostgreSQL; при ничьей или техническом сбое боя ставки возвращаются обоим игрокам.

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

`leftTrack` и `rightTrack` задают тягу гусениц в диапазоне от −1 до 1. Пропущенные команды эквивалентны нулевой тяге, сохранению направления башни и отсутствию выстрела. Состояние JavaScript сохраняется между тиками одного матча. `enemy` равен `null`, когда между центрами танков стоит стена.

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
