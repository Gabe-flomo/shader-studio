/**
 * depthPreview.ts — the depth preview switch in the scene builders (docs/depth-mix.md, "Seeing the depth"):
 * the 2D Scene Builder's Depth tab and the 3D Scene Builder's "Picture with depth" card show, instead of the
 * result, what the depth effects work from:
 *
 *   Result         what Build makes (the default)
 *   Picture        the picture alone
 *   Depth          the raw depth the Depth node gives (greyscale, or a heat map: red near, blue far)
 *   Shaped depth   the depth after the range and curve (2D) or Nearest / Farthest (3D): what the effects read
 *
 * and, when they are on (2D), the depth-only effects: the Gradient over depth, the Size by depth factor and the
 * Space by depth shift. A view is the very graph the preview compiles (so the same Depth node and the same
 * depth texture as the build), with one Expression Block in front of its Output. Nothing here is built into
 * the real graph. Pure, except for the small store the switch and the previews share.
 */
import { create } from 'zustand';
import type { GraphNode } from '../types/nodeGraph';
import { ROLE_KEY } from '../sceneBuilder/build';

export const DEPTH_VIEWS = ['result', 'picture', 'depth', 'shaped'] as const;
/** The extra views, offered when their effect is on (2D only). */
export const DEPTH_EFFECT_VIEWS = ['gradient', 'size', 'space'] as const;
export type DepthView = typeof DEPTH_VIEWS[number] | typeof DEPTH_EFFECT_VIEWS[number];

export const DEPTH_VIEW_LABELS: Record<DepthView, { label: string; blurb: string }> = {
  result: { label: 'Result', blurb: 'What Build makes.' },
  picture: { label: 'Picture', blurb: 'The picture alone, as it covers the frame.' },
  depth: { label: 'Depth', blurb: 'The raw depth from the Depth node: bright (or red) is near, dark (or blue) far.' },
  shaped: { label: 'Shaped depth', blurb: 'The depth after the range and curve: what every depth effect reads.' },
  gradient: { label: 'Gradient', blurb: 'The gradient over depth alone: the colour each depth gets.' },
  size: { label: 'Size', blurb: 'Size by depth: how much each part grows the shapes (bright: Size near, dark: Size far).' },
  space: { label: 'Space', blurb: 'Space by depth: how far each part moves the shapes\' point (grey: not at all; the colour is the direction).' },
};

/** The views a scene offers: the four, then the effects that are on. */
export function depthViewsFor(effects: { gradient?: boolean; size?: boolean; space?: boolean } = {}): DepthView[] {
  return [...DEPTH_VIEWS, ...DEPTH_EFFECT_VIEWS.filter(v => effects[v])];
}

// ── The switch's state (shared by the tab or card and the previews) ─────────

interface DepthViewState {
  view: DepthView;
  /** Depth and Shaped depth as a heat map instead of greyscale. */
  heat: boolean;
  /** The side-by-side strip: every view small, next to each other. */
  strip: boolean;
  setView: (view: DepthView) => void;
  setHeat: (heat: boolean) => void;
  setStrip: (strip: boolean) => void;
}

export const useDepthView = create<DepthViewState>(set => ({
  view: 'result', heat: false, strip: false,
  setView: view => set({ view }),
  setHeat: heat => set({ heat }),
  setStrip: strip => set({ strip }),
}));

// ── The view as a graph ─────────────────────────────────────────────────────

type Ref = { nodeId: string; outputKey: string };
type In = { name: string; type: 'float' | 'vec2' | 'vec3'; from: Ref };

/** Jet: blue far (0) through cyan, green and yellow to red near (1). */
const HEAT = (t: string) => `clamp(vec3(1.5) - abs(4.0 * clamp(${t}, 0.0, 1.0) - vec3(3.0, 2.0, 1.0)), 0.0, 1.0)`;
const GREY = (t: string) => `vec3(clamp(${t}, 0.0, 1.0))`;

const roleOf = (n: GraphNode) => String(n.params?.[ROLE_KEY] ?? '');

export interface DepthViewOpts {
  heat?: boolean;
  /** 2D Size by depth: Size far and Size near, to stretch the factor over black … white. */
  size?: [number, number];
  /** 2D Space by depth: its amount, to scale the shift into colour. */
  spaceAmount?: number;
}

/**
 * `nodes` (a stand-alone builder graph with its Output `outputId`) showing `view` instead of the result: a copy of
 * the list with an Expression Block wired into the Output. The 2D graph's picture with depth is its Depth node
 * (`depth`) and Depth Mix nodes (`depth:mix`, `depth:shapes`); the 3D one's its Depth node and Depth Composite
 * (`depth:composite`). Null when the graph has nothing for that view (no picture with depth, or that effect off).
 */
