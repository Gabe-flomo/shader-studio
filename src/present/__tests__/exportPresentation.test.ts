/**
 * The exported presentation page: the player once however many canvases, the
 * maths as MathML by default, every canvas's bundle, and a list of what the
 * page leaves behind. And the presentation file round-trips through the gate.
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
import { buildPresentationHtml, exportNotes, presentationFileJson } from '../exportPresentation';
import { renderMarkdown } from '../markdown';
import { buildSamplePresentation } from '../sample';
import { parsePresentation, PRESENTATION_FILE_KIND, type Presentation } from '../../types/presentation';

let sample: Presentation;
beforeAll(async () => { sample = await buildSamplePresentation(0); });

describe('presentation web page', () => {
  it('carries the player once, however many canvases', () => {
    const html = buildPresentationHtml(sample, renderMarkdown, { layout: 'slides', math: 'mathml' });
    const canvases = (html.match(/class="pp-canvas"/g) ?? []).length;
    expect(canvases).toBeGreaterThan(5);
    expect(html.split('window.ShaderStudioPlay = {').length - 1).toBe(1);
    expect(html.split('function createLayerKit').length - 1).toBe(1);
    // Every script element closes where it should.
    expect(html.match(/<\/script>/g)?.length).toBe(2);
  });

  it('puts maths in as MathML by default, and KaTeX HTML when asked', () => {
    const mathml = buildPresentationHtml(sample, renderMarkdown, { layout: 'scroll', math: 'mathml' });
    expect(mathml).toContain('<math');
    expect(mathml).not.toContain('katex-html');
    const html = buildPresentationHtml(sample, renderMarkdown, { layout: 'scroll', math: 'html', katexCss: '.katex{}' });
    expect(html).toContain('katex-html');
    expect(html).toContain('.katex{}');
  });

  it('has the bundle of every source a canvas uses, and a slide per step', () => {
    const html = buildPresentationHtml(sample, renderMarkdown, { layout: 'slides', math: 'mathml' });
    const used = new Set(sample.steps.flatMap(s => s.blocks.flatMap(b => (b.type === 'render' || b.type === 'interactive' ? [b.source] : []))));
    for (const id of used) expect(html).toContain(`"${id}":{`);
    expect((html.match(/<section class="pp-step"/g) ?? []).length).toBe(sample.steps.length);
    expect((html.match(/<section class="pp-step"[^>]* hidden/g) ?? []).length).toBe(sample.steps.length - 1);
    expect(html).toContain('class="pp-chip" data-control="z"');
    expect(html).toContain('LFO 0.25 Hz');
  });

  it('is pure', () => {
    const a = buildPresentationHtml(sample, renderMarkdown, { layout: 'scroll', math: 'mathml' });
    expect(buildPresentationHtml(sample, renderMarkdown, { layout: 'scroll', math: 'mathml' })).toBe(a);
  });

  it('lists what it leaves behind: a source the player can’t run is a still', () => {
    expect(exportNotes(sample)).toEqual([]);
    const p = structuredClone(sample);
    p.sources[0].features = { ...p.sources[0].features!, liveUniforms: { u_note: 'midi1' } };
    const notes = exportNotes(p);
    expect(notes[0].what).toContain('is a still');
    expect(notes[0].why).toContain('MIDI Input node outputs');
    const html = buildPresentationHtml(p, renderMarkdown, { layout: 'slides', math: 'mathml' });
    expect(html).toContain('data-still="1"');
  });
});

describe('presentation file', () => {
  it('has its kind and opens again through parsePresentation', () => {
    const json = presentationFileJson({ ...sample, origin: 'imported' });
    const raw = JSON.parse(json);
    expect(raw.kind).toBe(PRESENTATION_FILE_KIND);
    expect(raw.origin).toBeUndefined();
    expect(parsePresentation(raw)).toEqual(sample);
  });
});
