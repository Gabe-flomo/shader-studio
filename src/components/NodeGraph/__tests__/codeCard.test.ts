/**
 * The Expression Block / Custom Function card face (codeCard/): the signature built from the
 * wiring and types, which pages exist, the remembered page, and the read-only code matching
 * what compiles.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); }, key: () => null, length: 0, clear: () => store.clear(),
  });
  return store;
});

import type { GraphNode } from '../../../types/nodeGraph';
import { ExprBlockNode, CustomFnNode } from '../../../nodes/definitions/effects';
import {
  cardPages, codeLinesFor, fnNameFrom, isEmptyCodeNode, parseSourceLabelsKey, resolvePage, signatureFor,
  signatureText, sourceLabelsFor, sourceLabelsKey, stepPage,
} from '../codeCard/codeCardModel';
import { CARD_PAGE_STORAGE_KEY, loadCardPages, useCardPages } from '../codeCard/cardPageStore';
import { highlightGlsl, highlightCacheSize } from '../codeCard/highlight';

type Inp = { name: string; type: string; slider?: { min: number; max: number } | null; carry?: boolean };

function expr(id: string, params: Record<string, unknown>, wired: Record<string, [string, string]> = {}): GraphNode {
  const inputs = (params.inputs as Inp[] | undefined) ?? [];
  const outType = (params.outputType as string) ?? 'vec3';
  return {
    id, type: 'exprNode', position: { x: 0, y: 0 },
    inputs: Object.fromEntries(inputs.map(i => [i.name, { type: i.type, label: i.name, ...(wired[i.name] ? { connection: { nodeId: wired[i.name][0], outputKey: wired[i.name][1] } } : {}) }])),
    outputs: { result: { type: outType, label: 'Result' } },
    params: { outputType: outType, ...params },
  } as unknown as GraphNode;
}
function fn(id: string, params: Record<string, unknown>): GraphNode {
  const inputs = (params.inputs as Inp[] | undefined) ?? [];
  return {
    id, type: 'customFn', position: { x: 0, y: 0 },
    inputs: Object.fromEntries(inputs.filter(i => i && i.name).map(i => [i.name, { type: i.type ?? "float", label: i.name }])),
    outputs: { result: { type: (params.outputType as string) ?? 'float', label: 'Result' } },
    params,
  } as unknown as GraphNode;
}
const src = (id: string, label: string, outKey: string, outLabel: string, type = 'float'): GraphNode => ({
  id, type: 'time', position: { x: 0, y: 0 }, inputs: {}, outputs: { [outKey]: { type, label: outLabel } }, params: { label },
} as unknown as GraphNode);

describe('signature', () => {
  it('reads the output type, each input type, and how each value arrives', () => {
    const uvNode = src('u', 'UV', 'uv', 'UV', 'vec2');
    const timeNode = src('t', 'Time', 'time', 'Time');
    const node = expr('e', {
      outputType: 'vec3',
      inputs: [{ name: 'uv', type: 'vec2' }, { name: 'time', type: 'float' }, { name: 'color', type: 'vec3' }, { name: 'gain', type: 'float', slider: { min: 0, max: 4 } }],
      gain: 1.5,
    }, { uv: ['u', 'uv'], time: ['t', 'time'] });
    const sig = signatureFor(node, sourceLabelsFor(node, [uvNode, timeNode, node], n => n.params.label as string));
    expect(signatureText(sig)).toBe('vec3 expression(vec2 uv, float time, vec3 color, float gain)');
    expect(sig.params.map(p => p.source)).toEqual(['wire', 'wire', 'unwired', 'slider']);
    expect(sig.params[0].from).toBe('UV · UV');
    expect(sig.params[1].from).toBe('Time · Time');
    expect(sig.params[3].value).toBe(1.5);
  });

  it('marks unwired inputs, a slider with no value at its midpoint, and loop carries', () => {
    const node = expr('e', {
      outputType: 'float',
      inputs: [{ name: 'a', type: 'float' }, { name: 'k', type: 'float', slider: { min: 0, max: 10 } }, { name: 'acc', type: 'vec2', carry: true }],
    });
    const sig = signatureFor(node);
    expect(sig.params.map(p => [p.name, p.type, p.source])).toEqual([['a', 'float', 'unwired'], ['k', 'float', 'slider'], ['acc', 'vec2', 'carry']]);
    expect(sig.params[1].value).toBe(5);
    expect(sig.returnType).toBe('float');
  });

  it('a wired slider input counts as wired; the socket type wins over a stale declared type', () => {
    const node = expr('e', { inputs: [{ name: 'x', type: 'float', slider: { min: 0, max: 1 } }] }, { x: ['s', 'v'] });
    (node.inputs.x as { type: string }).type = 'vec2';
    const sig = signatureFor(node, { x: 'Source · v' });
    expect(sig.params[0]).toMatchObject({ name: 'x', type: 'vec2', source: 'wire', from: 'Source · v' });
  });

  it('names the function from the label and lists exposed locals as out parameters', () => {
    const node = expr('e', { label: 'Spiral field', outputType: 'float', inputs: [{ name: 'angle', type: 'float' }], lines: [{ lhs: 'float ridge', op: '=', rhs: 'cos(angle)' }], result: 'ridge', outputs: ['ridge'] });
    node.outputs.ridge = { type: 'float', label: 'ridge' } as GraphNode['outputs'][string];
    expect(signatureText(signatureFor(node))).toBe('float spiral_field(float angle, out float ridge)');
  });

  it('a Custom Function shows its real signature: label, inputs, output type, out parameters', () => {
    const node = fn('f', {
      label: 'Ring Glow', outputType: 'vec3', body: 'return vec3(1.0);',
      inputs: [{ name: 'uv', type: 'vec2', slider: null }, { name: 'time', type: 'float', slider: null }],
      outputs: [{ name: 'mask', type: 'float' }, { name: '9bad', type: 'float' }, { name: 'result', type: 'float' }],
    });
    expect(signatureText(signatureFor(node))).toBe('vec3 ring_glow(vec2 uv, float time, out float mask)');
  });

  it('parses messy Custom Function params: default label, missing types, junk entries, no inputs array', () => {
    const node = fn('f', { label: 'Custom Function', inputs: [{ name: 'p' }, null, { name: '' }, { type: 'vec2' }], body: 'p' });
    expect(signatureText(signatureFor(node))).toBe('float custom_fn(float p)');
    const legacy = { ...fn('g', { body: '1.0' }), inputs: { q: { type: 'vec3', label: 'q' } } } as unknown as GraphNode;
    delete (legacy.params as Record<string, unknown>).inputs;
    expect(signatureText(signatureFor(legacy))).toBe('float custom_fn(vec3 q)');
  });

  it('turns labels into GLSL names', () => {
    expect(fnNameFrom('Ring Glow!', 'x')).toBe('ring_glow');
    expect(fnNameFrom('3 bands', 'x')).toBe('bands');
    expect(fnNameFrom('  ', 'expression')).toBe('expression');
  });

  it('round-trips the source-label key used by the store selector', () => {
    const labels = { uv: 'UV · UV', time: 'Time · Time' };
    expect(parseSourceLabelsKey(sourceLabelsKey(labels))).toEqual(labels);
    expect(sourceLabelsKey({ b: '1', a: '2' })).toBe(sourceLabelsKey({ a: '2', b: '1' }));
    expect(parseSourceLabelsKey('')).toEqual({});
  });
});

describe('pages', () => {
  it('an empty block shows only the signature; the definition\'s help is never a page', () => {
    const fresh = expr('e', { inputs: [{ name: 'a', type: 'float' }], lines: [], result: 'a', outputType: 'float' });
    expect(isEmptyCodeNode(fresh)).toBe(true);
    expect(cardPages(fresh)).toEqual(['signature']);
    expect(cardPages({ ...fresh, params: { ...fresh.params, __description: '  ' } } as GraphNode)).toEqual(['signature']);
    expect(cardPages({ ...fresh, params: { ...fresh.params, __description: 'Doubles a' } } as GraphNode)).toEqual(['signature', 'description']);
  });

  it('lines, a result of its own, a note, a credit and a description each add their page', () => {
    const withLines = expr('e', { inputs: [{ name: 'a', type: 'float' }], lines: [{ lhs: 'a', op: '*=', rhs: '2.0' }], result: 'a' });
    expect(cardPages(withLines)).toEqual(['code', 'signature']);
    const resultOnly = expr('e', { inputs: [{ name: 'a', type: 'float' }], lines: [], result: 'a * 2.0' });
    expect(cardPages(resultOnly)).toEqual(['code', 'signature']);
    const incomplete = expr('e', { inputs: [{ name: 'a', type: 'float' }], lines: [{ lhs: 'a', op: '=', rhs: '' }], result: 'a' });
    expect(isEmptyCodeNode(incomplete)).toBe(true);
    const noted = expr('e', { inputs: [], lines: [{ lhs: 'p', op: '=', rhs: 'vec3(1.0)' }], result: 'p', __comment: '  why  ', __description: 'what' });
    expect(cardPages(noted)).toEqual(['code', 'signature', 'note', 'description']);
    const blankNote = expr('e', { inputs: [], lines: [], result: '', __comment: '   ' });
    expect(cardPages(blankNote)).toEqual(['signature']);
    const credited = expr('e', { inputs: [], lines: [], result: '', __credit: { title: 'x' } });
    expect(cardPages(credited)).toContain('note');
  });

  it('a Custom Function with the default or an empty body has no code page', () => {
    expect(cardPages(fn('f', { body: '0.0', inputs: [] }))).toEqual(['signature']);
    expect(cardPages(fn('f', { body: '', inputs: [] }))).toEqual(['signature']);
    expect(cardPages(fn('f', { body: 'return 0.0;', inputs: [] }))).toEqual(['signature']);
    expect(cardPages(fn('f', { body: 'return uv.x;', inputs: [] }))).toEqual(['code', 'signature']);
  });

  it('resolves and steps pages, wrapping and falling back when a page went away', () => {
    const pages = ['code', 'signature', 'note'] as const;
    expect(resolvePage(pages, 'note')).toBe('note');
    expect(resolvePage(pages, 'description')).toBe('code');
    expect(resolvePage(pages, undefined)).toBe('code');
    expect(stepPage(pages, 'note', 1)).toBe('code');
    expect(stepPage(pages, 'code', -1)).toBe('note');
    expect(stepPage(['signature'], 'signature', 1)).toBe('signature');
  });
});

describe('remembered page', () => {
  beforeEach(() => { storage.clear(); useCardPages.getState().reload(); });

  it('remembers the page per node, in storage, across a reload', () => {
    useCardPages.getState().setPage('n1', 'signature');
    useCardPages.getState().setPage('n2', 'note');
    expect(JSON.parse(storage.get(CARD_PAGE_STORAGE_KEY)!)).toEqual({ n1: 'signature', n2: 'note' });
    useCardPages.setState({ pages: {} });
    useCardPages.getState().reload();
    expect(useCardPages.getState().pages).toEqual({ n1: 'signature', n2: 'note' });
  });

  it('ignores junk in storage and survives storage that throws', () => {
    storage.set(CARD_PAGE_STORAGE_KEY, JSON.stringify({ a: 'code', b: 'bogus', c: 3 }));
    expect(loadCardPages()).toEqual({ a: 'code' });
    storage.set(CARD_PAGE_STORAGE_KEY, '{not json');
    expect(loadCardPages()).toEqual({});
    const setItem = localStorage.setItem;
    localStorage.setItem = () => { throw new Error('quota'); };
    try {
      useCardPages.getState().setPage('n3', 'description');
      expect(useCardPages.getState().pages.n3).toBe('description');
    } finally { localStorage.setItem = setItem; }
  });
});

describe('read-only code', () => {
  /** The statements the Expression Block compiles, with its result assignment read as a return. */
  function compiledStatements(node: GraphNode): string[] {
    const { code } = ExprBlockNode.generateGLSL(node, {}) as { code: string };
    const body = code.split('\n').map(l => l.trim()).filter(Boolean);
    const decls = new Set(((node.params.inputs as Inp[] | undefined) ?? []).map(i => i.name).concat(['t', 'p']));
    return body
      .filter(l => l !== '{' && l !== '}' && !new RegExp(`^\\w+ ${node.id}_result;$`).test(l))
      .filter(l => !/^(float|vec[234]) (\w+) = /.test(l) || !decls.has(/^(?:float|vec[234]) (\w+)/.exec(l)![1]))
      .map(l => l.replace(new RegExp(`^${node.id}_result = (.*);$`), 'return $1;'));
  }

  it('matches the compiled lines: skipped, switched-off and multi-statement blocks', () => {
    const node = expr('blk', {
      outputType: 'vec3',
      inputs: [{ name: 'uv', type: 'vec2' }, { name: 'k', type: 'float', slider: { min: 0, max: 1 } }],
      lines: [
        { lhs: 'float d', op: '=', rhs: 'length(uv)' },
        { lhs: 'd', op: '*=', rhs: 'k' },
        { lhs: 'd', op: '+=', rhs: '0.1', off: true },
        { lhs: '', op: '=', rhs: 'ignored' },
        { lhs: 'p', op: '=', rhs: 'vec3(d)' },
      ],
      result: 'p * 2.0',
    });
    expect(codeLinesFor(node)).toEqual(compiledStatements(node));
    expect(codeLinesFor(node)).toEqual(['float d = length(uv);', 'd *= k;', '// off: d += 0.1', 'p = vec3(d);', 'return p * 2.0;']);
  });

  it('an empty result returns the output type\'s zero, as the compiler does', () => {
    const node = expr('b2', { outputType: 'vec2', inputs: [], lines: [], result: '' });
    expect(codeLinesFor(node)).toEqual(compiledStatements(node));
    expect(codeLinesFor(node)).toEqual(['return vec2(0.0);']);
  });

  it('old semicolon-separated blocks read as statements then a return', () => {
    const node = expr('b3', { outputType: 'float', expr: 'p = sin(t); p * 2.0' });
    delete (node.params as Record<string, unknown>).lines;
    expect(codeLinesFor(node)).toEqual(['p = sin(t);', 'return p * 2.0;']);
  });

  it('a Custom Function shows its body as written (the compiler wraps it)', () => {
    const node = fn('f', { body: '\nvec2 p = uv * 1.2;\nreturn length(p);\n\n', inputs: [{ name: 'uv', type: 'vec2' }] });
    expect(codeLinesFor(node)).toEqual(['vec2 p = uv * 1.2;', 'return length(p);']);
    const { code } = CustomFnNode.generateGLSL(node, { uv: 'v_uv' }) as { code: string };
    expect(code).toContain('vec2 p = v_uv * 1.2;');
  });

  it('highlights with the shared tokenizer, once per code string', () => {
    const before = highlightCacheSize();
    const a = highlightGlsl('float x = sin(1.0);', true);
    expect(highlightGlsl('float x = sin(1.0);', true)).toBe(a);
    expect(highlightCacheSize()).toBe(before + 1);
    expect(a[0].map(t => t.text).join('')).toBe('float x = sin(1.0);');
    expect(highlightGlsl('float x = sin(1.0);', false)).not.toBe(a);
  });
});
