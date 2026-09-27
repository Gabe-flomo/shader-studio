/**
 * ast — reading a sketch with acorn, for the p5 importer.
 *
 * `parseCode` parses a file as a classic script (then as a module, since the
 * kit strips import / export lines) and reports a syntax error instead of
 * throwing. `walk` visits every node with its ancestors. `Scopes` answers
 * "does this name mean the sketch's own top-level thing, a local, or a
 * global?" well enough for a report: function scopes only, no blocks.
 */

import { parse } from 'acorn';

/** An acorn node, read loosely: the importer only looks at a few fields of each. */
export interface AstNode {
  type: string;
  start: number;
  end: number;
  loc?: { start: { line: number; column: number }; end: { line: number; column: number } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface SyntaxProblem { file: string; line: number; column: number; message: string }

export interface Parsed { ast: AstNode | null; module: boolean; error: Omit<SyntaxProblem, 'file'> | null }

const OPTS = { ecmaVersion: 'latest', allowReturnOutsideFunction: true, allowHashBang: true, locations: true } as const;

/** The file's syntax tree, or where it stops parsing. */
export function parseCode(code: string): Parsed {
  try {
    return { ast: parse(code, { ...OPTS, sourceType: 'script' }) as unknown as AstNode, module: false, error: null };
  } catch (e) {
    try {
      return { ast: parse(code, { ...OPTS, sourceType: 'module', allowReturnOutsideFunction: false }) as unknown as AstNode, module: true, error: null };
    } catch { /* report the script error: it is the one a classic sketch meets */ }
    const err = e as { loc?: { line: number; column: number }; message?: string };
    return {
      ast: null, module: false,
      error: { line: err.loc?.line ?? 1, column: (err.loc?.column ?? 0) + 1, message: String(err.message ?? e).replace(/\s*\(\d+:\d+\)\s*$/, '') },
    };
  }
}

const isNode = (v: unknown): v is AstNode => !!v && typeof v === 'object' && typeof (v as AstNode).type === 'string';

/** Visit every node, parents first. `ancestors` runs from the root down to the node's parent. Return false to skip a node's children. */
export function walk(root: AstNode, visit: (node: AstNode, ancestors: AstNode[]) => void | boolean): void {
  const stack: AstNode[] = [];
  const go = (node: AstNode) => {
    if (visit(node, stack) === false) return;
    stack.push(node);
    for (const k in node) {
      if (k === 'loc' || k === 'type' || k === 'start' || k === 'end') continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const c of v) if (isNode(c)) go(c); }
      else if (isNode(v)) go(v);
    }
    stack.pop();
  };
  go(root);
}

