/**
 * analyze — what a p5 sketch uses, and what each thing does on a Script layer.
 *
 * Every p5 name the sketch reaches (a global it calls or reads, or `p.name`
 * on an instance-mode sketch's p5) is sorted into supported (runs as in p5),
 * mapped (runs, differently: DOM controls become the layer's controls,
 * loadImage reads the bundled asset…), stubbed (does nothing) and
 * unsupported. Each has the lines it is used on and a short note. Assets the
 * sketch loads by a path the project does not have are warnings.
 */

import { KP5_CALLBACKS, KP5_NAMES, KP5_STUBBED, KP5_UNSUPPORTED, KP5_WEBGL, KP5_SOUND } from '../kit/p5.js';
import { calleeName, isFunction, isReference, numberOf, parseCode, Scopes, stringOf, topLevelDeclarations, walk, type AstNode, type SyntaxProblem } from './ast';
import type { P5File } from './project';

export type P5ItemStatus = 'supported' | 'mapped' | 'stubbed' | 'unsupported';

export interface P5Ref { file: string; line: number }

/** One p5 name the sketch uses. `severity` 'warning' for things that may run oddly, 'error' for ones that stop it. */
export interface P5Item { name: string; status: P5ItemStatus; note: string; refs: P5Ref[]; severity: 'info' | 'warning' | 'error' }

/** A warning about the project not tied to one p5 name (a missing asset, a path from the web). */
export interface P5Warning { message: string; file?: string; line?: number }

export interface P5Analysis {
  mode: '2d' | '3d';
  /** `new p5(sketch)`: the sketch's p5 functions are `p.name`. */
  instance: boolean;
  /** createCanvas's size when written as numbers; `window` for windowWidth / windowHeight. */
  canvas: { width: number | 'window' | null; height: number | 'window' | null } | null;
  /** Reads or writes pixels (loadPixels, pixels, get, set): slower on big canvases. */
  usesPixels: boolean;
  preload: boolean;
  /** p5 functions the sketch defines that the layer calls (setup, draw, mousePressed…). */
  callbacks: string[];
  items: P5Item[];
  warnings: P5Warning[];
  syntaxErrors: SyntaxProblem[];
  /** colorMode(HSB) or HSL somewhere: colour numbers are not RGB. */
  colourModeNotRgb: boolean;
}

const has = (list: readonly string[]) => { const s = new Set(list); return (n: string) => s.has(n); };
const isName = has(KP5_NAMES), isCallback = has(KP5_CALLBACKS), isStub = has(KP5_STUBBED), isUnsupported = has(KP5_UNSUPPORTED), isWebgl = has(KP5_WEBGL);

/** Names that change meaning on the layer. */
const MAPPED: Record<string, string> = {
  createSlider: 'Becomes a slider in the layer\'s controls.',
  createCheckbox: 'Becomes a toggle in the layer\'s controls.',
  createSelect: 'Becomes a choice in the layer\'s controls.',
  createRadio: 'Becomes a choice in the layer\'s controls.',
  createColorPicker: 'Becomes a colour in the layer\'s controls.',
  createButton: 'Becomes a button in the layer\'s controls.',
  'p5.Amplitude': 'Reads the live audio input\'s level.',
  'p5.FFT': 'Reads the live audio input\'s spectrum.',
  'p5.AudioIn': 'The live audio input.',
  loadImage: 'Reads the image bundled with the layer.',
  loadFont: 'Reads the font bundled with the layer.',
  loadJSON: 'Reads the JSON bundled with the layer.',
  loadStrings: 'Reads the text file bundled with the layer.',
  loadTable: 'Reads the table bundled with the layer.',
  createCanvas: 'The canvas is fitted into the layer, keeping its shape.',
  WEBGL: 'Runs on the layer\'s 3D mode.',
};

