/**
 * memory.ts — named memories (docs/agent-builder.md "Memory"): where each lives in a walker's More
 * memory (state E, four numbers), and the expression line a memory can be set to
 * (`food = food * 0.98 + here.food`), checked as the GPU will (glslPatterns' parse and typecheck)
 * and turned into GLSL for the rule's Expression Block. Pure.
 *
 * Slots: the memories in order take E's numbers x, y, z, w; a remembered place takes two. A memory
 * that doesn't fit has no slot (the builder says so; it does nothing).
 */
import { checkTypes, parseExpr, printExpr, walk, type Expr, type GlslType } from '../lib/glslPatterns';
import { type AgentMemory, type AgentRuleSet, type MemoryType, hereChannelKey, memoryIdent } from './spec';

/** E's four numbers. */
export const MEMORY_SLOTS = 4;
const COMP = 'xyzw';

/** How many numbers a memory of this type takes. */
export const slotsOf = (t: MemoryType) => (t === 'position' ? 2 : 1);

/** Each memory's swizzle of E (`x`, `zw`…), by id; memories that don't fit are left out. */
export function memorySlots(set: AgentRuleSet): Map<string, string> {
  const out = new Map<string, string>();
  let at = 0;
  for (const m of set.memories ?? []) {
    const n = slotsOf(m.type);
    if (at + n > MEMORY_SLOTS) continue;
    out.set(m.id, COMP.slice(at, at + n));
    at += n;
  }
  return out;
}

/** The numbers the memories take between them (at most four count). */
export const slotsUsed = (set: AgentRuleSet) => (set.memories ?? []).reduce((s, m) => s + slotsOf(m.type), 0);
/** Does the rule set keep named memories (so its group gets More memory, state E)? */
export const usesMemories = (set: AgentRuleSet) => memorySlots(set).size > 0;

/** A memory's GLSL type: a place is a vec2, the rest one float. */
export const memoryGlslType = (m: AgentMemory): 'float' | 'vec2' => (m.type === 'position' ? 'vec2' : 'float');

/** A new memory id not taken in the set. */
export function newMemoryId(set: AgentRuleSet): string {
  const ids = new Set((set.memories ?? []).map(m => m.id));
  let i = 1;
  while (ids.has(`m${i}`)) i++;
  return `m${i}`;
}

// ── Expressions ──────────────────────────────────────────────────────────────

/** A name the expression line knows, for autocomplete. */
export interface ExprName { name: string; type: 'float' | 'vec2' | 'vec3'; hint: string }

/** Every name an expression of this rule set may use: here.<channel>, its memories, age, speed, random, dt, pos. */
export function exprNames(set: AgentRuleSet, d3 = false): ExprName[] {
  const out: ExprName[] = [
    { name: 'here.own', type: 'float', hint: 'its own trail where it stands' },
    ...[0, 1, 2, 3].map(i => {
      const n = set.channels[i]?.trim();
      return { name: `here.${n ? memoryIdent(n) : `trail${i + 1}`}`, type: 'float' as const, hint: `trail channel ${i + 1}${n ? ` (${n})` : ''} where it stands` };
    }),
    ...(set.memories ?? []).map(m => ({ name: memoryIdent(m.name), type: memoryGlslType(m), hint: `the memory ${m.name} (${m.type})` })),
    { name: 'age', type: 'float', hint: 'seconds since it was born' },
    { name: 'speed', type: 'float', hint: 'its speed now' },
    { name: 'random', type: 'float', hint: 'a fresh random number 0–1' },
    { name: 'dt', type: 'float', hint: 'one step, 1/60 s' },
    { name: 'pos', type: d3 ? 'vec3' : 'vec2', hint: 'where it is' },
  ];
  return out;
}

export interface ExprCheck { ok: boolean; error?: string; expr?: Expr }

/** Whole numbers are floats here (`count + 1` is fine): the literal's id → its float text. */
function floatLiterals(e: Expr): Map<number, string> {
  const subst = new Map<number, string>();
  walk(e, n => { if (n.kind === 'num' && n.int) subst.set(n.id, `${n.value}.0`); });
  return subst;
}

/**
 * Check a memory's expression as the GPU will: it parses, names only what `exprNames` lists (and
 * PI, TAU), and typechecks (strict GLSL ES 3.0; whole numbers are taken as floats) to the
 * memory's type. The error is one plain line.
 */
