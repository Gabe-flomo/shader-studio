/**
 * types.ts — the Code Explorer's data model (docs/code-explorer-plan.md §3–4).
 *
 * A *doc* is one thing the app keeps: an example graph, a saved graph, the
 * open graph, a preset, a saved shader, a linked .glsl file, a presentation.
 * A doc has *sources* (one per piece of written code: an Expression Block's
 * lines, a Custom Function's body, an input expression, a whole file) and the
 * index keeps, per doc, the *sites* found in them: every call, shaped at the
 * levels of §4.3, with where it sits and what flows into and out of it.
 *
 * Phase 1 indexes written code only (§3.3): what a person typed.
 */

export type SourceKind = 'expr' | 'customFn' | 'inputExpr' | 'generated' | 'nodeLib' | 'shader' | 'preset' | 'import' | 'file' | 'present' | 'corpus';

/** Where a doc lives. 'open' is the graph open in the Studio right now (indexed as you edit). */
export type Origin = 'example' | 'saved' | 'open' | 'linked' | 'workspace' | 'presentation';

/** Every hit knows where it came from (§3.2). */
export interface Provenance {
  sourceKind: SourceKind;
  origin: Origin;
  /** `example:fractalRings`, `saved:My graph`, `shader:<id>`, `file:<folder>/<path>`, `present:<name>`… */
  docId: string;
  docLabel: string;
  /** Graph node id; inside groups, the last id of `nodePath`. */
  nodeId?: string;
  /** Group ids from the top level down to the node (the node's own id last). */
  nodePath?: string[];
  nodeLabel?: string;
  nodeType?: string;
  /** 'lines[2]', 'result', 'body', 'glslFunctions', '__inExpr_scale', 'code'. */
  field: string;
  /** 1-based, inside that field's text (an Expression Block line is its own field: line = the block's line number). */
  line: number;
  column: number;
}

/** How a source's text is read: a whole file, statements inside a function body, or one expression. */
export type ParseMode = 'file' | 'body' | 'expr';

/** One piece of written code inside a doc, as the corpus collects it. */
export interface SourceInput {
  sourceKind: SourceKind;
  mode: ParseMode;
  text: string;
  /** The field the whole text is (when `lineFields` doesn't say per line). */
  field: string;
  /**
   * Per line of `text` (0-based): the field that line came from and how many
   * characters of made-up prefix it starts with (an Expression Block's
   * `lhs op ` before the rhs), so columns point into the field itself.
   */
  lineFields?: Array<{ field: string; line: number; prefix: number }>;
  nodeId?: string;
  nodePath?: string[];
  nodeLabel?: string;
  nodeType?: string;
  /** Extra words for free-text search: the node's label and comment. */
  words?: string;
}

export interface DocInput {
  docId: string;
  origin: Origin;
  label: string;
  /** Sparkline bucket: the example folder, "Saved graphs", "Presets"… */
  group: string;
  sources: SourceInput[];
}

/** A call site, as stored (compact: one per call in written code). */
export interface Site {
  /** Index into the doc's `sources`. */
  src: number;
  callee: string;
  /** A type constructor (vec3(…), mat2(…)): indexed, but left out of chains and co-occurrence. */
  ctor?: 1;
  /** L1 exact shape: literals → #, local names → _a, _b… */
  l1: string;
  /** L2 argument shape: names → _, inside nested calls → … */
  l2: string;
  field: string;
  line: number;
  col: number;
  /** The statement's text (one line, trimmed) and the call's span in it. */
  text: string;
  hs: number;
  he: number;
  /** Enclosing calls, outermost first, ending with this one (constructors skipped). */
  chain: string[];
  /** Statement kind: 'float x =', 'vec3 x =', 'return', 'x +=', 'gl_FragColor =', 'if', 'expr'. */
  sk: string;
  /** Producer → this → consumer (§5.2): a callee, '(arith)', 'return', 'gl_FragColor', 'if' or '·'. */
  prod: string;
  cons: string;
  /** Other (non-constructor) callees in the same statement. */
  same: string[];
  /** The function it sits in (files and helper code); absent at top level and in fragments. */
  fn?: string;
  /** Direct arguments that are literal numbers (after folding), else null. */
  lits: Array<number | null>;
  /** Written as `1.0 - call(…)`. */
  flip?: 1;
  /** Split identifier words of the statement, for free-text search. */
  ids: string[];
}

export interface DocSource {
  sourceKind: SourceKind;
  field: string;
  nodeId?: string;
  nodePath?: string[];
  nodeLabel?: string;
  nodeType?: string;
  /** Lower-case words: the node's label and comment, the code's comments. */
  words: string[];
}

export interface DocRecord {
  docId: string;
  /** Content hash of the doc's sources: re-indexed only when it changes. */
  version: string;
  origin: Origin;
  label: string;
  group: string;
  indexedAt: number;
  sources: DocSource[];
  sites: Site[];
}

/** Bumped when the stored shape of a DocRecord or the shaping rules change: the index is rebuilt. */
export const INDEX_SCHEMA = 1;
