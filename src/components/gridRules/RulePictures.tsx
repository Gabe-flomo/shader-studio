/**
 * RulePictures — the Grid Rules builder's before/after pictures (gridRules/ruleExamples.ts): a fixed
 * small grid that flips from one state to the next and back, slowly, so a rule reads as "this
 * becomes that" rather than as an animation.
 *
 *  - FlipGrid: two grids of states shown in turn (Before · After), with cells to ring.
 *  - BlocksTogether: every Blocks rule on together on a small seeded board, one real step at a time
 *    (Next step), each block a rule changed ringed in that rule's colour; rules switch on and off
 *    here to see them alone and in combinations.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { comboBoard, comboStep, gridOfBoard, type Grid } from '../../gridRules/ruleExamples';
import type { CpuBoard } from '../../gridRules/cpu';
import { stateColour } from './TryBoard';

type P = Record<string, unknown>;

/** A colour per rule, for rings round the cells a rule changed. */
export const RULE_COLOURS = ['#4f8cff', '#f0a03c', '#3fbf7f', '#e05ad6', '#ff5a5a', '#38c6d9', '#c9c94a', '#9b7bff'];
export const ruleColour = (i: number) => RULE_COLOURS[i % RULE_COLOURS.length];

/** Flip every this many ms. */
const FLIP_MS = 1100;

/** Whether the pictures flip on their own (off for reduced motion: a click flips them). */
const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function useFlip(): [boolean, () => void] {
  const [after, setAfter] = useState(false);
  useEffect(() => {
    if (reduced()) return;
    const id = window.setInterval(() => setAfter(a => !a), FLIP_MS);
    return () => window.clearInterval(id);
  }, []);
  return [after, () => setAfter(a => !a)];
}

export function StateGrid({ grid, p, cell = 16, rings = [], label }: {
  grid: Grid; p: P; cell?: number;
  /** Cells to ring, [row, col], and the colour of each ring. */
  rings?: Array<{ row: number; col: number; w?: number; h?: number; colour: string }>;
  label?: string;
}) {
  const tk = useTokens();
  const rows = grid.length, cols = grid[0]?.length ?? 0;
  const gap = 1;
  const W = cols * cell + (cols - 1) * gap, H = rows * cell + (rows - 1) * gap;
  return (
    <svg width={W + 4} height={H + 4} viewBox={`-2 -2 ${W + 4} ${H + 4}`} role="img" aria-label={label} style={{ display: 'block', flexShrink: 0 }}>
      {grid.flatMap((row, r) => row.map((v, c) => (
        <rect key={`${r},${c}`} x={c * (cell + gap)} y={r * (cell + gap)} width={cell} height={cell} rx={2} fill={stateColour(p, v)} stroke={tk.border.subtle} strokeWidth={0.5} />
      )))}
      {rings.map((g, i) => (
        <rect key={`ring${i}`} x={g.col * (cell + gap) - 1} y={g.row * (cell + gap) - 1} width={(g.w ?? 1) * (cell + gap) + 1} height={(g.h ?? 1) * (cell + gap) + 1} rx={3}
          fill="none" stroke={g.colour} strokeWidth={2} />
      ))}
    </svg>
  );
}

/** Two grids in turn: Before, then After. Click to flip by hand. */
export function FlipGrid({ before, after, p, cell, rings, title }: {
  before: Grid; after: Grid; p: P; cell?: number; rings?: Array<{ row: number; col: number; w?: number; h?: number; colour: string }>; title?: string;
}) {
  const tk = useTokens();
  const [showAfter, flip] = useFlip();
  const same = before.every((row, r) => row.every((v, c) => after[r][c] === v));
  return (
    <button type="button" data-flip-grid={showAfter ? 'after' : 'before'} onClick={flip} title={title ?? 'Before and after one step (click to flip)'}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: 6, border: 0, borderRadius: radius.md, background: tk.bg.field, cursor: 'pointer' }}>
      <StateGrid grid={showAfter ? after : before} p={p} cell={cell} rings={rings} label={showAfter ? 'After' : 'Before'} />
      <span style={{ display: 'flex', gap: 6, font: `600 10.5px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        <span style={{ color: showAfter ? tk.text.faint : tk.text.primary }}>Before</span>
        <span style={{ color: tk.text.faint }}>→</span>
        <span style={{ color: showAfter ? tk.text.primary : tk.text.faint }}>{same ? 'no change' : 'After'}</span>
      </span>
    </button>
  );
}

/** Every Blocks rule on a small board together, one real step at a time; rules switch on and off. */
export function BlocksTogether({ p, rules }: { p: P; rules: Array<{ off?: boolean }> }) {
  const tk = useTokens();
  const [on, setOn] = useState<Set<number>>(() => new Set(rules.map((r, i) => (r.off ? -1 : i)).filter(i => i >= 0)));
  const [deal, setDeal] = useState(7);
  const [board, setBoard] = useState<CpuBoard>(() => comboBoard(p, 12, 8, deal));
  // A new board when the states or the edges change, or on New board.
  const shapeKey = `${p.states}:${p.edges}:${deal}`;
  useEffect(() => { setBoard(comboBoard(p, 12, 8, deal)); }, [shapeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setOn(o => new Set([...o].filter(i => i < rules.length))); }, [rules.length]);
  const step = useMemo(() => comboStep(p, board, on), [p, board, on]);
  const before = gridOfBoard(step.before), after = gridOfBoard(step.after);
  const rings = step.fired.map(f => ({ row: board.h - 2 - f.y, col: f.x, w: 2, h: 2, colour: ruleColour(f.rule) }))
    .filter(g => g.col >= 0 && g.row >= 0 && g.col + 1 < board.w && g.row + 1 < board.h);
  const counts = new Map<number, number>();
  for (const f of step.fired) counts.set(f.rule, (counts.get(f.rule) ?? 0) + 1);
  return (
    <div data-blocks-together style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }} role="group" aria-label="Rules in this picture">
        {rules.map((_, i) => {
          const sel = on.has(i);
          return (
            <button key={i} type="button" aria-pressed={sel} data-together-rule={i} onClick={() => setOn(o => { const n = new Set(o); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '4px 9px', border: 0, borderRadius: radius.md, cursor: 'pointer',
                background: sel ? alpha(ruleColour(i), 0.16) : tk.bg.field, boxShadow: `inset 0 0 0 ${sel ? 1.5 : 1}px ${sel ? ruleColour(i) : tk.border.subtle}`,
                color: sel ? tk.text.primary : tk.text.muted, font: `600 11.5px ${fontFamily.ui}`,
              }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: ruleColour(i) }} />
              Rule {i + 1}{sel && counts.get(i) ? ` · ${counts.get(i)}` : ''}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <FlipGrid before={before} after={after} p={p} cell={15} rings={rings} title="One step with the rules switched on: each block a rule changed is ringed in its colour (click to flip)" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 12, color: tk.text.secondary, lineHeight: 1.45 }}>
            {on.size === 0 ? 'Switch a rule on to see what it does.' : on.size === 1 ? `Rule ${[...on][0] + 1} alone. Switch another on to see them together.` : `${on.size} rules together: the first that fits a block changes it.`}
          </span>
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Button size="sm" icon="chevR" data-together-next onClick={() => setBoard(step.after)}>Next step</Button>
            <Button size="sm" icon="dice" onClick={() => setDeal(d => d + 1)}>New board</Button>
          </span>
        </div>
      </div>
    </div>
  );
}
