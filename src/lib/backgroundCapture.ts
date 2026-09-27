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
import { parseLayerTarget, type PlayControl } from '../types/play';

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
  const controls = p.controls.filter(c => !parseLayerTarget(c.target));
  const ids = new Set(controls.map(c => c.id));
  const { display: _d, ...rest } = p;
  void _d;
  return {
    ...input,
    play: { ...rest, layers: [], groups: undefined, actions: [], takes: undefined, controls, mappings: p.mappings.filter(m => ids.has(m.controlId)) },
    backgroundGraphs: undefined,
  };
}

/** The controls the capture window offers: what the graph surfaces in Play, minus actions (a press isn't a setting). */
export function captureControls(input: PlayHtmlInput, mode: CaptureMode): PlayControl[] {
  return captureInput(input, mode).play.controls.filter(c => c.kind !== 'action');
}

/**
 * Does a frame at time t depend on the frames before it? Feedback and echo
 * do, and so can layers (particles, sketches, bodies, envelopes on triggers):
 * those are stepped from 0 first. A plain shader is a function of time.
 */
export function needsWarmup(input: PlayHtmlInput, mode: CaptureMode): boolean {
  const passes = input.passes;
  if (passes && (passes.stateful || passes.echo)) return true;
  return mode === 'play' && input.play.layers.length > 0;
}
