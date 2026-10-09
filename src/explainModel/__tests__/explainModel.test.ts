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
  SYSTEM_PROMPT, buildExplainPrompt, colourWords, factLines, gatherFacts, lineNumberOf, neighboursOf, nodeContextFor, promptForBlock, promptForLine, noFacts,
} from '../prompt';
import { describeInputs, type NodeDescriber } from '../inputs';
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
  it('lists what feeds the node and what it feeds, by node TYPE name (never the user’s label)', () => {
    const n = neighboursOf(fixture(), 'glow', namer);
    expect(n.upstream).toEqual([{ name: 'Distance', type: 'length', socket: 'd' }]);
    expect(n.downstream).toEqual([{ name: 'Output', type: 'output', socket: 'result', input: 'color' }]);
  });

  it('is empty for a node nobody wires', () => {
    expect(neighboursOf([node('x', 'time')], 'x')).toEqual({ upstream: [], downstream: [] });
    expect(neighboursOf(fixture(), 'missing')).toEqual({ upstream: [], downstream: [] });
  });

  it('builds the node context with its kind, never its label', () => {
    const c = nodeContextFor(fixture(), 'glow', namer)!;
    expect(c.kind).toBe('Expression Block');
    expect(JSON.stringify(c)).not.toContain('Soft glow');
    expect(c.upstream).toHaveLength(1);
    expect(nodeContextFor(fixture(), 'nope')).toBeUndefined();
  });
});

