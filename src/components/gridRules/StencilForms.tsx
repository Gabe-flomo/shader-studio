/**
 * The Grid Rules editor's Patterns and Blocks forms (gridRules/stencils.ts):
 *
 *  - Patterns: an ordered list of 3×3 stencils. Click a cell to cycle it: any (·) → each state →
 *    not empty (≠0) → any. The middle is "this cell is"; the cell after the arrow is what it
 *    becomes. Turns / mirrors make one stencil stand for every orientation; "and" adds a count.
 *  - Blocks: before → after 2×2 pictures; the after cycles unchanged (=) → each state. A badge says
 *    whether the rule keeps every state's count. Chance is rolled per block. Jitter (a live slider
 *    under the rules) shuffles the block rows a little each step, so falling grains don't band.
 *
 * Every edit writes the node's `patterns` / `blocks` param (one undo step; it recompiles).
 */
import type { ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { RulerSlider } from '../ui/RulerSlider';
import { Toggle } from '../ui/Choice';
import { HintLabel } from '../builders/BuilderWindow';
import { GRID_DEFAULTS, MAX_STATES, gridShape, matchingPreset, presetPatch, type GridPreset } from '../../gridRules/spec';
import {
  ANY, BLOCK_PRESETS, NOT_EMPTY, PATTERN_PRESETS, SAME, blockConserves,
  type BlockRule, type BlockSymmetry, type PatternRule, type PatternSymmetry,
} from '../../gridRules/stencils';

type P = Record<string, unknown>;
type Setter = (patch: P, immediate?: boolean) => void;

const statesOf = (p: P) => Math.max(2, Math.min(8, Math.round(Number(p.states ?? 2))));
const colourOf = (p: P, k: number) => {
  const c = (Array.isArray(p[`color${Math.min(7, k)}`]) ? p[`color${Math.min(7, k)}`] : GRID_DEFAULTS[`color${Math.min(7, k)}`]) as number[];
  return `rgb(${c.map(x => Math.round(Math.max(0, Math.min(1, x)) * 255)).join(',')})`;
};
const ink = (rgbCss: string) => {
  const [r, g, b] = rgbCss.slice(4, -1).split(',').map(Number);
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? '#111' : '#fff';
};

/** One clickable cell: a spec (any, not empty, a state) or, for an after, unchanged. */
function Cell({ value, p, onClick, label, middle = false, after = false, size = 36 }: { value: number; p: P; onClick: () => void; label: string; middle?: boolean; after?: boolean; size?: number }) {
  const tk = useTokens();
  const isState = value >= 0;
  const bg = isState ? colourOf(p, value) : tk.bg.field;
  const text = isState ? String(value) : value === NOT_EMPTY ? '≠0' : after ? '=' : '·';
  return (
    <button type="button" onClick={onClick} aria-label={label} title={`${label}: ${isState ? `state ${value}` : value === NOT_EMPTY ? 'not empty' : after ? 'unchanged' : 'any'} (click to change)`}
      style={{
        width: size, height: size, border: 0, borderRadius: 6, cursor: 'pointer', padding: 0,
        background: bg, color: isState ? ink(bg) : tk.text.muted, font: `650 12px ${fontFamily.mono}`,
        boxShadow: middle ? `inset 0 0 0 2px ${tk.accent.base}` : `inset 0 0 0 1px ${tk.border.default}`,
      }}>
      {text}
    </button>
  );
}

/** The next spec when a cell is clicked: any → 0 → 1 → … → top → not empty → any. */
const nextSpec = (v: number, top: number) => (v === ANY ? 0 : v === NOT_EMPTY ? ANY : v >= top ? NOT_EMPTY : v + 1);
/** An after cell: unchanged → 0 → … → top → unchanged. */
const nextAfter = (v: number, top: number) => (v === SAME ? 0 : v >= top ? SAME : v + 1);

function Card({ title, children, actions, off }: { title: string; children: ReactNode; actions: ReactNode; off?: boolean }) {
  const tk = useTokens();
  return (
    <div style={{ borderRadius: radius.md, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, opacity: off ? 0.55 : 1, background: tk.bg.panel }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <b style={{ font: `600 12.5px ${fontFamily.ui}`, flex: 1 }}>{title}</b>
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

function StencilPresets({ table, p, set }: { table: Record<string, GridPreset>; p: P; set: Setter }) {
  const tk = useTokens();
  const current = matchingPreset(p);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {Object.entries(table).map(([key, pr]) => {
        const on = key === current;
        return (
          <button key={key} type="button" title={pr.hint} aria-pressed={on} onClick={() => set(presetPatch(pr), true)}
            style={{
              border: 0, cursor: 'pointer', padding: '5px 10px', borderRadius: radius.md, font: `500 12px ${fontFamily.ui}`,
              background: on ? tk.bg.selected : tk.bg.field, color: on ? tk.accent.text : tk.text.primary,
              boxShadow: `inset 0 0 0 ${on ? 1.5 : 1}px ${on ? tk.accent.base : tk.border.subtle}`,
            }}>
            {pr.label}
          </button>
        );
      })}
    </div>
  );
}

function StatesRow({ p, set }: { p: P; set: Setter }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '118px 1fr', alignItems: 'center', gap: 10 }}>
      <span style={{ color: tk.text.secondary, fontSize: 12.5 }}>States</span>
      <RulerSlider ariaLabel="States" value={statesOf(p)} min={2} max={Math.min(8, MAX_STATES)} step={1} integer onChange={v => set({ states: v })} />
    </div>
  );
}

