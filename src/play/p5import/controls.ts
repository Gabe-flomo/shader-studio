/**
 * controls — a p5 sketch's knobs as the layer's declared controls.
 *
 * Three jobs. `mapDomControls`: p5's page controls (createSlider,
 * createCheckbox, createSelect, createRadio, createColorPicker, createButton)
 * become entries in the params object, and each create call becomes
 * `control('key')`, whose handle answers .value(), .checked(), .changed()…
 * as the element did. `findControlCandidates`: the values worth a control, a
 * top-level `let speed = 2` or a literal like the 255, 120, 40 in
 * `fill(255, 120, 40)`, ranked. `applyControls`: the chosen ones become
 * controls, with the smallest edits that do it (a literal moves to a new
 * top-level `let`, a `const` becomes `let`, an entry joins params).
 */

import { KP5_CALLBACKS, KP5_NAMES, KP5_STUBBED, KP5_UNSUPPORTED, KP5_WEBGL } from '../kit/p5.js';
import { addParamEntry, declaredParams, guessRange, labelFromKey, looksLikeCount, paramsBlock } from '../../components/play/layers/scriptTools';
import { calleeName, isFunction, isReference, lineAt, numberOf, parseCode, patternIds, Scopes, stringOf, topLevelDeclarations, walk, type AstNode } from './ast';
import { P5_MAIN_FILE, type P5File } from './project';
import type { P5Ref } from './analyze';

// ── Shapes ───────────────────────────────────────────────────────────────────

/** What a control is on the layer's panel. `integer` is a slider in whole steps. */
export type P5ControlKind = 'slider' | 'integer' | 'toggle' | 'colour' | 'choice' | 'button';

/** A range for a slider. */
export interface P5Range { min: number; max: number; step: number }

/** A value in the sketch that could become a control. */
export interface P5Candidate {
  /** Stable for the same code: `var:<file>:<name>` or `lit:<file>:<offset>`. */
  id: string;
  /** A top-level variable, or a literal written in the code. */
  source: 'variable' | 'literal';
  file: string;
  line: number;
  column: number;
  /** The variable's name in its declaration, or the literal (for a colour, the call's colour arguments). */
  start: number;
  end: number;
  /** The variable's name, or a suggested one for the new variable (fillColour, noiseScale…). */
  name: string;
  /** Its value: a number, a boolean, a string ('#hex' for colours) or [r, g, b(, a)]. */
  value: number | boolean | string | number[];
  kind: Exclude<P5ControlKind, 'button'>;
  range?: P5Range;
  options?: string[];
  /** Lines that read it. */
  uses: P5Ref[];
  /** Changed as the sketch runs (a counter, a position): state, not a good control. */
  state: boolean;
  /** Only read before the sketch starts (top level, setup, preload): changing it restarts the sketch. */
  setupOnly: boolean;
  /** Higher is a better control. */
  score: number;
  /** A short plain-English reason, for the list. */
  note: string;
  /** Where the literal is written (several for one value used alike, e.g. both 0.01s in one noise call). `spread`: an rgb colour followed by an alpha. */
  sites: { start: number; end: number; spread?: boolean }[];
  /** A variable's declaration keyword and where the keyword starts. */
  declKeyword?: 'const' | 'let' | 'var';
  declStart?: number;
  /** The source text of the value (what a new `let` is set to). */
  text: string;
  /** Internal: where the name is read (for candidateAt). */
  refRanges?: { file: string; start: number; end: number }[];
}

/** A candidate the person chose, with their changes to its name, kind, label, range or options. */
export interface P5ChosenControl { id: string; kind?: P5ControlKind; key?: string; label?: string; min?: number; max?: number; step?: number; options?: string[] }

/** A params entry the import added, as written into sketch.js. */
export interface P5ParamEntry { key: string; kind: P5ControlKind; entry: string }

export interface P5RewriteResult {
  files: P5File[];
  /** Where each new control starts: numbers as they are, colours packed 0xRRGGBB, choices as the option's index, toggles 0 / 1. */
  startAt: Record<string, number>;
  entries: P5ParamEntry[];
  notes: string[];
}

// ── Small helpers ────────────────────────────────────────────────────────────

const RESERVED = new Set(['setup', 'draw', 'params', 'control', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'await', 'static', 'undefined', 'NaN', 'Infinity', 'Math', 'window', 'document', 'console', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'JSON', 'p5', 'name', 'length', 'top', 'self', 'parent', 'status', 'event', 'screen', 'history', 'location', 'navigator', 'performance', 'Image', 'Audio', 'Map', 'Set', 'Symbol', 'Promise', 'color', 'colour', 'value']);
const P5_TAKEN = new Set([...KP5_NAMES, ...KP5_CALLBACKS, ...KP5_STUBBED, ...KP5_UNSUPPORTED, ...KP5_WEBGL]);
const IDENT = /^[A-Za-z_$][\w$]*$/;
const num = (n: number) => (Number.isInteger(n) ? `${n}` : `${+n.toPrecision(6)}`);
const q = (t: string) => `'${t.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** '#rgb', '#rrggbb', '#rrggbbaa' or 'rgb(r, g, b)' as [r, g, b]; null for anything else. */
export function parseColourString(s: string): number[] | null {
  const t = s.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(t);
  if (m) return [...m[1]].map(c => parseInt(c + c, 16));
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(t);
  if (m) return [0, 2, 4].map(i => parseInt(m![1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*[\d.]+\s*)?\)$/i.exec(t);
  if (m) return [m[1], m[2], m[3]].map(x => clampByte(Number(x)));
  return null;
}

const hexOf = (rgb: number[]) => `#${rgb.slice(0, 3).map(v => clampByte(v).toString(16).padStart(2, '0')).join('')}`;
/** A colour as one number, 0xRRGGBB. */
export const packColour = (rgb: number[]) => (clampByte(rgb[0]) << 16) | (clampByte(rgb[1]) << 8) | clampByte(rgb[2]);

/** A range for a slider starting at `v`: guessRange, tuned for small scales, counts, alpha and sizes. */
export function rangeFor(v: number, o: { integer?: boolean; name?: string } = {}): P5Range {
  const name = o.name ?? '';
  if (/alpha|opacity|transparency/i.test(name)) return v > 1 ? { min: 0, max: 255, step: 1 } : { min: 0, max: 1, step: 0.01 };
  if (/^fps$|frameRate/i.test(name)) return { min: 1, max: 60, step: 1 };
  if (/fontSize|textSize/i.test(name)) return { min: 4, max: Math.max(72, v * 4), step: 1 };
  if (/lineWeight|strokeWeight/i.test(name)) return { min: 0, max: Math.max(10, v * 4), step: Number.isInteger(v) ? 0.5 : 0.1 };
  if (o.integer) {
    if (Math.abs(v) < 2) return { min: 0, max: 10, step: 1 };
    return v < 0 ? { min: v * 4, max: 0, step: 1 } : { min: looksLikeCount(name) || /^[A-Z_\d]+$/.test(name) ? 1 : 0, max: v * 4, step: 1 };
  }
  const a = Math.abs(v);
  if (a > 0 && a < 1) {
    const mag = Math.pow(10, Math.floor(Math.log10(a)));
    const step = Math.max(1e-5, mag / 100);
    const top = +(Math.ceil((a * 4) / mag) * mag).toPrecision(6);
    return v < 0 ? { min: -top, max: 0, step } : { min: 0, max: top, step };
  }
  const g = guessRange(v);
  return { min: g.min, max: g.max, step: g.step ?? 0.01 };
}

