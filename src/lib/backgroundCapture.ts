/**
 * backgroundCapture.ts — the pure side of capturing a background from a
 * graph: what the runtime is given for each render mode, which controls the
 * capture window shows, and whether the picture needs a warm-up before a
 * given time (captureSteps in backgroundLibrary.ts plans it).
 *
 *   Render mode 'graph': the shader alone. The Play record's layers, its
 *   Background layer and its header background (image, video, colour) are
 *   left out, so the picture is exactly the graph's.
 *   Render mode 'play': the shader with its layers and background, as Play
 *   shows it (the kit's overlay).
 */
import type { PlayHtmlInput } from '../play/exportHtml';
import { parsePropTarget, type PlayControl, type PlayLayerKind } from '../types/play';

export type CaptureMode = 'graph' | 'play';

/** Does this setup have anything Play draws over the shader (layers, or a background in its place)? */
export function hasPlayPicture(input: PlayHtmlInput): boolean {
  const p = input.play;
  return p.layers.length > 0 || (!!p.display && (p.display.source === 'image' || p.display.source === 'video' || p.display.source === 'colour' || p.display.picture === false));
}

/** The bundle the runtime mounts for a render mode. */
export function captureInput(input: PlayHtmlInput, mode: CaptureMode): PlayHtmlInput {
  if (mode === 'play') return input;
  const p = input.play;
  const controls = p.controls.filter(c => !parsePropTarget(c.target));
  const ids = new Set(controls.map(c => c.id));
  const { display: _d, ...rest } = p;
  void _d;
  return {
    ...input,
    play: { ...rest, layers: [], groups: undefined, actions: [], takes: undefined, finish: undefined, controls, mappings: p.mappings.filter(m => ids.has(m.controlId)) },
    backgroundGraphs: undefined,
  };
}

/** The controls the capture window offers: what the graph surfaces in Play, minus actions (a press isn't a setting). */
export function captureControls(input: PlayHtmlInput, mode: CaptureMode): PlayControl[] {
  return captureInput(input, mode).play.controls.filter(c => c.kind !== 'action');
}

/**
 * The layer kinds whose picture at a moment depends on the moments before it:
 * they simulate (particles, brushes, bodies), run code (scripts) or react to
 * what happened (glyphs, contours, audio, drum pads). Text, images, shapes,
 * video (seeked to its frame), lenses, cloners, data and the background are
 * functions of the time and the controls alone.
 */
export const SIMULATED_LAYER_KINDS: ReadonlySet<PlayLayerKind> = new Set<PlayLayerKind>(['particles', 'brush', 'bodies', 'script', 'glyphs', 'contours', 'audio', 'drumpad', 'camera', 'relationship']);

/**
 * Does a frame at time t depend on the frames before it? Feedback and echo
 * do, and so can layers (particles, sketches, bodies, envelopes on triggers):
 * those are stepped from 0 first. A plain shader is a function of time, and
 * so is a Play picture whose layers all are (SIMULATED_LAYER_KINDS) with
 * nothing smoothed or triggered driving them.
 */
export function needsWarmup(input: PlayHtmlInput, mode: CaptureMode): boolean {
  const passes = input.passes;
  if (passes && (passes.stateful || passes.echo)) return true;
  if (mode !== 'play') return false;
  const p = input.play;
  if (p.layers.length === 0) return false;
  if (p.layers.some(l => SIMULATED_LAYER_KINDS.has(l.kind))) return true;
  // Static layers, but driven with a memory: smoothing settles over time, triggers hold envelopes.
  if (p.mappings.some(m => m.smoothMs > 0 || m.source.kind === 'trigger')) return true;
  return !!(p.pairMappings?.length || p.signals?.length);
}

/** Pixels on a side at most while previewing (the settle's cost grows with them; the capture is full size). */
export const PREVIEW_MAX_SIDE = 1280;

/**
 * How many pixels the preview draws: the capture's shape at the size it is
 * shown, with the screen's density (up to 2×, 1.5× on touch screens) and no
 * more than PREVIEW_MAX_SIDE on a side. Never more than the capture itself.
 */
export function previewPixelSize(size: { w: number; h: number }, shown: number, dpr: number, touch: boolean): { w: number; h: number } {
  const k = Number.isFinite(shown) && shown > 0 ? shown : 1;
  const density = Math.min(Number.isFinite(dpr) && dpr > 0 ? dpr : 1, touch ? 1.5 : 2);
  let s = Math.min(1, k * density);
  const side = Math.max(size.w, size.h);
  if (side * s > PREVIEW_MAX_SIDE) s = PREVIEW_MAX_SIDE / side;
  return { w: Math.max(1, Math.round(size.w * s)), h: Math.max(1, Math.round(size.h * s)) };
}
