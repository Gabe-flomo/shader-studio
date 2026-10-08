/**
 * The explanation model (docs/explain-model.md): the grounded prompt built from fixture graphs (neighbours,
 * facts, techniques), the answer cache, the not-downloaded path and a mocked model stream. No model is ever
 * downloaded or loaded here: the transport is a fake.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear(),
  });
});

import type { GraphNode } from '../../types/nodeGraph';
import { AnswerCache, answerKey, hashText } from '../cache';
import { EXPLAIN_MODEL, MAX_TOKENS, blockTokens, downloadBytes, formatBytes } from '../config';
import {
  SYSTEM_PROMPT, buildExplainPrompt, colourWords, factLines, gatherFacts, neighboursOf, nodeContextFor, promptForBlock, promptForLine, noFacts,
  type NodeContext,
} from '../prompt';
import { functionSource, statementAt } from '../fnSource';
import { explainAnswerCache, explainStream, removeExplainModel, setExplainTransport, useExplainModel, type ExplainRequest, type ExplainTransport } from '../client';

// ── Fixture graph: Distance → Glow (Expression Block) → Output ────────────────

const node = (id: string, type: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id, type, position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: {}, ...extra,
});

function fixture(): GraphNode[] {
  const dist = node('dist', 'length', { outputs: { result: { type: 'float', label: 'Result' } }, params: { label: 'Distance to centre' } });
  const glow = node('glow', 'exprNode', {
    inputs: { d: { type: 'float', label: 'd', connection: { nodeId: 'dist', outputKey: 'result' } }, t: { type: 'float', label: 't' } },
    outputs: { result: { type: 'float', label: 'Result' } },
    params: {
      label: 'Soft glow',
      inputs: [{ name: 'd', type: 'float', slider: null }],
      lines: [{ lhs: 'float g', op: '=', rhs: 'exp(-d * 4.0)' }, { lhs: 'vec3 c', op: '=', rhs: 'vec3(1.0, 0.8, 0.55) * g' }],
      result: 'c',
    },
  });
  const out = node('out', 'output', { inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'glow', outputKey: 'result' } } } });
  return [dist, glow, out];
}

const namer = (t: string) => ({ length: 'Distance', exprNode: 'Expression Block', output: 'Output' } as Record<string, string>)[t];

describe('neighbours from the graph', () => {
  it('lists what feeds the node and what it feeds, by name', () => {
    const n = neighboursOf(fixture(), 'glow', namer);
    expect(n.upstream).toEqual([{ name: 'Distance to centre (Distance)', type: 'length', socket: 'd' }]);
    expect(n.downstream).toEqual([{ name: 'Output', type: 'output', socket: 'result' }]);
  });

  it('is empty for a node nobody wires', () => {
    expect(neighboursOf([node('x', 'time')], 'x')).toEqual({ upstream: [], downstream: [] });
    expect(neighboursOf(fixture(), 'missing')).toEqual({ upstream: [], downstream: [] });
  });

  it('builds the node context with its kind and label', () => {
    const c = nodeContextFor(fixture(), 'glow', namer)!;
    expect(c.kind).toBe('Expression Block');
    expect(c.label).toBe('Soft glow');
    expect(c.upstream).toHaveLength(1);
    expect(nodeContextFor(fixture(), 'nope')).toBeUndefined();
  });
});

describe('facts our rule-based explainer already knows', () => {
  it('names the idiom, the function, the types and the rule-based reading of a line', () => {
    const f = gatherFacts('float g = exp(-d * 4.0)', { types: { d: 'float' } });
    const all = factLines(f).join('\n');
    expect(f.reading).toBeTruthy();
    expect(all).toMatch(/Exponential glow/i);
    expect(all).toMatch(/Function exp: gives/);
    expect(all).toMatch(/Types: d: float/);
  });

  it('says what the global names mean (time, resolution, uv)', () => {
    const f = gatherFacts('float w = sin(uv.x * 6.0 - u_time) * u_resolution.x');
    const names = f.names.join('\n');
    expect(names).toMatch(/uv is/);
    expect(names).toMatch(/u_time is the clock/);
    expect(names).toMatch(/u_resolution is the canvas size/);
  });

  it('names a colour literal in words', () => {
    expect(colourWords(1, 0.8, 0.55)).toBe('a light warm orange');
    expect(colourWords(0.1, 0.2, 0.9)).toMatch(/blue/);
    expect(colourWords(0.5, 0.5, 0.5)).toBe('a mid grey');
    expect(gatherFacts('vec3 c = vec3(1.0, 0.8, 0.55) * g').colours[0]).toMatch(/is the colour a light warm orange/);
  });

  it('uses a technique only when it was found in this very line', () => {
    const node: NodeContext = {
      kind: 'Expression Block', upstream: [], downstream: [],
      techniques: [
        { name: 'Exponential falloff', explain: 'Brightness halves every fixed step away.', lines: ['float g = exp(-d * 4.0)'] },
        { name: 'Mix by a mask', explain: 'Blend two colours.', lines: ['vec3 c = mix(a, b, m)'] },
      ],
    };
    const f = gatherFacts('float  g = exp(-d * 4.0)', { types: { d: 'float' } }, node);
    expect(f.techniques).toEqual(['Exponential falloff: Brightness halves every fixed step away.']);
  });
});

describe('the prompt', () => {
  const nodes = fixture();
  const enclosing = 'float g = exp(-d * 4.0)\nvec3 c = vec3(1.0, 0.8, 0.55) * g\nreturn c';

  it('carries the line, its neighbours, the earlier lines and the facts', () => {
    const p = promptForLine('vec3 c = vec3(1.0, 0.8, 0.55) * g', { nodeId: 'glow', nodes, namer, enclosing, where: 'line 2 of 2', ctx: { types: { g: 'float' } } });
    const user = p.messages[p.messages.length - 1];
    expect(p.messages[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(user.role).toBe('user');
    expect(user.content).toContain('Node: Expression Block called "Soft glow"');
    expect(user.content).toContain('Fed by: Distance to centre (Distance) -> d');
    expect(user.content).toContain('Feeds: Output (from result)');
    expect(user.content).toContain('Earlier lines:\nfloat g = exp(-d * 4.0)');
    expect(user.content).not.toContain('return c'); // later lines are not offered: they invite guessing
    expect(user.content).toContain('FACTS');
    expect(user.content).toMatch(/Colour: vec3\(1\.0, 0\.8, 0\.55\) is the colour a light warm orange/);
    expect(user.content).toContain('vec3 c = vec3(1.0, 0.8, 0.55) * g');
    expect(p.used.length).toBeGreaterThan(1);
    expect(p.maxTokens).toBe(MAX_TOKENS.line);
  });

  it('is worded to explain the effect on the picture, shortly, without restating the code', () => {
    expect(SYSTEM_PROMPT).toMatch(/what the line does to the picture and why/);
    expect(SYSTEM_PROMPT).toMatch(/at most 2 short sentences/);
    expect(SYSTEM_PROMPT).toMatch(/do not repeat the code/);
    expect(SYSTEM_PROMPT).toMatch(/Not sure why/);
  });

  it('is the same prompt for the same graph and line, and a different context for a different graph', () => {
    const a = promptForLine('float g = exp(-d * 4.0)', { nodeId: 'glow', nodes, namer, enclosing });
    const b = promptForLine('float g = exp(-d * 4.0)', { nodeId: 'glow', nodes, namer, enclosing });
    expect(a.context).toBe(b.context);
    const other = nodes.map(n => (n.id === 'dist' ? { ...n, params: { label: 'Other' } } : n));
    const c = promptForLine('float g = exp(-d * 4.0)', { nodeId: 'glow', nodes: other, namer, enclosing });
    expect(c.context).not.toBe(a.context);
  });

  it('works with no graph at all (the GLSL page)', () => {
    const p = promptForLine('float g = exp(-d * 4.0)', { kind: 'GLSL page' });
    expect(p.messages[p.messages.length - 1].content).toContain('Node: GLSL page');
  });

  it('a block asks for a summary and one numbered sentence per line, with each line’s rule-based reading', () => {
    const p = promptForBlock(enclosing, { nodeId: 'glow', nodes, namer });
    const user = p.messages[1].content;
    expect(p.messages[0].content).toMatch(/exactly/);
    expect(user).toContain('1: float g = exp(-d * 4.0)');
    expect(user).toContain('Summary: <');
    expect(user).toContain('3: <one short sentence');
    expect(user).toContain('Rule-based reading of each line');
    expect(p.maxTokens).toBe(blockTokens(3));
    expect(p.maxTokens).toBeLessThanOrEqual(MAX_TOKENS.block);
  });

  it('keeps long code short', () => {
    const long = Array.from({ length: 60 }, (_, i) => `float a${i} = ${i}.0 * x`).join('\n');
    const p = buildExplainPrompt({ scope: 'block', code: long, facts: noFacts() });
    expect(p.messages[1].content.length).toBeLessThan(6000);
    expect(p.maxTokens).toBeLessThanOrEqual(MAX_TOKENS.block);
  });
});

describe('function source helpers', () => {
  const code = 'float ring(vec2 p, float r) {\n  return abs(length(p) - r);\n}\nvoid main() {\n  float d = ring(uv, 0.3);\n}';
  it('finds a user function’s whole declaration', () => {
    expect(functionSource(code, 'ring')).toBe('float ring(vec2 p, float r) {\n  return abs(length(p) - r);\n}');
    expect(functionSource(code, 'nothing')).toBeNull();
  });
  it('finds the statement a call is in', () => {
    expect(statementAt(code, code.indexOf('ring(uv'))).toMatch(/float d = ring\(uv, 0\.3\)/);
  });
});

describe('the answer cache', () => {
  it('keys by code and context, kind included', () => {
    expect(answerKey('line', 'a', 'x')).toBe(answerKey('line', 'a', 'x'));
    expect(answerKey('line', 'a', 'x')).not.toBe(answerKey('line', 'a', 'y'));
    expect(answerKey('line', 'a', 'x')).not.toBe(answerKey('line', 'b', 'x'));
    expect(answerKey('line', 'a', 'x')).not.toBe(answerKey('block', 'a', 'x'));
    expect(hashText('abc')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('forgets the least recently used first', () => {
    const c = new AnswerCache(2);
    c.set('a', '1'); c.set('b', '2');
    expect(c.get('a')).toBe('1'); // a is fresh again
    c.set('c', '3');
    expect(c.has('b')).toBe(false);
    expect(c.get('a')).toBe('1');
    expect(c.get('c')).toBe('3');
    expect(c.size).toBe(2);
  });
});

describe('sizes', () => {
  it('uses the Apache-2.0 1.5B coder, never the 3B', () => {
    expect(EXPLAIN_MODEL.repo).toBe('onnx-community/Qwen2.5-Coder-1.5B-Instruct');
    expect(EXPLAIN_MODEL.licence).toBe('Apache-2.0');
    expect(EXPLAIN_MODEL.repo).not.toMatch(/3B/);
    expect(EXPLAIN_MODEL.revision).toMatch(/^[0-9a-f]{40}$/);
  });
  it('the download is about a gigabyte and a third on WebGPU, more on WebAssembly', () => {
    expect(downloadBytes('webgpu')).toBeGreaterThan(1.3e9);
    expect(downloadBytes('webgpu')).toBeLessThan(1.5e9);
    expect(downloadBytes('wasm')).toBeGreaterThan(downloadBytes('webgpu'));
    expect(formatBytes(1_355_000_000)).toBe('1.4 GB');
    expect(formatBytes(640_000_000)).toBe('640 MB');
  });
});

// ── The model, mocked ─────────────────────────────────────────────────────────

function fakeTransport(pieces: string[]) {
  const calls: Array<{ messages: unknown; maxTokens: number }> = [];
  const t: ExplainTransport = {
    load: vi.fn(async () => ({ backend: 'webgpu' as const, ms: 5 })),
    generate: vi.fn(async (messages, o, onText) => {
      calls.push({ messages, maxTokens: o.maxTokens });
      for (const p of pieces) onText(p);
      return { text: pieces.join(''), tokens: pieces.length, ms: 100 };
    }),
    dispose: vi.fn(),
  };
  return { t, calls };
}

const req = (over: Partial<ExplainRequest> = {}): ExplainRequest => ({
  kind: 'line', code: 'float g = exp(-d * 4.0)', context: 'ctx', messages: [{ role: 'user', content: 'hi' }], maxTokens: 90, ...over,
});

describe('asking the model', () => {
  beforeEach(() => {
    explainAnswerCache.clear();
    useExplainModel.setState({ enabled: true, downloaded: true, status: 'idle', progress: null, backend: null, error: null, tokensPerSec: null });
  });

  it('the not-downloaded path: nothing loads, and the caller is told to offer the download', async () => {
    const { t } = fakeTransport(['x']);
    setExplainTransport(t);
    useExplainModel.setState({ enabled: true, downloaded: false });
    const r = await explainStream(req(), () => {});
    expect(r).toEqual({ ok: false, reason: 'not-downloaded' });
    expect(t.load).not.toHaveBeenCalled();
    expect(t.generate).not.toHaveBeenCalled();
  });

  it('off: nothing loads either', async () => {
    const { t } = fakeTransport(['x']);
    setExplainTransport(t);
    useExplainModel.setState({ enabled: false, downloaded: true });
    expect(await explainStream(req(), () => {})).toEqual({ ok: false, reason: 'off' });
    expect(t.load).not.toHaveBeenCalled();
  });

  it('streams the pieces into the UI as they come, then caches the answer', async () => {
    const { t, calls } = fakeTransport(['Makes a ', 'soft glow ', 'around the shape.']);
    setExplainTransport(t);
    const seen: string[] = [];
    const r = await explainStream(req(), s => seen.push(s));
    expect(seen).toEqual(['Makes a ', 'Makes a soft glow ', 'Makes a soft glow around the shape.']);
    expect(r).toEqual({ ok: true, text: 'Makes a soft glow around the shape.', cached: false });
    expect(calls[0].maxTokens).toBe(90);
    expect(useExplainModel.getState().status).toBe('ready');
    expect(useExplainModel.getState().backend).toBe('webgpu');
    expect(useExplainModel.getState().tokensPerSec).toBe(30);

    // The same code in the same context: answered from the cache, the model not asked again
    const seen2: string[] = [];
    const again = await explainStream(req(), s => seen2.push(s));
    expect(again).toEqual({ ok: true, text: 'Makes a soft glow around the shape.', cached: true });
    expect(seen2).toEqual(['Makes a soft glow around the shape.']);
    expect(t.generate).toHaveBeenCalledTimes(1);

    // Another context is a new question
    await explainStream(req({ context: 'other' }), () => {});
    expect(t.generate).toHaveBeenCalledTimes(2);
  });

  it('a failed load is reported, not thrown, and not retried on every press', async () => {
    const t: ExplainTransport = { load: vi.fn(async () => { throw new Error('no webgpu, no wasm'); }), generate: vi.fn(), dispose: vi.fn() };
    setExplainTransport(t);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await explainStream(req(), () => {});
    expect(r).toMatchObject({ ok: false, reason: 'failed', message: 'no webgpu, no wasm' });
    expect(useExplainModel.getState().status).toBe('error');
    await explainStream(req({ context: 'another' }), () => {});
    expect(t.load).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('a stopped answer is not cached', async () => {
    const ctl = new AbortController();
    const t: ExplainTransport = {
      load: async () => ({ backend: 'wasm', ms: 1 }),
      generate: async (_m, _o, onText) => { onText('half an'); ctl.abort(); return { text: 'half an', tokens: 2, ms: 10 }; },
      dispose: () => {},
    };
    setExplainTransport(t);
    expect(await explainStream(req(), () => {}, ctl.signal)).toEqual({ ok: false, reason: 'aborted' });
    expect(explainAnswerCache.size).toBe(0);
  });

  it('removing the model forgets the download and the answers', async () => {
    const { t } = fakeTransport(['x']);
    setExplainTransport(t);
    await explainStream(req(), () => {});
    expect(explainAnswerCache.size).toBe(1);
    await removeExplainModel();
    const s = useExplainModel.getState();
    expect(s).toMatchObject({ enabled: false, downloaded: false, status: 'idle' });
    expect(explainAnswerCache.size).toBe(0);
    expect(t.dispose).toHaveBeenCalled();
  });
});
