import { test } from '@playwright/test';
import assert from 'node:assert/strict';
test('unified UX: campaign, strategy library, replay tools and mobile', async ({ page }) => {
await page.setViewportSize({width:1440,height:1000});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const nav = name => page.getByRole('navigation').getByRole('button',{name,exact:true});
await page.goto('/');
const tracks = await page.request.get('/api/campaign').then(r => r.json());
const levelCount = tracks.flatMap(t => t.levels).length;
await page.getByText(`0 / ${levelCount}`,{exact:true}).waitFor();
await page.getByRole('button',{name:'Настройки',exact:true}).click();
await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');
await page.getByRole('dialog').waitFor({state:'detached'});
await nav('Обучение').click();
assert.equal(await page.locator('.lesson-stop').count(),levelCount);
await page.locator('.lesson-stop.available button').first().click();
await page.locator('.cm-content').waitFor();
await page.getByRole('button',{name:'Запустить матч',exact:true}).click();
await page.locator('.blueprint-canvas').waitFor({state:'attached',timeout:30000});
console.log('Campaign real calculation passed');
await nav('Арена').click();
await page.locator('.cm-content').waitFor();
await page.locator('.cm-content').click();
await page.keyboard.press('Meta+End');
await page.keyboard.type('\n// continuous edit');
assert.match(await page.locator('.cm-content').innerText(),/continuous edit/);
await page.getByLabel('Модель движения',{exact:true}).selectOption('omni');
await page.getByRole('button',{name:'Загрузить пример для этого шасси'}).click();
await page.getByRole('button',{name:'Развернуть редактор',exact:true}).click();
assert.equal(await page.locator('.replay').isVisible(),false);
await page.getByRole('button',{name:'Свернуть редактор',exact:true}).click();
await page.getByLabel('Название стратегии',{exact:true}).fill('UX test omni');
await page.getByRole('button',{name:'Сохранить стратегию',exact:true}).click();
await nav('Мастерская').click();
await page.getByRole('heading',{name:'UX test omni',exact:true}).waitFor();
await page.reload();await nav('Мастерская').click();
await page.getByRole('button',{name:'Открыть на арене',exact:true}).click();
assert.equal(await page.getByLabel('Модель движения',{exact:true}).inputValue(),'omni');
await page.getByRole('button',{name:'Запустить матч',exact:true}).click();
await page.locator('.blueprint-canvas').waitFor({state:'attached',timeout:30000});
await page.getByText('Анализ боя',{exact:true}).click();
await page.getByLabel('Тактический след',{exact:true}).uncheck();
await page.getByRole('button',{name:'Башня времени',exact:true}).click();
await page.locator('.arena-stage.timeline-mode').waitFor();
await page.getByRole('button',{name:'Восприятие',exact:true}).click();
await page.locator('.arena-stage.perception-mode').waitFor();
await page.getByText('Звук',{exact:true}).click();
await page.locator('summary').filter({hasText:/^Экспорт видео$/}).click();
console.log('Workshop save/reopen + omni + analysis/audio/video passed');
await nav('Арена').click();await page.getByRole('button',{name:'Комнаты · PvP',exact:true}).click();
await page.getByText('В разработке',{exact:true}).waitFor();
await nav('Мастерская').click();
await page.getByRole('button',{name:'Открыть на арене',exact:true}).click();
await page.locator('.cm-content').waitFor();
assert.equal(await page.getByRole('button',{name:'PvE · Тренировка',exact:true}).getAttribute('aria-pressed'),'true');
await nav('Сообщество').click();await page.getByRole('button',{name:'Игроки',exact:true}).click();
await page.getByText('В разработке',{exact:true}).waitFor();
await nav('Главная').click();
await page.setViewportSize({width:390,height:844});
assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile overflow');
await nav('Арена').click();await page.getByRole('button',{name:'PvE · Тренировка',exact:true}).click();
assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Arena mobile overflow');
assert.deepEqual(errors,[]);
console.log('Placeholders, mobile, no browser exceptions passed');
});

