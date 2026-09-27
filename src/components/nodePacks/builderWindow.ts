/**
 * The Builder's window state: docked in the Builder page, or popped out into
 * a floating window over any page (a full-screen sheet on phones). The
 * builder itself reads the same stores either way, so edits show up
 * everywhere; only where it's drawn changes.
 *
 * Where the window sits and its size are remembered on this device.
 */
import { create } from 'zustand';

export type BuilderTab = 'functions' | 'packs';
export interface WindowRect { x: number; y: number; w: number; h: number }

const KEY = 'playfield:builderWindow';
export const MIN_W = 560;
export const MIN_H = 380;

interface Saved { rect?: WindowRect; snap?: 'float' | 'right'; tab?: BuilderTab }

function read(): Saved {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Saved; } catch { return {}; }
}
function write(s: Saved): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* blocked: it just won't be remembered */ }
}

function defaultRect(): WindowRect {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
  const w = Math.min(1100, Math.max(MIN_W, vw - 160));
  const h = Math.min(760, Math.max(MIN_H, vh - 140));
  return { x: Math.max(8, vw - w - 40), y: Math.max(8, Math.round((vh - h) / 2)), w, h };
}

/** Keep at least the title bar on screen. */
export function clampRect(r: WindowRect, vw = window.innerWidth, vh = window.innerHeight): WindowRect {
  const w = Math.max(MIN_W, Math.min(r.w, vw - 16));
  const h = Math.max(MIN_H, Math.min(r.h, vh - 16));
  return { w, h, x: Math.max(8 - w + 120, Math.min(r.x, vw - 120)), y: Math.max(8, Math.min(r.y, vh - 44)) };
}

interface BuilderWindowState {
  popped: boolean;
  tab: BuilderTab;
  rect: WindowRect;
  /** 'right': a full-height panel on the right edge. */
  snap: 'float' | 'right';
  /** The pack open in the pack workspace (shared by the page and the window). */
  packId: string | null;
  /** A short outline flash when "Show the window" finds it. */
  flash: boolean;
}

const saved = typeof window !== 'undefined' ? read() : {};

export const useBuilderWindow = create<BuilderWindowState>(() => ({
  popped: false,
  tab: saved.tab ?? 'functions',
  rect: saved.rect ?? (typeof window !== 'undefined' ? defaultRect() : { x: 40, y: 40, w: 900, h: 640 }),
  snap: saved.snap ?? 'float',
  packId: null,
  flash: false,
}));

const remember = () => { const s = useBuilderWindow.getState(); write({ rect: s.rect, snap: s.snap, tab: s.tab }); };

let flashTimer: ReturnType<typeof setTimeout> | null = null;
export function popOutBuilder(tab?: BuilderTab): void {
  const was = useBuilderWindow.getState().popped;
  useBuilderWindow.setState(s => ({ popped: true, tab: tab ?? s.tab, rect: clampRect(s.rect), flash: was }));
  if (was) {
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => useBuilderWindow.setState({ flash: false }), 450);
  }
  remember();
}

/** Put the builder back in the Builder page. */
export function dockBuilder(): void {
  useBuilderWindow.setState({ popped: false });
}

export function setBuilderTab(tab: BuilderTab): void {
  useBuilderWindow.setState({ tab });
  remember();
}

export function setBuilderRect(rect: WindowRect, persist = false): void {
  useBuilderWindow.setState({ rect, snap: 'float' });
  if (persist) remember();
}

export function toggleBuilderSnap(): void {
  useBuilderWindow.setState(s => ({ snap: s.snap === 'right' ? 'float' : 'right' }));
  remember();
}

export function openPackInBuilder(packId: string | null): void {
  useBuilderWindow.setState({ packId, tab: 'packs' });
}