function Heading({ title, hint }: { title: string; hint: string }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <b style={{ font: `600 13px ${fontFamily.ui}` }}>{title}</b>
      <span style={{ color: tk.text.muted, fontSize: 12, lineHeight: 1.4 }}>{hint}</span>
    </div>
  );
}

// ── Patterns ────────────────────────────────────────────────────────────────────────────────────

/** `part`: the presets and states (the Presets tab), the rule list (the Stencils tab), or both. */
export function PatternsForm({ p, set, part = 'all' }: { p: P; set: Setter; part?: 'presets' | 'rules' | 'all' }) {
  const tk = useTokens();
  const rules = gridShape(p).patterns;
  const top = statesOf(p) - 1;
  const save = (next: PatternRule[]) => set({ patterns: next }, true);
  const edit = (i: number, patch: Partial<PatternRule>) => save(rules.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <>
      {part !== 'rules' && <>
        <Heading title="Presets" hint="Rules as pictures: each says what the 3×3 block round a cell must look like, and what the cell becomes." />
        <StencilPresets table={PATTERN_PRESETS} p={p} set={set} />
        <StatesRow p={p} set={set} />
      </>}
      {part !== 'presets' && <>
      <Heading title="Rules, tried in order" hint="Click a cell to cycle it: · any, a state, ≠0 not empty. The blue-ringed middle is the cell itself. The first rule that matches wins." />
      {rules.map((r, i) => (
        <Card key={i} title={`Rule ${i + 1}`} off={r.off} actions={<ListActions i={i} n={rules.length} off={!!r.off} onMove={d => save(move(rules, i, d))} onDelete={() => save(rules.filter((_, k) => k !== i))} onToggle={on => edit(i, { off: !on })} />}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 36px)', gap: 4 }} role="group" aria-label={`Rule ${i + 1} stencil`}>
              {r.cells.map((c, k) => (
                <Cell key={k} value={c} p={p} middle={k === 4} label={k === 4 ? 'This cell' : `Cell ${k + 1}`}
                  onClick={() => edit(i, { cells: r.cells.map((x, j) => (j === k ? nextSpec(x, top) : x)) })} />
              ))}
            </div>
            <span style={{ font: `600 18px ${fontFamily.ui}`, color: tk.text.faint }}>→</span>
            <Cell value={r.becomes} p={p} label="Becomes" size={44} onClick={() => edit(i, { becomes: r.becomes >= top ? 0 : r.becomes + 1 })} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 220 }}>
              <Segmented<PatternSymmetry> ariaLabel="Orientations" size="sm" value={r.symmetry} onChange={v => edit(i, { symmetry: v })}
                options={[{ value: 'none', label: 'As drawn' }, { value: 'rotate', label: 'Turns' }, { value: 'all', label: 'Turns + mirrors' }]} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: tk.text.secondary, flexWrap: 'wrap' }}>
                <input type="checkbox" checked={!!r.count} onChange={e => edit(i, { count: e.target.checked ? { state: 1, min: 1, max: 2 } : null })} />
                {'and '}
                {r.count ? (
                  <>
                    <NumberBox value={r.count.min} max={8} onChange={v => edit(i, { count: { ...r.count!, min: v } })} label="from" />
                    to
                    <NumberBox value={r.count.max} max={8} onChange={v => edit(i, { count: { ...r.count!, max: v } })} label="to" />
                    neighbours in state
                    <NumberBox value={r.count.state} max={top} onChange={v => edit(i, { count: { ...r.count!, state: v } })} label="state" />
                  </>
                ) : 'a count of neighbours'}
              </label>
            </div>
          </div>
        </Card>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Button size="sm" icon="plus" onClick={() => save([...rules, { cells: [ANY, ANY, ANY, ANY, 0, ANY, ANY, ANY, ANY], becomes: Math.min(1, top), symmetry: 'none', count: null }])}>Add a rule</Button>
        <span style={{ color: tk.text.muted, fontSize: 12 }}>No rule matches: the cell stays as it is.</span>
      </div>
      </>}
    </>
  );
}

function NumberBox({ value, max, onChange, label }: { value: number; max: number; onChange: (v: number) => void; label: string }) {
  const tk = useTokens();
  return (
    <input type="number" aria-label={label} min={0} max={max} value={value} onChange={e => onChange(Math.max(0, Math.min(max, Math.round(Number(e.target.value) || 0))))}
      style={{ width: 44, height: 26, border: 0, borderRadius: radius.md, background: tk.bg.field, color: tk.text.primary, font: `600 12px ${fontFamily.mono}`, textAlign: 'center' }} />
  );
}

