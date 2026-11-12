import type { Arena, CampaignSpawn, CaptureZone, ReachMarker } from './contracts';
import { ArenaCoordinates, arenaViewBox } from './ArenaCoordinates';
import { botColor } from './botDisplay';
import { text } from './text';

export function ArenaPreview({
  arena,
  spawns,
  marker,
  captureZones,
}: {
  arena: Arena;
  spawns: CampaignSpawn[];
  marker?: ReachMarker | null;
  captureZones?: CaptureZone[] | null;
}) {
  return (
    <div className="arena-stage">
      <svg className="arena" viewBox={arenaViewBox(arena.width, arena.height)}
        role="img" aria-label={text.campaign.previewLabel}>
        <defs>
          <pattern id="preview-grid" width="1" height="1" patternUnits="userSpaceOnUse">
            <path d="M 1 0 H 0 V 1" fill="none" stroke="#253b51" strokeWidth=".04" />
          </pattern>
        </defs>
        <rect width={arena.width} height={arena.height} fill="url(#preview-grid)" />
        <ArenaCoordinates width={arena.width} height={arena.height} />
        {(captureZones ?? []).map(zone => {
          const stroke = zone.ownerTeamId === 'player' ? '#6ea8ff' : '#ff8f6b';
          const fill = zone.ownerTeamId === 'player' ? '#2f6fed44' : '#e35d3344';
          return (
            <rect
              key={zone.ownerTeamId}
              x={zone.x}
              y={zone.y}
              width={zone.width}
              height={zone.height}
              rx=".06"
              fill={fill}
              stroke={stroke}
              strokeWidth=".06"
              strokeDasharray=".16 .1"
            />
          );
        })}
        {arena.walls.map((wall, i) => (
          <rect key={i} {...wall} rx=".08" fill="#273e58" stroke="#476383" strokeWidth=".05" />
        ))}
        {marker && (
          <g>
            <circle cx={marker.x} cy={marker.y} r={marker.radius}
              fill="#3dc9f133" stroke="#7be0ff" strokeWidth=".07" strokeDasharray=".18 .12" />
            <circle cx={marker.x} cy={marker.y} r=".12" fill="#7be0ff" />
          </g>
        )}
        {spawns.map(spawn => {
          const color = botColor(spawn, spawns);
          const hull = spawn.bodyAngle * 180 / Math.PI;
          const turret = spawn.turretAngle * 180 / Math.PI;
          return (
            <g key={spawn.id} transform={`translate(${spawn.position.x} ${spawn.position.y})`} style={{ color }}>
              <g transform={`rotate(${hull})`}>
                <rect x="-.34" y="-.29" width=".68" height=".58" rx=".04"
                  fill="#111c2c" stroke={color} strokeWidth=".045" />
                <path d="M -.29 -.2 H .29 M -.29 .2 H .29" stroke={color} strokeWidth=".045" />
              </g>
              <g transform={`rotate(${turret})`}>
                <circle r=".15" fill={color} />
                <rect x=".07" y="-.045" width=".43" height=".09" fill={color} />
              </g>
            </g>
          );
        })}
      </svg>
      <p role="status" className="outcome preview-caption">{text.campaign.previewCaption}</p>
    </div>
  );
}
