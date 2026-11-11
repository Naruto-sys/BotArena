// Run Vite and an isolated Chrome with --remote-debugging-port=9227 first.
// Node 22+: node scripts/validate_audio.mjs [debugger-url] [vite-url]
import assert from 'node:assert/strict';

const debuggerUrl = process.argv[2] ?? 'http://127.0.0.1:9227';
const viteUrl = process.argv[3] ?? 'http://127.0.0.1:5173';
const pages = await fetch(`${debuggerUrl}/json/list`).then(response => response.json());
const page = pages.find(item => item.type === 'page' && item.url.startsWith(viteUrl));
assert(page, `Open ${viteUrl} in the test Chrome first`);
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let sequence = 0;
const pending = new Map();
socket.addEventListener('message', message => {
  const result = JSON.parse(message.data);
  if (!result.id) return;
  const waiter = pending.get(result.id);
  if (!waiter) return;
  pending.delete(result.id);
  clearTimeout(waiter.timeout);
  result.error ? waiter.reject(new Error(JSON.stringify(result.error))) : waiter.resolve(result.result);
});
function command(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out: ${method}`));
    }, 15000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

try {
  const result = await command('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
    expression: `(${async function validate() {
      const { BattleAudio, DEFAULT_AUDIO_SETTINGS, AUDIO_CHANNELS, synthesizeSound, eventsBetween }
        = await import('/src/battleAudio.ts');
      const passed = [];
      function check(condition, message) {
        if (!condition) throw new Error(message);
        passed.push(message);
      }
      const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
      for (const sampleRate of [22050, 44100, 48000]) {
        for (const kind of ['shot', 'hit', 'explosion', 'zone', 'kick', 'hat', 'note', 'finish']) {
          const a = synthesizeSound(kind, sampleRate, 42);
          const b = synthesizeSound(kind, sampleRate, 42);
          check(a.every((value, i) => Number.isFinite(value) && value === b[i] && Math.abs(value) <= 0.95),
            kind + ': finite, bounded, deterministic PCM at ' + sampleRate);
          check(a.some(value => Math.abs(value) > 0.01) && a[0] === 0 && Math.abs(a.at(-1)) < 0.001,
            kind + ': audible envelope without boundary clicks at ' + sampleRate);
        }
      }
      const firstShot = synthesizeSound('shot', 44100, 1);
      const secondShot = synthesizeSound('shot', 44100, 2);
      check(firstShot.some((v, i) => v !== secondShot[i]),
        'Different event seeds produce different shots');

      const event = (type, tick) => ({ type, tick, sourceBotId: 'bot0', targetBotId: 'bot1',
        bulletId: 1, position: { x: 3, y: 5 }, damage: 25 });
      const events = { 1: [event('ShotFired', 1)], 2: [event('BotHit', 2)],
        3: [event('ZoneDamage', 3)], 4: [event('BotDestroyed', 4)],
        80: [event('MatchFinished', 80)] };
      const replay = { tickRate: 20, arena: { width: 16, height: 10, walls: [] },
        result: { durationTicks: 80, reason: 'BotDestroyed', winnerBotId: 'bot0' },
        frames: Array.from({ length: 81 }, (_, tick) => ({ tick, bullets: [], events: events[tick] ?? [],
          bots: ['tracked', 'wheeled', 'hover', 'omni'].map((movement, i) => ({
            id: 'bot' + i, movement, position: { x: 2 + i * 3, y: 4 }, bodyAngle: tick * 0.05,
            turretAngle: 0, hp: i === 1 && tick >= 4 ? 0 : 100, maxHp: 100,
            speed: tick < 40 ? 2 : 4, reloadingTime: 0, canShoot: true,
          })),
        })),
      };
      const pendingAudio = new BattleAudio(replay);
      try {
        const pendingStart = pendingAudio.enable();
        pendingAudio.disable();
        check(await pendingStart === false && pendingAudio.context.state === 'suspended',
          'Mute cancels a pending audio start');
        pendingAudio.applySettings(DEFAULT_AUDIO_SETTINGS);
        const probe = pendingAudio.context.createOscillator();
        const mutedAnalyser = pendingAudio.context.createAnalyser();
        probe.connect(pendingAudio.master);
        pendingAudio.master.connect(mutedAnalyser);
        probe.start();
        // Simulate a browser finally granting an old resume request after mute.
        await pendingAudio.context.resume();
        const deadline = performance.now() + 3000;
        while (pendingAudio.context.currentTime < 0.12 && performance.now() < deadline) await wait(15);
        const mutedSamples = new Float32Array(mutedAnalyser.fftSize);
        mutedAnalyser.getFloatTimeDomainData(mutedSamples);
        check(mutedSamples.every(value => Math.abs(value) < 0.00001),
          'Changing mixer settings cannot unmute a disabled audio graph');
        probe.stop(); probe.disconnect(); mutedAnalyser.disconnect();
      } finally { pendingAudio.dispose(); }
      check(eventsBetween(replay, 0.8, 4.2).length === 4, 'All events between rendered frames are collected');
      check(eventsBetween(replay, 1.2, 1.9).length === 0, 'Fractional frames do not repeat events');
      check(eventsBetween(replay, 6, 3).length === 0, 'Reverse seek does not emit events');
      const audio = new BattleAudio(replay);
      const update = (position, playing = true, frozen = false, rate = 1) =>
        audio.update({ position, playing, frozen, rate });
      try {
        update(0);
        check(audio.context === null, 'No AudioContext is created before sound is enabled');
        await audio.enable();
        const waitAudio = async seconds => {
          const until = audio.context.currentTime + seconds;
          const deadline = performance.now() + 3000;
          while (audio.context.currentTime < until) {
            if (performance.now() > deadline) throw new Error('Audio clock stalled');
            await wait(15);
          }
        };
        update(0);
        check(audio.context.state === 'running' && audio.engines.size === 4,
          'Real Web Audio graph starts for all four movement models');
        update(1.1);
        check(audio.voices.size === 1, 'Shot crossing creates one transient');
        update(1.5);
        check(audio.voices.size === 1, 'Same tick never replays a shot');
        update(1.5, true, true);
        await waitAudio(0.25);
        check(audio.focus.frequency.value < 4000
          && [...audio.voices][0].source.playbackRate.value < 0.2,
          'Chrono freeze filters audio and stretches the active transient: '
            + JSON.stringify({ filter: audio.focus.frequency.value,
              rate: [...audio.voices][0]?.source.playbackRate.value,
              state: audio.context.state, time: audio.context.currentTime }));
        update(1.5, false);
        await wait(60);
        const pauseTime = audio.context.currentTime;
        await wait(60);
        check(audio.context.state === 'suspended' && audio.context.currentTime === pauseTime,
          'Pause freezes the audio clock and effect envelopes');
        audio.seek(40);
        check(audio.voices.size === 0, 'Seeking discards the previous effect tails');
        update(40);
        await wait(30);
        update(40.2);
        check(audio.voices.size === 0, 'Resume after forward seek does not emit skipped events');
        audio.seek(0);
        update(0);
        update(4.1, true, false, 4);
        check(audio.voices.size === 4, '4x playback still emits every crossed battle event');
        check([...audio.buffers.keys()].some(key => key.startsWith('explosion:'))
          && [...audio.buffers.keys()].some(key => key.startsWith('zone:')),
          'Destruction and zone damage have synthesized effects');
        await waitAudio(0.25);
        check(audio.engines.get('bot1').gains.every(gain => gain.gain.value < 0.001)
          && audio.engines.get('bot0').gains[0].gain.value > 0.005,
          'Destroyed robot engine fades while living engines continue');
        check(audio.engines.get('bot2').oscillators[0].frequency.value
          > audio.engines.get('bot0').oscillators[0].frequency.value,
          'Hover and tracked engines have distinct pitches');
        update(4.1, true, false, 0.25);
        await waitAudio(0.25);
        const slowPitch = audio.engines.get('bot0').oscillators[0].frequency.value;
        update(4.1, true, false, 4);
        await waitAudio(0.25);
        check(audio.engines.get('bot0').oscillators[0].frequency.value > slowPitch * 2,
          'Playback speed changes continuous engine pitch');
        audio.seek(40);
        update(40);
        const ctx = audio.context;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        audio.master.connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const rms = () => {
          analyser.getFloatTimeDomainData(samples);
          return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        };
        audio.applySettings({ ...DEFAULT_AUDIO_SETTINGS, master: 1 });
        update(40);
        await waitAudio(0.18);
        check(rms() > 0.0001, 'Audio graph produces nonzero PCM output');
        for (const channel of AUDIO_CHANNELS) {
          audio.applySettings({ master: 1, channels: Object.fromEntries(AUDIO_CHANNELS.map(c => [c, c === channel ? 1 : 0])) });
          audio.seek(0);
          update(0);
          await waitAudio(0.18);
          update(channel === 'shots' ? 1.1 : channel === 'impacts' ? 2.1 : channel === 'music' ? 5.1 : 0.1,
            true, false, 4);
          await waitAudio(0.07);
          check(rms() > 0.00005, channel + ': mixer channel independently produces audio');
        }
        audio.applySettings({ master: 1, channels: Object.fromEntries(AUDIO_CHANNELS.map(channel => [channel, 0])) });
        await waitAudio(0.3);
        check(rms() < 0.00001, 'All mixer channels at zero are silent with master still on');
        audio.applySettings({ ...DEFAULT_AUDIO_SETTINGS, master: 0 });
        await waitAudio(0.3);
        check(rms() < 0.00001, 'Master at zero silences all categories');
        audio.disable();
        await wait(50);
        check(ctx.state === 'suspended' && audio.voices.size === 0,
          'Sound toggle suspends processing and clears effects');
        update(70);
        await audio.enable();
        update(70);
        check(audio.voices.size === 0, 'Re-enabling sound does not replay muted history');
        audio.seek(0);
        update(0);
        update(1.1);
        check(audio.voices.size === 1, 'Restart makes the first shot audible again');
        audio.update({ position: 71, playing: true, rate: 1, frozen: false }, false);
        await wait(50);
        check(ctx.state === 'suspended', 'Hidden browser tab is silent');
        audio.seek(79.9);
        update(79.9);
        await wait(25);
        update(80.1);
        check([...audio.buffers.keys()].some(key => key.startsWith('finish:')), 'Match end plays a musical resolution');
        audio.dispose();
        await wait(30);
        check(ctx.state === 'closed' && audio.engines.size === 0 && audio.voices.size === 0,
          'Unmount closes AudioContext and releases all sources');
      } finally {
        if (audio.context) audio.dispose();
      }
      return passed;
    }})()`,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  const passed = result.result.value;
  for (const message of passed) console.log(`PASS ${message}`);
  console.log(`Web Audio checks passed: ${passed.length}`);
} finally {
  socket.close();
}
