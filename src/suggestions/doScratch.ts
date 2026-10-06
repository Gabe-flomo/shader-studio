/**
 * doScratch.ts — the small graphs the Commands reference runs its examples on ("Show me how"),
 * named in lang/commands.ts (ScratchId). Built fresh on each call.
 */
import type { GraphNode } from '../types/nodeGraph';
import { n } from '../store/graphBuilder';
import type { ScratchId } from '../lang/commands';

export function scratchGraph(id: ScratchId): GraphNode[] {
  switch (id) {
    case 'empty': return [n('output', 'o', 1260, 0)];
    case 'circle': return [
      n('uv', 'u', 0, 0), n('circleSDF', 'c', 420, 0, {}, { position: ['u', 'uv'] }), n('sdfFill', 'f', 840, 0, {}, { d: ['c', 'distance'] }),
      n('output', 'o', 1260, 0, {}, { color: ['f', 'result'] }),
    ];
    case 'noise': return [
      n('uv', 'u', 0, 0), n('fbm', 'f', 420, 0, {}, { uv: ['u', 'uv'] }), n('palette', 'p', 840, 0, {}, { value: ['f', 'value'] }),
      n('output', 'o', 1260, 0, {}, { color: ['p', 'color'] }),
    ];
    case 'glow': return [
      n('uv', 'u', 0, 0), n('circleSDF', 'c', 420, 0, {}, { position: ['u', 'uv'] }), n('light', 'g', 840, 0, {}, { distance: ['c', 'distance'] }),
      n('output', 'o', 1260, 0, {}, { color: ['g', 'tinted'] }),
    ];
    case 'twoShapes': return [
      n('uv', 'u', 0, 0), n('circleSDF', 'a', 420, 0, {}, { position: ['u', 'uv'] }), n('boxSDF', 'b', 420, 420, {}, { position: ['u', 'uv'] }),
      n('sdfFill', 'f', 840, 0, {}, { d: ['a', 'distance'] }), n('output', 'o', 1260, 0, {}, { color: ['f', 'result'] }),
    ];
    case 'twoCircles': return [
      n('uv', 'u', 0, 0), n('circleSDF', 'a', 420, 0, {}, { position: ['u', 'uv'] }), n('circleSDF', 'b', 420, 420, { radius: 0.15 }, { position: ['u', 'uv'] }),
      n('sdfFill', 'f', 840, 0, {}, { d: ['a', 'distance'] }), n('output', 'o', 1260, 0, {}, { color: ['f', 'result'] }),
    ];
    case 'mixed': return [
      n('uv', 'u', 0, 0), n('fbm', 'f', 420, 0, {}, { uv: ['u', 'uv'] }), n('palette', 'p', 840, 0, {}, { value: ['f', 'value'] }),
      n('output', 'o', 1260, 0, {}, { color: ['p', 'color'] }),
      n('circleSDF', 'c', 420, 420, {}, { position: ['u', 'uv'] }), n('light', 'g', 840, 420, {}, { distance: ['c', 'distance'] }),
      n('smoothstep', 'm', 840, 840, {}, { value: ['c', 'distance'] }),
    ];
    case 'pass': return [
      n('uv', 'u', 0, 0), n('fbm', 'f', 420, 0, {}, { uv: ['u', 'uv'] }), n('palette', 'p', 840, 0, {}, { value: ['f', 'value'] }),
      n('pass', 'pass', 1260, 0, {}, { color: ['p', 'color'] }), n('output', 'o', 1680, 0, {}, { color: ['pass', 'color'] }),
    ];
  }
}
