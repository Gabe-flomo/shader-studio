/**
 * The Grid Rules builder's Stacked rules section (gridRules/stack.ts, docs/grid-rules.md "Stacked
 * rules"): rule cards that run after the base (the rule picked under What it is: Life, Brian's
 * Brain, Wireworld…), in order, every step.
 *
 *   Base: Count B3/S23  →  1 Cells meet → explode  →  2 Drift right  →  …
 *
 * Each card reads back as a sentence and has its few settings; pointing at a card lights, on the
 * try board, the cells that card changes in the next step. Ready-made pairs of a base and cards
 * ("Life that explodes") set both as one undo step. Every edit writes the node's `stack` param
 * (it recompiles, as a Stencils edit does). The cards reuse the Stencils section's pieces
 * (StencilForms.tsx: RuleCard, ListActions, Row).
 */
import type { ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { BuilderSlider } from '../builders/BuilderSlider';
import { gridShape, ruleSummary } from '../../gridRules/spec';
import {
  ARROWS, BLOCKED_ACTS, COLLIDE_ACTS, DIRECTIONS, MAX_CLUSTER_RADIUS, MAX_COPIES, MAX_DISTANCE, MAX_STACK, STACK_KINDS, STACK_RECIPES,
  describeStackRule, newStackRule, readStack, soloOff, stacksOn, type StackAct, type StackKind, type StackRule,
} from '../../gridRules/stack';
import { stackRecipePatch } from '../../gridRules/stackRecipes';
import { ListActions, Row, RuleCard, move } from './StencilForms';

export { stackRecipePatch };

type P = Record<string, unknown>;
type Setter = (patch: P, immediate?: boolean) => void;

export function StackForm({ p, set, onHoverCard }: { p: P; set: Setter; onHoverCard?: (j: number | null) => void }) {
  const tk = useTokens();
  const s = gridShape(p);
  const cards = readStack(p.stack);
  const top = s.type === 'count' ? 1 : Math.max(2, Math.round(Number(p.states))) - 1;
  const save = (next: StackRule[], immediate = true) => set({ stack: next }, immediate);
  const edit = (j: number, patch: Partial<StackRule>, immediate = true) => save(cards.map((r, k) => (k === j ? { ...r, ...patch } : r)), immediate);
  const base = ruleSummary({ ...p, stack: [] });
  if (!stacksOn(s.type)) {
    return <span style={{ fontSize: 12.5, color: tk.text.muted }}>Stacked rules run on Count, Stages and Stencils rules.</span>;
  }
  return (
    <>
      {/* The order: the base, then each card. */}
      <div data-stack-chain style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12 }}>
        <Chip strong>{`Base: ${base}`}</Chip>
        {cards.map((r, j) => (
          <span key={j} style={{ display: 'contents' }}>
            <span style={{ color: tk.text.faint }}>→</span>
            <Chip off={r.off}>{`${j + 1} ${r.kind}`}</Chip>
          </span>
        ))}
      </div>
      <span style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.45 }}>
        Every step the base runs first, then each card in order on the board the one before made: a later card has the last word on the cells it touches. Change the base under What it is or with the presets below. Movers: put Collide before Move (it settles who meets whom; Move then moves the rest), and draw headings on the board with the arrows under it.
      </span>

      {cards.map((r, j) => (
        <RuleCard key={j} index={j} title={`${j + 1} · ${STACK_KINDS.find(k => k.kind === r.kind)!.label}`} off={r.off} onHover={on => onHoverCard?.(on ? j : null)}
          actions={<ListActions i={j} n={cards.length} off={!!r.off} onMove={d => save(move(cards, j, d))} onDelete={() => { onHoverCard?.(null); save(cards.filter((_, k) => k !== j)); }} onToggle={on => edit(j, { off: !on })} onSolo={() => save(soloOff(cards, j))} what="this card" />}>
          <span data-stack-sentence style={{ fontSize: 12.5, lineHeight: 1.45 }}>{describeStackRule(r)}</span>
          <CardSettings r={r} top={top} edit={(patch, immediate) => edit(j, patch, immediate)} />
        </RuleCard>
      ))}

      <div data-stack-add style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12, color: tk.text.secondary }}>{cards.length >= MAX_STACK ? `At most ${MAX_STACK} cards.` : cards.length ? 'Add another card:' : 'Add a card on top of the base:'}</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STACK_KINDS.map(k => (
            <Button key={k.kind} size="sm" icon="plus" disabled={cards.length >= MAX_STACK} title={k.hint} data-stack-add-kind={k.kind}
              onClick={() => save([...cards, newStackRule(k.kind)])}>{k.label}</Button>
          ))}
        </div>
      </div>

      <div data-stack-recipes style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12, color: tk.text.secondary }}>Or start from one (sets the base and its cards, one undo step):</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STACK_RECIPES.map(rc => (
            <Button key={rc.key} size="sm" title={rc.hint} data-stack-recipe={rc.key} onClick={() => { const patch = stackRecipePatch(rc.key); if (patch) set(patch, true); }}>{rc.label}</Button>
          ))}
        </div>
      </div>
    </>
  );
}

