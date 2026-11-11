import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Arena, CampaignSpawn, Wall } from './contracts';
import { ArenaCoordinates, arenaViewBox } from './ArenaCoordinates';
import { botColor, botLabel } from './botDisplay';
import { classicWalls, type LabBot } from './labDraft';
import { wallOverlapsBot } from './mapGeometry';
import { text } from './text';

const MIN_WALL = 0.4;
const HANDLE = 0.22;

type Corner = 'nw' | 'ne' | 'sw' | 'se';

function toSpawn(bot: LabBot): CampaignSpawn {
  return {
    id: bot.id,
    teamId: bot.teamId,
    position: bot.position,
    bodyAngle: bot.bodyAngle,
    turretAngle: bot.turretAngle,
  };
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function clientToArena(svg: SVGSVGElement, clientX: number, clientY: number) {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x: point.x, y: point.y };
}

function clampWall(wall: Wall, arena: Arena): Wall {
  const width = Math.max(MIN_WALL, Math.min(arena.width, wall.width));
  const height = Math.max(MIN_WALL, Math.min(arena.height, wall.height));
  return {
    x: round1(Math.max(0, Math.min(arena.width - width, wall.x))),
    y: round1(Math.max(0, Math.min(arena.height - height, wall.y))),
    width: round1(width),
    height: round1(height),
  };
}

function resizeFromCorner(wall: Wall, corner: Corner, point: { x: number; y: number }): Wall {
  const right = wall.x + wall.width;
  const bottom = wall.y + wall.height;
  let { x, y, width, height } = wall;

  if (corner === 'nw' || corner === 'sw') {
    x = Math.min(point.x, right - MIN_WALL);
    width = right - x;
  } else {
    width = Math.max(MIN_WALL, point.x - wall.x);
  }

  if (corner === 'nw' || corner === 'ne') {
    y = Math.min(point.y, bottom - MIN_WALL);
    height = bottom - y;
  } else {
    height = Math.max(MIN_WALL, point.y - wall.y);
  }

  return { x, y, width, height };
}

function cornerPoint(wall: Wall, corner: Corner) {
  const right = wall.x + wall.width;
  const bottom = wall.y + wall.height;
  switch (corner) {
    case 'nw': return { x: wall.x, y: wall.y };
    case 'ne': return { x: right, y: wall.y };
    case 'sw': return { x: wall.x, y: bottom };
    case 'se': return { x: right, y: bottom };
  }
}

