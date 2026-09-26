/**
 * liveScript.ts — live script blocks and the Stage hand-off, as plain data.
 *
 * A live code block quotes a Script layer and lets the reader edit it. The
 * edit runs in the canvases of that source on the same step (and nowhere
 * else: not the source graph, not other steps). These helpers say which
 * edits a step carries, and build a source's bundle with them, for the
 * Stage's page and for the exported page.
 */
import { buildPlayHtml, DEFAULT_EMBED, type PlayHtmlInput } from '../play/exportHtml';
import type { Block, CodeBlock, PresentSource, Step } from '../types/presentation';

/** Layer id → edited code, for one source. */
export type ScriptEdits = Readonly<Record<string, string>>;

/** A code block that quotes a Script layer and is live. */
export function isLiveScript(b: Block): b is CodeBlock & { from: { source: string; layerId: string } } {
  return b.type === 'code' && !!b.live && !!b.from && 'layerId' in b.from;
}

/** The step's edits by source: its live code blocks that were changed from the snapshot. */
export function stepScriptEdits(step: Step | undefined): Map<string, ScriptEdits> {
  const out = new Map<string, Record<string, string>>();
  for (const b of step?.blocks ?? []) {
    if (!isLiveScript(b) || b.edited === undefined) continue;
    const m = out.get(b.from.source) ?? {};
    m[b.from.layerId] = b.edited;
    out.set(b.from.source, m);
  }
  return out;
}

/** The canvases (render and interactive blocks) of a source on a step: where a live edit runs. */
export function linkedCanvases(step: Step | undefined, source: string): Block[] {
  return (step?.blocks ?? []).filter(b => (b.type === 'render' || b.type === 'interactive') && b.source === source);
}

/** A bundle with some Script layers' code replaced (the snapshot itself is never changed). */
export function withScripts(input: PlayHtmlInput, edits: ScriptEdits | undefined): PlayHtmlInput {
  if (!edits || !Object.keys(edits).length) return input;
  return {
    ...input,
    play: { ...input.play, layers: input.play.layers.map(l => (l.kind === 'script' && typeof edits[l.id] === 'string' ? { ...l, code: edits[l.id] } : l)) },
  };
}

/** The page the Stage's Exact mode runs for a Play: the website player with its own panel. */
export function stagePageHtml(input: PlayHtmlInput): string {
  return buildPlayHtml(input, { ...DEFAULT_EMBED, mode: 'player' });
}

/** A step's canvas on the Stage: the snapshot's page (with the step's script edits), not the open graph. */
export function snapshotStagePage(source: PresentSource, edits?: ScriptEdits): string {
  return stagePageHtml(withScripts(source.bundle, edits));
}
