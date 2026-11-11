import type { BattleEvent, Bot, Replay } from './contracts';

export const AUDIO_CHANNELS = ['engines', 'shots', 'impacts', 'ambience', 'music'] as const;
export type AudioChannel = typeof AUDIO_CHANNELS[number];
export interface AudioSettings {
  master: number;
  channels: Record<AudioChannel, number>;
}
export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  master: 0.65,
  channels: { engines: 0.6, shots: 0.8, impacts: 0.85, ambience: 0.35, music: 0.3 },
};
interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  pan: StereoPannerNode;
}
interface Engine {
  oscillators: OscillatorNode[];
  gains: GainNode[];
  filter: BiquadFilterNode;
  pan: StereoPannerNode;
}
export interface AudioTransport {
  position: number;
  playing: boolean;
  rate: number;
  frozen: boolean;
}
export interface AudioCapture { stream: MediaStream; release: () => void }
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

function seedOf(value: string) {
  let seed = 2166136261;
  for (const char of value) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return seed >>> 0;
}
function random(seed: number) {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}
type Sound = 'shot' | 'hit' | 'explosion' | 'zone' | 'kick' | 'hat' | 'note' | 'finish';

// PCM is generated once per seeded variation, then AudioBuffers are reused.
export function synthesizeSound(kind: Sound, sampleRate: number, seed: number, frequency = 110): Float32Array {
  const duration = kind === 'explosion' ? 1.8 : kind === 'finish' ? 1.4
    : kind === 'note' ? 0.65 : kind === 'shot' ? 0.4 : kind === 'hit' ? 0.55 : 0.2;
  const data = new Float32Array(Math.ceil(duration * sampleRate));
  const noise = random(seed);
  const variation = 0.92 + noise() * 0.16;
  const noiseFilter = 1 - Math.exp(-2 * Math.PI * 350 / sampleRate);
  let low = 0;
  let phase = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    const white = noise() * 2 - 1;
    low += (white - low) * noiseFilter;
    const attack = Math.min(1, t / 0.003);
    let value = 0;
    if (kind === 'shot') {
      phase += 2 * Math.PI * (48 + 125 * Math.exp(-t * 36)) * variation / sampleRate;
      value = Math.sin(phase) * Math.exp(-t * 15) * 0.65
        + white * Math.exp(-t * 65) * 0.3 + low * Math.exp(-t * 14) * 0.7;
    } else if (kind === 'hit' || kind === 'zone') {
      const pitch = kind === 'zone' ? 330 : 660 * variation;
      value = white * Math.exp(-t * 65) * 0.35
        + (Math.sin(t * pitch * 2 * Math.PI) + 0.5 * Math.sin(t * pitch * 2.71 * 2 * Math.PI)
          + 0.3 * Math.sin(t * pitch * 4.13 * 2 * Math.PI)) * Math.exp(-t * 13) * 0.22;
    } else if (kind === 'explosion') {
      phase += 2 * Math.PI * (28 + 65 * Math.exp(-t * 9)) * variation / sampleRate;
      value = Math.sin(phase) * Math.exp(-t * 5) * 0.55
        + low * Math.exp(-t * 3.8) * 1.5 + white * Math.exp(-t * 28) * 0.2;
    } else if (kind === 'kick') {
      phase += 2 * Math.PI * (40 + 90 * Math.exp(-t * 50)) / sampleRate;
      value = Math.sin(phase) * Math.exp(-t * 24) * 0.5;
    } else if (kind === 'hat') {
      value = (white - low) * Math.exp(-t * 70) * 0.18;
    } else if (kind === 'note') {
      value = (Math.sin(t * frequency * 2 * Math.PI)
        + Math.sin(t * frequency * 4 * Math.PI) * 0.18) * Math.exp(-t * 6) * 0.28;
    } else {
      const notes = [220, 261.63, 329.63, 440];
      value = notes.reduce((sum, note, n) => {
        const age = t - n * 0.1;
        return sum + (age < 0 ? 0 : Math.sin(age * note * 2 * Math.PI)
          * Math.min(1, age / 0.015) * Math.exp(-age * 4) * 0.15);
      }, 0);
    }
    data[i] = clamp(value * attack * Math.min(1, (duration - t) / 0.025), -0.95, 0.95);
  }
  return data;
}

export function eventsBetween(replay: Replay, previous: number, position: number) {
  const events: BattleEvent[] = [];
  for (let i = Math.max(0, Math.floor(previous) + 1);
    i <= Math.min(Math.floor(position), replay.frames.length - 1); i++) {
    events.push(...replay.frames[i].events);
  }
  return events;
}

