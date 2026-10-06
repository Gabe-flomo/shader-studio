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
import { parseDo, runDoPlan, type DoContext, type DoPlan } from '../doBar';
import { editDistance, matchAt, ACTIONS, tokenize, colourOf, SHAPES, ACTION_TO_SCENE_WARP, SCENE_WARP_KINDS } from '../../lang/vocabulary';
import { SHAPES as SCENE_SHAPES } from '../../sceneBuilder/spec';
import { idiomBlock, idiomSpecs, matchIdioms } from '../idiomBlocks';
import { IDIOMS } from '../../lib/glslPatterns';

const H = (nd: GraphNode) => estimateNodeHeight(nd);

const CTX: Record<string, DoContext> = {
  empty: { nodes: [n('output', 'o', 900, 0)], selected: [] },
  circle: {
    nodes: [n('uv', 'u', 0, 0), n('circleSDF', 'c', 420, 0, {}, { position: ['u', 'uv'] }), n('sdfFill', 'f', 840, 0, {}, { d: ['c', 'distance'] }), n('output', 'o', 1260, 0, {}, { color: ['f', 'result'] })],
    selected: ['c'],
  },
  colour: { nodes: [n('uv', 'u', 0, 0), n('fbm', 'f', 420, 0, {}, { uv: ['u', 'uv'] }), n('palette', 'p', 840, 0, {}, { value: ['f', 'value'] }), n('output', 'o', 1260, 0, {}, { color: ['p', 'color'] })], selected: ['p'] },
  twoShapes: {
    nodes: [n('circleSDF', 'a', 0, 0), n('boxSDF', 'b', 0, 400), n('sdfFill', 'f', 840, 0, {}, { d: ['a', 'distance'] }), n('output', 'o', 1260, 0, {}, { color: ['f', 'result'] })],
    selected: ['a', 'b'],
  },
  twoColours: { nodes: [n('palette', 'a', 0, 0), n('gradient', 'b', 0, 400), n('output', 'o', 840, 0, {}, { color: ['a', 'color'] })], selected: ['a', 'b'] },
  mask: { nodes: [n('circleSDF', 'c', 0, 0), n('smoothstep', 'm', 420, 0, {}, { value: ['c', 'distance'] }), n('floatToVec3', 'g', 840, 0, {}, { input: ['m', 'result'] }), n('output', 'o', 1260, 0, {}, { color: ['g', 'rgb'] })], selected: ['m'] },
  pass: { nodes: [n('palette', 'p', 0, 0), n('pass', 'pass', 420, 0, {}, { color: ['p', 'color'] }), n('output', 'o', 840, 0, {}, { color: ['pass', 'color'] })], selected: ['pass'] },
  nothingSelected: {
    nodes: [n('uv', 'u', 0, 0), n('fbm', 'f', 420, 0, {}, { uv: ['u', 'uv'] }), n('palette', 'p', 840, 0, {}, { value: ['f', 'value'] }), n('output', 'o', 1260, 0, {}, { color: ['p', 'color'] })],
    selected: [],
  },
};

/** A plan in short: "shape:circle@0,0 move:glow{falloff=8}". */
function summary(p: DoPlan): string {
  return p.steps.map(s => {
    if (s.kind === 'shape') return `shape:${s.shape}${s.place ? `@${s.place.join(',')}` : ''}`;
    if (s.kind === 'chain') return `chain:${s.taughtId}`;
    const args = Object.entries(s.args).filter(([k]) => k !== 'other' && k !== 'otherKey').map(([k, v]) => `${k}=${Array.isArray(v) ? 'rgb' : v}`).join(',');
    return `move:${s.moveId}${s.side === 'in' ? `<${s.key}` : ''}${args ? `{${args}}` : ''}`;
  }).join(' ');
}

