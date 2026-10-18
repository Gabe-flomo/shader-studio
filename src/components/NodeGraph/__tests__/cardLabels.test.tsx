// @vitest-environment jsdom
/**
 * Node card labels are never cut off: a switch's name takes the whole row (the switch at its
 * end) and wraps if it must; slider / choice / colour names share one label column per card
 * (its longest name, 66–92px) and wrap past that. The builders' row labels wrap too.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { NodeComponent } from '../NodeComponent';
import { PARAM_LABEL_MAX, PARAM_LABEL_MIN, paramLabelColumn } from '../NodeCardParts';
import { HintLabel } from '../../builders/BuilderHelp';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// A stand-in text measurer: 6px a character (jsdom has no canvas).
const CHAR_W = 6;
HTMLCanvasElement.prototype.getContext = (function (this: HTMLCanvasElement, kind: string) {
  return kind === '2d' ? { font: '', measureText: (t: string) => ({ width: t.length * CHAR_W }) } : null;
}) as unknown as HTMLCanvasElement['getContext'];
if (!('ResizeObserver' in globalThis)) {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
}

let root: Root | null = null;
let host: HTMLElement | null = null;
const st = () => useNodeGraphStore.getState();
const noop = () => {};

function showType(type: string) {
  const id = st().addNode(type, { x: 0, y: 0 })!;
  const node = st().nodes.find(n => n.id === id)!;
  act(() => { root!.render(<NodeComponent node={node} onStartConnection={noop} onEndConnection={noop} />); });
}
const labels = () => [...host!.querySelectorAll<HTMLElement>('[data-param-label]')];
/** The card's label layout: each name with how it sits (column or the whole row). */
const layout = () => labels().map(l => `${l.getAttribute('data-param-label')}: ${l.textContent}`);

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  useNodeGraphStore.setState({ activeGroupId: null, activeGroupPath: [] });
  st().replaceGraph([]);
});
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });

describe('switch rows', () => {
  it('a switch name takes the whole row, wraps, and is never ellipsised (Splat Wave: Relative to the scan)', () => {
    showType('splatWave');
    const rel = labels().find(l => l.textContent === 'Relative to the scan')!;
    expect(rel).toBeTruthy();
    expect(rel.getAttribute('data-param-label')).toBe('fill');
    expect(rel.style.flex).toBe('1 1 auto');
    expect(rel.style.maxWidth).toBe('');
    expect(rel.style.whiteSpace).toBe('normal');
    expect(rel.style.textOverflow).toBe('');
    expect(rel.style.overflow).toBe('');
    // The switch follows its name, at the end of the row
    expect(rel.parentElement!.querySelector('[role="switch"]')).toBeTruthy();
  });
});

describe('slider / choice rows', () => {
  it('long names wrap in the label column instead of being cut', () => {
    showType('repeatScene');
    const copies = labels().filter(l => l.textContent?.startsWith('Copies each side'));
    expect(copies).toHaveLength(3);
    for (const l of copies) {
      expect(l.getAttribute('data-param-label')).toBe('column');
      expect(l.style.whiteSpace).toBe('normal');
      expect(l.style.overflowWrap).toBe('break-word');
      expect(l.style.textOverflow).toBe('');
      expect(l.style.maxWidth).toBe(`${PARAM_LABEL_MAX}px`);
      expect(l.style.width).toBe('var(--param-label-w, auto)');
    }
  });

  it('no label on a card carries an ellipsis', () => {
    for (const type of ['splatWave', 'repeatScene', 'timeCubeView', 'wireframe4D2D', 'circleSDF']) {
      showType(type);
      for (const l of labels()) expect(l.style.textOverflow, `${type}: ${l.textContent}`).toBe('');
    }
  });

  it('the card sets one label column from its longest name, 66–92px', () => {
    showType('repeatScene');
    const card = host!.querySelector<HTMLElement>('[data-node-id]')!;
    // "Combine with Not repeated" is far past 92px, so the column is the widest it gets
    expect(card.style.getPropertyValue('--param-label-w')).toBe(`${PARAM_LABEL_MAX}px`);
  });
});

describe('paramLabelColumn', () => {
  it('fits the longest name, clamped to 66–92px', () => {
    expect(paramLabelColumn([])).toBe(PARAM_LABEL_MIN);
    expect(paramLabelColumn(['Size'])).toBe(PARAM_LABEL_MIN);
    expect(paramLabelColumn(['Size', 'Twelve chars'])).toBe(12 * CHAR_W + 1);
    expect(paramLabelColumn(['Relative to the scan, and more'])).toBe(PARAM_LABEL_MAX);
  });
});

describe('card label layout', () => {
  it('Splat Wave', () => { showType('splatWave'); expect(layout()).toMatchSnapshot(); });
  it('Repeat Scene', () => { showType('repeatScene'); expect(layout()).toMatchSnapshot(); });
  it('Time Cube View', () => { showType('timeCubeView'); expect(layout()).toMatchSnapshot(); });
});

describe('Simple / All (a node with very many settings)', () => {
  it('Time Cube View opens on its Simple set; All shows every section', () => {
    showType('timeCubeView');
    const toggle = host!.querySelector('[data-simple-toggle]')!;
    expect(toggle).toBeTruthy();
    const [simple, all] = [...toggle.querySelectorAll('button')];
    expect(simple.getAttribute('aria-pressed')).toBe('true');
    expect(simple.textContent).toBe('Simple (15)');
    const sectionsIn = () => host!.querySelectorAll('[aria-expanded]').length;
    const before = sectionsIn();
    act(() => { all.click(); });
    expect(host!.querySelector('[data-simple-toggle]')!.querySelectorAll('button')[1].getAttribute('aria-pressed')).toBe('true');
    expect(sectionsIn()).toBeGreaterThan(before);
  });
  it('a node without simpleParams has no toggle', () => {
    showType('circleSDF');
    expect(host!.querySelector('[data-simple-toggle]')).toBeNull();
  });
});

describe('builder rows', () => {
  it('HintLabel wraps a long name instead of cutting it', () => {
    act(() => { root!.render(<HintLabel hint="What it does">Combine with Not repeated</HintLabel>); });
    const span = host!.querySelector<HTMLElement>('[data-hint-label]')!;
    expect(span.style.whiteSpace).toBe('normal');
    expect(span.style.textOverflow).toBe('');
    expect(span.style.overflow).toBe('');
  });
});
