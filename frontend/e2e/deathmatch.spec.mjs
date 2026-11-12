import { test, expect } from '@playwright/test';
import { deathmatchWalls, deathmatchSpawns, deathmatchStartPositions } from '../src/deathmatchMap.ts';

test('Deathmatch supports six independent participants, persistence and shared winners', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const starts = deathmatchStartPositions(6);
  const bots = starts.map((point, index) => {
    const id = index === 0 ? 'player' : index === 1 ? 'opponent' : `opponent-${index}`;
    return { id, teamId: id, position: point.position, bodyAngle: point.bodyAngle, turretAngle: point.turretAngle,
      speed: 0, hp: 100, maxHp: 100, reloadingTime: 0, canShoot: true, movement: 'tracked' };
  });
  const standings = tick => bots.map((bot, index) => ({ botId: bot.id, score: tick && index < 2 ? 1 : 0,
    kills: tick && index < 2 ? 1 : 0, deaths: tick && index < 2 ? 1 : 0, alive: !tick || index >= 2,
    forfeited: false, respawnSecondsRemaining: tick && index < 2 ? (101 - tick) / 20 : null, waitingForSpace: false }));
  const match = { error: null, logs: [], replay: {
    mode: 'Deathmatch', tickRate: 20, arena: { width: 16, height: 10, walls: deathmatchWalls },
    result: { winnerBotId: null, winnerTeamId: null, winnerBotIds: ['opponent', 'player'],
      reason: 'TimeLimit', durationTicks: 100, standings: standings(100) },
    frames: Array.from({ length: 101 }, (_, tick) => ({ tick,
      bots: bots.map((bot, index) => ({ ...bot, hp: tick && index < 2 ? 0 : 100 })), bullets: [], events: [],
      deathmatch: { scoreLimit: 10, standings: standings(tick) },
    })),
  } };
  let submitted;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let json = [];
    if (path === '/api/auth/session') json = { authenticated: true, needsNickname: false,
      user: { id: 'test', firstName: 'Test', lastName: 'Player', nickname: 'Tester', avatarUrl: null, balance: 0 } };
    else if (path === '/api/strategy-languages') json = ['javascript'];
    else if (path === '/api/behavior-presets') json = [{ id: 'assault', name: 'Штурмовик', description: '', strength: 'standard' }];
    else if (path === '/api/match-jobs') { submitted = route.request().postDataJSON(); json = { id: 'dm-test' }; }
    else if (path === '/api/match-jobs/dm-test') json = { state: 'completed', match };
    await route.fulfill({ json });
  });
  await page.goto('/#arena');
  await page.getByLabel('Режим боя', { exact: true }).selectOption('Deathmatch');
  await page.locator('.lab-roster > summary').click();
  await expect(page.getByLabel('Участников', { exact: true })).toHaveValue('4');
  await page.getByLabel('Участников', { exact: true }).fill('6');
  await expect(page.locator('.lab-bot-card')).toHaveCount(6);
  await page.locator('.lab-bot-card input[type=text]').first().fill('DM pilot');
  await page.reload();
  await expect(page.getByLabel('Режим боя', { exact: true })).toHaveValue('Deathmatch');
  await expect(page.locator('.lab-bot-card')).toHaveCount(6);
  await page.getByRole('button', { name: 'Запустить матч', exact: true }).click();
  const table = page.getByRole('table', { name: 'Таблица Deathmatch' });
  await expect(table).toBeVisible();
  expect(submitted.customMatch.mode).toBe('Deathmatch');
  expect(submitted.customMatch.maxTicks).toBe(2400);
  expect(submitted.customMatch.spawns).toHaveLength(6);
  expect(new Set(submitted.customMatch.spawns.map(bot => bot.teamId)).size).toBe(6);
  expect(submitted.customMatch.respawnPoints).toEqual(deathmatchSpawns);
  const slider = page.getByRole('slider', { name: 'Позиция реплея', exact: true });
  await slider.fill(await slider.getAttribute('max'));
  await expect(table.locator('tbody tr')).toHaveCount(6);
  await expect(table.locator('tr[data-winner]')).toHaveCount(2);
  await expect(table).toContainText('DM pilot');
  await expect(table).toContainText('Возрождение через');
  await expect(page.locator('.outcome')).toContainText('Совместное первое место');
  expect(errors).toEqual([]);
});
