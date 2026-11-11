import { withWebMDuration } from './webmDuration';

export const VIDEO_WIDTH = 1280;
export const VIDEO_HEIGHT = 720;
export const VIDEO_FPS = 30;

export interface VideoOverlay {
  title: string;
  time: string;
  cue?: string;
  badge?: string;
  result?: string;
  letterbox: boolean;
  gunner: boolean;
  bots: Array<{ label: string; color: string; hp: number; maxHp: number; forfeited?: boolean }>;
}

export function videoMimeType(audio = true): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement === 'undefined'
    || typeof HTMLCanvasElement.prototype.captureStream !== 'function') return;
  const codecs = audio ? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus']
    : ['video/webm;codecs=vp8', 'video/webm;codecs=vp9'];
  return [...codecs, 'video/webm', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type));
}

function fittedText(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text;
  while (text.length && ctx.measureText(`${text}…`).width > width) text = text.slice(0, -1);
  return `${text}…`;
}

/** Compose directly after the WebGL render, before its drawing buffer is cleared. */
export function drawVideoFrame(ctx: CanvasRenderingContext2D, source: HTMLCanvasElement, hud: VideoOverlay) {
  const width = VIDEO_WIDTH, height = VIDEO_HEIGHT;
  ctx.fillStyle = '#04121f';
  ctx.fillRect(0, 0, width, height);
  const scale = Math.min(width / source.width, height / source.height);
  const w = source.width * scale, h = source.height * scale;
  ctx.drawImage(source, (width - w) / 2, (height - h) / 2, w, h);
  if (hud.letterbox) {
    ctx.fillStyle = '#02070d';
    ctx.fillRect(0, 0, width, height * 0.055);
    ctx.fillRect(0, height * 0.945, width, height * 0.055);
  }
  ctx.font = 'bold 15px monospace';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(3, 18, 29, .78)';
  ctx.fillRect(18, 14, width - 36, 35);
  ctx.fillStyle = '#7bdcf7';
  ctx.fillText(fittedText(ctx, hud.title, width - 340), 30, 25);
  ctx.textAlign = 'right';
  ctx.fillText(hud.time, width - 30, 25);
  ctx.textAlign = 'left';
  if (hud.gunner) {
    ctx.strokeStyle = '#73ddff'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(width / 2 - 24, height / 2); ctx.lineTo(width / 2 + 24, height / 2);
    ctx.moveTo(width / 2, height / 2 - 18); ctx.lineTo(width / 2, height / 2 + 18);
    ctx.arc(width / 2, height / 2, 12, 0, Math.PI * 2);
    ctx.stroke();
  }
  const columns = Math.min(4, Math.max(1, hud.bots.length));
  const rows = Math.ceil(hud.bots.length / columns);
  const footer = rows * 42 + 14;
  const cell = (width - 60) / columns;
  ctx.fillStyle = 'rgba(3, 18, 29, .9)';
  ctx.fillRect(18, height - footer - 12, width - 36, footer);
  hud.bots.forEach((bot, index) => {
    const x = 30 + index % columns * cell, y = height - footer + Math.floor(index / columns) * 42;
    ctx.font = 'bold 13px monospace';
    ctx.fillStyle = bot.color;
    const value = bot.forfeited ? 'ВЫБЫЛ' : `${bot.hp}/${bot.maxHp} HP`;
    ctx.fillText(fittedText(ctx, bot.label, cell - 125), x, y);
    ctx.textAlign = 'right'; ctx.fillText(value, x + cell - 18, y); ctx.textAlign = 'left';
    ctx.fillStyle = '#243c50'; ctx.fillRect(x, y + 20, cell - 18, 5);
    ctx.fillStyle = bot.color;
    ctx.fillRect(x, y + 20, (cell - 18) * Math.max(0, Math.min(1, bot.hp / bot.maxHp)), 5);
  });
  if (hud.cue || hud.badge) {
    const y = height - footer - 58;
    ctx.fillStyle = 'rgba(3, 18, 29, .85)'; ctx.fillRect(18, y - 10, width - 36, 42);
    ctx.fillStyle = '#b7edfa'; ctx.font = 'bold 15px monospace';
    ctx.fillText(fittedText(ctx, hud.cue ?? hud.badge ?? '', width - 70), 30, y);
    if (hud.badge && hud.cue) {
      ctx.fillStyle = '#ffcb87'; ctx.textAlign = 'right';
      ctx.fillText(hud.badge, width - 30, 64); ctx.textAlign = 'left';
    }
  }
  if (hud.result) {
    ctx.font = 'bold 22px sans-serif';
    const text = fittedText(ctx, hud.result, width - 120);
    const size = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(10, 28, 44, .94)'; ctx.fillRect((width - size) / 2 - 18, 75, size + 36, 48);
    ctx.fillStyle = '#ecf8ff'; ctx.fillText(text, (width - size) / 2, 87);
  }
}

