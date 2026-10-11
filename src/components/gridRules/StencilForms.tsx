/**
 * The Grid Rules builder's Stencils and Blocks sections (gridRules/stencils.ts):
 *
 *  - Stencils: an ordered list of rules, each a drawn 3×3 stencil round "this cell" (ringed). A cell
 *    of the stencil is a state (its colour), "any" (hatched: not looked at) or "not empty" (dotted).
 *    Click a cell to pick what it must be from a row of choices under it; the cell after the arrow is
 *    what this cell becomes. Each rule reads back as a sentence, flips between an example and what
 *    it makes of it, and pointing at it lights the cells it matches on the board.
 *  - Blocks: before → after 2×2 pictures, each beside a small grid flipping from the example to what
 *    the rule makes of it (the rule alone), then every rule together, a real step at a time
 *    (RulePictures.tsx BlocksTogether). Chance is rolled per block; Jitter shuffles the block rows.
 *
 * Presets live in the builder's presets strip. Every edit writes the node's `patterns` / `blocks`
 * param (one undo step; it recompiles).
 */
import { useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { BuilderSlider } from '../builders/BuilderSlider';
import { HintLabel } from '../builders/BuilderWindow';
import { GRID_DEFAULTS, MAX_STATES, gridShape } from '../../gridRules/spec';
import {
  ANY, NOT_EMPTY, SAME, blockConserves,
  type BlockRule, type BlockSymmetry, type PatternRule, type PatternSymmetry,
} from '../../gridRules/stencils';
import { STENCIL_PLACES, blockExample, patternExample, patternSentence } from '../../gridRules/ruleExamples';
import { stateColour } from './TryBoard';
import { BlocksTogether, FlipGrid, ruleColour } from './RulePictures';

type P = Record<string, unknown>;
type Setter = (patch: P, immediate?: boolean) => void;

const statesOf = (p: P) => Math.max(2, Math.min(8, Math.round(Number(p.states ?? 2))));
const ink = (rgbCss: string) => {
  const [r, g, b] = rgbCss.slice(4, -1).split(',').map(Number);
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? '#111' : '#fff';
};
const specWord = (v: number, after = false) => (v === ANY ? (after ? 'unchanged' : 'any') : v === NOT_EMPTY ? 'not empty' : v === 0 ? 'empty (0)' : `state ${v}`);

/** One cell of a drawn stencil: a state's colour, hatched "any", dotted "not empty", or (after) "=" unchanged. */
function StencilCell({ value, p, size, middle = false, after = false, picked = false, onClick, label }: {
  value: number; p: P; size: number; middle?: boolean; after?: boolean; picked?: boolean; onClick: () => void; label: string;
}) {
  const tk = useTokens();
  const isState = value >= 0;
  const bg = isState ? stateColour(p, value) : 'transparent';
  const top = statesOf(p) - 1;
  return (
    <button type="button" onClick={onClick} aria-label={`${label}: ${specWord(value, after)}`} aria-pressed={picked} data-stencil-cell={label} title={`${label}: ${specWord(value, after)} (click to change)`}
      style={{
        position: 'relative', width: size, height: size, padding: 0, border: 0, borderRadius: 6, cursor: 'pointer', overflow: 'hidden',
        background: isState ? bg : value === NOT_EMPTY
          ? `radial-gradient(circle, ${stateColour(p, 1)} 22%, transparent 26%) 0 0 / 8px 8px, ${tk.bg.field}`
          : `repeating-linear-gradient(45deg, ${alpha(tk.text.faint, 0.25)} 0 2px, transparent 2px 7px), ${tk.bg.field}`,
        boxShadow: picked ? `0 0 0 2px ${tk.accent.base}` : middle ? `inset 0 0 0 2.5px ${tk.text.primary}` : `inset 0 0 0 1px ${tk.border.default}`,
        color: isState ? ink(bg) : tk.text.muted, font: `650 11px ${fontFamily.mono}`,
      }}>
      {isState ? (top > 1 ? value : '') : value === NOT_EMPTY ? '' : after ? '=' : ''}
    </button>
  );
}

/** The choices for a picked cell: any, not empty (befores only), each state, or unchanged (afters). */
function CellChoices({ p, value, after = false, anyOk = true, onPick, place }: { p: P; value: number; after?: boolean; anyOk?: boolean; onPick: (v: number) => void; place: string }) {
  const tk = useTokens();
  const top = statesOf(p) - 1;
  const opts = [...(anyOk ? [after ? SAME : ANY] : []), ...(!after && anyOk ? [NOT_EMPTY] : []), ...Array.from({ length: top + 1 }, (_, k) => k)];
  return (
    <div data-cell-choices style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11.5, color: tk.text.muted, marginRight: 2 }}>{place}:</span>
      {opts.map(v => (
        <button key={v} type="button" aria-pressed={v === value} data-choice={v} onClick={() => onPick(v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '3px 7px', border: 0, borderRadius: radius.sm, cursor: 'pointer',
            background: v === value ? tk.bg.selected : tk.bg.field, boxShadow: `inset 0 0 0 ${v === value ? 1.5 : 1}px ${v === value ? tk.accent.base : tk.border.subtle}`,
            color: tk.text.primary, font: `500 11.5px ${fontFamily.ui}`,
          }}>
          {v >= 0 && <span style={{ width: 10, height: 10, borderRadius: 2, background: stateColour(p, v), boxShadow: `inset 0 0 0 1px ${tk.border.default}` }} />}
          {specWord(v, after)}
        </button>
      ))}
    </div>
  );
}