export function withDepthView(nodes: readonly GraphNode[], outputId: string, view: DepthView, opts: DepthViewOpts = {}): GraphNode[] | null {
  if (view === 'result') return [...nodes];
  const out = nodes.find(n => n.id === outputId);
  const byRole = (r: string) => nodes.find(n => roleOf(n) === r);
  const dn = nodes.find(n => n.type === 'depth' && roleOf(n) === 'depth') ?? nodes.find(n => n.type === 'depth');
  if (!out || !dn) return null;
  const mix = byRole('depth:mix'), shapes = byRole('depth:shapes'), comp = byRole('depth:composite');
  const raw: Ref = { nodeId: dn.id, outputKey: 'depth' };
  const tone = (t: string) => (opts.heat ? HEAT(t) : GREY(t));
  let inputs: In[];
  let result: string;
  switch (view) {
    case 'picture': {
      const pic = mix?.inputs.picture?.connection ?? comp?.inputs.picture?.connection;
      if (!pic) return null;
      inputs = [{ name: 'picture', type: 'vec3', from: { ...pic } }];
      result = 'picture';
      break;
    }
    case 'depth':
      inputs = [{ name: 'depth', type: 'float', from: raw }];
      result = tone('depth');
      break;
    case 'shaped':
      if (mix) {
        inputs = [{ name: 'shaped', type: 'float', from: { nodeId: mix.id, outputKey: 'depth' } }];
        result = tone('shaped');
      } else if (comp) {
        // 3D: the picture's distance through Nearest … Farthest, near bright (as the composite's Show: Picture distance).
        const nearD = Number(comp.params.nearD ?? 1.5), farD = Number(comp.params.farD ?? 8);
        inputs = [{ name: 'dist', type: 'float', from: { nodeId: comp.id, outputKey: 'pictureDist' } }];
        result = tone(`1.0 - (dist - ${glf(nearD)}) / max(${glf(farD)} - ${glf(nearD)}, 0.001)`);
      } else return null;
      break;
    case 'gradient':
      if (!mix || String(mix.params.gradient ?? 'off') === 'off') return null;
      inputs = [{ name: 'gradient', type: 'vec3', from: { nodeId: mix.id, outputKey: 'gradient' } }];
      result = 'gradient';
      break;
    case 'size': {
      if (!shapes) return null;
      const [far, near] = opts.size ?? [Number(shapes.params.sizeFar ?? 0.4), Number(shapes.params.sizeNear ?? 1.6)];
      inputs = [{ name: 'scale', type: 'float', from: { nodeId: shapes.id, outputKey: 'scale' } }];
      const lo = Math.min(far, near), hi = Math.max(far, near);
      result = tone(`(scale - ${glf(lo)}) / max(${glf(hi - lo)}, 0.001)`);
      break;
    }
    case 'space': {
      const at = shapes?.inputs.uv?.connection;
      if (!shapes || !at) return null;
      const k = 0.5 / Math.max(Math.abs(opts.spaceAmount ?? Number(shapes.params.spaceAmount ?? 0.15)), 0.001);
      inputs = [{ name: 'moved', type: 'vec2', from: { nodeId: shapes.id, outputKey: 'uv' } }, { name: 'uv', type: 'vec2', from: { ...at } }];
      result = `clamp(vec3(0.5 + (moved - uv) * ${glf(k)}, 0.5), 0.0, 1.0)`;
      break;
    }
    default: return null;
  }
  const id = `${outputId}_depthview`;
  const block: GraphNode = {
    id, type: 'exprNode', position: { x: out.position.x - 220, y: out.position.y + 160 },
    inputs: Object.fromEntries(inputs.map(i => [i.name, { type: i.type, label: i.name, connection: { ...i.from } }])),
    outputs: { result: { type: 'vec3', label: 'Result' } },
    params: {
      label: `Preview: ${DEPTH_VIEW_LABELS[view].label}`, outputType: 'vec3', lines: [], result, expr: result,
      inputs: inputs.map(i => ({ name: i.name, type: i.type, slider: null })),
      __comment: `The builder's preview: ${DEPTH_VIEW_LABELS[view].blurb} Not part of what Build makes.`,
    },
  };
  return [
    ...nodes.filter(n => n.id !== outputId),
    { ...out, inputs: { ...out.inputs, color: { ...out.inputs.color, connection: { nodeId: id, outputKey: 'result' } } } },
    block,
  ];
}

/** A GLSL float literal. */
function glf(x: number): string {
  if (!Number.isFinite(x)) return '0.0';
  const s = String(Math.round(x * 1e6) / 1e6);
  return /[.e]/.test(s) ? s : `${s}.0`;
}
