# Analyze

**Analyze** (Texture tools) measures a whole picture into numbers you can wire anywhere. It does what
TouchDesigner's Analyze TOP and a TOP to CHOP do together.

Wire a Video Input (or the camera), a Texture Input, Baked, a Pass or a Shader Texture into **Texture**.
Left empty, it measures the picture itself (a frame late).

## Outputs

Each is one value for the whole picture, the same at every pixel.

| Output | What it is |
|---|---|
| Colour | The average colour. |
| Brightness | The average brightness, 0–1. |
| Coverage | How much of the picture is brighter than Threshold, 0–1. |
| Centre | The middle of the part brighter than Threshold, in picture coordinates (as UV); the picture's centre when nothing is. |
| Brightest point | Where its single brightest pixel is. |
| Peak | How bright that pixel is. |
| Contrast | How much brightness varies (the standard deviation of brightness, 0 flat, about 0.5 at most). |
| Motion | How much it changed since the last frame (the mean change in brightness), times Motion gain. |
| Numbers | All of it as a 4 × 1 float texture, for code. |

## Settings

- **Resolution:** the long side it is read at, 32, 64 (default) or 128 px. Averages need little; a small bright
  point is found more exactly at 128.
- **Threshold:** what counts as lit, for Coverage and Centre.
- **Smoothing:** blends each frame's numbers with the last (less flicker, a little lag).
- **Motion gain:** scales Motion (the raw change is a few hundredths). A live slider, a socket and a Play control.

The card shows the average colour as a swatch and the live Brightness, Coverage and Motion.

## Uses

- A light meter: Brightness → Lag → anything.
- Follow a light: Centre into a shape's centre (example 17).
- React to movement: Motion → an Envelope's Gate, or straight into glow, speed, a Cache's Delay.
- Colour from a video: Colour as a backdrop, a palette offset, a light colour.

## How it works

`lib/analyze/engine.ts`, like Blob Track's engine: right after the preview draws, the source is copied small on the
GPU and read back (the Depth engine's Grabber), `lib/analyze/stats.ts` measures it (Rec. 709 brightness), the
numbers are smoothed and uploaded to the node's 4 × 1 float texture (`u_tex_<node>`), which the node reads with
texelFetch. It runs every frame while the preview plays (a few ms) and once after a change while paused.

## Limits (v1)

- Web pages and video exports don't measure yet (they see zeros).
- Not yet: the numbers as Play sources, measuring a region of the picture.

Example: Texture tools 17 · Analyze: a video steers a shape. Code: `src/nodes/definitions/analyze.ts`,
`src/lib/analyze/`. Tests: `src/lib/analyze/__tests__/analyze.test.ts`.
