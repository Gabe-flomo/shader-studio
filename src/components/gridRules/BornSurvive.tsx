/**
 * The Grid Rules editor's pictures for a Count / Stages rule (words in gridRules/explain.ts):
 *
 *  - PictureSwitches: the Born and Survive switches, each number with a tiny 3×3 picture of a cell
 *    with that many live neighbours (Born: the centre empty; Survive: the centre live), and a line
 *    that says what the hovered switch does ("live + 4 → dies (too crowded)").
 *  - RuleSentence: the whole rule in one sentence, updated as the switches change.
 *  - NeighbourhoodPictures: Moore, von Neumann and a radius as highlighted cells, to pick from.
 *  - DyingStages: a Stages rule's cells fading from on through the dying stages to empty.
 */
import { useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { countLabel, countedCells, neighbourPicture, ruleSentence, surviveFate, type PictureCell } from '../../gridRules/explain';
import type { Neighbourhood, RadiusShape } from '../../gridRules/spec';

/** A small square of cells (a 3×3 picture, or a neighbourhood). */
export function CellPicture({ cells, size, cell = 8, gap = 1.5, colour, centre, label }: {
  cells: PictureCell[]; size: number; cell?: number; gap?: number; colour: string;
  /** Ring the middle cell (this cell). */
  centre?: boolean; label?: string;
}) {
  const tk = useTokens();
  const w = size * cell + (size - 1) * gap;
  const mid = Math.floor((size * size) / 2);
  return (
    <svg width={w} height={w} viewBox={`0 0 ${w} ${w}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} style={{ display: 'block', flexShrink: 0 }}>
      {cells.map((c, i) => {
        const x = (i % size) * (cell + gap), y = Math.floor(i / size) * (cell + gap);
        const ring = centre && i === mid;
        return (
          <rect key={i} x={x + (ring ? 0.75 : 0)} y={y + (ring ? 0.75 : 0)} width={cell - (ring ? 1.5 : 0)} height={cell - (ring ? 1.5 : 0)} rx={1.5}
            fill={c === 'live' ? colour : c === 'empty' ? tk.bg.panel : 'transparent'}
            stroke={ring ? tk.text.primary : c === 'unused' ? tk.border.subtle : c === 'empty' ? tk.border.strong : 'none'}
            strokeWidth={ring ? 1.5 : 0.75} strokeDasharray={c === 'unused' ? '1.5 1.5' : undefined} />
        );
      })}
    </svg>
  );
}

/** One row of switches 0…max, each with its picture; a line under it says what the hovered one does. */
export function PictureSwitches({ row, mask, max, nb, colour, born, survive, stages, onChange }: {
  row: 'born' | 'survive'; mask: number; max: number; nb: 'moore' | 'vonNeumann'; colour: string;
  born: number[]; survive: number[]; stages: boolean; onChange: (mask: number) => void;
}) {
  const tk = useTokens();
  const [hover, setHover] = useState<number | null>(null);
  const counts = row === 'born' ? born : survive;
  const shown = hover ?? (counts[0] ?? null);
  const title = row === 'born' ? 'Born' : 'Survive';
  const sub = row === 'born' ? 'an empty cell comes alive with' : 'a live cell stays alive with';
  const caption = shown === null
    ? (row === 'born' ? 'Nothing is born: switch a count on.' : `No live cell survives: every one ${stages ? 'starts dying' : 'dies'} after a step.`)
    : countLabel(row, shown, born, survive, stages);
  return (
    <div data-count-row={row} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <b style={{ font: `650 13px ${fontFamily.ui}`, color: colour }}>{title}</b>
        <span style={{ color: tk.text.muted, fontSize: 12 }}>{sub} …</span>
      </div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }} role="group" aria-label={`${title} on`} onMouseLeave={() => setHover(null)}>
        {Array.from({ length: max + 1 }, (_, k) => {
          const on = ((Math.round(mask) >> k) & 1) === 1;
          const label = countLabel(row, k, born, survive, stages);
          const fate = row === 'survive' && !on ? surviveFate(k, survive) : null;
          return (
            <button key={k} type="button" role="checkbox" aria-checked={on} aria-label={`${title} with ${k}: ${label}`} title={label} data-count={k}
              onClick={() => onChange(Math.round(mask) ^ (1 << k))} onMouseEnter={() => setHover(k)} onFocus={() => setHover(k)} onBlur={() => setHover(null)}
              style={{
                width: 46, padding: '6px 0 4px', border: 0, borderRadius: radius.md, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                background: on ? alpha(colour, 0.16) : tk.bg.field,
                boxShadow: on ? `inset 0 0 0 1.5px ${colour}` : hover === k ? `inset 0 0 0 1px ${tk.border.strong}` : `inset 0 0 0 1px ${tk.border.subtle}`,
              }}>
              <CellPicture cells={neighbourPicture(k, nb, row === 'survive')} size={3} colour={on ? colour : tk.text.faint} centre />
              <span style={{ font: `650 12.5px ${fontFamily.mono}`, color: on ? tk.text.primary : tk.text.muted, lineHeight: 1 }}>{k}</span>
              <span aria-hidden style={{ font: `600 9px ${fontFamily.ui}`, color: on ? colour : tk.text.faint, lineHeight: 1, height: 9, whiteSpace: 'nowrap' }}>
                {row === 'born' ? (on ? 'born' : '') : on ? 'stays' : fate === 'lonely' ? 'lonely' : fate === 'crowded' ? 'crowded' : stages ? 'fades' : 'dies'}
              </span>
            </button>
          );
        })}
      </div>
      <span data-count-label style={{ fontSize: 12, color: tk.text.secondary, minHeight: 17 }}>{caption}</span>
    </div>
  );
}

/** The rule in one sentence, live. */
export function RuleSentence({ born, survive, max, stages, states }: { born: number[]; survive: number[]; max: number; stages: boolean; states: number }) {
  const tk = useTokens();
  return (
    <div data-rule-sentence style={{ padding: '10px 12px', borderRadius: radius.md, background: tk.bg.subtle, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}`, color: tk.text.primary, lineHeight: 1.5, fontSize: 13 }}>
      <Icon name="text" size={13} style={{ verticalAlign: '-2px', marginRight: 6, color: tk.text.faint }} />
      {ruleSentence({ born, survive, max, stages, states })}
    </div>
  );
}

