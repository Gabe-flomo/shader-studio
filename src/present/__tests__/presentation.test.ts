/**
 * Presentations: the parse gate (round trip, junk dropped), snapshots equal to
 * what the web export builds for the same graph, Refresh keeping the control
 * choices that survive, and code blocks quoting a node's lines exactly as the
 * code panel marks them.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

// The store reads localStorage while its module loads, so the stub has to exist before the import.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); }, removeItem: (k: string) => { mem.delete(k); },
    key: (i: number) => [...mem.keys()][i] ?? null, get length() { return mem.size; }, clear: () => mem.clear(),
  });
  vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
});
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { buildPlayHtml } from '../../play/exportHtml';
import { nodeSliceLines, nodeSlicePrefix } from '../../components/code/nodeSlice';
import { snapshotExample, snapshotSaved, refreshSnapshot, sourceLimits } from '../snapshot';
import { resolveCode, parseLineRanges } from '../code';
import { emptyPresentation, newBlock, parsePresentation, type InteractiveBlock, type Presentation, type PresentSource } from '../../types/presentation';
import { buildSamplePresentation } from '../sample';
import { SAMPLE_PRESENTATIONS } from '../samples';

let light: PresentSource;
beforeAll(async () => {
  const r = await snapshotExample('learn3dLight');
  if (!r.ok) throw new Error(r.error);
  light = r.source;
});

const withSource = (): Presentation => {
  const p = emptyPresentation('Test');
  p.sources = [light];
  const inter = newBlock('interactive', light) as InteractiveBlock;
  inter.controls[0].label = 'Sun left–right';
  inter.controls[0].hint = 'Move it';
  p.steps[0].blocks = [
    { type: 'text', id: 't1', markdown: 'Hello $x$' },
    { type: 'render', id: 'r1', source: light.id, aspect: '1:1', width: 'half', pointer: false, caption: 'A sphere', startTime: 2, paused: true },
    inter,
    { type: 'code', id: 'c1', language: 'glsl', from: { source: light.id, node: light.shader.nodes[0].id }, highlightLines: [[1, 2]] },
  ];
  return p;
};

describe('parsePresentation', () => {
  it('round-trips a presentation', () => {
    const p = withSource();
    const back = parsePresentation(JSON.parse(JSON.stringify(p)));
    expect(back).toEqual(p);
  });

  it('drops malformed blocks and steps and keeps the rest', () => {
    const p = withSource();
    const raw = JSON.parse(JSON.stringify(p));
    raw.steps[0].blocks.push(
      { type: 'render', id: 'r2', source: 'nope' },           // source not in the presentation
      { type: 'video', id: 'v1' },                              // unknown type
      { type: 'text' },                                         // no id
      { type: 'code', id: 'c2', language: 'glsl' },             // nothing to show
      'junk',
    );
    raw.steps.push({ blocks: [] }, null, { id: 'ok', blocks: [{ type: 'text', id: 'x', markdown: 42 }] });
    raw.steps[0].blocks[2].controls.push({ controlId: 'missing', showMappings: true });
    raw.sources.push({ id: 'broken', bundle: { fragmentShader: '' } });
    const back = parsePresentation(raw)!;
    expect(back.steps).toHaveLength(2);
    expect(back.steps[0].blocks.map(b => b.id)).toEqual(['t1', 'r1', p.steps[0].blocks[2].id, 'c1']);
    expect((back.steps[0].blocks[2] as InteractiveBlock).controls.map(c => c.controlId)).not.toContain('missing');
    expect(back.steps[1].blocks[0]).toEqual({ type: 'text', id: 'x', markdown: '' });
    expect(back.sources.map(s => s.id)).toEqual([light.id]);
  });

  it('refuses things that are not presentations and never returns zero steps', () => {
    expect(parsePresentation(null)).toBeNull();
    expect(parsePresentation({ nodes: [] })).toBeNull();
    expect(parsePresentation({ steps: [] })!.steps).toHaveLength(1);
  });

  it('validates source bundles: uniforms, play records and posters', () => {
    const raw = JSON.parse(JSON.stringify(withSource()));
    raw.sources[0].bundle.uniforms.bad = 'x';
    raw.sources[0].poster = 'javascript:alert(1)';
    raw.sources[0].bundle.play.controls.push({ nope: true });
    const back = parsePresentation(raw)!;
    expect(back.sources[0].bundle.uniforms.bad).toBeUndefined();
    expect(back.sources[0].poster).toBeUndefined();
    expect(back.sources[0].bundle.play.controls).toHaveLength(light.bundle.play.controls.length);
  });
});

describe('snapshots', () => {
  it('builds the same web page as exporting the open graph', async () => {
    const st = useNodeGraphStore.getState();
    st.setPreviewAspect('free');
    await st.loadExampleGraph('learn3dLight');
    const { input, missing } = useNodeGraphStore.getState().playWebInput(light.title);
    expect(light.bundle).toEqual(input);
    expect(light.limits).toEqual(missing);
    expect(buildPlayHtml(light.bundle)).toBe(buildPlayHtml(input));
  });

  it('asks the runtime what it can’t run each time', () => {
    expect(sourceLimits(light)).toEqual([]);
    expect(sourceLimits({ ...light, features: { ...light.features!, isStateful: true } })).toEqual([]);
    expect(sourceLimits({ ...light, features: { ...light.features!, liveUniforms: { u_midi: 'n1' } } })).toContain('MIDI Input node outputs');
  });

  it('snapshots a saved graph without loading it, and Refresh keeps the id', async () => {
    const st = useNodeGraphStore.getState();
    await st.loadExampleGraph('learn3dCombine');
    await st.saveGraph('Blend lesson');
    await st.loadExampleGraph('learn3dLight');
    const r = snapshotSaved('Blend lesson');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source.from).toMatchObject({ kind: 'saved', name: 'Blend lesson' });
    expect(r.source.bundle.play.controls.map(c => c.id)).toEqual(['k', 'a']);
    const again = await refreshSnapshot(r.source);
    expect(again.ok && again.source.id).toBe(r.source.id);
  });

  it('Refresh keeps an interactive block’s controls whose ids survive', () => {
    const p = withSource();
    const inter = p.steps[0].blocks[2] as InteractiveBlock;
    inter.controls = [{ controlId: 'x', showMappings: true, label: 'Kept' }, { controlId: 'y', showMappings: true }];
    // The refreshed source lost control y.
    const refreshed = structuredClone(light);
    refreshed.bundle.play.controls = refreshed.bundle.play.controls.filter(c => c.id !== 'y');
    const back = parsePresentation({ ...p, sources: [refreshed] })!;
    expect((back.steps[0].blocks[2] as InteractiveBlock).controls).toEqual([{ controlId: 'x', showMappings: true, label: 'Kept' }]);
  });
});

describe('code blocks', () => {
  it('quote a node’s slice: the lines the code panel marks for it', () => {
    const sources = new Map([[light.id, light]]);
    for (const node of light.shader.nodes) {
      const r = resolveCode({ type: 'code', id: 'c', language: 'glsl', from: { source: light.id, node: node.id } }, sources);
      const panel = light.bundle.fragmentShader.split('\n').map((l, i) => [l, i] as const).filter(([l]) => l.includes(nodeSlicePrefix(node.slug))).map(([, i]) => i);
      expect(panel.length).toBeGreaterThan(0);
      expect(r.rows.filter(x => 'n' in x).map(x => ('n' in x ? x.n - 1 : -1))).toEqual(panel);
      expect(nodeSliceLines(light.bundle.fragmentShader, node.slug)).toEqual(panel);
    }
  });

  it('marks highlighted lines and parses ranges', () => {
    expect(parseLineRanges('3-5, 9, x, 7–6')).toEqual([[3, 5], [9, 9], [6, 7]]);
    const r = resolveCode({ type: 'code', id: 'c', language: 'js', code: 'a\nb\nc\n', highlightLines: [[2, 2]] }, new Map());
    expect(r.rows).toEqual([{ n: 1, text: 'a', marked: false }, { n: 2, text: 'b', marked: true }, { n: 3, text: 'c', marked: false }]);
  });
});

describe('the sample presentation', () => {
  it('builds from the Learn 3D lessons and survives the parse gate', async () => {
    const p = await buildSamplePresentation();
    expect(p.sources.length).toBeGreaterThanOrEqual(4);
    expect(p.steps.length).toBeGreaterThanOrEqual(5);
    const types = new Set(p.steps.flatMap(s => s.blocks.map(b => b.type)));
    expect([...types].sort()).toEqual(['code', 'interactive', 'render', 'text']);
    expect(parsePresentation(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
});

describe('every sample presentation', () => {
  it.each(SAMPLE_PRESENTATIONS.map(p => [p.title, p] as const))('%s builds, survives the parse gate, and every block resolves', async (_title, sample) => {
    const p = await sample.build(0);
    expect(p.title).toBe(sample.title);
    expect(p.steps.length).toBeGreaterThanOrEqual(5);
    // Nothing is dropped: every control an interactive block names is in its snapshot, every source is used and known.
    expect(parsePresentation(JSON.parse(JSON.stringify(p)))).toEqual(p);
    const types = new Set(p.steps.flatMap(s => s.blocks.map(b => b.type)));
    expect([...types].sort()).toEqual(['code', 'interactive', 'render', 'text']);
    const sources = new Map(p.sources.map(s => [s.id, s]));
    const used = new Set(p.steps.flatMap(s => s.blocks.flatMap(b => (b.type === 'render' || b.type === 'interactive') ? [b.source] : b.type === 'code' && b.from ? [b.from.source] : [])));
    expect([...sources.keys()].filter(id => !used.has(id)), 'sources no block reads').toEqual([]);
    for (const s of p.steps) for (const b of s.blocks) {
      if (b.type === 'interactive') {
        expect(b.controls.length, `${s.title}: an interactive block with no controls`).toBeGreaterThan(0);
        // Every [[control:id]] chip names one of the block's controls.
        for (const m of b.markdown.matchAll(/\[\[control:([\w-]+)\]\]/g)) expect(b.controls.map(c => c.controlId), `${s.title}: chip ${m[1]}`).toContain(m[1]);
      }
      if (b.type === 'code') {
        const r = resolveCode(b, sources);
        expect(r.problem, `${s.title}: code block`).toBeUndefined();
        expect(r.rows.length).toBeGreaterThan(0);
        for (const [, z] of b.highlightLines ?? []) expect(z, `${s.title}: highlight past the end`).toBeLessThanOrEqual(r.rows.length);
      }
    }
  });

  it('Sketching over shaders has live Script blocks next to a canvas of the same source', async () => {
    const p = await SAMPLE_PRESENTATIONS.find(s => s.title === 'Sketching over shaders')!.build(0);
    const live = p.steps.flatMap(s => s.blocks.filter(b => b.type === 'code' && b.live).map(b => ({ s, b })));
    expect(live.length).toBeGreaterThanOrEqual(2);
    for (const { s, b } of live) {
      const src = b.type === 'code' && b.from ? b.from.source : '';
      expect(s.blocks.some(x => (x.type === 'render' || x.type === 'interactive') && x.source === src), s.title).toBe(true);
    }
  });
});
