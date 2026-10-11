/**
 * glyphs.ts — the Grid builder's pictures: the glyph every shape is drawn with on the mini grid, the
 * whole grid painted (the mini grid and the presets strip), and the preview's compile.
 */
import { compileGraph } from '../../compiler/graphCompiler';
import type { Compiled } from '../sceneBuilder/previewGl';
import { buildStandaloneGrid } from '../../gridScene/build';
import { drawOf, isSourceCell, shapeOf, shownCells, type GridSceneSpec, type ShapeKind, type Vec3 } from '../../gridScene/spec';
import { activeMask } from '../../gridScene/glsl';
import { textMaskAt } from '../../gridScene/textMask';

/** Build and compile a spec the way Build would: the preview. */
export function compileGridScene(spec: GridSceneSpec): Compiled {
  const t0 = performance.now();
  try {
    const g = buildStandaloneGrid(spec, { idFor: role => `pg_${role.replace(/[^A-Za-z0-9]/g, '_')}` });
    const r = compileGraph({ nodes: g.nodes });
    if (!r.success) return { vs: '', fs: '', uniforms: {}, nodes: g.nodes.length, error: (r.errors ?? []).join('; ') || 'The graph did not compile.', ms: performance.now() - t0 };
    return { vs: r.vertexShader, fs: r.fragmentShader, uniforms: r.paramUniforms as Record<string, number | number[]>, nodes: g.nodes.length, error: null, ms: performance.now() - t0, textures: r.textureUniforms };
  } catch (e) {
    return { vs: '', fs: '', uniforms: {}, nodes: 0, error: e instanceof Error ? e.message : String(e), ms: 0 };
  }
}

export const rgb = (c: Vec3, a = 1) => `rgba(${c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(',')},${a})`;

/** Draw a shape glyph centred at (x, y) with radius r. */
export function drawGlyph(ctx: CanvasRenderingContext2D, kind: ShapeKind, x: number, y: number, r: number, fill: string, outline = 0, turnDeg = 0): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-turnDeg * Math.PI / 180);
  ctx.beginPath();
  const poly = (n: number, rot: number, rr = r) => { for (let i = 0; i < n; i++) { const a = rot + (i / n) * Math.PI * 2; if (i) ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); };
  switch (kind) {
    case 'circle': ctx.arc(0, 0, r, 0, Math.PI * 2); break;
    case 'square': ctx.rect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7); break;
    case 'ring': ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.moveTo(r * 0.5, 0); ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2, true); break;
    case 'diamond': poly(4, -Math.PI / 2); break;
    case 'triangle': poly(3, -Math.PI / 2, r * 1.05); break;
    case 'hexagon': poly(6, 0, r * 1.02); break;
    case 'star': for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i / 10) * Math.PI * 2; const rr = i % 2 ? r * 0.45 : r * 1.1; if (i) ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); break;
    case 'plus': ctx.rect(-r, -r * 0.3, r * 2, r * 0.6); ctx.rect(-r * 0.3, -r, r * 0.6, r * 2); break;
    case 'cross': ctx.rotate(Math.PI / 4); ctx.rect(-r, -r * 0.25, r * 2, r * 0.5); ctx.rect(-r * 0.25, -r, r * 0.5, r * 2); break;
    case 'heart': {
      const s = r * 1.05;
      ctx.moveTo(0, s * 0.95);
      ctx.bezierCurveTo(-s * 1.4, -s * 0.05, -s * 0.6, -s * 1.05, 0, -s * 0.4);
      ctx.bezierCurveTo(s * 0.6, -s * 1.05, s * 1.4, -s * 0.05, 0, s * 0.95);
      ctx.closePath();
      break;
    }
    case 'picture': {
      // A picture: a frame with a hill and a sun in it.
      ctx.rect(-r, -r, r * 2, r * 2);
      ctx.fillStyle = fill; ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(-r, r); ctx.lineTo(-r * 0.3, -r * 0.1); ctx.lineTo(r * 0.2, r * 0.45); ctx.lineTo(r * 0.55, r * 0.1); ctx.lineTo(r, r); ctx.closePath();
      ctx.moveTo(r * 0.6, -r * 0.45); ctx.arc(r * 0.45, -r * 0.45, r * 0.18, 0, Math.PI * 2);
      break;
    }
  }
  if (outline > 0) { ctx.strokeStyle = fill; ctx.lineWidth = Math.max(1, outline * r * 2); ctx.stroke(); } else { ctx.fillStyle = fill; ctx.fill('nonzero'); }
  ctx.restore();
}

