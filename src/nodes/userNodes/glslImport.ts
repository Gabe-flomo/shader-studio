/**
 * glslImport — turn a whole fragment shader (Shadertoy `mainImage` or a raw
 * `void main()` with gl_FragColor) into a code-backed node.
 *
 * This is the first rung of the GLSL → graph ladder: the shader becomes ONE
 * node, `vec3 <name>(vec2 uv, out float alpha)`, that the graph wires
 * UV → node → Output. Its helpers ride along untouched; only the entry is
 * rewritten (fragColor/gl_FragColor become a returned value, fragCoord is
 * derived from the graph's UV) and Shadertoy's uniforms are mapped onto
 * Shader Studio's (u_time, u_resolution, u_mouse). Anything that can't be
 * mapped (iChannel textures, iFrame…) is reported so the user can fix it in
 * the publish dialog before the node is created.
 */
import { parseCodeSource } from './codeSource';

export interface GlslImportResult {
  ok: true;
  /** The rewritten source, ready for the code-node publish path */
  code: string;
  /** Entry function name inside `code` */
  entry: string;
  /** Things the user should know (unsupported inputs replaced, etc.) */
  notes: string[];
}
export interface GlslImportFailure { ok: false; error: string }

const ENTRY = 'imported_shader';
const INNER = 'imported_shader_pass';

/** Uniform names we can stand in for, and what they become. */
const RENAMES: Array<[RegExp, string]> = [
  [/\biResolution\.xy\b/g, 'u_resolution'],
  [/\biResolution\b/g, 'vec3(u_resolution, 1.0)'],
  [/\biTime\b/g, 'u_time'],
  [/\biGlobalTime\b/g, 'u_time'],
  [/\biTimeDelta\b/g, '(1.0 / 60.0)'],
  [/\biFrame\b/g, 'floor(u_time * 60.0)'],
  [/\biMouse\.xy\b/g, 'u_mouse'],
  [/\biMouse\b/g, 'vec4(u_mouse, 0.0, 0.0)'],
  [/\biDate\b/g, 'vec4(0.0, 0.0, 0.0, u_time)'],
  [/\bu_mouse_uv\b/g, 'u_mouse'],
];
const KNOWN_UNIFORMS = new Set(['iResolution', 'iTime', 'iGlobalTime', 'iTimeDelta', 'iFrame', 'iMouse', 'iDate', 'u_time', 'u_resolution', 'u_mouse', 'time', 'resolution', 'mouse']);

