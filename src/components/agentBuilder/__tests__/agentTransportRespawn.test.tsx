// @vitest-environment jsdom
/** The step bar's Respawn (✦, R with the bar focused): asks the live runner to re-seed the group, not to start over. */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AgentTransport } from '../AgentTransport';
import { respawnPending, restartPending, takeRespawn } from '../../../lib/agentRunner';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });
const mount = () => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<AgentTransport groupId="grp" />));
};
const $ = (sel: string) => document.body.querySelector(sel) as HTMLElement | null;

describe('Respawn on the step bar', () => {
  it('the button and R ask for a respawn of the group, not a start over', () => {
    mount();
    const btn = $('[data-agent-respawn]');
    expect(btn?.getAttribute('aria-label') ?? btn?.getAttribute('title') ?? '').toContain('(R)');
    act(() => btn!.click());
    expect(respawnPending('grp')).toBe(true);
    expect(restartPending('grp')).toBe(false);
    takeRespawn({ burstPending: false }, 'grp');
    expect(respawnPending('grp')).toBe(false);
    act(() => { $('[data-agent-transport]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true })); });
    expect(respawnPending('grp')).toBe(true);
    takeRespawn({ burstPending: false }, 'grp');
  });
});