/** A value the code states outright: numbers, PI and friends, the sketch's own numeric constants, and arithmetic on them. */
function constValue(n: AstNode | null | undefined, consts: Map<string, number>): number | null {
  if (!n) return null;
  const direct = numberOf(n);
  if (direct !== null) return direct;
  if (n.type === 'Identifier') {
    const k: Record<string, number> = { PI: Math.PI, TWO_PI: Math.PI * 2, TAU: Math.PI * 2, HALF_PI: Math.PI / 2, QUARTER_PI: Math.PI / 4 };
    return k[n.name] ?? consts.get(n.name) ?? null;
  }
  if (n.type === 'UnaryExpression' && n.operator === '-') { const v = constValue(n.argument, consts); return v === null ? null : -v; }
  if (n.type === 'BinaryExpression') {
    const a = constValue(n.left, consts), b = constValue(n.right, consts);
    if (a === null || b === null) return null;
    switch (n.operator) { case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return b ? a / b : null; }
  }
  return null;
}

/** Edits applied from the end of the text back, so earlier offsets hold. */
function applyEdits(code: string, edits: { start: number; end: number; text: string }[]): string {
  let out = code;
  for (const e of [...edits].sort((a, b) => b.start - a.start || b.end - a.end)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

// ── Reading the project ──────────────────────────────────────────────────────

interface FileCtx { file: P5File; ast: AstNode; scopes: Scopes; tops: Map<string, AstNode> }

interface Project {
  files: FileCtx[];
  topNames: Set<string>;
  allNames: Set<string>;
  params: Set<string>;
  consts: Map<string, number>;
  failed: string[];
}

function readProject(files: P5File[]): Project {
  const out: Project = { files: [], topNames: new Set(), allNames: new Set(), params: new Set(), consts: new Map(), failed: [] };
  for (const f of files) {
    const p = parseCode(f.code);
    if (!p.ast) { out.failed.push(f.name); continue; }
    const scopes = new Scopes(p.ast);
    const tops = topLevelDeclarations(p.ast);
    for (const n of tops.keys()) out.topNames.add(n);
    for (const n of scopes.all) out.allNames.add(n);
    out.files.push({ file: f, ast: p.ast, scopes, tops });
    for (const st of p.ast.body as AstNode[]) {
      if (st.type !== 'VariableDeclaration') continue;
      for (const d of st.declarations) {
        const v = numberOf(d.init);
        if (d.id.type === 'Identifier' && v !== null) out.consts.set(d.id.name, v);
      }
    }
  }
  const main = files.find(f => f.name === P5_MAIN_FILE);
  for (const k of declaredParams(main?.code ?? '')) out.params.add(k);
  return out;
}

/** A name nothing else in the sketch (or p5) uses: `base`, else base2, base3… */
function uniqueName(base: string, taken: Set<string>): string {
  const clean = IDENT.test(base) ? base : 'value';
  let name = clean;
  for (let k = 2; taken.has(name) || RESERVED.has(name) || P5_TAKEN.has(name); k++) name = `${clean}${k}`;
  taken.add(name);
  return name;
}

// ── DOM controls ─────────────────────────────────────────────────────────────

const DOM_CREATORS: Record<string, { kind: P5ControlKind; suffix: RegExp; fallback: string }> = {
  createSlider: { kind: 'slider', suffix: /(Slider|Range)$/, fallback: 'slider' },
  createCheckbox: { kind: 'toggle', suffix: /(Checkbox|CheckBox|Check|Box|Toggle)$/, fallback: 'checkbox' },
  createSelect: { kind: 'choice', suffix: /(Select|Selector|Dropdown|Menu|Sel)$/, fallback: 'select' },
  createRadio: { kind: 'choice', suffix: /(Radio|Radios|Buttons)$/, fallback: 'radio' },
  createColorPicker: { kind: 'colour', suffix: /(ColorPicker|ColourPicker|Picker|Input)$/, fallback: 'colour' },
  createButton: { kind: 'button', suffix: /(Button|Btn)$/, fallback: 'button' },
};

/** A DOM control the import turned into a declared control. */
export interface P5DomControl { key: string; kind: P5ControlKind; creator: string; variable: string | null; file: string; line: number; restart?: boolean }

/** Element methods that take a callback: a control with one is read after setup, whatever the call graph says. */
const DOM_CALLBACKS = ['changed', 'input', 'mousePressed', 'mouseReleased', 'mouseClicked', 'mouseOver', 'mouseOut', 'mouseMoved'];

/**
 * The sketch with its DOM controls as declared controls: each create call
 * becomes `control('key')` (the assignment and later method calls stay), and
 * sketch.js's params gain an entry per control.
 */
export function mapDomControls(files: P5File[]): P5RewriteResult & { controls: P5DomControl[] } {
  const proj = readProject(files);
  const notes: string[] = [];
  const keysTaken = new Set<string>([...proj.params, ...proj.topNames]);
  const counters: Record<string, number> = {};
  const edits = new Map<string, { start: number; end: number; text: string }[]>();
  const entries: P5ParamEntry[] = [];
  const controls: P5DomControl[] = [];
  const startAt: Record<string, number> = {};
  const refs = collectRefs(proj);
  const isSetupOnly = setupOnlyFn(callGraph(proj));

  // Calls on a variable anywhere in the project: v.option('a'), v.selected('a').
  const methodCalls = (variable: string, method: string): AstNode[] => {
    const out: AstNode[] = [];
    for (const fc of proj.files) walk(fc.ast, n => {
      if (n.type !== 'CallExpression') return;
      const c = n.callee;
      if (c.type !== 'MemberExpression' || c.computed || c.property.name !== method) return;
      const o = c.object;
      if ((o.type === 'Identifier' && o.name === variable) || (o.type === 'MemberExpression' && !o.computed && o.property.name === variable)) out.push(n);
    });
    return out.sort((a, b) => a.start - b.start);
  };

  for (const fc of proj.files) {
    const name = fc.file.name;
    walk(fc.ast, (n, anc) => {
      if (n.type !== 'CallExpression') return;
      const c = calleeName(n);
      if (!c || !DOM_CREATORS[c.name]) return;
      if (c.object === null && (proj.topNames.has(c.name) || fc.scopes.localAt(c.name, anc))) return;
      if (c.object !== null && c.object !== 'p' && !fc.scopes.localAt(c.object, anc)) return;
      const spec = DOM_CREATORS[c.name];
      const line = n.loc?.start.line ?? 1;

      // What the element is stored in, through chained calls: `s = createSlider(…).position(…)`.
      let cur: AstNode = n, variable: string | null = null;
      for (let i = anc.length - 1; i >= 0; i--) {
        const a = anc[i];
        if ((a.type === 'MemberExpression' && a.object === cur) || (a.type === 'CallExpression' && a.callee === cur)) { cur = a; continue; }
        if (a.type === 'AssignmentExpression' && a.right === cur) variable = a.left.type === 'Identifier' ? a.left.name : a.left.type === 'MemberExpression' && !a.left.computed ? a.left.property.name : null;
        if (a.type === 'VariableDeclarator' && a.init === cur && a.id.type === 'Identifier') variable = a.id.name;
        break;
      }

      // The key: the variable without its Slider / Button… ending, unless that clashes.
      counters[spec.kind] = (counters[spec.kind] ?? 0) + 1;
      let key: string, labelKey: string;
      if (variable) {
        const stem = variable.replace(spec.suffix, '').replace(/^(slider|checkbox|select|radio|picker|button|btn)(?=[A-Z])/, '').replace(/^[A-Z]/, ch => ch.toLowerCase());
        const tryKey = stem && IDENT.test(stem) && !keysTaken.has(stem) && !RESERVED.has(stem) ? stem : variable;
        key = !keysTaken.has(tryKey) && !RESERVED.has(tryKey) ? tryKey : `${stem || variable}Control`;
        labelKey = stem || variable;
      } else key = `${spec.fallback}${counters[spec.kind]}`;
      key = uniqueName(key, keysTaken);
      labelKey = variable ? labelKey! : key;

      const args = n.arguments as AstNode[];
      const argNote = (what: string) => notes.push(`${name}:${line}: ${c.name}'s ${what} is worked out as the sketch runs; the control starts from a default. Check its range in the params.`);
      let entry: string, kind = spec.kind;
      if (c.name === 'createSlider') {
        const lo = constValue(args[0], proj.consts), hi = constValue(args[1], proj.consts);
        if (lo === null && args[0]) argNote('min');
        if (hi === null && args[1]) argNote('max');
        const min = lo ?? 0, max = hi ?? (lo !== null ? lo + 100 : 100);
        let step = args[3] ? constValue(args[3], proj.consts) : 1;
        if (step === null) { argNote('step'); step = 1; }
        if (step === 0) step = +((max - min) / 1000).toPrecision(3) || 0.001;
        let value = args[2] ? constValue(args[2], proj.consts) : null;
        if (value === null) {
          if (args[2]) argNote('starting value');
          value = min + (max - min) / 2;
        }
        // The page's slider snaps its value to the steps; so does the control.
        value = Math.min(max, Math.max(min, +(min + Math.round((value - min) / step) * step).toPrecision(10)));
        const lbl = labelFromKey(labelKey);
        entry = `${key}: { value: ${num(value)}, min: ${num(min)}, max: ${num(max)}, step: ${num(step)}, label: ${q(lbl)} }`;
        if (step === 1 && Number.isInteger(min)) kind = 'integer';
        startAt[key] = value;
      } else if (c.name === 'createCheckbox') {
        const label = stringOf(args[0])?.trim() || labelFromKey(labelKey);
        const on = args[1]?.type === 'Literal' ? !!args[1].value : false;
        if (args[1] && args[1].type !== 'Literal') argNote('checked state');
        entry = `${key}: { kind: 'toggle', value: ${on}, label: ${q(label)} }`;
        startAt[key] = on ? 1 : 0;
      } else if (c.name === 'createSelect' || c.name === 'createRadio') {
        const options: string[] = [];
        let selected: string | null = null;
        const optCalls = variable ? methodCalls(variable, 'option') : [];
        // Options chained straight on the call: createSelect().option('a')…
        for (let i = anc.length - 1; i >= 1; i--) {
          const a = anc[i], p = anc[i - 1];
          if (a.type === 'MemberExpression' && !a.computed && a.property.name === 'option' && p.type === 'CallExpression' && p.callee === a) optCalls.push(p);
          else if (a.type !== 'CallExpression' && a.type !== 'MemberExpression') break;
        }
        for (const oc of optCalls) {
          // Select: option(name, value) reads value; radio: option(value, label) reads value.
          const text = c.name === 'createSelect' ? (stringOf(oc.arguments[1]) ?? stringOf(oc.arguments[0]) ?? (numberOf(oc.arguments[1] ?? oc.arguments[0]) ?? '').toString()) : (stringOf(oc.arguments[0]) ?? (numberOf(oc.arguments[0]) ?? '').toString());
          if (text && !options.includes(text)) options.push(text);
          else if (!text) notes.push(`${name}:${oc.loc?.start.line ?? line}: an option worked out as the sketch runs was left out; add it to the options in params.`);
        }
        if (variable) for (const sc of methodCalls(variable, 'selected')) if (sc.arguments.length) selected ??= stringOf(sc.arguments[0]) ?? (numberOf(sc.arguments[0])?.toString() ?? null);
        if (!options.length) { options.push('one', 'two'); notes.push(`${name}:${line}: no options found for ${variable ?? c.name}; it has placeholder options, change them in params.`); }
        const value = selected && options.includes(selected) ? selected : options[0];
        entry = `${key}: { kind: 'choice', options: [${options.map(q).join(', ')}], value: ${q(value)}, label: ${q(labelFromKey(labelKey))} }`;
        startAt[key] = options.indexOf(value);
      } else if (c.name === 'createColorPicker') {
        let rgb: number[] | null = null;
        const s = stringOf(args[0]);
        if (s !== null) rgb = parseColourString(s);
        else if (args[0]?.type === 'CallExpression' && calleeName(args[0])?.name === 'color') {
          const vs = (args[0].arguments as AstNode[]).map(a => numberOf(a));
          if (vs.length && vs.every(v => v !== null)) rgb = vs.length < 3 ? [vs[0]!, vs[0]!, vs[0]!] : vs.slice(0, 3) as number[];
          else { const cs = stringOf(args[0].arguments[0]); if (cs) rgb = parseColourString(cs); }
        }
        if (!rgb && args[0]) argNote('colour');
        const hex = hexOf(rgb ?? [0, 0, 0]);
        entry = `${key}: { kind: 'colour', value: '${hex}', label: ${q(labelFromKey(labelKey))} }`;
        startAt[key] = packColour(rgb ?? [0, 0, 0]);
      } else {
        const label = stringOf(args[0])?.trim() || labelFromKey(labelKey);
        entry = `${key}: { kind: 'button', label: ${q(label)} }`;
      }

      // Read only before the sketch starts (a count in setup): moving it starts the sketch over.
      const rs = variable && proj.topNames.has(variable) ? refs.get(variable) ?? [] : [];
      const reads = new Set(variable ? ['value', 'checked', 'color', 'selected'].flatMap(m => methodCalls(variable, m)).filter(mc => !mc.arguments.length).map(mc => mc.callee.object.start as number) : []);
      const restart = kind !== 'button' && rs.some(r => reads.has(r.start)) && rs.every(r => isSetupOnly(r.ctx)) && !DOM_CALLBACKS.some(m => methodCalls(variable!, m).length);
      if (restart) entry = entry.replace(/ \}$/, ', restart: true }');

      const list = edits.get(name) ?? [];
      list.push({ start: n.start, end: n.end, text: `control('${key}')` });
      edits.set(name, list);
      entries.push({ key, kind, entry });
      controls.push({ key, kind, creator: c.name, variable, file: name, line, ...(restart ? { restart } : {}) });
    });
  }

  let out = files.map(f => ({ name: f.name, code: applyEdits(f.code, edits.get(f.name) ?? []) }));
  out = addEntries(out, entries.map(e => e.entry));
  for (const f of proj.failed) notes.push(`${f} has a syntax error, so its controls were not read.`);
  return { files: out, startAt, entries, notes, controls };
}

/** sketch.js with these params entries added (the params object created at its top when missing). */
function addEntries(files: P5File[], entries: string[]): P5File[] {
  if (!entries.length) return files;
  let list = files;
  if (!list.some(f => f.name === P5_MAIN_FILE)) list = [...list, { name: P5_MAIN_FILE, code: '' }];
  return list.map(f => {
    if (f.name !== P5_MAIN_FILE) return f;
    let code = f.code;
    for (const e of entries) code = addParamEntry(code, e);
    return { ...f, code };
  });
}

// ── Candidates ───────────────────────────────────────────────────────────────

const GOOD_NAME = /(speed|scale|count|size|radius|noise|num|amount|density|spacing|weight|alpha|rate|steps|len|length|gap|zoom|freq|amp|detail|particles|margin|thickness|octaves|jitter|blur|opacity|angle|rot|max|min|force|strength|damp|friction|gravity|decay|fade|trail|res|cols|rows|grid|cells|step)/i;
const COUNT_NAME = /^(n|num|count|rows|cols|columns|steps|segments|particles|points|res|resolution|octaves|layers|sides|detail|total|grid|cells|cell|agents|boids|balls|stars|dots|lines|circles|flakes|drops|walkers|seeds)([A-Z_\d]|$)/i;
const COLOUR_NAME = /(col|colour|color|bg|background|fill|stroke|tint|hue|palette|ink|paper|shade)/i;
const COLOUR_CALLS = new Set(['fill', 'stroke', 'background', 'tint', 'color', 'lerpColor', 'ambientLight', 'directionalLight', 'pointLight', 'ambientMaterial', 'specularMaterial', 'emissiveMaterial']);
const COLOUR_LITERAL_NAMES: Record<string, string> = { fill: 'fillColour', stroke: 'strokeColour', background: 'bgColour', tint: 'tintColour', color: 'colourValue' };
const MUTATORS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin']);

interface RefInfo { file: string; line: number; ctx: string; written: boolean; loopBound: boolean; colourUse: boolean; compared: string[]; assignedStrings: string[]; start: number; end: number }

/** Which top-level part of the sketch a node sits in: a function's name, `Class#method`, `top`, or `other`. */
function contextOf(anc: AstNode[], node: AstNode): string {
  const chain = [...anc, node];
  // Instance mode: p.setup = function () {…}
  for (let i = chain.length - 2; i >= 0; i--) {
    const a = chain[i];
    if (a.type === 'AssignmentExpression' && a.left.type === 'MemberExpression' && !a.left.computed && a.right === chain[i + 1] && isFunction(a.right)) {
      const nm = a.left.property.name;
      if (KP5_CALLBACKS.includes(nm)) return nm;
    }
  }
  const stmt = chain[1];
  if (!stmt || stmt === node) return 'top';
  const inFn = anc.slice(1).some(isFunction);
  if (stmt.type === 'FunctionDeclaration' && stmt.id) return stmt.id.name;
  if (stmt.type === 'ClassDeclaration' && stmt.id) {
    const method = chain.find(a => a.type === 'MethodDefinition' || a.type === 'PropertyDefinition');
    return `${stmt.id.name}#${method?.key?.name ?? 'field'}`;
  }
  if (stmt.type === 'VariableDeclaration' && inFn) {
    const d = (stmt.declarations as AstNode[]).find(x => chain.includes(x));
    if (d && d.id.type === 'Identifier' && (isFunction(d.init) || d.init?.type === 'ClassExpression')) return d.id.name;
  }
  return inFn ? 'other' : 'top';
}

interface Graph { reach: (roots: string[]) => Set<string>; contexts: Set<string> }

/** Which parts call which: calls to top-level functions, and `new Class` (to its constructor). */
function callGraph(proj: Project): Graph {
  const edges = new Map<string, Set<string>>();
  const contexts = new Set<string>();
  for (const fc of proj.files) walk(fc.ast, (n, anc) => {
    if ((n.type === 'CallExpression' || n.type === 'NewExpression') && n.callee.type === 'Identifier' && proj.topNames.has(n.callee.name) && !fc.scopes.localAt(n.callee.name, anc)) {
      const from = contextOf(anc, n);
      contexts.add(from);
      const to = n.type === 'NewExpression' ? `${n.callee.name}#constructor` : n.callee.name;
      const set = edges.get(from) ?? new Set<string>();
      set.add(to);
      edges.set(from, set);
    }
  });
  return {
    contexts,
    reach(roots) {
      const seen = new Set<string>(roots);
      const todo = [...roots];
      while (todo.length) for (const t of edges.get(todo.pop()!) ?? []) if (!seen.has(t)) { seen.add(t); todo.push(t); }
      return seen;
    },
  };
}

/** Is a part of the sketch only run before it starts? */
function setupOnlyFn(graph: Graph) {
  const early = graph.reach(['setup', 'preload']);
  const late = graph.reach(['draw', 'other', ...KP5_CALLBACKS.filter(c => c !== 'setup' && c !== 'preload')]);
  // Class methods other than the constructor run whenever they are called: treat them as late, and what they call too.
  const methods = [...graph.contexts].filter(c => c.includes('#') && !c.endsWith('#constructor'));
  for (const m of graph.reach(methods)) late.add(m);
  return (ctx: string) => ctx === 'top' || (early.has(ctx) && !late.has(ctx));
}

/** Every reference to a top-level name, with what it does there. */
function collectRefs(proj: Project): Map<string, RefInfo[]> {
  const refs = new Map<string, RefInfo[]>();
  for (const fc of proj.files) walk(fc.ast, (n, anc) => {
    const parent = anc[anc.length - 1];
    if (n.type !== 'Identifier' || !proj.topNames.has(n.name) || !isReference(n, parent, fc.scopes.bindings) || fc.scopes.localAt(n.name, anc)) return;
    const gp = anc[anc.length - 2];
    const info: RefInfo = { file: fc.file.name, line: n.loc?.start.line ?? 1, ctx: contextOf(anc, n), written: false, loopBound: false, colourUse: false, compared: [], assignedStrings: [], start: n.start, end: n.end };
    if (parent?.type === 'AssignmentExpression' && parent.left === n) {
      info.written = true;
      const s = stringOf(parent.right);
      if (s !== null) info.assignedStrings.push(s);
    }
    if (parent?.type === 'UpdateExpression') info.written = true;
    if (parent?.type === 'MemberExpression' && parent.object === n) {
      if ((gp?.type === 'AssignmentExpression' && gp.left === parent) || gp?.type === 'UpdateExpression') info.written = true;
      if (gp?.type === 'CallExpression' && gp.callee === parent && !parent.computed && MUTATORS.has(parent.property.name)) info.written = true;
    }
    if (parent?.type === 'BinaryExpression' && /^[<>]=?$/.test(parent.operator) && gp?.type === 'ForStatement' && gp.test === parent) info.loopBound = true;
    if (parent?.type === 'CallExpression' && parent.arguments.includes(n)) {
      const c = calleeName(parent);
      if (c && COLOUR_CALLS.has(c.name)) info.colourUse = true;
    }
    if (parent?.type === 'SpreadElement' && gp?.type === 'CallExpression') {
      const c = calleeName(gp);
      if (c && COLOUR_CALLS.has(c.name)) info.colourUse = true;
    }
    if (parent?.type === 'BinaryExpression' && /^[!=]==?$/.test(parent.operator)) {
      const other = parent.left === n ? parent.right : parent.left;
      const s = stringOf(other);
      if (s !== null) info.compared.push(s);
    }
    if (parent?.type === 'SwitchStatement' && parent.discriminant === n) {
      for (const c of parent.cases) { const s = stringOf(c.test); if (s !== null) info.compared.push(s); }
    }
    const list = refs.get(n.name) ?? [];
    list.push(info);
    refs.set(n.name, list);
  });
  return refs;
}

const uniqRefs = (refs: { file: string; line: number }[]): P5Ref[] => {
  const out: P5Ref[] = [];
  for (const r of refs) if (!out.some(o => o.file === r.file && o.line === r.line)) out.push({ file: r.file, line: r.line });
  return out;
};

export interface P5CandidateOptions {
  /** Keep top-level values nothing reads (candidateAt uses this). */
  keepUnused?: boolean;
  /** Colour numbers are not RGB (colorMode HSB / HSL): no colour literals. From the analysis; worked out when not given. */
  colourModeNotRgb?: boolean;
}

/** The values in the sketch worth a control, best first. Values already in params are left out. */
export function findControlCandidates(files: P5File[], opts: P5CandidateOptions = {}): P5Candidate[] {
  const proj = readProject(files);
  const refs = collectRefs(proj);
  const graph = callGraph(proj);
  const isSetupOnly = setupOnlyFn(graph);
  const drawReach = graph.reach(['draw']);
  const taken = new Set<string>([...proj.allNames, ...proj.params]);
  const out: P5Candidate[] = [];
  let hsb = opts.colourModeNotRgb ?? false;
  if (opts.colourModeNotRgb === undefined) {
    for (const fc of proj.files) walk(fc.ast, n => {
      if (n.type === 'CallExpression' && calleeName(n)?.name === 'colorMode') {
        const a = n.arguments[0];
        const nm = a?.type === 'Identifier' ? a.name : a?.type === 'MemberExpression' ? a.property?.name : '';
        if (nm === 'HSB' || nm === 'HSL') hsb = true;
      }
    });
  }
  const perFrame = (ctx: string) => drawReach.has(ctx) || (ctx.includes('#') && !ctx.endsWith('#constructor')) || ctx === 'other';

  // Top-level variables set to a plain value.
  for (const fc of proj.files) {
    const code = fc.file.code;
    for (const st of fc.ast.body as AstNode[]) {
      if (st.type !== 'VariableDeclaration') continue;
      for (const d of st.declarations as AstNode[]) {
        if (d.id.type !== 'Identifier' || !d.init) continue;
        const name: string = d.id.name;
        if (name === 'params' || proj.params.has(name)) continue;
        const init = d.init;
        const nv = numberOf(init);
        const s = stringOf(init);
        let value: P5Candidate['value'] | null = null;
        let kind: P5Candidate['kind'] | null = null;
        const rs = refs.get(name) ?? [];
        if (nv !== null) { value = nv; kind = 'slider'; }
        else if (init.type === 'Literal' && typeof init.value === 'boolean') { value = init.value; kind = 'toggle'; }
        else if (s !== null && parseColourString(s)) { value = s; kind = 'colour'; }
        else if (s !== null) {
          const options = [s];
          for (const r of rs) for (const o of [...r.compared, ...r.assignedStrings]) if (!options.includes(o)) options.push(o);
          if (options.length < 2) continue;
          value = s; kind = 'choice';
        } else if (init.type === 'ArrayExpression' && (init.elements.length === 3 || init.elements.length === 4)) {
          const vs = (init.elements as AstNode[]).map(e => numberOf(e));
          if (vs.every(v => v !== null && v >= 0 && v <= 255)) { value = vs as number[]; kind = 'colour'; }
        }
        if (value === null || kind === null) continue;
        if (!rs.length && !opts.keepUnused) continue;

        const state = rs.some(r => r.written);
        const setupOnly = rs.length > 0 && rs.every(r => isSetupOnly(r.ctx));
        const colourUse = rs.some(r => r.colourUse);
        if (kind === 'colour' && Array.isArray(value) && !colourUse && !COLOUR_NAME.test(name)) continue;
        const allCaps = /^[A-Z][A-Z\d_]*$/.test(name);
        let options: string[] | undefined;
        if (kind === 'choice') {
          options = [value as string];
          for (const r of rs) for (const o of [...r.compared, ...r.assignedStrings]) if (!options.includes(o)) options.push(o);
        }
        let range: P5Range | undefined;
        if (typeof value === 'number') {
          const integer = Number.isInteger(value) && (rs.some(r => r.loopBound) || COUNT_NAME.test(name) || looksLikeCount(name) || (allCaps && Math.abs(value) >= 2));
          if (integer) kind = 'integer';
          range = rangeFor(value, { integer, name });
        }

        let score = 50;
        const notes: string[] = [];
        if (rs.some(r => perFrame(r.ctx))) { score += 20; notes.push('read every frame'); }
        if (GOOD_NAME.test(name)) score += 20;
        if (allCaps) score += 15;
        if (st.kind === 'const') score += 5;
        if (name.length <= 1 && !allCaps) score -= 15;
        if (setupOnly) { score -= 10; notes.push('read in setup, so changing it restarts the sketch'); }
        if (typeof value === 'number' && (value === 0 || value === 1)) score -= 10;
        if (kind === 'colour') score += colourUse ? 10 : 0;
        if (kind === 'choice') score += 10;
        if (!rs.length) score -= 40;
        if (state) { score = Math.min(score, 0) - 50; notes.unshift('changes as the sketch runs: state, not a good control'); }

        const loc = d.id.loc!.start;
        out.push({
          id: `var:${fc.file.name}:${name}`, source: 'variable', file: fc.file.name, line: loc.line, column: loc.column + 1,
          start: d.id.start, end: d.id.end, name, value, kind, range, options,
          uses: uniqRefs(rs), state, setupOnly, score, note: notes.join('; ') || 'a top-level value',
          sites: [{ start: init.start, end: init.end }], declKeyword: st.kind, declStart: st.start, text: code.slice(init.start, init.end),
          refRanges: rs.map(r => ({ file: r.file, start: r.start, end: r.end })),
        });
        taken.add(name);
      }
    }
  }

  // Literals in the sketch's functions: colours, sizes, noise scales, speeds.
  const lits: P5Candidate[] = [];
  const addLit = (fc: FileCtx, ctx: string, sites: AstNode[], base: string, value: P5Candidate['value'], kind: P5Candidate['kind'], score: number, note: string, extra: Partial<P5Candidate> = {}) => {
    const first = sites[0];
    const setupOnly = isSetupOnly(ctx);
    let s = score;
    if (typeof value === 'number' && (value === 0 || value === 1)) s -= 20;
    if (perFrame(ctx)) s += 5;
    const integer = kind === 'integer';
    lits.push({
      id: `lit:${fc.file.name}:${first.start}`, source: 'literal', file: fc.file.name, line: first.loc?.start.line ?? 1, column: (first.loc?.start.column ?? 0) + 1,
      start: first.start, end: sites[sites.length - 1].end, name: base, value, kind,
      range: typeof value === 'number' ? rangeFor(value, { integer, name: base }) : undefined,
      uses: uniqRefs(sites.map(n => ({ file: fc.file.name, line: n.loc?.start.line ?? 1 }))), state: false, setupOnly,
      score: s, note: setupOnly ? `${note}; in setup, so changing it restarts the sketch` : note,
      sites: sites.map(n => ({ start: n.start, end: n.end })), text: fc.file.code.slice(first.start, first.end), ...extra,
    });
  };
  const inTop = (ctx: string) => ctx === 'top';

  for (const fc of proj.files) {
    const code = fc.file.code;
    const noiseGroups = new Map<AstNode, AstNode[]>();
    walk(fc.ast, (n, anc) => {
      // Not inside the params object.
      if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.id.name === 'params') return false;
      if (n.type === 'CallExpression') {
        const c = calleeName(n);
        if (!c) return;
        if (c.object === null && (proj.topNames.has(c.name) || fc.scopes.localAt(c.name, anc))) return;
        const ctx = contextOf(anc, n);
        if (inTop(ctx)) return;
        const args = n.arguments as AstNode[];
        const nums = args.map(a => numberOf(a));
        if (COLOUR_LITERAL_NAMES[c.name] && c.name !== 'color' && args.length) {
          const s = args.length === 1 ? stringOf(args[0]) : null;
          if (s !== null && parseColourString(s)) {
            addLit(fc, ctx, [args[0]], COLOUR_LITERAL_NAMES[c.name], s, 'colour', 35, `the colour in ${c.name}()`);
          } else if (!hsb && nums.every(v => v !== null) && args.length <= 4) {
            const rgbArgs = args.length <= 2 ? [args[0]] : args.slice(0, 3);
            const rgb = args.length <= 2 ? [nums[0]!, nums[0]!, nums[0]!] : nums.slice(0, 3) as number[];
            if (rgb.every(v => v >= 0 && v <= 255)) {
              const alpha = args.length === 2 ? args[1] : args.length === 4 ? args[3] : null;
              const site = { start: rgbArgs[0].start, end: rgbArgs[rgbArgs.length - 1].end, spread: !!alpha };
              addLit(fc, ctx, rgbArgs, COLOUR_LITERAL_NAMES[c.name], rgb, 'colour', args.length === 1 ? 25 : 35, `the colour in ${c.name}()`, {
                sites: [site], start: site.start, end: site.end,
                text: `[${rgb.join(', ')}]`,
              });
              if (alpha) addLit(fc, ctx, [alpha], `${COLOUR_LITERAL_NAMES[c.name].replace(/Colour$/, '')}Alpha`, numberOf(alpha)!, 'slider', 30, `the alpha in ${c.name}()`);
            }
          }
          return;
        }
        const one = (i: number, base: string, score: number, note: string, integer = false) => {
          if (nums[i] === null || nums[i] === undefined) return;
          addLit(fc, ctx, [args[i]], base, nums[i]!, integer && Number.isInteger(nums[i]) ? 'integer' : 'slider', score, note);
        };
        switch (c.name) {
          case 'strokeWeight': one(0, 'lineWeight', 30, 'the line weight'); break;
          case 'textSize': one(0, 'fontSize', 30, 'the text size'); break;
          case 'frameRate': one(0, 'fps', 20, 'the frame rate', true); break;
          case 'noiseDetail': one(0, 'octaves', 30, 'the noise detail', true); break;
          case 'circle': one(2, 'circleSize', 25, 'the circle size'); break;
          case 'square': one(2, 'squareSize', 25, 'the square size'); break;
          case 'ellipse':
            if (args.length === 3 || (nums[2] !== null && nums[2] === nums[3])) { one(2, 'ellipseSize', 25, 'the ellipse size'); if (args.length > 3 && nums[3] !== null) { /* same value: one control for both */ const last = lits[lits.length - 1]; if (last && last.start === args[2].start) { last.sites.push({ start: args[3].start, end: args[3].end }); last.end = args[3].end; } } }
            else { one(2, 'ellipseWidth', 25, 'the ellipse width'); one(3, 'ellipseHeight', 25, 'the ellipse height'); }
            break;
          case 'rect': one(2, 'rectWidth', 25, 'the rectangle width'); one(3, 'rectHeight', 25, 'the rectangle height'); break;
          case 'sphere': one(0, 'sphereSize', 25, 'the sphere size'); break;
          case 'box': one(0, 'boxSize', 25, 'the box size'); break;
        }
        return;
      }
      if (n.type === 'BinaryExpression' && n.operator === '*') {
        const ctx = contextOf(anc, n);
        if (inTop(ctx)) return;
        const litSide = numberOf(n.right) !== null ? n.right : numberOf(n.left) !== null ? n.left : null;
        if (!litSide) return;
        const other = litSide === n.right ? n.left : n.right;
        const v = numberOf(litSide)!;
        if (!v) return;
        const timeLike = (other.type === 'Identifier' && (other.name === 'frameCount' || other.name === 't' || other.name === 'time'))
          || (other.type === 'CallExpression' && calleeName(other)?.name === 'millis');
        if (timeLike) { addLit(fc, ctx, [litSide], 'speed', v, 'slider', 40, 'how fast it moves'); return; }
        // Inside noise(…): a noise scale; equal ones in one call share a control.
        const noiseCall = [...anc].reverse().find(a => a.type === 'CallExpression' && calleeName(a)?.name === 'noise');
        if (noiseCall && !Number.isInteger(v)) {
          const group = noiseGroups.get(noiseCall) ?? [];
          group.push(litSide);
          noiseGroups.set(noiseCall, group);
          if (group.length === 1) addLit(fc, ctx, [litSide], 'noiseScale', v, 'slider', 45, 'how zoomed-in the noise is');
          else {
            const same = lits.find(l => l.file === fc.file.name && l.sites.some(s => s.start === group[0].start));
            if (same && same.value === v) { same.sites.push({ start: litSide.start, end: litSide.end }); }
            else addLit(fc, ctx, [litSide], 'noiseScale', v, 'slider', 45, 'how zoomed-in the noise is');
          }
        }
        return;
      }
      if (n.type === 'ForStatement' && n.test?.type === 'BinaryExpression' && /^[<>]=?$/.test(n.test.operator)) {
        const ctx = contextOf(anc, n);
        if (inTop(ctx)) return;
        const v = numberOf(n.test.right);
        if (v !== null && Number.isInteger(v) && v >= 2) addLit(fc, ctx, [n.test.right], 'count', v, 'integer', 5, 'a loop count');
      }
      return;
    });
    void code;
  }

  // Names that clash with nothing, in the order the code has them.
  for (const l of lits.sort((a, b) => a.file.localeCompare(b.file) || a.start - b.start)) {
    l.name = uniqueName(l.name, taken);
    out.push(l);
  }
  return out.sort((a, b) => b.score - a.score);
}

