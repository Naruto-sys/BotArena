import { useEffect, useId, useState } from 'react';
import type { Arena, Bot, ConsumableType, Frame, Point, Replay, SurfaceType } from './contracts';
import { text } from './text';

const colors = { player: '#3dc9f1', opponent: '#ff9a45' };
const copy = text.replay;
const speeds = [0.5, 1, 2, 4];
const surfaceColors: Record<SurfaceType, string> = {
  Ground: '#142234', Sand: '#705432', Snow: '#78929f', Ice: '#245e7a',
};
const itemSymbols: Record<ConsumableType, string> = { Repair: '+', Shield: '◇', SpeedBoost: '↑', Coolant: '❄', Smoke: '≈' };
const itemColors: Record<ConsumableType, string> = {
  Repair: '#79e6a5', Shield: '#75c8ff', SpeedBoost: '#ffd06b', Coolant: '#b7efff', Smoke: '#d8c9f4',
};

function positionBetween(start: Point, end: Point, fraction: number): Point {
  return { x: start.x + (end.x - start.x) * fraction, y: start.y + (end.y - start.y) * fraction };
}

function angleBetween(start: number, end: number, fraction: number): number {
  const turn = Math.atan2(Math.sin(end - start), Math.cos(end - start));
  return (start + turn * fraction) * 180 / Math.PI;
}