export function checkMemoryExpr(set: AgentRuleSet, memoryId: string, text: string | undefined, d3 = false): ExprCheck {
  const m = set.memories?.find(x => x.id === memoryId);
  if (!m) return { ok: false, error: 'That memory is gone.' };
  const src = (text ?? '').trim();
  if (!src) return { ok: false, error: `Write what ${m.name} becomes, e.g. ${memoryIdent(m.name)} * 0.98.` };
  const p = parseExpr(src);
  if (!p.ok) return { ok: false, error: p.error };
  const names = exprNames(set, d3);
  const env: Record<string, GlslType> = { PI: 'float', TAU: 'float' };
  for (const n of names) if (!n.name.startsWith('here.')) env[n.name] = n.type;
  let bad: string | null = null;
  walk(p.expr, (n, parent) => {
    if (bad) return;
    if (n.kind === 'member' && n.object.kind === 'ident' && n.object.name === 'here') {
      if (hereChannelKey(set, n.field) === null) bad = `here.${n.field} isn't a trail: use ${names.filter(x => x.name.startsWith('here.')).map(x => x.name).join(', ')}.`;
      return;
    }
    if (n.kind === 'ident') {
      if (n.name === 'here' && parent?.kind === 'member') return;
      if (!(n.name in env)) bad = `${n.name} isn't known here: use ${names.filter(x => !x.name.startsWith('here.')).map(x => x.name).join(', ')}, or here.<trail>.`;
    }
  });
  if (bad) return { ok: false, error: bad };
  // Typecheck with here.<x> as floats (a stand-in name) and whole numbers as floats.
  const subst = floatLiterals(p.expr);
  walk(p.expr, n => { if (n.kind === 'member' && n.object.kind === 'ident' && n.object.name === 'here') subst.set(n.id, '_here'); });
  const re = parseExpr(printExpr(p.expr, subst));
  if (!re.ok) return { ok: false, error: re.error };
  const tc = checkTypes(re.expr, { ...env, _here: 'float' });
  if (!tc.ok) return { ok: false, error: tc.errors[0] ?? 'It doesn\'t typecheck.' };
  const want = memoryGlslType(m);
  if (tc.type !== 'unknown' && tc.type !== want) return { ok: false, error: `It gives a ${tc.type}; ${m.name} is ${want === 'vec2' ? 'a place (a vec2)' : 'one number (a float)'}.` };
  return { ok: true, expr: p.expr };
}

/**
 * A checked expression as GLSL inside a rule block: memory names → their slot of `mem2`, here.<x>
 * → that channel's Sense reading (hereVar), age / speed / pos / dt / random → the block's own.
 * `read` marks what the block reads (and returns its variable).
 */
export function memoryExprGlsl(set: AgentRuleSet, e: Expr, o: { read: (v: string) => string; hereVar: (k: string) => string; random: string; d3: boolean }): string {
  const slots = memorySlots(set);
  const byIdent = new Map((set.memories ?? []).map(m => [memoryIdent(m.name), m]));
  const subst = floatLiterals(e);
  walk(e, (n, parent) => {
    if (n.kind === 'member' && n.object.kind === 'ident' && n.object.name === 'here') {
      const k = hereChannelKey(set, n.field);
      if (k !== null) subst.set(n.id, o.read(o.hereVar(k)));
      return;
    }
    if (n.kind !== 'ident' || (n.name === 'here' && parent?.kind === 'member')) return;
    const m = byIdent.get(n.name);
    if (m) { const sl = slots.get(m.id); subst.set(n.id, sl ? `${o.read('mem2')}.${sl}` : (m.type === 'position' ? 'vec2(0.0)' : '0.0')); return; }
    if (n.name === 'age') subst.set(n.id, o.read('age'));
    else if (n.name === 'speed') subst.set(n.id, o.read('spd'));
    else if (n.name === 'pos') subst.set(n.id, o.read('pos'));
    else if (n.name === 'dt') subst.set(n.id, 'a_dt');
    else if (n.name === 'random') subst.set(n.id, o.random);
    else if (n.name === 'PI') subst.set(n.id, '3.1415927');
    else if (n.name === 'TAU') subst.set(n.id, '6.2831853');
  });
  return printExpr(e, subst);
}
