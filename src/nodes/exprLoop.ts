/**
 * Loop mode for an Expression Block (docs/expression-block.md, "Loop").
 *
 * A block with `params.loop.on` runs its lines N times. Its parts, top to bottom:
 *
 *   inputs (and `t`, the scratch `p`)          declared once, as always
 *   Before the loop  (`loop.before`)           run once: start values for what the loop updates
 *   the looped lines (`params.lines`)          run N times; i, fi, n, k are there
 *   Break when       (`loop.breakWhen`)        a bool: true stops the loop after that pass
 *   After the loop   (`loop.after`)            run once, before Return
 *
 * Every variable lives in the block's scope, so it carries from one pass to the next: an input
 * or a Before line's variable keeps what the last pass left in it. A looped line that declares a
 * variable (`float d = …`) is hoisted: declared once before the loop (zero), assigned each pass,
 * and readable after it (After, Return, Also outputs).
 *
 * Iterations (`params.loopN`) is a live slider: the loop is compiled to Max iterations
 * (`loop.max`, 128 by default) and stops at a uniform, so dragging it is a uniform write. Only a
 * new Max recompiles. A count above Max is clamped to Max.
 *
 * The shader, the card's code page and Copy as code all come from `loopCode` below, so they
 * cannot drift: Copy as code is a real GLSL `for` loop.
 */

export interface ExprLoopLine { lhs: string; op?: string; rhs: string; off?: boolean }

export interface ExprLoop {
  on: boolean;
  /** Max iterations: the compiled bound. 128 when unset. */
  max?: number;
  /** Run once before the loop. */
  before?: ExprLoopLine[];
  /** Run once after the loop, before Return. */
  after?: ExprLoopLine[];
  /** A bool expression checked at the end of each pass: true stops the loop. */
  breakWhen?: string;
}

export const LOOP_MAX_DEFAULT = 128;
/** The highest Max iterations the settings take (a bigger loop is a GPU hang waiting to happen). */
export const LOOP_MAX_CAP = 1024;
export const LOOP_N_DEFAULT = 8;
/** The names the loop gives its lines. */
export const LOOP_VARS: ReadonlyArray<{ name: string; type: string; doc: string }> = [
  { name: 'i', type: 'int', doc: 'The pass, 0 at the first.' },
  { name: 'fi', type: 'float', doc: 'The pass as a float: float(i).' },
  { name: 'n', type: 'float', doc: 'How many passes run (Iterations), as a float. After the loop too.' },
  { name: 'k', type: 'float', doc: 'How far through the loop: 0 at the first pass, 1 at the last (i / (n − 1); 0 when n is 1).' },
];
export const LOOP_VAR_NAMES: ReadonlySet<string> = new Set(LOOP_VARS.map(v => v.name));

const DECL = /^\s*(float|int|bool|vec[234]|mat[234])\s+([A-Za-z_]\w*)\s*$/;

const zeroOf = (t: string) => (t === 'float' ? '0.0' : t === 'int' ? '0' : t === 'bool' ? 'false' : `${t}(0.0)`);

/** The block's loop settings when Loop is on, else null. */
export function loopOf(params: Record<string, unknown>): ExprLoop | null {
  const l = params.loop as ExprLoop | undefined;
  return l && typeof l === 'object' && l.on ? l : null;
}

/** Max iterations, a whole number in 1…LOOP_MAX_CAP. */
export function loopMax(loop: ExprLoop | null | undefined): number {
  const m = typeof loop?.max === 'number' && Number.isFinite(loop.max) ? Math.round(loop.max) : LOOP_MAX_DEFAULT;
  return Math.max(1, Math.min(LOOP_MAX_CAP, m));
}

/** Iterations now (a number; the slider's value), not yet clamped. */
export function loopCountValue(params: Record<string, unknown>): number {
  return typeof params.loopN === 'number' && Number.isFinite(params.loopN) ? params.loopN : LOOP_N_DEFAULT;
}

/** Iterations as a whole number in 0…max. */
export function clampCount(n: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(n)));
}

const usable = (l: ExprLoopLine | undefined): l is ExprLoopLine => !!l && !!l.lhs?.trim() && !!l.rhs?.trim();

/** Names the block's lines declare (`float d = …`), any section, with their types. */
export function declaredLocals(lines: ReadonlyArray<ExprLoopLine | undefined>): Array<{ name: string; type: string }> {
  const out: Array<{ name: string; type: string }> = [];
  for (const l of lines) {
    if (!usable(l)) continue;
    const m = DECL.exec(l.lhs);
    if (m && !out.some(o => o.name === m[2])) out.push({ name: m[2], type: m[1] });
  }
  return out;
}

/** Every line of the block in run order (Before, the looped lines, After); just the lines when Loop is off. */
export function allBlockLines(params: Record<string, unknown>): ExprLoopLine[] {
  const lines = Array.isArray(params.lines) ? (params.lines as ExprLoopLine[]) : [];
  const loop = loopOf(params);
  if (!loop) return lines;
  return [...(loop.before ?? []), ...lines, ...(loop.after ?? [])];
}

