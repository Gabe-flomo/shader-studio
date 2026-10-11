/**
 * Guided Convert, the staged shader (docs/guided-convert.md, "The data model"): the shader rewritten
 * so the automatic converter makes exactly the cut the steps chose. Converted statements stay in
 * main() as written; every run of statements not converted yet (and every "One function" step)
 * becomes a helper function that main() calls, taking and returning exactly the values that cross
 * the cut. The text inside is the shader's own, so the staged shader computes what the original does.
 */
import type { Analysis, Ast, Unit } from './analyse';
import { freshName } from './analyse';

export type ConvertMode = 'nodes' | 'blocks' | 'function';
export type ChipChoice = 'slider' | 'input' | 'fixed';

export interface ConvertStep {
  kind: 'convert'; id: string;
  units: number[];
  mode: ConvertMode;
  /** What the step is called (the function's name in One function mode, the strip's label). */
  name: string;
  /** Number chips by LiteralSite id; a number not listed takes its default. */
  chips: Record<string, ChipChoice>;
}
export interface GroupStep {
  kind: 'group'; id: string;
  name: string;
  /** The convert steps whose nodes go in it. */
  members: string[];
  /** Sliders not shown on the group card, as stable keys (see build.ts `stableKeys`). */
  hidden: string[];
}
export type Step = ConvertStep | GroupStep;

/** The value a run takes or gives back. */
export interface RunPort { name: string; type: string }
/** One wrapped run: remainder lines, or a One function step. */
export interface Run {
  /** `rest:<first unit>` for remainder, else the step's id. */
  owner: string;
  fn: string;
  units: number[];
  inputs: RunPort[];
  outputs: RunPort[];
  /** Number chips that became parameters: the name main() declares and passes, its value and how it is offered. */
  chipParams: { name: string; value: number; choice: ChipChoice; chip: string }[];
}

export interface Staged {
  code: string;
  /** Owner of each top-level statement of the staged main(), in order: a step id, `rest:<unit>` or `setup`. */
  stmtOwner: string[];
  runs: Run[];
  /** unit index → owner (step id, `rest:<first unit of its run>`, or `setup`). */
  unitOwner: Map<number, string>;
  /** The local that holds the colour when a run touches gl_FragColor (null when none does). */
  colour: string | null;
}

const VECS = new Set(['float', 'vec2', 'vec3', 'vec4']);
const zeroOf = (t: string) => (t === 'float' ? '0.0' : t === 'int' ? '0' : `${t}(0.0)`);
const fmtNum = (v: number) => { const s = String(v); return /[.eE]/.test(s) ? s : `${s}.0`; };

/** The default a number chip takes in a mode. */
export function defaultChip(mode: ConvertMode, fixedByDefault: boolean): ChipChoice {
  return mode === 'function' ? (fixedByDefault ? 'fixed' : 'slider') : 'slider';
}

/** Owner of each unit under the steps: setup, a convert step, or the remainder. */
export function unitOwners(a: Analysis, steps: readonly Step[]): Map<number, string> {
  const owner = new Map<number, string>();
  for (const u of a.units) if (u.setup) owner.set(u.index, 'setup');
  for (const s of steps) if (s.kind === 'convert') for (const i of s.units) if (!owner.has(i)) owner.set(i, s.id);
  return owner;
}

class CutError extends Error {}

/** The staged shader for these steps, or why the cut can't be made. */
export function stage(a: Analysis, steps: readonly Step[]): Staged | { error: string } {
  try { return stageOrThrow(a, steps); } catch (e) { if (e instanceof CutError) return { error: e.message }; throw e; }
}

