/**
 * ProRes in the Record dialog: the six profiles, what each is called on the desktop (FFmpeg's
 * prores_ks, src-tauri/src/export_codecs.rs) and in the browser (prores-wasm-encoder's
 * ProResProfile numbers), their rough data rates for a size estimate, and the dialog's notes.
 * Pure: no encoder is loaded from here (see proresWasm.ts for the browser's).
 */
import type { FfmpegCodec } from './ffmpegRecorder';

export type ProResProfileId = '4444' | '4444xq' | 'hq' | '422' | 'lt' | 'proxy';

export interface ProResProfileInfo {
  id: ProResProfileId;
  /** The profile select's label. */
  label: string;
  /** The desktop's codec name for start_ffmpeg_encode. */
  ffmpegCodec: FfmpegCodec;
  /** prores_ks -profile:v, and prores-wasm-encoder's ProResProfile value (the same numbers). */
  profileNumber: 0 | 1 | 2 | 3 | 4 | 5;
  /** FFmpeg's output pixel format. */
  pixFmt: 'yuv422p10le' | 'yuva444p10le';
  /** QuickTime fourcc, as ffprobe shows it. */
  fourcc: 'apco' | 'apcs' | 'apcn' | 'apch' | 'ap4h' | 'ap4x';
  /** Holds an alpha channel (transparency). */
  alpha: boolean;
  /** Apple's target rate at 1920×1080, 29.97 fps, in Mbit/s (the ProRes white paper; alpha adds some). */
  mbps1080p30: number;
}

/** In the select's order: the alpha pair first (the reason to pick ProRes here), then 422 down. */
export const PRORES_PROFILES: readonly ProResProfileInfo[] = [
  { id: '4444',   label: '4444 (alpha)',    ffmpegCodec: 'prores4444',   profileNumber: 4, pixFmt: 'yuva444p10le', fourcc: 'ap4h', alpha: true,  mbps1080p30: 330 },
  { id: '4444xq', label: '4444 XQ (alpha)', ffmpegCodec: 'prores4444xq', profileNumber: 5, pixFmt: 'yuva444p10le', fourcc: 'ap4x', alpha: true,  mbps1080p30: 500 },
  { id: 'hq',     label: '422 HQ',          ffmpegCodec: 'prores',       profileNumber: 3, pixFmt: 'yuv422p10le',  fourcc: 'apch', alpha: false, mbps1080p30: 220 },
  { id: '422',    label: '422',             ffmpegCodec: 'prores_422',   profileNumber: 2, pixFmt: 'yuv422p10le',  fourcc: 'apcn', alpha: false, mbps1080p30: 147 },
  { id: 'lt',     label: '422 LT',          ffmpegCodec: 'prores_lt',    profileNumber: 1, pixFmt: 'yuv422p10le',  fourcc: 'apcs', alpha: false, mbps1080p30: 102 },
  { id: 'proxy',  label: '422 Proxy',       ffmpegCodec: 'prores_proxy', profileNumber: 0, pixFmt: 'yuv422p10le',  fourcc: 'apco', alpha: false, mbps1080p30: 45 },
];

export const proresProfile = (id: ProResProfileId): ProResProfileInfo => PRORES_PROFILES.find(p => p.id === id) ?? PRORES_PROFILES[0];

/** The profile an export uses: a transparent one always keeps alpha (4444 unless 4444 XQ was picked). */
export function effectiveProResProfile(id: ProResProfileId, transparent: boolean): ProResProfileInfo {
  const p = proresProfile(id);
  return transparent && !p.alpha ? proresProfile('4444') : p;
}

/**
 * A rough file size in bytes: Apple's 1080p30 rate scaled by pixels and frame rate (and ×1.5 for
 * the alpha plane). ProRes is intra-only, so the size grows with both; busy pictures and soft
 * alpha run higher, flat ones lower.
 */
