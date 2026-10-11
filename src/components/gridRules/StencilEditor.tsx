/**
 * StencilEditor — the Grid Rules builder's own-neighbourhood editor (docs/grid-rules.md "Your own
 * neighbourhood"): a 3×3, 5×5 or 7×7 stencil round this cell (ringed in the middle). Click a cell
 * to count it; with Weights on, clicking again counts it twice, then three times, then not at all.
 * Shift-click (or right-click) takes a cell out. Presets: Moore, von Neumann, hex-ish, a ring, a
 * cross. Every edit is one undoable change of the node's `stencil` param (it recompiles: the reads
 * are baked into the GLSL).
 */
import { useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Segmented, Toggle } from '../ui/Choice';
import { CellPicture } from './BornSurvive';
import {
  MAX_WEIGHT, STENCIL_PRESETS, STENCIL_SIZES, matchingStencil, resizeStencil, stencilMax, stencilSummary, stencilUsesRanges, stencilWeights,
  type NeighbourStencil,
} from '../../gridRules/neighbourhoods';

export function StencilEditor({ stencil, onChange }: { stencil: NeighbourStencil; onChange: (st: NeighbourStencil) => void }) {
  const tk = useTokens();
  const heavy = stencil.cells.some(w => w > 1);
  const [weights, setWeights] = useState(heavy);
  const n = stencil.size;
  const mid = (n * n - 1) / 2;
  const cellPx = n === 3 ? 44 : n === 5 ? 34 : 27;
  const preset = matchingStencil(stencil);
  const set = (i: number, w: number) => {
    if (i === mid) return;
    const cells = [...stencil.cells];
    cells[i] = w;
    onChange({ size: n, cells });
  };
  const click = (i: number, out: boolean) => {
    const w = stencil.cells[i] ?? 0;
    if (out) return set(i, 0);
    set(i, weights ? (w + 1) % (MAX_WEIGHT + 1) : w ? 0 : 1);
  };
  const shade = (w: number) => alpha(tk.accent.base, w === 0 ? 0 : 0.35 + 0.65 * (w / MAX_WEIGHT));
  return (
    <div data-stencil-editor style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Segmented<string> ariaLabel="Stencil size" size="sm" value={String(n)} onChange={v => onChange(resizeStencil(stencil, Number(v)))}
          options={STENCIL_SIZES.map(s => ({ value: String(s), label: `${s}×${s}` }))} />
        <Toggle checked={weights} onChange={v => { setWeights(v); if (!v && heavy) onChange({ size: n, cells: stencil.cells.map(w => (w ? 1 : 0)) }); }} label="Weights" />
      </div>
      <div role="grid" aria-label={`Your neighbourhood, ${n} by ${n}: click a cell to count it`} onContextMenu={e => e.preventDefault()}
        style={{ display: 'grid', gridTemplateColumns: `repeat(${n}, ${cellPx}px)`, gap: 3, alignSelf: 'flex-start', padding: 6, borderRadius: radius.md, background: tk.bg.subtle, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }}>
        {stencil.cells.map((w, i) => {
          const me = i === mid;
          const dx = (i % n) - (n - 1) / 2, dy = (n - 1) / 2 - Math.floor(i / n);
          return (
            <button key={i} type="button" role="gridcell" data-stencil-cell={i} data-weight={w} disabled={me}
              aria-label={me ? 'This cell (never counted)' : `${dx} across, ${dy} up: ${w ? `counted${w > 1 ? ` ×${w}` : ''}` : 'not counted'}`}
              title={me ? 'This cell: the one whose neighbours are counted (never counted itself)' : w ? `Counted${w > 1 ? ` ${w} times` : ''}: click ${weights ? 'for more weight' : 'to take it out'}, Shift-click to take it out` : 'Not counted: click to count it'}
              onClick={e => click(i, e.shiftKey)} onContextMenu={e => { e.preventDefault(); click(i, true); }}
              style={{
                width: cellPx, height: cellPx, padding: 0, border: 0, borderRadius: 5, cursor: me ? 'default' : 'pointer',
                background: me ? tk.bg.panel : w ? shade(w) : tk.bg.field,
                boxShadow: me ? `inset 0 0 0 2px ${tk.text.primary}` : w ? `inset 0 0 0 1.5px ${tk.accent.base}` : `inset 0 0 0 1px ${tk.border.subtle}`,
                color: tk.text.primary, font: `650 ${cellPx > 30 ? 13 : 11}px ${fontFamily.mono}`,
              }}>
              {me ? '●' : w > 1 ? `×${w}` : ''}
            </button>
          );
        })}
      </div>
      <span data-stencil-summary style={{ fontSize: 12, color: tk.text.secondary, lineHeight: 1.45 }}>
        {stencilSummary(stencil)}. {stencilWeights(stencil).length === 0 ? 'Nothing is counted yet: click cells round the middle.' : stencilUsesRanges(stencil)
          ? `It counts up to ${stencilMax(stencil)}: Born and Survive are ranges (from … to).`
          : `Born and Survive have a switch for each count, 0 to ${stencilMax(stencil)}.`}
      </span>
      <div role="radiogroup" aria-label="Stencil presets" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {Object.entries(STENCIL_PRESETS).map(([key, p]) => {
          const on = preset === key;
          const r = (p.stencil.size - 1) / 2;
          return (
            <button key={key} type="button" role="radio" aria-checked={on} data-stencil-preset={key} title={p.hint} onClick={() => onChange({ size: p.stencil.size, cells: [...p.stencil.cells] })}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, width: 74, padding: '7px 4px 6px', border: 0, borderRadius: radius.md, cursor: 'pointer',
                background: on ? tk.bg.selected : tk.bg.field, boxShadow: on ? `inset 0 0 0 1.5px ${tk.accent.base}` : `inset 0 0 0 1px ${tk.border.subtle}`,
              }}>
              <CellPicture size={p.stencil.size} cell={r > 1 ? 6 : r > 0.5 ? 6 : 9} gap={1} colour={on ? tk.accent.base : tk.text.faint} centre
                cells={p.stencil.cells.map((w, i) => (i === (p.stencil.cells.length - 1) / 2 ? 'empty' : w ? 'live' : 'unused'))} />
              <span style={{ font: `600 11px ${fontFamily.ui}`, color: on ? tk.accent.text : tk.text.secondary, whiteSpace: 'nowrap' }}>{p.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