function ArenaView({ arena, frame, next, fraction, finished, winner }: {
  arena: Arena; frame: Frame; next: Frame; fraction: number; finished: boolean; winner: Bot['id'] | null;
}) {
  const haloId = useId();
  return (
    <svg className="arena" viewBox={`0 0 ${arena.width} ${arena.height}`} role="img" aria-label={copy.imageLabel}>
      <defs>
        {winner && <radialGradient id={haloId}>
          <stop offset="0%" stopColor={colors[winner]} stopOpacity=".65" />
          <stop offset="65%" stopColor={colors[winner]} stopOpacity=".3" />
          <stop offset="100%" stopColor={colors[winner]} stopOpacity="0" />
        </radialGradient>}
        <pattern id="grid" width={arena.cellSize ?? 1} height={arena.cellSize ?? 1} patternUnits="userSpaceOnUse">
          <path d={`M ${arena.cellSize ?? 1} 0 H 0 V ${arena.cellSize ?? 1}`} fill="none" stroke="#253b51" strokeWidth=".04" />
        </pattern>
      </defs>
      <rect width={arena.width} height={arena.height} fill={surfaceColors.Ground} />
      {(arena.cells ?? []).map(cell => <rect key={`${cell.x}-${cell.y}`}
        x={cell.x * arena.cellSize} y={cell.y * arena.cellSize}
        width={Math.min(arena.cellSize, arena.width - cell.x * arena.cellSize)}
        height={Math.min(arena.cellSize, arena.height - cell.y * arena.cellSize)}
        fill={surfaceColors[cell.surface]}>
        <title>{copy.surfaces[cell.surface]}{cell.fog ? ` · ${copy.fog}` : ''}</title>
      </rect>)}
      <rect width={arena.width} height={arena.height} fill="url(#grid)" />
      {arena.walls.map((wall, i) => <rect key={i} {...wall} rx=".08" fill="#273e58" stroke="#476383" strokeWidth=".05" />)}
      {(arena.cells ?? []).filter(cell => cell.fog).map(cell => <rect key={`fog-${cell.x}-${cell.y}`}
        x={cell.x * arena.cellSize} y={cell.y * arena.cellSize}
        width={Math.min(arena.cellSize, arena.width - cell.x * arena.cellSize)}
        height={Math.min(arena.cellSize, arena.height - cell.y * arena.cellSize)}
        fill="#d7e3ec" fillOpacity=".22" pointerEvents="none" />)}
      {(frame.items ?? []).map(item => <g key={`item-${item.id}`}
        transform={`translate(${item.position.x} ${item.position.y})`}>
        <title>{copy.items[item.type]}</title>
        <rect x="-.2" y="-.2" width=".4" height=".4" rx=".07" fill="#101c2b"
          stroke={itemColors[item.type]} strokeWidth=".045" />
        <text textAnchor="middle" dominantBaseline="central" fontSize=".3" fill={itemColors[item.type]}>
          {itemSymbols[item.type]}
        </text>
      </g>)}
      {(frame.smokeClouds ?? []).map(cloud => <circle key={`smoke-${cloud.id}`}
        cx={cloud.position.x} cy={cloud.position.y} r={cloud.radius} fill="#aeb7c9" fillOpacity=".3"
        stroke="#ced5e3" strokeWidth=".03" strokeDasharray=".12 .1"><title>{copy.smoke}</title></circle>)}
      {frame.bullets.map(bullet => {
        const end = next.bullets.find(b => b.id === bullet.id) ?? bullet;
        const { x, y } = positionBetween(bullet.position, end.position, fraction);
        const degrees = Math.atan2(bullet.direction.y, bullet.direction.x) * 180 / Math.PI;
        return <rect key={bullet.id} x="-.095" y="-.045" width=".19" height=".09"
          transform={`translate(${x} ${y}) rotate(${degrees})`} fill={colors[bullet.ownerBotId]} />;
      })}
      {frame.events.map((event, index) => event.type === 'BeamFired' && event.position && event.endPosition
        ? <line key={`beam-${index}`} x1={event.position.x} y1={event.position.y}
          x2={event.endPosition.x} y2={event.endPosition.y} stroke="#d9f5ff" strokeWidth=".06"
          opacity={1 - fraction * 0.8} />
        : null)}
      {!finished && frame.events.map((event, index) => {
        if (!['ShotFired', 'BotHit', 'BotDestroyed', 'ProjectileLanded', 'ItemPickedUp', 'ItemUsed', 'BotRepaired'].includes(event.type)) return null;
        if (!event.position || event.type === 'MatchFinished' || event.type === 'BeamFired'
          || event.type === 'WeaponChargeStarted' || event.type === 'WeaponReady'
          || event.type === 'SurfaceChanged' || event.type === 'FogEntered' || event.type === 'FogExited') return null;
        if (event.type === 'ProjectileLanded' && event.radius !== null) {
          return <circle key={index} cx={event.position.x} cy={event.position.y} r={event.radius}
            fill="#e7ab55" fillOpacity={0.15 * (1 - fraction)} stroke="#e7ab55" strokeWidth=".06"
            opacity={1 - fraction * 0.8} />;
        }
        const hit = event.type === 'BotHit' || event.type === 'BotDestroyed';
        return <circle key={index} cx={event.position.x} cy={event.position.y}
          r={(hit ? 0.25 : 0.12) + fraction * 0.35} fill="none"
          stroke={hit ? '#fff3d0' : '#e7ab55'} strokeWidth=".06" opacity={1 - fraction * 0.8} />;
      })}
      {frame.bots.map(bot => {
        const end = next.bots.find(b => b.id === bot.id) ?? bot;
        const { x, y } = positionBetween(bot.position, end.position, fraction);
        const hull = angleBetween(bot.bodyAngle, end.bodyAngle, fraction);
        const turret = angleBetween(bot.turretAngle, end.turretAngle, fraction);
        const color = colors[bot.id];
        const won = finished && winner === bot.id;
        const faded = bot.hp === 0 || (finished && winner !== null && !won);
        return (
          <g key={bot.id} transform={`translate(${x} ${y})`} opacity={faded ? 0.35 : 1}
            className={won ? 'winning-bot' : undefined} style={{ color }}>
            {won && <ellipse cx="0" cy="0" rx=".91" ry=".7" fill={`url(#${haloId})`} />}
            {bot.shieldHp > 0 && <circle r=".5" fill="none" stroke="#75c8ff" strokeWidth=".045" />}
            <g transform={`rotate(${hull})`}>
              <rect x="-.34" y="-.29" width=".68" height=".58" rx=".04" fill="#111c2c" stroke={color} strokeWidth=".045" />
              <path d="M -.29 -.2 H .29 M -.29 .2 H .29" stroke={color} strokeWidth=".045" />
            </g>
            <g transform={`rotate(${turret})`}>
              <circle r=".15" fill={color} />
              <rect x=".07" y="-.045" width=".43" height=".09" fill={color} />
            </g>
            <rect x="-.37" y="-.58" width=".74" height=".065" fill="#273e58" />
            <rect x="-.37" y="-.58" width={.74 * bot.hp / bot.maxHp} height=".065" fill={color} />
          </g>
        );
      })}
    </svg>
  );
}

