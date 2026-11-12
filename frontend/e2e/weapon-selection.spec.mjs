import { test, expect } from '@playwright/test';
import { defaultLabSetup } from '../src/labDraft.ts';

test('weapon selection migrates old drafts, survives roster changes and reaches the replay', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const legacy = defaultLabSetup();
  for (const bot of legacy.bots) delete bot.weapon;
  legacy.bots[0].code.javascript = 'function tick() { return {}; } // keep my code';
  await page.addInitScript(setup => {
    if (!localStorage.getItem('botarena.labSetup.v1')) localStorage.setItem('botarena.labSetup.v1', JSON.stringify(setup));
  }, legacy);
  let submitted;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let json = [];
    if (path === '/api/auth/session') json = { authenticated: true, needsNickname: false,
      user: { id: 'test', firstName: 'Test', lastName: 'Player', nickname: 'Tester', avatarUrl: null, balance: 0 } };
    else if (path === '/api/strategy-languages') json = ['javascript', 'python'];
    else if (path === '/api/behavior-presets') json = [
      { id: 'assault', name: 'Штурмовик', description: '', strength: 'standard' },
      { id: 'blind-afraid', name: 'Слепой', description: '', strength: 'weak' },
    ];
    else if (path === '/api/match-jobs') { submitted = route.request().postDataJSON(); json = { id: 'weapons' }; }
    else if (path === '/api/match-jobs/weapons') {
      const bots = submitted.customMatch.spawns.map(spawn => ({ ...spawn, position: { x: spawn.x, y: spawn.y },
        hp: 100, maxHp: 100, speed: 0, reloadingTime: 0, canShoot: true }));
      const standings = bots.map(bot => ({ botId: bot.id, score: 0, kills: 0, deaths: 0, alive: true,
        forfeited: false, respawnSecondsRemaining: null, waitingForSpace: false }));
      json = { state: 'completed', match: { error: null, logs: [], replay: {
        mode: 'Deathmatch', tickRate: 20, arena: submitted.customMatch.arena,
        result: { winnerBotId: null, reason: 'TimeLimit', durationTicks: 40, winnerBotIds: bots.map(bot => bot.id), standings },
        frames: Array.from({ length: 41 }, (_, tick) => ({ tick, bots, bullets: [], events: [], deathmatch: { scoreLimit: 10, standings } })),
      } } };
    }
    await route.fulfill({ json });
  });
  await page.goto('/#arena');
  await page.locator('.lab-roster > summary').click();
  const cards = page.locator('.lab-bot-card');
  await expect(cards.first().getByRole('combobox', { name: 'Оружие', exact: true })).toHaveValue('Cannon');
  await cards.first().getByRole('combobox', { name: 'Оружие', exact: true }).selectOption('Mortar');
  await cards.nth(1).getByRole('combobox', { name: 'Оружие', exact: true }).selectOption('Gauss');
  await expect(page.locator('.cm-content')).toContainText('keep my code');
  await page.getByLabel('Режим боя', { exact: true }).selectOption('KingOfHill');
  await expect(cards.first().getByRole('combobox', { name: 'Оружие', exact: true })).toHaveValue('Mortar');
  await expect(cards.nth(1).getByRole('combobox', { name: 'Оружие', exact: true })).toHaveValue('Gauss');
  await page.getByLabel('Режим боя', { exact: true }).selectOption('Deathmatch');
  await page.getByLabel('Участников', { exact: true }).fill('6');
  await expect(cards).toHaveCount(6);
  await expect(cards.nth(5).getByRole('combobox', { name: 'Оружие', exact: true })).toHaveValue('Cannon');
  await page.reload();
  await page.locator('.lab-roster > summary').click();
  await expect(cards.first().getByRole('combobox', { name: 'Оружие', exact: true })).toHaveValue('Mortar');
  await expect(cards.nth(1).getByRole('combobox', { name: 'Оружие', exact: true })).toHaveValue('Gauss');
  await expect(page.locator('.cm-content')).toContainText('keep my code');
  await page.getByRole('combobox', { name: 'Язык стратегии', exact: true }).selectOption('python');
  await cards.first().getByRole('button', { name: 'Загрузить пример стрельбы' }).click();
  await expect(page.locator('.cm-content')).toContainText('action["targetPoint"]');
  await page.getByRole('combobox', { name: 'Язык стратегии', exact: true }).selectOption('javascript');
  await cards.first().getByRole('button', { name: 'Загрузить пример стрельбы' }).click();
  await expect(page.locator('.cm-content')).toContainText('action.targetPoint');
  await page.getByRole('button', { name: 'Запустить матч', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Таблица Deathmatch' })).toBeVisible();
  expect(submitted.customMatch.spawns.map(bot => bot.weapon)).toEqual(['Mortar', 'Gauss', 'Cannon', 'Cannon', 'Cannon', 'Cannon']);
  expect(submitted.customMatch.loadouts[0].code).toContain('action.targetPoint');
  await expect(page.locator('.health')).toContainText('Миномёт');
  await expect(page.locator('.health')).toContainText('Гаусс-пушка');
  expect(errors).toEqual([]);
});
