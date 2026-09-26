/**
 * GLSL dialects — a pasted fragment shader written for another host, read as
 * one of ours. Each host names the same few things differently: the time,
 * the resolution, the mouse, the pixel, the output. This translates those
 * names (and the entry point) to Playfield's, and says what it did, so
 * the GLSL page compiles the paste as-is and the converter reads it the same
 * way. Nothing here understands the shader: it's renaming, plus a wrapper
 * where the host provided one implicitly.
 *
 *   studio       u_time, u_resolution, u_mouse, gl_FragCoord, gl_FragColor, main()
 *   shadertoy    iTime, iResolution, iMouse, mainImage(out fragColor, in fragCoord)
 *   glslsandbox  time, resolution, mouse, surfacePosition (declared as uniforms / varying)
 *   twigl        FC, r, t, m, o (golf: geeker declares them implicitly, geekest has no main)
 *   es300        #version 300 es, `out vec4 name;`, `in` varyings, texture()
 *
 * Book of Shaders shaders already use our names and pass through.
 */

export type Dialect = 'studio' | 'shadertoy' | 'glslsandbox' | 'twigl' | 'es300';

export interface Translation {
  code: string;
  dialect: Dialect;
  /** The pasted line a line of `code` came from (1-based both ways): inserted lines map to the line before them. */
  toSourceLine: (line: number) => number;
  /** One line per thing renamed or wrapped, for the UI. */
  notes: string[];
  /** Things the host had that we don't (textures, buffers): the shader may not run as intended. */
  unsupported: string[];
}

const DIALECT_LABEL: Record<Dialect, string> = { studio: 'Playfield', shadertoy: 'Shadertoy', glslsandbox: 'GLSL Sandbox', twigl: 'twigl', es300: 'GLSL ES 3.00' };
export const dialectLabel = (d: Dialect) => DIALECT_LABEL[d];

const has = (src: string, re: RegExp) => re.test(src);

