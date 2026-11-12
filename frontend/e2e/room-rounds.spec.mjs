import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const idle = 'function tick(){return {};}';
const shoot = 'function tick({self,enemy}){return enemy?{aimAt:enemy.position,shoot:true}:{};}';
async function signup(request) {
  const login = `round_${randomUUID().replaceAll('-', '').slice(0, 15)}`;
  const response = await request.post('/api/auth/register', { data: { login, nickname: login, password: `${randomUUID()}Aa1!`, firstName: 'Round', lastName: 'QA' } });
  expect(response.status()).toBe(200); return response.json();
}
async function create(request, stake = 10) {
  const mapResponse = await request.post('/api/maps/', { data: { name: 'Round arena', walls: [] } });
  expect(mapResponse.status()).toBe(201); const map = await mapResponse.json();
  const response = await request.post('/api/rooms/', { data: { name: 'Reusable lobby', allowClipboard: true, allowPresetStrategies: true, maxCharactersPerSecond: 1000, stake, mapId: map.id, isPrivate: true, password: 'round-pass' } });
  expect(response.status()).toBe(201); return { room: await response.json(), map };
}
async function details(request, id) { const r = await request.get(`/api/rooms/${id}`); expect(r.status()).toBe(200); return r.json(); }
async function balance(request) { return (await request.get('/api/auth/session').then(r => r.json())).user.balance; }
async function draft(request, id, roundNumber, code) { return request.put(`/api/rooms/${id}/draft`, { data: { code, language: 'javascript', roundNumber } }); }
async function ready(request, id, roundNumber) { return request.post(`/api/rooms/${id}/ready`, { data: { roundNumber } }); }

test('lobby survives repeated rounds with fresh readiness, stale-request protection and one payment per round', async ({ playwright }) => {
  const options = { baseURL: test.info().project.use.baseURL };
  const owner = await playwright.request.newContext(options), guest = await playwright.request.newContext(options), stranger = await playwright.request.newContext(options);
  let room, map;
  try {
    await signup(owner); await signup(guest); await signup(stranger);
    ({ room, map } = await create(owner));
    expect((await guest.post(`/api/rooms/${room.id}/join`, { data: { password: 'round-pass' } })).status()).toBe(200);
    for (const round of [1, 2]) {
      expect((await draft(owner, room.id, round, shoot)).status()).toBe(200);
      expect((await draft(guest, room.id, round, idle)).status()).toBe(200);
      const waiting = await ready(owner, room.id, round); expect(waiting.status()).toBe(200); expect((await waiting.json()).waiting).toBe(true);
      // Repeated clicks by the same user cannot act as the second player's consent.
      expect((await ready(owner, room.id, round)).status()).toBe(200);
      expect((await details(guest, room.id)).readyCount).toBe(1);
      const results = await Promise.all([ready(guest, room.id, round), ready(guest, room.id, round)]);
      expect(results.map(r => r.status()).sort()).toEqual([200, 409]);
      const result = await results.find(r => r.status() === 200).json();
      expect(result.waiting).toBe(false); expect(result.roundNumber).toBe(round);
      expect(result.match.replay.result.winnerBotId).toBe('player');
      for (const request of [owner, guest]) {
        const state = await details(request, room.id);
        expect(state.room.status).toBe('Open'); expect(state.room.roundNumber).toBe(round + 1);
        expect(state.room.isPrivate).toBe(true); expect(state.room.arena.walls).toEqual([]);
        expect(state.room.mapName).toBe(map.name); expect(state.room.occupied).toBe(true);
        expect(state.draft.isReady).toBe(false); expect(state.readyCount).toBe(0);
        expect(state.matchRoundNumber).toBe(round);
        const unchanged = await request.get(`/api/rooms/${room.id}?afterMatchRoundNumber=${round}`).then(r => r.json());
        expect(unchanged.match).toBeNull(); expect(unchanged.matchRoundNumber).toBe(round);
        expect((await ready(request, room.id, round)).status()).toBe(409);
        expect((await draft(request, room.id, round, 'function tick(){throw 1;}')).status()).toBe(409);
        expect((await request.get('/api/rooms/mine').then(r => r.json())).some(r => r.id === room.id)).toBe(true);
      }
      expect((await details(owner, room.id)).draft.code).toBe(shoot);
      expect((await details(guest, room.id)).draft.code).toBe(idle);
      expect(await balance(owner)).toBe(1000 + round * 10); expect(await balance(guest)).toBe(1000 - round * 10);
      expect((await stranger.get(`/api/rooms/${room.id}`)).status()).toBe(404);
      expect((await ready(stranger, room.id, round + 1)).status()).toBe(403);
    }
    const another = await owner.post('/api/rooms/', { data: { name: 'Duplicate', allowClipboard: true, allowPresetStrategies: true, maxCharactersPerSecond: 1000, stake: 0 } });
    expect(another.status()).toBe(409);
  } finally {
    if (room) await owner.delete(`/api/rooms/${room.id}`);
    if (map) await owner.delete(`/api/maps/${map.id}`);
    await owner.dispose(); await guest.dispose(); await stranger.dispose();
  }
});

