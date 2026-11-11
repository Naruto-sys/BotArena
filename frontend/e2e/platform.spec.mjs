import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { wallOverlapsBot } from '../src/mapGeometry.ts';
test('unified UX: campaign, strategy library, replay tools and mobile', async ({ page, request }) => {
const session = await request.get('/api/auth/session').then(r => r.json());
test.skip(!session.authenticated, 'Requires an authenticated storage state (BOTARENA_STORAGE_STATE)');
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
assert.equal(await page.getByLabel('Модель движения',{exact:true}).count(),0);
await page.getByText('Выберите язык стратегии',{exact:true}).waitFor();
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
await page.getByRole('button',{name:'Развернуть редактор',exact:true}).click();
await page.getByRole('button',{name:'Запустить матч',exact:true}).click();
assert.equal(await page.locator('.replay').isVisible(),true);
assert.equal(await page.getByRole('button',{name:'Свернуть редактор',exact:true}).count(),0);
await page.locator('.blueprint-canvas').waitFor({state:'attached',timeout:30000});
await page.getByText('Анализ боя',{exact:true}).click();
assert.equal(await page.getByLabel('Тактический след',{exact:true}).isChecked(),false);
await page.getByLabel('Тактический след',{exact:true}).check();
await page.getByLabel('Тактический след',{exact:true}).uncheck();
await page.getByRole('button',{name:'Башня времени',exact:true}).click();
await page.locator('.arena-stage.timeline-mode').waitFor();
await page.getByRole('button',{name:'Восприятие',exact:true}).click();
await page.locator('.arena-stage.perception-mode').waitFor();
await page.getByText('Звук',{exact:true}).click();
await page.locator('summary').filter({hasText:/^Экспорт видео$/}).click();
console.log('Workshop save/reopen + omni + analysis/audio/video passed');
await nav('Арена').click();await page.getByRole('button',{name:'Комнаты · PvP',exact:true}).click();
await page.getByRole('heading',{name:'Игровые комнаты',exact:true}).waitFor();
await nav('Мастерская').click();
await page.getByRole('button',{name:'Открыть на арене',exact:true}).click();
await page.locator('.cm-content').waitFor();
assert.equal(await page.getByRole('button',{name:'PvE · Тренировка',exact:true}).getAttribute('aria-pressed'),'true');
await nav('Сообщество').click();await page.getByRole('button',{name:'Друзья',exact:true}).click();
await page.locator('.friends-panel').waitFor();
await nav('Главная').click();
await page.setViewportSize({width:390,height:844});
assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile overflow');
await nav('Арена').click();await page.getByRole('button',{name:'PvE · Тренировка',exact:true}).click();
assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Arena mobile overflow');
assert.deepEqual(errors,[]);
console.log('Placeholders, mobile, no browser exceptions passed');
});

