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
const KNOWN_UNIFORMS = new Set(['iResolution', 'iTime', 'iGlobalTime', 'iTimeDelta', 'iFrame', 'iMouse', 'iDate', 'u_time', 'u_resolution', 'u_mouse']);

/**
 * Uniform names other hosts use for the same three things (p5.js sketches, glslCanvas,
 * the Book of Shaders…). Only renamed when the shader declares them as uniforms, so a
 * local variable called `time` is left alone.
 */
const HOST_ALIASES: Record<string, { to: string; type: string; note?: string }> = {
  time:       { to: 'u_time', type: 'float' },
  u_seconds:  { to: 'u_time', type: 'float' },
  millis:     { to: 'u_time', type: 'float', note: 'millis was mapped to Time (seconds). If your sketch passed raw milliseconds, multiply Time by 1000 before the node' },
  u_millis:   { to: 'u_time', type: 'float', note: 'u_millis was mapped to Time (seconds).' },
  resolution: { to: 'u_resolution', type: 'vec2' },
  mouse:      { to: 'u_mouse', type: 'vec2' },
  u_mouse_uv: { to: 'u_mouse', type: 'vec2' },
};

/** Uniform types that can become a socket on the imported node (ints and bools ride on a float). */
const SOCKETABLE: Record<string, { param: string; assign: (v: string) => string }> = {
  float: { param: 'float', assign: v => v },
  vec2:  { param: 'vec2',  assign: v => v },
  vec3:  { param: 'vec3',  assign: v => v },
  vec4:  { param: 'vec4',  assign: v => v },
  int:   { param: 'float', assign: v => `int(${v})` },
  bool:  { param: 'float', assign: v => `(${v} > 0.5)` },
};

/** Rename an identifier everywhere it is used on its own (not a member `.name`, not part of a longer name). */
function renameIdent(src: string, from: string, to: string): string {
  return src.replace(new RegExp(`(?<![\\w.])${from}\\b`, 'g'), to);
}

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

  // Uniforms. The ones Shader Studio has (time, resolution, mouse — under any of the usual names)
  // are dropped and renamed. Every other float / vec / int / bool uniform becomes an INPUT of the
  // node: a global the entry sets from a socket, so you can wire Mouse, Time or a slider into it.
  // Arrays and samplers can't be sockets; they become plain globals / black and are reported.
  const socketUniforms: Array<{ name: string; type: string }> = [];
  const aliased: string[] = [];
  const arrays: string[] = [];
  const samplers: string[] = [];
  const renameLater: Array<[string, string]> = [];
  src = src.replace(/^[ \t]*uniform\s+(?:(?:lowp|mediump|highp)\s+)?(\w+)\s+([^;]+);[^\n]*\n?/gm, (_whole, type: string, names: string) => {
    const kept: string[] = [];
    for (const raw of names.split(',').map(x => x.trim()).filter(Boolean)) {
      const name = raw.replace(/\s*\[.*$/, '');
      const arraySuffix = /\[[^\]]*\]/.exec(raw)?.[0] ?? '';
      if (KNOWN_UNIFORMS.has(name)) continue;
      const alias = HOST_ALIASES[name];
      if (alias && !arraySuffix) { renameLater.push([name, alias.to]); aliased.push(alias.note ?? `${name} → ${alias.to === 'u_time' ? 'Time' : alias.to === 'u_mouse' ? 'Mouse' : 'the canvas resolution'}`); continue; }
      if (type.startsWith('sampler')) { samplers.push(name); continue; }
      if (arraySuffix) { kept.push(`${type} uni_${name}${arraySuffix};`); renameLater.push([name, `uni_${name}`]); arrays.push(`${name}${arraySuffix}`); continue; }
      if (!SOCKETABLE[type]) { kept.push(`${type} uni_${name};`); renameLater.push([name, `uni_${name}`]); continue; }
      kept.push(`${type} uni_${name};`);
      renameLater.push([name, `uni_${name}`]);
      socketUniforms.push({ name, type });
    }
    return kept.length ? kept.join('\n') + '\n' : '';
  });
  for (const [from, to] of renameLater) src = renameIdent(src, from, to);
  for (const [re, to] of RENAMES) src = src.replace(re, to);
  for (const name of samplers) {
    src = src.replace(new RegExp(`\\b(?:texture2D|texture|textureLod)\\s*\\(\\s*${name}\\s*,[^;]*?\\)(?=\\s*[;.),*+\\-/])`, 'g'), 'vec4(0.0)');
  }
  if (/\biChannel\d\b/.test(src)) {
    notes.push('iChannel textures were replaced by black; add an image slot in the dialog and sample it instead.');
    src = src.replace(/\btexture(?:2D)?\s*\(\s*iChannel\d\s*,[^)]*\)/g, 'vec4(0.0)').replace(/\btextureLod\s*\(\s*iChannel\d\s*,[^)]*\)/g, 'vec4(0.0)');
  }
  if (aliased.length) notes.push(`Mapped to Shader Studio's built-ins: ${aliased.join('; ')}.`);
  if (socketUniforms.length) notes.push(`Uniforms that became inputs on the node: ${socketUniforms.map(u => `${u.name} (${u.type})`).join(', ')}. Wire Mouse, Time or a slider into them; unwired they are 0.`);
  if (arrays.length) notes.push(`Uniform arrays can't be sockets and start at zero: ${arrays.join(', ')}. Fill them in the code if the shader needs them.`);
  if (samplers.length) notes.push(`Texture reads from ${samplers.join(', ')} were replaced by black; add an image slot in the dialog and sample it instead.`);

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
  // Parameter names are the uniform names (they become the socket labels); the globals they set are uni_<name>.
  const taken = new Set(['uv', 'alpha', 'fragCoord', 'c']);
  const params = socketUniforms.map(u => {
    let p = u.name;
    while (taken.has(p) || new RegExp(`(?<![\\w.])${p}\\b`).test(converted)) p = `${p}_in`;
    taken.add(p);
    return { ...u, param: p };
  });
  const paramDecls = params.map(u => `${SOCKETABLE[u.type].param} ${u.param}, `).join('');
  const assigns = params.map(u => `    uni_${u.name} = ${SOCKETABLE[u.type].assign(u.param)};\n`).join('');
  const entry = `// ${label}: the graph's UV (x spans ±aspect, y spans ±1) becomes the shader's pixel coordinate.\n` +
    `vec3 ${ENTRY}(vec2 uv, ${paramDecls}out float alpha) {\n` +
    assigns +
    `    vec2 fragCoord = (uv / vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5 + 0.5) * u_resolution;\n` +
    `    vec4 c = ${INNER}(fragCoord);\n` +
    `    alpha = c.a;\n` +
    `    return c.rgb;\n` +
    `}\n`;
  return { ok: true, code: `${converted.trim()}\n\n${entry}`, entry: ENTRY, notes };
}