/** The ids of the best few candidates to start with ticked: three to six, never state. */
export function suggestControls(candidates: P5Candidate[], o: { min?: number; max?: number } = {}): string[] {
  const min = o.min ?? 3, max = o.max ?? 6;
  const ok = candidates.filter(c => !c.state && c.score > 0).sort((a, b) => b.score - a.score);
  const good = ok.filter(c => c.score >= 40).slice(0, max);
  for (const c of ok) { if (good.length >= min) break; if (!good.includes(c)) good.push(c); }
  return good.map(c => c.id);
}

// ── Making controls ──────────────────────────────────────────────────────────

/** The params entry for a control. */
function entryFor(key: string, kind: P5ControlKind, value: P5Candidate['value'], o: { label: string; range?: P5Range; options?: string[]; restart?: boolean }): string {
  const restart = o.restart ? ', restart: true' : '';
  const label = `label: ${q(o.label)}`;
  switch (kind) {
    case 'toggle': return `${key}: { kind: 'toggle', value: ${!!value}, ${label}${restart} }`;
    case 'button': return `${key}: { kind: 'button', ${label} }`;
    case 'colour': {
      const v = Array.isArray(value) ? `[${value.map(num).join(', ')}]` : `'${typeof value === 'string' ? (parseColourString(value) ? hexOf(parseColourString(value)!) : value) : '#000000'}'`;
      return `${key}: { kind: 'colour', value: ${v}, ${label}${restart} }`;
    }
    case 'choice': return `${key}: { kind: 'choice', options: [${(o.options ?? []).map(q).join(', ')}], value: ${q(String(value))}, ${label}${restart} }`;
    default: {
      const v = typeof value === 'number' ? value : 0;
      const r = o.range ?? rangeFor(v, { integer: kind === 'integer' });
      const step = kind === 'integer' ? 1 : r.step;
      return `${key}: { value: ${num(v)}, min: ${num(Math.min(r.min, v))}, max: ${num(Math.max(r.max, v))}, step: ${num(step)}, ${label}${restart} }`;
    }
  }
}