export function proresEstimateBytes(id: ProResProfileId, width: number, height: number, fps: number, seconds: number): number {
  const p = proresProfile(id);
  // Apple's 4444 rates leave the alpha plane out; a glow keyed to alpha measured about 2× (720×1254, 60 fps, 5 s:
  // 368 MB against 180 MB), a hard-edged shape far less, so alpha profiles count half again.
  const bitsPerSecond = p.mbps1080p30 * (p.alpha ? ALPHA_FACTOR : 1) * 1e6 * (width * height) / (1920 * 1080) * (fps / 29.97);
  return Math.max(0, bitsPerSecond * seconds / 8);
}

const ALPHA_FACTOR = 1.5;

/** "≈ 420 MB", "≈ 1.3 GB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `≈ ${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `≈ ${Math.round(bytes / 1e6)} MB`;
  return `≈ ${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

/** A browser tab holds the whole file in memory until it saves: above this the dialog warns. */
export const BROWSER_PRORES_WARN_BYTES = 2e9;

export interface ProResNotesInput {
  profile: ProResProfileId;
  transparent: boolean;
  /** The graph ends in Output (RGBA). */
  ownAlpha: boolean;
  /** What a transparent export does with the picture (own alpha, brightness, left out). */
  picture: 'own' | 'luma' | 'drop';
  /** The browser's encoder (no audio track). */
  wasm: boolean;
  /** There's sound that would go in. */
  hasSound: boolean;
  estimateBytes: number;
}

export interface ProResNotes {
  profile: ProResProfileInfo;
  /** "Keeps transparency": the file's alpha is the picture's. */
  keepsAlpha: boolean;
  /** Warnings shown under the profile, in order. */
  warnings: { title: string; text: string }[];
  /** Why the sound is off (the browser's encoder), or null. */
  audioNote: string | null;
  /** Sound can go into this file. */
  audioAllowed: boolean;
}

/** What the dialog says about a ProRes export. */
export function proresNotes(o: ProResNotesInput): ProResNotes {
  const profile = effectiveProResProfile(o.profile, o.transparent);
  const keepsAlpha = profile.alpha && o.transparent;
  const warnings: ProResNotes['warnings'] = [];
  if (profile.alpha && !o.transparent) {
    warnings.push({ title: 'This file will be opaque', text: `${profile.label.replace(' (alpha)', '')} can hold transparency, but Transparent is off, so the alpha is solid. Turn on Transparent (Background) to keep it.` });
  } else if (keepsAlpha && !o.ownAlpha && o.picture === 'luma') {
    warnings.push({ title: 'The graph has no alpha', text: 'Its output is opaque (the Output\'s Alpha is empty and its Opacity is 1), so the transparency comes from brightness: black turns clear. For solid shapes, wire the Output\'s Alpha or lower its Opacity.' });
  } else if (keepsAlpha && !o.ownAlpha && o.picture === 'own') {
    warnings.push({ title: 'The graph has no alpha', text: 'Its own alpha is 1 everywhere (the Output\'s Alpha is empty and its Opacity is 1), so this file would be solid. Wire the Output\'s Alpha, lower its Opacity, or pick Black turns clear.' });
  }
  if (o.wasm && o.estimateBytes > BROWSER_PRORES_WARN_BYTES) {
    warnings.push({ title: 'A big file for a browser', text: `${formatBytes(o.estimateBytes)} is held in this tab's memory until it saves. Shorten it, lower the resolution, pick a lighter profile, or use the desktop app.` });
  }
  const audioNote = o.wasm && o.hasSound
    ? 'The browser’s ProRes encoder writes video only, so this file has no sound. The desktop app’s FFmpeg export includes it.'
    : null;
  return { profile, keepsAlpha, warnings, audioNote, audioAllowed: !o.wasm };
}

/** Force alpha to opaque, in place: an alpha profile when Transparent is off must not carry the shader's stray alpha. */
export function forceOpaque(rgba: Uint8Array): void {
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
}