export const isFunction = (n: AstNode | null | undefined): boolean =>
  !!n && (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression');

/** Identifiers a pattern binds (`a`, `{ a, b: c }`, `[a, ...b]`, `a = 1`). */
export function patternIds(p: AstNode | null | undefined, out: AstNode[] = []): AstNode[] {
  if (!p) return out;
  if (p.type === 'Identifier') out.push(p);
  else if (p.type === 'AssignmentPattern') patternIds(p.left, out);
  else if (p.type === 'RestElement') patternIds(p.argument, out);
  else if (p.type === 'ArrayPattern') for (const e of p.elements) patternIds(e, out);
  else if (p.type === 'ObjectPattern') for (const pr of p.properties) patternIds(pr.type === 'RestElement' ? pr : pr.value, out);
  return out;
}

/** Binding identifiers declared directly in a function (its parameters and body) or a program, not in nested functions. */
function declaredIn(fn: AstNode, bindings: Set<AstNode>): Set<string> {
  const names = new Set<string>();
  const add = (id: AstNode) => { names.add(id.name); bindings.add(id); };
  if (fn.type !== 'Program') {
    for (const p of fn.params) patternIds(p, []).forEach(add);
    // A named function expression sees its own name.
    if (fn.type === 'FunctionExpression' && fn.id) add(fn.id);
  }
  const body = fn.type === 'Program' ? fn : fn.body;
  if (!body || body.type !== 'BlockStatement' && body.type !== 'Program') return names;
  walk(body, n => {
    if (n !== body && isFunction(n)) {
      if (n.type === 'FunctionDeclaration' && n.id) add(n.id);
      return false;
    }
    if (n.type === 'ClassDeclaration' && n.id) add(n.id);
    if (n.type === 'ClassExpression' || n.type === 'ClassDeclaration') {
      if (n.type === 'ClassExpression' && n.id) bindings.add(n.id);
      // Methods are functions; their bodies are their own scopes.
    }
    if (n.type === 'VariableDeclaration') for (const d of n.declarations) patternIds(d.id, []).forEach(add);
    if (n.type === 'CatchClause' && n.param) patternIds(n.param, []).forEach(add);
    if (n.type === 'ImportSpecifier' || n.type === 'ImportDefaultSpecifier' || n.type === 'ImportNamespaceSpecifier') add(n.local);
    return true;
  });
  return names;
}

/** Is this identifier a reference to a name (rather than a property key, a label or a declaration)? */
export function isReference(node: AstNode, parent: AstNode | undefined, bindings: Set<AstNode>): boolean {
  if (node.type !== 'Identifier' || bindings.has(node)) return false;
  if (!parent) return true;
  switch (parent.type) {
    case 'MemberExpression': return parent.object === node || parent.computed;
    case 'Property': return parent.value === node || (parent.computed && parent.key === node);
    case 'MethodDefinition': case 'PropertyDefinition': return parent.computed && parent.key === node || parent.value === node;
    case 'LabeledStatement': case 'BreakStatement': case 'ContinueStatement': return false;
    case 'ExportSpecifier': return parent.local === node;
    case 'ImportSpecifier': case 'ImportDefaultSpecifier': case 'ImportNamespaceSpecifier': return false;
    case 'MetaProperty': return false;
    default: return true;
  }
}

/** Names the program declares at its own top level (functions, classes, variables), with their binding identifiers. */
export function topLevelDeclarations(ast: AstNode): Map<string, AstNode> {
  const out = new Map<string, AstNode>();
  for (const st of ast.body as AstNode[]) {
    const s = st.type === 'ExportNamedDeclaration' || st.type === 'ExportDefaultDeclaration' ? st.declaration ?? st : st;
    if ((s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') && s.id) out.set(s.id.name, s.id);
    if (s.type === 'VariableDeclaration') for (const d of s.declarations) for (const id of patternIds(d.id)) out.set(id.name, id);
  }
  return out;
}

/**
 * Scopes of one file: `localAt(name, ancestors)` is true when a function around
 * the node declares `name` (so it is not the top-level thing or a p5 global).
 */
export class Scopes {
  readonly bindings = new Set<AstNode>();
  private fnNames = new Map<AstNode, Set<string>>();
  readonly top: Set<string>;
  /** Every name bound anywhere in the file, any scope. */
  readonly all = new Set<string>();
  constructor(ast: AstNode) {
    this.top = declaredIn(ast, this.bindings);
    walk(ast, n => { if (isFunction(n)) this.fnNames.set(n, declaredIn(n, this.bindings)); });
    for (const b of this.bindings) this.all.add(b.name);
    for (const t of this.top) this.all.add(t);
  }
  localAt(name: string, ancestors: readonly AstNode[]): boolean {
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const s = this.fnNames.get(ancestors[i]);
      if (s?.has(name)) return true;
    }
    return false;
  }
}

/** A numeric literal, `-literal` or `+literal`: its value; null otherwise. */
export function numberOf(n: AstNode | null | undefined): number | null {
  if (!n) return null;
  if (n.type === 'Literal' && typeof n.value === 'number') return n.value;
  if (n.type === 'UnaryExpression' && (n.operator === '-' || n.operator === '+') && n.argument.type === 'Literal' && typeof n.argument.value === 'number') {
    return n.operator === '-' ? -n.argument.value : n.argument.value;
  }
  return null;
}

/** A string literal (or a template without expressions): its text; null otherwise. */
export function stringOf(n: AstNode | null | undefined): string | null {
  if (!n) return null;
  if (n.type === 'Literal' && typeof n.value === 'string') return n.value;
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis[0].value.cooked ?? null;
  return null;
}

/** The name a call is made to: `fill(…)` → fill, `p.fill(…)` → fill (with `object` p). */
export function calleeName(call: AstNode): { name: string; object: string | null } | null {
  const c = call.callee;
  if (c.type === 'Identifier') return { name: c.name, object: null };
  if (c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier') {
    return { name: c.property.name, object: c.object.type === 'Identifier' ? c.object.name : c.object.type === 'ThisExpression' ? 'this' : null };
  }
  return null;
}

/** 1-based line of an offset. */
export function lineAt(code: string, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset && i < code.length; i++) if (code.charCodeAt(i) === 10) n++;
  return n;
}