export interface LoopCodeOptions {
  before: ReadonlyArray<ExprLoopLine>;
  body: ReadonlyArray<ExprLoopLine>;
  after: ReadonlyArray<ExprLoopLine>;
  breakWhen?: string;
  max: number;
  /** Iterations: a GLSL float expression (a uniform), or a number (baked, clamped here). */
  count: string | number;
  /** Names already declared in the block's scope (inputs, t, p): a looped line's declaration of one isn't hoisted. */
  declared: ReadonlySet<string>;
  /** A local the shader needs for the count (`<id>_n`); Copy as code writes the number itself. */
  countVar?: string;
  /** Rewrite each expression (the sampler names of a picture input). */
  map?: (s: string) => string;
}

/** One emitted line: its depth inside the block and its text. */
export interface CodeLine { depth: number; text: string }

const stmtOf = (l: ExprLoopLine, map: (s: string) => string, lhs = l.lhs): string =>
  (l.off ? `// off: ${`${l.lhs} ${l.op || '='} ${l.rhs}`.replace(/\n/g, ' ')}` : `${map(lhs)} ${l.op || '='} ${map(l.rhs)};`);

/**
 * The looped block as GLSL statements: Before, the hoisted declarations, the `for` loop (its
 * bound Max, stopping at Iterations), Break when, After. Return is the caller's.
 */
export function loopCode(o: LoopCodeOptions): CodeLine[] {
  const map = o.map ?? (s => s);
  const out: CodeLine[] = [];
  const declared = new Set(o.declared);
  const before = o.before.filter(usable);
  const body = o.body.filter(usable);
  const after = o.after.filter(usable);
  if (before.length) out.push({ depth: 0, text: '// Before the loop' });
  for (const l of before) {
    out.push({ depth: 0, text: stmtOf(l, map) });
    const m = DECL.exec(l.lhs);
    if (m && !l.off) declared.add(m[2]);
  }
  // A looped line's declaration is hoisted: declared once, assigned each pass, read after the loop
  const bodyText: string[] = [];
  for (const l of body) {
    const m = DECL.exec(l.lhs);
    if (m && !l.off) {
      if (!declared.has(m[2])) { out.push({ depth: 0, text: `${m[1]} ${m[2]} = ${zeroOf(m[1])};` }); declared.add(m[2]); }
      bodyText.push(stmtOf(l, map, m[2]));
    } else bodyText.push(stmtOf(l, map));
  }
  const max = Math.max(1, Math.round(o.max));
  const literal = typeof o.count === 'number';
  const nInt = literal ? String(clampCount(o.count as number, max)) : (o.countVar ?? 'loop_n');
  if (!literal) out.push({ depth: 0, text: `int ${nInt} = int(clamp(floor(${o.count} + 0.5), 0.0, ${max}.0));` });
  // `n` is in the block's scope (After can divide by it) unless an input or Before line took the name
  const nOutside = !declared.has('n');
  if (nOutside) out.push({ depth: 0, text: `float n = float(${nInt});` });
  out.push({ depth: 0, text: `for (int i = 0; i < ${max}; i++) {` });
  out.push({ depth: 1, text: `if (i >= ${nInt}) break;` });
  out.push({ depth: 1, text: 'float fi = float(i);' });
  if (!nOutside) out.push({ depth: 1, text: `float n = float(${nInt});` });
  out.push({ depth: 1, text: 'float k = fi / max(n - 1.0, 1.0);' });
  for (const t of bodyText) out.push({ depth: 1, text: t });
  const brk = o.breakWhen?.trim().replace(/;\s*$/, '');
  if (brk) out.push({ depth: 1, text: `if (${map(brk)}) break;` });
  out.push({ depth: 0, text: '}' });
  if (after.length) out.push({ depth: 0, text: '// After the loop' });
  for (const l of after) out.push({ depth: 0, text: stmtOf(l, map) });
  return out;
}

/** The block's loop as plain GLSL lines (two-space indent), for Copy as code and the card. */
export function loopCodeText(params: Record<string, unknown>, declared: ReadonlySet<string>): string[] {
  const loop = loopOf(params);
  if (!loop) return [];
  const max = loopMax(loop);
  return loopCode({
    before: loop.before ?? [], body: Array.isArray(params.lines) ? (params.lines as ExprLoopLine[]) : [], after: loop.after ?? [],
    breakWhen: loop.breakWhen, max, count: clampCount(loopCountValue(params), max), declared,
  }).flatMap(l => l.text.split('\n').map(t => `${'  '.repeat(l.depth)}${t}`));
}

/** Reserved loop names an input or a line declares (they would hide i, fi, n or k). */
export function loopNameClashes(params: Record<string, unknown>): string[] {
  if (!loopOf(params)) return [];
  const names = new Set<string>();
  for (const i of (Array.isArray(params.inputs) ? (params.inputs as Array<{ name?: string }>) : [])) if (i?.name && LOOP_VAR_NAMES.has(i.name)) names.add(i.name);
  for (const d of declaredLocals(allBlockLines(params))) if (LOOP_VAR_NAMES.has(d.name)) names.add(d.name);
  return [...names];
}

/** The params that switch Loop on (keeping any Before / After lines from before), with a starting count. */
export function loopOnPatch(params: Record<string, unknown>, on: boolean): Record<string, unknown> {
  const prev = (params.loop as ExprLoop | undefined) ?? { on: false };
  return { loop: { ...prev, on }, ...(on && typeof params.loopN !== 'number' ? { loopN: LOOP_N_DEFAULT } : {}) };
}
