/**
 * fnCardStore.ts — the one open function card (docs/expression-explainer.md, "Function cards"),
 * and what each place that shows code tells it. Light on purpose: editors and code views import
 * this, the card itself (FunctionCard.tsx) is a lazy chunk the host loads on first open.
 *
 * A place that shows code marks it and, when it knows more, registers a scope:
 *  - editable code (a textarea or input): `data-fn-card="edit"` on the field;
 *  - read-only code: `data-fn-code` on an element whose text is the code (a line, a block);
 *  - `useFnCardScope(ctx)` on any ancestor: the names' types, more source to find the user's
 *    functions in (a Custom Function's helpers, the whole generated shader) and, in editors with
 *    the snippet library, where Insert snippet puts a snippet.
 */
import { useCallback, useRef } from 'react';
import { create } from 'zustand';
import type { FunctionCardContext } from '../../../lib/glslPatterns/fnCard';
import type { Snippet } from '../../../suggestions/snippets';

/** The rules, in one place (the docs and the tests read these). */
export const FN_CARD = {
  /** Resting the pointer on a function name this long opens a peek card (desktop only). */
  hoverMs: 600,
  /** A peek card closes this long after the pointer leaves both the name and the card. */
  leaveMs: 260,
  /** A touch held this long opens the card. */
  longPressMs: 500,
  /** Moving further than this cancels a long press or a click. */
  slopPx: 8,
} as const;

export interface AnchorRect { left: number; top: number; width: number; height: number }

export interface FnScope extends FunctionCardContext {
  /** Insert a snippet where the editor's caret is (the Functions panel's own insert). */
  onSnippet?: (s: Snippet) => void;
}

export type CardMode = 'peek' | 'pinned';

export interface FunctionCardRequest {
  kind: 'function';
  code: string;
  pos: number;
  /** A caret in the arguments finds the call around it (keyboard). */
  enclosing?: boolean;
  scope: FnScope;
  anchor: AnchorRect;
  mode: CardMode;
  /** Move focus into the card (opened from the keyboard, or with a click in read-only code). */
  focus: boolean;
  /** Where focus goes back when the card closes. */
  opener: HTMLElement | null;
  /** Opened from an editable editor (Insert snippet goes into it). */
  editable: boolean;
}

export interface NodeCardRequest {
  kind: 'node';
  nodeId: string;
  anchor: AnchorRect;
  mode: 'pinned';
  focus: boolean;
  opener: HTMLElement | null;
  /** The node's longer info (sockets, connections). */
  onMore?: () => void;
  /** Opened by the node's Explain button: ask the local model straight away. */
  explain?: boolean;
}

export type CardRequest = FunctionCardRequest | NodeCardRequest;

interface State { req: CardRequest | null; n: number }

export const useFnCard = create<State>(() => ({ req: null, n: 0 }));

export function openFunctionCard(req: Omit<FunctionCardRequest, 'kind'>): void {
  useFnCard.setState(s => ({ req: { kind: 'function', ...req }, n: s.n + 1 }));
}

export function openNodeCard(req: Omit<NodeCardRequest, 'kind' | 'mode'>): void {
  useFnCard.setState(s => ({ req: { kind: 'node', mode: 'pinned', ...req }, n: s.n + 1 }));
}

/** Close the card; `restoreFocus` puts focus back where it was opened from (Esc). */
export function closeFunctionCard(restoreFocus = false): void {
  const req = useFnCard.getState().req;
  if (!req) return;
  useFnCard.setState({ req: null });
  if (restoreFocus && req.opener?.isConnected) req.opener.focus({ preventScroll: true });
}

/** A peek becomes pinned once the card is used (clicked, focused). */
export function pinFunctionCard(): void {
  const req = useFnCard.getState().req;
  if (req && req.mode === 'peek') useFnCard.setState({ req: { ...req, mode: 'pinned' } as CardRequest });
}

// ── Scopes ────────────────────────────────────────────────────────────────────

const scopes = new WeakMap<Element, { current: FnScope }>();

/** The scope of the nearest marked ancestor (and the closest one's settings win). */
export function scopeOf(el: Element | null): FnScope {
  const out: FnScope = {};
  const chain: FnScope[] = [];
  for (let n = el?.closest('[data-fn-scope]') ?? null; n; n = n.parentElement?.closest('[data-fn-scope]') ?? null) {
    const s = scopes.get(n)?.current;
    if (s) chain.push(s);
  }
  for (const s of chain.reverse()) Object.assign(out, s, { types: { ...out.types, ...s.types }, source: [out.source, s.source].filter(Boolean).join('\n') || undefined });
  return out;
}

/** Register what a region of the UI knows; spread the result on its root (`ref`, `data-fn-scope`). */
export function useFnCardScope(scope: FnScope): { ref: (el: HTMLElement | null) => void; 'data-fn-scope': '' } {
  const latest = useRef(scope);
  latest.current = scope;
  const ref = useCallback((el: HTMLElement | null) => { if (el) scopes.set(el, latest); }, []);
  return { ref, 'data-fn-scope': '' };
}

/** The ⓘ on a canvas node: opens its card, or closes it when it is this node's. */
export function toggleNodeCard(button: HTMLElement | null, nodeId: string, onMore?: () => void, explain = false): void {
  const cur = useFnCard.getState().req;
  if (cur?.kind === 'node' && cur.nodeId === nodeId && !!cur.explain === explain) { closeFunctionCard(); return; }
  const r = button?.getBoundingClientRect();
  const anchor = r ? { left: r.left, top: r.top, width: r.width, height: r.height } : { left: 16, top: 16, width: 0, height: 0 };
  openNodeCard({ nodeId, anchor, focus: true, opener: button, onMore, explain });
}
