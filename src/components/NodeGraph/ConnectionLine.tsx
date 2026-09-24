import React from 'react';
import { TYPE_COLORS } from './typeColors';
import { wirePath } from './wirePath';

interface Point { x: number; y: number }

interface Props {
  from: Point;
  to: Point;
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

/** Elbow wire between two world-space points. Memoised — see the comparator. */
export const ConnectionLine = React.memo(function ConnectionLine({ from, to, dataType, edgeKey, dimmed = false }: Props) {
  const path = wirePath(from, to);
  const color = (dataType && TYPE_COLORS[dataType]) ? TYPE_COLORS[dataType] : '#8a8d99';

  return (
    <g style={{ opacity: dimmed ? 0.08 : 1, transition: 'opacity 0.1s' }}>
      <path
        d={path}
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
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