export function detectDialect(src: string): Dialect {
  if (has(src, /\bmainImage\s*\(/) || has(src, /\biResolution\b|\biTime\b|\biMouse\b/)) return 'shadertoy';
  if (has(src, /^\s*#version\s+300\s+es/m)) return 'es300';
  if (has(src, /uniform\s+(?:highp\s+|mediump\s+)?vec2\s+resolution\b/) || has(src, /varying\s+vec2\s+surfacePosition\b/)) return 'glslsandbox';
  if (!has(src, /\bvoid\s+main\s*\(/) && has(src, /\bFC\b/) && has(src, /\bo\s*[+\-*/]?=/)) return 'twigl';
  if (has(src, /\bvoid\s+main\s*\(/) && has(src, /\bFC\b/) && !has(src, /\bgl_FragCoord\b/) && has(src, /\bo\s*[+\-*/]?=/)) return 'twigl';
  return 'studio';
}

/** The index just past the matching `}` of the `{` at `open`, or -1. */
function closeOf(src: string, open: number): number {
  let d = 0;
  for (let i = open; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return i; } }
  return -1;
}

/** Whole-word rename, leaving member accesses (`.time`) alone. */
const renameWord = (src: string, from: string, to: string) => src.replace(new RegExp(`(?<![\\w.])${from}\\b`, 'g'), to);

export function translateToStudio(source: string): Translation {
  const dialect = detectDialect(source);
  const notes: string[] = []; const unsupported: string[] = [];
  // Pastes carry non-breaking spaces and other Unicode blanks (web pages, chat, PDFs); GLSL's lexer rejects them.
  // Each becomes one ordinary character of the same kind, so line numbers hold.
  let s = source.replace(/\r\n?/g, '\n').replace(/[\u2028\u2029]/g, '\n').replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, ' ');
  // Lines this reader inserts, in order, each in the coordinates of the text at that moment:
  // `count` lines after line `at`. Removed lines are blanked instead, so numbering holds.
  const inserts: Array<{ at: number; count: number }> = [];
  const lineAt = (offset: number) => s.slice(0, offset).split('\n').length;

  // ── GLSL ES 3.00 → 1.00 surface syntax ────────────────────────────────────
  if (has(s, /^\s*#version\s+300\s+es/m) || (dialect === 'es300')) {
    s = s.replace(/^[ \t]*#version[^\n]*/m, '');
    const out = /^[ \t]*(?:layout\s*\([^)]*\)\s*)?out\s+(?:highp\s+|mediump\s+|lowp\s+)?vec4\s+(\w+)\s*;[^\n]*/m.exec(s);
    if (out) { s = s.replace(out[0], ''); s = renameWord(s, out[1], 'gl_FragColor'); notes.push(`out vec4 ${out[1]} → gl_FragColor`); }
    s = s.replace(/^(\s*)in\s+(?=(?:highp|mediump|lowp)?\s*(?:float|vec[234])\s+\w+\s*;)/gm, '$1varying ');
    if (has(s, /\btexture\s*\(/)) { s = s.replace(/\btexture\s*\(/g, 'texture2D('); notes.push('texture() → texture2D()'); }
    notes.unshift('#version 300 es read as GLSL ES 1.00');
  }

  // ── Shadertoy ─────────────────────────────────────────────────────────────
  if (dialect === 'shadertoy') {
    const renamed: string[] = [];
    const rename = (re: RegExp, to: string, note: string) => { if (re.test(s)) { s = s.replace(re, to); renamed.push(note); } };
    rename(/\biResolution\.xy\b/g, 'u_resolution', 'iResolution');
    rename(/\biResolution\.([xy])\b/g, 'u_resolution.$1', 'iResolution');
    rename(/\biResolution\b/g, 'vec3(u_resolution, 1.0)', 'iResolution');
    rename(/\biTime\b/g, 'u_time', 'iTime');
    rename(/\biGlobalTime\b/g, 'u_time', 'iGlobalTime');
    rename(/\biTimeDelta\b/g, '(1.0 / 60.0)', 'iTimeDelta (as 1/60)');
    rename(/\biFrame\b/g, 'floor(u_time * 60.0)', 'iFrame (as time × 60)');
    rename(/\biMouse\.xy\b/g, 'u_mouse', 'iMouse');
    rename(/\biMouse\.zw\b/g, 'vec2(0.0)', 'iMouse');
    rename(/\biMouse\b/g, 'vec4(u_mouse, 0.0, 0.0)', 'iMouse');
    rename(/\biDate\b/g, 'vec4(0.0)', 'iDate (as zero)');
    if (has(s, /\biChannel\d\b/)) {
      s = s.replace(/\btexture(?:2D|Lod)?\s*\(\s*iChannel\d\s*,[^;]*?\)(?=\s*[;.),*+\-/])/g, 'vec4(0.0)').replace(/\biChannelResolution\b/g, 'vec3[4](vec3(1.0), vec3(1.0), vec3(1.0), vec3(1.0))');
      unsupported.push('iChannel textures read as black (no texture inputs yet)');
    }
    const m = /void\s+mainImage\s*\(\s*out\s+vec4\s+(\w+)\s*,\s*(?:in\s+)?vec2\s+(\w+)\s*\)\s*\{/.exec(s);
    if (m) {
      inserts.push({ at: lineAt(m.index), count: 1 });
      // The rest of the line after `{` follows the new declaration; no extra newline, so numbering shifts by exactly one.
      const head = `void main() {\n  vec2 ${m[2]} = gl_FragCoord.xy;`;
      const bodyStart = m.index + head.indexOf('{'); // the `{` of main
      s = s.slice(0, m.index) + head + s.slice(m.index + m[0].length);
      // The out parameter is a name local to mainImage: rename it in that body only (another function
      // may use the same letter for something else, as `vec2 C` does in many shaders).
      const bodyEnd = closeOf(s, bodyStart);
      const end = bodyEnd > 0 ? bodyEnd : s.length;
      s = s.slice(0, bodyStart) + renameWord(s.slice(bodyStart, end), m[1], 'gl_FragColor') + s.slice(end);
      notes.push('mainImage() read as main()');
    }
    if (renamed.length) notes.push(`${[...new Set(renamed)].join(', ')} → ours`);
  }

  // ── GLSL Sandbox ──────────────────────────────────────────────────────────
  if (dialect === 'glslsandbox') {
    const drop = (name: string, to: string) => {
      const decl = new RegExp(`^[ \\t]*uniform\\s+(?:highp\\s+|mediump\\s+|lowp\\s+)?\\w+\\s+${name}\\s*;[^\\n]*`, 'm');
      if (decl.test(s)) { s = s.replace(decl, ''); s = renameWord(s, name, to); return true; }
      return false;
    };
    const done = [drop('time', 'u_time') && 'time', drop('resolution', 'u_resolution') && 'resolution', drop('mouse', 'u_mouse') && 'mouse'].filter(Boolean);
    if (has(s, /varying\s+vec2\s+surfacePosition\s*;/)) {
      s = s.replace(/^[ \t]*varying\s+vec2\s+surfacePosition\s*;[^\n]*/m, '');
      s = renameWord(s, 'surfacePosition', '(gl_FragCoord.xy / u_resolution * 2.0 - 1.0)');
      done.push('surfacePosition');
    }
    if (has(s, /\bbackbuffer\b/)) unsupported.push('backbuffer (the previous frame) reads as black');
    if (done.length) notes.push(`${done.join(', ')} → ours`);
  }

  // ── twigl golf ────────────────────────────────────────────────────────────
  if (dialect === 'twigl') {
    const prelude = '  vec2 r = u_resolution;\n  float t = u_time;\n  vec2 m = u_mouse;\n  vec4 FC = gl_FragCoord;\n  vec4 o = vec4(0.0);\n';
    const main = /void\s+main\s*\(\s*(?:void)?\s*\)\s*\{/.exec(s);
    if (main) {
      const close = closeOf(s, main.index + main[0].length - 1);
      if (close > 0) {
        const mainLine = lineAt(main.index), closeLine = lineAt(close);
        s = s.slice(0, main.index + main[0].length) + '\n' + prelude + s.slice(main.index + main[0].length, close) + '\n  gl_FragColor = o;\n' + s.slice(close);
        inserts.push({ at: mainLine, count: 5 }, { at: closeLine - 1 + 5, count: 1 });
        notes.push('twigl geeker: r, t, m, FC, o declared; o written to gl_FragColor');
      }
    } else {
      const bodyLines = s.split('\n').length;
      s = `void main() {\n${prelude}${s}\n  gl_FragColor = o;\n}\n`;
      inserts.push({ at: 0, count: 6 }, { at: 6 + bodyLines, count: 2 });
      notes.push('twigl geekest: wrapped in main() with r, t, m, FC, o');
    }
    if (has(s, /\b(?:snoise|fsnoise|fsnoiseDigits|hsv)\s*\(/)) unsupported.push('twigl’s built-in noise helpers (snoise, fsnoise, hsv) aren’t provided');
  }

  // ── What every host leaves to us: precision, uniforms, the varying ────────
  const declared = (n: string) => new RegExp(`uniform\\s+(?:highp\\s+|mediump\\s+|lowp\\s+)?\\w+\\s+${n}\\b`).test(s);
  const head: string[] = [];
  if (!has(s, /^\s*precision\s+\w+\s+float\s*;/m)) head.push('precision highp float;');
  for (const [n, t] of [['u_resolution', 'vec2'], ['u_time', 'float'], ['u_mouse', 'vec2']] as const) if (has(s, new RegExp(`\\b${n}\\b`)) && !declared(n)) head.push(`uniform ${t} ${n};`);
  if (has(s, /\bvUv\b/) && !has(s, /varying\s+vec2\s+vUv\s*;/)) head.push('varying vec2 vUv;');
  if (head.length) {
    // After any leading #directives / precision the shader has, so #version-style lines stay first.
    const lead = /^(?:[ \t]*(?:#[^\n]*|precision\s+[^\n]*;)?\n)*/.exec(s)?.[0] ?? '';
    inserts.push({ at: lead.split('\n').length - 1, count: head.length });
    s = lead + head.join('\n') + '\n' + s.slice(lead.length);
  }
  if (!has(s, /\bvoid\s+main\s*\(/)) unsupported.push('No main() (and no entry point this reader knows)');
  const toSourceLine = (line: number) => {
    let l = line;
    for (let i = inserts.length - 1; i >= 0; i--) { const { at, count } = inserts[i]; if (l > at + count) l -= count; else if (l > at) l = Math.max(1, at); }
    return Math.max(1, l);
  };
  return { code: s, dialect, notes, unsupported, toSourceLine };
}
