import { useEffect, useMemo, useRef, useState } from 'react';
import type { Arena, Frame, Replay } from './contracts';
import { arenaViewBox } from './ArenaCoordinates';
import { BlueprintArena, tacticalPhase, tacticalPhaseLabel } from './BlueprintArena';
import type { CameraMode } from './BlueprintArena';
import { AudioControls } from './AudioControls';
import { useBattleAudio } from './useBattleAudio';
import { useReplayVideo } from './useReplayVideo';
import { buildShotPlan, directorPlaybackRate, shotAt, VISUAL_TAIL_FRAMES } from './cinematicDirector';
import { botColor, botLabel as rosterBotLabel, resolveTeamId, teamWon } from './botDisplay';
import { botCssColor, botLabel as cinematicBotLabel } from './botVisuals';
import { text } from './text';
import { loadCameraMode, saveCameraMode } from './replayPreferences';
import { platformText as ui } from './text';

const copy = text.replay;
const speeds = [0.5, 1, 2, 4];
const DAMAGE_LIFE = 30;
const fixedCameras: Array<{ mode: CameraMode; label: string }> = [
  { mode: 'auto', label: 'Кино' },
  { mode: 'adaptive', label: 'Разрез' },
  { mode: 'plan', label: 'План' },
  { mode: 'overview', label: 'Сверху' },
  { mode: 'perception', label: 'Восприятие' },
  { mode: 'timeline', label: 'Башня времени' },
];

function collectDamageNumbers(frames: Frame[], index: number, fraction: number) {
  const start = Math.max(0, index - DAMAGE_LIFE);
  const items: Array<{ key: string; x: number; y: number; damage: number; age: number; zone: boolean }> = [];
  for (let frameIndex = start; frameIndex <= index; frameIndex++) {
    const age = index - frameIndex + fraction;
    for (const event of frames[frameIndex].events) {
      if ((event.type !== 'BotHit' && event.type !== 'BotDestroyed' && event.type !== 'ZoneDamage') ||
        event.damage == null || event.damage <= 0 || !event.position) continue;
      items.push({
        key: `${frameIndex}-${event.type}-${event.bulletId ?? 0}-${event.targetBotId ?? ''}-${event.damage}`,
        x: event.position.x,
        y: event.position.y,
        damage: event.damage,
        age,
        zone: event.type === 'ZoneDamage',
      });
    }
  }
  return items;
}

function ReplayEffectsOverlay({ arena, damageNumbers, finished }: {
  arena: Arena;
  damageNumbers: Array<{ key: string; x: number; y: number; damage: number; age: number; zone: boolean }>;
  finished: boolean;
}) {
  // Capture zones live in the 3D scene so cinema / section / plan / overview stay aligned.
  if (damageNumbers.length === 0) return null;
  return (
    <svg className="replay-effects-overlay" viewBox={arenaViewBox(arena.width, arena.height)} aria-hidden="true">
      {!finished && damageNumbers.map(item => (
        <text
          key={item.key}
          className={item.zone ? 'arena-damage arena-damage-zone' : 'arena-damage'}
          x={item.x}
          y={item.y - 0.35 - item.age * 0.045}
          textAnchor="middle"
          opacity={Math.max(0, 1 - item.age / DAMAGE_LIFE)}
        >
          -{item.damage}
        </text>
      ))}
    </svg>
  );
}

