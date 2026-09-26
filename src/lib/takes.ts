/**
 * takes.ts — a performance, recorded as data, to render frame by frame.
 *
 * Playing live is real time: a recording of it is only as smooth as the
 * machine was, and live input can't be rendered offline. A take separates the
 * two. While it records, every rendered frame notes the graph clock, each
 * control's value as the picture saw it (mappings applied) and the pointer.
 * Rendering the take then steps the clock frame by frame and sets those
 * values back before each frame, so the export shows exactly the performance,
 * at any resolution, with transparency and the song, and no dropped frames.
 *
 * A take lives for the session (like a loaded song). Its values are sampled
 * per rendered frame and read back by time, interpolating between samples.
 */
import { create } from 'zustand';
import { inputBus, type InputSource } from './inputBus';
import { playEngine } from './playEngine';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { readControlValue } from '../play/playControls';
import { layerTarget, parseActionTarget, parseLayerTarget } from '../types/play';
import type { KitPointer } from '../play/kit/kit.js';
import { takeValuesAt, type Take } from './takePlayback';

export { takePointerAt, takeValuesAt, type Take, type TakeTrack } from './takePlayback';

interface TakeState {
  takes: Take[];
  recording: boolean;
  /** Seconds recorded so far, while recording. */
  elapsed: number;
  /** A take the Record dialog should open with (Render… on a take). */
  pending: string | null;
  renderTake: (id: string | null) => void;
  start: (pointer: () => KitPointer) => void;
  stop: () => Take | null;
  remove: (id: string) => void;
  rename: (id: string, name: string) => void;
}

let session: { take: Take; pointer: () => KitPointer; detach: () => void } | null = null;

export const useTakes = create<TakeState>((set, get) => ({
  takes: [],
  recording: false,
  elapsed: 0,
  pending: null,
  renderTake: id => set({ pending: id }),
  start(pointer) {
    if (session) return;
    const st = useNodeGraphStore.getState();
    const controls = st.play.controls.filter(c => c.kind !== 'action' && !parseActionTarget(c.target));
    // Nulls too: one following the pointer on a spring moves by itself, so its
    // place each frame is part of the performance.
    const nulls = st.play.layers.filter(l => l.kind === 'null');
    const take: Take = {
      id: `take-${Date.now().toString(36)}`,
      name: `Take ${get().takes.length + 1}`,
      times: [], pointer: [], from: 0, length: 0,
      tracks: [
        ...controls.map(c => ({ control: { id: c.id, target: c.target, kind: c.kind, label: c.label }, values: [] })),
        ...nulls.flatMap(l => (['x', 'y'] as const).map(k => ({ control: { id: `null:${l.id}:${k}`, target: layerTarget(l.id, k), kind: 'float' as const, label: `${l.label} ${k}` }, values: [] as number[] }))),
      ],
    };
    let lastUi = 0;
    const source: InputSource = {
      wantsTick: () => true,
      tickInputs(_dt, time) {
        // A paused clock records nothing; a clock sent backwards (↺) starts the take over.
        const last = take.times[take.times.length - 1];
        if (last !== undefined && time <= last) {
          if (time < last - 0.5) { take.times.length = 0; take.pointer.length = 0; for (const t of take.tracks) t.values.length = 0; }
          else return;
        }
        const { nodes, play } = useNodeGraphStore.getState();
        take.times.push(time);
        for (const t of take.tracks) {
          const lt = t.control.id.startsWith('null:') ? parseLayerTarget(t.control.target) : null;
          if (lt) {
            const layer = play.layers.find(l => l.id === lt.layerId) as unknown as Record<string, number> | undefined;
            t.values.push(playEngine.layerValue(lt.layerId, lt.key, layer?.[lt.key] ?? 0.5));
            continue;
          }
          const live = playEngine.liveValue(t.control.id);
          const v = live ?? readControlValue(nodes, t.control.target, play) ?? 0;
          if (Array.isArray(v)) t.values.push(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
          else t.values.push(v);
        }
        const p = session?.pointer() ?? { x: 0.5, y: 0.5, over: false, down: false };
        take.pointer.push(p.x, p.y, p.over ? 1 : 0, p.down ? 1 : 0);
        const now = performance.now();
        if (now - lastUi > 200) { lastUi = now; set({ elapsed: time - take.times[0] }); }
      },
    };
    session = { take, pointer, detach: inputBus.addSource(source) };
    useNodeGraphStore.getState().setTimePlaying(true);
    set({ recording: true, elapsed: 0 });
  },
  stop() {
    if (!session) return null;
    session.detach();
    const take = session.take;
    session = null;
    set({ recording: false, elapsed: 0 });
    if (take.times.length < 2) return null;
    take.from = take.times[0];
    take.length = take.times[take.times.length - 1] - take.from;
    set(s => ({ takes: [...s.takes, take] }));
    return take;
  },
  remove: id => set(s => ({ takes: s.takes.filter(t => t.id !== id) })),
  rename: (id, name) => set(s => ({ takes: s.takes.map(t => (t.id === id ? { ...t, name } : t)) })),
}));

/**
 * Put a take's values in place for one offline frame: node sliders straight
 * into the shader's uniforms, layer properties as overrides the layer kit
 * reads. `release` clears the layer overrides when the export ends.
 */
export function takeApplier(take: Take, setUniform: (name: string, value: number | number[]) => void) {
  const layerKeys = new Set<string>();
  return {
    apply(time: number) {
      const values = takeValuesAt(take, time);
      for (const t of take.tracks) {
        const v = values.get(t.control.id);
        if (v === undefined) continue;
        const lt = parseLayerTarget(t.control.target);
        if (lt) {
          if (typeof v === 'number') { playEngine.setOverride(lt.layerId, lt.key, v); layerKeys.add(`${lt.layerId}\u0000${lt.key}`); }
          continue;
        }
        const key = t.control.target.split('::').slice(-2).join('::');
        const uniform = inputBus.paramUniform(key);
        if (uniform) setUniform(uniform, v);
      }
    },
    release() {
      for (const k of layerKeys) { const [id, key] = k.split('\u0000'); playEngine.setOverride(id, key, null); }
      layerKeys.clear();
    },
  };
}