const LOADERS = new Set(['loadImage', 'loadFont', 'loadJSON', 'loadStrings', 'loadTable', 'loadSound', 'loadModel', 'loadShader', 'loadBytes', 'loadXML']);
const SOUND_PLAYBACK = new Set(['play', 'loop', 'stop', 'pause', 'jump', 'setVolume', 'rate', 'playMode', 'amp', 'pan', 'isPlaying']);
/** 2D-canvas names a WEBGL sketch cannot use the same way. */
const TWO_D_ONLY = new Set(['pixels', 'loadPixels', 'updatePixels', 'get', 'set', 'filter', 'erase', 'noErase']);
const PIXELS = new Set(['pixels', 'loadPixels', 'updatePixels', 'get', 'set']);
/** p5 classes the layer provides (p5.Vector's static maths, p5.Color). */
const P5_CLASSES = new Set(['p5.Vector', 'p5.Color']);

/** A top-level `new p5(fn)` call's sketch function (inline, or a top-level function or arrow it names). */
function instanceFunctions(ast: AstNode, scopes: Scopes, tops: Map<string, AstNode>): AstNode[] {
  const out: AstNode[] = [];
  walk(ast, (n, anc) => {
    if (n.type !== 'NewExpression' || n.callee.type !== 'Identifier' || n.callee.name !== 'p5' || scopes.localAt('p5', anc)) return;
    const a = n.arguments[0];
    if (!a) return;
    if (isFunction(a)) out.push(a);
    else if (a.type === 'Identifier' && tops.has(a.name)) {
      walk(ast, m => {
        if (m.type === 'FunctionDeclaration' && m.id?.name === a.name) out.push(m);
        if (m.type === 'VariableDeclarator' && m.id.type === 'Identifier' && m.id.name === a.name && isFunction(m.init)) out.push(m.init);
      });
    }
  });
  return out;
}

