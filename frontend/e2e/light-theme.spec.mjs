import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function signup(request) {
  const login = `light_${randomUUID().replaceAll('-', '').slice(0, 15)}`;
  const response = await request.post('/api/auth/register', { data: { login, nickname: login, password: `${randomUUID()}Aa1!`, firstName: 'Theme', lastName: 'QA' } });
  expect(response.status()).toBe(200);
  return response.json();
}
async function open(page, route) {
  // A document navigation is intentional: hash-only navigation is managed by React.
  await page.goto(`/?theme-audit=${randomUUID()}#${route}`);
  await expect(page.locator('.auth-loading')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByText('Загружаем раздел…', { exact: true })).toHaveCount(0);
  await expect(page.locator('.learning-loading')).toHaveCount(0);
}

// Check the rendered result, including pseudo-elements and gradients, rather than
// mirroring individual CSS declarations. Deliberately dark provider logos are branding.
async function lightSurfaces(scope) {
  const dark = await scope.evaluate(root => {
    const darkColour = value => {
      const n = value.match(/[\d.]+/g)?.map(Number);
      return n?.length >= 3 && (n[3] ?? 1) > .5 && Math.max(...n.slice(0, 3)) < 115;
    };
    return [root, ...root.querySelectorAll('*')].flatMap(el => {
      if (!el.getBoundingClientRect().width || !el.getBoundingClientRect().height || getComputedStyle(el).visibility === 'hidden' || el.matches('.oauth-login b')) return [];
      return ['', '::before', '::after'].flatMap(pseudo => {
        const style = getComputedStyle(el, pseudo);
        if (pseudo && ['none', 'normal'].includes(style.content)) return [];
        const colours = [style.backgroundColor, ...(style.backgroundImage.match(/rgba?\([^)]+\)/g) ?? [])];
        return colours.some(darkColour) ? [`${el.tagName}.${el.getAttribute('class') ?? ''}${pseudo}: ${colours.join(' ')} (${el.textContent?.trim().slice(0, 40)})`] : [];
      });
    });
  });
  expect(dark, 'Unexpected dark light-theme surfaces').toEqual([]);
}
async function states(scope) {
  await lightSurfaces(scope);
  await scope.page().keyboard.press('Tab'); // establish keyboard modality
  const keyboardFocus = await scope.page().evaluate(() => {
    const el = document.activeElement;
    return el?.matches(':focus-visible') ? getComputedStyle(el).outlineStyle : null;
  });
  if (keyboardFocus !== null) expect(keyboardFocus).not.toBe('none');
  const controls = scope.locator('button:visible, a:visible, input:visible, select:visible, textarea:visible, summary:visible, [tabindex="0"]:visible');
  for (let i = 0; i < await controls.count(); i++) {
    const control = controls.nth(i);
    if (!await control.isEnabled()) continue;
    await control.hover();
    await lightSurfaces(control);
    await control.focus();
    await lightSurfaces(control);
  }
}
async function expanded(page) {
  await page.locator('details').evaluateAll(els => els.forEach(el => el.open = true));
}
async function closeDialog(page) { await page.locator('.arena-modal-close').click(); }

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('botarena-theme', 'light'); localStorage.setItem('botarena-first-run-v2', 'done'); });
});

for (const width of [1440, 390]) {
  test(`light theme page sweep covers guest and account routes at ${width}px`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 950 });
    for (const account of [false, true]) {
      if (account) await signup(page.request);
      for (const route of ['home', 'learn', 'learn/pve', 'arena', 'arena/rooms', 'workshop', 'ugc']) {
        await open(page, route); await expanded(page);
        await states(page.locator('body'));
      }
      await open(page, 'ugc');
      for (const name of ['Манёвры', 'Мои стратегии', 'Друзья', 'Комнаты', 'Карты']) {
        await page.locator('.ugc-tabs').getByRole('button', { name, exact: true }).click();
        await expanded(page); await states(page.locator('.ugc-hub'));
      }
    }
  });
}

