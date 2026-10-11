/**
 * smoothWords.ts — the Smooth rules in plain words (the Grid Rules builder's Smooth section,
 * SmoothPictures.tsx): what each template is, what each setting does, a number you can feel
 * ("half gone after about 170 steps"), and a tiny before/after run on the CPU (gridRules/cpu.ts) so
 * the setting shows what it does.
 *
 * The params keep their names (spread, decay, waveSpeed, damping, feed, kill, diffA, diffB): only the
 * words changed. Pure.
 */
import { cpuBoard, cpuStep, type CpuBoard } from './cpu';
import { GRID_DEFAULTS, SMOOTH_PRESETS, type SmoothTemplate } from './spec';

export interface SmoothSetting {
  key: string;
  /** The plain name ("Spreads"). */
  label: string;
  /** One line: what it does, in everyday words. */
  line: string;
  min: number;
  max: number;
  step: number;
  /** A feel for the value ("half gone after about 170 steps"); null when there's nothing to add. */
  feel?: (p: Record<string, unknown>) => string | null;
  /** Folded under More (rarely changed). */
  more?: boolean;
}

export interface SmoothTemplateWords {
  /** The plain name ("Heat"). */
  title: string;
  /** What it is, in one or two lines. */
  line: string;
  /** The before/after demo: how many steps the "after" is. */
  demoSteps: number;
  settings: SmoothSetting[];
}

const n = (p: Record<string, unknown>, k: string) => { const v = Number(p[k] ?? GRID_DEFAULTS[k]); return Number.isFinite(v) ? v : 0; };
/** Steps until something multiplied by `keep` each step is half what it was. */
export const halfLifeSteps = (keep: number): number => (keep >= 1 ? Infinity : keep <= 0 ? 1 : Math.log(0.5) / Math.log(keep));
const steps = (k: number) => (!Number.isFinite(k) ? 'never fades' : k < 1.5 ? 'gone at once' : `half gone after about ${Math.round(k)} steps`);

export const SMOOTH_WORDS: Record<SmoothTemplate, SmoothTemplateWords> = {
  diffusion: {
    title: 'Heat',
    line: 'Every cell holds some heat. Each step it shares it with the four cells beside it, so hot spots spread out and fade.',
    demoSteps: 24,
    settings: [
      { key: 'spread', label: 'Spreads', line: 'How quickly a cell evens out with its neighbours: 0 keeps its heat to itself, 1 evens out every step.', min: 0, max: 1, step: 0.01 },
      { key: 'decay', label: 'Cools', line: 'How much heat every cell loses each step. 0 never cools.', min: 0, max: 0.1, step: 0.001, feel: p => steps(halfLifeSteps(1 - n(p, 'decay'))) },
    ],
  },
  waves: {
    title: 'Ripples',
    line: 'Water: each cell is the height of the surface. A drop pushes it down and rings spread out from it, bounce off walls and settle.',
    demoSteps: 18,
    settings: [
      { key: 'waveSpeed', label: 'Ripple speed', line: 'How far a ripple travels each step. Slower is calmer; above about 0.9 the grid can\'t keep up and it gets grainy.', min: 0, max: 1, step: 0.01 },
      { key: 'damping', label: 'Ripples last', line: 'How much of a ripple is kept each step. 1 keeps it for ever; lower calms the water sooner.', min: 0.9, max: 1, step: 0.001, feel: p => steps(halfLifeSteps(n(p, 'damping'))) },
    ],
  },
  reaction: {
    title: 'Growing patterns',
    line: 'Two chemicals. Food (A) fills the board; a second one (B) eats food to make more of itself. Food is topped up everywhere and B is cleared away, and the balance draws spots, stripes, worms or coral.',
    demoSteps: 900,
    settings: [
      { key: 'feed', label: 'Food added', line: 'How much food is topped up each step. More food: bigger, busier patterns.', min: 0, max: 0.1, step: 0.0005 },
      { key: 'kill', label: 'Cleared away', line: 'How much of B is taken away each step. More: patterns break into spots, then die out.', min: 0, max: 0.1, step: 0.0005 },
      { key: 'diffA', label: 'Food spreads', line: 'How fast food flows from cell to cell. Keep it about twice B\'s.', min: 0, max: 1, step: 0.01, more: true },
      { key: 'diffB', label: 'B spreads', line: 'How fast B flows. Faster B: wider, softer shapes.', min: 0, max: 1, step: 0.01, more: true },
    ],
  },
  custom: {
    title: 'Your own update',
    line: 'Write the new value of each cell as one line, from its own value and its neighbours\'. The escape hatch: anything the other three can\'t do.',
    demoSteps: 0,
    settings: [],
  },
};

/** Words for each Smooth preset's pattern, as the map shows them. */
export const REACTION_SPOTS: Array<{ key: string; label: string; feed: number; kill: number }> = Object.entries(SMOOTH_PRESETS)
  .filter(([, pr]) => pr.params.template === 'reaction')
  .map(([key, pr]) => ({ key, label: pr.label, feed: Number(pr.params.feed), kill: Number(pr.params.kill) }));

/** The feed / kill map's window (Munafo's xmorphia map, where Gray–Scott makes patterns). */
export const REACTION_MAP = { feed: [0.01, 0.09] as [number, number], kill: [0.045, 0.07] as [number, number] };

/** The demo's start: a dot of heat, a drop, or a seed square of B. Square `size` cells. */
export function smoothDemoStart(template: SmoothTemplate, size: number): CpuBoard {
  const B = cpuBoard(size, size);
  const c = Math.floor(size / 2);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const r = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2);
    if (template === 'reaction') { B.a[i] = 1; B.b[i] = Math.abs(x - c) < 3 && Math.abs(y - c) < 3 ? 1 : 0; } else if (template === 'waves') { const v = r < 2 ? 1 : 0; B.a[i] = v; B.b[i] = v; } else B.a[i] = r < 3 ? 1 : 0;
  }
  return B;
}

/** The demo: its start, and the board after the template's demo steps with these settings (wrapping). */
export function smoothDemo(params: Record<string, unknown>, template: SmoothTemplate, size = 32): { before: CpuBoard; after: CpuBoard; steps: number } {
  const P = { ...GRID_DEFAULTS, ...params, ruleType: 'smooth', template, edges: 'wrap', start: 'empty' };
  const before = smoothDemoStart(template, size);
  let after = before;
  const k = SMOOTH_WORDS[template].demoSteps;
  for (let i = 0; i < k; i++) after = cpuStep(P, after);
  return { before, after, steps: k };
}
