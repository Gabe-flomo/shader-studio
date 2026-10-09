/**
 * The Under the hood view's own state (docs/agent-builder.md): the walker under the pointer in a
 * texture (hover), the walker picked (a click on the picture or a texel), Follow, the latest numbers
 * read for each, and what the runner says about the group's state. The panel (HoodView.tsx) and the
 * ring over the live picture read it with selectors; the open request (lib/agentHood.ts) is told
 * which walker to read: the hovered one, else the picked one, until its numbers are in (or for as
 * long as Follow is on).
 */
import { create } from 'zustand';
import { decodeProbe, type HoodReadout } from '../../agentBuilder/hood';
import { pokeHood, type HoodRequest, type HoodStateInfo } from '../../lib/agentHood';

export interface HoodUi {
  info: HoodStateInfo | null;
  hover: number | null;
  selected: number | null;
  follow: boolean;
  hoverRead: HoodReadout | null;
  selectedRead: HoodReadout | null;
  /** The open request (not state: the runner reads it every frame). */
  request: HoodRequest | null;
}

const EMPTY: HoodUi = { info: null, hover: null, selected: null, follow: false, hoverRead: null, selectedRead: null, request: null };

export const useHoodStore = create<HoodUi>(() => ({ ...EMPTY }));

/** The walker the request reads now: the hovered one, else the picked one until it is read (always, with Follow). */
export function probeTarget(s: Pick<HoodUi, 'hover' | 'selected' | 'follow' | 'selectedRead'>): number | null {
  if (s.hover !== null) return s.hover;
  if (s.selected === null) return null;
  return s.follow || s.selectedRead?.index !== s.selected ? s.selected : null;
}

function sync(): void {
  const s = useHoodStore.getState();
  if (!s.request) return;
  const next = probeTarget(s);
  if (s.request.probe !== next) { s.request.probe = next; if (next !== null) pokeHood(); }
}

const valid = (i: number | null) => (i === null ? null : useHoodStore.getState().info && i >= 0 && i < useHoodStore.getState().info!.count ? i : null);

export const hood = {
  attach(request: HoodRequest | null): void { useHoodStore.setState({ ...EMPTY, request }); },
  setInfo(info: HoodStateInfo | null): void {
    const was = useHoodStore.getState().info;
    if (was === info || (was && info && was.side === info.side && was.stateC === info.stateC && was.d3 === info.d3 && was.species === info.species
      && was.trail === info.trail && Math.abs(was.aspect - info.aspect) < 1e-3)) return;
    // A new side means new texels: what was picked is someone else now.
    const reset = !info || !was || was.side !== info.side;
    useHoodStore.setState(reset ? { info, hover: null, selected: null, hoverRead: null, selectedRead: null } : { info });
    sync();
  },
  hover(i: number | null): void {
    const v = valid(i);
    if (useHoodStore.getState().hover === v) return;
    useHoodStore.setState({ hover: v, hoverRead: null });
    sync();
  },
  select(i: number | null): void {
    const v = valid(i);
    useHoodStore.setState({ selected: v, selectedRead: null });
    sync();
  },
  setFollow(on: boolean): void { useHoodStore.setState({ follow: on }); sync(); },
  /** A click on the picture (clip space, radius in clip units each way): the runner finds the nearest walker. */
  pick(at: { x: number; y: number; rx: number; ry: number }): void {
    const r = useHoodStore.getState().request;
    if (!r) return;
    r.pick = at;
    pokeHood();
  },
  /** The runner's answer to a pick (-1: nobody near: the pick is cleared). */
  picked(i: number): void { hood.select(i >= 0 ? i : null); },
  /** One walker's numbers, read back. */
  probed(f: ArrayLike<number>, index: number): void {
    const s = useHoodStore.getState();
    if (!s.info) return;
    const r = decodeProbe(f, { index, side: s.info.side, d3: s.info.d3, stateC: s.info.stateC, species: s.info.species });
    const patch: Partial<HoodUi> = {};
    if (index === s.hover) patch.hoverRead = r;
    if (index === s.selected) patch.selectedRead = r;
    if (!Object.keys(patch).length) return;
    useHoodStore.setState(patch);
    sync();
  },
};

/** Where the ring goes: the hovered walker's last read, else the picked one's (null: none, or not read yet, or out of view). */
export function ringWalker(s: Pick<HoodUi, 'hover' | 'selected' | 'hoverRead' | 'selectedRead'>): { read: HoodReadout; kind: 'hover' | 'selected' } | null {
  if (s.hover !== null && s.hoverRead?.index === s.hover) return { read: s.hoverRead, kind: 'hover' };
  if (s.selected !== null && s.selectedRead?.index === s.selected) return { read: s.selectedRead, kind: 'selected' };
  return null;
}
