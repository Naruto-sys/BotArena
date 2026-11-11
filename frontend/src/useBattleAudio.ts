import { useCallback, useEffect, useRef, useState } from 'react';
import { BattleAudio, DEFAULT_AUDIO_SETTINGS } from './battleAudio';
import type { AudioChannel, AudioSettings, AudioTransport } from './battleAudio';
import type { Replay } from './contracts';
import { text } from './text';

export function useBattleAudio(replay: Replay, transport: () => AudioTransport) {
  const director = useRef<BattleAudio | null>(null);
  const currentTransport = useRef(transport);
  currentTransport.current = transport;
  const wanted = useRef(true);
  const startAudio = useRef<(() => void) | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [awaitingGesture, setAwaitingGesture] = useState(true);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<AudioSettings>(DEFAULT_AUDIO_SETTINGS);

  useEffect(() => {
    const audio = new BattleAudio(replay);
    director.current = audio;
    let alive = true;
    let unlocked = false;
    setError('');
    setAwaitingGesture(wanted.current);
    const activate = (force = false) => {
      if (!wanted.current || (!force && unlocked)) return;
      void audio.enable().then(started => {
        if (!alive || !wanted.current || !started) return;
        unlocked = true;
        setError('');
        setAwaitingGesture(false);
        audio.update(currentTransport.current(), !document.hidden);
      }).catch(() => {
        if (!alive || !wanted.current) return;
        audio.disable();
        setAwaitingGesture(false);
        setError(text.audio.unavailable);
      });
    };
    startAudio.current = () => activate(true);
    const onGesture = () => activate();
    // A click on "Start match" usually grants sticky activation already. If it
    // does not, retry resume synchronously inside the next pointer/key gesture.
    document.addEventListener('pointerdown', onGesture, true);
    document.addEventListener('keydown', onGesture, true);
    activate();
    let animation: number;
    const update = () => {
      audio.update(currentTransport.current(), !document.hidden);
      animation = requestAnimationFrame(update);
    };
    animation = requestAnimationFrame(update);
    const hide = () => {
      if (document.hidden) audio.update({ ...currentTransport.current(), playing: false }, false);
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      alive = false;
      cancelAnimationFrame(animation);
      document.removeEventListener('pointerdown', onGesture, true);
      document.removeEventListener('keydown', onGesture, true);
      document.removeEventListener('visibilitychange', hide);
      startAudio.current = null;
      director.current = null;
      audio.dispose();
    };
  }, [replay]);

  useEffect(() => { director.current?.applySettings(settings); }, [settings, replay]);

  const toggle = () => {
    const audio = director.current;
    if (!audio) return;
    const next = !wanted.current;
    wanted.current = next;
    setEnabled(next);
    setAwaitingGesture(next);
    setError('');
    if (next) startAudio.current?.();
    else audio.disable();
  };
  const seek = useCallback((position: number) => { director.current?.seek(position); }, []);
  const capture = useCallback(() => {
    if (!wanted.current) return Promise.resolve(null);
    const audio = director.current;
    if (!audio) return Promise.reject(new Error('Audio unavailable'));
    return audio.capture();
  }, []);
  const setMaster = (master: number) => setSettings(value => ({ ...value, master }));
  const setChannel = (channel: AudioChannel, volume: number) => setSettings(value => ({
    ...value, channels: { ...value.channels, [channel]: volume },
  }));
  return { enabled, awaitingGesture, error, settings, toggle, seek, setMaster, setChannel, capture };
}