function startValue(kind: P5ControlKind, value: P5Candidate['value'], options?: string[]): number {
  if (kind === 'toggle') return value ? 1 : 0;
  if (kind === 'colour') return packColour(Array.isArray(value) ? value : parseColourString(String(value)) ?? [0, 0, 0]);
  if (kind === 'choice') return Math.max(0, (options ?? []).indexOf(String(value)));
  return typeof value === 'number' ? value : 0;
}

/** Where new top-level `let`s go in a file: above its first function or class (and the comments on it), or above the statement they are read in. */
function hoistPoint(code: string, ast: AstNode, siteStart: number): number {
  let at = code.length;
  for (const st of ast.body as AstNode[]) {
    const fnLike = st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration'
      || (st.type === 'VariableDeclaration' && st.declarations.some((d: AstNode) => isFunction(d.init) || d.init?.type === 'ClassExpression'))
      || (st.start <= siteStart && siteStart < st.end);
    if (fnLike) { at = st.start; break; }
  }
  at = code.lastIndexOf('\n', at - 1) + 1;
  // Keep the comment above it with it.
  while (at > 0) {
    const prev = code.lastIndexOf('\n', at - 2) + 1;
    if (!/^[ \t]*(\/\/|\/\*|\*)/.test(code.slice(prev, at - 1))) break;
    at = prev;
  }
  return at;
}