function RuleCard({ index, title, off, children, actions, onHover }: { index: number; title: string; off?: boolean; children: ReactNode; actions: ReactNode; onHover?: (on: boolean) => void }) {
  const tk = useTokens();
  return (
    <div data-rule-card={index} onPointerEnter={() => onHover?.(true)} onPointerLeave={() => onHover?.(false)}
      style={{ borderRadius: radius.card, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, opacity: off ? 0.55 : 1, background: tk.bg.panel }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, background: ruleColour(index), flexShrink: 0 }} />
        <b style={{ font: `600 13px ${fontFamily.ui}`, flex: 1 }}>{title}</b>
        {actions}
      </div>
      {children}
    </div>
  );
}

function ListActions({ i, n, off, onMove, onDelete, onToggle }: { i: number; n: number; off: boolean; onMove: (d: -1 | 1) => void; onDelete: () => void; onToggle: (on: boolean) => void }) {
  return (
    <>
      <Toggle checked={!off} onChange={onToggle} label={off ? 'Off' : 'On'} />
      <IconButton icon="chevU" size="sm" label="Try this rule earlier" disabled={i === 0} onClick={() => onMove(-1)} />
      <IconButton icon="chevD" size="sm" label="Try this rule later" disabled={i === n - 1} onClick={() => onMove(1)} />
      <IconButton icon="trash" size="sm" tone="danger" label="Remove this rule" onClick={onDelete} />
    </>
  );
}

const move = <T,>(list: T[], i: number, d: number) => { const out = [...list]; const [x] = out.splice(i, 1); out.splice(i + d, 0, x); return out; };

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '96px 1fr', alignItems: 'center', gap: 10 }}>
      <span style={{ color: tk.text.secondary, fontSize: 12.5, minWidth: 0, display: 'flex' }}><HintLabel hint={hint}>{label}</HintLabel></span>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

export function StatesRow({ p, set, nodeId }: { p: P; set: Setter; nodeId?: string }) {
  return (
    <Row label="States" hint="How many states a cell can be in, counting empty (0). Each has its colour (Look).">
      <BuilderSlider ariaLabel="States" value={statesOf(p)} min={2} max={Math.min(8, MAX_STATES)} step={1} integer defaultValue={3} onChange={v => set({ states: v })}
        rangeKey="grid:states" param={nodeId ? { nodeId, key: 'states' } : undefined} />
    </Row>
  );
}

