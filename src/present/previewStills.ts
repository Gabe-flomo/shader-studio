/**
 * previewStills.ts — code-block previews as still pictures, for the exported
 * web page. The page doesn't compile GLSL of its own (its canvases run whole
 * Plays), so a live preview goes out as a PNG of the moment it shows at 1.5 s,
 * with the author's slider values, in the page's light or dark. Browser only
 * (it draws with WebGL).
 */
import type { Presentation } from '../types/presentation';
import { resolveCode } from './code';
import { buildHarness, contextFromShader } from './snippetHarness';
import { renderStill } from './snippetRenderer';
import { PLOT_THEMES } from '../components/FunctionBuilder/glslCompiler';

const W = 720, H = 450;

/** blockId → PNG data URL, for every GLSL block with a preview that draws. */
export function codePreviewStills(p: Presentation, dark: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  const sources = new Map(p.sources.map(s => [s.id, s]));
  const theme = PLOT_THEMES[dark ? 'dark' : 'light'];
  for (const step of p.steps) for (const b of step.blocks) {
    if (b.type !== 'code' || b.language !== 'glsl' || !b.preview) continue;
    try {
      const r = resolveCode(b, sources);
      if (r.problem || !r.text.trim()) continue;
      const src = sources.get(b.from?.source ?? b.origin?.source ?? '');
      const ctx = src ? contextFromShader(src.bundle.fragmentShader, src.bundle.uniforms) : {};
      const h = buildHarness(r.text, b.preview, ctx, { colours: { bg: theme.bg, grid: theme.grid, axis: theme.axis, curve: theme.curves[0] }, dpr: 1.5 });
      const uniforms = { ...h.uniforms };
      for (const s of h.sliders) if (b.preview.values?.[s.uniform] !== undefined) uniforms[s.uniform] = b.preview.values[s.uniform];
      const url = renderStill({ source: h.source, width: W, height: H, uniforms, time: 1.5, dpr: 1.5 });
      if (url) out[b.id] = url;
    } catch { /* no still: the page shows the code alone */ }
  }
  return out;
}
