/**
 * Guided Convert, the staged shader (docs/guided-convert.md, "The data model"): the shader rewritten
 * so the automatic converter makes exactly the cut the steps chose. Converted statements stay in
 * main() as written; every run of statements not converted yet (and every "One function" step)
 * becomes a helper function that main() calls, taking and returning exactly the values that cross
 * the cut. The text inside is the shader's own, so the staged shader computes what the original does.
 *
 * A helper opened as a group is staged the same way, its body for main(): converted statements as
 * written, runs not converted yet wrapped (the run holding its `return` gives the helper's value
 * back). A recognised pattern a step turns into a library node is cut out as a call to a one-line
 * function of its parts (recognise.ts), which the converter makes the recipe's nodes.
 */
import type { Analysis, Ast, HelperFn, Unit } from './analyse';
import { freshName } from './analyse';
import { recognise, type Recognition } from './recognise';

export type ConvertMode = 'nodes' | 'blocks' | 'function';
export type ChipChoice = 'slider' | 'input' | 'fixed';
/** A recognised pattern as its library node(s), or as one plain Expression Block. */
export type RecognisedChoice = 'node' | 'block';

export interface ConvertStep {
  kind: 'convert'; id: string;
  /** The statements it converts: of main(), or of the body of `fn`. */
  units: number[];
  mode: ConvertMode;
  /** What the step is called (the function's name in One function mode, the strip's label). */
  name: string;
  /** Number chips by LiteralSite id; a number not listed takes its default. */
  chips: Record<string, ChipChoice>;
  /** The helper (opened as a group) whose body these statements are; absent for main(). */
  fn?: string;
  /** Recognised patterns (Nodes mode) by Recognition id: a library node, or a plain block. One not listed is converted as written. */
  recognised?: Record<string, RecognisedChoice>;
}
export interface GroupStep {
  kind: 'group'; id: string;
  name: string;
  /** The convert steps whose nodes go in it. */
  members: string[];
  /** Sliders not shown on the group card, as stable keys (see build.ts `stableKeys`). */
  hidden: string[];
}
/** A helper opened as a group: every converted call of it is a copy of the group, its body converted inside step by step. */
export interface HelperStep {
  kind: 'helper'; id: string;
  fn: string;
  name: string;
  /** Statements of main() that call it, converted (as Nodes) with this step, so the group shows where it is used. */
  callers: number[];
}
export type Step = ConvertStep | GroupStep | HelperStep;

/** The value a run takes or gives back. */
export interface RunPort { name: string; type: string }
/** One wrapped run: remainder lines, or a One function step. */
export interface Run {
  /** `rest:<first unit>` (`rest:<fn>/<first unit>` in a helper) for remainder, else the step's id. */
  owner: string;
  fn: string;
  units: number[];
  /** The helper whose body it is part of (absent: main()). */
  scope?: string;
  inputs: RunPort[];
  outputs: RunPort[];
  /** Number chips that became parameters: the name main() declares and passes, its value and how it is offered. */
  chipParams: { name: string; value: number; choice: ChipChoice; chip: string }[];
}
/** A recognised pattern cut out as a call: the one-line function's name, the pattern, how, and the step. */
export interface CutCall { fn: string; rec: Recognition; choice: RecognisedChoice; owner: string }

export interface Staged {
  code: string;
  /** Owner of each top-level statement of the staged main(), in order: a step id, `rest:<unit>` or `setup`. */
  stmtOwner: string[];
  runs: Run[];
  /** unit index → owner (step id, `rest:<first unit of its run>`, or `setup`). */
  unitOwner: Map<number, string>;
  /** The local that holds the colour when a run touches gl_FragColor (null when none does). */
  colour: string | null;
  /** Helpers opened as groups. */
  opened: Set<string>;
  /** Per opened helper: the owner of each top-level statement of its staged body. */
  helperStmtOwner: Map<string, string[]>;
  /** Per opened helper: unit index → owner. */
  helperUnitOwner: Map<string, Map<number, string>>;
  /** Recognised patterns cut out as calls. */
  calls: CutCall[];
}

