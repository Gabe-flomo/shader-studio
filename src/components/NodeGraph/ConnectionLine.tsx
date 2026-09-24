import React from 'react';

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
  /**
   * When set, a wide transparent hit path is rendered carrying this key in a
   * `data-edge` attribute. Hover is handled by one delegated listener on the
   * parent <svg> (see WireLayer) rather than a closure per wire, which is what
   * lets this component be memoised.
   */
  edgeKey?: string;
  dimmed?: boolean;
}

/** Bezier wire between two world-space points. Memoised — see `areEqual`. */
export const ConnectionLine = React.memo(function ConnectionLine({ from, to, dataType, edgeKey, dimmed = false }: Props) {
  const midX = (from.x + to.x) / 2;
  const path = `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`;
  const color = (dataType && TYPE_COLORS[dataType]) ? TYPE_COLORS[dataType] : '#666';

  return (
    <g style={{ opacity: dimmed ? 0.08 : 1, transition: 'opacity 0.1s' }}>
      {/* Visual path */}
      <path
        d={path}
        stroke={color}
        strokeWidth={2.5}
        fill="none"
        strokeOpacity={0.8}
        style={{ pointerEvents: 'none' }}
      />
      {/* Hit-detection path — wider transparent stroke, only for hoverable wires */}
      {edgeKey !== undefined && (
        <path
          d={path}
          data-edge={edgeKey}
          stroke="transparent"
          strokeWidth={20}
          fill="none"
          style={{ pointerEvents: 'stroke', cursor: 'crosshair' }}
        />
      )}
    </g>
  );
}, (a, b) =>
  a.from.x === b.from.x && a.from.y === b.from.y &&
  a.to.x === b.to.x && a.to.y === b.to.y &&
  a.dataType === b.dataType && a.edgeKey === b.edgeKey && a.dimmed === b.dimmed,
);
