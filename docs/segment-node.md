# Segment

**Segment** (Texture tools) cuts people, objects, or whatever you click out of a picture or video as a mask, on
this device, with no green screen. Plan and later phases: [segmentation-plan.md](segmentation-plan.md).

Wire a Video Input (or the camera), a Texture Input, Baked or a Pass into **Texture**.

## Find

| Mode | Model (MediaPipe, Apache 2.0, served by the app) | Finds |
|---|---|---|
| People | Selfie Segmenter (0.25 MB, 256 px) | everyone in the picture |
| Objects | DeepLab v3 (2.8 MB, 257 px) | the **Kinds** you pick on the card: person, cat, dog, bird, horse, sheep, cow, car, bus, bicycle, motorbike, train, boat, aeroplane, bottle, chair, table, potted plant, sofa, TV |
| Click | MagicTouch (6.2 MB, 512 px) | whatever is under a point: **Pick on preview** on the card, then click the picture (Esc cancels). **Follow** looks next frame where the object is now (its mask's middle) |

Each model loads the first time its mode is used, in a worker of its own (MediaPipe builds one kind of task per
WASM instance), GPU first and the CPU when that fails. On a picture with no person, People guesses the most
person-like shape: use Objects or Click there.

## Outputs

| Output | What it is |
|---|---|
| Mask | 1 on what was found, 0 elsewhere, soft at the edge. |
| Cut-out | The picture times the mask. |
| Alpha | The same as Mask, for Alpha Blend or Mix. |
| Edge | Bright along the mask's edge: outlines, glows. |
| Mask texture | The model's confidence (red, 0–1, before Threshold) as a texture: Blob Track, Particles' Emit from, a Pass, a Cache, Blur, the Texture tools. |

## Settings

- **Resolution:** Auto (the model's own) or 256 / 384 / 512 px on the long side.
- **Update:** Live, or Every Nth frame. **Smoothing:** blends each mask with the last.
- **Threshold**, **Softness:** where the confidence becomes the mask, and how soft its edge. **Grow** (pixels;
  negative shrinks, the most or least confident of eight taps), **Invert**. These are live sliders and Play controls.

The card shows the model's state, its time per frame, the size it reads at and how much of the frame it finds.

## How it works

`lib/segment/engine.ts`, the Depth engine's pattern: after each frame the source is copied at the model's size on
the GPU (the Grabber) and sent to that mode's worker (`lib/segment/segmentWorker.ts`). The picture never waits: the
last mask stays until the next arrives, then it is smoothed and uploaded to the node's 8-bit texture
(`u_tex_<node>`), which the node reads, linearly filtered, and shapes in the shader.

## Limits (phase 1)

- Web pages and video exports don't segment yet (a blank mask). Bake for videos is phase 2.
- People parts (hair, face, clothes), Edge refine (snapping the edge to the picture), and Click from a wired point
  (a Blob Track's Position) are phase 2.

Examples: Texture tools 20 (cut yourself out) and 21 (click to select). Code: `src/nodes/definitions/segment.ts`,
`src/lib/segment/`. Tests: `src/lib/segment/__tests__/segment.test.ts`.
