/**
 * Several explanation models (docs/explain-model.md): the registry, choosing the active one, downloading more than one,
 * a thinking model's larger budget, and Compare models (one after another, only one loaded at a time). The model is
 * a fake transport: nothing is downloaded or loaded.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear(),
  });
});

import { EXPLAIN_MODELS, EXPLAIN_MODEL, THINK_BUDGET, downloadBytes, maxTokensFor, modelById } from '../config';
import {
  downloadExplainModel, explainAnswerCache, explainCompare, explainSamples, explainStream, removeExplainModel, selectExplainModel, setExplainTransport,
  useExplainModel, type ExplainRequest, type ExplainTransport,
} from '../client';
import type { ExplainModelSpec } from '../config';

const req = (over: Partial<ExplainRequest> = {}): ExplainRequest => ({ kind: 'line', code: 'float g = 1.0', context: 'ctx', messages: [{ role: 'user', content: 'hi' }], maxTokens: 130, ...over });

/** A fake that records the order of loads, unloads and generates, and which model is "in memory". */
function fake(answers: Record<string, string> = {}) {
  const log: string[] = [];
  let loaded: string | null = null;
  const t: ExplainTransport = {
    load: vi.fn(async (spec: ExplainModelSpec) => {
      if (loaded) log.push(`free ${loaded}`);
      loaded = spec.id; log.push(`load ${spec.id}`);
      return { backend: 'webgpu' as const, ms: 3 };
    }),
    generate: vi.fn(async (_m, o) => {
      log.push(`generate ${loaded} max=${o.maxTokens}${o.temperature ? ` t=${o.temperature}` : ''}`);
      const text = answers[loaded!] ?? `answer from ${loaded}`;
      return { text, tokens: 10, ms: 100, logprobs: [{ t: text, lp: -0.1 }] };
    }),
    unload: vi.fn(async () => { log.push(`free ${loaded}`); loaded = null; }),
    dispose: vi.fn(),
  };
  return { t, log, inMemory: () => loaded };
}

beforeEach(() => {
  localStorage.clear();
  explainAnswerCache.clear();
  useExplainModel.setState({
    enabled: true, downloaded: true, activeId: EXPLAIN_MODEL.id, downloadedIds: [EXPLAIN_MODEL.id], loadedId: null, busyId: null,
    status: 'idle', progress: null, backend: null, error: null, tokensPerSec: null,
  });
});

describe('the registry', () => {
  it('lists the coder (default) and Qwen3 4B; all Apache-2.0, pinned, q4f16 on WebGPU', () => {
    expect(EXPLAIN_MODELS.map(m => m.id)).toEqual(['qwen2.5-coder-1.5b-instruct', 'qwen3-4b']);
    expect(EXPLAIN_MODEL.id).toBe('qwen2.5-coder-1.5b-instruct');
    for (const m of EXPLAIN_MODELS) {
      expect(m.licence).toBe('Apache-2.0');
      expect(m.revision).toMatch(/^[0-9a-f]{40}$/);
      expect(m.dtype.webgpu).toBe('q4f16');
      expect(m.repo).not.toMatch(/Phi/); // no ONNX web build of Phi-4-mini-reasoning exists
    }
  });
  it('the thinking models say so; their sizes match the files', () => {
    expect(EXPLAIN_MODELS.filter(m => m.thinks).map(m => m.id)).toEqual(['qwen3-4b']);
    expect(downloadBytes('webgpu', EXPLAIN_MODEL)).toBeGreaterThan(1.3e9);
    expect(downloadBytes('webgpu', EXPLAIN_MODEL)).toBeLessThan(1.5e9);
    expect(downloadBytes('webgpu', modelById('qwen3-4b'))).toBeGreaterThan(2.7e9);
    expect(modelById('qwen3-4b').large).toBe(true);
    expect(modelById('qwen3-4b').weights.wasm).toBeUndefined();
  });
  it('an unknown id falls back to the default', () => {
    expect(modelById('nope')).toBe(EXPLAIN_MODEL);
    expect(modelById(null)).toBe(EXPLAIN_MODEL);
  });
  it('a thinking model gets a larger budget that includes its reasoning', () => {
    expect(maxTokensFor(modelById('qwen2.5-coder-1.5b-instruct'), 130)).toBe(130);
    expect(maxTokensFor(modelById('qwen3-4b'), 130)).toBe(130 + THINK_BUDGET);
  });
});