test('light theme dialogs, room controls, account hover and tour stay light', async ({ page }, info) => {
  test.setTimeout(120000);
  await open(page, 'home');
  await page.locator('.account-login').click();
  await states(page.locator('.auth-dialog'));
  await page.getByRole('button', { name: 'Регистрация', exact: true }).click();
  await states(page.locator('.auth-dialog'));
  await page.locator('.auth-dialog .ugc-close').click();
  await signup(page.request); await open(page, 'arena');
  for (const name of ['Участники и параметры боя', 'Как управлять ботом', 'Сохранить карту']) {
    await page.getByRole('button', { name, exact: true }).click();
    await states(page.locator('dialog[open]'));
    await closeDialog(page);
  }
  await page.getByRole('button', { name: 'Меню аккаунта', exact: true }).click();
  await states(page.locator('.account-dropdown'));
  await page.getByRole('button', { name: 'Настройки профиля', exact: true }).click();
  await states(page.locator('.profile-settings'));
  await page.locator('.profile-settings .ugc-close').click();
  await open(page, 'arena/rooms');
  await page.getByRole('button', { name: '+ Создать комнату', exact: true }).click();
  await page.getByRole('combobox', { name: 'Видимость', exact: true }).selectOption('private');
  await expanded(page); await states(page.locator('dialog[open]')); await closeDialog(page);
  await page.getByRole('button', { name: 'Войти по приглашению', exact: true }).click();
  await states(page.locator('dialog[open]')); await closeDialog(page);
  await page.getByRole('button', { name: 'Обзор', exact: true }).click();
  await states(page.locator('.tour-dialog'));
  await page.screenshot({ path: info.outputPath('light-tour.png') });
});

test('light theme community details, editor, publication and friend duel', async ({ page, playwright }, info) => {
  test.setTimeout(120000);
  await signup(page.request);
  const other = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
  let strategy, paidStrategy, map;
  try {
    const friend = await signup(other);
    const invite = await page.request.post(`/api/friends/${friend.id}`).then(r => r.json());
    expect((await other.post(`/api/friends/${invite.id}/accept`)).ok()).toBe(true);
    strategy = await page.request.post('/api/ugc/strategies', { data: { name: 'Theme audit', description: 'Code and dialog surfaces', language: 'javascript', code: 'function tick(){return {};}', tags: ['qa'], salePrice: null } }).then(r => r.json());
    paidStrategy = await other.post('/api/ugc/strategies', { data: { name: `Paid theme ${randomUUID()}`, description: 'Locked code preview', language: 'javascript', code: 'function tick(){return {};}', tags: [], salePrice: null } }).then(r => r.json());
    expect((await other.post(`/api/ugc/strategies/${paidStrategy.id}/publish`, { data: { isPaid: true, price: 10 } })).ok()).toBe(true);
    map = await page.request.post('/api/maps/', { data: { name: 'Theme preview', walls: [{ x: 6, y: 3, width: 1, height: 1 }] } }).then(r => r.json());
    await open(page, 'ugc');
    await page.locator('.ugc-tabs').getByRole('button', { name: 'Мои стратегии', exact: true }).click();
    await page.getByRole('button', { name: 'Открыть стратегию «Theme audit»', exact: true }).click();
    await states(page.locator('.ugc-modal')); await expect(page.locator('.ugc-modal pre')).toBeVisible();
    await page.screenshot({ path: info.outputPath('light-strategy-detail.png') });
    await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
    const publication = page.locator('.ugc-modal').last();
    await publication.getByLabel('Платная стратегия', { exact: true }).check();
    await states(publication);
    // Close publication and detail without publishing test content into the catalog.
    await publication.locator('.ugc-close').click();
    await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
    await states(page.locator('.ugc-editor'));
    await page.locator('.ugc-editor .ugc-close').click();
    await page.locator('.ugc-tabs').getByRole('button', { name: 'Друзья', exact: true }).click();
    await states(page.locator('.friends-panel'));
    await page.getByRole('button', { name: 'Сразиться', exact: true }).click();
    await states(page.locator('.friend-battle'));
    await page.screenshot({ path: info.outputPath('light-duel.png') });
    await page.locator('.friend-battle .ugc-close').click();
    await page.locator('.ugc-tabs').getByRole('button', { name: 'Маркетплейс', exact: true }).click();
    await page.locator('.ugc-toolbar input').fill(paidStrategy.name);
    await page.getByRole('button', { name: `Открыть стратегию «${paidStrategy.name}»`, exact: true }).click();
    await expect(page.locator('.paid-code-lock')).toBeVisible();
    await states(page.locator('.ugc-modal'));
    await page.locator('.ugc-modal .ugc-close').click();
    await page.locator('.ugc-tabs').getByRole('button', { name: 'Карты', exact: true }).click();
    await expect(page.locator('.map-preview')).toBeVisible();
    await expect(page.locator('.map-preview rect').nth(1)).toHaveCSS('fill', 'rgb(193, 211, 223)');
    await states(page.locator('.map-card'));
  } finally {
    if (strategy?.id) await page.request.delete(`/api/ugc/strategies/${strategy.id}`);
    if (paidStrategy?.id) await other.delete(`/api/ugc/strategies/${paidStrategy.id}`);
    if (map?.id) await page.request.delete(`/api/maps/${map.id}`);
    const friends = await page.request.get('/api/friends/').then(r => r.json());
    for (const friend of friends) await page.request.delete(`/api/friends/${friend.id}`);
    await other.dispose();
  }
});