const NB_OPTIONS: Array<{ value: Neighbourhood; label: string; hint: string }> = [
  { value: 'moore', label: 'Moore · 8', hint: 'The 8 cells round it, corners too (Life).' },
  { value: 'vonNeumann', label: 'von Neumann · 4', hint: 'Only the 4 beside it: up, down, left, right.' },
  { value: 'radius', label: 'Radius N', hint: 'Every cell within N steps: big, smooth-looking rules (Larger than Life).' },
];

/** The three neighbourhoods as pictures, the chosen one ringed. */
export function NeighbourhoodPictures({ value, radius: r, shape, onChange }: { value: Neighbourhood; radius: number; shape: RadiusShape; onChange: (v: Neighbourhood) => void }) {
  const tk = useTokens();
  return (
    <div role="radiogroup" aria-label="Neighbourhood" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {NB_OPTIONS.map(o => {
        const on = o.value === value;
        // Radius: the chosen radius when it is picked, otherwise 2 (enough to show the idea).
        const pic = countedCells(o.value, o.value === 'radius' ? (on ? r : 2) : 1, shape);
        const gap = pic.size > 7 ? 0.75 : 1.5;
        const cell = pic.size <= 3 ? 14 : pic.size <= 5 ? 9 : Math.max(2, Math.floor((72 - (pic.size - 1) * gap) / pic.size));
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} data-nb={o.value} onClick={() => !on && onChange(o.value)}
            style={{
              width: 168, padding: '10px 10px 8px', border: 0, borderRadius: radius.md, cursor: 'pointer', textAlign: 'left',
              display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start',
              background: on ? tk.bg.selected : tk.bg.field, boxShadow: on ? `inset 0 0 0 1.5px ${tk.accent.base}` : `inset 0 0 0 1px ${tk.border.subtle}`,
            }}>
            <div style={{ height: 76, display: 'flex', alignItems: 'center' }}>
              <CellPicture cells={pic.cells.map((c, i) => (i === Math.floor(pic.cells.length / 2) ? 'empty' : c ? 'live' : 'unused'))} size={pic.size} cell={cell} gap={gap} colour={on ? tk.accent.base : tk.text.faint} centre />
            </div>
            <b style={{ font: `600 12.5px ${fontFamily.ui}`, color: on ? tk.accent.text : tk.text.primary }}>{o.label}</b>
            <span style={{ font: `11.5px/1.35 ${fontFamily.ui}`, color: tk.text.muted }}>{o.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

const css = (c: number[]) => `rgb(${c.slice(0, 3).map(x => Math.round(Math.max(0, Math.min(1, x)) * 255)).join(',')})`;
const mix = (a: number[], b: number[], t: number) => a.map((x, i) => x + (b[i] - x) * t);

/** On → dying 1 → … → empty, in the rule's colours: what a cell that stops surviving goes through. */
export function DyingStages({ states, on, first, last, empty }: { states: number; on: number[]; first: number[]; last: number[]; empty: number[] }) {
  const tk = useTokens();
  const n = Math.max(2, Math.round(states));
  const dying = n - 2;
  const steps = [
    { label: 'on', colour: on },
    ...Array.from({ length: dying }, (_, k) => ({ label: `dying ${k + 1}`, colour: mix(first, last, dying > 1 ? k / (dying - 1) : 0) })),
    { label: 'empty', colour: empty },
  ];
  return (
    <div data-dying-stages style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      {steps.map((s, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {i > 0 && <span style={{ color: tk.text.faint, fontSize: 12 }}>→</span>}
          <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 26, height: 26, borderRadius: 5, background: css(s.colour), boxShadow: `inset 0 0 0 1px ${tk.border.default}`, opacity: s.label.startsWith('dying') ? 1 - (0.5 * (i - 1)) / Math.max(1, dying) : 1 }} />
            <span style={{ font: `10.5px ${fontFamily.ui}`, color: tk.text.muted, whiteSpace: 'nowrap' }}>{s.label}</span>
          </span>
        </span>
      ))}
    </div>
  );
}
