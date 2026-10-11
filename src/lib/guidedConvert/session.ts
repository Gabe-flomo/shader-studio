/**
 * Guided Convert, the session (docs/guided-convert.md): the steps taken, with undo / redo, and the
 * suggestion for the next cut. The steps are the whole state; the graph is rebuilt from them.
 */
import type { Analysis, Unit } from './analyse';
import { unitOwners, type Step } from './stage';

export interface GuidedSession {
  source: string;
  steps: Step[];
  /** Undone steps, the next one to redo last. */
  redo: Step[];
}
export type GuidedAction =
  | { type: 'add'; step: Step }
  /** Several steps at once (opening a helper and converting its body): undone one at a time. */
  | { type: 'addMany'; steps: Step[] }
  | { type: 'undo' }
  | { type: 'redo' }
  /** Undo back to `to` steps (a click on the strip). */
  | { type: 'back'; to: number }
  | { type: 'reset'; source: string };

export const initialGuided = (source: string): GuidedSession => ({ source, steps: [], redo: [] });

export function guidedReducer(s: GuidedSession, a: GuidedAction): GuidedSession {
  switch (a.type) {
    case 'add': return { ...s, steps: [...s.steps, a.step], redo: [] };
    case 'addMany': return a.steps.length ? { ...s, steps: [...s.steps, ...a.steps], redo: [] } : s;
    case 'undo': return s.steps.length ? { ...s, steps: s.steps.slice(0, -1), redo: [...s.redo, s.steps[s.steps.length - 1]] } : s;
    case 'redo': return s.redo.length ? { ...s, steps: [...s.steps, s.redo[s.redo.length - 1]], redo: s.redo.slice(0, -1) } : s;
    case 'back': {
      const to = Math.max(0, Math.min(a.to, s.steps.length));
      return { ...s, steps: s.steps.slice(0, to), redo: [...s.redo, ...s.steps.slice(to).reverse()] };
    }
    case 'reset': return initialGuided(a.source);
  }
}

export interface Suggestion { units: number[]; lines: [number, number]; label: string }

const BLANKISH = /^\s*(\/\/.*)?$/;

/** The helpers a unit calls by name in its own text. */
function directCalls(a: Analysis, u: Unit): string[] {
  return a.helpers.map(h => h.name).filter((n, i, all) => all.indexOf(n) === i && new RegExp(`\\b${n}\\s*\\(`).test(u.text));
}

/** In words: what a run of statements is (the call it makes, the loop, the values it makes). */
export function describeUnits(a: Analysis, units: readonly number[]): string {
  const us = units.map(i => a.units[i]);
  const calls = [...new Set(us.flatMap(u => directCalls(a, u)))];
  if (calls.length) return `the ${calls.map(c => `${c}()`).join(', ')} ${calls.length === 1 ? 'call' : 'calls'}`;
  if (us.length === 1 && us[0].ast.type === 'for_statement') return 'the loop';
  if (us.length === 1 && us[0].ast.type === 'while_statement') return 'the loop';
  if (us.length === 1 && us[0].ast.type === 'if_statement') return 'the branch';
  const made = us.flatMap(u => u.decls.map(d => d.name));
  if (made.length) return `makes ${made.slice(0, 4).join(', ')}${made.length > 4 ? '…' : ''}`;
  const changed = [...new Set(us.flatMap(u => [...u.writes]))].map(n => (n === 'gl_FragColor' ? 'the colour' : n));
  return changed.length ? `changes ${changed.slice(0, 3).join(', ')}` : 'the next lines';
}

/**
 * The next cut to suggest: the next statements nothing has converted, as far as the shader's own
 * paragraph goes (a blank or comment line ends it), at most six, a loop or branch on its own.
 */
export function suggestNext(a: Analysis, steps: readonly Step[]): Suggestion | null {
  const owners = unitOwners(a, steps);
  const free = a.units.filter(u => !u.setup && !owners.has(u.index));
  if (!free.length) return null;
  const src = a.source.split('\n');
  const alone = (u: Unit) => ['for_statement', 'while_statement', 'if_statement', 'do_statement'].includes(u.ast.type);
  const chunk: Unit[] = [free[0]];
  for (let k = 1; k < free.length && chunk.length < 6; k++) {
    const prev = chunk[chunk.length - 1], u = free[k];
    if (u.index !== prev.index + 1 || alone(u) || alone(prev)) break;
    const gap = src.slice(prev.lines[1], u.lines[0] - 1);
    if (gap.some(l => BLANKISH.test(l))) break;
    chunk.push(u);
  }
  const lines: [number, number] = [chunk[0].lines[0], Math.max(...chunk.map(u => u.lines[1]))];
  return { units: chunk.map(u => u.index), lines, label: describeUnits(a, chunk.map(u => u.index)) };
}

/** What a selection reads from before it (its inputs) and what later lines read of what it makes (its outputs). */
export function needsMakes(a: Analysis, units: readonly number[]): { needs: string[]; makes: string[] } {
  if (!units.length) return { needs: [], makes: [] };
  const set = new Set(units);
  const first = Math.min(...units), last = Math.max(...units);
  const before = new Set(a.units.filter(u => u.index < first).flatMap(u => u.decls.map(d => d.name)));
  const chosen = a.units.filter(u => set.has(u.index));
  const used = new Set(chosen.flatMap(u => [...u.uses]));
  const written = new Set(chosen.flatMap(u => [...u.writes, ...u.decls.map(d => d.name)]));
  const after = new Set(a.units.filter(u => u.index > last).flatMap(u => [...u.uses]));
  const SRC: Record<string, string> = { u_time: 'time', u_resolution: 'resolution', u_mouse: 'mouse', gl_FragCoord: 'pixel' };
  const needs = [...[...used].filter(n => before.has(n)), ...[...used].filter(n => SRC[n] || (a.uniforms.has(n) && !before.has(n))).map(n => SRC[n] ?? n)];
  const makes = [...written].filter(n => n === 'gl_FragColor' || after.has(n)).map(n => (n === 'gl_FragColor' ? 'the colour' : n));
  return { needs: [...new Set(needs)], makes };
}
