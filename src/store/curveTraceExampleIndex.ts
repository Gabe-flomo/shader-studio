/**
 * curveTraceExampleIndex.ts — names and descriptions for the Curve Trace examples (graphs in
 * curveTraceExamples.ts), apart so the examples browser can list them without loading the graphs.
 */

const ROWS: Array<[string, string, string]> = [
  ['curveTraceIntervals', 'Curve Trace: harmonograph intervals', 'One frequency ratio drawn four ways, as on a harmonograph chart: lateral open and closed phase (Lissajous), and two circles turning the same way (loops) or opposite ways (stars). Continuous lines as distance fields, coloured along their length. Play: the ratio, the drift.'],
  ['curveTraceLive', 'Curve Trace: live harmonograph', 'Two frequencies in Hz move a dot that leaves a short trail: a dot at 0 Hz, a circle drawn once a second at 1 : 1, a solid figure at high frequencies. Play: X and Y in Hz, phase, persistence.'],
  ['curveTraceBeam', 'Curve Trace: oscilloscope beam', 'The live dot drawn the way a scope\'s screen does: each frame only the stretch it just covered is laid into a fading phosphor screen, so a long, dense trail costs no more than a short one. Play: X and Y in Hz, persistence, glow.'],
  ['curveTracePen', 'Curve Trace: pen drawing', 'A pen head runs along a Lissajous figure and leaves a fading trail: slow, you watch it draw; fast, it blurs into the whole figure. Play: pen speed, trail, phase.'],
  ['curveTraceMorph', 'Curve Trace: morph', 'A fifth (3 : 2) flowing into a major third (5 : 4) and back: both figures worked out at every point and blended. Play: morph speed, figure B.'],
  ['curveTraceKnot', 'Curve Trace 3D: Lissajous knot', 'A 3D Lissajous curve (X 3, Y 2, Z 5) as a tube in a Scene Group: a knot that slowly turns, lit with Light the scene. Play: tube thickness, look around.'],
];
export const CURVE_TRACE_2D_KEYS = ['curveTraceLive', 'curveTraceBeam','curveTracePen', 'curveTraceMorph', 'curveTraceIntervals'];
export const CURVE_TRACE_3D_KEYS = ['curveTraceKnot'];
export const CURVE_TRACE_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = Object.fromEntries(
  ROWS.map(([key, label, description]) => [key, { label, description, play: true as const }]),
);
