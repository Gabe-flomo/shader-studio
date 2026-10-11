// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { lazySafe } from '../lazyWithSuspense';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(el: React.ReactElement) {
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () => { root.render(el); });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  return host;
}

describe('lazySafe', () => {
  it('renders nothing instead of crashing when a redeployed chunk is gone', async () => {
    const Gone = lazySafe(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: https://x/assets/LineExplainView-old.js')));
    const host = await mount(<Suspense fallback={null}><Gone /></Suspense>);
    expect(host.textContent).toBe('');
  });
  it('loads a component that exists', async () => {
    const Ok = lazySafe(() => Promise.resolve({ default: () => <span>here</span> }));
    const host = await mount(<Suspense fallback={null}><Ok /></Suspense>);
    expect(host.textContent).toBe('here');
  });
});