// ── Stencils ────────────────────────────────────────────────────────────────────────────────────

export function PatternsForm({ p, set, onHoverRule, nodeId }: { p: P; set: Setter; onHoverRule?: (i: number | null) => void; nodeId?: string }) {
  const tk = useTokens();
  const rules = gridShape(p).patterns;
  const states = statesOf(p);
  const top = states - 1;
  const save = (next: PatternRule[]) => set({ patterns: next }, true);
  const edit = (i: number, patch: Partial<PatternRule>) => save(rules.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  // The cell picked for editing: [rule, cell] (cell 9 is "becomes").
  const [picked, setPicked] = useState<[number, number] | null>(null);
  return (
    <>
      <StatesRow p={p} set={set} nodeId={nodeId} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11.5, color: tk.text.muted, alignItems: 'center' }}>
        <Legend swatch={<StencilCellSwatch kind="any" p={p} />} text="any: not looked at" />
        <Legend swatch={<StencilCellSwatch kind="not" p={p} />} text="not empty" />
        <Legend swatch={<StencilCellSwatch kind="self" p={p} />} text="this cell" />
      </div>
      {rules.map((r, i) => {
        const pick = picked && picked[0] === i ? picked[1] : null;
        const ex = patternExample(r, states);
        return (
          <RuleCard key={i} index={i} title={`Rule ${i + 1}`} off={r.off} onHover={on => onHoverRule?.(on ? i : null)}
            actions={<ListActions i={i} n={rules.length} off={!!r.off} onMove={d => { setPicked(null); save(move(rules, i, d)); }} onDelete={() => { setPicked(null); save(rules.filter((_, k) => k !== i)); }} onToggle={on => edit(i, { off: !on })} />}>
            <span data-rule-sentence-stencil style={{ fontSize: 12.5, lineHeight: 1.45 }}>{patternSentence(r)}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 34px)', gap: 3 }} role="group" aria-label={`Rule ${i + 1} stencil`}>
                {r.cells.map((c, k) => (
                  <StencilCell key={k} value={c} p={p} size={34} middle={k === 4} picked={pick === k} label={STENCIL_PLACES[k][0].toUpperCase() + STENCIL_PLACES[k].slice(1)}
                    onClick={() => setPicked(pick === k ? null : [i, k])} />
                ))}
              </div>
              <span style={{ font: `600 18px ${fontFamily.ui}`, color: tk.text.faint }}>→</span>
              <StencilCell value={r.becomes} p={p} size={40} picked={pick === 9} label="Becomes" onClick={() => setPicked(pick === 9 ? null : [i, 9])} />
              <span style={{ flex: 1 }} />
              <FlipGrid before={ex.before} after={ex.after} p={p} cell={13} rings={[{ row: 1, col: 1, colour: ruleColour(i) }]} title="An example of what this rule matches, and the middle cell after it (click to flip)" />
            </div>
            {pick !== null && pick < 9 && (
              <CellChoices p={p} value={r.cells[pick]} place={STENCIL_PLACES[pick][0].toUpperCase() + STENCIL_PLACES[pick].slice(1)}
                onPick={v => edit(i, { cells: r.cells.map((x, j) => (j === pick ? v : x)) })} />
            )}
            {pick === 9 && <CellChoices p={p} value={r.becomes} place="Becomes" anyOk={false} onPick={v => edit(i, { becomes: v })} />}
            <Segmented<PatternSymmetry> ariaLabel="Orientations" size="sm" value={r.symmetry} onChange={v => edit(i, { symmetry: v })}
              options={[{ value: 'none', label: 'As drawn' }, { value: 'rotate', label: 'Turned any way' }, { value: 'all', label: 'Turned or mirrored' }]} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: tk.text.secondary, flexWrap: 'wrap' }}>
              <input type="checkbox" checked={!!r.count} onChange={e => edit(i, { count: e.target.checked ? { state: 1, min: 1, max: 2 } : null })} />
              {'and '}
              {r.count ? (
                <>
                  <NumberBox value={r.count.min} max={8} onChange={v => edit(i, { count: { ...r.count!, min: v } })} label="from" />
                  to
                  <NumberBox value={r.count.max} max={8} onChange={v => edit(i, { count: { ...r.count!, max: v } })} label="to" />
                  of the 8 round it are
                  <NumberBox value={r.count.state} max={top} onChange={v => edit(i, { count: { ...r.count!, state: v } })} label="state" />
                </>
              ) : 'a count of the cells round it'}
            </label>
          </RuleCard>
        );
      })}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Button size="sm" icon="plus" onClick={() => save([...rules, { cells: [ANY, ANY, ANY, ANY, 0, ANY, ANY, ANY, ANY], becomes: Math.min(1, top), symmetry: 'none', count: null }])}>Add a rule</Button>
        <span style={{ color: tk.text.muted, fontSize: 12 }}>The first rule that matches wins; none matching, the cell stays.</span>
      </div>
    </>
  );
}

