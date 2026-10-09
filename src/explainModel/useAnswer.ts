/**
 * useAnswer.ts — one Explain button's life: idle → (offer the download) → working (streaming) →
 * done / failed. Shared by the line action, the block action and the function card. Also the two on-demand extras:
 * the double-check (ask twice more, compare) and Compare models (the same prompt on every downloaded model).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadExplainModel, explainCompare, explainSamples, explainStream, setExplainModelEnabled, useExplainModel, type AnswerMeta, type CompareResult, type ExplainRequest } from './client';
import type { GroundingContext } from './confidence';
import type { BuiltPrompt } from './prompt';

export type AnswerPhase = 'idle' | 'offer' | 'working' | 'done' | 'failed';

export interface CompareEntry { modelId: string; state: 'waiting' | 'running' | 'done' | 'failed'; text: string; meta?: AnswerMeta; error?: string; startedAt?: number }

export interface AnswerState {
  phase: AnswerPhase;
  /** The model's raw text (a thinking model's reasoning included). */
  text: string;
  /** From the cache (asked before, same code and context). */
  cached: boolean;
  /** The facts the model was given. */
  used: string[];
  /** What the answer is checked against. */
  check?: GroundingContext;
  lineNo?: number;
  /** Token probabilities and timings of the finished answer. */
  meta?: AnswerMeta;
  /** The double-check's extra answers; `checking` while they are being made. */
  samples?: string[];
  checking: boolean;
  /** When the question was asked (for "thinking… 12 s"). */
  startedAt?: number;
  /** Compare models: one entry per downloaded model. */
  compare?: CompareEntry[];
  error?: string;
}

/** What to ask: built lazily, on press, so nothing is gathered until someone wants it. */
export interface AskSpec {
  kind: 'line' | 'block' | 'node';
  /** The code asked about (the cache key's first half). */
  code: string;
  build: () => Promise<BuiltPrompt>;
}

const IDLE: AnswerState = { phase: 'idle', text: '', cached: false, used: [], checking: false };

export function useModelAnswer() {
  const [state, setState] = useState<AnswerState>(IDLE);
  const abort = useRef<AbortController | null>(null);
  const pending = useRef<AskSpec | null>(null);
  const lastReq = useRef<ExplainRequest | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; abort.current?.abort(); }, []);

  const set = useCallback((s: AnswerState | ((o: AnswerState) => AnswerState)) => { if (alive.current) setState(s); }, []);

  const run = useCallback(async (spec: AskSpec) => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    const m = useExplainModel.getState();
    if (!m.enabled || !m.downloaded) { pending.current = spec; set({ ...IDLE, phase: 'offer' }); return; }
    set({ ...IDLE, phase: 'working', startedAt: Date.now() });
    try {
      const built = await spec.build();
      set(o => ({ ...o, used: built.used, check: built.check, lineNo: built.lineNo }));
      const req: ExplainRequest = { kind: spec.kind, code: spec.code, context: built.context, messages: built.messages, maxTokens: built.maxTokens };
      lastReq.current = req;
      const r = await explainStream(req, soFar => set(o => ({ ...o, phase: 'working', text: soFar })), ctl.signal);
      if (ctl.signal.aborted || r.ok === false && r.reason === 'aborted') return;
      if (r.ok) set(o => ({ ...o, phase: 'done', text: r.meta?.raw ?? r.text, cached: r.cached, meta: r.meta }));
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
    set(o => (o.phase === 'working' ? { ...o, phase: o.text ? 'done' : 'idle' } : o.compare ? { ...o, compare: o.compare.map(c => (c.state === 'running' || c.state === 'waiting' ? { ...c, state: 'failed', error: 'Stopped.' } : c)) } : o));
  }, [set]);

  const dismiss = useCallback(() => { abort.current?.abort(); pending.current = null; set(IDLE); }, [set]);

  /** The double-check: two more answers at temperature 0.7; the dots then include whether they agree. */
  const doubleCheck = useCallback(async () => {
    const req = lastReq.current;
    if (!req) return;
    const ctl = new AbortController();
    abort.current = ctl;
    set(o => ({ ...o, checking: true }));
    const samples = await explainSamples(req, 2, ctl.signal);
    set(o => ({ ...o, checking: false, samples: ctl.signal.aborted ? o.samples : samples }));
  }, [set]);

  /** Compare models: the same prompt, one downloaded model after another. */
  const compare = useCallback(async () => {
    const req = lastReq.current;
    if (!req) return;
    const ctl = new AbortController();
    abort.current = ctl;
    const ids = useExplainModel.getState().downloadedIds;
    set(o => ({ ...o, compare: ids.map(modelId => ({ modelId, state: 'waiting', text: '' })) }));
    const upd = (id: string, f: (c: CompareEntry) => CompareEntry) => set(o => ({ ...o, compare: o.compare?.map(c => (c.modelId === id ? f(c) : c)) }));
    await explainCompare(
      req,
      (r: CompareResult) => upd(r.modelId, c => ({ ...c, state: r.ok ? 'done' : 'failed', text: r.meta?.raw ?? r.text, meta: r.meta, error: r.error })),
      ctl.signal,
      id => upd(id, c => ({ ...c, state: 'running', startedAt: Date.now() })),
      (id, soFar) => upd(id, c => ({ ...c, text: soFar })),
    );
  }, [set]);

  const closeCompare = useCallback(() => { abort.current?.abort(); set(o => ({ ...o, compare: undefined })); }, [set]);

  return { state, ask: run, confirmDownload, stop, dismiss, doubleCheck, compare, closeCompare };
}
