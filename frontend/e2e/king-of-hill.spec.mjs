import { test, expect } from '@playwright/test';

test('King of the Hill setup, persistence, request and replay scores', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const bot = (id, teamId, x, angle = 0) => ({ id, teamId, position: { x, y: 5 }, bodyAngle: angle,
    turretAngle: angle, speed: 0, hp: 100, maxHp: 100, reloadingTime: 0, canShoot: true, movement: 'tracked' });
  const arena = { width: 16, height: 10, walls: [] };
  const zone = { center: { x: 8, y: 5 }, radius: 1.5 };
  const match = { replay: {
    mode: 'KingOfHill', tickRate: 20, arena,
    result: { winnerBotId: 'player', winnerTeamId: 'player', reason: 'TimeLimit', durationTicks: 20,
      scores: [{ teamId: 'player', score: 1 }, { teamId: 'opponent', score: 0 }] },
    frames: Array.from({ length: 21 }, (_, tick) => ({ tick,
      bots: [bot('player', 'player', tick ? 6.51 : 6.49), bot('opponent', 'opponent', 13.8, Math.PI)],
      bullets: [], events: [], kingOfHill: { zone, scoreLimit: 30, contested: false,
        controllingTeamId: tick ? 'player' : null, respawns: [],
        scores: [{ teamId: 'player', score: tick / 20 }, { teamId: 'opponent', score: 0 }] },
    })),
  }, error: null, logs: [] };
  let submitted;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let json = [];
    if (path === '/api/auth/session') json = { authenticated: true, needsNickname: false,
      user: { id: 'test', firstName: 'Test', lastName: 'Player', nickname: 'Tester', avatarUrl: null, balance: 0 } };
    else if (path === '/api/strategy-languages') json = ['javascript'];
    else if (path === '/api/behavior-presets') json = [{ id: 'assault', name: 'Штурмовик', description: '', strength: 'standard' }];
    else if (path === '/api/match-jobs') { submitted = route.request().postDataJSON(); json = { id: 'hill-test' }; }
    else if (path === '/api/match-jobs/hill-test') json = { state: 'completed', match };
    await route.fulfill({ json });
  });
  await page.goto('/#arena');
  await page.getByLabel('Режим боя', { exact: true }).selectOption('KingOfHill');
  await expect(page.getByText('Зона контроля', { exact: true })).toBeVisible();
  await page.locator('.lab-roster > summary').click();
  const counts = page.locator('.lab-counts input[type=number]');
  await counts.first().fill('2');
  await expect(counts.nth(1)).toHaveValue('2');
  await expect(page.locator('.lab-bot-card')).toHaveCount(4);
  await page.reload();
  await expect(page.getByLabel('Режим боя', { exact: true })).toHaveValue('KingOfHill');
  // Return to 1v1 for the replay fixture.
  await page.locator('.lab-roster > summary').click();
  await counts.first().fill('1');
  await page.getByRole('button', { name: 'Запустить матч', exact: true }).click();
  await expect(page.getByLabel('Счёт Царя горы')).toBeVisible();
  expect(submitted.customMatch.mode).toBe('KingOfHill');
  expect(submitted.customMatch.maxTicks).toBe(2400);
  expect(submitted.customMatch.controlZone).toEqual(zone);
  expect(submitted.customMatch.spawns).toHaveLength(2);
  const slider = page.getByRole('slider', { name: 'Позиция реплея', exact: true });
  await slider.fill(await slider.getAttribute('max'));
  await expect(page.getByLabel('Счёт Царя горы')).toContainText('1.0 / 30');
  await expect(page.getByLabel('Счёт Царя горы')).toContainText('Вы удерживаете зону');
  expect(errors).toEqual([]);
});
