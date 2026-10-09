# Curve Trace

**Curve Trace** (2D Primitives) and **Curve Trace 3D** (3D Primitives) draw a continuous parametric curve as a real distance field.

Each axis is a signal of t: a Sine, Triangle, Square or Saw with its own frequency, phase, size and offset, or **Custom**, your own GLSL in `t` and `time`. The curve is cut into **Segments** straight pieces. The output is the exact distance to the nearest piece, minus **Thickness**. So it's an SDF like any other: colour it, glow it, round it, union it, use it in a Scene Group (3D).

| Output | |
|---|---|
| Distance | Distance to the line (2D) or tube (3D); negative inside. |
| Along | Where on the curve the nearest point is, 0 → 1. Colour along the line with it, or fade a trail. |
| Head | Distance to the end of the curve (the dot, in Live, Pen and Beam). |
| Intensity, Colour | Beam only (2D): the phosphor screen's glow, and that glow coloured. See Draw: Beam. |

## Motion

- **Lateral**: X and Y (and Z) each swing on their own wave. These are Lissajous figures: 3 : 2 is the fifth's pretzel. The X phase opens or closes the figure (1.5708 open, 0 folded).
- **Rotary, same way**: two circular motions added. The first circle uses X's frequency, size and phase; the second uses Y's. The result is circles with loops.
- **Rotary, opposite ways**: the second circle turns the other way, giving stars and flowers.

These are the two halves of a harmonograph chart. Damping (with more Turns) shrinks the waves as t runs: a harmonograph spiral.

## Draw: whole or pen

- **Whole**: the curve from **Start** to **End** (0–1 of Turns × 2π). Wire Start or End to draw it on.
- **Pen**: a head moves **Pen speed** turns a second and leaves **Trail** turns of line behind it. Along is 0 at the tail and 1 at the head, so fade with it.
  - Slow, you watch it draw.
  - Fast, with Trail 1, it becomes the whole continuous figure.

## Draw: Live (like a harmonograph or a scope)

- **Frequencies are cycles a second.** At 1 Hz the dot goes round once a second; at 0 Hz it rests in the middle (a phase grows in over the first hertz, so a still axis sits at its offset).
- **Persistence** is how many seconds of the dot's path stay on screen. At low frequencies that is a dot with a short tail; as the frequencies rise, the same time covers more of the figure until it is a solid line.
- **Damping** shrinks the trail toward its tail.
- **Along** runs 0 at the tail to 1 at the dot.
- **Head** (a new output, in every mode) is the distance to the end of the curve: in Live and Pen, the dot itself.

Example: **Curve Trace: live harmonograph**.

## Draw: Beam (an oscilloscope screen; 2D only)

Beam moves the dot exactly as Live does (X and Y in Hz, phases, Damping, Morph, both Rotary motions), but draws it the way a scope's phosphor screen does:

- **Each frame, only the stretch the dot covered since the last frame is drawn**, into a screen of the node's own. The screen fades by e (to 37%) every **Persistence** seconds.
- **Its cost doesn't depend on the trail.** A long Persistence or a dense, high-frequency figure costs the same per frame as a short tail: what a frame costs is the few pieces of that frame's stretch, not the whole trail.
- **It stays a curve when the dot moves fast.** The frame's stretch is cut into as few pieces as keep every wave turning less than 0.2 radians a piece, so a 60 Hz figure is still smooth. **Segments** is the most pieces one frame can use (a Custom axis always uses Segments).
- **Beam width** is the spot's width (a soft Gaussian). **Glow** adds a wide halo (four times the width). **Dwell** makes the beam burn brighter where it moves slowly, as on a real screen: a 0 Hz dot glows, the turns of a Lissajous are brighter than its fast middles. **Brightness** and **Beam colour** set the Colour output.
- **How bright a line is.** One pass of the beam lays down a full line while it moves slower than once round its swing per Persistence. Faster, each pass lays down less, as a scope's faster sweep does. So a figure retraced many times within Persistence settles near the brightness of one slow pass instead of piling up to white, and stays brightest at its turns and crossings.
- **Damping** shrinks the screen toward the curve's centre each frame, so the old trail spirals in like Live's. (It shrinks in picture coordinates: with a warped UV wired in, the shrink ignores the warp.)
- **Changing settings changes only what is drawn from then on**, as on a real scope: drag a frequency and the old trace fades out in the old shape. (Live redraws the whole trail in the new shape.)
- **Screen size** (full, ½, ¼) is the screen's resolution: ½ costs a quarter, slightly softer.