export function LabArenaEditor({
  arena,
  bots,
  selectedWall,
  placementError,
  onPlacementError: setPlacementError,
  onSelectWall,
  onMoveBot,
  onChangeWall,
  onAddWall,
  onRemoveWall,
  onClassicWalls,
  onClearWalls,
}: {
  arena: Arena;
  bots: LabBot[];
  selectedWall: number | null;
  placementError: string;
  onPlacementError: (message: string) => void;
  onSelectWall: (index: number | null) => void;
  onMoveBot: (botId: string, x: number, y: number) => void;
  onChangeWall: (index: number, wall: Wall) => void;
  onAddWall: (wall: Wall) => void;
  onRemoveWall: (index: number) => void;
  onClassicWalls: () => void;
  onClearWalls: () => void;
}) {
  const spawns = bots.map(toSpawn);

  function validWalls(walls: Wall[]) {
    for (const wall of walls) {
      if (![wall.x, wall.y, wall.width, wall.height].every(Number.isFinite)
        || wall.width < MIN_WALL || wall.height < MIN_WALL || wall.x < 0 || wall.y < 0
        || wall.x + wall.width > arena.width || wall.y + wall.height > arena.height) {
        setPlacementError(text.lab.invalidWall);
        return false;
      }
      const overlap = bots.find(bot => wallOverlapsBot(wall, bot));
      if (overlap) {
        setPlacementError(text.lab.wallOverlapsBot(botLabel(overlap.id, overlap.teamId, bots)));
        return false;
      }
    }
    setPlacementError('');
    return true;
  }

  function changeWall(index: number, wall: Wall) {
    if (validWalls([wall])) onChangeWall(index, wall);
  }

  function moveBot(botId: string, x: number, y: number) {
    const bot = bots.find(item => item.id === botId);
    if (!bot) return;
    if (arena.walls.some(wall => wallOverlapsBot(wall, { ...bot, position: { x, y } }))) {
      setPlacementError(text.lab.botOverlapsWall);
      return;
    }
    setPlacementError('');
    onMoveBot(botId, x, y);
  }
  const dragging = useRef(false);

  useEffect(() => {
    if (selectedWall == null) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onSelectWall(null);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSelectWall, selectedWall]);

  function bindPointerDrag(
    svg: SVGSVGElement,
    startClient: { x: number; y: number },
    onMove: (point: { x: number; y: number }) => void,
    onDone?: (moved: boolean) => void,
  ) {
    const origin = clientToArena(svg, startClient.x, startClient.y);
    let moved = false;

    const move = (event: PointerEvent) => {
      const point = clientToArena(svg, event.clientX, event.clientY);
      if (Math.hypot(point.x - origin.x, point.y - origin.y) > 0.05) {
        moved = true;
        dragging.current = true;
      }
      onMove(point);
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onDone?.(moved);
      if (moved) {
        queueMicrotask(() => {
          dragging.current = false;
        });
      } else {
        dragging.current = false;
      }
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function startMoveWall(index: number, event: ReactPointerEvent<SVGRectElement>) {
    event.preventDefault();
    event.stopPropagation();
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const wall0 = arena.walls[index];
    if (!wall0) return;
    const start = clientToArena(svg, event.clientX, event.clientY);
    const offsetX = start.x - wall0.x;
    const offsetY = start.y - wall0.y;
    const wasSelected = selectedWall === index;
    onSelectWall(index);

    bindPointerDrag(
      svg,
      { x: event.clientX, y: event.clientY },
      point => {
        changeWall(index, clampWall({
          ...wall0,
          x: point.x - offsetX,
          y: point.y - offsetY,
        }, arena));
      },
      didMove => {
        if (!didMove && wasSelected) onSelectWall(null);
      },
    );
  }

  function startResizeWall(
    index: number,
    corner: Corner,
    event: ReactPointerEvent<SVGRectElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const wall0 = arena.walls[index];
    if (!wall0) return;
    onSelectWall(index);

    bindPointerDrag(
      svg,
      { x: event.clientX, y: event.clientY },
      point => {
        changeWall(index, clampWall(resizeFromCorner(wall0, corner, point), arena));
      },
    );
  }

  return (
    <div className="lab-map">
      {placementError && <p role="alert" className="error-card map-placement-error">{placementError}</p>}
      <div className="arena-stage">
        <svg
          className="arena lab-arena"
          viewBox={arenaViewBox(arena.width, arena.height)}
          role="img"
          aria-label={text.lab.mapLabel}
          onClick={event => {
            if (dragging.current) return;
            if ((event.target as Element).closest('[data-bot], .lab-wall, .lab-wall-handle')) return;
            onSelectWall(null);
          }}
        >
          <defs>
            <pattern id="lab-grid" width="1" height="1" patternUnits="userSpaceOnUse">
              <path d="M 1 0 H 0 V 1" fill="none" stroke="#253b51" strokeWidth=".04" />
            </pattern>
          </defs>
          <rect width={arena.width} height={arena.height} fill="url(#lab-grid)" />
          <ArenaCoordinates width={arena.width} height={arena.height} />
          {arena.walls.map((wall, index) => {
            const selected = selectedWall === index;
            return (
              <g key={index} className="lab-wall-group">
                <rect
                  {...wall}
                  rx=".08"
                  fill={selected ? '#3d5f82' : '#273e58'}
                  stroke={selected ? '#7be0ff' : '#476383'}
                  strokeWidth=".05"
                  className="lab-wall"
                  onPointerDown={event => startMoveWall(index, event)}
                />
                {selected && (['nw', 'ne', 'sw', 'se'] as const).map(corner => {
                  const point = cornerPoint(wall, corner);
                  return (
                    <rect
                      key={corner}
                      className={`lab-wall-handle lab-wall-handle-${corner}`}
                      x={point.x - HANDLE / 2}
                      y={point.y - HANDLE / 2}
                      width={HANDLE}
                      height={HANDLE}
                      rx=".04"
                      onPointerDown={event => startResizeWall(index, corner, event)}
                    />
                  );
                })}
              </g>
            );
          })}
          {bots.map(bot => {
            const color = botColor(toSpawn(bot), spawns);
            const hull = bot.bodyAngle * 180 / Math.PI;
            const turret = bot.turretAngle * 180 / Math.PI;
            return (
              <g
                key={bot.id}
                data-bot={bot.id}
                transform={`translate(${bot.position.x} ${bot.position.y})`}
                style={{ color, cursor: 'grab' }}
                onPointerDown={event => {
                  event.preventDefault();
                  const svg = event.currentTarget.ownerSVGElement;
                  if (!svg) return;
                  const start = clientToArena(svg, event.clientX, event.clientY);
                  const offsetX = start.x - bot.position.x;
                  const offsetY = start.y - bot.position.y;
                  const move = (moveEvent: PointerEvent) => {
                    const point = clientToArena(svg, moveEvent.clientX, moveEvent.clientY);
                    moveBot(
                      bot.id,
                      Math.min(15.5, Math.max(0.5, round1(point.x - offsetX))),
                      Math.min(9.5, Math.max(0.5, round1(point.y - offsetY))),
                    );
                  };
                  const up = () => {
                    window.removeEventListener('pointermove', move);
                    window.removeEventListener('pointerup', up);
                  };
                  window.addEventListener('pointermove', move);
                  window.addEventListener('pointerup', up);
                }}
              >
                <g transform={`rotate(${hull})`}>
                  <rect x="-.34" y="-.29" width=".68" height=".58" rx=".04"
                    fill="#111c2c" stroke={color} strokeWidth=".045" />
                </g>
                <g transform={`rotate(${turret})`}>
                  <circle r=".15" fill={color} />
                  <rect x=".07" y="-.045" width=".43" height=".09" fill={color} />
                </g>
              </g>
            );
          })}
        </svg>
        <p role="status" className="outcome preview-caption">{text.lab.mapHint}</p>
      </div>

      <div className="lab-walls">
        <div className="lab-walls-toolbar">
          <strong>{text.lab.walls}</strong>
          <button type="button" onClick={() => {
            const wall = { x: 6, y: 4, width: 1.5, height: 1.5 };
            if (validWalls([wall])) onAddWall(wall);
          }}>{text.lab.addWall}</button>
          <button type="button" disabled={selectedWall == null} onClick={() => onSelectWall(null)}>
            {text.lab.deselectWall}
          </button>
          <button type="button" onClick={() => { if (validWalls(classicWalls)) onClassicWalls(); }}>{text.lab.classicWalls}</button>
          <button type="button" onClick={() => { setPlacementError(''); onClearWalls(); }}>{text.lab.clearWalls}</button>
        </div>
        {arena.walls.length === 0 && <p className="muted">{text.lab.noWalls}</p>}
        {arena.walls.map((wall, index) => (
          <div key={index} className={selectedWall === index ? 'lab-wall-row selected' : 'lab-wall-row'}>
            <button
              type="button"
              className="lab-wall-select"
              onClick={() => onSelectWall(selectedWall === index ? null : index)}
            >
              #{index + 1}
            </button>
            {(['x', 'y', 'width', 'height'] as const).map(key => (
              <label key={key}>
                <span>{key}</span>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max={key === 'width' || key === 'x' ? arena.width : arena.height}
                  value={wall[key]}
                  onChange={event => changeWall(index, { ...wall, [key]: Number(event.target.value) })}
                  onFocus={() => onSelectWall(index)}
                />
              </label>
            ))}
            <button type="button" onClick={() => { setPlacementError(''); onRemoveWall(index); }}>{text.lab.removeWall}</button>
          </div>
        ))}
      </div>
    </div>
  );
}
