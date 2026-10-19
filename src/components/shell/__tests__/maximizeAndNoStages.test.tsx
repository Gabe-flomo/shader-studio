// @vitest-environment jsdom
/**
 * Maximize graph puts the picture behind the graph (shell/graphLayout.ts), full size in the aspect
 * preset, with no graph background or dots over it; and the Studio graph shows no stages
 * (no flow strip, stage tags, stage browse or arrange by stage), on desktop or on a phone. Stages stay
 * in the builders (BuilderFlowStrip).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
});

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { graphOverPictureStyle, pictureBehindGraph, pictureBehindStyle } from '../graphLayout';
import { fitAspect, PREVIEW_ASPECTS } from '../../../utils/graphImportPlan';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { n } from '../../../store/graphBuilder';
import { NodeGraph } from '../../NodeGraph/NodeGraph';
import { MobileGraphBrowser } from '../../NodeGraph/MobileGraphBrowser';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
if (!('ResizeObserver' in globalThis)) vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const src = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });
const render = (el: React.ReactElement) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
};

describe('Maximize graph: the picture behind the graph', () => {
  it('only on the Studio with the preview docked', () => {
    expect(pictureBehindGraph({ maximized: true, page: 'studio', floated: false, hosted: false })).toBe(true);
    expect(pictureBehindGraph({ maximized: false, page: 'studio', floated: false, hosted: false })).toBe(false);
    expect(pictureBehindGraph({ maximized: true, page: 'play', floated: false, hosted: false })).toBe(false);
    expect(pictureBehindGraph({ maximized: true, page: 'studio', floated: true, hosted: false })).toBe(false);
    expect(pictureBehindGraph({ maximized: true, page: 'studio', floated: false, hosted: true })).toBe(false);
  });

  it('the picture fills the graph’s area under it, and takes no pointer events', () => {
    const pic = pictureBehindStyle(260), graph = graphOverPictureStyle(260);
    for (const k of ['position', 'top', 'bottom', 'left', 'right'] as const) expect(pic[k]).toBe(graph[k]);
    expect(pic.left).toBe(260);
    expect(Number(pic.zIndex)).toBeLessThan(Number(graph.zIndex));
    expect(pic.pointerEvents).toBe('none');
  });

  it('the same canvas is moved (no second renderer), its header and footer hide, and the aspect preset letterboxes it', () => {
    const app = src('../../../App.tsx');
    // One preview column, restyled; header and footer only when the picture is not behind.
    expect(app).toContain('pictureBehindStyle(paletteBaseW > 0 ? effectivePaletteW : 0)');
    expect(app).toContain('{!pictureBehind && <PreviewHeader>');
    expect(app).toContain('{!pictureBehind && <PreviewFooter');
    expect(app).toContain('<NodeGraph redesignToolbar overPicture={pictureBehind} />');
    expect(app).toMatch(/!hosted && !pictureBehind && \(/); // no divider
    // ShaderCanvas fits the chosen ratio inside whatever box it gets: a 16:9 picture in a wide graph area.
    const r169 = PREVIEW_ASPECTS.find(a => a.id === '16:9')!.ratio!;
    expect(fitAspect(1180, 820, r169)).toEqual({ width: 1180, height: 663 });
    expect(fitAspect(800, 820, PREVIEW_ASPECTS.find(a => a.id === '9:16')!.ratio!)).toEqual({ width: 461, height: 820 });
    expect(src('../../ShaderCanvas.tsx')).toContain('setFit(ratio ? fitAspect(r.width, r.height, ratio) : playFreeFit(r.width, r.height))');
  });

  it('over the picture the graph has no background and no dot grid (the picture shows as it is); normally it is solid with dots', () => {
    useNodeGraphStore.getState().replaceGraph([n('uv', 'u', 0, 0), n('output', 'o', 400, 0, {}, { color: ['u', 'uv'] })]);
    const solid = render(<NodeGraph redesignToolbar />).querySelector<HTMLElement>('[data-node-canvas]')!.style;
    const solidBg = solid.backgroundColor, solidImg = solid.backgroundImage;
    act(() => root!.unmount()); host!.remove();
    const over = render(<NodeGraph redesignToolbar overPicture />).querySelector<HTMLElement>('[data-node-canvas]')!.style;
    expect(over.backgroundColor).toBe('transparent');
    expect(over.backgroundImage).toBe('none');
    expect(solidBg).not.toBe('transparent');
    expect(solidImg).toContain('radial-gradient');
  });
});

describe('no stages in the Studio graph', () => {
  it('desktop: no flow strip, stage tags or stage menus on the canvas', () => {
    useNodeGraphStore.getState().replaceGraph([
      n('uv', 'u', 0, 0), n('circleSDF', 'c', 400, 0, {}, { position: ['u', 'uv'] }), n('output', 'o', 800, 0, {}, { color: ['c', 'distance'] }),
    ]);
    const h = render(<NodeGraph redesignToolbar />);
    expect(h.querySelectorAll('[data-node-id]').length).toBeGreaterThan(0);
    expect(h.querySelector('[data-stage-tag], [data-flow-strip], [data-arrange-by-stage], [data-stage-legend]')).toBeNull();
    expect(h.textContent ?? '').not.toMatch(/Flow strip|Arrange by stage|By stage|Next: /);
  });

  it('phone: the graph list has no flow chip', () => {
    useNodeGraphStore.getState().replaceGraph([n('uv', 'u', 0, 0), n('output', 'o', 400, 0, {}, { color: ['u', 'uv'] })]);
    const h = render(<MobileGraphBrowser />);
    expect(h.querySelector('[data-flow-strip], [data-flow-chip], [data-stage-browse]')).toBeNull();
    expect(h.textContent ?? '').not.toMatch(/Flow strip|Stage:/);
  });

  it('the strip, its store and the stage-only helpers are gone; the builders keep their flow strip', () => {
    for (const gone of ['../../structure/FlowStrip.tsx', '../../structure/useStructure.ts', '../../../structure/hintsStore.ts', '../../../structure/arrange.ts', '../../../structure/boost.ts', '../../../structure/browse.ts', '../../../structure/notices.ts']) {
      expect(existsSync(resolve(__dirname, gone)), gone).toBe(false);
    }
    const app = src('../../../App.tsx');
    expect(app).not.toMatch(/FlowStrip|BROWSE_STAGE_EVENT/);
    expect(src('../../NodeGraph/NodeComponent.tsx')).not.toContain('StageTag');
    expect(src('../../builders/BuilderWindow.tsx')).toContain('<BuilderFlowStrip');
  });
});

describe('Maximize: hide the nodes', () => {
  it('the eye hides cards, wires and minimap over the picture; leaving Maximize shows them again', async () => {
    const { useGraphMaximize } = await import('../graphLayout');
    useNodeGraphStore.getState().replaceGraph([n('uv', 'u', 0, 0), n('output', 'o', 400, 0, {}, { color: ['u', 'uv'] })]);
    useGraphMaximize.getState().set(true);
    useGraphMaximize.getState().setNodesHidden(true);
    const h = render(<NodeGraph redesignToolbar overPicture />);
    const world = h.querySelector<HTMLElement>('[data-zoom-layer]')!.parentElement!;
    expect(world.style.visibility).toBe('hidden');
    act(() => useGraphMaximize.getState().setNodesHidden(false));
    expect(world.style.visibility).toBe('');
    act(() => useGraphMaximize.getState().setNodesHidden(true));
    act(() => useGraphMaximize.getState().set(false));
    expect(useGraphMaximize.getState().nodesHidden).toBe(false);
    // Only while maximized
    useGraphMaximize.getState().setNodesHidden(true);
    expect(useGraphMaximize.getState().nodesHidden).toBe(false);
  });
});