describe('several models', () => {
  it('downloading a second keeps the first; the new one becomes the active one and is remembered', async () => {
    const { t, inMemory } = fake();
    setExplainTransport(t);
    await downloadExplainModel('qwen3-4b');
    const s = useExplainModel.getState();
    expect(s.downloadedIds).toEqual(['qwen2.5-coder-1.5b-instruct', 'qwen3-4b']);
    expect(s.activeId).toBe('qwen3-4b');
    expect(s.loadedId).toBe('qwen3-4b');
    expect(inMemory()).toBe('qwen3-4b');
    expect(localStorage.getItem('shader-studio:settings:explainModelActive')).toBe('qwen3-4b');
    expect(localStorage.getItem('shader-studio:settings:explainModelDownloaded:qwen3-4b')).toBe('1');
  });

  it('a failed first download of a model forgets it again and leaves the others alone', async () => {
    const t: ExplainTransport = { load: vi.fn(async () => { throw new Error('no space'); }), generate: vi.fn(), dispose: vi.fn() };
    setExplainTransport(t);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await downloadExplainModel('qwen3-4b')).toBe(false);
    expect(useExplainModel.getState().downloadedIds).toEqual(['qwen2.5-coder-1.5b-instruct']);
    expect(useExplainModel.getState().error).toBe('no space');
    warn.mockRestore();
  });

  it('choosing another downloaded model frees the loaded one; choosing one that is not downloaded is not usable', async () => {
    const { t, log } = fake();
    setExplainTransport(t);
    await explainStream(req(), () => {});
    expect(useExplainModel.getState().loadedId).toBe('qwen2.5-coder-1.5b-instruct');
    selectExplainModel('qwen3-4b'); // not downloaded
    expect(useExplainModel.getState()).toMatchObject({ activeId: 'qwen3-4b', loadedId: null, downloaded: false, status: 'idle' });
    expect(log).toContain('free qwen2.5-coder-1.5b-instruct');
    expect(await explainStream(req({ context: 'other' }), () => {})).toEqual({ ok: false, reason: 'not-downloaded' });
    useExplainModel.setState({ downloadedIds: ['qwen2.5-coder-1.5b-instruct', 'qwen3-4b'], downloaded: true });
    expect(await explainStream(req({ context: 'other' }), () => {})).toMatchObject({ ok: true });
    expect(useExplainModel.getState().loadedId).toBe('qwen3-4b');
  });

  it('the same question to different models is cached separately, and a thinking model is given its larger budget', async () => {
    const { t, log } = fake();
    setExplainTransport(t);
    useExplainModel.setState({ downloadedIds: ['qwen2.5-coder-1.5b-instruct', 'qwen3-4b'] });
    await explainStream(req(), () => {});
    selectExplainModel('qwen3-4b');
    const r = await explainStream(req(), () => {});
    expect(r).toMatchObject({ ok: true, cached: false });
    expect(log).toContain(`generate qwen2.5-coder-1.5b-instruct max=130`);
    expect(log).toContain(`generate qwen3-4b max=${130 + THINK_BUDGET}`);
    // asking the first again is a cache hit
    selectExplainModel('qwen2.5-coder-1.5b-instruct');
    expect(await explainStream(req(), () => {})).toMatchObject({ ok: true, cached: true });
  });

  it('the answer carries its token probabilities and speed', async () => {
    setExplainTransport(fake({ 'qwen2.5-coder-1.5b-instruct': '{"line":1}' }).t);
    const r = await explainStream(req(), () => {});
    expect(r.ok && r.meta).toMatchObject({ modelId: 'qwen2.5-coder-1.5b-instruct', raw: '{"line":1}', tokenCount: 10, tokensPerSec: 100 });
    expect(r.ok && r.meta?.tokens).toEqual([{ t: '{"line":1}', lp: -0.1 }]);
  });

  it('removing one model keeps the others and the setting; removing the last turns it off', async () => {
    const { t } = fake();
    setExplainTransport(t);
    useExplainModel.setState({ downloadedIds: ['qwen2.5-coder-1.5b-instruct', 'qwen3-4b'] });
    await removeExplainModel('qwen3-4b');
    expect(useExplainModel.getState()).toMatchObject({ downloadedIds: ['qwen2.5-coder-1.5b-instruct'], enabled: true, downloaded: true });
    await removeExplainModel('qwen2.5-coder-1.5b-instruct');
    expect(useExplainModel.getState()).toMatchObject({ downloadedIds: [], enabled: false, downloaded: false });
  });
});