/** What the layer makes of the project's code. */
export function analyzeProject(files: P5File[], assets: { name: string; tooBig?: boolean }[] = []): P5Analysis {
  const syntaxErrors: SyntaxProblem[] = [];
  const parsed: { file: P5File; ast: AstNode; scopes: Scopes }[] = [];
  const topNames = new Set<string>();
  for (const f of files) {
    const p = parseCode(f.code);
    if (!p.ast) { syntaxErrors.push({ file: f.name, ...p.error! }); continue; }
    const scopes = new Scopes(p.ast);
    for (const n of topLevelDeclarations(p.ast).keys()) topNames.add(n);
    parsed.push({ file: f, ast: p.ast, scopes });
  }

  const uses = new Map<string, P5Ref[]>();
  const use = (name: string, file: string, node: AstNode) => {
    const refs = uses.get(name) ?? [];
    const line = node.loc?.start.line ?? 1;
    if (!refs.some(r => r.file === file && r.line === line)) refs.push({ file, line });
    uses.set(name, refs);
  };
  const warnings: P5Warning[] = [];
  const callbacks = new Set<string>();
  const callbackRefs = new Map<string, P5Ref[]>();
  let instance = false, webgl = false, colourModeNotRgb = false;
  let canvas: P5Analysis['canvas'] = null;
  const assetNames = new Map(assets.map(a => [a.name, a]));
  const lowerAssets = new Map(assets.map(a => [a.name.toLowerCase(), a.name]));
  const soundVars = new Set<string>();

  for (const { file, ast, scopes } of parsed) {
    const tops = topLevelDeclarations(ast);
    for (const [name, id] of tops) {
      if (isCallback(name)) { callbacks.add(name); callbackRefs.set(name, [...(callbackRefs.get(name) ?? []), { file: file.name, line: id.loc?.start.line ?? 1 }]); }
    }
    // Instance mode: the sketch's p5 is the function's first parameter.
    const inst = instanceFunctions(ast, scopes, tops);
    if (inst.length) instance = true;
    const p5Params = new Set<string>();
    for (const fn of inst) if (fn.params[0]?.type === 'Identifier') p5Params.add(fn.params[0].name);

    // Variables holding loadSound's result (for .play() and friends).
    walk(ast, n => {
      const init = n.type === 'VariableDeclarator' ? n.init : n.type === 'AssignmentExpression' ? n.right : null;
      const target = n.type === 'VariableDeclarator' ? n.id : n.type === 'AssignmentExpression' ? n.left : null;
      if (init?.type === 'CallExpression' && calleeName(init)?.name === 'loadSound') {
        if (target?.type === 'Identifier') soundVars.add(target.name);
        if (target?.type === 'MemberExpression' && !target.computed) soundVars.add(target.property.name);
      }
    });

    walk(ast, (n, anc) => {
      const parent = anc[anc.length - 1];
      // Globals: identifiers that are not the sketch's own and not local.
      if (n.type === 'Identifier' && isReference(n, parent, scopes.bindings) && !topNames.has(n.name) && !scopes.localAt(n.name, anc)) {
        if (isName(n.name) || isStub(n.name) || isUnsupported(n.name) || isWebgl(n.name)) use(n.name, file.name, n);
        // `setup = function () {}` without a declaration.
        if (isCallback(n.name) && parent?.type === 'AssignmentExpression' && parent.left === n) callbacks.add(n.name);
      }
      if (n.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier' && n.object.type === 'Identifier') {
        const obj = n.object.name, prop = n.property.name;
        // p.fill() in instance mode, p.setup = … defines a callback.
        if (p5Params.has(obj) && scopes.localAt(obj, anc)) {
          if (isCallback(prop) && parent?.type === 'AssignmentExpression' && parent.left === n) {
            callbacks.add(prop);
            callbackRefs.set(prop, [...(callbackRefs.get(prop) ?? []), { file: file.name, line: n.loc?.start.line ?? 1 }]);
          } else if (isName(prop) || isStub(prop) || isUnsupported(prop) || isWebgl(prop)) use(prop, file.name, n);
          else if (MAPPED[`p5.${prop}`] || prop === 'Vector') use(`p5.${prop}`, file.name, n);
        }
        // p5.Vector, p5.FFT…
        if (obj === 'p5' && !scopes.localAt('p5', anc) && /^[A-Z]/.test(prop)) use(`p5.${prop}`, file.name, n);
        // Sound playback on a loadSound result.
        if (soundVars.has(obj) && SOUND_PLAYBACK.has(prop) && parent?.type === 'CallExpression' && parent.callee === n) use(`sound.${prop}`, file.name, n);
      }
      if (n.type === 'CallExpression') {
        const c = calleeName(n);
        if (!c) return;
        const global = c.object === null ? !topNames.has(c.name) && !scopes.localAt(c.name, anc) : p5Params.has(c.object);
        if (!global) {
          // this.sound.play()
          if (c.object === 'this' && SOUND_PLAYBACK.has(c.name) && n.callee.object?.type === 'MemberExpression') {
            const inner = n.callee.object;
            if (!inner.computed && soundVars.has(inner.property.name)) use(`sound.${c.name}`, file.name, n);
          }
          return;
        }
        if (c.name === 'createCanvas') {
          const [w, h, r] = n.arguments as AstNode[];
          const dim = (a: AstNode | undefined) => {
            const v = numberOf(a);
            if (v !== null) return v;
            if (a?.type === 'Identifier' && /^window(Width|Height)$/.test(a.name)) return 'window' as const;
            if (a?.type === 'MemberExpression' && !a.computed && /^window(Width|Height)$/.test(a.property.name)) return 'window' as const;
            return null;
          };
          canvas ??= { width: dim(w), height: dim(h) };
          if (r && ((r.type === 'Identifier' && r.name === 'WEBGL') || (r.type === 'MemberExpression' && !r.computed && r.property.name === 'WEBGL'))) webgl = true;
        }
        if (c.name === 'colorMode') {
          const a = n.arguments[0];
          const nm = a?.type === 'Identifier' ? a.name : a?.type === 'MemberExpression' && !a.computed ? a.property.name : '';
          if (nm === 'HSB' || nm === 'HSL') colourModeNotRgb = true;
        }
        if (LOADERS.has(c.name)) {
          const a = n.arguments[0] as AstNode | undefined;
          const path = stringOf(a);
          const line = n.loc?.start.line ?? 1;
          if (path === null) {
            if (a && c.name !== 'loadSound') warnings.push({ message: `${c.name} is given a path worked out as the sketch runs; check the files it loads are in the project.`, file: file.name, line });
          } else if (/^(https?:)?\/\//i.test(path)) {
            warnings.push({ message: `${c.name}('${path}') loads from the web: it needs a connection, and may be blocked. Add the file to the project instead.`, file: file.name, line });
          } else if (!/^data:/.test(path) && ['loadImage', 'loadFont', 'loadJSON', 'loadStrings', 'loadTable'].includes(c.name)) {
            const clean = path.replace(/^\.\//, '').replace(/^\//, '');
            const a2 = assetNames.get(clean);
            if (a2?.tooBig) warnings.push({ message: `${clean} is too big to keep in the layer, so ${c.name} will not find it.`, file: file.name, line });
            else if (!a2) {
              const near = lowerAssets.get(clean.toLowerCase());
              warnings.push({ message: near ? `${c.name}('${path}'): the project has ${near}; the case of the name must match.` : `${c.name}('${path}'): there is no ${clean} in the project.`, file: file.name, line });
            }
          }
        }
      }
    });
  }

  if (webgl && !uses.has('WEBGL')) uses.set('WEBGL', []);
  const mode: '2d' | '3d' = webgl ? '3d' : '2d';
  const items: P5Item[] = [];
  for (const [name, refs] of uses) items.push(classify(name, refs, mode));
  for (const name of callbacks) {
    if (uses.has(name)) continue;
    items.push({ name, status: 'supported', note: 'The layer calls it, as p5 does.', refs: callbackRefs.get(name) ?? [], severity: 'info' });
  }
  items.sort((a, b) => a.name.localeCompare(b.name));

  return {
    mode, instance, canvas,
    usesPixels: [...uses.keys()].some(n => PIXELS.has(n)),
    preload: callbacks.has('preload'),
    callbacks: [...callbacks].sort(),
    items, warnings, syntaxErrors, colourModeNotRgb,
  };
}

function classify(name: string, refs: P5Ref[], mode: '2d' | '3d'): P5Item {
  const item = (status: P5ItemStatus, note: string, severity: P5Item['severity'] = 'info'): P5Item => ({ name, status, note, refs, severity });
  if (name.startsWith('sound.')) return item('unsupported', `Sound playback (${name.slice(6)}) is not supported: the layer reads live audio but plays none.`, 'error');
  if (MAPPED[name]) return item('mapped', MAPPED[name]);
  if (name === 'loadSound') return item('unsupported', 'Sound files are not supported: the layer reads live audio input but plays no sounds.', 'error');
  if (isUnsupported(name)) return item('unsupported', `${name} is not supported on the layer; calling it stops the sketch with an error.`, 'error');
  if (isStub(name)) return item('stubbed', `${name} does nothing on the layer (there is no page around the canvas).`);
  if (name.startsWith('p5.')) {
    if (P5_CLASSES.has(name)) return item('supported', 'Runs as in p5.');
    if (KP5_SOUND.includes(name)) return item('mapped', 'Reads the live audio input.');
    return item('unsupported', `${name} is not part of the layer's p5.`, 'warning');
  }
  if (isWebgl(name)) return mode === '3d' ? item('supported', 'Runs on the layer\'s 3D mode.') : item('unsupported', `${name} is for WEBGL sketches; this one draws in 2D (no WEBGL in createCanvas).`, 'warning');
  if (mode === '3d' && TWO_D_ONLY.has(name)) return item('unsupported', `${name} works on 2D sketches; this one is WEBGL.`, 'warning');
  if (isCallback(name)) return item('supported', 'The layer calls it, as p5 does.');
  if (PIXELS.has(name)) return item('supported', 'Runs as in p5; reading pixels is slow on big canvases.');
  return item('supported', 'Runs as in p5.');
}

/** Items grouped by status, in the order a report lists them. */
export function groupItems(items: P5Item[]): Record<P5ItemStatus, P5Item[]> {
  const out: Record<P5ItemStatus, P5Item[]> = { unsupported: [], stubbed: [], mapped: [], supported: [] };
  for (const it of items) out[it.status].push(it);
  return out;
}
