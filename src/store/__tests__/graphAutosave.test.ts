/**
 * Autosave through the series (files/versionAutosaveApp.ts): a changed, saved graph becomes its
 * next minor version noted "Autosave", trimming drops autosaves first, and a storage failure
 * pauses it.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const failing = vi.hoisted(() => {
  const failing = { key: '' };
  const ls: Record<string, string> = {};
  const hidden = (k: string, v: unknown) => Object.defineProperty(ls, k, { value: v, enumerable: false });
  hidden('getItem', (k: string) => (Object.prototype.hasOwnProperty.call(ls, k) ? ls[k] : null));
  hidden('setItem', (k: string, v: string) => {
    if (failing.key && k === failing.key) { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; throw e; }
    ls[k] = String(v);
  });
  hidden('removeItem', (k: string) => { delete ls[k]; });
  hidden('clear', () => { for (const k of Object.keys(ls)) delete ls[k]; });
  hidden('key', (i: number) => Object.keys(ls)[i] ?? null);
  Object.defineProperty(ls, 'length', { get: () => Object.keys(ls).length, enumerable: false });
  vi.stubGlobal('localStorage', ls);
  vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {}, setTimeout, clearTimeout });
  return failing;
});
import { useNodeGraphStore } from '../useNodeGraphStore';
import { listVersions, trimToSize, trimVictim, type GraphVersion } from '../graphVersions';
import { startVersionAutosave, useVersionAutosave } from '../../files/versionAutosaveApp';
import { useToastStore } from '../../components/ui/toastStore';

const setRadius = (r: number) => useNodeGraphStore.setState({
  nodes: [{ id: 'c', type: 'circleSDF', position: { x: 0, y: 0 }, inputs: {}, outputs: { distance: { type: 'float', label: 'Distance' } }, params: { radius: r } }],
});
const MIN = 60_000;

describe('autosave through the series', () => {
  let stop: () => void = () => {};
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000); });
  afterAll(() => { vi.useRealTimers(); });
  beforeEach(() => {
    localStorage.clear(); failing.key = '';
    useNodeGraphStore.setState({ currentGraph: null, graphDirty: false, scratch: null });
    stop = startVersionAutosave();
  });
  afterEach(() => stop());

  it('saves a changed graph as its next minor version, noted "Autosave" and marked auto', async () => {
    const s = useNodeGraphStore.getState();
    setRadius(0.1);
    await s.saveGraph('Glow');
    expect(useVersionAutosave.getState().status).toMatchObject({ graph: 'Glow', on: true });
    setRadius(0.2);
    expect(useNodeGraphStore.getState().graphDirty).toBe(true);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(useNodeGraphStore.getState().currentGraph).toMatchObject({ name: 'Glow', major: 1, minor: 1 });
    expect(useNodeGraphStore.getState().graphDirty).toBe(false);
    expect(listVersions('Glow').map(v => [`${v.major}.${v.minor}`, v.note ?? '', !!v.auto])).toEqual([['1.1', 'Autosave', true], ['1.0', '', false]]);
    expect(useVersionAutosave.getState().status.last?.label).toBe('1.1');
    // Unchanged: nothing more.
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(listVersions('Glow')).toHaveLength(2);
    // A save by hand after it is an ordinary version (1.2), not an autosave.
    setRadius(0.3);
    await s.saveGraph('Glow', 'by hand');
    expect(listVersions('Glow')[0]).toMatchObject({ major: 1, minor: 2, note: 'by hand' });
    expect(listVersions('Glow')[0].auto).toBeUndefined();
    expect(listVersions('Glow')[1]).toMatchObject({ minor: 1, auto: true });
  });

  it('never saves an untitled graph, and stops when you leave a saved one', async () => {
    setRadius(0.1);
    useNodeGraphStore.setState({ graphDirty: true });
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(useNodeGraphStore.getState().getSavedGraphNames()).toEqual([]);
    await useNodeGraphStore.getState().saveGraph('Glow');
    setRadius(0.2);
    // Leaving it (a new graph, an example): currentGraph goes.
    useNodeGraphStore.setState({ currentGraph: null, graphDirty: true });
    expect(useVersionAutosave.getState().status).toMatchObject({ graph: null, on: false });
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(listVersions('Glow')).toHaveLength(1);
  });

  it('waits while Convert holds a scratch graph', async () => {
    await useNodeGraphStore.getState().saveGraph('Glow');
    setRadius(0.4);
    useNodeGraphStore.getState().beginScratch();
    await vi.advanceTimersByTimeAsync(6 * MIN);
    expect(listVersions('Glow')).toHaveLength(1);
    useNodeGraphStore.getState().endScratch(false);
    useNodeGraphStore.setState({ graphDirty: true });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(listVersions('Glow')).toHaveLength(2);
  });

  it('a storage failure pauses autosave with a clear message', async () => {
    await useNodeGraphStore.getState().saveGraph('Glow');
    setRadius(0.5);
    failing.key = 'shader-studio:Glow';
    const toasts = useToastStore.getState().toasts.length;
    await vi.advanceTimersByTimeAsync(5 * MIN);
    const st = useVersionAutosave.getState().status;
    expect(st.paused).toMatch(/Could not save graph "Glow"/);
    expect(st.nextAt).toBeNull();
    const t = useToastStore.getState().toasts.slice(toasts);
    expect(t.map(x => x.title)).toContain('Autosave paused');
    // Paused: it doesn't keep trying.
    await vi.advanceTimersByTimeAsync(20 * MIN);
    expect(useToastStore.getState().toasts.slice(toasts).filter(x => x.title === 'Autosave paused')).toHaveLength(1);
    // Room again, and a save by hand: it resumes.
    failing.key = '';
    await useNodeGraphStore.getState().saveGraph('Glow');
    expect(useVersionAutosave.getState().status.paused).toBeNull();
  });
});

describe('history trimming prefers autosaves', () => {
  const v = (major: number, minor: number, savedAt: number, auto = false): GraphVersion =>
    ({ version: savedAt, major, minor, savedAt, payload: 'x'.repeat(100), ...(auto ? { auto: true } : {}) });

  it('drops the oldest autosave before any version saved by hand', () => {
    const list = [v(1, 0, 1), v(1, 1, 2), v(1, 2, 3, true), v(1, 3, 4, true), v(1, 4, 5)];
    expect(trimVictim(list)).toBe(list[2]);
    // Fits two fewer: both autosaves go, the oldest hand-saved tweak stays.
    expect(trimToSize(list, 3 * 200).map(x => x.minor)).toEqual([0, 1, 4]);
  });

  it('still keeps a family\'s first and latest, even when they are autosaves', () => {
    const list = [v(1, 0, 1, true), v(1, 1, 2), v(1, 2, 3, true)];
    expect(trimVictim(list)).toBe(list[1]);
  });
});
