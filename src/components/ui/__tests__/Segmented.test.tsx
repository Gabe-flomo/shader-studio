/**
 * Segmented never runs past its container: without layout (here) it renders as
 * segments; in a browser a ResizeObserver folds it into a Select when the
 * segments don't fit (checked across the Play pages by tools/overflow-sweep.mjs).
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { renderToStaticMarkup } from 'react-dom/server';
import { Segmented } from '../Choice';

const OPTIONS = [
  { value: 'anywhere', label: 'Anywhere' },
  { value: 'edges', label: 'Edges' },
  { value: 'motion', label: 'Where it moves', title: 'Where the camera sees movement' },
] as const;

describe('Segmented', () => {
  it('renders as a radiogroup of segments until it is measured', () => {
    const html = renderToStaticMarkup(<Segmented ariaLabel="Born" value="edges" onChange={() => {}} options={OPTIONS} />);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Born"');
    expect(html.match(/role="radio"/g)).toHaveLength(3);
    expect(html).toContain('aria-checked="true"');
    expect(html).not.toContain('<select');
  });

  it('can shrink inside a row instead of pushing past it', () => {
    const html = renderToStaticMarkup(<Segmented size="sm" ariaLabel="Born" value="edges" onChange={() => {}} options={OPTIONS} />);
    // The outer box may shrink to the room it has (min-width 0, max-width 100%).
    expect(html).toMatch(/^<div style="[^"]*min-width:0[^"]*max-width:100%/);
  });

  it('wrap breaks the segments onto rows instead', () => {
    const html = renderToStaticMarkup(<Segmented wrap ariaLabel="Born" value="edges" onChange={() => {}} options={OPTIONS} />);
    expect(html).toContain('flex-wrap:wrap');
  });
});