function stripDirectives(src: string): string {
  return src
    .replace(/^[ \t]*#version[^\n]*\n?/gm, '')
    .replace(/^[ \t]*#ifdef\s+GL_ES[\s\S]*?#endif[^\n]*\n?/gm, '')
    .replace(/^[ \t]*precision\s+\w+\s+\w+\s*;[^\n]*\n?/gm, '');
}

/** Insert `return fragColor;` before bare `return;` statements and at the end of the body. */
function returnsToValue(body: string, valueName: string): string {
  const withReturns = body.replace(/\breturn\s*;/g, `return ${valueName};`);
  return `${withReturns}\n    return ${valueName};\n`;
}

/** `void main() { … }` with its offsets, found by brace matching. */
function findMain(src: string): { start: number; end: number; text: string } | null {
  const m = /\bvoid\s+main\s*\(\s*(?:void)?\s*\)\s*\{/.exec(src);
  if (!m) return null;
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return { start: m.index, end: i + 1, text: src.slice(m.index, i + 1) };
  }
  return null;
}

function bodyOf(fn: { text: string }): string {
  const open = fn.text.indexOf('{');
  return fn.text.slice(open + 1, fn.text.lastIndexOf('}'));
}

export function convertFragmentShader(source: string, opts: { label?: string } = {}): GlslImportResult | GlslImportFailure {
  const notes: string[] = [];
  let src = stripDirectives(source);

  // Uniforms: drop the ones we map; turn the rest into named constants so the shader still compiles.
  const unknownUniforms: string[] = [];
  src = src.replace(/^[ \t]*uniform\s+(?:(?:lowp|mediump|highp)\s+)?(\w+)\s+([^;]+);[^\n]*\n?/gm, (_whole, type: string, names: string) => {
    const list = names.split(',').map(s => s.trim().replace(/\[.*$/, ''));
    const kept: string[] = [];
    for (const name of list) {
      if (KNOWN_UNIFORMS.has(name)) continue;
      if (type.startsWith('sampler')) { unknownUniforms.push(`${name} (${type})`); kept.push(`// ${type} ${name}: textures aren't imported — add an image slot in the dialog and use it instead`); continue; }
      const zero = type === 'float' ? '0.0' : type === 'int' ? '0' : type === 'bool' ? 'false' : `${type}(0.0)`;
      kept.push(`const ${type} ${name} = ${zero}; // was a uniform: set a value, or expose it as a parameter`);
      unknownUniforms.push(`${name} (${type})`);
    }
    return kept.length ? kept.join('\n') + '\n' : '';
  });
  for (const [re, to] of RENAMES) src = src.replace(re, to);
  if (/\biChannel\d\b/.test(src)) {
    notes.push('iChannel textures were replaced by black; add an image slot in the dialog and sample it instead.');
    src = src.replace(/\btexture(?:2D)?\s*\(\s*iChannel\d\s*,[^)]*\)/g, 'vec4(0.0)').replace(/\btextureLod\s*\(\s*iChannel\d\s*,[^)]*\)/g, 'vec4(0.0)');
  }
  if (unknownUniforms.length) notes.push(`Uniforms turned into constants: ${unknownUniforms.join(', ')}.`);

  // parseCodeSource skips main() on purpose (it can't be a node entry) and fails on a file with
  // no other function, so main() is found here and the parse is only used for mainImage.
  const parsed = parseCodeSource(src);
  const mainImage = parsed.ok ? parsed.functions.find(f => f.name === 'mainImage') : undefined;
  const main = mainImage ? null : findMain(src);
  if (!mainImage && !main) return { ok: false, error: 'No mainImage(out vec4 fragColor, in vec2 fragCoord) or void main() found.' };

  let converted: string;
  if (mainImage) {
    const color = mainImage.params.find(p => p.qualifier === 'out')?.name ?? 'fragColor';
    const coord = mainImage.params.find(p => p.qualifier !== 'out')?.name ?? 'fragCoord';
    const body = returnsToValue(bodyOf(mainImage), color);
    const inner = `vec4 ${INNER}(vec2 ${coord}) {\n    vec4 ${color} = vec4(0.0);${body}}`;
    converted = src.slice(0, mainImage.start) + inner + src.slice(mainImage.end);
  } else {
    const fn = main!;
    let body = bodyOf(fn).replace(/\bgl_FragColor\b/g, 'fragColor').replace(/\bgl_FragCoord\.xy\b/g, 'fragCoord').replace(/\bgl_FragCoord\b/g, 'vec4(fragCoord, 0.0, 1.0)');
    body = returnsToValue(body, 'fragColor');
    const inner = `vec4 ${INNER}(vec2 fragCoord) {\n    vec4 fragColor = vec4(0.0);${body}}`;
    converted = src.slice(0, fn.start) + inner + src.slice(fn.end);
    // Any helper that read gl_FragCoord directly can't: say so
    if (/\bgl_FragCoord\b/.test(converted)) notes.push('A helper reads gl_FragCoord directly; pass fragCoord into it instead.');
  }
  if (/\bgl_FragColor\b/.test(converted)) notes.push('gl_FragColor is written outside main(); only main() was converted.');

  const label = opts.label?.trim() || 'Imported shader';
  const entry = `// ${label}: the graph's UV (x spans ±aspect, y spans ±1) becomes the shader's pixel coordinate.\n` +
    `vec3 ${ENTRY}(vec2 uv, out float alpha) {\n` +
    `    vec2 fragCoord = (uv / vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5 + 0.5) * u_resolution;\n` +
    `    vec4 c = ${INNER}(fragCoord);\n` +
    `    alpha = c.a;\n` +
    `    return c.rgb;\n` +
    `}\n`;
  return { ok: true, code: `${converted.trim()}\n\n${entry}`, entry: ENTRY, notes };
}
