import { AUDIO_CHANNELS } from './battleAudio';
import type { useBattleAudio } from './useBattleAudio';
import { text } from './text';

const copy = text.audio;

export function AudioControls({ audio }: { audio: ReturnType<typeof useBattleAudio> }) {
  return (
    <div className="audio-controls" role="group" aria-label={copy.title}>
      <button type="button" className={audio.enabled ? 'audio-toggle active' : 'audio-toggle'}
        aria-pressed={audio.enabled} onClick={audio.toggle}>
        <span className="audio-indicator" aria-hidden="true" />
        {audio.enabled ? copy.disable : copy.enable}
      </button>
      <Volume label={copy.master} value={audio.settings.master} onChange={audio.setMaster} />
      <details className="audio-mixer">
        <summary>{copy.mixer}</summary>
        <div className="audio-channels">
          {AUDIO_CHANNELS.map(channel => (
            <Volume key={channel} label={copy.channels[channel]} value={audio.settings.channels[channel]}
              onChange={value => audio.setChannel(channel, value)} />
          ))}
        </div>
      </details>
      {audio.enabled && audio.awaitingGesture && !audio.error
        && <span role="status" className="audio-hint">{copy.awaitingGesture}</span>}
      {audio.error && <span role="status" className="audio-error">{audio.error}</span>}
    </div>
  );
}

function Volume({ label, value, onChange }: {
  label: string; value: number; onChange: (value: number) => void;
}) {
  return (
    <label className="audio-volume">
      <span>{label}</span>
      <input type="range" min="0" max="100" step="1" value={Math.round(value * 100)}
        onChange={event => onChange(Number(event.target.value) / 100)} />
      <output>{Math.round(value * 100)}%</output>
    </label>
  );
}