const CORPUS: Array<[phrase: string, ctx: keyof typeof CTX, expected: string]> = [
  // The brief's examples
  ['circle in the middle with a glow, falloff 8', 'empty', 'shape:circle@0,0 move:glow{falloff=8}'],
  ['add rings', 'circle', 'move:rings'],
  ['mix these colours', 'twoColours', 'move:mix-pair'],
  ['smoothly blend the edges', 'twoShapes', 'move:blend-pair'],
  ['make it repeat 6 times around', 'circle', 'move:repeat-around<position{count=6}'],
  ['twist the space 0.5', 'circle', 'move:twist<position{amount=0.5}'],
  ['tone map it', 'colour', 'move:tone-map'],
  // Shapes
  ['circle', 'empty', 'shape:circle'],
  ['a box at the top left', 'empty', 'shape:box@-0.45,0.3'],
  ['heart in the centre', 'empty', 'shape:heart@0,0'],
  ['star with a glow', 'empty', 'shape:star move:glow'],
  ['hexagon with rings', 'empty', 'shape:hexagon move:rings'],
  ['circle radius 0.2 with an outline', 'empty', 'shape:circle move:outline'],
  ['a square with an onion 0.03', 'empty', 'shape:box move:onion{thickness=0.03}'],
  ['circles', 'empty', 'shape:circle'],
  ['ring with 12 rings', 'empty', 'shape:ring move:rings{count=12}'],
  // Distance moves on the selection
  ['glow', 'circle', 'move:glow'],
  ['glow falloff 4 red', 'circle', 'move:glow{falloff=4,colour=rgb}'],
  ['outline width 0.02', 'circle', 'move:outline{width=0.02}'],
  ['make it hollow', 'circle', 'move:onion'],
  ['rounder by 0.05', 'circle', 'move:round{amount=0.05}'],
  ['blend it with a box', 'circle', 'move:blend{shape=box}'],
  ['8 rings', 'circle', 'move:rings{count=8}'],
  ['mask', 'circle', 'move:mask-from'],
  // Space moves
  ['warp it', 'circle', 'move:warp<position'],
  ['swirl the space 3', 'circle', 'move:swirl<position{amount=3}'],
  ['polar', 'circle', 'move:polar<position'],
  ['mirror it', 'circle', 'move:mirror<position'],
  ['mirror both ways', 'circle', 'move:mirror<position{axis=both}'],
  ['repeat 5 times', 'circle', 'move:repeat<position{count=5}'],
  ['tile it 3x', 'circle', 'move:repeat<position{count=3}'],
  ['zoom 2', 'circle', 'move:zoom-rotate<position{zoom=2}'],
  ['rotate 45 degrees', 'circle', 'move:zoom-rotate<position{angle=0.785}'],
  ['custom code', 'circle', 'move:code-here'],
  // Colour moves
  ['tonemap', 'colour', 'move:tone-map'],
  ['add grain 0.1', 'colour', 'move:grain{amount=0.1}'],
  ['grade it', 'colour', 'move:grade'],
  ['brighter by 0.3', 'colour', 'move:brighten{amount=0.3}'],
  ['mix with blue', 'colour', 'move:mix-with{colour=rgb}'],
  ['palette', 'colour', 'move:palette'],
  ['glow', 'colour', 'move:glow-colour'],
  ['screen blend', 'colour', 'move:blend-with{mode=screen}'],
  ['tone map the picture', 'nothingSelected', 'move:tone-map'],
  ['circle with a glow then tone map it', 'circle', 'shape:circle move:glow move:tone-map'],
  // Masks, textures
  ['soften', 'mask', 'move:soft-edge'],
  ['invert', 'mask', 'move:invert'],
  ['blur', 'pass', 'move:blur-texture'],
  ['glow', 'pass', 'move:glow-texture'],
  ['trails', 'pass', 'move:trails'],
  // Typos
  ['circel with a glwo', 'empty', 'shape:circle move:glow'],
  ['repaet 4 times', 'circle', 'move:repeat<position{count=4}'],
];

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
