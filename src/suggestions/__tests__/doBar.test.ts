/**
 * The Do… bar's phrase language (suggestions/doBar.ts, lang/vocabulary.ts): a corpus of phrases
 * → the moves and values they plan, and every plan runs to a graph that compiles.
 */
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import { parser } from '@shaderfrog/glsl-parser';
import preprocess from '@shaderfrog/glsl-parser/preprocessor';
import { compileGraph } from '../../compiler/graphCompiler';
import { n } from '../../store/graphBuilder';
import { estimateNodeHeight } from '../../store/graphLayout';
import type { GraphNode } from '../../types/nodeGraph';
import { parseDo, runDoPlan, type DoPlan } from '../doBar';
import { editDistance, matchAt, ACTIONS, tokenize, colourOf, SHAPES, ACTION_TO_SCENE_WARP, SCENE_WARP_KINDS } from '../../lang/vocabulary';
import { SHAPES as SCENE_SHAPES } from '../../sceneBuilder/spec';
import { idiomBlock, idiomSpecs, matchIdioms } from '../idiomBlocks';
import { IDIOMS } from '../../lib/glslPatterns';
import { CTX, CORPUS } from './doBarCorpus';

const H = (nd: GraphNode) => estimateNodeHeight(nd);

/** A plan in short: "shape:circle@0,0 move:glow{falloff=8}". */
function summary(p: DoPlan): string {
  return p.steps.map(s => {
    if (s.kind === 'shape') return `shape:${s.shape}${s.place ? `@${s.place.join(',')}` : ''}`;
    if (s.kind === 'chain') return `chain:${s.taughtId}`;
    if (s.kind === 'gridRules') return `grid:${s.preset}`;
    if (s.kind !== 'move') return s.kind;
    const args = Object.entries(s.args).filter(([k]) => k !== 'other' && k !== 'otherKey').map(([k, v]) => `${k}=${Array.isArray(v) ? 'rgb' : v}`).join(',');
    return `move:${s.moveId}${s.side === 'in' ? `<${s.key}` : ''}${args ? `{${args}}` : ''}`;
  }).join(' ');
}


describe('Do… bar corpus', () => {
  it('has 40+ phrases', () => expect(CORPUS.length).toBeGreaterThanOrEqual(40));
  for (const [phrase, ctx, expected] of CORPUS) {
    it(`“${phrase}” → ${expected}`, () => {
      const p = parseDo(phrase, CTX[ctx]);
      expect(p.problem, p.problem).toBeUndefined();
      const got = summary(p).replace(/angle=([\d.]+)/, (_, v) => `angle=${Math.round(Number(v) * 1000) / 1000}`);
      expect(got).toBe(expected);
    });
  }
});

describe('plans run and compile', () => {
  let k = 0;
  const nextId = () => `d${k++}`;
  for (const [phrase, ctx] of CORPUS) {
    it(`“${phrase}”`, () => {
      const c = CTX[ctx];
      const plan = parseDo(phrase, c);
      const r = runDoPlan(c.nodes, plan, nextId, { heightOf: H });
      expect(r.ran.length).toBe(plan.steps.length);
      const res = compileGraph({ nodes: r.nodes });
      expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();
      expect(() => parser.parse(preprocess('vec4 gl_FragColor;\nvec4 gl_FragCoord;\n' + res.fragmentShader!, { preserve: {} }), { quiet: true, failOnWarn: true })).not.toThrow();
    });
  }
});

describe('the shared vocabulary', () => {
  it('fuzzy matching: small typos only, never short words', () => {
    expect(editDistance('glwo', 'glow')).toBe(1);
    expect(matchAt(['glwo'], 0, ACTIONS)?.entry.id).toBe('glow');
    expect(matchAt(['mix'], 0, ACTIONS)?.entry.id).toBe('mix-with');
    expect(matchAt(['max'], 0, ACTIONS)).toBeNull();
  });
  it('reads numbers, counts and colours', () => {
    expect(tokenize('Repeat 6x, falloff=8!')).toEqual(['repeat', '6', 'x', 'falloff', '8']);
    expect(colourOf('#ff8000')).toEqual([1, 0.502, 0]);
  });
  it('says what is missing', () => {
    expect(parseDo('glow', { nodes: [], selected: [] }).problem).toMatch(/Select a node/);
    expect(parseDo('blur', CTX.circle).problem).toMatch(/texture/);
    expect(parseDo('cylinder', CTX.empty).problem).toMatch(/3D Scene Builder/);
    expect(parseDo('flibbertigibbet', CTX.empty).unknown).toEqual(['flibbertigibbet']);
  });
});

describe('shared with the Scene Builder', () => {
  it('every Scene Builder shape and alias is a word for the same node', () => {
    for (const sc of SCENE_SHAPES) {
      for (const word of [sc.kind, ...sc.aliases]) {
        const m = matchAt(tokenize(word.replace(/-/g, ' ')), 0, SHAPES);
        expect(m, word).not.toBeNull();
        expect(m!.entry.node3d?.type ?? '', word).toBe(sc.type);
      }
    }
  });
  it('space actions map onto real Scene Builder warps', () => {
    for (const w of Object.values(ACTION_TO_SCENE_WARP)) expect(SCENE_WARP_KINDS).toContain(w);
  });
});

describe('idioms in the Do… bar', () => {
  it('most idioms can be a block, and a phrase finds them', () => {
    expect(idiomSpecs().length).toBeGreaterThan(IDIOMS.length * 0.7);
    expect(matchIdioms('sine hash')[0]?.idiom.id).toBe('hash-sin-dot');
    expect(matchIdioms('centre uv')[0]?.idiom.id).toBe('centre-uv');
  });
  for (const spec of idiomSpecs()) {
    it(`${spec.idiom.id} compiles as a block`, () => {
      const e = idiomBlock(spec, 'e', 0, 0);
      const show = spec.outputType === 'vec3' ? [] : [n(spec.outputType === 'float' ? 'floatToVec3' : 'palette', 's', 400, 0)];
      if (show[0]?.type === 'floatToVec3') show[0].inputs.input.connection = { nodeId: 'e', outputKey: 'result' };
      const o = n('output', 'o', 800, 0, {}, { color: spec.outputType === 'vec3' ? ['e', 'result'] : ['s', spec.outputType === 'float' ? 'rgb' : 'color'] });
      const res = compileGraph({ nodes: [e, ...show, o] });
      expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();
      expect(() => parser.parse(preprocess('vec4 gl_FragColor;\nvec4 gl_FragCoord;\n' + res.fragmentShader!, { preserve: {} }), { quiet: true, failOnWarn: true })).not.toThrow();
    });
  }
});