/** Paint a whole spec as the mini grid shows it (cells, glyphs) into `ctx` at `size` px: also the presets' pictures. */
export function paintGrid(ctx: CanvasRenderingContext2D, spec: GridSceneSpec, w: number, h: number, o: { lines?: string; bg?: string } = {}): { cell: number; x0: number; y0: number } {
  const cell = Math.floor(Math.min(w / spec.cols, h / spec.rows));
  const x0 = Math.floor((w - cell * spec.cols) / 2), y0 = Math.floor((h - cell * spec.rows) / 2);
  ctx.fillStyle = o.bg ?? rgb(spec.look.bg);
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = o.lines ?? rgb(spec.look.lineColor, 0.9);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= spec.cols; i++) { ctx.moveTo(x0 + i * cell + 0.5, y0); ctx.lineTo(x0 + i * cell + 0.5, y0 + spec.rows * cell); }
  for (let j = 0; j <= spec.rows; j++) { ctx.moveTo(x0, y0 + j * cell + 0.5); ctx.lineTo(x0 + spec.cols * cell, y0 + j * cell + 0.5); }
  ctx.stroke();
  // The pattern's text mask: its cells tinted (the wave and the fill live only there).
  const mask = activeMask(spec);
  if (mask) {
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    for (let y = 0; y < spec.rows; y++) for (let x = 0; x < spec.cols; x++) if (textMaskAt(mask, spec.cols, spec.rows, x, y)) ctx.fillRect(x0 + x * cell + 1, y0 + y * cell + 1, cell - 1, cell - 1);
  }
  // What each cell shows after the draw mode (docs/grid-builder.md "Draw modes"): the drawing, and its copies faintly.
  const shown = shownCells(spec);
  const copying = drawOf(spec).mode !== 'here';
  // The pattern's fill: a faint glyph in every empty cell (inside the mask, when there is one).
  const fill = spec.pattern.kind !== 'none' ? shapeOf(spec, spec.pattern.fill) : undefined;
  if (fill) {
    for (let y = 0; y < spec.rows; y++) for (let x = 0; x < spec.cols; x++) {
      if (shown[y * spec.cols + x]) continue;
      if (mask && !textMaskAt(mask, spec.cols, spec.rows, x, y)) continue;
      drawGlyph(ctx, fill.kind, x0 + (x + 0.5) * cell, y0 + (y + 0.5) * cell, cell * 0.5 * Math.min(1, fill.size) * 0.8, rgb(fill.color, 0.28));
    }
  }
  for (let y = 0; y < spec.rows; y++) {
    for (let x = 0; x < spec.cols; x++) {
      const s = shapeOf(spec, shown[y * spec.cols + x]);
      if (!s) continue;
      const copy = copying && !isSourceCell(spec, x, y);
      drawGlyph(ctx, s.kind, x0 + (x + 0.5) * cell, y0 + (y + 0.5) * cell, cell * 0.5 * Math.min(1.1, s.size) * 0.9, rgb(s.color, copy ? 0.32 : 1), s.outline, s.turn);
    }
  }
  if (copying && o.lines === undefined) {
    // The cells you draw in: outlined.
    let ax = Infinity, ay = Infinity, bx = -1, by = -1;
    for (let y = 0; y < spec.rows; y++) for (let x = 0; x < spec.cols; x++) if (isSourceCell(spec, x, y)) { ax = Math.min(ax, x); ay = Math.min(ay, y); bx = Math.max(bx, x); by = Math.max(by, y); }
    if (bx >= 0) {
      ctx.strokeStyle = 'rgba(255, 210, 90, 0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x0 + ax * cell + 1, y0 + ay * cell + 1, (bx - ax + 1) * cell - 2, (by - ay + 1) * cell - 2);
      ctx.setLineDash([]);
    }
  }
  return { cell, x0, y0 };
}

/** A data URL picture of a spec (the presets strip). */
export function gridPicture(spec: GridSceneSpec, w = 132, h = 76): string | null {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = w * 2; cv.height = h * 2;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  paintGrid(ctx, spec, w * 2, h * 2);
  try { return cv.toDataURL('image/png'); } catch { return null; }
}