function Legend({ swatch, text }: { swatch: ReactNode; text: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>{swatch}{text}</span>;
}

function StencilCellSwatch({ kind, p }: { kind: 'any' | 'not' | 'self'; p: P }) {
  const tk = useTokens();
  const style: React.CSSProperties = { width: 14, height: 14, borderRadius: 3, display: 'inline-block' };
  if (kind === 'any') return <span style={{ ...style, background: `repeating-linear-gradient(45deg, ${alpha(tk.text.faint, 0.3)} 0 2px, transparent 2px 5px), ${tk.bg.field}`, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }} />;
  if (kind === 'not') return <span style={{ ...style, background: `radial-gradient(circle, ${stateColour(p, 1)} 22%, transparent 28%) 0 0 / 6px 6px, ${tk.bg.field}`, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }} />;
  return <span style={{ ...style, boxShadow: `inset 0 0 0 2px ${tk.text.primary}` }} />;
}

function NumberBox({ value, max, onChange, label }: { value: number; max: number; onChange: (v: number) => void; label: string }) {
  const tk = useTokens();
  return (
    <input type="number" aria-label={label} min={0} max={max} value={value} onChange={e => onChange(Math.max(0, Math.min(max, Math.round(Number(e.target.value) || 0))))}
      style={{ width: 44, height: 26, border: 0, borderRadius: radius.md, background: tk.bg.field, color: tk.text.primary, font: `600 12px ${fontFamily.mono}`, textAlign: 'center' }} />
  );
}

// ── Blocks ──────────────────────────────────────────────────────────────────────────────────────

export const JITTER_HINT = 'Shuffles the block grid a little each step: each two-cell column is cut into short segments, and a segment\'s blocks move up a row at random. '
  + 'In plain Margolus every grain that falls ends the step in its block\'s bottom row, so a falling cloud shows in bands on every other row; Jitter breaks them up and makes slopes less rigid (grains fall about half as fast). '
  + '0 is the classic grid (the HPP gas needs it to fly straight). A block still changes all four cells at once, so nothing is lost or made, and the same Seed gives the same run.';

const CORNERS = ['Top left', 'Top right', 'Bottom left', 'Bottom right'];

export function BlocksForm({ p, set, nodeId }: { p: P; set: Setter; nodeId?: string }) {
  const tk = useTokens();
  const rules = gridShape(p).blocks;
  const states = statesOf(p);
  const save = (next: BlockRule[]) => set({ blocks: next }, true);
  const edit = (i: number, patch: Partial<BlockRule>) => save(rules.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  // The cell picked for editing: [rule, side, corner].
  const [picked, setPicked] = useState<[number, 'before' | 'after', number] | null>(null);
  const grid2 = (i: number, side: 'before' | 'after', cells: number[]) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 34px)', gap: 3 }} role="group" aria-label={`Rule ${i + 1} ${side}`}>
      {cells.map((c, k) => {
        const on = !!picked && picked[0] === i && picked[1] === side && picked[2] === k;
        return <StencilCell key={k} value={c} p={p} size={34} after={side === 'after'} picked={on} label={`${side === 'before' ? 'Before' : 'After'}, ${CORNERS[k].toLowerCase()}`} onClick={() => setPicked(on ? null : [i, side, k])} />;
      })}
    </div>
  );
  return (
    <>
      <StatesRow p={p} set={set} nodeId={nodeId} />
      {rules.map((r, i) => {
        const keeps = blockConserves(r);
        const ex = blockExample(r, states);
        const pick = picked && picked[0] === i ? picked : null;
        return (
          <RuleCard key={i} index={i} title={`Rule ${i + 1}`} off={r.off}
            actions={<ListActions i={i} n={rules.length} off={!!r.off} onMove={d => { setPicked(null); save(move(rules, i, d)); }} onDelete={() => { setPicked(null); save(rules.filter((_, k) => k !== i)); }} onToggle={on => edit(i, { off: !on })} />}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {grid2(i, 'before', r.before)}
              <span style={{ font: `600 18px ${fontFamily.ui}`, color: tk.text.faint }}>→</span>
              {grid2(i, 'after', r.after)}
              <span style={{ flex: 1 }} />
              <FlipGrid before={ex.before} after={ex.after} p={p} cell={14} rings={[{ row: 1, col: 1, w: 2, h: 2, colour: ruleColour(i) }]} title="This rule alone on a small grid: before, and after one step (click to flip)" />
            </div>
            {pick && (
              <CellChoices p={p} after={pick[1] === 'after'} value={(pick[1] === 'before' ? r.before : r.after)[pick[2]]} place={`${pick[1] === 'before' ? 'Before' : 'After'}, ${CORNERS[pick[2]].toLowerCase()}`}
                onPick={v => edit(i, pick[1] === 'before' ? { before: r.before.map((x, j) => (j === pick[2] ? v : x)) } : { after: r.after.map((x, j) => (j === pick[2] ? v : x)) })} />
            )}
            <Segmented<BlockSymmetry> ariaLabel="Orientations" size="sm" value={r.symmetry} onChange={v => edit(i, { symmetry: v })}
              options={[{ value: 'none', label: 'As drawn' }, { value: 'mirror', label: 'Mirrored too' }, { value: 'rotate', label: 'Turned any way' }]} />
            <Row label="Chance" hint="The share of the blocks it fits that it changes each step (rolled once per block).">
              <BuilderSlider ariaLabel="Chance" value={r.chance} min={0} max={1} step={0.01} defaultValue={1} onChange={v => edit(i, { chance: v })} />
            </Row>
            <span style={{ fontSize: 11.5, color: keeps ? tk.status.success : tk.status.warningText }}>{keeps ? '✓ Keeps every cell: it only moves them' : 'Makes or removes cells'}</span>
          </RuleCard>
        );
      })}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Button size="sm" icon="plus" onClick={() => save([...rules, { before: [1, ANY, 0, ANY], after: [0, SAME, 1, SAME], symmetry: 'none', chance: 1 }])}>Add a rule</Button>
        <span style={{ color: tk.text.muted, fontSize: 12 }}>No rule fits: the block stays as it is.</span>
      </div>
      {rules.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
          <b style={{ fontSize: 13 }}>Together</b>
          <span style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.45 }}>One real step on a small board. Switch rules on and off to see each alone, then in combinations.</span>
          <BlocksTogether p={p} rules={rules} />
        </div>
      )}
      <Row label="Jitter" hint={JITTER_HINT}>
        <BuilderSlider ariaLabel="Jitter" value={typeof p.jitter === 'number' ? p.jitter : Number(GRID_DEFAULTS.jitter)} min={0} max={1} step={0.01} defaultValue={Number(GRID_DEFAULTS.jitter)}
          onChange={x => set({ jitter: x })} rangeKey="grid:jitter" param={nodeId ? { nodeId, key: 'jitter' } : undefined} />
      </Row>
    </>
  );
}
