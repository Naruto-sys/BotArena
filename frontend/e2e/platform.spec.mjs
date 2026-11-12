import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { wallOverlapsBot } from '../src/mapGeometry.ts';

const nav = (page, name) => page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name, exact: true });
const start = page => page.getByRole('button', { name: 'Запустить матч', exact: true });
const settings = page => page.getByRole('button', { name: /Участники и параметры боя/ });
async function arena(page) { await page.goto('/#arena'); await page.locator('.cm-content').waitFor(); }
async function signup(request) {
  const login = `qa_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const password = `${randomUUID()}Aa1!`;
  const response = await request.post('/api/auth/register', { data: { login, password, nickname: login, firstName: 'QA', lastName: 'BotArena' } });
  expect(response.status()).toBe(200);
  return { login, password, user: await response.json() };
}
async function drag(page, from, to) {
  await page.locator('.lab-arena').scrollIntoViewIfNeeded();
  const position = p => page.locator('.lab-arena').evaluate((svg, [x, y]) => {
    const point = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM()); return { x: point.x, y: point.y };
  }, p);
  const a = await position(from), b = await position(to);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y); await page.mouse.up();
}
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('botarena.labSetup.v1')));
async function postMatch(request, customMatch, language = 'javascript') {
  const response = await request.post('/api/matches', { data: { customMatch, language } });
  expect(response.status(), await response.text()).toBe(200);
  const result = await response.json(); expect(result.error).toBeNull(); return result.replay;
}
function duel(code, enemyCode = 'function tick(){return {};}', movement = 'tracked') {
  return { arena: { width: 16, height: 10, walls: [] }, maxTicks: 40,
    spawns: [{ id: 'player', teamId: 'player', x: 3, y: 3, movement }, { id: 'opponent', teamId: 'opponent', x: 13, y: 7 }],
    loadouts: [{ botId: 'player', source: 'code', code }, { botId: 'opponent', source: 'code', code: enemyCode }] };
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => localStorage.setItem('botarena-first-run-v2', 'done'));
});

test('all public pages work on desktop/mobile in both themes', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  for (const theme of ['dark', 'light']) {
    await page.addInitScript(theme => localStorage.setItem('botarena-theme', theme), theme);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 950 });
      for (const hash of ['home', 'learn', 'arena', 'workshop', 'ugc']) {
        await page.goto(`/#${hash}`);
        await page.locator('.platform-header').waitFor();
        await expect(page.locator('.auth-loading')).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      }
    }
  }
  expect(errors).toEqual([]);
});