function Chip({ children, strong = false, off = false }: { children: ReactNode; strong?: boolean; off?: boolean }) {
  const tk = useTokens();
  return (
    <span style={{ padding: '3px 8px', borderRadius: radius.sm, background: strong ? tk.bg.selected : tk.bg.field, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}`, color: tk.text.primary, font: `${strong ? 600 : 500} 11.5px ${fontFamily.ui}`, opacity: off ? 0.5 : 1, textDecoration: off ? 'line-through' : 'none' }}>
      {children}
    </span>
  );
}

function Slider({ label, hint, value, min, max, step = 1, integer = true, def, onChange }: { label: string; hint: string; value: number; min: number; max: number; step?: number; integer?: boolean; def: number; onChange: (v: number) => void }) {
  return (
    <Row label={label} hint={hint}>
      <BuilderSlider ariaLabel={label} value={value} min={min} max={max} step={step} integer={integer} defaultValue={def} onChange={onChange} />
    </Row>
  );
}

/** A card's own settings, by kind. Sliders write as they move (one undo step a drag); choices at once. */
function CardSettings({ r, top, edit }: { r: StackRule; top: number; edit: (patch: Partial<StackRule>, immediate?: boolean) => void }) {
  const d = newStackRule(r.kind as StackKind);
  const chance = (
    <>
      <Slider label="Chance" hint="The share of the cells it could change that it does change, rolled per cell each step (the same dice on the GPU and here)." value={r.chance} min={0} max={1} step={0.01} integer={false} def={d.chance} onChange={v => edit({ chance: v }, false)} />
      <Row label="Only cells heading" hint="Limit the card to cells with one heading (an arrow drawn on the try board, or given by a Move card), or to cells with none.">
        <HeadingPicker value={r.who} onChange={v => edit({ who: v })} withAny label="Only cells heading" />
      </Row>
    </>
  );
  const fly = <Toggle checked={r.fly} onChange={v => edit({ fly: v })} label="Copies fly outward (each heads away from the meeting cell)" />;
  const which = (
    <Row label="Which cells" hint="Live cells only (state 1), or every cell that isn't empty (dying stages too).">
      <Segmented<'live' | 'any'> size="sm" ariaLabel="Which cells" value={r.any ? 'any' : 'live'} onChange={v => edit({ any: v === 'any' })}
        options={[{ value: 'live', label: 'Live' }, { value: 'any', label: 'Any not empty' }]} />
    </Row>
  );
  const state = (key: 'becomes', label: string, hint: string) => top > 1 && (
    <Slider label={label} hint={hint} value={Math.min(r[key], top)} min={0} max={top} def={d[key]} onChange={v => edit({ [key]: v }, false)} />
  );
  switch (r.kind) {
    case 'explode': return (
      <>
        <Slider label="Meets with" hint="How many live neighbours make a meeting: 1 is two cells touching and nothing else round them." value={r.lo} min={0} max={8} def={d.lo} onChange={v => edit({ lo: v, hi: Math.max(v, r.hi) }, false)} />
        <Slider label="…up to" hint="The most live neighbours a meeting cell can have." value={r.hi} min={0} max={8} def={d.hi} onChange={v => edit({ hi: v, lo: Math.min(v, r.lo) }, false)} />
        <Slider label="Copies" hint="How many copies each meeting cell throws: up, down, right, left first, then the corners." value={r.copies} min={1} max={MAX_COPIES} def={d.copies} onChange={v => edit({ copies: v }, false)} />
        <Slider label="Distance" hint="How far from the meeting cell the copies land (they only land on empty cells)." value={r.distance} min={1} max={MAX_DISTANCE} def={d.distance} onChange={v => edit({ distance: v }, false)} />
        {state('becomes', 'Copies are', 'The state of the copies.')}
        <Toggle checked={r.keep} onChange={v => edit({ keep: v })} label="The meeting cells stay (else they vanish)" />
        {fly}
        {chance}
      </>
    );
    case 'crowd': return (
      <>
        <Slider label="Crowded at" hint="A live cell with at least this many live neighbours is crowded." value={r.lo} min={0} max={8} def={d.lo} onChange={v => edit({ lo: v }, false)} />
        <Row label="Then it" hint="Dies, or steps one cell away from its neighbours (where they aren't), into an empty cell.">
          <Segmented<'die' | 'move'> size="sm" ariaLabel="Crowded cells" value={r.move ? 'move' : 'die'} onChange={v => edit({ move: v === 'move' })}
            options={[{ value: 'die', label: 'Dies' }, { value: 'move', label: 'Moves away' }]} />
        </Row>
        {chance}
      </>
    );
    case 'drift': return (
      <>
        <Row label="Direction" hint="Where the cells step, one cell a step, when the cell there is empty.">
          <DirectionPicker dir={r.dir} onChange={v => edit({ dir: v })} />
        </Row>
        {which}
        {chance}
      </>
    );
    case 'move': return (
      <>
        <Row label="No heading" hint="Cells without a heading (newborns, cells you drew without an arrow): stay still, take one at random (once, then keep it), or all take one direction.">
          <Segmented<'still' | 'random' | 'set'> size="sm" ariaLabel="Cells with no heading" value={r.assign < 0 ? 'still' : r.assign === 0 ? 'random' : 'set'}
            onChange={v => edit({ assign: v === 'still' ? -1 : v === 'random' ? 0 : 3 })}
            options={[{ value: 'still', label: 'Stay still' }, { value: 'random', label: 'Random' }, { value: 'set', label: 'This way' }]} />
        </Row>
        {r.assign > 0 && (
          <Row label="They head" hint="The heading cells without one take.">
            <DirectionPicker dir={r.assign - 1} onChange={v => edit({ assign: v + 1 })} />
          </Row>
        )}
        <Row label="When blocked" hint="A mover is blocked by a wall, a cell ahead, or another mover heading for the same cell (a Collide card before this one can settle those first).">
          <Segmented<StackAct> size="sm" ariaLabel="Blocked movers" value={r.act} onChange={v => edit({ act: v })} options={BLOCKED_ACTS.map(a => ({ value: a.value, label: a.label }))} />
        </Row>
        {which}
        {chance}
      </>
    );
    case 'collide': return (
      <>
        <Row label="Then they" hint="What two movers do when they meet head-on (side by side, facing) or head for the same empty cell. The chance is rolled once per meeting, so both do the same.">
          <Segmented<StackAct> size="sm" ariaLabel="Colliding movers" value={r.act} onChange={v => edit({ act: v })} options={COLLIDE_ACTS.map(a => ({ value: a.value, label: a.label }))} />
        </Row>
        <span style={{ fontSize: 12, lineHeight: 1.45, opacity: 0.8 }}>{COLLIDE_ACTS.find(a => a.value === r.act)?.hint}</span>
        {r.act === 'explode' && (
          <>
            <Slider label="Copies" hint="How many copies land round the meeting cell: up, down, right, left first, then the corners." value={r.copies} min={1} max={MAX_COPIES} def={d.copies} onChange={v => edit({ copies: v }, false)} />
            <Slider label="Distance" hint="How far from the meeting cell the copies land (only on empty cells)." value={r.distance} min={1} max={MAX_DISTANCE} def={d.distance} onChange={v => edit({ distance: v }, false)} />
            {state('becomes', 'Copies are', 'The state of the copies.')}
            {fly}
          </>
        )}
        {which}
        {chance}
      </>
    );
    default: {
      const max = (2 * r.radius + 1) ** 2 - 1;
      return (
        <>
          <Slider label="Looks within" hint="How far round a cell its clump is counted: 1 is the 8 round it, 2 a 5×5 square." value={r.radius} min={1} max={MAX_CLUSTER_RADIUS} def={d.radius} onChange={v => edit({ radius: v, lo: Math.min(r.lo, (2 * v + 1) ** 2 - 1) }, false)} />
          <Slider label="Big at" hint={`A live cell with at least this many live cells in that square (of ${max}) is in a big cluster.`} value={Math.min(r.lo, max)} min={0} max={max} def={Math.min(d.lo, max)} onChange={v => edit({ lo: v }, false)} />
          {top > 1 ? state('becomes', 'Becomes', 'The state a clumped cell becomes: 0 dies; a Stages rule\'s 2 starts it fading.')
            : <Toggle checked={r.becomes === 0} onChange={v => edit({ becomes: v ? 0 : 1 })} label="It dies" />}
          {chance}
        </>
      );
    }
  }
}

/** A heading for a card's "Only cells heading": any, none, or one of the eight (−1, 0, 1…8). */
function HeadingPicker({ value, onChange, withAny = false, label }: { value: number; onChange: (v: number) => void; withAny?: boolean; label: string }) {
  const tk = useTokens();
  const opts = [...(withAny ? [-1] : []), 0, 1, 2, 3, 4, 5, 6, 7, 8];
  return (
    <span role="radiogroup" aria-label={label} style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
      {opts.map(h => (
        <button key={h} type="button" role="radio" aria-checked={value === h} data-stack-who={h} onClick={() => onChange(h)}
          title={h < 0 ? 'Any cell' : h === 0 ? 'Only cells with no heading' : `Only cells heading ${DIRECTIONS[h - 1].label.toLowerCase()}`}
          style={{
            minWidth: 24, height: 24, padding: '0 5px', border: 0, borderRadius: 6, cursor: 'pointer',
            background: value === h ? tk.accent.base : tk.bg.field, color: value === h ? '#fff' : tk.text.secondary,
            boxShadow: `inset 0 0 0 1px ${tk.border.default}`, font: `600 ${h < 0 ? 11 : 12.5}px ${fontFamily.ui}`,
          }}>{h < 0 ? 'Any' : h === 0 ? '·' : ARROWS[h - 1]}</button>
      ))}
    </span>
  );
}

/** Eight arrows round a dot: the drift direction. */
function DirectionPicker({ dir, onChange }: { dir: number; onChange: (d: number) => void }) {
  const tk = useTokens();
  // Grid positions (row, col) of each direction.
  const at = (i: number): [number, number] => { const [dx, dy] = DIRECTIONS[i].d; return [1 - dy, 1 + dx]; };
  const arrows = ARROWS;
  return (
    <div role="radiogroup" aria-label="Drift direction" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 26px)', gridTemplateRows: 'repeat(3, 26px)', gap: 3 }}>
      {DIRECTIONS.map((x, i) => {
        const [row, col] = at(i);
        return (
          <button key={x.key} type="button" role="radio" aria-checked={dir === i} aria-label={x.label} title={x.label} data-drift-dir={x.key} onClick={() => onChange(i)}
            style={{
              gridRow: row + 1, gridColumn: col + 1, padding: 0, border: 0, borderRadius: 6, cursor: 'pointer',
              background: dir === i ? tk.accent.base : tk.bg.field, color: dir === i ? '#fff' : tk.text.secondary,
              boxShadow: `inset 0 0 0 1px ${tk.border.default}`, font: `600 13px ${fontFamily.ui}`,
            }}>{arrows[i]}</button>
        );
      })}
      <span style={{ gridRow: 2, gridColumn: 2, alignSelf: 'center', justifySelf: 'center', width: 8, height: 8, borderRadius: 4, background: tk.text.faint }} />
    </div>
  );
}