/**
 * The sketch with the chosen candidates as controls. A top-level variable
 * keeps its name as the key and becomes `let`; a literal moves to a new
 * top-level `let` (in the file it is used in) that the code now reads. The
 * entries go in sketch.js's params. Values read only in setup get
 * `restart: true`.
 */
export function applyControls(files: P5File[], chosen: P5ChosenControl[], candidates: P5Candidate[]): P5RewriteResult {
  const proj = readProject(files);
  const taken = new Set<string>([...proj.allNames, ...proj.params]);
  const byId = new Map(candidates.map(c => [c.id, c]));
  const edits = new Map<string, { start: number; end: number; text: string }[]>();
  const hoists = new Map<string, { at: number; lines: string[] }[]>();
  const entries: P5ParamEntry[] = [];
  const startAt: Record<string, number> = {};
  const notes: string[] = [];
  const edit = (file: string, e: { start: number; end: number; text: string }) => { const l = edits.get(file) ?? []; l.push(e); edits.set(file, l); };

  for (const ch of chosen) {
    const c = byId.get(ch.id);
    if (!c) { notes.push(`No value ${ch.id} in the sketch any more; skipped.`); continue; }
    const fc = proj.files.find(f => f.file.name === c.file);
    if (!fc) { notes.push(`${c.file} does not parse, so ${c.name} stays as it is.`); continue; }
    let kind: P5ControlKind = c.kind;
    if (ch.kind && ((c.kind === 'slider' || c.kind === 'integer') && (ch.kind === 'slider' || ch.kind === 'integer'))) kind = ch.kind;
    let key: string;
    if (c.source === 'variable') {
      key = c.name;
      if (proj.params.has(key)) { notes.push(`${key} is already a control.`); continue; }
      if (c.declKeyword === 'const' && c.declStart !== undefined) edit(c.file, { start: c.declStart, end: c.declStart + 5, text: 'let' });
    } else {
      const want = ch.key?.trim();
      key = want && want !== c.name && IDENT.test(want) ? uniqueName(want, taken) : c.name;
      taken.add(key);
      for (const s of c.sites) edit(c.file, { start: s.start, end: s.end, text: s.spread ? `...${key}` : key });
      const at = hoistPoint(fc.file.code, fc.ast, c.sites[0].start);
      const list = hoists.get(c.file) ?? [];
      const slot = list.find(h => h.at === at) ?? (list.push({ at, lines: [] }), list[list.length - 1]);
      slot.lines.push(`let ${key} = ${c.text};`);
      hoists.set(c.file, list);
    }
    const range = typeof c.value === 'number'
      ? { min: ch.min ?? c.range?.min ?? 0, max: ch.max ?? c.range?.max ?? 1, step: kind === 'integer' ? 1 : ch.step ?? c.range?.step ?? 0.01 }
      : undefined;
    let options = kind === 'choice' ? (ch.options?.length ? [...ch.options] : [...(c.options ?? [])]) : undefined;
    if (options && !options.includes(String(c.value))) options = [String(c.value), ...options];
    const entry = entryFor(key, kind, c.value, { label: ch.label?.trim() || labelFromKey(key), range, options, restart: c.setupOnly });
    entries.push({ key, kind, entry });
    startAt[key] = startValue(kind, c.value, options);
  }

  let out = files.map(f => {
    const list = [...(edits.get(f.name) ?? [])];
    for (const h of hoists.get(f.name) ?? []) list.push({ start: h.at, end: h.at, text: `${h.lines.join('\n')}\n\n` });
    return { name: f.name, code: applyEdits(f.code, list) };
  });
  out = addEntries(out, entries.map(e => e.entry));
  return { files: out, startAt, entries, notes };
}