// ── Blocks ──────────────────────────────────────────────────────────────────────────────────────

/** Jitter (gridRules/dice.ts): a live slider, so dragging it never recompiles. */
function JitterRow({ p, set }: { p: P; set: Setter }) {
  const tk = useTokens();
  const v = typeof p.jitter === 'number' ? p.jitter : Number(GRID_DEFAULTS.jitter);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '118px 1fr', alignItems: 'center', gap: 10 }}>
      <span style={{ color: tk.text.secondary, fontSize: 12.5, minWidth: 0, display: 'flex' }}>
        <HintLabel hint={JITTER_HINT}>Jitter</HintLabel>
      </span>
      <RulerSlider ariaLabel="Jitter" value={v} min={0} max={1} step={0.01} defaultValue={Number(GRID_DEFAULTS.jitter)} onChange={x => set({ jitter: x })} />
    </div>
  );
}

const JITTER_HINT = 'Shuffles the block grid a little each step: each two-cell column is cut into short segments, and a segment\'s blocks move up a row at random. '
  + 'In plain Margolus every grain that falls ends the step in its block\'s bottom row, so a falling cloud shows in bands on every other row; Jitter breaks them up and makes slopes less rigid (grains fall about half as fast). '
  + '0 is the classic grid (the HPP gas needs it to fly straight). A block still changes all four cells at once, so nothing is lost or made, and the same Seed gives the same run.';

export function BlocksForm({ p, set, part = 'all' }: { p: P; set: Setter; part?: 'presets' | 'rules' | 'all' }) {
  const tk = useTokens();
  const rules = gridShape(p).blocks;
  const top = statesOf(p) - 1;
  const save = (next: BlockRule[]) => set({ blocks: next }, true);
  const edit = (i: number, patch: Partial<BlockRule>) => save(rules.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const grid2 = (cells: number[], after: boolean, onCell: (k: number) => void, aria: string) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 40px)', gap: 4 }} role="group" aria-label={aria}>
      {cells.map((c, k) => <Cell key={k} value={c} p={p} after={after} size={40} label={`${aria}, ${['top left', 'top right', 'bottom left', 'bottom right'][k]}`} onClick={() => onCell(k)} />)}
    </div>
  );
  return (
    <>
      {part !== 'rules' && <>
        <Heading title="Presets" hint="Margolus blocks: the board in 2×2 blocks whose grid shifts one cell diagonally every step. A block that looks like a before picture becomes its after picture, all four cells at once." />
        <StencilPresets table={BLOCK_PRESETS} p={p} set={set} />
        <StatesRow p={p} set={set} />
      </>}
      {part !== 'presets' && <>
      <Heading title="Rules, tried in order" hint="Before: · any, a state, ≠0 not empty (the board's edge counts as not empty). After: = unchanged, or a state. An after that only rearranges its before keeps every count: nothing is made or lost." />
      {rules.map((r, i) => {
        const keeps = blockConserves(r);
        return (
          <Card key={i} title={`Rule ${i + 1}`} off={r.off} actions={<ListActions i={i} n={rules.length} off={!!r.off} onMove={d => save(move(rules, i, d))} onDelete={() => save(rules.filter((_, k) => k !== i))} onToggle={on => edit(i, { off: !on })} />}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              {grid2(r.before, false, k => edit(i, { before: r.before.map((x, j) => (j === k ? nextSpec(x, top) : x)) }), `Rule ${i + 1} before`)}
              <span style={{ font: `600 18px ${fontFamily.ui}`, color: tk.text.faint }}>→</span>
              {grid2(r.after, true, k => edit(i, { after: r.after.map((x, j) => (j === k ? nextAfter(x, top) : x)) }), `Rule ${i + 1} after`)}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 220, flex: 1 }}>
                <Segmented<BlockSymmetry> ariaLabel="Orientations" size="sm" value={r.symmetry} onChange={v => edit(i, { symmetry: v })}
                  options={[{ value: 'none', label: 'As drawn' }, { value: 'mirror', label: 'Mirrored' }, { value: 'rotate', label: 'Turns' }]} />
                <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: tk.text.secondary }}>Chance</span>
                  <RulerSlider ariaLabel="Chance" value={r.chance} min={0} max={1} step={0.01} onChange={v => edit(i, { chance: v })} />
                </div>
                <span style={{ fontSize: 11.5, color: keeps ? tk.status.success : tk.status.warningText }}>{keeps ? '✓ keeps every count' : 'Makes or removes cells'}</span>
              </div>
            </div>
          </Card>
        );
      })}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Button size="sm" icon="plus" onClick={() => save([...rules, { before: [1, ANY, 0, ANY], after: [0, SAME, 1, SAME], symmetry: 'none', chance: 1 }])}>Add a rule</Button>
        <span style={{ color: tk.text.muted, fontSize: 12 }}>No rule matches: the block stays as it is.</span>
      </div>
      <JitterRow p={p} set={set} />
      </>}
    </>
  );
}
