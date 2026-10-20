/**
 * exprs.ts — a verb's number as a one-line expression (docs/combine-plan.md §2.8, docs/combine.md "Expressions").
 *
 * The line is a Simple Expression's: it compiles to a Simple Expression node (role `<layer>:x:<setting>`) wired into
 * the socket the number would set, so it is a node you can see and edit like any other. Its inputs are the verb's
 * names the line uses (Collide: speed, age, d…) and its sliders: "Make a slider" turns a number in the line into a
 * name, kept on the layer (`sliders`), each a Constant node (role `<layer>:x:<setting>:<name>`) wired into it. Those
 * Constants are what Add to Play can take, after Done; the expression itself never becomes a Play control.
 *
 * A line that doesn't check (a bad name, a vector where a number goes) builds nothing: the number is used, and the
 * window says why. Pure.
 */
import { checkSimpleExpr, type SimpleExprCheck } from '../nodes/definitions/simpleExpr';
import { mk, ref, type Ctx } from './glue';
import type { CombineLayer, NodeRef, VerbId } from './spec';

export interface ExprName { name: string; doc: string }

/** Names every expression has without wiring (the Simple Expression's own). */
export const FREE_NAMES: readonly ExprName[] = [{ name: 't', doc: 'time, in seconds' }];

/** What the walkers' names read inside their group (Agent Inputs' outputs). */
export const WALKER_NAMES: readonly ExprName[] = [
  { name: 'speed', doc: 'the walker\'s speed last step' },
  { name: 'age', doc: 'seconds since the walker was born' },
];
/** The shape's distance where the walker is (2D: negative inside). */
export const SHAPE_NAME: ExprName = { name: 'd', doc: 'how far the walker is from the shape\'s edge (negative inside)' };

/**
 * The settings of a layer that can be an expression, with the names each can use (besides t and its sliders).
 * Only numbers that go into a socket: a setting that is set on a node's param alone (a card's place) can't be.
 */
export function exprTargets(verb: VerbId | 'base', o: { how?: string; mode?: string; d3?: boolean; amount?: boolean } = {}): Record<string, readonly ExprName[]> {
  const walker = [...WALKER_NAMES, ...(o.d3 ? [] : [SHAPE_NAME])];
  if (verb === 'collide') return { bounce: walker, friction: walker, ...(o.mode === 'settle' ? { gravity: walker } : {}) };
  if (verb === 'follow') {
    if (o.d3) return { speed: walker, offset: walker };
    if (o.how === 'trace' || o.how === 'orbit') return { speed: walker, [o.how === 'orbit' ? 'orbit' : 'offset']: walker, width: walker };
    if (o.how === 'flow') return { push: walker };
    return { drift: walker };
  }
  if ((verb === 'placeIn' || verb === 'replaceMask') && o.amount) return { amount: [] };
  return {};
}

/** The names a line may use: the free ones, the verb's and its sliders. */
export function exprVars(names: readonly ExprName[], sliders: Record<string, number> = {}): Array<{ name: string; type: string }> {
  return [...names.map(n => ({ name: n.name, type: 'float' })), ...Object.keys(sliders).map(name => ({ name, type: 'float' }))];
}

/** Check a line (a number it gives back: Output float). */
export function checkExpr(text: string, names: readonly ExprName[], sliders: Record<string, number> = {}): SimpleExprCheck {
  const r = checkSimpleExpr(text, exprVars(names, sliders), 'float');
  // The node's own wording points at its + Input button; here the names are the verb's and the sliders.
  return r.ok ? r : { ok: false, error: r.error.replace(/ Add one with \+ Input, or use [^]*$/, ' Or make a slider from a number.').replace('isn\'t an input here. Inputs:', 'isn\'t a name here. Names:') };
}

const usesName = (text: string, name: string) => new RegExp(`(^|[^\\w.])${name}\\b`).test(text);

/**
 * Setting `key` of `layer` as its expression, when it has one that checks: a Simple Expression with an input for each
 * name it uses (wired from `names`) and each of its sliders (a Constant), made in `ctx` (the top level, or an Agents
 * group's inside). Null when it has none (or it doesn't check: a warning says why), so the number is used.
 */
export function exprFor(ctx: Ctx, layer: CombineLayer, key: string, names: Record<string, NodeRef>, label = key): NodeRef | null {
  const text = layer.exprs?.[key]?.trim();
  if (!text) return null;
  const sliders = layer.sliders?.[key] ?? {};
  const known: ExprName[] = Object.keys(names).map(name => ({ name, doc: '' }));
  const chk = checkExpr(text, known, sliders);
  if (!chk.ok) { ctx.warnings.push(`${label[0].toUpperCase()}${label.slice(1)} = ${text}: ${chk.error}. The slider's number is used.`); return null; }
  const L = layer.id;
  const ins: Array<[string, NodeRef]> = [];
  for (const [name, from] of Object.entries(names)) if (usesName(text, name)) ins.push([name, from]);
  for (const [name, value] of Object.entries(sliders)) {
    if (!usesName(text, name)) continue;
    const c = mk(ctx, L, `x:${key}:${name}`, 'constant', { value, outputType: 'float', label: name }, {},
      `Constant "${name}": a slider of the expression for ${label} (Make a slider). Right-click its slider in Combine for Add to Play once the scene is in your graph.`);
    ins.push([name, ref(c, 'value')]);
  }
  const vars = ins.map(([name], i) => ({ key: `in${i + 1}`, name }));
  const node = mk(ctx, L, `x:${key}`, 'simpleExpr', { label: `${label} =`, vars, expr: text, outputType: 'float' }, {},
    `Simple Expression: ${label} as a line instead of a number, ${text}. ${ins.length ? `Its inputs: ${ins.map(([n]) => n).join(', ')}. ` : ''}t is time in seconds. Edit the line in Combine (or here); it is wired where the ${label} number went.`);
  node.inputs = Object.fromEntries(ins.map(([name, from], i) => [`in${i + 1}`, { type: 'float', label: name, connection: { ...from } }]));
  node.outputs = { result: { type: 'float', label: 'Result' } };
  return ref(node, 'result');
}