test('custom matches execute each selected movement model and reject unknown models', async ({ request }) => {
  const session = await request.get('/api/auth/session').then(r => r.json());
  test.skip(!session.authenticated, 'Requires an authenticated storage state (BOTARENA_STORAGE_STATE)');
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
  const session = await request.get('/api/auth/session').then(r => r.json());
  test.skip(!session.authenticated, 'Requires an authenticated storage state (BOTARENA_STORAGE_STATE)');
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


test('map rejects wall overlap through fields, drag, resize, add and classic restore', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', {name:'Арена',exact:true}).click();
  const row = page.locator('.lab-wall-row').first();
  await row.getByLabel('x',{exact:true}).fill('2');
  await row.getByLabel('y',{exact:true}).fill('4.5');
  await page.getByRole('alert').filter({hasText:'Нельзя поставить стену на робота'}).waitFor();
  assert.equal(await row.getByLabel('y',{exact:true}).inputValue(),'1.9');
  // SVG coordinates make the pointer checks independent of the viewport size.
  const point = (x,y) => page.locator('.lab-arena').evaluate((svg, p) => {
    const result = new DOMPoint(p.x,p.y).matrixTransform(svg.getScreenCTM());
    return {x:result.x,y:result.y};
  },{x,y});
  async function drag(from,to) {
    const a=await point(...from); const b=await point(...to);
    await page.mouse.move(a.x,a.y); await page.mouse.down();
    await page.mouse.move(b.x,b.y); await page.mouse.up();
  }
  await drag([2.7,2.5],[2.7,5]);
  await page.getByRole('alert').filter({hasText:'Нельзя поставить стену на робота'}).waitFor();
  assert.equal(await row.getByLabel('y',{exact:true}).inputValue(),'1.9');
  // Bottom left corner expanding across the player hull must also be rejected.
  await drag([2,3.2],[1.8,5.5]);
  await page.getByRole('alert').filter({hasText:'Нельзя поставить стену на робота'}).waitFor();
  assert.equal(await row.getByLabel('height',{exact:true}).inputValue(),'1.3');
  await page.getByRole('button',{name:'Без стен',exact:true}).click();
  await drag([2.2,5],[6.5,4.5]);
  await page.getByRole('button',{name:'Добавить стену',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Нельзя поставить стену на робота'}).waitFor();
  assert.equal(await page.locator('.lab-wall').count(),0);
  await drag([6.5,4.5],[5,2.5]);
  await page.getByRole('button',{name:'Classic',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Нельзя поставить стену на робота'}).waitFor();
  assert.equal(await page.locator('.lab-wall').count(),0);
  await drag([5,2.5],[2.2,5]);
  await page.getByRole('button',{name:'Classic',exact:true}).click();
  assert.equal(await page.locator('.lab-wall').count(),3);
  // Moving the robot into a wall must preserve its previous position too.
  await drag([2.2,5],[5,2.5]);
  await page.getByRole('alert').filter({hasText:'Нельзя поставить робота внутрь стены'}).waitFor();
  assert.equal(await page.locator('[data-bot="player"]').getAttribute('transform'),'translate(2.2 5)');
});

test('map geometry uses rotated hulls, not only centres or bounding boxes', () => {
  const bot = {position:{x:0,y:0},bodyAngle:0};
  assert(wallOverlapsBot({x:.33,y:-.1,width:.2,height:.2},bot));
  assert(!wallOverlapsBot({x:.35,y:-.1,width:.2,height:.2},bot));
  assert(wallOverlapsBot({x:.34,y:-.1,width:.2,height:.2},bot));
  const rotated = {...bot,bodyAngle:Math.PI/4};
  assert(wallOverlapsBot({x:.42,y:-.03,width:.1,height:.06},rotated));
  assert(!wallOverlapsBot({x:.42,y:.42,width:.05,height:.05},rotated));
});


test('changing team size cannot respawn robots inside a wall', async ({page}) => {
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button',{name:'Арена',exact:true}).click();
  await page.getByRole('button',{name:'Без стен',exact:true}).click();
  await page.getByRole('button',{name:'Добавить стену',exact:true}).click();
  const row=page.locator('.lab-wall-row').first();
  await row.getByLabel('y',{exact:true}).fill('1.5');
  await row.getByLabel('x',{exact:true}).fill('1.5');
  await page.locator('summary').filter({hasText:/^Участники и параметры боя$/}).click();
  await page.getByLabel('Ваши танки',{exact:true}).fill('2');
  await page.getByRole('alert').filter({hasText:'Нельзя изменить состав'}).waitFor();
  assert.equal(await page.getByLabel('Ваши танки',{exact:true}).inputValue(),'1');
  assert.equal(await page.locator('[data-bot="player"]').getAttribute('transform'),'translate(2.2 5)');
  await page.getByRole('button',{name:'Без стен',exact:true}).click();
  await page.getByLabel('Ваши танки',{exact:true}).fill('2');
  assert.equal(await page.getByLabel('Ваши танки',{exact:true}).inputValue(),'2');
});


test('merged shell exposes online features and preserves anonymous authorization boundaries', async ({ page, request }) => {
  const session = await request.get('/api/auth/session').then(r => r.json());
  test.skip(session.authenticated, 'This scenario checks an anonymous session');
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  const nav=name=>page.getByRole('navigation',{name:'Основная навигация'}).getByRole('button',{name,exact:true});
  assert.equal(await page.locator('.platform-header').count(),1);
  assert.equal(await page.locator('.app-header').count(),0);
  await nav('Арена').click();
  await page.getByText('Для запуска боя нужен вход').waitFor();
  assert.equal(await page.getByRole('button',{name:'Запустить матч',exact:true}).isDisabled(),true);
  assert.equal((await request.post('/api/matches',{data:{botCode:'function tick(){return {};}',opponentId:'aggressive'}})).status(),401);
  await page.getByRole('button',{name:'Комнаты · PvP',exact:true}).click();
  await page.getByRole('heading',{name:'Игровые комнаты',exact:true}).waitFor();
  await nav('Обучение').click();
  await page.getByRole('button',{name:'PvE · Прогресс и рейтинг',exact:true}).click();
  await page.locator('.learning-auth').waitFor();
  await page.reload();
  await page.locator('.learning-auth').waitFor();
  await nav('Главная').click();
  await page.getByRole('button',{name:'Продолжить обучение →',exact:true}).click();
  await page.locator('.cm-content').waitFor();
  assert.equal(await page.locator('.learning-auth').count(),0);
  await nav('Мастерская').click();
  await page.getByRole('button',{name:'Публикации и каталог',exact:true}).click();
  await page.getByRole('heading',{name:'Стратегии сообщества',exact:true}).waitFor();
  await page.reload();
  await page.getByRole('heading',{name:'Стратегии сообщества',exact:true}).waitFor();
  assert(page.url().endsWith('#workshop/online'));
  await page.goto('/#ugc');
  await page.getByRole('heading',{name:'Стратегии сообщества',exact:true}).waitFor();
  await page.goto('/?share=missing#arena');
  await page.locator('.cm-content').waitFor();
  await nav('Мастерская').click();
  assert(!new URL(page.url()).searchParams.has('share'));
  await page.reload();
  await page.getByRole('button',{name:'Публикации и каталог',exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});
  await nav('Главная').click();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile header overflow');
  assert.deepEqual(errors,[]);
});

test('light theme keeps unified home and arena text readable', async ({page}) => {
  await page.addInitScript(()=>localStorage.setItem('botarena-theme','light'));
  await page.goto('/');
  await page.locator('html[data-theme="light"]').waitFor();
  async function contrast(textSelector, backgroundSelector) {
    return page.evaluate(({textSelector,backgroundSelector})=>{
      const rgb=value=>value.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
      const luminance=color=>{const [r,g,b]=rgb(color);return .2126*r+.7152*g+.0722*b;};
      const foreground=luminance(getComputedStyle(document.querySelector(textSelector)).color);
      const background=luminance(getComputedStyle(document.querySelector(backgroundSelector)).backgroundColor);
      return (Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05);
    },{textSelector,backgroundSelector});
  }
  assert(await contrast('.ux-hero h1','.ux-hero')>=4.5);
  assert(await contrast('.ux-path p','.ux-path')>=4.5);
  assert(await contrast('.platform-brand span','.platform-header')>=4.5);
  await page.getByRole('navigation',{name:'Основная навигация'}).getByRole('button',{name:'Арена',exact:true}).click();
  assert(await contrast('.editor h1','.editor')>=4.5);
});

test('protected community sections never redirect a guest; missing OAuth stays inside the app', async ({page,request}) => {
  const session=await request.get('/api/auth/session').then(r=>r.json());
  test.skip(session.authenticated,'Guest authorization regression');
  const navigations=[]; const errors=[];
  page.on('request',r=>{if(r.isNavigationRequest()&&r.url().includes('/api/auth/login'))navigations.push(r.url());});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/#ugc');
  const tabs=page.locator('.ugc-tabs');
  for(const name of ['Друзья','Мои стратегии','Комнаты','Карты']) {
    await tabs.getByRole('button',{name,exact:true}).click();
    await page.locator('.auth-feedback').filter({hasText:'Для этого раздела нужен вход через Яндекс.'}).waitFor();
    assert(page.url().endsWith('#ugc'));
  }
  if(!session.loginAvailable) {
    await page.locator('.platform-header .yandex-login').click();
    await page.locator('.auth-feedback').filter({hasText:'Вход через Яндекс пока не настроен на сервере.'}).waitFor();
    assert(page.url().endsWith('#ugc'));
  }
  await page.getByRole('navigation',{name:'Основная навигация'}).getByRole('button',{name:'Главная',exact:true}).click();
  await page.locator('.ux-hero').waitFor();
  assert.deepEqual(navigations,[]);
  assert.deepEqual(errors,[]);
});

test('maneuver copy reports success, and clipboard rejection reports an error', async ({page}) => {
  await page.route('**/api/ugc/maneuvers?*',route=>route.fulfill({json:[{
    id:'copy-test',name:'Проверка копирования',description:'Тест',category:'combat',language:'javascript',
    code:'function preciseAim() { return {}; }',usage:'preciseAim(state)',tags:[],
  }]}));
  await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedManeuver=text;}}}));
  await page.goto('/#ugc');
  await page.locator('.ugc-tabs').getByRole('button',{name:'Манёвры',exact:true}).click();
  await page.getByRole('button',{name:'Копировать код',exact:true}).click();
  const success=page.getByRole('status').filter({hasText:'Код манёвра скопирован.'});
  await success.waitFor();
  assert.equal(await success.getAttribute('class'),'ugc-notice');
  assert.equal(await page.evaluate(()=>window.__copiedManeuver),'function preciseAim() { return {}; }');
  await page.evaluate(()=>navigator.clipboard.writeText=async()=>{throw new Error('Clipboard denied');});
  await page.getByRole('button',{name:'Копировать код',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Не удалось скопировать код.'}).waitFor();
  assert.equal(await page.locator('.ugc-notice').count(),0);
});

test('late unauthorized responses do not show login prompts after leaving a section', async ({page}) => {
  let release;
  const held=new Promise(resolve=>release=resolve);
  let requested;
  const started=new Promise(resolve=>requested=resolve);
  await page.route('**/api/friends/',async route=>{
    requested(); await held; await route.fulfill({status:401,json:{}});
  });
  await page.goto('/#ugc');
  await page.locator('.ugc-tabs').getByRole('button',{name:'Друзья',exact:true}).click();
  await started;
  await page.getByRole('navigation',{name:'Основная навигация'}).getByRole('button',{name:'Главная',exact:true}).click();
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/friends/'&&r.status()===401);
  release(); await response;
  // Let the completed fetch and its React updates drain.
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.auth-feedback').count(),0);
  await page.locator('.ux-hero').waitFor();
});