// ── The editor's click ───────────────────────────────────────────────────────

/** The candidate at an offset in a file: a top-level variable (at its declaration or any read of it), or a literal. Null when there is none. */
export function candidateAt(files: P5File[], fileName: string, offset: number): P5Candidate | null {
  const cands = findControlCandidates(files, { keepUnused: true });
  const inside = (s: { start: number; end: number }) => offset >= s.start && offset <= s.end;
  const hit = cands.find(c => c.file === fileName && (c.source === 'literal' ? c.sites.some(inside) : inside(c) || inside(c.sites[0])))
    ?? cands.find(c => c.source === 'variable' && c.refRanges?.some(r => r.file === fileName && inside(r)));
  if (hit) return hit;

  // Any other literal: a number, a boolean or a '#hex' string, somewhere in a function.
  const proj = readProject(files);
  const fc = proj.files.find(f => f.file.name === fileName);
  if (!fc) return null;
  let best: { node: AstNode; anc: AstNode[] } | null = null;
  walk(fc.ast, (n, anc) => {
    if (n.start > offset || n.end < offset) return false;
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.id.name === 'params') return false;
    const isLit = numberOf(n) !== null || (n.type === 'Literal' && typeof n.value === 'boolean') || (stringOf(n) !== null && !!parseColourString(stringOf(n)!));
    if (isLit && (!best || n.end - n.start <= best.node.end - best.node.start)) best = { node: n, anc: [...anc] };
    return true;
  });
  if (!best) return null;
  const { node, anc } = best as { node: AstNode; anc: AstNode[] };
  // A plain literal of a top-level declaration belongs to its variable (a declared param, or not worth a control).
  const parent = anc[anc.length - 1];
  if (parent?.type === 'VariableDeclarator' && anc.length === 3) return null;
  const ctx = contextOf(anc, node);
  const taken = new Set<string>([...proj.allNames, ...proj.params]);
  let base = 'value';
  if (parent?.type === 'CallExpression') { const c = calleeName(parent); if (c) base = `${c.name}Value`; }
  else if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier') base = `${parent.id.name}Value`;
  else if (parent?.type === 'AssignmentExpression' && parent.left.type === 'Identifier') base = `${parent.left.name}Value`;
  else if (parent?.type === 'BinaryExpression') { const o = parent.left === node ? parent.right : parent.left; if (o.type === 'Identifier') base = `${o.name}Amount`; }
  const n = numberOf(node);
  const s = stringOf(node);
  const value: P5Candidate['value'] = n !== null ? n : s !== null ? s : !!node.value;
  const kind: P5Candidate['kind'] = n !== null ? (Number.isInteger(n) && Math.abs(n) >= 2 ? 'integer' : 'slider') : s !== null ? 'colour' : 'toggle';
  const setupOnly = setupOnlyFn(callGraph(proj))(ctx);
  const line = lineAt(fc.file.code, node.start);
  return {
    id: `lit:${fileName}:${node.start}`, source: 'literal', file: fileName, line, column: (node.loc?.start.column ?? 0) + 1,
    start: node.start, end: node.end, name: uniqueName(base, taken), value, kind,
    range: n !== null ? rangeFor(n, { integer: kind === 'integer', name: base }) : undefined,
    uses: [{ file: fileName, line }], state: false, setupOnly, score: 0, note: 'a value written in the code',
    sites: [{ start: node.start, end: node.end }], text: fc.file.code.slice(node.start, node.end),
  };
}

