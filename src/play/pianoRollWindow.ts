/**
 * pianoRollWindow.ts — the piano roll's own window (docs/piano-roll.md):
 * where it sits and how big it is (remembered, kept on screen), the clip
 * panel's Live-style positions (bars.beats.sixteenths), and the short key
 * badge a MIDI clip shows on the tape. Pure.
 */
import { beatSeconds, type ArrScale } from '../types/playArrangement';
import { NOTE_NAMES, scaleOf } from './scales';

// ── The window's rectangle ──────────────────────────────────────────────────

export interface WinRect { x: number; y: number; w: number; h: number }

export const WIN_MIN_W = 560;
export const WIN_MIN_H = 360;

/** A first window: most of the screen, centred, below the title bar. */
export function defaultWinRect(vw: number, vh: number): WinRect {
  const w = Math.max(Math.min(WIN_MIN_W, vw - 16), Math.min(1180, Math.round(vw * 0.86)));
  const h = Math.max(Math.min(WIN_MIN_H, vh - 16), Math.min(760, Math.round(vh * 0.78)));
  return clampWinRect({ w, h, x: Math.round((vw - w) / 2), y: Math.max(8, Math.round((vh - h) / 2.4)) }, vw, vh);
}

/** No bigger than the screen (and no smaller than the minimum, room allowing); the title bar kept reachable. */
export function clampWinRect(r: WinRect, vw: number, vh: number): WinRect {
  const w = Math.round(Math.max(Math.min(WIN_MIN_W, vw - 16), Math.min(r.w, vw - 16)));
  const h = Math.round(Math.max(Math.min(WIN_MIN_H, vh - 16), Math.min(r.h, vh - 16)));
  const x = Math.round(Math.max(8 - w + 140, Math.min(r.x, vw - 140)));
  const y = Math.round(Math.max(8, Math.min(r.y, vh - 48)));
  return { x, y, w, h };
}

/** A remembered rectangle (JSON) put back on this screen, or the default. */
export function loadWinRect(raw: string | null, vw: number, vh: number): WinRect {
  try {
    const r = JSON.parse(raw ?? 'null') as Partial<WinRect> | null;
    if (r && [r.x, r.y, r.w, r.h].every(v => typeof v === 'number' && Number.isFinite(v))) return clampWinRect(r as WinRect, vw, vh);
  } catch { /* a preference only */ }
  return defaultWinRect(vw, vh);
}

// ── Positions as Live shows them ────────────────────────────────────────────

const SIXTEENTHS = 4; // per beat, in 4/4

/** A time on the tape as bars.beats.sixteenths from 1.1.1 (Live's position), rounded to the sixteenth. */
export function formatPosition(t: number, bpm: number): string {
  const s = Math.max(0, Math.round(t / (beatSeconds(bpm) / SIXTEENTHS)));
  const bar = Math.floor(s / 16), beat = Math.floor((s % 16) / SIXTEENTHS), six = s % SIXTEENTHS;
  return `${bar + 1}.${beat + 1}.${six + 1}`;
}

/** A length as bars.beats.sixteenths from 0.0.0 (Live's clip length), rounded to the sixteenth. */
export function formatLength(d: number, bpm: number): string {
  const s = Math.max(0, Math.round(d / (beatSeconds(bpm) / SIXTEENTHS)));
  return `${Math.floor(s / 16)}.${Math.floor((s % 16) / SIXTEENTHS)}.${s % SIXTEENTHS}`;
}

/**
 * Typed text back to seconds: "3", "3.2" or "3.2.4" (bars.beats.sixteenths;
 * missing parts are the first). `length`: parts count from 0 (2.0.0 is two
 * bars), else from 1. Null when it isn't a position.
 */
export function parsePosition(text: string, bpm: number, length = false): number | null {
  const parts = text.trim().split(/[.:\s]+/).filter(Boolean);
  if (!parts.length || parts.length > 3 || !parts.every(p => /^\d+(\.\d+)?$/.test(p))) return null;
  const base = length ? 0 : 1;
  const [bar, beat = base, six = base] = parts.map(Number);
  if (!length && (bar < 1 || beat < 1 || six < 1)) return null;
  const sixteenth = beatSeconds(bpm) / SIXTEENTHS;
  return Math.round(((bar - base) * 16 + (beat - base) * SIXTEENTHS + (six - base)) * sixteenth * 1e6) / 1e6;
}

// ── The key badge ───────────────────────────────────────────────────────────

const SHORT: Record<string, string> = { major: 'maj', minor: 'min' };

/** The tape's key as a MIDI clip shows it ("C maj", "F# Dorian"); empty with no scale on. */
export function scaleBadge(scale: ArrScale | null | undefined): string {
  if (!scale?.on) return '';
  return `${NOTE_NAMES[((scale.root % 12) + 12) % 12]} ${SHORT[scale.name] ?? scaleOf(scale.name).name}`;
}
