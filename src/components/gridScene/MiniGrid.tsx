/**
 * MiniGrid — the Grid builder's drawing surface (docs/grid-builder.md, "Drawing"): the grid at a
 * small size, each drawn cell showing its shape in its colour.
 *
 *  - click or drag paints the brush's shape (one undo step a stroke); right-click, or the eraser
 *    brush, clears; Alt-drag clears too;
 *  - the brush shape's motion paths are drawn faintly through its cells (motionAt, the shader's
 *    sums on the CPU), so a path can be set up before looking at the preview;
 *  - cells a rule points at are ringed; while a rule waits for a cell ("Pick on the grid"), a click
 *    sets it instead of painting;
 *  - with the text stamp on, the words' cells are outlined under the pointer and a click places the
 *    brush's shape in every one of them (one undo step).
 */
import { useEffect, useRef, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { radius } from '../../theme/tokens';
import { useGridBuilder } from '../../gridScene/store';
import { eraseCell, motionAt, placeCell, shapeOf } from '../../gridScene/spec';
import { textStampGridCells } from '../../gridScene/textMask';
import { paintGrid, rgb } from './glyphs';

export function MiniGrid({ size = 288 }: { size?: number }) {
  const tk = useTokens();
  const spec = useGridBuilder(s => s.spec);
  const brush = useGridBuilder(s => s.brush);
  const picking = useGridBuilder(s => s.picking);
  const stamp = useGridBuilder(s => s.textStamp);
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const stroke = useRef<{ key: string; erase: boolean; last: [number, number] } | null>(null);
  const geom = useRef({ cell: 1, x0: 0, y0: 0 });

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = size * dpr; cv.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = paintGrid(ctx, spec, size, size);
    geom.current = g;
    const { cell, x0, y0 } = g;
    // The brush shape's paths, over one cycle.
    const sh = shapeOf(spec, brush);
    if (sh && sh.motion.path !== 'still') {
      ctx.strokeStyle = rgb(sh.color, 0.55);
      ctx.lineWidth = 1.25;
      const period = 1 / Math.max(0.05, Math.abs(sh.motion.speed));
      for (const c of spec.cells.filter(x => x.s === sh.id)) {
        ctx.beginPath();
        let last: [number, number] | null = null;
        for (let i = 0; i <= 48; i++) {
          const [px, py] = motionAt(spec, sh.motion, c.x, c.y, (i / 48) * period);
          const X = x0 + px * cell, Y = y0 + py * cell;
          if (last && Math.hypot(X - last[0], Y - last[1]) > cell * 1.5) ctx.moveTo(X, Y); else if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
          last = [X, Y];
        }
        ctx.stroke();
      }
    }
    // What the rules point at.
    ctx.strokeStyle = tk.accent.base;
    ctx.lineWidth = 2;
    for (const r of spec.rules) {
      if (!r.on) continue;
      const w = r.when;
      if (w.kind === 'cell') ctx.strokeRect(x0 + (w.x ?? 0) * cell + 1.5, y0 + (w.y ?? 0) * cell + 1.5, cell - 3, cell - 3);
      else if (w.kind === 'column') ctx.strokeRect(x0 + (w.x ?? 0) * cell + 1.5, y0 + 1.5, cell - 3, spec.rows * cell - 3);
      else if (w.kind === 'row') ctx.strokeRect(x0 + 1.5, y0 + (w.y ?? 0) * cell + 1.5, spec.cols * cell - 3, cell - 3);
    }
    if (hover && stamp.on && !picking) {
      // The text stamp: the cells it will fill.
      ctx.fillStyle = tk.accent.base;
      ctx.globalAlpha = 0.45;
      for (const [x, y] of textStampGridCells(stamp.text, stamp.size, hover[0], hover[1])) {
        if (x >= 0 && y >= 0 && x < spec.cols && y < spec.rows) ctx.fillRect(x0 + x * cell + 2, y0 + y * cell + 2, cell - 4, cell - 4);
      }
      ctx.globalAlpha = 1;
    } else if (hover) {
      ctx.strokeStyle = picking ? tk.status.warningText : tk.text.primary;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x0 + hover[0] * cell + 1, y0 + hover[1] * cell + 1, cell - 2, cell - 2);
    }
  }, [spec, brush, hover, picking, size, tk, stamp]);

  const cellOf = (e: React.PointerEvent | React.MouseEvent): [number, number] | null => {
    const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const { cell, x0, y0 } = geom.current;
    const x = Math.floor((e.clientX - r.left - x0) / cell), y = Math.floor((e.clientY - r.top - y0) / cell);
    const s = useGridBuilder.getState().spec;
    return x >= 0 && y >= 0 && x < s.cols && y < s.rows ? [x, y] : null;
  };
  const apply = (at: [number, number], erase: boolean, key: string) => {
    const gb = useGridBuilder.getState();
    const cur = gb.spec.cells.find(c => c.x === at[0] && c.y === at[1]);
    if (erase ? !cur : cur?.s === gb.brush) return;
    gb.edit(d => { if (erase) eraseCell(d, at[0], at[1]); else placeCell(d, at[0], at[1], gb.brush); }, key);
  };
  const pick = (at: [number, number]) => {
    const gb = useGridBuilder.getState();
    const id = gb.picking;
    gb.edit(d => { const r = d.rules.find(x => x.id === id); if (r) { r.when.x = at[0]; r.when.y = at[1]; } });
    gb.setPicking(null);
  };

  return (
    <canvas ref={ref} data-mini-grid aria-label={`The grid, ${spec.cols} by ${spec.rows}: click or drag to place the brush's shape, right-click to clear`}
      style={{ width: size, height: size, display: 'block', borderRadius: radius.md, cursor: picking ? 'crosshair' : stamp.on ? 'copy' : brush === 'erase' ? 'cell' : 'pointer', touchAction: 'none', boxShadow: `0 0 0 1px ${tk.border.default}` }}
      onContextMenu={e => e.preventDefault()}
      onPointerDown={e => {
        const at = cellOf(e);
        if (!at) return;
        if (useGridBuilder.getState().picking) { pick(at); return; }
        const gs = useGridBuilder.getState();
        if (gs.textStamp.on) {
          // Stamp the words: the brush's shape (or the first shape, while erasing) in every cell they cover; Alt or right-click clears them.
          const erase = e.button === 2 || e.altKey || gs.brush === 'erase';
          const shape = shapeOf(gs.spec, gs.brush)?.id ?? gs.spec.shapes[0]?.id;
          const cells = textStampGridCells(gs.textStamp.text, gs.textStamp.size, at[0], at[1]);
          if (shape || erase) gs.edit(d => { for (const [x, y] of cells) { if (erase) eraseCell(d, x, y); else placeCell(d, x, y, shape!); } });
          return;
        }
        (e.currentTarget as HTMLCanvasElement).setPointerCapture?.(e.pointerId);
        const erase = e.button === 2 || e.altKey || useGridBuilder.getState().brush === 'erase';
        stroke.current = { key: `stroke:${Date.now()}`, erase, last: at };
        apply(at, erase, stroke.current.key);
      }}
      onPointerMove={e => {
        const at = cellOf(e);
        setHover(h => (at && h && h[0] === at[0] && h[1] === at[1] ? h : at));
        const st = stroke.current;
        if (at && st) {
          // Every cell between the last one and this (a quick drag skips cells otherwise).
          const [x0, y0] = st.last;
          const n = Math.max(Math.abs(at[0] - x0), Math.abs(at[1] - y0));
          for (let i = 1; i <= n; i++) apply([Math.round(x0 + (at[0] - x0) * i / n), Math.round(y0 + (at[1] - y0) * i / n)], st.erase, st.key);
          st.last = at;
        }
      }}
      onPointerUp={() => { stroke.current = null; }}
      onPointerCancel={() => { stroke.current = null; }}
      onPointerLeave={() => setHover(null)} />
  );
}
