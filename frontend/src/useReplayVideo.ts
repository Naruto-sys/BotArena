import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReplayVideoRecorder, videoMimeType } from './replayVideo';
import type { VideoOverlay } from './replayVideo';
import type { Replay } from './contracts';
import type { AudioCapture } from './battleAudio';
import type { useBattleAudio } from './useBattleAudio';
import { text } from './text';

type Phase = 'idle' | 'preparing' | 'recording' | 'finishing' | 'ready';
interface Session {
  epoch: number;
  before: { position: number; playing: boolean };
  audio: AudioCapture | null;
  audioReady: boolean;
  frames: number;
  recorder: ReplayVideoRecorder | null;
  phase: Phase;
  timer?: ReturnType<typeof setTimeout>;
}

export function useReplayVideo(options: {
  replay: Replay;
  position: number;
  playing: boolean;
  visualEnd: number;
  audio: ReturnType<typeof useBattleAudio>;
  overlay: VideoOverlay;
  reset: () => void;
  play: () => void;
  pause: () => void;
  restore: (state: { position: number; playing: boolean }) => void;
}) {
  const current = useRef(options); current.current = options;
  const session = useRef<Session | null>(null);
  const epoch = useRef(0);
  const download = useRef('');
  const [captureEpoch, setCaptureEpoch] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [url, setUrl] = useState('');
  const [filename, setFilename] = useState('');
  const [error, setError] = useState('');
  const supported = useMemo(() => Boolean(videoMimeType(options.audio.enabled)), [options.audio.enabled]);
  const busy = phase === 'preparing' || phase === 'recording' || phase === 'finishing';

  const cancel = useCallback((message = '') => {
    const active = session.current;
    if (!active) return;
    session.current = null;
    clearTimeout(active.timer);
    active.recorder?.cancel();
    active.audio?.release();
    current.current.restore(active.before);
    setPhase('idle'); setError(message);
  }, []);

  useEffect(() => {
    setPhase('idle'); setError(''); setUrl('');
    const onHide = () => { if (document.hidden) cancel(text.video.hidden); };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      const active = session.current;
      session.current = null;
      if (active) {
        clearTimeout(active.timer); active.recorder?.cancel(); active.audio?.release();
      }
      if (download.current) URL.revokeObjectURL(download.current);
      download.current = '';
    };
  }, [options.replay, cancel]);

  const start = () => {
    if (session.current || !supported) return;
    if (download.current) URL.revokeObjectURL(download.current);
    download.current = ''; setUrl(''); setError('');
    const opts = current.current;
    const active: Session = { epoch: ++epoch.current,
      before: { position: opts.position, playing: opts.playing }, audio: null,
      audioReady: false, frames: 0, recorder: null, phase: 'preparing' };
    session.current = active;
    setCaptureEpoch(active.epoch); setPhase('preparing');
    opts.reset();
    // Start resume synchronously in the export button's user gesture.
    const capture = opts.audio.capture();
    void capture.then(audio => {
      if (session.current !== active) { audio?.release(); return; }
      active.audio = audio; active.audioReady = true;
    }).catch(() => { if (session.current === active) cancel(text.video.audioError); });
    active.timer = setTimeout(() => {
      if (session.current === active && active.phase === 'preparing') cancel(text.video.error);
    }, 15000);
  };

  const onRenderFrame = useCallback((source: HTMLCanvasElement, renderedEpoch: number) => {
    const active = session.current;
    const opts = current.current;
    if (!active || active.epoch !== renderedEpoch) return;
    try {
      if (active.phase === 'preparing') {
        if (opts.position !== 0 || !active.audioReady || ++active.frames < 2) return;
        clearTimeout(active.timer);
        active.recorder = new ReplayVideoRecorder(active.audio?.stream ?? null, {
          complete: (blob, extension) => {
            if (session.current !== active) return;
            session.current = null;
            clearTimeout(active.timer); active.audio?.release();
            download.current = URL.createObjectURL(blob);
            setUrl(download.current);
            setFilename(`botarena-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`);
            setPhase('ready');
            current.current.restore(active.before);
          },
          error: () => { if (session.current === active) cancel(text.video.error); },
        });
        active.recorder.draw(source, opts.overlay);
        active.recorder.start(); active.phase = 'recording'; setPhase('recording'); opts.play();
      } else {
        active.recorder?.draw(source, opts.overlay);
        if (active.phase === 'recording' && opts.position >= opts.visualEnd) {
          active.phase = 'finishing'; setPhase('finishing'); opts.pause();
          active.timer = setTimeout(() => active.recorder?.stop(), 200);
        }
      }
    } catch { cancel(text.video.error); }
  }, [cancel]);

  return { supported, busy, phase, captureEpoch, onRenderFrame, start, cancel: () => cancel(),
    url, filename, error, progress: Math.min(100, Math.floor(options.position / Math.max(1, options.visualEnd) * 100)) };
}
