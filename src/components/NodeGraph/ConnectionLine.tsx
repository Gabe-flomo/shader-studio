import React from 'react';
import { TYPE_COLORS } from './typeColors';
import { loopWirePath, wirePath } from './wirePath';

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
  /** A node being dragged would go into this wire: drawn thick with a halo. */
  lit?: boolean;
  /** Route a backward wire over the cards through a channel at this y (loopWirePath). */
  overY?: number;
}

/** Elbow wire between two world-space points. Memoised — see the comparator. */
export const ConnectionLine = React.memo(function ConnectionLine({ from, to, dataType, edgeKey, dimmed = false, lit = false, overY }: Props) {
  const path = overY !== undefined ? loopWirePath(from, to, overY).d : wirePath(from, to);
  const color = (dataType && TYPE_COLORS[dataType]) ? TYPE_COLORS[dataType] : '#8a8d99';

  return (
    <g style={{ opacity: dimmed ? 0.08 : 1, transition: 'opacity 0.1s' }}>
      {lit && <path d={path} stroke={color} strokeWidth={12} strokeOpacity={0.3} strokeLinecap="round" strokeLinejoin="round" fill="none" style={{ pointerEvents: 'none' }} />}
      <path
        d={path}
        stroke={color}
        strokeWidth={lit ? 4 : 2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        // A Pass's texture travels as a whole picture, not a value per pixel: dashed so it reads differently.
        strokeDasharray={dataType === 'texture' ? '7 5' : undefined}
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
  a.dataType === b.dataType && a.edgeKey === b.edgeKey && a.dimmed === b.dimmed && a.lit === b.lit && a.overY === b.overY,
);