const VECS = new Set(['float', 'vec2', 'vec3', 'vec4']);
const zeroOf = (t: string) => (t === 'float' ? '0.0' : t === 'int' ? '0' : `${t}(0.0)`);
const fmtNum = (v: number) => { const s = String(v); return /[.eE]/.test(s) ? s : `${s}.0`; };

/** The default a number chip takes in a mode. */
export function defaultChip(mode: ConvertMode, fixedByDefault: boolean): ChipChoice {
  return mode === 'function' ? (fixedByDefault ? 'fixed' : 'slider') : 'slider';
}

/** Helpers opened as groups, in the order they were opened. */
export function openedHelpers(steps: readonly Step[]): Set<string> {
  return new Set(steps.filter((s): s is HelperStep => s.kind === 'helper').map(s => s.fn));
}

/** Owner of each unit of main() under the steps: setup, a convert step (or a helper step, for the callers it converts), or the remainder. */
export function unitOwners(a: Analysis, steps: readonly Step[]): Map<number, string> {
  const owner = new Map<number, string>();
  for (const u of a.units) if (u.setup) owner.set(u.index, 'setup');
  for (const s of steps) {
    if (s.kind === 'convert' && !s.fn) for (const i of s.units) if (!owner.has(i)) owner.set(i, s.id);
    if (s.kind === 'helper') for (const i of s.callers) if (!owner.has(i)) owner.set(i, s.id);
  }
  return owner;
}

/** Owner of each statement of an opened helper's body: the convert step that took it. */
export function helperOwners(steps: readonly Step[], fn: string): Map<number, string> {
  const owner = new Map<number, string>();
  for (const s of steps) if (s.kind === 'convert' && s.fn === fn) for (const i of s.units) if (!owner.has(i)) owner.set(i, s.id);
  return owner;
}

class CutError extends Error {}

/** The staged shader for these steps, or why the cut can't be made. */
export function stage(a: Analysis, steps: readonly Step[]): Staged | { error: string } {
  try { return stageOrThrow(a, steps); } catch (e) { if (e instanceof CutError) return { error: e.message }; throw e; }
}

interface Ctx {
  a: Analysis;
  taken: Set<string>;
  stepById: Map<string, ConvertStep | HelperStep>;
  opened: Set<string>;
  runs: Run[];
  calls: CutCall[];
}
interface ScopeIn {
  /** The helper (absent: main()). */
  helper?: HelperFn;
  units: Unit[];
  owners: Map<number, string>;
  localTypes: Map<string, string>;
  /** Names that hold a value before the first statement (a helper's parameters). */
  initial: Map<string, string>;
}
interface ScopeOut { fnText: string[]; body: { text: string; owner: string; parts?: number }[]; colour: string | null; unitOwner: Map<number, string> }