export function ReplayPlayer({ replay }: { replay: Replay }) {
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const last = replay.frames.length - 1;
  const finished = position >= last;

  useEffect(() => {
    if (!playing || finished) return;
    let animation: number;
    let previous: number | undefined;

    function advance(now: number) {
      const elapsed = previous === undefined ? 0 : now - previous;
      previous = now;
      setPosition(current => Math.min(last, current + elapsed * replay.tickRate * speed / 1000));
      animation = requestAnimationFrame(advance);
    }

    animation = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(animation);
  }, [playing, finished, last, replay.tickRate, speed]);

  const index = Math.floor(position);
  const frame = replay.frames[index];
  const next = replay.frames[Math.min(last, index + 1)];
  const winner = replay.result.winnerBotId;
  const outcome = winner ? copy.winner(copy[winner]) : copy.draw;
  const reason = !winner && replay.result.reason === 'BotDestroyed'
    ? copy.doubleKnockout : copy.reason[replay.result.reason];

  return (
    <>
      <div className="arena-stage">
        <ArenaView arena={replay.arena} frame={frame} next={next} fraction={position - index}
          finished={finished} winner={winner} />
        {finished && <p role="status" className="outcome">{copy.outcome(outcome, reason)}</p>}
      </div>
      <div className="controls">
        <button type="button" onClick={() => {
          if (finished) setPosition(0);
          setPlaying(finished || !playing);
        }}>{finished ? copy.restart : playing ? copy.pause : copy.resume}</button>
        <input aria-label={copy.position} type="range" min="0" max={last} value={index} onChange={event => {
          setPlaying(false);
          setPosition(Number(event.target.value));
        }} />
        <output>{copy.time(position / replay.tickRate, last / replay.tickRate)}</output>
        <select aria-label={copy.speed} value={speed} onChange={event => setSpeed(Number(event.target.value))}>
          {speeds.map(value => <option key={value} value={value}>{copy.speedOption(value)}</option>)}
        </select>
      </div>
      <ul className="health" aria-label={copy.health}>
        {frame.bots.map(bot => (
          <li key={bot.id} style={{ color: colors[bot.id] }}>
            <span>{copy[bot.id]}</span>
            <meter aria-label={copy[bot.id]} min={0} max={bot.maxHp} value={bot.hp} />
            <b>{copy.hp(bot.hp, bot.maxHp)}</b>
            <div className="bot-details">
              <span>{copy.surfaces[bot.surface ?? 'Ground']}{bot.inFog ? ` · ${copy.fog}` : ''}</span>
              {bot.shieldHp > 0 && <span>{copy.shieldHp(bot.shieldHp)}</span>}
              {(bot.inventory ?? []).length > 0 && <span>{copy.inventory(bot.inventory.map(type => copy.items[type]).join(', '))}</span>}
              {(bot.activeEffects ?? []).length > 0 && <span>{copy.effects(bot.activeEffects.map(effect => copy.items[effect.type]).join(', '))}</span>}
              {bot.weapon === 'Gauss' && <span>{bot.chargeStage === 'Ready'
                ? copy.gaussReady : copy.gaussCharging(bot.chargeProgress)}</span>}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