/** Owns one audio graph per mounted replay. All assets are synthesized locally. */
export class BattleAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private focus: BiquadFilterNode | null = null;
  private motion: GainNode | null = null;
  private buses = {} as Record<AudioChannel, GainNode>;
  private engines = new Map<string, Engine>();
  private voices = new Set<Voice>();
  private buffers = new Map<string, AudioBuffer>();
  private ambience: AudioBufferSourceNode | null = null;
  private ambienceGain: GainNode | null = null;
  private output: DynamicsCompressorNode | null = null;
  private recording: MediaStreamAudioDestinationNode | null = null;
  private settings = DEFAULT_AUDIO_SETTINGS;
  private previous: number | null = null;
  private previousTime: number | null = null;
  private running = false;
  private enabled = false;
  private disposed = false;

  constructor(private readonly replay: Replay) {}

  async enable() {
    if (this.disposed) return false;
    if (!this.context) {
      const Context = window.AudioContext ?? (window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }).webkitAudioContext;
      if (!Context) throw new Error('Web Audio API is unavailable');
      this.context = new Context({ latencyHint: 'interactive' });
      this.createGraph();
    }
    this.enabled = true;
    const context = this.context;
    // Browsers may leave automatic resume pending until a later user gesture.
    await context.resume();
    if (this.disposed) return false;
    if (!this.enabled) {
      // A pending autoplay request must not undo a subsequent mute.
      await context.suspend();
      return false;
    }
    this.running = true;
    this.applySettings(this.settings);
    return true;
  }

  disable() {
    this.enabled = false;
    if (this.context && this.master) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setValueAtTime(0, this.context.currentTime);
    }
    this.clearVoices();
    this.setRunning(false);
  }

  async capture(): Promise<AudioCapture> {
    if (!await this.enable() || !this.context || !this.output) throw new Error('Audio unavailable');
    if (this.recording) throw new Error('Audio capture already active');
    const node = this.context.createMediaStreamDestination();
    const output = this.output;
    this.recording = node;
    output.connect(node);
    let released = false;
    return { stream: node.stream, release: () => {
      if (released) return;
      released = true;
      try { output.disconnect(node); } catch { /* The replay context may already be closed. */ }
      node.stream.getTracks().forEach(track => track.stop());
      if (this.recording === node) this.recording = null;
    } };
  }

  applySettings(settings: AudioSettings) {
    this.settings = settings;
    if (!this.context || !this.master) return;
    if (this.enabled) this.smooth(this.master.gain, clamp(settings.master), 0.02);
    else {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setValueAtTime(0, this.context.currentTime);
    }
    for (const channel of AUDIO_CHANNELS) {
      this.smooth(this.buses[channel].gain, clamp(settings.channels[channel]), 0.02);
    }
  }

  seek(position: number) {
    this.previous = position;
    this.previousTime = null;
    this.clearVoices();
  }

  update(transport: AudioTransport, visible = true) {
    const { position, playing, frozen } = transport;
    const previous = this.previous;
    const now = performance.now();
    const elapsed = this.previousTime == null ? 0 : (now - this.previousTime) / 1000;
    this.previousTime = now;
    this.previous = position;
    const active = this.enabled && playing && visible;
    this.setRunning(active);
    if (!active || !this.context || this.context.state !== 'running') return;
    const rate = clamp(transport.rate, 0.18, 4);
    const soundRate = frozen ? 0.09 : clamp(Math.sqrt(rate), 0.4, 1.8);
    this.smooth(this.focus!.frequency, frozen ? 650 : 2000 + Math.min(1, rate) * 16000, 0.07);
    this.smooth(this.motion!.gain, frozen ? 0.16 : 1, 0.06);
    for (const voice of this.voices) this.smooth(voice.source.playbackRate, soundRate, 0.04);
    // A seek or background-tab stall must never produce a backlog of explosions.
    const jumped = previous != null && (position < previous || elapsed > 0.35
      || position - previous > Math.max(3, this.replay.tickRate * rate * 0.35));
    if (jumped) this.clearVoices();
    if (previous != null && !jumped && position > previous) {
      for (const event of eventsBetween(this.replay, previous, position)) this.playEvent(event, soundRate);
      this.playMusic(previous, position, soundRate);
    }
    this.updateEngines(position, soundRate);
    this.smooth(this.ambienceGain!.gain, position >= this.replay.frames.length - 1 ? 0 : 0.12, 0.2);
  }

  dispose() {
    this.disposed = true;
    this.clearVoices();
    for (const engine of this.engines.values()) {
      engine.oscillators.forEach(node => { node.stop(); node.disconnect(); });
      engine.gains.forEach(node => node.disconnect());
      engine.filter.disconnect();
      engine.pan.disconnect();
    }
    this.engines.clear();
    this.ambience?.stop();
    this.ambience?.disconnect();
    this.recording?.stream.getTracks().forEach(track => track.stop());
    this.recording = null;
    this.buffers.clear();
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
  }

  private smooth(param: AudioParam, value: number, seconds: number) {
    const now = this.context!.currentTime;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, seconds);
  }

  private setRunning(running: boolean) {
    if (!this.context || this.running === running) return;
    this.running = running;
    const operation = running ? this.context.resume() : this.context.suspend();
    void operation.catch(() => { this.running = false; });
  }

  private createGraph() {
    const ctx = this.context!;
    const compressor = ctx.createDynamicsCompressor();
    this.output = compressor;
    compressor.threshold.value = -12;
    compressor.knee.value = 16;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.18;
    this.master = ctx.createGain();
    this.master.gain.value = this.settings.master;
    this.focus = ctx.createBiquadFilter();
    this.focus.type = 'lowpass';
    this.focus.frequency.value = 18000;
    this.focus.Q.value = 0.5;
    this.focus.connect(this.master).connect(compressor).connect(ctx.destination);
    this.motion = ctx.createGain();
    this.motion.connect(this.focus);
    for (const channel of AUDIO_CHANNELS) {
      const bus = ctx.createGain();
      bus.gain.value = this.settings.channels[channel];
      bus.connect(channel === 'engines' || channel === 'ambience' ? this.motion : this.focus);
      this.buses[channel] = bus;
    }
    for (const bot of this.replay.frames[0]?.bots ?? []) this.createEngine(bot);
    const noise = random(0xb07a4e);
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < data.length; i++) {
      brown = (brown + (noise() * 2 - 1) * 0.025) / 1.025;
      data[i] = brown;
    }
    // Fade both boundaries to zero to avoid a click at the loop seam.
    const fade = Math.min(1024, Math.floor(data.length / 2));
    for (let i = 0; i < fade; i++) {
      data[i] *= i / fade;
      data[data.length - 1 - i] *= i / fade;
    }
    this.ambience = ctx.createBufferSource();
    this.ambience.buffer = buffer;
    this.ambience.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    this.ambienceGain = ctx.createGain();
    this.ambienceGain.gain.value = 0;
    this.ambience.connect(filter).connect(this.ambienceGain).connect(this.buses.ambience);
    this.ambience.start();
  }

  private createEngine(bot: Bot) {
    const ctx = this.context!;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 450;
    filter.Q.value = 0.6;
    const pan = ctx.createStereoPanner();
    filter.connect(pan).connect(this.buses.engines);
    const electric = bot.movement === 'hover' || bot.movement === 'omni';
    const oscillators: OscillatorNode[] = [];
    const gains: GainNode[] = [];
    for (let i = 0; i < 3; i++) {
      const oscillator = ctx.createOscillator();
      oscillator.type = electric ? 'sine' : i === 0 ? 'sawtooth' : 'triangle';
      oscillator.detune.value = (seedOf(bot.id) % 19) - 9;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      oscillator.connect(gain).connect(filter);
      oscillator.start();
      oscillators.push(oscillator);
      gains.push(gain);
    }
    this.engines.set(bot.id, { oscillators, gains, filter, pan });
  }

  private updateEngines(position: number, soundRate: number) {
    const last = this.replay.frames.length - 1;
    const index = Math.min(last, Math.floor(position));
    const frame = this.replay.frames[index];
    const next = this.replay.frames[Math.min(last, index + 1)];
    const fraction = clamp(position - index);
    const density = 1 / Math.sqrt(Math.max(1, frame.bots.length));
    for (const bot of frame.bots) {
      const engine = this.engines.get(bot.id);
      if (!engine) continue;
      const upcoming = next.bots.find(item => item.id === bot.id) ?? bot;
      const speed = Math.abs(bot.speed + (upcoming.speed - bot.speed) * fraction);
      const acceleration = Math.abs(upcoming.speed - bot.speed) * this.replay.tickRate;
      const turn = Math.abs(Math.atan2(Math.sin(upcoming.bodyAngle - bot.bodyAngle),
        Math.cos(upcoming.bodyAngle - bot.bodyAngle))) * this.replay.tickRate;
      const load = clamp(speed / 5 + acceleration * 0.025 + turn * 0.06);
      const active = bot.hp > 0 && !bot.forfeited && position < last;
      const electric = bot.movement === 'hover' || bot.movement === 'omni';
      const base = electric ? 95 + load * 100 : bot.movement === 'wheeled' ? 38 + load * 58 : 30 + load * 43;
      engine.oscillators.forEach((oscillator, i) => {
        this.smooth(oscillator.frequency, base * [1, 2.01, 4.02][i] * soundRate, 0.06);
        this.smooth(engine.gains[i].gain, active ? (0.026 + load * 0.045) * density / (i + 1) : 0, 0.04);
      });
      this.smooth(engine.filter.frequency, 220 + load * 1100, 0.08);
      this.smooth(engine.pan.pan, this.panFor(bot.position.x
        + (upcoming.position.x - bot.position.x) * fraction), 0.08);
    }
  }

  private panFor(x: number) {
    // Stable arena-space stereo avoids left/right swaps during camera cuts.
    return clamp((x / this.replay.arena.width - 0.5) * 1.6, -0.8, 0.8);
  }

  private buffer(kind: Sound, variant: number, frequency = 110) {
    const ctx = this.context!;
    const key = `${kind}:${variant}:${frequency}`;
    let buffer = this.buffers.get(key);
    if (!buffer) {
      const data = synthesizeSound(kind, ctx.sampleRate, variant, frequency);
      buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
      buffer.getChannelData(0).set(data);
      this.buffers.set(key, buffer);
    }
    return buffer;
  }

  private play(kind: Sound, channel: AudioChannel, seed: number, pan: number,
    volume: number, rate: number, frequency?: number) {
    const ctx = this.context!;
    if (this.voices.size >= 48) {
      const oldest = this.voices.values().next().value!;
      oldest.source.stop();
      this.voices.delete(oldest);
    }
    const source = ctx.createBufferSource();
    source.buffer = this.buffer(kind, seed % 8, frequency);
    source.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    source.connect(gain).connect(panner).connect(this.buses[channel]);
    const voice = { source, gain, pan: panner };
    this.voices.add(voice);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      panner.disconnect();
      this.voices.delete(voice);
    };
    source.start();
  }

  private playEvent(event: BattleEvent, rate: number) {
    const seed = seedOf(`${event.type}:${event.tick}:${event.sourceBotId}:${event.targetBotId}:${event.bulletId}`);
    const pan = event.position ? this.panFor(event.position.x) : 0;
    if (event.type === 'ShotFired') this.play('shot', 'shots', seed, pan, 0.75, rate);
    else if (event.type === 'BotHit') this.play('hit', 'impacts', seed, pan,
      0.35 + clamp((event.damage ?? 20) / 100) * 0.4, rate);
    else if (event.type === 'BotDestroyed') this.play('explosion', 'impacts', seed, pan, 0.9, rate);
    else if (event.type === 'ZoneDamage') this.play('zone', 'impacts', seed, pan, 0.2, rate);
    else if (event.type === 'MatchFinished') this.play('finish', 'music', seed, 0, 0.4, rate);
  }

  private playMusic(previous: number, position: number, rate: number) {
    const stepFrames = this.replay.tickRate * 0.25;
    const end = Math.min(position, this.replay.frames.length - 1);
    const index = Math.min(Math.floor(end), this.replay.frames.length - 1);
    const intensity = clamp(this.replay.frames.slice(Math.max(0, index - this.replay.tickRate), index + 1)
      .reduce((sum, frame) => sum + frame.events.filter(event => event.type === 'ShotFired').length, 0) / 4);
    const bass = [55, 55, 65.41, 49];
    const melody = [220, 261.63, 329.63, 293.66, 261.63, 220, 196, 164.81];
    for (let step = Math.floor(previous / stepFrames) + 1; step <= Math.floor(end / stepFrames); step++) {
      if (step % 4 === 0) {
        this.play('kick', 'music', 1, 0, 0.35 + intensity * 0.2, rate);
        this.play('note', 'music', 1, 0, 0.45, rate, bass[Math.floor(step / 16) % bass.length]);
      }
      if (step % 2 === 1 && intensity > 0.15) this.play('hat', 'music', step, 0.25, intensity * 0.3, rate);
      if (step % 2 === 0) this.play('note', 'music', 2, step % 4 ? -0.25 : 0.25,
        0.18 + intensity * 0.15, rate, melody[Math.floor(step / 2) % melody.length]);
    }
  }

  private clearVoices() {
    for (const voice of this.voices) voice.source.stop();
    this.voices.clear();
  }
}