test('custom matches execute each selected movement model and reject unknown models', async ({ request }) => {
  const commands = {
    tracked: '{ leftTrack: 1, rightTrack: 1 }',
    hover: '{ thrust: { x: 0, y: 1 } }',
    wheeled: '{ throttle: 1 }',
    omni: '{ thrust: { x: 0, y: 1 } }',
  };
  const payload = movement => ({ language: 'javascript', customMatch: {
    arena: { width: 16, height: 10, walls: [] }, maxTicks: 40,
    spawns: [
      { id: 'player', teamId: 'player', x: 3, y: 3, movement },
      { id: 'opponent', teamId: 'opponent', x: 13, y: 7 },
    ],
    loadouts: [
      { botId: 'player', source: 'code', code: `function tick() { return ${commands[movement] ?? '{}'}; }` },
      { botId: 'opponent', source: 'code', code: 'function tick() { return {}; }' },
    ],
  } });
  for (const movement of Object.keys(commands)) {
    const response = await request.post('/api/matches', { data: payload(movement) });
    assert.equal(response.status(), 200, await response.text());
    const result = await response.json();
    assert.equal(result.error, null);
    const frames = result.replay.frames;
    const robot = frames.at(-1).bots.find(bot => bot.id === 'player');
    assert.equal(robot.movement, movement);
    assert(Math.hypot(robot.position.x - 3, robot.position.y - 3) > .5, `${movement} did not move`);
    if (movement === 'omni' || movement === 'hover') assert(Math.abs(robot.position.x - 3) < .01, 'Lateral movement must preserve x');
    assert.equal(result.replay.result.reason, 'TimeLimit');
    assert(!result.replay.result.winnerBotId);
  }
  const invalid = await request.post('/api/matches', { data: payload('unknown') });
  assert.equal(invalid.status(), 400);
});

test('Python strategies can be saved and reopened; unavailable features stay placeholders', async ({ page, request }) => {
  const languages = await request.get('/api/strategy-languages').then(r => r.json());
  test.skip(!languages.includes('python'), 'Python WASI is not configured');
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Арена', exact: true }).click();
  await page.getByLabel('Язык стратегии', { exact: true }).selectOption('python');
  await page.getByLabel('Модель движения', { exact: true }).selectOption('hover');
  await page.getByRole('button', { name: 'Загрузить пример для этого шасси' }).click();
  await page.getByLabel('Название стратегии', { exact: true }).fill('Python hover');
  await page.getByRole('button', { name: 'Сохранить стратегию', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Мастерская', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть на арене', exact: true }).click();
  assert.equal(await page.getByLabel('Язык стратегии', { exact: true }).inputValue(), 'python');
  await page.getByRole('button', { name: 'Запустить матч', exact: true }).click();
  await page.locator('.blueprint-canvas').waitFor({ state: 'attached', timeout: 30000 });
  assert.equal(await page.locator('.error-card').count(), 0);
});

test('saving another robot creates a separate strategy', async ({ page }) => {
  const nav = name => page.getByRole('navigation').getByRole('button', { name, exact: true });
  await page.goto('/'); await nav('Арена').click();
  await page.getByLabel('Название стратегии', { exact: true }).fill('Robot A');
  await page.getByRole('button', { name: 'Сохранить стратегию', exact: true }).click();
  await page.locator('summary').filter({ hasText: /^Участники и параметры боя$/ }).click();
  await page.getByLabel('Ваши танки', { exact: true }).fill('2');
  await page.locator('.lab-bot-card').nth(1).getByRole('combobox').selectOption('code');
  await page.getByRole('tablist', { name: 'Танки' }).getByRole('tab').nth(1).click();
  await page.getByLabel('Название стратегии', { exact: true }).fill('Robot B');
  await page.getByRole('button', { name: 'Сохранить стратегию', exact: true }).click();
  await page.getByRole('button', { name: 'Сбросить Lab', exact: true }).click();
  await page.getByLabel('Название стратегии', { exact: true }).fill('Robot C');
  await page.getByRole('button', { name: 'Сохранить стратегию', exact: true }).click();
  await nav('Мастерская').click();
  assert.equal(await page.getByRole('heading', { name: 'Robot C', exact: true }).count(), 1);
  assert.equal(await page.getByRole('heading', { name: 'Robot A', exact: true }).count(), 1);
  assert.equal(await page.getByRole('heading', { name: 'Robot B', exact: true }).count(), 1);
});

test('two tabs preserve each other’s saved strategies and synchronize removals', async ({ context }) => {
  const a = await context.newPage(); const b = await context.newPage();
  for (const page of [a, b]) {
    await page.goto('/');
    await page.getByRole('navigation').getByRole('button', { name: 'Арена', exact: true }).click();
    await page.locator('.cm-content').waitFor();
  }
  for (const [page, name] of [[a, 'Tab A'], [b, 'Tab B']]) {
    await page.getByLabel('Название стратегии', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Сохранить стратегию', exact: true }).click();
  }
  for (const page of [a, b]) {
    await page.getByRole('navigation').getByRole('button', { name: 'Мастерская', exact: true }).click();
    await page.getByRole('heading', { name: 'Tab A', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Tab B', exact: true }).waitFor();
  }
  await a.locator('article').filter({has: a.getByRole('heading', {name: 'Tab A', exact: true})}).getByRole('button', { name: 'Удалить', exact: true }).click();
  await b.getByRole('heading', { name: 'Tab A', exact: true }).waitFor({ state: 'detached' });
  assert.equal(await b.getByRole('heading', { name: 'Tab B', exact: true }).count(), 1);
});
