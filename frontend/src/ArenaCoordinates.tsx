const step = 2;
const pad = { left: 0.9, top: 0.75, right: 0.4, bottom: 0.4 };

function ticks(size: number) {
  const values: number[] = [];
  for (let value = 0; value <= size; value += step) values.push(value);
  if (values[values.length - 1] !== size) values.push(size);
  return values;
}

export function arenaViewBox(width: number, height: number) {
  return `${-pad.left} ${-pad.top} ${width + pad.left + pad.right} ${height + pad.top + pad.bottom}`;
}

export function ArenaCoordinates({ width, height }: { width: number; height: number }) {
  return (
    <g className="arena-coordinates" aria-hidden="true">
      <line x1="0" y1="0" x2={width} y2="0" stroke="#35506c" strokeWidth=".04" />
      <line x1="0" y1="0" x2="0" y2={height} stroke="#35506c" strokeWidth=".04" />
      {ticks(width).map(x => (
        <g key={`x-${x}`}>
          <line x1={x} y1="0" x2={x} y2="-.18" stroke="#5d7896" strokeWidth=".04" />
          <text x={x} y="-.32" textAnchor="middle" fill="#8aa0b8" fontSize=".32" fontFamily="ui-monospace, monospace">
            {x}
          </text>
        </g>
      ))}
      {ticks(height).map(y => (
        <g key={`y-${y}`}>
          <line x1="0" y1={y} x2="-.18" y2={y} stroke="#5d7896" strokeWidth=".04" />
          <text x="-.28" y={y} textAnchor="end" dominantBaseline="middle"
            fill="#8aa0b8" fontSize=".32" fontFamily="ui-monospace, monospace">
            {y}
          </text>
        </g>
      ))}
      <text x={width / 2} y={-0.58} textAnchor="middle" fill="#6f86a0" fontSize=".28">x →</text>
      <text x={-0.62} y={height / 2} textAnchor="middle" fill="#6f86a0" fontSize=".28"
        transform={`rotate(-90 ${-0.62} ${height / 2})`}>y →</text>
    </g>
  );
}