| Output (Beam) | |
|---|---|
| Intensity | The screen's glow here: 0 where the beam never went, about 1 on a line it just drew. It adds where the figure crosses itself. Unbounded (half float). |
| Colour | Intensity in Beam colour, saturating toward white where bright: `1 − exp(−Brightness × Intensity × Beam colour)`. |
| Head | The exact distance to the dot now, as in Live. |
| Distance | In Beam, the dot's distance minus Thickness (a disc at the dot). The persisted trail has no distance. |
| Along | Always 1 in Beam: the trail has no "where along". |

In the other Draw modes Intensity is 0 and Colour black.

**How it works.** The compiler opens the node into a hidden Pass, as it does for Grid Rules (`compiler/curveBeamExpand.ts`): a step program (`curveTraceBeamStep`) that reads the screen's Previous, fades it and lays in the new stretch, and the Pass that keeps it; the node reads the Pass's texture. The step's sliders are the node's own uniforms, so dragging a slider or a Play control never recompiles. Nothing in the engine is new: the screen is drawn and kept like any Pass with feedback, in the preview, in recordings and on exported pages. A Beam counts toward the 8-Pass limit.

**Its own clock.** The screen's green, blue and alpha channels hold the time it was last drawn (seconds mod 128, in 1/65536ths). Each frame reads it back to know how far the dot moved and how much to fade, so it needs no frame time from the host. Paused, nothing is added or faded. A recording at 24, 30 or 60 fps comes out the same as the preview (tested: 24 vs 60 fps differ by at most 3/255 per channel), and the same times always give the same picture. A fresh screen (the first frame, time run backwards, or a gap over a second, such as a take starting at 0:20) starts with the last 4 × Persistence (at most a second) of path, so it is never empty.

**Cost** (M3 Pro, 2048 × 2048, GPU time a frame, a trivial picture's 0.3 ms subtracted; Live at the Segments its trail needs):

| Case | Live | Beam | Beam ½ |
|---|---|---|---|
| 3 : 2 Hz, Persistence 0.5 (the example) | 7.6 ms | 1.9 ms | 0.55 ms |
| 1 : 1 Hz, Persistence 0.25 (Live example, 720 segments) | 12.3 ms | 1.4 ms | 0.34 ms |
| 30 : 20 Hz, Persistence 1 (2048 segments) | 83.4 ms | 6.8 ms | 1.9 ms |
| 60 : 40 Hz, Persistence 3 (2048 segments) | 210 ms | 10.4 ms | 3.3 ms |

Beam's cost grows with how far the dot moves in one frame (higher frequencies, more pieces), never with Persistence.

**Limits.** Beam is 2D only. Where half-float textures aren't available the screen falls back to 8-bit, which clips Intensity at 1 and fades in coarse steps. Inside a group, a Beam follows a Pass's rules (only a plain group, run once). A UV that evaluates the curve somewhere other than this pixel (a node that re-runs its input at offsets) reads the screen at this pixel, not there.

Example: **Curve Trace: oscilloscope beam**.

## Morph

With **Morph** on, the node works out a second figure from the **B** frequencies at every point along the curve, and blends the two by **Morph amount**. Both figures are closed, so every in-between shape is a smooth closed curve too. Wire an LFO or a Time expression into Morph amount to flow back and forth.

## Cost

Each pixel (2D), or each march step (3D), finds the nearest of the Segments pieces.
- Smooth curves (Sine and Triangle waves, both Rotary motions, Morph between them) don't visit every piece. The curve is cut into stretches of 16, and how fast it can move bounds how far each stretch reaches from its middle point. A pixel first measures the distance to every stretch's middle, then walks only the stretches that could hold something nearer. Away from the line that skips most of the work: a Live dot with a 720-segment trail went from about 70 ms to 9 ms of GPU work at 2048 × 2048. Distance and Head are exactly what visiting every piece gives; Along can differ only where the curve passes over itself, where two places are equally near.
- It helps little when the curve is dense: high frequencies with a long trail, where a stretch reaches across most of the picture.
- Square, Saw and Custom axes can jump, so nothing can be bounded: they visit every piece.
- The 3D node skips the loop when the point is clearly outside the curve's bounding sphere. With a Custom axis the bound is unknown, so it always loops.
- Use about 10 segments per wiggle: 256–400 is plenty for ratios up to 9:8.

## Examples

- **Curve Trace: live harmonograph** and **Curve Trace: oscilloscope beam** (Curves & Shapes): the same dot as a distance and on a phosphor screen.
- **Curve Trace: pen drawing** and **Curve Trace: morph** (Curves & Shapes).
- **Curve Trace: harmonograph intervals** (Curves & Shapes): one ratio four ways, like the chart.
- **Curve Trace 3D: Lissajous knot** (3D SDF): a 3 : 2 : 5 knot, lit with Light the scene.
