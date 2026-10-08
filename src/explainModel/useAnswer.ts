/**
 * useAnswer.ts — one "Explain more" button's life: idle → (offer the download) → working (streaming) →
 * done / failed. Shared by the line action, the block action and the function card.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadExplainModel, explainStream, setExplainModelEnabled, useExplainModel } from './client';
import type { BuiltPrompt } from './prompt';

export type AnswerPhase = 'idle' | 'offer' | 'working' | 'done' | 'failed';

export interface AnswerState {
  phase: AnswerPhase;
  text: string;
  /** From the cache (asked before, same code and context). */
  cached: boolean;
  /** The facts the model was given. */
  used: string[];
  error?: string;
}

/** What to ask: built lazily, on press, so nothing is gathered until someone wants it. */
export interface AskSpec {
  kind: 'line' | 'block' | 'node';
  /** The code asked about (the cache key's first half). */
  code: string;
  build: () => Promise<BuiltPrompt>;
}

const IDLE: AnswerState = { phase: 'idle', text: '', cached: false, used: [] };

export function useModelAnswer() {
  const [state, setState] = useState<AnswerState>(IDLE);
  const abort = useRef<AbortController | null>(null);
  const pending = useRef<AskSpec | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; abort.current?.abort(); }, []);

  const set = useCallback((s: AnswerState | ((o: AnswerState) => AnswerState)) => { if (alive.current) setState(s); }, []);

  const run = useCallback(async (spec: AskSpec) => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    const m = useExplainModel.getState();
    if (!m.enabled || !m.downloaded) { pending.current = spec; set({ ...IDLE, phase: 'offer' }); return; }
    set({ ...IDLE, phase: 'working' });
    try {
      const built = await spec.build();
      set(o => ({ ...o, used: built.used }));
      const r = await explainStream(
        { kind: spec.kind, code: spec.code, context: built.context, messages: built.messages, maxTokens: built.maxTokens },
        soFar => set(o => ({ ...o, phase: 'working', text: soFar })), ctl.signal);
      if (ctl.signal.aborted || r.ok === false && r.reason === 'aborted') return;
      if (r.ok) set(o => ({ ...o, phase: 'done', text: r.text, cached: r.cached }));
      else set(o => ({ ...o, phase: 'failed', error: r.reason === 'failed' ? r.message ?? 'The model failed.' : 'The explanation model is off.' }));
    } catch (e) {
      if (!ctl.signal.aborted) set(o => ({ ...o, phase: 'failed', error: e instanceof Error ? e.message : String(e) }));
    }
  }, [set]);

  /** The one-time download (or turning it back on), then the question that was waiting. */
  const confirmDownload = useCallback(async () => {
    const spec = pending.current;
    const m = useExplainModel.getState();
    if (m.downloaded) setExplainModelEnabled(true);
    const ok = m.downloaded ? true : await downloadExplainModel();
    if (!ok) { set(o => ({ ...o, phase: 'failed', error: useExplainModel.getState().error ?? 'The download failed.' })); return; }
    if (spec) void run(spec);
  }, [run, set]);

  const stop = useCallback(() => {
    abort.current?.abort();
    set(o => (o.phase === 'working' ? { ...o, phase: o.text ? 'done' : 'idle' } : o));
  }, [set]);

  const dismiss = useCallback(() => { abort.current?.abort(); pending.current = null; set(IDLE); }, [set]);

  return { state, ask: run, confirmDownload, stop, dismiss };
}