test('insufficient funds in a rematch roll back stakes and readiness without closing the lobby', async ({ playwright }) => {
  const options = { baseURL: test.info().project.use.baseURL };
  const owner = await playwright.request.newContext(options), guest = await playwright.request.newContext(options);
  let room, map;
  try {
    await signup(owner); await signup(guest); ({ room, map } = await create(owner, 1000));
    await guest.post(`/api/rooms/${room.id}/join`, { data: { password: 'round-pass' } });
    await draft(owner, room.id, 1, shoot); await draft(guest, room.id, 1, idle);
    await ready(owner, room.id, 1); expect((await ready(guest, room.id, 1)).status()).toBe(200);
    expect(await balance(owner)).toBe(2000); expect(await balance(guest)).toBe(0);
    await ready(owner, room.id, 2);
    expect((await ready(guest, room.id, 2)).status()).toBe(400);
    expect(await balance(owner)).toBe(2000); expect(await balance(guest)).toBe(0);
    const state = await details(guest, room.id);
    expect(state.room.status).toBe('Open'); expect(state.room.roundNumber).toBe(2);
    expect(state.readyCount).toBe(1); expect(state.draft.isReady).toBe(false);
  } finally {
    if (room) await owner.delete(`/api/rooms/${room.id}`);
    if (map) await owner.delete(`/api/maps/${map.id}`);
    await owner.dispose(); await guest.dispose();
  }
});

test('two browsers can edit and play again without replay looping or losing the lobby on reload', async ({ browser }, info) => {
  test.setTimeout(90000);
  const options = { baseURL: test.info().project.use.baseURL };
  const a = await browser.newContext(options), b = await browser.newContext(options);
  const owner = a.request, guest = b.request;
  let room, map;
  try {
    await signup(owner); await signup(guest); ({ room, map } = await create(owner));
    await guest.post(`/api/rooms/${room.id}/join`, { data: { password: 'round-pass' } });
    const pages = [await a.newPage(), await b.newPage()];
    for (const page of pages) {
      await page.addInitScript(() => { localStorage.setItem('botarena-theme', 'light'); localStorage.setItem('botarena-first-run-v2', 'done'); });
      await page.goto(`${test.info().project.use.baseURL}/#arena/rooms`);
      await page.getByRole('button', { name: 'Открыть комнату', exact: true }).click();
    }
    for (const round of [1, 2]) {
      if (round === 2) {
        let rejected = false;
        await pages[0].route(`**/api/rooms/${room.id}/draft`, route => {
          if (!rejected) {
            rejected = true;
            return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Раунд уже изменился.' }) });
          }
          return route.continue();
        });
      }
      for (const [i, page] of pages.entries()) {
        const code = (round === 1 ? i === 0 : i === 1) ? shoot : idle;
        await page.locator('.room-code').fill(code);
      }
      await pages[0].getByRole('button', { name: new RegExp(`Готов к раунду ${round}`) }).click();
      await expect(pages[0].getByRole('button', { name: 'Ждём готовности соперника…', exact: true })).toBeDisabled();
      await pages[1].getByRole('button', { name: new RegExp(`Готов к раунду ${round}`) }).click();
      for (const page of pages) {
        await expect(page.locator('.room-round-status strong')).toHaveText(`Раунд ${round + 1}`, { timeout: 30000 });
        await expect(page.getByRole('button', { name: new RegExp(`Готов к раунду ${round + 1}`) })).toBeEnabled();
        await expect(page.locator('.room-code')).toBeEnabled();
        await expect(page.locator('.blueprint-canvas')).toHaveCount(0);
      }
      const replayButton = pages[0].getByRole('button', { name: `Посмотреть запись раунда ${round}`, exact: true });
      await expect(pages[0].locator('.room-last-match > strong')).toHaveText(`Раунд ${round}: ${round === 1 ? 'Победа' : 'Поражение'}`);
      await replayButton.click(); await expect(pages[0].locator('.blueprint-canvas')).toBeVisible();
      await pages[0].locator('.blueprint-canvas').evaluate(el => el.dataset.qaStable = 'yes');
      await expect.poll(async () => (await details(owner, room.id)).room.roundNumber).toBe(round + 1);
      await pages[0].waitForTimeout(1700); // allow a real polling response with the same archived result
      await expect(pages[0].locator('.blueprint-canvas')).toHaveAttribute('data-qa-stable', 'yes');
      await pages[0].getByRole('button', { name: 'Скрыть запись', exact: true }).click();
    }
    expect((await details(owner, room.id)).match.replay.result.winnerBotId).toBe('opponent');
    await pages[0].reload(); await pages[0].getByRole('button', { name: 'Открыть комнату', exact: true }).click();
    await expect(pages[0].locator('.room-code')).toHaveValue(idle);
    await expect(pages[0].locator('.room-round-status strong')).toHaveText('Раунд 3');
    await expect(pages[0].getByRole('button', { name: 'Посмотреть запись раунда 2', exact: true })).toBeVisible();
    await pages[0].screenshot({ path: info.outputPath('pvp-next-round-light.png') });
    let release; const held = new Promise(resolve => release = resolve); let reached;
    const intercepted = new Promise(resolve => reached = resolve);
    await pages[0].route(`**/api/rooms/${room.id}?afterMatchRoundNumber=2`, async route => {
      const response = await route.fetch(); reached(); await held; await route.fulfill({ response });
    });
    await intercepted;
    await pages[0].getByRole('button', { name: 'Закрыть окно', exact: true }).click();
    release(); await expect(pages[0].locator('dialog[open]')).toHaveCount(0);
  } finally {
    if (room) await owner.delete(`/api/rooms/${room.id}`);
    if (map) await owner.delete(`/api/maps/${map.id}`);
    await a.close(); await b.close();
  }
});