/** Real-time recording of a private compositor, never the browser screen or microphone. */
export class ReplayVideoRecorder {
  private canvas = document.createElement('canvas');
  private context: CanvasRenderingContext2D;
  private video: MediaStream;
  private recorder: MediaRecorder;
  private chunks: Blob[] = [];
  private bytes = 0;
  private cancelled = false;
  private startedAt = 0;
  private stoppedAt = 0;
  private drawnAt = -Infinity;

  constructor(audio: MediaStream | null, callbacks: {
    complete: (blob: Blob, extension: string) => void;
    error: () => void;
  }) {
    this.canvas.width = VIDEO_WIDTH;
    this.canvas.height = VIDEO_HEIGHT;
    const context = this.canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas 2D is unavailable');
    this.context = context;
    const mimeType = videoMimeType(Boolean(audio));
    if (!mimeType) throw new Error('Video recording is unavailable');
    this.video = this.canvas.captureStream(VIDEO_FPS);
    try {
      const stream = new MediaStream([...this.video.getVideoTracks(), ...(audio?.getAudioTracks() ?? [])]);
      this.recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 128_000 });
    } catch (error) {
      this.video.getTracks().forEach(track => track.stop());
      throw error;
    }
    this.recorder.ondataavailable = event => {
      if (!this.cancelled && event.data.size) {
        this.chunks.push(event.data); this.bytes += event.data.size;
        if (this.bytes > 256 * 1024 * 1024) { this.cancel(); callbacks.error(); }
      }
    };
    this.recorder.onerror = () => { this.cancel(); callbacks.error(); };
    this.recorder.onstop = async () => {
      this.video.getTracks().forEach(track => track.stop());
      if (!this.cancelled) {
        const type = this.recorder.mimeType;
        const blob = new Blob(this.chunks, { type });
        this.chunks = [];
        if (blob.size) {
          try {
            const result = await withWebMDuration(blob, (this.stoppedAt || performance.now()) - this.startedAt);
            if (!this.cancelled) callbacks.complete(result, type.includes('mp4') ? 'mp4' : 'webm');
          } catch { if (!this.cancelled) callbacks.error(); }
        } else callbacks.error();
      }
    };
  }

  draw(source: HTMLCanvasElement, hud: VideoOverlay) {
    if (this.startedAt && performance.now() - this.startedAt > 300_000) throw new Error('Recording time limit');
    const now = performance.now();
    if (now - this.drawnAt < 1000 / VIDEO_FPS) return;
    this.drawnAt = now;
    drawVideoFrame(this.context, source, hud);
  }

  start() { this.recorder.start(1000); this.startedAt = performance.now(); }
  stop() {
    if (this.recorder.state !== 'inactive') { this.stoppedAt = performance.now(); this.recorder.stop(); }
  }
  cancel() {
    this.cancelled = true;
    this.chunks = [];
    this.stop();
    this.video.getTracks().forEach(track => track.stop());
  }
}

