/**
 * Live script blocks and the Stage hand-off: the edit round-trips through
 * parsePresentation, runs only in its own step's canvases of that source,
 * shows in the block (with the snapshot's code kept for Reset), and the
 * Stage runs the same page the export would build for the snapshot. Also
 * the exported page's live blocks, camera and sound buttons, and the MathML
 * rewrite for Chrome.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); }, removeItem: (k: string) => { mem.delete(k); },
    key: (i: number) => [...mem.keys()][i] ?? null, get length() { return mem.size; }, clear: () => mem.clear(),
  });
  vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
});
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { buildPlayHtml, DEFAULT_EMBED, playBundle, playUsesCamera } from '../../play/exportHtml';
import { defaultLayer } from '../../types/playLayers';
import { snapshotExample } from '../snapshot';
import { resolveCode } from '../code';
import { linkedCanvases, snapshotStagePage, stagePageHtml, stepScriptEdits, withScripts } from '../liveScript';
import { buildPresentationHtml } from '../exportPresentation';
import { mathmlForCore, renderMarkdown } from '../markdown';
import { emptyPresentation, newStep, parsePresentation, type CodeBlock, type Presentation, type PresentSource } from '../../types/presentation';

const EDIT = "function draw(s) {\n  s.ctx.fillStyle = 'red';\n  s.ctx.fillRect(0, 0, 40, 40);\n}";

let light: PresentSource;
let sketchy: PresentSource;
beforeAll(async () => {
  const r = await snapshotExample('learn3dLight');
  if (!r.ok) throw new Error(r.error);
  light = r.source;
  // The same Play with a Script layer added, as if the author had drawn one.
  const script = defaultLayer('script', 'L1', 'Sketch');
  sketchy = { ...light, id: 'srcS', title: 'Light, with a sketch', bundle: { ...light.bundle, play: { ...light.bundle.play, layers: [...light.bundle.play.layers, script] } } };
});

const liveBlock = (over: Partial<CodeBlock> = {}): CodeBlock => ({ type: 'code', id: 'c1', language: 'js', from: { source: sketchy.id, layerId: 'L1' }, live: true, ...over });

function withLive(edited?: string): Presentation {
  const p = emptyPresentation('Live');
  p.sources = [sketchy];
  p.steps[0].blocks = [
    { type: 'render', id: 'r1', source: sketchy.id, aspect: '16:9', width: 'full', pointer: true },
    liveBlock(edited === undefined ? {} : { edited }),
  ];
  const other = newStep('Another');
  other.blocks = [{ type: 'render', id: 'r2', source: sketchy.id, aspect: '16:9', width: 'full', pointer: true }];
  p.steps.push(other);
  return p;
}

describe('live script blocks', () => {
  it('round-trip through parsePresentation with their edit', () => {
    const p = withLive(EDIT);
    const back = parsePresentation(JSON.parse(JSON.stringify(p)));
    expect(back).toEqual(p);
    const b = back!.steps[0].blocks[1] as CodeBlock;
    expect(b.live).toBe(true);
    expect(b.edited).toBe(EDIT);
  });

  it('are live only when they quote a Script layer', () => {
    const p = withLive(EDIT);
    const raw = JSON.parse(JSON.stringify(p));
    raw.steps[0].blocks[1].from = { source: sketchy.id };   // the shader, not a layer
    const b = parsePresentation(raw)!.steps[0].blocks[1] as CodeBlock;
    expect(b.live).toBeUndefined();
    expect(b.edited).toBeUndefined();
  });

  it('run only in their own step, for their own source', () => {
    const p = withLive(EDIT);
    expect(stepScriptEdits(p.steps[0]).get(sketchy.id)).toEqual({ L1: EDIT });
    expect(stepScriptEdits(p.steps[1]).size).toBe(0);
    expect(linkedCanvases(p.steps[0], sketchy.id).map(b => b.id)).toEqual(['r1']);
    // An unedited live block changes nothing.
    expect(stepScriptEdits(withLive().steps[0]).size).toBe(0);
  });

  it('never change the snapshot', () => {
    const before = JSON.stringify(sketchy.bundle);
    const edited = withScripts(sketchy.bundle, { L1: EDIT });
    expect(edited.play.layers.find(l => l.id === 'L1')).toMatchObject({ code: EDIT });
    expect(JSON.stringify(sketchy.bundle)).toBe(before);
    expect(withScripts(sketchy.bundle, {})).toBe(sketchy.bundle);
  });

  it('show the edit, and keep the snapshot’s code for Reset', () => {
    const sources = new Map([[sketchy.id, sketchy]]);
    const original = (sketchy.bundle.play.layers.find(l => l.id === 'L1') as { code: string }).code;
    const r = resolveCode(liveBlock({ edited: EDIT }), sources);
    expect(r.text).toBe(EDIT);
    expect(r.original).toBe(original);
    expect(resolveCode(liveBlock(), sources).text).toBe(original.replace(/\n+$/, ''));
  });
});

describe('the Stage hand-off', () => {
  it('builds the page the Stage builds for the open graph, from the snapshot', async () => {
    const st = useNodeGraphStore.getState();
    st.setPreviewAspect('free');
    await st.loadExampleGraph('learn3dLight');
    const { input } = useNodeGraphStore.getState().playWebInput(light.title);
    expect(snapshotStagePage(light)).toBe(stagePageHtml(input));
    expect(snapshotStagePage(light)).toBe(buildPlayHtml(light.bundle, { ...DEFAULT_EMBED, mode: 'player' }));
  });

  it('carries the step’s script edits, and the bundle the exported presentation carries otherwise', () => {
    const page = snapshotStagePage(sketchy, { L1: EDIT });
    expect(page).toBe(stagePageHtml(withScripts(sketchy.bundle, { L1: EDIT })));
    expect(page).toContain(JSON.stringify(EDIT).slice(1, -1));
    const exported = buildPresentationHtml(withLive(), renderMarkdown, { layout: 'slides', math: 'mathml' });
    expect(exported).toContain(JSON.stringify(playBundle(sketchy.bundle).play.layers).slice(0, 200).replace(/<\//g, '<\\/'));
  });
});

describe('the exported page', () => {
  it('makes a live block a text box with its edit, Reset, and the snapshot’s code', () => {
    const html = buildPresentationHtml(withLive(EDIT), renderMarkdown, { layout: 'scroll', math: 'mathml' });
    expect(html).toContain('class="pp-code pp-live" data-source="srcS" data-layer="L1"');
    expect(html).toContain('<textarea class="pp-edit"');
    expect(html).toMatch(/<button type="button" class="pp-reset">Reset<\/button>/);
    expect(html).toContain('class="pp-original" hidden');
    const unedited = buildPresentationHtml(withLive(), renderMarkdown, { layout: 'scroll', math: 'mathml' });
    expect(unedited).toMatch(/class="pp-reset" hidden>Reset/);
  });

  it('offers Enable camera on canvases that read it', () => {
    const cam = { ...sketchy, bundle: { ...sketchy.bundle, play: { ...sketchy.bundle.play, layers: [...sketchy.bundle.play.layers, defaultLayer('camera', 'K1', 'Camera')] } } };
    expect(playUsesCamera(cam.bundle.play)).toBe(true);
    expect(playUsesCamera(light.bundle.play)).toBe(false);
    const p = withLive();
    p.sources = [cam];
    const html = buildPresentationHtml(p, renderMarkdown, { layout: 'slides', math: 'mathml' });
    expect(html).toContain('class="pp-over pp-camera"');
    expect(buildPresentationHtml(withLive(), renderMarkdown, { layout: 'slides', math: 'mathml' })).not.toContain('class="pp-over pp-camera"');
  });

  it('offers Play sound on canvases with a song', () => {
    const song = { label: 'Audio Input', name: 'a.mp3', src: 'data:audio/mpeg;base64,AAAA', bytes: 3, id: 'n1', uniforms: ['u_a'], bands: [100], range: 200, mode: 'band' };
    const p = withLive();
    p.sources = [{ ...sketchy, bundle: { ...sketchy.bundle, media: { audio: [song] } } }];
    expect(buildPresentationHtml(p, renderMarkdown, { layout: 'slides', math: 'mathml' })).toContain('class="pp-over pp-sound"');
  });
});

describe('MathML for Chrome', () => {
  it('writes bold, blackboard and script letters as Unicode maths letters', () => {
    const html = renderMarkdown('$\\mathbf{p} + \\mathbb{R} + \\mathcal{L} + \\mathbf{2} + \\boldsymbol{\\alpha}$', { math: 'mathml' });
    expect(html).toContain('<mi mathvariant="normal">𝐩</mi>');
    expect(html).toContain('ℝ');
    expect(html).toContain('ℒ');
    expect(html).toContain('<mn>𝟐</mn>');
    expect(html).toContain('𝜶');
    expect(html).not.toMatch(/mathvariant="(bold|double-struck|script|bold-italic)"/);
  });

  it('draws norm bars as fences, and leaves ∥ (parallel) alone', () => {
    const html = renderMarkdown('$\\lVert \\mathbf{p} \\rVert - \\|x\\|$ and $a \\parallel b$', { math: 'mathml' });
    expect(html.match(/<mo lspace="0em" rspace="0em" stretchy="false">‖<\/mo>/g)).toHaveLength(4);
    expect(html).toContain('<mo>∥</mo>');
  });

  it('leaves the app’s KaTeX HTML output alone', () => {
    expect(renderMarkdown('$\\mathbf{p}$', { math: 'html' })).toContain('mathvariant="bold"');
    expect(mathmlForCore('<mi mathvariant="normal">x</mi>')).toBe('<mi mathvariant="normal">x</mi>');
  });
});
