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
- **Update:** Live, Every Nth frame, or **Baked** (see Bake below). **Smoothing:** blends each mask with the last.
- **Threshold**, **Softness:** where the confidence becomes the mask, and how soft its edge. **Grow** (pixels;
  negative shrinks, the most or least confident of eight taps), **Invert**. These are live sliders and Play controls.
- **Edge refine** (with a Texture wired): the model works at 256–512 px, so its edge is a little blocky. On, the mask
  snaps to the picture's own edges: each pixel's mask is the mask round it (5 × 5 taps, **Refine reach** mask pixels
  apart) weighted by how alike the picture's colour is there (a joint bilateral upsample), so mask from across an
  edge in the picture counts for little and the outline follows hair, fingers and outlines at full size. **Colour
  difference** is how different a colour must be to count as the other side of an edge.

## Bake

**Bake** on the card runs the model once over the whole video (or image) wired into Texture and keeps the masks
beside it in the library, as Depth's Bake depth does: every frame at 30 fps (up to a minute), seeked exactly,
smoothed as the node smooths; Click with Follow tracks its point from frame to frame. Video becomes a grey mask
video, a still a grey PNG. Update then turns to **Baked**: the mask video plays in step with its source (it follows
the source's time, and is seeked frame by frame in exports), no model runs, and recordings and web pages get the
exact masks. Threshold, Softness, Grow, Invert and Edge refine still work live on the baked masks. **Live again**
goes back to the model; **Use the bake** returns to it. A webcam can't be baked (record it first).

The card shows the model's state, its time per frame, the size it reads at and how much of the frame it finds.

## How it works

`lib/segment/engine.ts`, the Depth engine's pattern: after each frame the source is copied at the model's size on
the GPU (the Grabber) and sent to that mode's worker (`lib/segment/segmentWorker.ts`). The picture never waits: the
last mask stays until the next arrives, then it is smoothed and uploaded to the node's 8-bit texture
(`u_tex_<node>`), which the node reads, linearly filtered, and shapes in the shader.

## Limits

- Live (not baked) Segment nodes give web pages a blank mask; bake the video for exact masks there.
- People parts (hair, face, clothes) and Click from a wired point (a Blob Track's Position) are still to come.

Examples: Texture tools 20 (cut yourself out) and 21 (click to select). Code: `src/nodes/definitions/segment.ts`,
`src/lib/segment/`. Tests: `src/lib/segment/__tests__/segment.test.ts`.
