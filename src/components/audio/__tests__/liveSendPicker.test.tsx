// @vitest-environment jsdom
/**
 * The Live tab's UI states (Playfield Send): hidden in a browser; listed with meters and track
 * names; a saved send that isn't running; nothing running; Free (locked, the Pro sheet); and the
 * Connect guide's install button words.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GraphNode } from '../../../types/nodeGraph';
import { LiveSendPicker, pickSourceTab, sourceTabOptions } from '../LiveSendPicker';
import { pluginInstallState } from '../../play/live/PlayfieldSendGuide';
import { liveSend } from '../../../lib/liveSend';
import { usePlan, useProSheet } from '../../../lib/plan';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; host: HTMLElement }> = [];
function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  mounted.push({ root, host });
  return host;
}

const node = (params: Record<string, unknown>): GraphNode => ({ id: 'src', type: 'audioSource', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { source: 'send', ...params } } as unknown as GraphNode);
const inst = (id: number, status: 'streaming' | 'paused' = 'streaming') => ({ key: `/pfsend.1.${id}`, id, name: '', sampleRate: 48000, status, level: 0.3, dropouts: 0, version: '1.0.0', pid: 1, subscribed: false });

beforeEach(() => {
  liveSend.resetForTests();
  liveSend.invokeHook = () => {};
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  usePlan.setState({ session: { status: 'signed-in', user: '', plan: 'pro', source: 'open' } });
});
afterEach(() => {
  for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); }
  liveSend.resetForTests();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  useProSheet.setState({ open: false, feature: null });
});

describe('the Live tab', () => {
  it('only shows where it can work (the desktop app), with a Pro badge on Free', () => {
    expect(sourceTabOptions('file', true).map(o => o.value)).toEqual(['file', 'mic', 'video', 'send']);
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    expect(sourceTabOptions('file', true).map(o => o.value)).toEqual(['file', 'mic', 'video']);
    // A graph saved on the Live tab still shows it (and what it waits for).
    expect(sourceTabOptions('send', true).map(o => o.value)).toContain('send');
  });

  it('lists the running sends by track, with meters, and picks one', () => {
    liveSend.setList([inst(4821), inst(1207, 'paused')]);
    liveSend.setPairs([{ id: 4821, track: 'Drums', colour: 0xff5a36, trackIndex: 0, kind: 'track' }]);
    const id = useNodeGraphStore.getState().addNode('audioSource', { x: 0, y: 0 }, { source: 'send' })!;
    const n = useNodeGraphStore.getState().nodes.find(x => x.id === id)!;
    const host = mount(<LiveSendPicker node={n} />);
    const rows = [...host.querySelectorAll('[data-live-send-row]')];
    expect(rows.map(r => r.textContent)).toEqual([expect.stringContaining('Live · Drums'), expect.stringContaining('Live · Send 1207')]);
    expect(rows[1].textContent).toContain('Paused in Live');
    expect(host.querySelectorAll('[data-live-send-meter]').length).toBe(2);
    act(() => (rows[0] as HTMLButtonElement).click());
    const saved = useNodeGraphStore.getState().nodes.find(x => x.id === id)!.params;
    expect(saved.sendId).toBe(4821);
    expect(saved.sendLabel).toBe('Drums');
  });

  it('a saved send that isn’t running is listed first as not found; nothing running explains where to start', () => {
    let host = mount(<LiveSendPicker node={node({ sendId: 55, sendLabel: 'Old drums' })} />);
    const row = host.querySelector('[data-live-send-row="55"]')!;
    expect(row.textContent).toContain('Live · Old drums');
    expect(row.textContent).toContain('Not found');
    host = mount(<LiveSendPicker node={node({})} />);
    expect(host.querySelector('[data-live-send-empty]')?.textContent).toContain('put Playfield Send on a track');
  });

  it('on Free it is locked: the card says Pro, and the tab opens the Pro sheet instead of switching', () => {
    usePlan.setState({ session: { status: 'signed-in', user: 'x', plan: 'free', source: 'gate' } });
    const host = mount(<LiveSendPicker node={node({ sendId: 4821 })} />);
    expect(host.querySelector('[data-live-send-locked]')?.textContent).toContain('Live tracks are part of Pro');
    pickSourceTab('nope', 'send');
    expect(useProSheet.getState()).toMatchObject({ open: true, feature: 'audio.liveSend' });
  });

  it('the guide’s install button: install, update, reinstall, or not built in', () => {
    expect(pluginInstallState({ bundledVersion: '1.0.0', installedVersion: null, installedPath: null, folder: '/Users/me/Library/Audio/Plug-Ins/VST3', quarantined: false }))
      .toMatchObject({ label: 'Install Playfield Send', can: true, note: 'Into /Users/me/Library/Audio/Plug-Ins/VST3' });
    expect(pluginInstallState({ bundledVersion: '1.1.0', installedVersion: '1.0.0', installedPath: '/x', folder: '/f', quarantined: false }).label).toBe('Update Playfield Send (1.0.0 → 1.1.0)');
    expect(pluginInstallState({ bundledVersion: '1.0.0', installedVersion: '1.0.0', installedPath: '/x', folder: '/f', quarantined: false }).label).toBe('Reinstall Playfield Send');
    expect(pluginInstallState({ bundledVersion: null, installedVersion: null, installedPath: null, folder: '/f', quarantined: false }).can).toBe(false);
  });
});
