/**
 * convertView.ts — what the Convert page's hosted canvas shows (pageCanvas.ts
 * `view`): the source shader, the converted graph, or both under an A|B wipe.
 *
 * The main canvas renders the store's shader: the converted graph (the
 * scratch graph's compile) unless `rawGlslShader` is set, in which case it
 * renders that. So Source sets the raw shader to the paste, Converted clears
 * it, and Split clears it too and draws the source over the picture's left
 * part in a small canvas of its own (SplitOverlay.tsx). Record and the hover
 * readout always come from the main canvas.
 */
import type { ConvertedUniform } from '../../glslToGraph';
import type { ConvertView } from '../shell/pageCanvasStore';

export const VIEW_OPTIONS: readonly { value: ConvertView; label: string; hint: string }[] = [
  { value: 'source', label: 'Source', hint: 'The pasted shader on the main canvas' },
  { value: 'converted', label: 'Converted', hint: 'The graph the shader became' },
  { value: 'split', label: 'Split', hint: 'Both: the source left of the divider, the graph right of it. Drag the divider.' },
];

/** The view that can be shown: without a converted graph there is only the source. */
export function effectiveView(view: ConvertView, hasGraph: boolean): ConvertView {
  return hasGraph ? view : 'source';
}

/** What `rawGlslShader` should be for a view: the source (or nothing, for the graph). */
export function rawShaderFor(view: ConvertView, source: string, hasGraph: boolean): string | null {
  return effectiveView(view, hasGraph) === 'source' ? source : null;
}

function literal(u: ConvertedUniform): string {
  const f = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));
  const v = u.value;
  if (u.type === 'int') return String(Math.round(typeof v === 'number' ? v : v[0] ?? 0));
  if (u.type === 'float') return f(typeof v === 'number' ? v : v[0] ?? 0);
  const a = typeof v === 'number' ? [v, v, v] : v;
  return u.type === 'vec2' ? `vec2(${f(a[0] ?? 0)}, ${f(a[1] ?? 0)})` : `vec3(${f(a[0] ?? 0)}, ${f(a[1] ?? 0)}, ${f(a[2] ?? 0)})`;
}

/**
 * The source with its own uniforms (the ones the converter made Play controls)
 * pinned to their starting values as constants, so the main canvas, whose
 * uniforms are the graph's, draws the source the way the check does.
 */
export function withUniformConsts(source: string, uniforms: readonly ConvertedUniform[] | undefined): string {
  if (!uniforms?.length) return source;
  let out = source;
  for (const u of uniforms) {
    const re = new RegExp(`^[ \\t]*uniform\\s+(?:(?:lowp|mediump|highp)\\s+)?${u.type}\\s+${u.name}\\s*;`, 'm');
    out = out.replace(re, `const ${u.type} ${u.name} = ${literal(u)};`);
  }
  return out;
}