test('light theme PvE hints, retry, success and live theme changes', async ({ page }, info) => {
  await signup(page.request);
  await open(page, 'learn/pve');
  await page.locator('.level-node:enabled').first().click();
  const workspace = page.locator('.pve-workspace');
  await page.getByRole('button', { name: 'Показать подсказку', exact: true }).click();
  await states(workspace.locator('.editor'));
  await page.locator('.cm-content').fill('function tick(){return {};}');
  await page.getByRole('button', { name: 'Запустить матч', exact: true }).click();
  await expect(page.locator('.pve-retry')).toBeVisible({ timeout: 30000 });
  await lightSurfaces(workspace);
  await page.getByRole('button', { name: 'Вставить правильный код', exact: true }).click();
  await page.getByRole('button', { name: 'Запустить матч', exact: true }).click();
  await expect(page.locator('.pve-attempt-result.success-card')).toBeVisible({ timeout: 30000 });
  await lightSurfaces(workspace);
  const code = await page.locator('.cm-content').textContent();
  await page.getByRole('button', { name: 'Меню аккаунта', exact: true }).click();
  await page.getByRole('button', { name: 'Включить тёмную тему', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Включить светлую тему', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Меню аккаунта', exact: true }).click();
  await expect(page.locator('.cm-content')).toHaveText(code);
  await lightSurfaces(workspace);
  await page.screenshot({ path: info.outputPath('light-pve-success.png') });
});

test('light theme real script errors, logs and expanded replay tools', async ({ page }, info) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    // Canvas textures are invisible to CSS assertions. Observe actual label paints.
    const fillRect = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function(x, y, w, h) {
      if ((w === 252 && h === 60) || (w === 376 && h === 88)) {
        window.themeLabelPaints ??= {};
        window.themeLabelPaints[`${w}x${h}`] = this.fillStyle;
      }
      return fillRect.call(this, x, y, w, h);
    };
  });
  await open(page, 'arena');
  await page.locator('.cm-content').fill('function tick(){ console.log("Theme audit"); throw new Error("Theme error"); }');
  await page.getByRole('button', { name: 'Запустить матч', exact: true }).click();
  await expect(page.locator('.error-card')).toBeVisible({ timeout: 30000 });
  await expanded(page); await states(page.locator('.editor'));
  await page.screenshot({ path: info.outputPath('light-error.png') });
  await page.locator('.cm-content').fill('function tick(){ console.log("Theme audit"); return {}; }');
  await page.getByRole('button', { name: 'Запустить матч', exact: true }).click();
  await expect(page.locator('.blueprint-canvas')).toBeVisible({ timeout: 30000 });
  await expanded(page); await expect(page.locator('.debug-log li').first()).toBeVisible();
  await states(page.locator('.editor')); await states(page.locator('.replay'));
  for (const name of ['Кино', 'Разрез', 'План', 'Сверху', 'Восприятие', 'Башня времени']) {
    await page.getByRole('button', { name, exact: true }).click(); await lightSurfaces(page.locator('.replay'));
  }
  for (const theme of ['dark', 'light']) {
    await page.getByRole('button', { name: theme === 'dark' ? 'Включить тёмную тему' : 'Включить светлую тему', exact: true }).click();
    await expect.poll(() => page.evaluate(() => Object.values(window.themeLabelPaints ?? {}))).toEqual([
      theme === 'light' ? '#f4f9fc' : 'rgba(3, 18, 29, 0.88)',
      theme === 'light' ? '#f4f9fc' : 'rgba(3, 18, 29, 0.88)',
    ]);
  }
  await page.screenshot({ path: info.outputPath('light-replay.png') });
});

test('guest sign-in remains above an open community editor after a real 401', async ({ page }) => {
  await open(page, 'ugc');
  await page.getByRole('button', { name: '+ Новая стратегия', exact: true }).click();
  const editor = page.locator('.ugc-editor');
  await editor.getByLabel('Название', { exact: true }).fill('Guest theme draft');
  await editor.getByRole('button', { name: 'Сохранить стратегию', exact: true }).click();
  const feedback = page.locator('.auth-feedback');
  await expect(feedback).toBeVisible();
  await lightSurfaces(feedback);
  await feedback.getByRole('button', { name: 'Войти / Регистрация', exact: true }).click();
  await expect(page.locator('.auth-dialog')).toBeVisible();
  // A real hover/click must reach the auth form, not the community backdrop.
  await states(page.locator('.auth-dialog'));
  await page.locator('.auth-dialog').getByLabel('Логин', { exact: true }).click();
  await page.locator('.auth-dialog .ugc-close').click();
  await expect(editor.getByLabel('Название', { exact: true })).toHaveValue('Guest theme draft');
});