test('guest battle, replay analysis and expanded editor work', async ({ page }) => {
  await arena(page);
  await page.getByRole('button', { name: 'Развернуть редактор', exact: true }).click();
  await expect(page.locator('.replay')).toBeHidden();
  await start(page).click();
  await expect(page.locator('.replay')).toBeVisible();
  await page.locator('.blueprint-canvas').waitFor({ state: 'attached', timeout: 30000 });
  await expect(page.getByRole('button', { name: 'План', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByText('Анализ боя', { exact: true }).click();
  await expect(page.getByLabel('Тактический след', { exact: true })).not.toBeChecked();
  for (const [name, cls] of [['Башня времени', '.timeline-mode'], ['Восприятие', '.perception-mode']]) {
    await page.getByRole('button', { name, exact: true }).click(); await page.locator(cls).waitFor();
  }
  await page.getByText('Звук', { exact: true }).click();
  await page.locator('summary').filter({ hasText: /^Экспорт видео$/ }).click();
  await expect(page.locator('.video-export-start')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test('editor preserves continuous typing and saved strategies survive reload', async ({ page }) => {
  await arena(page);
  await page.locator('.cm-content').click(); await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n// continuous typing 12345');
  await expect(page.locator('.cm-content')).toContainText('continuous typing 12345');
  await page.getByLabel('Название стратегии', { exact: true }).fill('Saved draft');
  await page.getByRole('button', { name: 'Сохранить стратегию', exact: true }).click();
  await nav(page, 'Мастерская').click(); await page.reload();
  await page.getByRole('button', { name: 'Открыть на арене', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('continuous typing 12345');
});

test('invalid wall is red, not persisted, does not move robots and blocks battle', async ({ page }) => {
  await arena(page); const before = await stored(page);
  const row = page.locator('.lab-wall-row').first();
  await row.getByLabel('x', { exact: true }).fill('2');
  await row.getByLabel('y', { exact: true }).fill('4.5');
  await expect(page.locator('.lab-wall.invalid-placement')).toHaveCount(1);
  await expect(start(page)).toBeDisabled();
  const rejected = await stored(page);
  expect(rejected.bots).toEqual(before.bots);
  expect(rejected.arena.walls[0].y).toBe(1.9);
  await expect(row.getByLabel('y', { exact: true })).toHaveValue('4.5');
  await page.getByRole('button', { name: 'Отменить изменение', exact: true }).click();
  await expect(start(page)).toBeEnabled();
  await expect(page.locator('.invalid-placement')).toHaveCount(0);
  await row.getByLabel('y', { exact: true }).fill('1');
  expect((await stored(page)).arena.walls[0].y).toBe(1);
});

test('wall drag and robot drag keep invalid previews without pushing the robot', async ({ page }) => {
  await arena(page);
  await drag(page, [5.2, 2.5], [2.7, 5]);
  await expect(page.locator('.lab-wall.invalid-placement')).toHaveCount(1);
  expect((await stored(page)).bots[0].position).toEqual({ x: 2.2, y: 5 });
  await expect(start(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Отменить изменение', exact: true }).click();
  await drag(page, [2.2, 5], [5, 2.5]);
  await expect(page.locator('.robot-placement-preview')).toHaveCount(1);
  expect((await stored(page)).bots[0].position).toEqual({ x: 2.2, y: 5 });
  await expect(start(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Отменить изменение', exact: true }).click();
  await expect(start(page)).toBeEnabled();
});

test('settings modal traps focus, restores it and exposes rejected roster changes', async ({ page }) => {
  await arena(page); await settings(page).click();
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(settings(page)).toBeFocused();
});

test('each chassis moves; Python custom opponents use Python too', async ({ request }) => {
  for (const [movement, action] of Object.entries({ tracked: '{leftTrack:1,rightTrack:1}', hover: '{thrust:{x:0,y:1}}', wheeled: '{throttle:1}', omni: '{thrust:{x:0,y:1}}' })) {
    const replay = await postMatch(request, duel(`function tick(){return ${action};}`, undefined, movement));
    const bot = replay.frames.at(-1).bots[0]; expect(bot.movement).toBe(movement);
    expect(Math.hypot(bot.position.x - 3, bot.position.y - 3)).toBeGreaterThan(.5);
  }
  const languages = await request.get('/api/strategy-languages').then(r => r.json());
  test.skip(!languages.includes('python'), 'Python WASI not configured');
  const replay = await postMatch(request, duel('def tick(state):\n    return {"leftTrack": 1, "rightTrack": 1}', 'def tick(state):\n    return {"leftTrack": -1, "rightTrack": -1}'), 'python');
  expect(replay.frames.at(-1).bots[1].position.x).toBeLessThan(13);
});

test('concurrent match calculations finish and bad scripts return structured errors', async ({ request }) => {
  const replies = await Promise.all(Array.from({ length: 3 }, () => request.post('/api/matches', { data: { botCode: 'function tick(){return {};}', opponentId: 'aggressive' } })));
  for (const response of replies) { expect(response.status()).toBe(200); expect((await response.json()).error).toBeNull(); }
  const bad = await request.post('/api/matches', { data: { botCode: 'function tick(){while(true){}}', opponentId: 'aggressive' } });
  expect(bad.status()).toBe(200); expect((await bad.json()).error.tick).toBe(0);
});

test('capture-point mode renders bases and produces a real replay', async ({ page }) => {
  await arena(page); await page.getByRole('combobox', { name: 'Режим боя', exact: true }).selectOption('capturePoint');
  await expect(page.locator('.lab-base')).toHaveCount(2);
  await start(page).click(); await page.locator('.blueprint-canvas').waitFor({ state: 'attached', timeout: 30000 });
  await expect(page.locator('.error-card')).toHaveCount(0);
});

test('community creates and edits maps using only the Arena editor', async ({ page }) => {
  await signup(page.request); await page.goto('/#ugc');
  await page.locator('.ugc-tabs').getByRole('button', { name: 'Карты', exact: true }).click();
  await page.getByRole('button', { name: '+ Создать карту', exact: true }).click();
  await expect(page).toHaveURL(/#arena$/);
  await expect(page.locator('.lab-arena')).toHaveCount(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Добавить стену', exact: true }).click();
  const row = page.locator('.lab-wall-row').first();
  await row.getByLabel('x', { exact: true }).fill('2');
  await row.getByLabel('y', { exact: true }).fill('4.5');
  await expect(page.locator('.lab-arena .invalid-placement')).toHaveCount(1);
  const save = page.locator('.arena-workspace-toolbar').getByRole('button', { name: 'Сохранить карту', exact: true });
  await expect(save).toBeDisabled(); await expect(start(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Отменить изменение', exact: true }).click();
  await save.click();
  const modal = page.getByRole('dialog', { name: 'Сохранение карты', exact: true });
  await expect(modal.locator('svg')).toHaveCount(0);
  await modal.getByLabel('Название карты', { exact: true }).fill('QA unified map');
  await modal.getByRole('button', { name: 'Сохранить карту', exact: true }).click();
  await expect(modal).toHaveCount(0);
  const maps = await page.request.get('/api/maps/').then(r => r.json());
  expect(maps).toHaveLength(1); expect(maps[0].walls).toHaveLength(1);
  await nav(page, 'Сообщество').click();
  await page.locator('.ugc-tabs').getByRole('button', { name: 'Карты', exact: true }).click();
  await page.locator('.map-card').filter({ hasText: 'QA unified map' }).getByRole('button', { name: 'Редактировать', exact: true }).click();
  await expect(page).toHaveURL(/#arena$/);
  await page.locator('.lab-wall-row').first().getByLabel('x', { exact: true }).fill('7');
  await save.click(); await expect(modal.getByLabel('Название карты', { exact: true })).toHaveValue('QA unified map');
  await modal.getByRole('button', { name: 'Сохранить карту', exact: true }).click(); await expect(modal).toHaveCount(0);
  const updated = await page.request.get('/api/maps/').then(r => r.json());
  expect(updated).toHaveLength(1); expect(updated[0].id).toBe(maps[0].id); expect(updated[0].walls[0].x).toBe(7);
  await page.request.delete(`/api/maps/${maps[0].id}`);
});

test('local account supports profile, strategy and map persistence and owner checks', async ({ page, playwright }) => {
  const account = await signup(page.request);
  const me = await page.request.get('/api/auth/session').then(r => r.json()); expect(me.authenticated).toBe(true);
  const created = await page.request.post('/api/ugc/strategies', { data: { name: 'QA strategy', description: '', language: 'javascript', code: 'function tick(){return {};}', tags: [], salePrice: null } });
  expect(created.status()).toBe(201); const strategy = await created.json();
  const other = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    await signup(other);
    expect((await other.put(`/api/ugc/strategies/${strategy.id}`, { data: { name: 'Changed', description: '', language: 'javascript', code: 'function tick(){return {};}', tags: [], salePrice: null } })).status()).toBe(403);
  } finally { await other.dispose(); }
  expect((await page.request.delete(`/api/ugc/strategies/${strategy.id}`)).status()).toBe(204);
  await page.request.post('/api/auth/logout');
  expect((await page.request.post('/api/auth/password-login', { data: { login: account.login, password: account.password } })).status()).toBe(200);
});

test('two tabs do not overwrite independently saved strategies', async ({ context }) => {
  const a = await context.newPage(), b = await context.newPage();
  for (const page of [a, b]) await arena(page);
  for (const [page, name] of [[a, 'Tab A'], [b, 'Tab B']]) {
    await page.getByLabel('Название стратегии', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Сохранить стратегию', exact: true }).click();
  }
  for (const page of [a, b]) {
    await nav(page, 'Мастерская').click();
    await expect(page.getByRole('heading', { name: 'Tab A', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tab B', exact: true })).toBeVisible();
  }
});

test('protected community tabs stay in app for guests', async ({ page }) => {
  const navigations = []; page.on('request', r => { if (r.isNavigationRequest() && r.url().includes('/api/auth/')) navigations.push(r.url()); });
  await page.goto('/#ugc');
  for (const name of ['Друзья', 'Мои стратегии', 'Комнаты', 'Карты']) {
    await page.locator('.ugc-tabs').getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.auth-feedback')).toBeVisible(); expect(page.url()).toContain('#ugc');
  }
  expect(navigations).toEqual([]);
});

test('clipboard success is green and denied access is an error', async ({ page }) => {
  await page.route('**/api/ugc/maneuvers?*', r => r.fulfill({ json: [{ id: 'copy', name: 'Copy', description: '', category: 'combat', language: 'javascript', code: 'return {};', usage: 'copy()', tags: [] }] }));
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } }));
  await page.goto('/#ugc'); await page.locator('.ugc-tabs').getByRole('button', { name: 'Манёвры', exact: true }).click();
  await page.getByRole('button', { name: 'Копировать код', exact: true }).click();
  await expect(page.locator('.ugc-notice')).toHaveText('Код манёвра скопирован.');
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw Error('denied'); }; });
  await page.getByRole('button', { name: 'Копировать код', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось скопировать код');
});

test('geometry accounts for rotated hulls and touching edges', () => {
  const bot = { position: { x: 0, y: 0 }, bodyAngle: 0 };
  expect(wallOverlapsBot({ x: .34, y: -.1, width: .2, height: .2 }, bot)).toBe(true);
  expect(wallOverlapsBot({ x: .35, y: -.1, width: .2, height: .2 }, bot)).toBe(false);
  expect(wallOverlapsBot({ x: .42, y: -.03, width: .1, height: .06 }, { ...bot, bodyAngle: Math.PI / 4 })).toBe(true);
  expect(wallOverlapsBot({ x: .42, y: .42, width: .05, height: .05 }, { ...bot, bodyAngle: Math.PI / 4 })).toBe(false);
});


test('camera choice survives recalculation and reload; Plan is the default', async ({ page }) => {
  await arena(page); await start(page).click();
  await page.locator('.blueprint-canvas').waitFor({ state: 'attached', timeout: 30000 });
  await expect(page.getByRole('button', { name: 'План', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Сверху', exact: true }).click();
  await start(page).click();
  await page.locator('.blueprint-canvas').waitFor({ state: 'attached', timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Сверху', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload(); await start(page).click();
  await page.locator('.blueprint-canvas').waitFor({ state: 'attached', timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Сверху', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('local registration and logout work through the actual UI', async ({ page }) => {
  await page.goto('/');
  await page.locator('.platform-account').getByRole('button', { name: 'Войти / Регистрация', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Войти', exact: true });
  await dialog.getByRole('button', { name: 'Регистрация', exact: true }).click();
  const registration = page.getByRole('dialog', { name: 'Создать аккаунт', exact: true });
  const id = `qa_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  await registration.getByLabel('Логин', { exact: true }).fill(id);
  await registration.getByLabel('Пароль', { exact: true }).fill(`${randomUUID()}Aa1!`);
  await registration.getByLabel('Уникальный ник', { exact: true }).fill(id);
  await registration.getByRole('button', { name: 'Зарегистрироваться', exact: true }).click();
  await expect(registration).toHaveCount(0);
  await expect(page.locator('.profile-menu')).toContainText(id);
  await page.getByRole('button', { name: 'Меню аккаунта', exact: true }).click();
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.locator('.platform-account').getByRole('button', { name: 'Войти / Регистрация', exact: true })).toBeVisible();
});

test('two real local accounts can play a room and balances are conserved', async ({ playwright }) => {
  const options = { baseURL: test.info().project.use.baseURL };
  const first = await playwright.request.newContext(options), second = await playwright.request.newContext(options);
  try {
    await signup(first); await signup(second);
    const mapResponse = await first.post('/api/maps/', { data: { name: 'QA room arena', walls: [] } });
    expect(mapResponse.status()).toBe(201); const map = await mapResponse.json();
    const created = await first.post('/api/rooms/', { data: { name: 'QA room', allowClipboard: true, allowPresetStrategies: true, maxCharactersPerSecond: 1000, stake: 10, mapId: map.id } });
    expect(created.status()).toBe(201); const room = await created.json();
    expect((await second.post(`/api/rooms/${room.id}/join`)).status()).toBe(200);
    for (const [request, code] of [[first, 'function tick(){return {aimDirection:{x:1,y:0},shoot:true};}'], [second, 'function tick(){return {};}']]) {
      expect((await request.put(`/api/rooms/${room.id}/draft`, { data: { code, language: 'javascript' } })).status()).toBe(200);
    }
    expect((await first.post(`/api/rooms/${room.id}/ready`).then(r => r.json())).waiting).toBe(true);
    const result = await second.post(`/api/rooms/${room.id}/ready`);
    expect(result.status()).toBe(200); expect((await result.json()).match.error).toBeNull();
    const a = await first.get('/api/auth/session').then(r => r.json()), b = await second.get('/api/auth/session').then(r => r.json());
    expect(a.user.balance + b.user.balance).toBe(2000);
    expect((await first.get(`/api/rooms/${room.id}`).then(r => r.json())).match.replay.result.winnerBotId).toBe('player');
    await first.delete(`/api/maps/${map.id}`);
  } finally { await first.dispose(); await second.dispose(); }
});


test('resetting settings discards an invalid wall preview and re-enables launch', async ({ page }) => {
  await arena(page);
  const row = page.locator('.lab-wall-row').first();
  await row.getByLabel('x', { exact: true }).fill('2'); await row.getByLabel('y', { exact: true }).fill('4.5');
  await expect(start(page)).toBeDisabled();
  await settings(page).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Сбросить', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(start(page)).toBeEnabled();
  await expect(page.locator('.invalid-placement')).toHaveCount(0);
});

test('private rooms enforce passwords and serialize concurrent creates per creator', async ({ playwright }) => {
  const options = { baseURL: test.info().project.use.baseURL };
  const owner = await playwright.request.newContext(options), guest = await playwright.request.newContext(options);
  try {
    await signup(owner); await signup(guest);
    const data = { name: 'QA private', allowClipboard: true, allowPresetStrategies: true, maxCharactersPerSecond: 1000, stake: 0, mapId: null, isPrivate: true, password: 'test-private-pass' };
    const results = await Promise.all([owner.post('/api/rooms/', { data }), owner.post('/api/rooms/', { data })]);
    expect(results.map(r => r.status()).sort()).toEqual([201, 409]);
    const room = await results.find(r => r.status() === 201).json();
    expect(room.isPrivate).toBe(true); expect(JSON.stringify(room)).not.toMatch(/password/i);
    expect((await guest.get('/api/rooms/').then(r => r.json())).some(r => r.id === room.id)).toBe(false);
    expect((await owner.get('/api/rooms/mine').then(r => r.json())).some(r => r.id === room.id)).toBe(true);
    expect((await guest.post(`/api/rooms/${room.id}/join`)).status()).toBe(403);
    expect((await guest.post(`/api/rooms/${room.id}/join`, { data: { password: 'wrong' } })).status()).toBe(403);
    expect((await guest.post(`/api/rooms/${room.id}/join`, { data: { password: data.password } })).status()).toBe(200);
    expect((await owner.put(`/api/rooms/${room.id}/draft`, { data: { code: 'function tick(){return {};}', language: 'javascript' } })).status()).toBe(200);
    expect((await owner.get(`/api/rooms/${room.id}`).then(r => r.json())).draft.code).toBe('function tick(){return {};}');
    expect((await owner.delete(`/api/rooms/${room.id}`)).status()).toBe(204);
    const again = await owner.post('/api/rooms/', { data: { ...data, isPrivate: false } });
    expect(again.status()).toBe(201); await owner.delete(`/api/rooms/${(await again.json()).id}`);
  } finally { await owner.dispose(); await guest.dispose(); }
});

test('account menu is aligned and theme changes editor without losing text', async ({ page }) => {
  await signup(page.request); await arena(page);
  await page.locator('.cm-content').fill('function tick() { return {}; }');
  await page.getByRole('button', { name: 'Меню аккаунта', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Настройки профиля', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Включить светлую тему', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.cm-content')).toContainText('function tick() { return {}; }');
  await expect(page.locator('.cm-editor')).toHaveCSS('background-color', 'rgb(248, 251, 253)');
  const avatar = await page.locator('.profile-fallback').boundingBox(); expect(Math.abs(avatar.width - avatar.height)).toBeLessThan(1);
  await page.keyboard.press('Escape'); await expect(page.locator('.account-dropdown')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Обзор', exact: true })).toHaveCount(1);
});

test('room invite opens the correct tab; cancellation releases a waiting guest', async ({ page, playwright }) => {
  const owner = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    await signup(owner); await signup(page.request);
    const created = await owner.post('/api/rooms/', { data: { name: 'QA cancellation', allowClipboard: true, allowPresetStrategies: true, maxCharactersPerSecond: 1000, stake: 0, isPrivate: true, password: 'pass-test' } });
    const room = await created.json();
    await page.goto(`/#arena/rooms/${room.id}`);
    await expect(page.getByRole('button', { name: 'PvP · Комнаты', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('Пароль комнаты', { exact: true }).fill('pass-test');
    await page.getByRole('dialog').getByRole('button', { name: 'Войти по приглашению', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Код', { exact: true }).fill('function tick(){return {};}');
    await dialog.getByRole('button', { name: /Готов к бою/ }).click();
    await expect(dialog.getByRole('button', { name: 'Ждём соперника…', exact: true })).toBeDisabled();
    expect((await owner.delete(`/api/rooms/${room.id}`)).status()).toBe(204);
    await expect(dialog.getByRole('button', { name: 'Комната закрыта', exact: true })).toBeDisabled();
  } finally { await owner.dispose(); }
});

test('room creation exposes basics first and private password before creation', async ({ page }) => {
  await signup(page.request); await page.goto('/#arena/rooms');
  await page.getByRole('button', { name: '+ Создать комнату', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Новая комната', exact: true });
  await expect(dialog.getByLabel('Название', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Карта', exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Ставка каждого', { exact: true })).toBeHidden();
  await dialog.getByRole('combobox', { name: 'Видимость', exact: true }).selectOption('private');
  await expect(dialog.getByLabel('Пароль комнаты', { exact: false })).toBeVisible();
  await dialog.getByLabel('Название', { exact: true }).fill('QA private UI');
  await expect(dialog.getByRole('button', { name: 'Создать комнату', exact: true })).toBeDisabled();
  await dialog.getByLabel('Пароль комнаты', { exact: false }).fill('safe-password');
  await expect(dialog.getByRole('button', { name: 'Создать комнату', exact: true })).toBeEnabled();
  await dialog.locator('summary', { hasText: 'Дополнительные настройки' }).click();
  await expect(dialog.getByLabel('Ставка каждого', { exact: true })).toBeVisible();
});

test('workshop catalog uses community navigation and saved maps open on arena', async ({ page }) => {
  await signup(page.request);
  const created = await page.request.post('/api/maps/', { data: { name: 'QA playable arena', walls: [] } });
  const map = await created.json();
  await page.goto('/#workshop');
  await page.getByRole('button', { name: /Публикации и каталог/ }).click();
  await expect(page).toHaveURL(/#ugc$/);
  await page.locator('.ugc-tabs').getByRole('button', { name: 'Карты', exact: true }).click();
  const card = page.locator('.map-card').filter({ hasText: 'QA playable arena' });
  await card.getByRole('button', { name: 'Играть на карте', exact: true }).click();
  await expect(page).toHaveURL(/#arena$/);
  expect((await stored(page)).arena.walls).toEqual([]);
  await page.request.delete(`/api/maps/${map.id}`);
});

test('a delayed manual draft cannot overwrite the selected saved strategy', async ({ page }) => {
  await signup(page.request);
  const strategyResponse = await page.request.post('/api/ugc/strategies', { data: { name: 'QA queued strategy', description: '', language: 'javascript', code: 'function tick(){return {leftTrack:1,rightTrack:1};}', tags: [], salePrice: null } });
  const strategy = await strategyResponse.json();
  const created = await page.request.post('/api/rooms/', { data: { name: 'QA ordered drafts', allowClipboard: true, allowPresetStrategies: true, maxCharactersPerSecond: 1000, stake: 0 } });
  const room = await created.json();
  try {
    await page.goto('/#arena/rooms'); await page.getByRole('button', { name: 'Открыть комнату', exact: true }).click();
    let manualStarted;
    const started = new Promise(resolve => { manualStarted = resolve; });
    await page.route(`**/api/rooms/${room.id}/draft`, async route => {
      if (!route.request().postDataJSON().strategyId) { manualStarted(); await new Promise(resolve => setTimeout(resolve, 250)); }
      await route.continue();
    });
    await page.getByRole('dialog').getByLabel('Код', { exact: true }).fill('function tick(){return {};}');
    await started;
    await page.getByRole('button', { name: 'Использовать стратегию', exact: true }).click();
    await expect.poll(async () => (await page.request.get(`/api/rooms/${room.id}`).then(r => r.json())).draft.sourceStrategyId).toBe(strategy.id);
    const result = await page.request.get(`/api/rooms/${room.id}`).then(r => r.json());
    expect(result.draft.code).toBe('function tick(){return {leftTrack:1,rightTrack:1};}');
  } finally { await page.request.delete(`/api/rooms/${room.id}`); }
});

test('room toolbar and icon actions stay above and beside room rows', async ({ page }) => {
  await signup(page.request);
  const created = await page.request.post('/api/rooms/', { data: { name: 'QA room icons', allowClipboard: true, allowPresetStrategies: true, maxCharactersPerSecond: 1000, stake: 0 } });
  const room = await created.json();
  await page.goto('/#arena/rooms');
  const row = page.locator('.my-rooms .room-card');
  const open = row.getByRole('button', { name: 'Открыть комнату', exact: true });
  const remove = row.getByRole('button', { name: 'Удалить комнату', exact: true });
  await expect(open.locator('svg')).toHaveCount(1); await expect(remove.locator('svg')).toHaveCount(1);
  await expect(open).toHaveText(''); await expect(remove).toHaveText('');
  const filter = await page.locator('.rooms-panel > .room-advanced').boundingBox();
  const card = await row.boundingBox(); expect(filter.y).toBeLessThan(card.y);
  const toolbar = await page.getByRole('button', { name: 'Войти по приглашению', exact: true }).boundingBox(); expect(toolbar.y).toBeLessThan(card.y);
  await remove.click(); await expect(row).toHaveCount(0);
  expect((await page.request.get('/api/rooms/mine').then(r => r.json())).some(item => item.id === room.id)).toBe(false);
});

test('light theme covers battle mode in editor and roster dialog', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('botarena-theme', 'light'));
  await arena(page);
  await expect(page.locator('.lab-mode-bar')).toHaveCSS('background-color', 'rgb(242, 247, 251)');
  await expect(page.locator('.tank-tab.active').first()).toHaveCSS('background-color', 'rgb(217, 239, 242)');
  await settings(page).click();
  await expect(page.getByRole('dialog').locator('.lab-mode-control')).toHaveCSS('background-color', 'rgb(242, 247, 251)');
  await expect(page.getByRole('dialog').locator('.lab-mode-control select')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});

for (const width of [1440, 390]) {
  test(`tour highlights real content and stays inside viewport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 780 });
    await page.addInitScript(() => localStorage.setItem('botarena-theme', 'light'));
    await page.goto('/'); await page.getByRole('button', { name: 'Обзор', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /./ });
    for (let index = 0; index < 15; index++) {
      await expect(dialog.locator('small')).toContainText(`ШАГ ${index + 1} ИЗ 15`);
      await expect(page.locator('.tour-highlight-pulse')).toHaveCount(1);
      const bounds = await dialog.boundingBox();
      expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual(781);
      const target = await page.locator('.tour-highlight-pulse').boundingBox(); expect(target.height).toBeGreaterThan(15);
      if (index === 11) await expect(page.locator('.tour-highlight-pulse')).toContainText('Пока нет сохранённых стратегий');
      if (index < 14) await dialog.getByRole('button', { name: 'Далее →', exact: true }).click();
    }
    await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(page.locator('.tour-highlight-pulse')).toHaveCount(0);
  });
}

test('strategy card counters stay grouped beside labels and footer wraps without overflow', async ({ page }) => {
  await signup(page.request);
  await page.request.post('/api/ugc/strategies', { data: { name: 'QA compact', description: 'Short description', language: 'javascript', code: 'function tick(){return {};}', tags: ['test'], salePrice: null } });
  await page.goto('/#ugc'); await page.locator('.ugc-tabs').getByRole('button', { name: 'Мои стратегии', exact: true }).click();
  const card = page.locator('.strategy-card').filter({ hasText: 'QA compact' });
  await expect(card).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const pair of await card.locator('.strategy-card-stats > div').all()) {
      const label = await pair.locator('dt').boundingBox(), value = await pair.locator('dd').boundingBox();
      expect(value.x - label.x - label.width).toBeLessThan(10);
      expect(Math.abs(value.y - label.y)).toBeLessThan(3);
    }
    expect((await card.boundingBox()).height).toBeLessThan(280);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }
});

test('merged mobile header keeps bottom navigation, guest login and account avatar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.locator('.account-login .login-short')).toBeVisible();
  await expect(page.locator('.account-login .login-long')).toBeHidden();
  const navigation = await page.getByRole('navigation', { name: 'Основная навигация' }).boundingBox();
  expect(navigation.y).toBeGreaterThan(760); expect(navigation.y + navigation.height).toBeLessThanOrEqual(845);
  await signup(page.request); await page.reload();
  await expect(page.locator('.profile-fallback')).toBeVisible();
  const avatar = await page.locator('.profile-fallback').boundingBox(); expect(avatar.width).toBeGreaterThan(20);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Меню аккаунта', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Настройки профиля', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Включить светлую тему', exact: true })).toBeVisible();
});

for (const authenticated of [false, true]) {
  test(`campaign success opens next level directly (${authenticated ? 'account' : 'guest'})`, async ({ page }) => {
    if (authenticated) await signup(page.request);
    const tracks = await page.request.get('/api/campaign').then(r => r.json());
    const track = tracks.find(item => item.available && item.levels.some(level => level.id === 'move'));
    const first = track.levels.find(level => level.id === 'move');
    const next = track.levels.find(level => level.order === first.order + 1);
    await page.goto('/#learn');
    await page.locator('.chapter-route').filter({ hasText: track.name }).getByRole('button', { name: `${first.name}: Доступен`, exact: true }).click();
    const nextButton = page.getByRole('button', { name: 'Следующий уровень →', exact: true });
    await expect(nextButton).toHaveCount(0);
    await page.locator('.cm-content').fill('function tick() { return { driveTo: { x: 10, y: 5 } }; }');
    await start(page).click(); await expect(nextButton).toBeVisible({ timeout: 30000 });
    await nextButton.click();
    await expect(page.locator('.editor h1')).toHaveText(next.name);
    expect((await page.locator('.cm-line').allTextContents()).join('\n').trim()).toBe(next.starter.javascript.trim());
    await expect(nextButton).toHaveCount(0);
    await expect(page.locator('.blueprint-canvas')).toHaveCount(0);
    await expect(page.locator('.editor .error-card')).toHaveCount(0);
  });
}

test('campaign completion does not offer a nonexistent next level', async ({ page }) => {
  const tracks = await page.request.get('/api/campaign').then(r => r.json());
  const track = tracks.find(item => item.available && item.levels.some(level => level.id === 'move'));
  const first = track.levels.find(level => level.id === 'move');
  // A one-level catalogue exercises the end-of-track UI with a real match result.
  await page.route('**/api/campaign', route => route.fulfill({ json: [{ ...track, levelCount: 1, levels: [first] }] }));
  await page.goto('/#learn');
  await page.locator('.chapter-route').filter({ hasText: track.name }).getByRole('button', { name: `${first.name}: Доступен`, exact: true }).click();
  await page.locator('.cm-content').fill('function tick() { return { driveTo: { x: 10, y: 5 } }; }');
  await start(page).click();
  await expect(page.locator('.campaign-result')).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Следующий уровень →', exact: true })).toHaveCount(0);
});

for (const width of [1440, 390]) {
  test(`wall collision preview stays under pointer without layout jitter at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await arena(page);
    await page.locator('.lab-arena').scrollIntoViewIfNeeded();
    const point = ([x, y]) => page.locator('.lab-arena').evaluate((svg, [x, y]) => {
      const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM()); return { x: p.x, y: p.y };
    }, [x, y]);
    const begin = await point([5.2, 2.5]), invalid = await point([2.7, 5]), valid = await point([5.2, 2.5]);
    const initial = await page.locator('.lab-arena').boundingBox();
    const bots = (await stored(page)).bots;
    await page.mouse.move(begin.x, begin.y); await page.mouse.down();
    for (let cycle = 0; cycle < 4; cycle++) {
      await page.mouse.move(valid.x, valid.y);
      await page.mouse.move(invalid.x, invalid.y);
      for (let repeat = 0; repeat < 4; repeat++) {
        await page.mouse.move(invalid.x, invalid.y);
        await expect(page.locator('.lab-wall.invalid-placement')).toHaveCount(1);
        await expect(page.locator('.lab-wall.invalid-placement')).toHaveAttribute('y', '4.4');
        const bounds = await page.locator('.lab-arena').boundingBox(); expect(Math.abs(bounds.y - initial.y)).toBeLessThan(1);
        expect((await stored(page)).bots).toEqual(bots);
        await expect(start(page)).toBeDisabled();
      }
    }
    await page.mouse.up();
    await expect(page.locator('.lab-wall.invalid-placement')).toHaveCount(1);
    await drag(page, [2.7, 5], [5.2, 2.5]);
    await expect(page.locator('.invalid-placement')).toHaveCount(0); await expect(start(page)).toBeEnabled();
  });
}

test('workshop has one local library and no duplicate placeholder tabs', async ({ page }) => {
  await page.goto('/#workshop');
  await expect(page.locator('.platform-content .ux-tabs')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Каталог стратегий', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Манёвры', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Карты', exact: true })).toHaveCount(0);
  await expect(page.getByText('В разработке', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /Публикации и каталог/ }).click();
  await expect(page).toHaveURL(/#ugc$/);
  await expect(nav(page, 'Сообщество')).toHaveAttribute('aria-current', 'page');
});

test('reset detaches the saved map instead of overwriting it', async ({ page }) => {
  await signup(page.request);
  const response = await page.request.post('/api/maps/', { data: { name: 'QA original map', walls: [] } });
  const original = await response.json();
  await page.goto('/#ugc'); await page.locator('.ugc-tabs').getByRole('button', { name: 'Карты', exact: true }).click();
  await page.locator('.map-card').filter({ hasText: 'QA original map' }).getByRole('button', { name: 'Редактировать', exact: true }).click();
  await settings(page).click(); await page.getByRole('dialog').getByRole('button', { name: 'Сбросить', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Сохранить карту', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Сохранение карты', exact: true });
  await expect(modal.getByLabel('Название карты', { exact: true })).toHaveValue('Новая арена');
  await modal.getByRole('button', { name: 'Сохранить карту', exact: true }).click(); await expect(modal).toHaveCount(0);
  const maps = await page.request.get('/api/maps/').then(r => r.json());
  expect(maps).toHaveLength(2); expect(maps.find(map => map.id === original.id).walls).toEqual([]);
});

test('wall resizing across a tank leaves a stable rejected draft', async ({ page }) => {
  await arena(page);
  await page.locator('.lab-wall').first().click();
  await page.locator('.lab-arena').scrollIntoViewIfNeeded();
  const handle = await page.locator('.lab-wall-handle-sw').boundingBox();
  const target = await page.locator('.lab-arena').evaluate(svg => {
    const p = new DOMPoint(2, 5).matrixTransform(svg.getScreenCTM()); return { x:p.x, y:p.y };
  });
  const before = await page.locator('.lab-arena').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
  for (let repeat=0; repeat<6; repeat++) {
    await page.mouse.move(target.x, target.y);
    await expect(page.locator('.lab-wall.invalid-placement')).toHaveCount(1);
    const bounds = await page.locator('.lab-arena').boundingBox(); expect(Math.abs(bounds.y - before.y)).toBeLessThan(1);
    expect((await stored(page)).bots[0].position).toEqual({ x:2.2, y:5 });
  }
  await page.mouse.up(); await expect(start(page)).toBeDisabled();
});

test('roster number controls support buttons, typed HP, limits and both themes', async ({ page }) => {
  await arena(page);
  await expect(settings(page)).toHaveText('Участники и параметры боя');
  await expect(page.getByRole('button', { name:'Как управлять ботом', exact:true })).toHaveText('Как управлять ботом');
  await settings(page).click();
  const team = page.locator('.lab-team-player');
  const teamHp = team.getByRole('spinbutton', { name:'HP всей команды', exact:true });
  await team.getByRole('button', { name:'Увеличить: HP всей команды', exact:true }).click();
  await expect(teamHp).toHaveValue('110');
  await team.getByRole('button', { name:'Применить ко всем', exact:true }).click();
  await expect(team.getByRole('spinbutton', { name:'HP', exact:true })).toHaveValue('110');
  expect((await stored(page)).bots[0].hp).toBe(110);
  await teamHp.fill('5000'); await teamHp.blur(); await expect(teamHp).toHaveValue('500');
  await expect(team.getByRole('button', { name:'Увеличить: HP всей команды', exact:true })).toBeDisabled();
  await teamHp.fill(''); await teamHp.blur(); await expect(teamHp).toHaveValue('500');
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme=theme; }, theme);
    await expect(teamHp).toHaveCSS('appearance', 'textfield');
    expect(await page.evaluate(() => document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  }
  await page.getByRole('dialog').getByRole('button', { name:'Сбросить', exact:true }).click();
  await expect(teamHp).toHaveValue('100');
});

test('header account controls share height and alignment in both themes and layouts', async ({ page }) => {
  await signup(page.request); await page.goto('/');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height:900 });
    for (const theme of ['dark','light']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme=theme; }, theme);
      const controls = await Promise.all(['.tour-launch','.profile-balance','.profile-trigger'].map(selector => page.locator(selector).boundingBox()));
      for (const bounds of controls) {
        expect(Math.abs(bounds.height - controls[0].height)).toBeLessThan(1);
        expect(Math.abs(bounds.y - controls[0].y)).toBeLessThan(1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
      await expect(page.locator('.platform-brand')).toHaveAccessibleName(/BotArena/);
      await expect(page.locator('.profile-fallback')).toBeVisible();
    }
  }
});

for (const width of [1440,390]) {
  test(`launch scrolls to Arena after leaving expanded editor at ${width}px`, async ({ page }) => {
    await page.setViewportSize({width,height:844}); await arena(page);
    await page.getByRole('button', {name:'Развернуть редактор',exact:true}).click();
    await start(page).click();
    await expect(page.locator('.replay')).toBeVisible();
    await expect.poll(async () => {
      const target=await page.locator('.replay').boundingBox();
      return target.y;
    }).toBeLessThan(844 * .45);
    await page.locator('.blueprint-canvas').waitFor({state:'attached',timeout:30000});
    await expect.poll(() => page.locator('.replay').evaluate(node => node.getBoundingClientRect().top)).toBeLessThan(844*.45);
    await expect(page.getByRole('button',{name:'План',exact:true})).toHaveAttribute('aria-pressed','true');
  });
}

test('arena has no technical corner labels and finished result is inset and readable', async ({ page }) => {
  await arena(page); await start(page).click();
  await page.locator('.blueprint-canvas').waitFor({state:'attached',timeout:30000});
  await expect(page.locator('.blueprint-hud')).toHaveCount(0);
  const seek = page.getByRole('slider', {name:'Позиция реплея',exact:true});
  await seek.focus(); await seek.press('End');
  const result = page.locator('.match-outcome'); await expect(result).toBeVisible();
  await expect(result.locator('strong')).not.toBeEmpty(); await expect(result.locator('span')).not.toBeEmpty();
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:900});
    for (const theme of ['dark','light']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme=theme; },theme);
      const stage = await page.locator('.blueprint-stage').boundingBox(), badge = await result.boundingBox();
      expect(badge.y-stage.y).toBeGreaterThanOrEqual(17);
      expect(badge.x).toBeGreaterThan(stage.x); expect(badge.x+badge.width).toBeLessThan(stage.x+stage.width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
    }
  }
});