function stageOrThrow(a: Analysis, steps: readonly Step[]): Staged {
  const opened = openedHelpers(steps);
  for (const fn of opened) {
    const h = a.helpers.find(x => x.name === fn);
    if (!h) throw new CutError(`There is no function ${fn}() in this shader.`);
    if (h.openable !== true) throw new CutError(`${fn}() can’t open as a group: ${h.openable}. It stays one Custom Function.`);
  }
  const ctx: Ctx = {
    a, taken: new Set(a.names), opened, runs: [], calls: [],
    stepById: new Map(steps.filter((s): s is ConvertStep | HelperStep => s.kind === 'convert' || s.kind === 'helper').map(s => [s.id, s])),
  };

  // Opened helpers first (their names are taken first), then main().
  const edits: { from: number; to: number; text: string }[] = [];
  const helperStmtOwner = new Map<string, string[]>();
  const helperUnitOwner = new Map<string, Map<number, string>>();
  for (const fn of opened) {
    const h = a.helpers.find(x => x.name === fn)!;
    const out = stageScope(ctx, { helper: h, units: h.units, owners: helperOwners(steps, fn), localTypes: new Map(h.localTypes), initial: new Map(h.params.map(p => [p.name, p.type])) });
    const text = `${[...out.fnText, ''].join('\n\n')}${h.header}{\n${out.body.map(b => `  ${b.text}`).join('\n')}\n}`;
    edits.push({ from: h.start, to: h.end, text });
    helperStmtOwner.set(fn, out.body.flatMap(b => Array<string>(b.parts ?? 1).fill(b.owner)));
    helperUnitOwner.set(fn, out.unitOwner);
  }
  const main = stageScope(ctx, { units: a.units, owners: unitOwners(a, steps), localTypes: new Map(a.localTypes), initial: new Map() });
  edits.push({ from: a.mainStart, to: a.mainEnd, text: `${main.fnText.join('\n\n')}${main.fnText.length ? '\n\n' : ''}void main() {\n${main.body.map(b => `  ${b.text}`).join('\n')}\n}` });
  let code = a.norm;
  for (const e of edits.sort((x, y) => y.from - x.from)) code = code.slice(0, e.from) + e.text + code.slice(e.to);
  return {
    code, stmtOwner: main.body.flatMap(b => Array<string>(b.parts ?? 1).fill(b.owner)), runs: ctx.runs, unitOwner: main.unitOwner, colour: main.colour,
    opened, helperStmtOwner, helperUnitOwner, calls: ctx.calls,
  };
}

