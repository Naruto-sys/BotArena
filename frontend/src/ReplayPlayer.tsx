import { useEffect, useId, useRef, useState } from 'react';
import type { Arena, Bot, Frame, Point, Replay } from './contracts';
import { text } from './text';

const colors = { player: '#3dc9f1', opponent: '#ff9a45' };
const copy = text.replay;
const speeds = [0.5, 1, 2, 4];

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
        <pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse">
          <path d="M 1 0 H 0 V 1" fill="none" stroke="#253b51" strokeWidth=".04" />
        </pattern>
      </defs>
      <rect width={arena.width} height={arena.height} fill="url(#grid)" />
      {arena.walls.map((wall, i) => <rect key={i} {...wall} rx=".08" fill="#273e58" stroke="#476383" strokeWidth=".05" />)}
      {frame.bullets.map(bullet => {
        const end = next.bullets.find(b => b.id === bullet.id) ?? bullet;
        const { x, y } = positionBetween(bullet.position, end.position, fraction);
        const degrees = Math.atan2(bullet.direction.y, bullet.direction.x) * 180 / Math.PI;
        return <rect key={bullet.id} x="-.095" y="-.045" width=".19" height=".09"
          transform={`translate(${x} ${y}) rotate(${degrees})`} fill={colors[bullet.ownerBotId]} />;
      })}
      {!finished && frame.events.map((event, index) => {
        if (!event.position || event.type === 'MatchFinished') return null;
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

export function ReplayPlayer({ replay, onComplete }: { replay: Replay; onComplete?: () => void }) {
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const last = replay.frames.length - 1;
  const finished = position >= last;
  const completionReported = useRef(false);

  useEffect(() => {
    completionReported.current = false;
    setPosition(0);
    setPlaying(true);
  }, [replay]);

  useEffect(() => {
    if (!finished || completionReported.current) return;
    completionReported.current = true;
    onComplete?.();
  }, [finished, onComplete]);

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
          </li>
        ))}
      </ul>
    </>
  );
}