/** A value as code: number, boolean, string or array. */
function literalText(v: number | boolean | string | number[]): string {
  if (Array.isArray(v)) return `[${v.map(num).join(', ')}]`;
  if (typeof v === 'number') return num(v);
  if (typeof v === 'boolean') return `${v}`;
  return q(v);
}

/**
 * "Turn back into a plain value": the control `key` leaves params (the whole
 * params object goes when it empties) and its variable is set to the value
 * the control had. A colour or choice given as a number (packed 0xRRGGBB, an
 * option's index) is written as the control wrote it (hex or [r, g, b], the
 * option's text).
 */
export function unmakeControl(files: P5File[], key: string, currentValue: number | boolean | string | number[]): P5File[] {
  const main = files.find(f => f.name === P5_MAIN_FILE);
  if (!main) return files;
  const parsed = parseCode(main.code);
  if (!parsed.ast) return files;
  let entryText = '';
  let mainCode = main.code;
  walk(parsed.ast, n => {
    if (entryText || n.type !== 'VariableDeclaration') return;
    const d = (n.declarations as AstNode[]).find(x => x.id.type === 'Identifier' && x.id.name === 'params' && x.init?.type === 'ObjectExpression');
    if (!d) return;
    const props = d.init.properties as AstNode[];
    const i = props.findIndex(p => p.type === 'Property' && ((p.key.type === 'Identifier' && p.key.name === key) || p.key.value === key));
    if (i < 0) return false;
    const p = props[i];
    entryText = main.code.slice(p.start, p.end);
    if (props.length === 1) {
      // The params object goes, with the blank line after it.
      let s = n.start, e = n.end;
      while (/[ \t]/.test(main.code[e] ?? '')) e++;
      if (main.code[e] === ';') e++;
      while (/[ \t]/.test(main.code[e] ?? '')) e++;
      while (main.code[e] === '\n' || main.code[e] === '\r') e++;
      s = main.code.lastIndexOf('\n', s - 1) + 1;
      mainCode = main.code.slice(0, s) + main.code.slice(e);
      return false;
    }
    let s = p.start, e = p.end;
    const lineStart = main.code.lastIndexOf('\n', s - 1) + 1;
    let j = e;
    while (/[ \t]/.test(main.code[j] ?? '')) j++;
    if (main.code[j] === ',') { j++; e = j; }
    else if (i > 0) {
      // The last entry: drop the comma before it instead.
      let k = s - 1;
      while (k > 0 && /\s/.test(main.code[k])) k--;
      if (main.code[k] === ',') s = k;
    }
    let lineEnd = e;
    while (/[ \t]/.test(main.code[lineEnd] ?? '')) lineEnd++;
    if (/^\/\/[^\n]*/.test(main.code.slice(lineEnd))) lineEnd += /^\/\/[^\n]*/.exec(main.code.slice(lineEnd))![0].length;
    if (!main.code.slice(lineStart, p.start).trim() && (main.code[lineEnd] === '\n' || lineEnd >= main.code.length) && s === p.start) { s = lineStart; e = Math.min(main.code.length, lineEnd + 1); }
    mainCode = main.code.slice(0, s) + main.code.slice(e);
    return false;
  });
  if (!entryText) return files;

  // The value as the control wrote it.
  let value = currentValue;
  if (/kind:\s*'colour'/.test(entryText) && typeof value === 'number') {
    const rgb = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
    value = /value:\s*\[/.test(entryText) ? rgb : hexOf(rgb);
  } else if (/kind:\s*'colour'/.test(entryText) && typeof value === 'string' && /value:\s*\[/.test(entryText)) {
    value = parseColourString(value) ?? value;
  } else if (/kind:\s*'choice'/.test(entryText) && typeof value === 'number') {
    const opts = /options:\s*\[([^\]]*)\]/.exec(entryText)?.[1].match(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)?.map(x => x.slice(1, -1)) ?? [];
    value = opts[Math.round(value)] ?? opts[0] ?? '';
  } else if (/kind:\s*'toggle'/.test(entryText) && typeof value === 'number') value = value >= 0.5;
  else if (/kind:\s*'button'/.test(entryText)) value = undefined as never;

  let out = files.map(f => (f.name === P5_MAIN_FILE ? { ...f, code: mainCode } : f));
  if (value === undefined) return out;
  // The variable's initialiser, in whichever file declares it.
  out = out.map(f => {
    const p = parseCode(f.code);
    if (!p.ast) return f;
    for (const st of p.ast.body as AstNode[]) {
      if (st.type !== 'VariableDeclaration') continue;
      for (const d of st.declarations as AstNode[]) {
        if (!patternIds(d.id).some(id => id.name === key) || d.id.type !== 'Identifier') continue;
        const text = literalText(value);
        return d.init
          ? { ...f, code: f.code.slice(0, d.init.start) + text + f.code.slice(d.init.end) }
          : { ...f, code: f.code.slice(0, d.id.end) + ` = ${text}` + f.code.slice(d.id.end) };
      }
    }
    return f;
  });
  return out;
}

/** Keys of the sketch's params object (sketch.js). */
export function paramKeys(files: P5File[]): string[] {
  const main = files.find(f => f.name === P5_MAIN_FILE);
  return main && paramsBlock(main.code) ? declaredParams(main.code) : [];
}