describe('facts: looked up, never the rule-based readings', () => {
  it('says what each function does, and nothing of the rule-based reading, idioms or steps', () => {
    const f = gatherFacts('float g = exp(-d * 4.0)');
    const all = factLines(f).join('\n');
    expect(all).toMatch(/Function exp: gives/);
    expect(all).not.toMatch(/Exponential glow|Idiom|reading|First|Then/i);
    expect(Object.keys(f).sort()).toEqual(['colours', 'functions', 'measured', 'names', 'trace']);
  });

  it('leaves out constructors (vec3(…) only builds a value)', () => {
    expect(gatherFacts('vec3 c = vec3(1.0, 0.8, 0.55) * g').functions).toEqual([]);
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
});

describe('the prompt: code only, inputs by type, no user labels', () => {
  const nodes = fixture();
  const enclosing = 'float g = exp(-d * 4.0)\nvec3 c = vec3(1.0, 0.8, 0.55) * g\nreturn c';
  const describe_: NodeDescriber = t => (t === 'length'
    ? { label: 'Length', description: 'Distance from a vector to the origin, multiplied by scale.', outputs: { result: 'Output' } }
    : undefined);

  it('carries the kind, the inputs, the code up to the line, the facts and the line number', () => {
    const p = promptForLine('vec3 c = vec3(1.0, 0.8, 0.55) * g', { nodeId: 'glow', nodes, namer, describe: describe_, enclosing, where: 'line 2 of 2', ctx: { types: { g: 'float' } } });
    const user = p.messages[p.messages.length - 1];
    expect(p.messages[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(user.role).toBe('user');
    expect(user.content).toContain('Kind: Expression Block');
    expect(user.content).toContain('- d: float, from a Length node (float): distance from the origin of a vector');
    expect(user.content).toContain('- t: float, built in: time in seconds');
    expect(user.content).toContain("The block's result feeds: the color input of an Output node");
    expect(user.content).toContain('Code:\n1: float g = exp(-d * 4.0)\n2: vec3 c = vec3(1.0, 0.8, 0.55) * g');
    expect(user.content).not.toContain('return c'); // later lines are not offered: they invite guessing
    expect(user.content).toContain('FACTS about line 2');
    expect(user.content).toContain('- Built from: g: made on line 1 (float g = exp(-d * 4.0)), from the input d (a Length node)');
    expect(user.content).toMatch(/Colour: vec3\(1\.0, 0\.8, 0\.55\) is the colour a light warm orange/);
    expect(user.content).toMatch(/- Measured: line 1, g: [\d.]+ at the sample pixel; across the picture [\d.]+\.\.[\d.]+/);
    expect(user.content).toMatch(/- Measured: line 2, c: \([\d., ]+\) at the sample pixel; across the picture x /);
    expect(user.content).toContain('Explain line 2 only.');
    expect(p.lineNo).toBe(2);
    expect(p.used.some(u => u.startsWith('Input d: float'))).toBe(true);
    expect(p.maxTokens).toBe(MAX_TOKENS.line);
  });

  it('never contains a node label, a title or a neighbour’s label, anywhere in any message', () => {
    const labelled = nodes.map(n => ({ ...n, params: { ...n.params, label: n.id === 'glow' ? 'MOONLIGHT glow' : 'SKYLINE source', title: 'MOONLIGHT title' } }));
    const scope = { nodeId: 'glow', nodes: labelled, namer, describe: describe_, enclosing };
    for (const p of [promptForLine('float g = exp(-d * 4.0)', scope), promptForBlock(enclosing, scope)]) {
      const all = JSON.stringify(p.messages) + p.context + p.used.join('\n');
      expect(all).not.toMatch(/MOONLIGHT|SKYLINE/);
      expect(all).not.toContain('Technique');
      // What it feeds is there, by node type
      expect(all).toContain('an Output node');
    }
  });

  it('never carries the rule-based readings, idioms or steps', () => {
    const scope = { nodeId: 'glow', nodes, namer, describe: describe_, enclosing };
    for (const p of [promptForLine('float g = exp(-d * 4.0)', scope), promptForLine('vec3 c = vec3(1.0, 0.8, 0.55) * g', scope), promptForBlock(enclosing, scope)]) {
      const all = JSON.stringify(p.messages) + p.context + p.used.join('\n');
      expect(all).not.toMatch(/rule-based|Idiom|literally|Exponential glow|usually used for|reading of/i);
    }
  });

  it('describes inputs by the upstream node TYPE and its output, not by what a person called it', () => {
    const labelled = nodes.map(n => (n.id === 'dist' ? { ...n, params: { label: 'Cloud height' } } : n));
    const [d, t] = describeInputs(labelled, 'glow', describe_);
    expect(d.text).toBe('d: float, from a Length node (float): distance from the origin of a vector (0 or more)');
    expect(d.text).not.toContain('Cloud');
    expect(d.source).toBe('a Length node');
    expect(t.name).toBe('t');
  });

  it('traces a normal, a colour constant and earlier lines back to their sources', () => {
    const g: GraphNode[] = [
      node('march', 'marchLoop', { outputs: { normal: { type: 'vec3', label: 'Normal' }, dist: { type: 'float', label: 'Dist' } }, params: { label: 'MY SCENE' } }),
      node('col', 'colorPicker', { params: { color: [0.8, 0.45, 0.25], label: 'Sunset' } }),
      node('b', 'exprNode', {
        inputs: {
          n: { type: 'vec3', label: 'n', connection: { nodeId: 'march', outputKey: 'normal' } },
          warm: { type: 'vec3', label: 'warm', connection: { nodeId: 'col', outputKey: 'rgb' } },
        },
        params: { inputs: [{ name: 'n', type: 'vec3', slider: null }, { name: 'warm', type: 'vec3', slider: null }] },
      }),
      node('o', 'output', { inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'b', outputKey: 'result' } } } }),
    ];
    const describe2: NodeDescriber = t => ({
      marchLoop: { label: 'March Loop', outputs: { normal: 'Normal', dist: 'Dist' }, outputTypes: { normal: 'vec3', dist: 'float' }, outputHints: { normal: 'The direction the surface faces where the ray hit.' } },
      colorPicker: { label: 'Color', outputs: { rgb: 'Color', r: 'R' } },
      output: { label: 'Output', inputs: { color: 'Color' } },
    } as Record<string, ReturnType<NodeDescriber>>)[t];
    const namer2 = (t: string) => ({ marchLoop: 'March Loop', colorPicker: 'Color', output: 'Output', exprNode: 'Expression Block' } as Record<string, string>)[t];
    const code = 'float sky = 0.5 + 0.5 * n.y\nvec3 col = mix(warm, vec3(0.4, 0.6, 1.0), sky)\nreturn col';
    const p = promptForLine('vec3 col = mix(warm, vec3(0.4, 0.6, 1.0), sky)', { nodeId: 'b', nodes: g, namer: namer2, describe: describe2, enclosing: code });
    const user = p.messages[p.messages.length - 1].content;
    expect(user).toContain('- n: vec3, from the Normal output of a March Loop node (vec3, unit length): The direction the surface faces where the ray hit');
    expect(user).toContain('- warm: vec3, from a Color node: the fixed value (0.8, 0.45, 0.25), the colour a mid warm orange');
    expect(user).toContain('- Built from: sky: made on line 1 (float sky = 0.5 + 0.5 * n.y), from the input n (the Normal output of a March Loop node)');
    expect(user).toContain("The block's result feeds: the Color input of an Output node");
    // n is drawn as unit-length directions, so sky = 0.5 + 0.5 * n.y stays in 0..1
    const sky = /Measured: line 1, sky: ([\d.]+) at the sample pixel; across the picture ([\d.]+)\.\.([\d.]+)/.exec(user)!;
    expect(Number(sky[2])).toBeGreaterThanOrEqual(0);
    expect(Number(sky[3])).toBeLessThanOrEqual(1);
    expect(user).toContain('n = (0.3, 0.8, 0.52) at the sample pixel, drawn over random unit-length directions');
    expect(user).toContain('warm = (0.8, 0.45, 0.25) (fixed)');
    expect(user).not.toMatch(/MY SCENE|Sunset/);
  });

  it('says when a measurement rests on a guessed range, and never calls it "the same everywhere"', () => {
    const g: GraphNode[] = [
      node('src', 'mystery', { outputs: { out: { type: 'float', label: 'Out' } } }),
      node('b', 'exprNode', { inputs: { k: { type: 'float', label: 'k', connection: { nodeId: 'src', outputKey: 'out' } } }, params: { inputs: [{ name: 'k', type: 'float', slider: null }] } }),
    ];
    const p = promptForLine('float m = step(5.0, k)', { nodeId: 'b', nodes: g, enclosing: 'float m = step(5.0, k)' });
    const user = p.messages[p.messages.length - 1].content;
    expect(user).toContain('no change over the guessed range (a guess: k assumed to run 0..1)');
    expect(user).not.toContain('the same everywhere');
    expect(user).toContain('(assumed: nothing says its range)');
  });

  it('knows what the common sources give, with their ranges', () => {
    const g: GraphNode[] = [
      node('u', 'uv', { outputs: { uv: { type: 'vec2', label: 'UV' } } }),
      node('time', 'time'),
      node('noise', 'fbm'),
      node('k', 'constant', { params: { value: 0.25 } }),
      node('b', 'exprNode', {
        inputs: {
          uv: { type: 'vec2', label: 'uv', connection: { nodeId: 'u', outputKey: 'uv' } },
          t: { type: 'float', label: 't', connection: { nodeId: 'time', outputKey: 'time' } },
          h: { type: 'float', label: 'h', connection: { nodeId: 'noise', outputKey: 'out' } },
          k: { type: 'float', label: 'k', connection: { nodeId: 'k', outputKey: 'value' } },
          s: { type: 'float', label: 's' },
          z: { type: 'float', label: 'z' },
        },
        params: { inputs: [
          { name: 'uv', type: 'vec2', slider: null }, { name: 't', type: 'float', slider: null }, { name: 'h', type: 'float', slider: null },
          { name: 'k', type: 'float', slider: null }, { name: 's', type: 'float', slider: { min: 0, max: 5 } }, { name: 'z', type: 'float', slider: null },
        ] },
      }),
    ];
    const byName = Object.fromEntries(describeInputs(g, 'b', t => ({ label: { uv: 'UV', time: 'Time', fbm: 'Fractal Noise (FBM)', constant: 'Constant' }[t as string] ?? t })).map(i => [i.name, i]));
    expect(byName.uv.text).toMatch(/^uv: vec2, from a UV node \(vec2\): pixel position, centred: \(0,0\) is the middle of the picture, x and y run about -1\.\.1/);
    expect(byName.uv.sample).toMatchObject({ value: [0.3, 0.2], range: [-1, 1] });
    expect(byName.t.text).toMatch(/^t: float, from a Time node: time in seconds/);
    expect(byName.t.sample).toMatchObject({ value: 2, range: [0, 10] });
    expect(byName.h.text).toMatch(/^h: float, from a Fractal Noise \(FBM\) node: smooth noise value, range 0\.\.1/);
    expect(byName.k.text).toBe('k: float, from a Constant node: the fixed value 0.25');
    expect(byName.k.sample).toMatchObject({ value: 0.25, range: [0.25, 0.25] });
    expect(byName.s.text).toBe('s: float, a slider on the node, range 0..5, now 2.5');
    expect(byName.s.numbers).toEqual([0, 5, 2.5]);
    expect(byName.z.text).toMatch(/not connected/);
  });

  it('does not let the generic name guess ("t is the clock") override a described input', () => {
    const p = promptForLine('float a = t * 2.0', { nodeId: 'glow', nodes, namer, enclosing: 'float a = t * 2.0' });
    expect(p.messages[p.messages.length - 1].content).not.toContain('Name: t is the clock');
  });

  it('is worded to give one short JSON object and trust the facts', () => {
    expect(SYSTEM_PROMPT).toMatch(/ONE JSON object/);
    expect(SYSTEM_PROMPT).toContain('"what"');
    expect(SYSTEM_PROMPT).toContain('"effect"');
    expect(SYSTEM_PROMPT).toContain('"sure"');
    expect(SYSTEM_PROMPT).toContain('"unsure_about"');
    expect(SYSTEM_PROMPT).toMatch(/never contradict the FACTS/);
  });

  it('is the same prompt for the same graph and line, and a different context when an input changes', () => {
    const a = promptForLine('float g = exp(-d * 4.0)', { nodeId: 'glow', nodes, namer, enclosing });
    const b = promptForLine('float g = exp(-d * 4.0)', { nodeId: 'glow', nodes, namer, enclosing });
    expect(a.context).toBe(b.context);
    const other = nodes.map(n => (n.id === 'glow' ? { ...n, params: { ...n.params, inputs: [{ name: 'd', type: 'float', slider: { min: 0, max: 3 } }] }, inputs: {} } : n));
    const c = promptForLine('float g = exp(-d * 4.0)', { nodeId: 'glow', nodes: other, namer, enclosing });
    expect(c.context).not.toBe(a.context);
  });

  it('works with no graph at all (the GLSL page)', () => {
    const p = promptForLine('float g = exp(-d * 4.0)', { kind: 'GLSL page' });
    const user = p.messages[p.messages.length - 1].content;
    expect(user).toContain('Kind: GLSL page');
    expect(user).toContain('Inputs: none');
  });

  it('finds the number of the line in its block', () => {
    expect(lineNumberOf('vec3 c = vec3(1.0, 0.8, 0.55) * g', enclosing)).toBe(2);
    expect(lineNumberOf('return c', enclosing)).toBe(3);
    expect(lineNumberOf('x = 1', undefined, 'line 4 of the block')).toBe(4);
    expect(lineNumberOf('x = 1', undefined)).toBe(1);
  });

  it('a block asks for one JSON object per line, then the summary of the whole block last', () => {
    const p = promptForBlock(enclosing, { nodeId: 'glow', nodes, namer, describe: describe_ });
    const user = p.messages[1].content;
    expect(p.messages[0].content).toMatch(/First one object for each code line, in order/);
    expect(p.messages[0].content).toMatch(/Then, last, \{"summary": "<two short sentences: what the whole block is for/);
    expect(user).toContain('1: float g = exp(-d * 4.0)');
    expect(user).toContain('3: return c');
    expect(user).toContain('one object for each of lines 1 to 3, one per row, then the summary object last');
    expect(user).toContain('- d: float, from a Length node');
    expect(user).toContain('- Line 2: built from g: made on line 1');
    expect(user).toMatch(/- Line 3: measured the result: \(/);
    expect(user).not.toMatch(/rule-based/i);
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
    useExplainModel.setState({ enabled: true, downloaded: true, activeId: EXPLAIN_MODEL.id, downloadedIds: [EXPLAIN_MODEL.id], loadedId: null, busyId: null, status: 'idle', progress: null, backend: null, error: null, tokensPerSec: null });
  });

  it('the not-downloaded path: nothing loads, and the caller is told to offer the download', async () => {
    const { t } = fakeTransport(['x']);
    setExplainTransport(t);
    useExplainModel.setState({ enabled: true, downloaded: false, downloadedIds: [] });
    const r = await explainStream(req(), () => {});
    expect(r).toEqual({ ok: false, reason: 'not-downloaded' });
    expect(t.load).not.toHaveBeenCalled();
    expect(t.generate).not.toHaveBeenCalled();
  });

  it('off: nothing loads either', async () => {
    const { t } = fakeTransport(['x']);
    setExplainTransport(t);
    useExplainModel.setState({ enabled: false, downloaded: true, downloadedIds: [EXPLAIN_MODEL.id] });
    expect(await explainStream(req(), () => {})).toEqual({ ok: false, reason: 'off' });
    expect(t.load).not.toHaveBeenCalled();
  });

  it('streams the pieces into the UI as they come, then caches the answer', async () => {
    const { t, calls } = fakeTransport(['Makes a ', 'soft glow ', 'around the shape.']);
    setExplainTransport(t);
    const seen: string[] = [];
    const r = await explainStream(req(), s => seen.push(s));
    expect(seen).toEqual(['Makes a ', 'Makes a soft glow ', 'Makes a soft glow around the shape.']);
    expect(r).toMatchObject({ ok: true, text: 'Makes a soft glow around the shape.', cached: false });
    expect(calls[0].maxTokens).toBe(90);
    expect(useExplainModel.getState().status).toBe('ready');
    expect(useExplainModel.getState().backend).toBe('webgpu');
    expect(useExplainModel.getState().tokensPerSec).toBe(30);

    // The same code in the same context: answered from the cache, the model not asked again
    const seen2: string[] = [];
    const again = await explainStream(req(), s => seen2.push(s));
    expect(again).toMatchObject({ ok: true, text: 'Makes a soft glow around the shape.', cached: true });
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