/** One scope (main() or an opened helper's body) staged: the functions it needs, and its new body. */
function stageScope(ctx: Ctx, sc: ScopeIn): ScopeOut {
  const { a, stepById } = ctx;
  const h = sc.helper;
  const modeOf = (owner: string): ConvertMode | 'rest' | 'setup' => {
    if (owner === 'setup') return 'setup';
    const s = stepById.get(owner);
    return !s ? 'rest' : s.kind === 'helper' ? 'nodes' : s.mode;
  };
  const restKey = h ? `rest:${h.name}/` : 'rest:';

  // Segments: units in order, a run of remainder units (or of one function step's units) wrapped together.
  type Seg = { kind: 'inline'; unit: Unit; owner: string } | { kind: 'wrap'; units: Unit[]; owner: string };
  const segs: Seg[] = [];
  for (const u of sc.units) {
    const own = sc.owners.get(u.index) ?? 'rest';
    const mode = modeOf(own);
    if (mode === 'rest' || mode === 'function') {
      const key = mode === 'rest' ? 'rest' : own;
      const last = segs[segs.length - 1];
      if (last?.kind === 'wrap' && (last.owner === key || (key === 'rest' && last.owner.startsWith(restKey)))) { last.units.push(u); continue; }
      segs.push({ kind: 'wrap', units: [u], owner: key === 'rest' ? `${restKey}${u.index}` : key });
    } else segs.push({ kind: 'inline', unit: u, owner: own });
  }

  // The colour (main only): a local when a wrapped run touches gl_FragColor, written to gl_FragColor once at the end.
  const touchesColour = !h && segs.some(s => s.kind === 'wrap' && s.units.some(u => u.uses.has('gl_FragColor') || u.writes.has('gl_FragColor')));
  const colour = touchesColour ? freshName('color_', ctx.taken) : null;
  const ren = (text: string) => (colour ? text.replace(/\bgl_FragColor\b/g, colour) : text);

  const localTypes = new Map([...sc.initial, ...sc.localTypes]);
  if (colour) localTypes.set(colour, 'vec4');
  const usesOf = (u: Unit) => { const s = new Set(u.uses); if (colour && s.has('gl_FragColor')) s.add(colour); return s; };
  const writesOf = (u: Unit) => { const s = new Set(u.writes); if (colour && s.has('gl_FragColor')) s.add(colour); return s; };
  // Uniforms (time, resolution, mouse, the shader's own) and vUv go in as parameters, so the remainder's node
  // is wired to the same Time / Resolution sources a converted node would be.
  const passIn = (name: string) => name === 'vUv' || (a.uniforms.has(name) && !/^sampler/.test(a.uniforms.get(name)!));
  const passType = (name: string) => (name === 'vUv' ? 'vec2' : a.uniforms.get(name)!);

  const fnText: string[] = [];
  const body: ScopeOut['body'] = [];
  if (colour) body.push({ text: `vec4 ${colour} = vec4(0.0);`, owner: 'setup' });

  /** A unit's text with edits: numbers named (chips), hoisted declarations turned into assignments, recognised patterns cut out. */
  const edited = (u: Unit, numberNames: Map<number, string>, hoisted: ReadonlySet<string>, cuts: { rec: Recognition; fn: string }[] = []): string => {
    const lits = u.literals.filter(l => numberNames.has(l.at)).map(l => ({ from: l.at, to: l.at + l.raw.length, text: numberNames.get(l.at)! }));
    const apply = (from: number, to: number, list: { from: number; to: number; text: string }[]) => {
      let text = a.norm.slice(from, to);
      for (const e of list.filter(x => x.from >= from && x.to <= to).sort((x, y) => y.from - x.from)) text = text.slice(0, e.from - from) + e.text + text.slice(e.to - from);
      return text;
    };
    const edits: { from: number; to: number; text: string }[] = [];
    for (const c of cuts) {
      const args = c.rec.args.map(s => ('text' in s ? s.text : apply(s.from, s.to, lits)));
      edits.push({ from: c.rec.start, to: c.rec.end, text: `${c.rec.assign ? `${c.rec.assign} = ` : ''}${c.fn}(${args.join(', ')})` });
    }
    edits.push(...lits.filter(e => !cuts.some(c => e.from >= c.rec.start && e.to <= c.rec.end)));
    if (hoisted.size && u.ast.type === 'declaration_statement') {
      const decl = u.ast.declaration as Ast;
      const spec = (decl.specified_type as Ast).location as { start: { offset: number }; end: { offset: number } };
      const typeText = a.norm.slice(spec.start.offset, spec.end.offset).trim();
      const ds = (decl.declarations as Ast[]) ?? [];
      ds.forEach((d, k) => {
        const name = (d.identifier as Ast).identifier as string;
        const dStart = ((d.identifier as Ast).location as { start: { offset: number } }).start.offset;
        if (k === 0) { if (hoisted.has(name)) edits.push({ from: spec.start.offset, to: dStart, text: '' }); return; }
        // The comma before this declarator ends the previous statement.
        const comma = a.norm.lastIndexOf(',', dStart);
        edits.push({ from: comma, to: comma + 1, text: hoisted.has(name) ? ';' : `; ${typeText}` });
      });
    }
    return ren(apply(u.start, u.end, edits));
  };

  segs.forEach(seg => {
    if (seg.kind === 'inline') {
      const step = stepById.get(seg.owner);
      const convert = step?.kind === 'convert' ? step : null;
      // Recognised patterns the step turns into library nodes (or blocks): cut out as calls.
      const cuts: { rec: Recognition; fn: string }[] = [];
      if (convert?.recognised && convert.mode === 'nodes') {
        const chosen = recognise(a, seg.unit, ctx.opened).filter(r => convert.recognised![r.id]);
        for (const rec of chosen) {
          const fn = freshName(`rc_${rec.kind}`, ctx.taken);
          fnText.push(`${rec.ret} ${fn}(${rec.params.map(p => `in ${p.type} ${p.name}`).join(', ')}) {\n  return ${rec.body};\n}`);
          cuts.push({ rec, fn });
          ctx.calls.push({ fn, rec, choice: convert.recognised[rec.id], owner: seg.owner });
        }
      }
      // Fixed numbers (Nodes / Expression): named, so the converter puts them on the Constants card, fixed.
      const names = new Map<number, string>();
      if (convert) for (const lit of seg.unit.literals) {
        if ((convert.chips[lit.id] ?? defaultChip(convert.mode, lit.fixedByDefault)) !== 'fixed') continue;
        if (cuts.some(c => c.rec.swallowed.includes(lit.id))) continue; // the node took its place
        names.set(lit.at, lit.name);
        body.push({ text: `float ${lit.name} = ${fmtNum(lit.value)};`, owner: seg.owner });
      }
      body.push({ text: edited(seg.unit, names, new Set(), cuts), owner: seg.owner, parts: seg.unit.parts });
      return;
    }
    const units = seg.units;
    const first = units[0].index, last = units[units.length - 1].index;
    const lines = `${units[0].lines[0]}–${Math.max(...units.map(u => u.lines[1]))}`;
    const before = new Set<string>(sc.initial.keys());
    for (const u of sc.units) if (u.index < first) for (const d of u.decls) before.add(d.name);
    if (colour) before.add(colour);
    const declaredIn = new Set(units.flatMap(u => u.decls.map(d => d.name)));
    const used = new Set(units.flatMap(u => [...usesOf(u)]));
    const written = new Set(units.flatMap(u => [...writesOf(u)]));
    const usedAfter = new Set<string>();
    for (const u of sc.units) if (u.index > last) for (const n of usesOf(u)) usedAfter.add(n);
    if (colour) usedAfter.add(colour); // gl_FragColor = color_ at the end
    const typeOf = (n: string) => localTypes.get(n) ?? a.uniforms.get(n) ?? 'float';

    const outputs: RunPort[] = [];
    const inputs: RunPort[] = [];
    for (const n of before) {
      const t = typeOf(n);
      if (written.has(n) && usedAfter.has(n)) outputs.push({ name: n, type: t });
      else if (used.has(n)) inputs.push({ name: n, type: t });
    }
    for (const n of declaredIn) if (usedAfter.has(n) && !before.has(n)) outputs.push({ name: n, type: typeOf(n) });
    for (const n of [...used].sort()) if (passIn(n) && !before.has(n)) inputs.push({ name: n, type: passType(n) });

    const step = stepById.get(seg.owner);
    const stepName = step?.kind === 'convert' ? step.name : undefined;
    const where = seg.owner.startsWith('rest:') ? `lines ${lines}` : `“${stepName ?? 'this step'}”`;
    for (const p of inputs) if (!VECS.has(p.type) && p.type !== 'int') throw new CutError(`Can’t cut here: ${p.name} (a ${p.type}) would have to go into ${where}. Take the lines that make ${p.name} together with the ones that use it.`);
    for (const p of outputs) if (!VECS.has(p.type)) throw new CutError(`Can’t cut here: ${p.name} (a ${p.type}) comes out of ${where} and is used later. Take the lines that use ${p.name} too.`);
    for (const n of declaredIn) if (usedAfter.has(n) && units.some(u => u.decls.some(d => d.name === n && d.array))) throw new CutError(`Can’t cut here: the array ${n} comes out of ${where}. Take the lines that use it too.`);

    // Chips of a One function step: named parameters the body declares (a slider or an input on the node).
    const chipParams: Run['chipParams'] = [];
    const names = new Map<number, string>();
    if (step?.kind === 'convert') for (const u of units) for (const lit of u.literals) {
      const choice = step.chips[lit.id] ?? defaultChip(step.mode, lit.fixedByDefault);
      if (choice === 'fixed') continue;
      names.set(lit.at, lit.name);
      chipParams.push({ name: lit.name, value: lit.value, choice, chip: lit.id });
    }

    const fnBase = stepName ?? (h ? `${h.name}_rest` : 'rest');
    const fn = freshName(fnBase.replace(/\s+(\w)/g, (_m, c: string) => c.toUpperCase()).replace(/[^A-Za-z0-9_]/g, '') || 'step', ctx.taken);
    const params = [...inputs.map(p => `in ${p.type} ${p.name}`), ...chipParams.map(c => `in float ${c.name}`)];
    const args = [...inputs.map(p => p.name), ...chipParams.map(c => c.name)];
    for (const c of chipParams) body.push({ text: `float ${c.name} = ${fmtNum(c.value)};`, owner: seg.owner });
    const run: Run = { owner: seg.owner, fn, units: units.map(u => u.index), ...(h ? { scope: h.name } : {}), inputs, outputs, chipParams };

    if (h && units.some(u => u.ast.type === 'return_statement')) {
      // The run that ends the helper: a function giving back the helper's value.
      fnText.push(`${h.ret} ${fn}(${params.join(', ')}) {\n  ${units.map(u => edited(u, names, new Set())).join('\n  ')}\n}`);
      body.push({ text: `return ${fn}(${args.join(', ')});`, owner: seg.owner });
      ctx.runs.push(run);
      return;
    }
    if (outputs.length === 0) {
      if (units.some(u => u.hasDiscard)) throw new CutError(`Can’t cut here: ${where} only discards pixels. Take it together with the lines before or after it.`);
      if ([...written].some(n => a.globals.has(n))) {
        // It only changes globals (a palette filled in main): called for that.
        fnText.push(`void ${fn}(${params.join(', ')}) {\n  ${units.map(u => edited(u, names, new Set())).join('\n  ')}\n}`);
        body.push({ text: `${fn}(${args.join(', ')});`, owner: seg.owner });
      }
      // Otherwise nothing it makes is read later: it can't change the picture, so it goes.
      ctx.runs.push(run);
      return;
    }
    if (outputs.length === 1 && !units.some(u => u.hasReturn)) {
      const out = outputs[0];
      const inner = units.map(u => edited(u, names, new Set())).join('\n  ');
      // A value from before that the run reads comes in; one it only sets is a local of the function.
      const ins = before.has(out.name) && used.has(out.name) ? [`in ${out.type} ${out.name}`] : [];
      const local = before.has(out.name) && !used.has(out.name) ? `${out.type} ${out.name} = ${zeroOf(out.type)};\n  ` : '';
      fnText.push(`${out.type} ${fn}(${[...ins, ...params].join(', ')}) {\n  ${local}${inner}\n  return ${out.name};\n}`);
      const call = `${fn}(${[...(ins.length ? [out.name] : []), ...args].join(', ')})`;
      body.push({ text: before.has(out.name) ? `${out.name} = ${call};` : `${out.type} ${out.name} = ${call};`, owner: seg.owner });
    } else {
      const hoisted = new Set(outputs.filter(p => !before.has(p.name)).map(p => p.name));
      const inner = units.map(u => edited(u, names, hoisted)).join('\n  ');
      const outParams = outputs.map(p => `${hoisted.has(p.name) || !used.has(p.name) ? 'out' : 'inout'} ${p.type} ${p.name}`);
      fnText.push(`void ${fn}(${[...params, ...outParams].join(', ')}) {\n  ${inner}\n}`);
      for (const p of outputs) if (hoisted.has(p.name)) body.push({ text: `${p.type} ${p.name} = ${zeroOf(p.type)};`, owner: seg.owner });
      body.push({ text: `${fn}(${[...args, ...outputs.map(p => p.name)].join(', ')});`, owner: seg.owner });
    }
    ctx.runs.push(run);
  });
  if (colour) body.push({ text: `gl_FragColor = ${colour};`, owner: 'setup' });

  const unitOwner = new Map<number, string>();
  for (const s of segs) {
    if (s.kind === 'inline') unitOwner.set(s.unit.index, s.owner);
    else for (const u of s.units) unitOwner.set(u.index, s.owner);
  }
  return { fnText, body, colour, unitOwner };
}