describe('the double-check', () => {
  it('asks twice more at temperature 0.7 and does not cache them', async () => {
    const { t, log } = fake();
    setExplainTransport(t);
    const out = await explainSamples(req(), 2);
    expect(out).toHaveLength(2);
    expect(log.filter(l => l.startsWith('generate')).every(l => l.includes('t=0.7'))).toBe(true);
    expect(explainAnswerCache.size).toBe(0);
  });
  it('gives nothing when the model is off', async () => {
    const { t } = fake();
    setExplainTransport(t);
    useExplainModel.setState({ enabled: false });
    expect(await explainSamples(req(), 2)).toEqual([]);
  });
});

describe('Compare models', () => {
  it('runs the same prompt on every downloaded model one after another, freeing each before loading the next', async () => {
    const { t, log } = fake({ 'qwen2.5-coder-1.5b-instruct': 'A', 'qwen3-4b': 'B' });
    setExplainTransport(t);
    useExplainModel.setState({ downloadedIds: ['qwen2.5-coder-1.5b-instruct', 'qwen3-4b'] });
    const started: string[] = [], done: string[] = [];
    const results = await explainCompare(req(), r => done.push(r.modelId), undefined, id => started.push(id));
    expect(results.map(r => [r.modelId, r.ok, r.text])).toEqual([['qwen2.5-coder-1.5b-instruct', true, 'A'], ['qwen3-4b', true, 'B']]);
    expect(started).toEqual(['qwen2.5-coder-1.5b-instruct', 'qwen3-4b']);
    expect(done).toEqual(started);
    expect(log).toEqual([
      'load qwen2.5-coder-1.5b-instruct', 'generate qwen2.5-coder-1.5b-instruct max=130',
      'free qwen2.5-coder-1.5b-instruct', 'load qwen3-4b', `generate qwen3-4b max=${130 + THINK_BUDGET}`,
    ]);
    expect(results[1].meta?.tokensPerSec).toBe(100);
  });

  it('a model that fails to load is reported and the others still run', async () => {
    const calls: string[] = [];
    const t: ExplainTransport = {
      load: vi.fn(async spec => { calls.push(spec.id); if (spec.id === 'qwen3-4b') throw new Error('out of memory'); return { backend: 'webgpu' as const, ms: 1 }; }),
      generate: vi.fn(async () => ({ text: 'ok', tokens: 1, ms: 10 })),
      dispose: vi.fn(),
    };
    setExplainTransport(t);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useExplainModel.setState({ downloadedIds: ['qwen3-4b', 'qwen2.5-coder-1.5b-instruct'] });
    const results = await explainCompare(req(), () => {});
    expect(results.map(r => [r.modelId, r.ok])).toEqual([['qwen3-4b', false], ['qwen2.5-coder-1.5b-instruct', true]]);
    expect(results[0].error).toBe('out of memory');
    warn.mockRestore();
  });
});
