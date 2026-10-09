# Curve Trace

**Curve Trace** (2D Primitives) and **Curve Trace 3D** (3D Primitives) draw a continuous parametric curve as a real distance field.

Each axis is a signal of t: a Sine, Triangle, Square or Saw with its own frequency, phase, size and offset, or **Custom**, your own GLSL in `t` and `time`. The curve is cut into **Segments** straight pieces. The output is the exact distance to the nearest piece, minus **Thickness**. So it's an SDF like any other: colour it, glow it, round it, union it, use it in a Scene Group (3D).

| Output | |
|---|---|
| Distance | Distance to the line (2D) or tube (3D); negative inside. |
| Along | Where on the curve the nearest point is, 0 → 1. Colour along the line with it, or fade a trail. |

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

- **Curve Trace: pen drawing** and **Curve Trace: morph** (Curves & Shapes).
- **Curve Trace: harmonograph intervals** (Curves & Shapes): one ratio four ways, like the chart.
- **Curve Trace 3D: Lissajous knot** (3D SDF): a 3 : 2 : 5 knot, lit with Light the scene.
