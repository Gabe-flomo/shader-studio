const TYPE_COLORS: Record<string, string> = {
  float:       '#f0a0c0',
  vec2:        '#00aaff',
  vec3:        '#00ffaa',
  vec4:        '#ffaa00',
  scene3d:     '#cc88aa',
  spacewarp3d: '#aa88cc',
};

interface Props {
  from: { x: number; y: number };
  to: { x: number; y: number };
  dataType?: string;
  onWireEnter?: () => void;
  onWireLeave?: () => void;
}

export function ConnectionLine({ from, to, dataType, onWireEnter, onWireLeave }: Props) {
  const midX = (from.x + to.x) / 2;
  const path = `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`;
  const color = (dataType && TYPE_COLORS[dataType]) ? TYPE_COLORS[dataType] : '#666';

  return (
    <g>
      {/* Visual path */}
      <path
        d={path}
        stroke={color}
        strokeWidth={2.5}
        fill="none"
        strokeOpacity={0.8}
        style={{ pointerEvents: 'none' }}
      />
      {/* Hit-detection path — wider transparent stroke, only rendered when hover handlers provided */}
      {(onWireEnter || onWireLeave) && (
        <path
          d={path}
          stroke="transparent"
          strokeWidth={20}
          fill="none"
          style={{ pointerEvents: 'stroke', cursor: 'crosshair' }}
          onMouseEnter={onWireEnter}
          onMouseLeave={onWireLeave}
        />
      )}
    </g>
  );
}
