// @vitest-environment jsdom
/**
 * The builder's picture comes first (builders/builderFocus.ts, docs/scene-builder.md): while the Splat builder or the
 * Agent Builder is open the graph behind it is frozen (FreezeBehindBuilder) and thaws, with what changed meanwhile,
 * when it closes; the Splat builder's viewport takes the preview's canvas itself (no copy a frame) and gives it back.
 * The 2D and 3D builders still hold the main preview instead.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';


import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { create } from 'zustand';
import { FreezeBehindBuilder } from '../FreezeBehindBuilder';
import { LiveViewport } from '../studio/LiveViewport';
import { builderFocused, setBuilderFocus } from '../../../builders/builderFocus';
import { watchBuilderPreview } from '../../../builders/previewPriority';
import { previewHeld } from '../../../lib/previewHold';
import { adoptPreviewCanvas, previewCanvasLent, sendPreviewFrame, setPreviewCanvas, setPreviewWake } from '../../../lib/previewMirror';
import { useSplatBuilder } from '../../../splatBuilder/store';
import { closeAgentBuilder, openAgentBuilder } from '../../../builders/windows';
import { useSceneBuilder } from '../../../sceneBuilder/store';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

let root: Root | null = null;
let host: HTMLElement | null = null;
function mount(ui: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(ui));
}
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null; host = null;
  setBuilderFocus(false);
  setPreviewCanvas(null);
  setPreviewWake(null);
});

describe('the graph behind a mirroring builder', () => {
  const useCount = create<{ n: number }>(() => ({ n: 0 }));
  let renders = 0;
  function Card() {
    const n = useCount(s => s.n);
    renders++;
    return <span data-card>{n}</span>;
  }
  beforeEach(() => { renders = 0; useCount.setState({ n: 0 }); });

  it('doesn\'t re-render while frozen, and catches up when the builder closes', () => {
    mount(<FreezeBehindBuilder><Card /></FreezeBehindBuilder>);
    expect(host!.querySelector('[data-card]')!.textContent).toBe('0');
    act(() => setBuilderFocus(true));
    const frozenAt = renders;
    act(() => { for (let i = 1; i <= 20; i++) useCount.setState({ n: i }); });
    expect(renders).toBe(frozenAt);
    act(() => setBuilderFocus(false));
    const card = host!.querySelector<HTMLElement>('[data-card]')!;
    expect(card.textContent).toBe('20');
    // Kept, not mounted again: the same element, shown again.
    expect(card.style.display).not.toBe('none');
    expect(renders).toBeLessThanOrEqual(frozenAt + 2);
  });
});

describe('who has the focus', () => {
  let stop: (() => void) | null = null;
  beforeEach(() => { stop = watchBuilderPreview(); });
  afterEach(() => { stop?.(); stop = null; useSplatBuilder.setState({ open: false }); closeAgentBuilder(); useSceneBuilder.setState({ open: false }); });

  it('the Splat builder: focus, the preview not held (it is the picture); back on close', () => {
    expect(builderFocused()).toBe(false);
    act(() => useSplatBuilder.setState({ open: true }));
    expect(builderFocused()).toBe(true);
    expect(previewHeld()).toBe(false);
    act(() => useSplatBuilder.setState({ open: false }));
    expect(builderFocused()).toBe(false);
  });

  it('the Agent Builder too; the 3D Scene Builder holds the preview instead', () => {
    act(() => openAgentBuilder('g1'));
    expect(builderFocused()).toBe(true);
    act(() => closeAgentBuilder());
    expect(builderFocused()).toBe(false);
    act(() => useSceneBuilder.setState({ open: true }));
    expect(builderFocused()).toBe(false);
    expect(previewHeld()).toBe(true);
  });

  it('lets go when the host goes', () => {
    act(() => useSplatBuilder.setState({ open: true }));
    stop!(); stop = null;
    expect(builderFocused()).toBe(false);
  });
});

describe('the Splat builder\'s viewport takes the preview canvas', () => {
  function previewHome() {
    const home = document.createElement('div');
    const overlay = document.createElement('canvas');
    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    home.append(canvas, overlay);
    document.body.appendChild(home);
    setPreviewCanvas(canvas);
    return { home, canvas, overlay };
  }

  it('ownSize: the canvas is drawn in the viewport (no copy), pointer events go through, and it goes back on close', () => {
    const { home, canvas, overlay } = previewHome();
    mount(<LiveViewport ownSize />);
    const box = host!.querySelector<HTMLElement>('[data-live-viewport]')!;
    expect(canvas.parentElement).toBe(box);
    expect(canvas.style.pointerEvents).toBe('none');
    expect(previewCanvasLent()).toBe(true);
    // Its own copy canvas isn't used.
    const copy = [...box.querySelectorAll('canvas')].find(c => c !== canvas)!;
    expect(copy.style.display).toBe('none');
    // A frame still says it is live.
    act(() => sendPreviewFrame(canvas));
    expect(box.getAttribute('data-live-viewport')).toBe('live');
    act(() => root!.unmount());
    root = null;
    expect(canvas.parentElement).toBe(home);
    expect(canvas.nextSibling).toBe(overlay);
    expect(canvas.style.pointerEvents).toBe('');
    expect(canvas.style.position).toBe('');
    expect(previewCanvasLent()).toBe(false);
    home.remove();
  });

  it('without ownSize (the Agent Builder) it copies, and the canvas stays home', () => {
    const { home, canvas } = previewHome();
    mount(<LiveViewport />);
    expect(canvas.parentElement).toBe(home);
    expect(previewCanvasLent()).toBe(false);
    home.remove();
  });

  it('a preview that goes while lent takes its canvas back first; only one viewport at a time', () => {
    const { home, canvas } = previewHome();
    const a = document.createElement('div'), b = document.createElement('div');
    const give = adoptPreviewCanvas(a)!;
    expect(give).toBeTypeOf('function');
    expect(adoptPreviewCanvas(b)).toBeNull();
    setPreviewCanvas(null);
    expect(canvas.parentElement).toBe(home);
    give(); // a second give-back does nothing
    expect(canvas.parentElement).toBe(home);
    home.remove();
  });
});