function stageOrThrow(a: Analysis, steps: readonly Step[]): Staged {
  const owners = unitOwners(a, steps);
  const stepById = new Map(steps.filter((s): s is ConvertStep => s.kind === 'convert').map(s => [s.id, s]));
  const modeOf = (owner: string): ConvertMode | 'rest' | 'setup' => (owner === 'setup' ? 'setup' : stepById.get(owner)?.mode ?? 'rest');
  const taken = new Set(a.names);
  const fnNames = new Set<string>();

  // Segments: units in order, a run of remainder units (or of one function step's units) wrapped together.
  type Seg = { kind: 'inline'; unit: Unit; owner: string } | { kind: 'wrap'; units: Unit[]; owner: string };
  const segs: Seg[] = [];
  for (const u of a.units) {
    const own = owners.get(u.index) ?? `rest`;
    const mode = modeOf(own);
    if (mode === 'rest' || mode === 'function') {
      const key = mode === 'rest' ? 'rest' : own;
      const last = segs[segs.length - 1];
      if (last?.kind === 'wrap' && (last.owner === key || (key === 'rest' && last.owner.startsWith('rest:')))) { last.units.push(u); continue; }
      segs.push({ kind: 'wrap', units: [u], owner: key === 'rest' ? `rest:${u.index}` : key });
    } else segs.push({ kind: 'inline', unit: u, owner: own });
  }

  // The colour: a local when a wrapped run touches gl_FragColor, written to gl_FragColor once at the end.
  const touchesColour = segs.some(s => s.kind === 'wrap' && s.units.some(u => u.uses.has('gl_FragColor') || u.writes.has('gl_FragColor')));
  const colour = touchesColour ? freshName('color_', taken) : null;
  const ren = (text: string) => (colour ? text.replace(/\bgl_FragColor\b/g, colour) : text);

  const localTypes = new Map(a.localTypes);
  if (colour) localTypes.set(colour, 'vec4');
  const usesOf = (u: Unit) => { const s = new Set(u.uses); if (colour && s.has('gl_FragColor')) s.add(colour); return s; };
  const writesOf = (u: Unit) => { const s = new Set(u.writes); if (colour && s.has('gl_FragColor')) s.add(colour); return s; };
  // Uniforms (time, resolution, mouse, the shader's own) and vUv go in as parameters, so the remainder's node
  // is wired to the same Time / Resolution sources a converted node would be.
  const passIn = (name: string) => name === 'vUv' || (a.uniforms.has(name) && !/^sampler/.test(a.uniforms.get(name)!));
  const passType = (name: string) => (name === 'vUv' ? 'vec2' : a.uniforms.get(name)!);

  const fnText: string[] = [];
  const body: { text: string; owner: string; parts?: number }[] = [];
  const runs: Run[] = [];
  if (colour) body.push({ text: `vec4 ${colour} = vec4(0.0);`, owner: 'setup' });

  /** A unit's text with edits: numbers named (chips), hoisted declarations turned into assignments. */
  const edited = (u: Unit, numberNames: Map<number, string>, hoisted: ReadonlySet<string>): string => {
    const edits: { from: number; to: number; text: string }[] = [];
    for (const lit of u.literals) { const n = numberNames.get(lit.at); if (n) edits.push({ from: lit.at, to: lit.at + lit.raw.length, text: n }); }
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
    edits.sort((x, y) => y.from - x.from);
    let text = a.norm.slice(u.start, u.end);
    for (const e of edits) text = text.slice(0, e.from - u.start) + e.text + text.slice(e.to - u.start);
    return ren(text);
  };

  segs.forEach(seg => {
    if (seg.kind === 'inline') {
      // Fixed numbers (Nodes / Expression): named, so the converter puts them on the Constants card, fixed.
      const step = stepById.get(seg.owner);
      const names = new Map<number, string>();
      if (step) for (const lit of seg.unit.literals) {
        if ((step.chips[lit.id] ?? defaultChip(step.mode, lit.fixedByDefault)) !== 'fixed') continue;
        names.set(lit.at, lit.name);
        body.push({ text: `float ${lit.name} = ${fmtNum(lit.value)};`, owner: seg.owner });
      }
      body.push({ text: edited(seg.unit, names, new Set()), owner: seg.owner, parts: seg.unit.parts });
      return;
    }
    const units = seg.units;
    const first = units[0].index, last = units[units.length - 1].index;
    const lines = `${units[0].lines[0]}–${Math.max(...units.map(u => u.lines[1]))}`;
    const before = new Set<string>();
    for (const u of a.units) if (u.index < first) for (const d of u.decls) before.add(d.name);
    if (colour) before.add(colour);
    const declaredIn = new Set(units.flatMap(u => u.decls.map(d => d.name)));
    const used = new Set(units.flatMap(u => [...usesOf(u)]));
    const written = new Set(units.flatMap(u => [...writesOf(u)]));
    const usedAfter = new Set<string>();
    for (const u of a.units) if (u.index > last) for (const n of usesOf(u)) usedAfter.add(n);
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

    const where = seg.owner.startsWith('rest:') ? `lines ${lines}` : `“${stepById.get(seg.owner)?.name ?? 'this step'}”`;
    for (const p of inputs) if (!VECS.has(p.type) && p.type !== 'int') throw new CutError(`Can’t cut here: ${p.name} (a ${p.type}) would have to go into ${where}. Take the lines that make ${p.name} together with the ones that use it.`);
    for (const p of outputs) if (!VECS.has(p.type)) throw new CutError(`Can’t cut here: ${p.name} (a ${p.type}) comes out of ${where} and is used later. Take the lines that use ${p.name} too.`);
    for (const n of declaredIn) if (usedAfter.has(n) && units.some(u => u.decls.some(d => d.name === n && d.array))) throw new CutError(`Can’t cut here: the array ${n} comes out of ${where}. Take the lines that use it too.`);

    // Chips of a One function step: named parameters main() declares (a slider or an input on the node).
    const step = stepById.get(seg.owner);
    const chipParams: Run['chipParams'] = [];
    const names = new Map<number, string>();
    if (step) for (const u of units) for (const lit of u.literals) {
      const choice = step.chips[lit.id] ?? defaultChip(step.mode, lit.fixedByDefault);
      if (choice === 'fixed') continue;
      names.set(lit.at, lit.name);
      chipParams.push({ name: lit.name, value: lit.value, choice, chip: lit.id });
    }

    const fnBase = step ? step.name : 'rest';
    const fn = freshName(fnBase.replace(/\s+(\w)/g, (_m, c: string) => c.toUpperCase()).replace(/[^A-Za-z0-9_]/g, '') || 'step', new Set([...taken, ...fnNames]));
    fnNames.add(fn); taken.add(fn);
    const params = [...inputs.map(p => `in ${p.type} ${p.name}`), ...chipParams.map(c => `in float ${c.name}`)];
    const args = [...inputs.map(p => p.name), ...chipParams.map(c => c.name)];
    for (const c of chipParams) body.push({ text: `float ${c.name} = ${fmtNum(c.value)};`, owner: seg.owner });

    if (outputs.length === 0) {
      if (units.some(u => u.hasDiscard)) throw new CutError(`Can’t cut here: ${where} only discards pixels. Take it together with the lines before or after it.`);
      if ([...written].some(n => a.globals.has(n))) {
        // It only changes globals (a palette filled in main): called for that.
        fnText.push(`void ${fn}(${params.join(', ')}) {\n  ${units.map(u => edited(u, names, new Set())).join('\n  ')}\n}`);
        body.push({ text: `${fn}(${args.join(', ')});`, owner: seg.owner });
      }
      // Otherwise nothing it makes is read later: it can't change the picture, so it goes.
      runs.push({ owner: seg.owner, fn, units: units.map(u => u.index), inputs, outputs, chipParams });
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
    runs.push({ owner: seg.owner, fn, units: units.map(u => u.index), inputs, outputs, chipParams });
  });
  if (colour) body.push({ text: `gl_FragColor = ${colour};`, owner: 'setup' });

  const unitOwner = new Map<number, string>();
  for (const s of segs) {
    if (s.kind === 'inline') unitOwner.set(s.unit.index, s.owner);
    else for (const u of s.units) unitOwner.set(u.index, s.owner);
  }
  const head = a.norm.slice(0, a.mainStart);
  const tail = a.norm.slice(a.mainEnd);
  const code = `${head}${fnText.join('\n\n')}${fnText.length ? '\n\n' : ''}void main() {\n${body.map(b => `  ${b.text}`).join('\n')}\n}${tail}`;
  return { code, stmtOwner: body.flatMap(b => Array<string>(b.parts ?? 1).fill(b.owner)), runs, unitOwner, colour };
}
