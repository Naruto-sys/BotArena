// Run Vite and an isolated Chrome with --remote-debugging-port=9227 first.
// Node 22+, ffprobe and ffmpeg: node scripts/validate_video.mjs [debugger-url] [vite-url]
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const debuggerUrl = process.argv[2] ?? 'http://127.0.0.1:9227';
const viteUrl = process.argv[3] ?? 'http://127.0.0.1:5173';
const page = await fetch(`${debuggerUrl}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
const pending = new Map();
const exceptions = [];
let sequence = 0;
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id); clearTimeout(waiter.timer);
  message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result);
});
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(expression) {
  for (let i = 0; i < 200; i++) { if (await evaluate(expression)) return; await wait(150); }
  throw new Error(`Timeout: ${expression}`);
}
async function range(selector, value) {
  await evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${value});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}
async function start() {
  await evaluate(`document.querySelector('.video-export-start').click()`);
  await until(`document.querySelector('.video-export-start').textContent.includes('Запись')`);
  assert.equal(await evaluate(`document.querySelector('.replay-settings').disabled`), true);
  assert.equal(await evaluate(`document.querySelector('.blueprint-canvas').width`), 1280);
  assert.equal(await evaluate(`document.querySelector('.blueprint-canvas').height`), 720);
}
async function save(name, withAudio) {
  await until(`Boolean(document.querySelector('.video-download'))`);
  const data = await evaluate(`(async () => {
    const response = await fetch(document.querySelector('.video-download').href);
    const blob = await response.blob();
    return await new Promise(resolve => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(blob);
    });
  })()`);
  const path = `/private/tmp/botarena-export-${name}.webm`;
  await writeFile(path, Buffer.from(data, 'base64'));
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], { encoding: 'utf8' }));
  const video = probe.streams.find(stream => stream.codec_type === 'video');
  assert(video && video.width === 1280 && video.height === 720);
  assert(Number(probe.format.duration) > 0, 'Export has finite duration metadata');
  assert.equal(probe.streams.some(stream => stream.codec_type === 'audio'), withAudio);
  if (withAudio) {
    const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-vn', '-ac', '1', '-f', 'f32le', 'pipe:1'],
      { maxBuffer: 64 * 1024 * 1024 });
    let audible = false;
    for (let i = 0; i + 4 <= pcm.length; i += 4) if (Math.abs(pcm.readFloatLE(i)) > 0.001) { audible = true; break; }
    assert(audible, 'Captured audio contains real sound, not just an empty track');
  }
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path, '-frames:v', '1', `/private/tmp/botarena-export-${name}.png`]);
  assert.equal(await evaluate(`document.querySelector('.replay-settings').disabled`), false);
  assert.equal(await evaluate(`document.querySelector('.replay-controls input').value`), '10');
  assert.equal(await evaluate(`document.querySelector('.replay-controls button').textContent`), 'Продолжить');
  console.log(JSON.stringify({ result: 'PASS playable video', name, bytes: Buffer.from(data, 'base64').length,
    streams: probe.streams.map(stream => ({ codec: stream.codec_name, type: stream.codec_type,
      width: stream.width, height: stream.height, channels: stream.channels })), path }));
}

try {
  await command('Runtime.enable'); await command('Page.enable');
  await command('Emulation.setFocusEmulationEnabled', { enabled: true });
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  const payload = { language: 'javascript', customMatch: {
    arena: { width: 16, height: 10, walls: [] }, maxTicks: 120,
    spawns: [{ id: 'player', teamId: 'player', x: 3, y: 5, hp: 100 },
      { id: 'opponent', teamId: 'enemy', x: 12, y: 5, hp: 100, bodyAngle: Math.PI, turretAngle: Math.PI }],
    loadouts: [{ botId: 'player', source: 'code', code: 'function tick(){return{aimAt:{x:12,y:5},shoot:true,leftTrack:.15,rightTrack:.15};}' },
      { botId: 'opponent', source: 'code', code: 'function tick(){return{};}' }],
  } };
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.recorders = [];
    const NativeRecorder = window.MediaRecorder;
    window.MediaRecorder = class extends NativeRecorder { constructor(...args) { super(...args); window.recorders.push(this); } };
    const originalFetch = window.fetch;
    window.fetch = function(input, options) {
      if (String(input).endsWith('/api/match-jobs') && options?.method === 'POST')
        options = { ...options, body: ${JSON.stringify(JSON.stringify(payload))} };
      return originalFetch.call(this, input, options);
    };
  ` });
  await command('Page.navigate', { url: viteUrl }); await wait(800); await command('Page.bringToFront');
  await until(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === 'Match Lab'); if (!b) return false; b.click(); return true; })()`);
  await until(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Запустить матч') && !b.disabled)`);
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Запустить матч')).click()`);
  await until(`Boolean(document.querySelector('.video-export-start'))`);
  await evaluate(`[...document.querySelectorAll('.camera-modes button')].find(b => b.textContent === 'План').click()`);
  await range('.replay-controls input', 10);
  await evaluate(`(() => { const select = document.querySelector('.replay-controls select'); select.value = '2'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await evaluate(`document.querySelector('.arena-stage').scrollIntoView({ block: 'center' })`);
  await start(); await save('audio', true);
  assert.equal(await evaluate(`window.recorders.at(-1).stream.getTracks().every(track => track.readyState === 'ended')`), true);

  await start();
  await evaluate(`[...document.querySelectorAll('.video-export button')].find(b => b.textContent === 'Отменить экспорт').click()`);
  await until(`!document.querySelector('.replay-settings').disabled`);
  assert.equal(await evaluate(`Boolean(document.querySelector('.video-download'))`), false);
  assert.equal(await evaluate(`window.recorders.at(-1).stream.getTracks().every(track => track.readyState === 'ended')`), true);
  console.log('PASS cancellation restores playback and releases recording tracks');

  await evaluate(`document.querySelector('.audio-toggle').click()`);
  await start(); await save('silent', false);
  await start();
  await evaluate(`Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); delete document.hidden;`);
  await until(`document.querySelector('.video-export [role=alert]')?.textContent.includes('вкладка была скрыта')`);
  assert.equal(await evaluate(`window.recorders.at(-1).stream.getTracks().every(track => track.readyState === 'ended')`), true);
  console.log('PASS hiding the tab cancels export instead of saving dropped frames');

  await start();
  await evaluate(`[...document.querySelectorAll('.lab-arena-tabs button')].find(b => b.textContent === 'Редактор').click()`);
  await until(`!document.querySelector('.video-export')`);
  assert.equal(await evaluate(`window.recorders.at(-1).stream.getTracks().every(track => track.readyState === 'ended')`), true);
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log('PASS unmount cancels export; no uncaught browser exceptions');
} finally { socket.close(); await fetch(`${debuggerUrl}/json/close/${page.id}`); }