export function ReplayPlayer({ replay, botNames, onComplete }: {
  replay: Replay; botNames?: Record<string, string>; onComplete?: () => void;
}) {
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(0.5);
  const [cameraMode, setCameraMode] = useState<CameraMode>(() => loadCameraMode(replay.frames[0]?.bots.map(bot => bot.id) ?? []));
  const [showTrails, setShowTrails] = useState(true);
  const [showChronoXray, setShowChronoXray] = useState(true);
  const [showTacticalTrace, setShowTacticalTrace] = useState(false);
  const [traceBotId, setTraceBotId] = useState(replay.frames[0]?.bots[0]?.id ?? '');
  const heldChronoShots = useRef(new Set<string>());
  const chronoHoldUntil = useRef(0);
  const completionReported = useRef(false);
  const shotPlan = useMemo(() => buildShotPlan(replay), [replay]);
  const botIds = useMemo(() => [...new Set(replay.frames.flatMap(frame => frame.bots.map(bot => bot.id)))], [replay]);
  const multiple = botIds.length > 2;
  const cameraOptions = useMemo(() => [
    ...fixedCameras,
    ...botIds.map(id => ({ mode: `bot:${id}` as CameraMode, label: cinematicBotLabel(id, multiple) })),
  ], [botIds, multiple]);
  const lastFrame = replay.frames.length - 1;
  const visualEnd = lastFrame + VISUAL_TAIL_FRAMES;
  const finished = position >= visualEnd;
  const audio = useBattleAudio(replay, () => ({
    position,
    playing: playing && !finished,
    frozen: showChronoXray && (cameraMode === 'auto' || cameraMode === 'adaptive')
      && performance.now() < chronoHoldUntil.current,
    rate: speed * (cameraMode === 'auto' || cameraMode === 'adaptive'
      ? directorPlaybackRate(shotPlan, position) : 1),
  }));

  useEffect(() => {
    completionReported.current = false;
    heldChronoShots.current.clear();
    chronoHoldUntil.current = 0;
    setPosition(0);
    setPlaying(true);
    setSpeed(0.5);
    setTraceBotId(replay.frames[0]?.bots[0]?.id ?? '');
  }, [replay]);

  useEffect(() => {
    if (!finished || completionReported.current) return;
    completionReported.current = true;
    onComplete?.();
  }, [finished, onComplete]);

  useEffect(() => {
    if (cameraMode.startsWith('bot:') && !botIds.includes(cameraMode.slice(4))) {
      setCameraMode('plan');
    }
  }, [botIds, cameraMode]);

  useEffect(() => {
    if (!botIds.includes(traceBotId)) setTraceBotId(botIds[0] ?? '');
  }, [botIds, traceBotId]);

  useEffect(() => {
    if (!playing || finished) return;
    let animation: number;
    let previous: number | undefined;

    function advance(now: number) {
      const elapsed = previous === undefined ? 0 : now - previous;
      previous = now;
      setPosition(current => {
        const directorMode = cameraMode === 'auto' || cameraMode === 'adaptive';
        const shot = directorMode ? shotAt(shotPlan, current) : undefined;
        const reachedChronoEvent = shot?.eventFrame != null && current >= shot.eventFrame;
        if (showChronoXray && reachedChronoEvent
          && (shot.kind === 'impact' || shot.kind === 'finale')
          && !heldChronoShots.current.has(shot.id)) {
          heldChronoShots.current.add(shot.id);
          chronoHoldUntil.current = now + 1_050;
        }
        const cinematicRate = now < chronoHoldUntil.current ? 0
          : directorMode ? directorPlaybackRate(shotPlan, current) : 1;
        return Math.min(visualEnd, current + elapsed * replay.tickRate * speed * cinematicRate / 1000);
      });
      animation = requestAnimationFrame(advance);
    }

    animation = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(animation);
  }, [playing, finished, visualEnd, replay.tickRate, speed, cameraMode, shotPlan, showChronoXray]);

  const index = Math.min(lastFrame, Math.floor(position));
  const frame = replay.frames[index];
  const next = replay.frames[Math.min(lastFrame, index + 1)];
  const fraction = position < lastFrame ? position - Math.floor(position) : 0;
  const roster = frame.bots;
  const damageNumbers = collectDamageNumbers(replay.frames, index, fraction);
  const displayLabel = (botId: string, teamId?: string) =>
    rosterBotLabel(botId, teamId, roster, botNames);
  const winnerBotId = replay.result.winnerBotId;
  const winnerTeamId = replay.result.winnerTeamId;
  const outcome = teamWon(replay.result)
    ? (winnerTeamId === 'player' && roster.filter(bot => resolveTeamId(bot) === 'player').length > 1
      ? copy.teamWin
      : copy.winner(displayLabel(winnerBotId ?? 'player', 'player')))
    : winnerBotId
      ? copy.winner(displayLabel(winnerBotId, roster.find(bot => bot.id === winnerBotId)?.teamId))
      : copy.draw;
  const reason = !winnerBotId && !winnerTeamId && replay.result.reason === 'BotDestroyed'
    ? (multiple ? copy.allDestroyed : copy.doubleKnockout)
    : copy.reason[replay.result.reason];
  const activeShot = shotAt(shotPlan, position);
  const cinematicFocus = (cameraMode === 'auto' || cameraMode === 'adaptive')
    && (activeShot?.kind === 'projectile' || activeShot?.kind === 'gunner'
      || activeShot?.kind === 'impact' || activeShot?.kind === 'finale');
  const gunnerView = (cameraMode === 'auto' || cameraMode === 'adaptive') && activeShot?.kind === 'gunner';
  const chronoMoment = showChronoXray && (cameraMode === 'auto' || cameraMode === 'adaptive')
    && activeShot?.eventFrame != null
    && (activeShot.kind === 'impact' || activeShot.kind === 'finale')
    && position >= activeShot.eventFrame && position <= activeShot.eventFrame + 1.35;
  const shotNumber = activeShot ? shotPlan.shots.indexOf(activeShot) + 1 : 0;
  const traceSample = useMemo(() => (replay.behaviorSamples ?? [])
    .filter(sample => sample.botId === traceBotId && sample.tick <= frame.tick)
    .at(-1), [replay.behaviorSamples, traceBotId, frame.tick]);
  const tracePhase = traceSample ? tacticalPhase(traceSample) : undefined;
  const traceMovement = frame.bots.find(bot => bot.id === traceBotId)?.movement ?? 'tracked';
  const traceCommands: Array<[string, number]> = traceSample
    ? traceMovement === 'tracked'
      ? [['L', traceSample.action.leftTrack], ['R', traceSample.action.rightTrack]]
      : traceMovement === 'wheeled'
        ? [['V', traceSample.action.throttle ?? 0], ['T', traceSample.action.turn ?? 0]]
        : [['X', traceSample.action.thrust?.x ?? 0], ['Y', traceSample.action.thrust?.y ?? 0],
          ['T', traceSample.action.turn ?? 0]]
    : [];
  const lastVisibleSample = useMemo(() => (replay.behaviorSamples ?? [])
    .filter(sample => sample.botId === traceBotId && sample.tick <= frame.tick && sample.enemyVisible)
    .at(-1), [replay.behaviorSamples, traceBotId, frame.tick]);
  const perceptionEnemy = frame.bots.find(bot => bot.id !== traceBotId);
  const perceptionHasContact = traceSample?.enemyVisible === true && (perceptionEnemy?.hp ?? 0) > 0;
  const lostContactSeconds = lastVisibleSample
    ? Math.max(0, frame.tick - lastVisibleSample.tick) / replay.tickRate : undefined;
  const formatTrack = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}`;
  const resetPlayback = () => {
    heldChronoShots.current.clear();
    chronoHoldUntil.current = 0;
  };
  const video = useReplayVideo({
    replay, position, playing, visualEnd, audio,
    overlay: {
      title: `BOT ARENA / ${cameraOptions.find(option => option.mode === cameraMode)?.label ?? 'REPLAY'}`,
      time: copy.time(Math.min(position, lastFrame) / replay.tickRate, lastFrame / replay.tickRate),
      cue: (cameraMode === 'auto' || cameraMode === 'adaptive') ? activeShot?.label
        : cameraMode === 'perception' ? `ВОСПРИЯТИЕ · ${cinematicBotLabel(traceBotId, multiple)}`
        : cameraMode === 'timeline' ? 'БАШНЯ ВРЕМЕНИ' : undefined,
      badge: chronoMoment ? 'CHRONO X-RAY · TIME LOCK' : gunnerView ? 'GUNNER POV' : undefined,
      result: position >= lastFrame ? copy.outcome(outcome, reason) : undefined,
      letterbox: cinematicFocus, gunner: gunnerView,
      bots: frame.bots.map(bot => ({ label: displayLabel(bot.id, bot.teamId),
        color: botNames ? botColor(bot, roster) : botCssColor(bot.id), hp: bot.hp, maxHp: bot.maxHp,
        forfeited: bot.forfeited })),
    },
    reset: () => { resetPlayback(); audio.seek(0); setPosition(0); setPlaying(false); },
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    restore: before => {
      resetPlayback(); audio.seek(before.position); setPosition(before.position); setPlaying(before.playing);
    },
  });
  const seekReplay = (nextPosition: number) => {
    if (video.busy) return;
    audio.seek(nextPosition);
    setPlaying(false);
    heldChronoShots.current.clear();
    chronoHoldUntil.current = 0;
    setPosition(nextPosition);
  };

  return (
    <>
      <div className={`arena-stage blueprint-stage${cinematicFocus ? ' cinematic-focus' : ''}`
        + `${video.busy ? ' video-exporting' : ''}`
        + `${gunnerView ? ' gunner-mode' : ''}`
        + `${cameraMode === 'perception' ? ' perception-mode' : ''}`
        + `${cameraMode === 'timeline' ? ' timeline-mode' : ''}`}>
        <BlueprintArena replay={replay} frame={frame} next={next} fraction={fraction}
          position={position} cameraMode={cameraMode} showTrails={showTrails} shotPlan={shotPlan}
          showChronoXray={showChronoXray} showTacticalTrace={showTacticalTrace}
          traceBotId={traceBotId} perceptionBotId={traceBotId} onSeek={seekReplay}
          captureEpoch={video.captureEpoch} captureActive={video.busy} onRenderFrame={video.onRenderFrame} />
        {!gunnerView && <ReplayEffectsOverlay
          arena={replay.arena}
          damageNumbers={damageNumbers}
          finished={finished}
        />}
        <div className="blueprint-hud" aria-hidden="true">
          <span>{cameraMode === 'perception' ? `BOT PERCEPTION / ${cinematicBotLabel(traceBotId, multiple)}`
            : cameraMode === 'timeline' ? 'CHRONOSPACE / TIME TOWER'
            : (cameraMode === 'auto' || cameraMode === 'adaptive') && activeShot
            ? `${cameraMode === 'adaptive' ? 'SECTION DIRECTOR' : 'CINEMA DIRECTOR'} / ${activeShot.label}`
            : 'BA–25 / REPLAY VISUALIZER'}</span>
          <span>{String(frame.tick).padStart(3, '0')}F</span>
        </div>
        {(cameraMode === 'auto' || cameraMode === 'adaptive') && activeShot && (
          <div className="director-cue" aria-hidden="true">
            <span>CUT {String(shotNumber).padStart(2, '0')} / {String(shotPlan.shots.length).padStart(2, '0')}</span>
            <strong>{activeShot.label}</strong>
            <em>{gunnerView ? 'GUNNER POV · ВЫСТРЕЛ'
              : cameraMode === 'adaptive'
              ? `DYNAMIC SECTION${activeShot.playbackRate < 1 ? ` · ${activeShot.playbackRate.toFixed(2)}×` : ''}`
              : activeShot.playbackRate < 1
              ? `${activeShot.playbackRate.toFixed(2)}× TIME` : 'CINEMA MODE'}</em>
          </div>
        )}
        {chronoMoment && (
          <div className="chrono-badge" aria-hidden="true">
            <strong>CHRONO X‑RAY</strong>
            <span>TIME LOCK · IMPACT VOLUME</span>
          </div>
        )}
        {showTacticalTrace && !gunnerView && cameraMode !== 'perception' && cameraMode !== 'timeline'
          && traceSample && tracePhase && (
          <div className={`tactical-readout phase-${tracePhase}`} aria-hidden="true">
            <span>TACTICAL TRACE / {cinematicBotLabel(traceBotId, multiple)}</span>
            <strong>{tacticalPhaseLabel(tracePhase)}</strong>
            {traceCommands.map(([command, value]) => (
              <div className="track-command" key={command}>
                <b>{command}</b>
                <i><u className={value < 0 ? 'reverse' : undefined}
                  style={{ width: `${Math.abs(value) * 100}%` }} /></i>
                <em>{formatTrack(value)}</em>
              </div>
            ))}
            <small>ШИРИНА ЛЕНТЫ — ТЯГА · ФИОЛЕТОВЫЙ — НАВЕДЕНИЕ · ЯНТАРНЫЙ — ОГОНЬ</small>
          </div>
        )}
        {cameraMode === 'perception' && traceSample && (
          <div className={`perception-readout ${perceptionHasContact ? 'contact' : 'lost'}`} aria-hidden="true">
            <span>PERCEPTION FEED / {cinematicBotLabel(traceBotId, multiple)}</span>
            <strong>{perceptionHasContact ? 'ЦЕЛЬ ВИДНА'
              : lastVisibleSample ? `КОНТАКТ ПОТЕРЯН · ${lostContactSeconds?.toFixed(1)}s`
              : 'ЦЕЛЬ НЕ ОБНАРУЖЕНА'}</strong>
            <small>ТЁМНЫЕ СЕКТОРЫ — ИНФОРМАЦИОННАЯ ТЕНЬ · ЯНТАРНЫЙ КОНТУР — ПОСЛЕДНИЙ КОНТАКТ</small>
          </div>
        )}
        {cameraMode === 'timeline' && (
          <div className="timeline-readout" aria-hidden="true">
            <span>SPACETIME RECONSTRUCTION</span>
            <strong>T+{(Math.min(position, lastFrame) / replay.tickRate).toFixed(2)}s</strong>
            <small>Y = ВРЕМЯ · ЛЕНТЫ = ТАНКИ · ЯНТАРНЫЕ СВЯЗИ = ВЫСТРЕЛЫ · КЛИК = ПЕРЕЙТИ К КАДРУ</small>
          </div>
        )}
        <div className="blueprint-reticle" aria-hidden="true"><i /><i /></div>
        {finished && <p role="status" className="outcome">{copy.outcome(outcome, reason)}</p>}
      </div>
      <fieldset className="replay-settings" disabled={video.busy}>
      <div className="director-bar">
        <div className="camera-modes" role="group" aria-label="Режим камеры">
          {cameraOptions.map(({ mode, label }) => (
            <button type="button" key={mode} className={cameraMode === mode ? 'active' : undefined}
              aria-pressed={cameraMode === mode} onClick={() => { setCameraMode(mode); saveCameraMode(mode); }}>
              {(mode === 'auto' || mode === 'adaptive') && <span className="live-dot" />}
              {label}
            </button>
          ))}
        </div>
      </div>
<details className="replay-toolbox"><summary>{ui.analysis}</summary>
        <label className="trail-toggle">
          <input type="checkbox" checked={showTrails}
            onChange={event => setShowTrails(event.target.checked)} />
          Траектории
        </label>
        <div className="visual-layers">
          <label className="trail-toggle">
            <input type="checkbox" checked={showChronoXray}
              onChange={event => setShowChronoXray(event.target.checked)} />
            Chrono X‑Ray
          </label>
          <label className="trail-toggle">
            <input type="checkbox" checked={showTacticalTrace}
              onChange={event => setShowTacticalTrace(event.target.checked)} />
            Тактический след
          </label>
          {(showTacticalTrace || cameraMode === 'perception') && botIds.length > 1 && (
            <select aria-label="Бот для анализа" value={traceBotId}
              onChange={event => setTraceBotId(event.target.value)}>
              {botIds.map(id => <option key={id} value={id}>{cinematicBotLabel(id, multiple)}</option>)}
            </select>
          )}
        </div>
</details>
      <div className="controls replay-controls">
        <button type="button" onClick={() => {
          if (video.busy) return;
          if (finished) {
            heldChronoShots.current.clear();
            chronoHoldUntil.current = 0;
            setPosition(0);
            audio.seek(0);
          }
          setPlaying(finished || !playing);
        }}>{finished ? copy.restart : playing ? copy.pause : copy.resume}</button>
        <input aria-label={copy.position} type="range" min="0" max={visualEnd} step="0.01" value={position} onChange={event => {
          seekReplay(Number(event.target.value));
        }} />
        <output>{copy.time(Math.min(position, lastFrame) / replay.tickRate, lastFrame / replay.tickRate)}</output>
        <select aria-label={copy.speed} value={speed} onChange={event => setSpeed(Number(event.target.value))}>
          {speeds.map(value => <option key={value} value={value}>{copy.speedOption(value)}</option>)}
        </select>
      </div>
      <details className="replay-toolbox"><summary>{ui.audio}</summary><AudioControls audio={audio} /></details>
      </fieldset>
      <details className="replay-toolbox"><summary>{ui.export}</summary><div className="video-export" aria-label={text.video.title}>
        <button type="button" className="video-export-start" disabled={!video.supported || video.busy} onClick={video.start}>
          {video.phase === 'preparing' ? text.video.preparing : video.phase === 'finishing' ? text.video.finishing
            : video.phase === 'recording' ? text.video.recording(video.progress) : text.video.start}
        </button>
        {video.busy && <>
          <progress aria-label={text.video.title} max="100" value={video.phase === 'finishing' ? 100 : video.progress} />
          <button type="button" onClick={video.cancel}>{text.video.cancel}</button>
        </>}
        {video.url && <a className="video-download" href={video.url} download={video.filename}>{text.video.download}</a>}
        <small>{!video.supported ? text.video.unsupported : video.busy ? text.video.keepOpen : text.video.description}</small>
        {video.error && <p role="alert" className="error">{video.error}</p>}
        {video.phase === 'ready' && <span role="status">{text.video.ready}</span>}
      </div>
      </details>
      <ul className="health" aria-label={copy.health}>
        {frame.bots.map(bot => {
          const label = displayLabel(bot.id, bot.teamId);
          const color = botNames ? botColor(bot, roster) : botCssColor(bot.id);
          return (
            <li key={bot.id} style={{ color }}>
              <span>
                {label}
                {bot.movement && <small>{text.movements[bot.movement]}</small>}
              </span>
              <meter aria-label={label} min={0} max={bot.maxHp} value={bot.hp} />
              <b>{bot.forfeited ? copy.forfeited : copy.hp(bot.hp, bot.maxHp)}</b>
            </li>
          );
        })}
      </ul>
    </>
  );
}
