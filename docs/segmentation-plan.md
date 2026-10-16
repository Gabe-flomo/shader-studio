# Segmentation masks: plan

*2026-10-14. The "next big thing" (memory: project-segmentation-masks): select or key people and objects in
pictures and videos, and pass the mask along the graph as a float and a texture.*

## What it is

A **Segment** node (Texture tools). A picture goes in; out come:

- **Mask** (float, 0–1, soft edge) at this pixel;
- **Cut-out** (the picture times the mask) and its **Alpha**;
- **Mask texture**, for anything that reads textures: Blob Track, Particles' sprite and Emit from, Pass, Cache,
  Displace, the Texture tools;
- **Edge** (where the mask changes), for outlines and glows.

So a person can glow, be cut out over a 3D scene, drive Blob Track, emit particles, or be delayed by a Cache,
all from a webcam with no green screen.

## Modes (models)

All on this device, in a worker, through MediaPipe Tasks (already used by hands, face and pose tracking; its WASM
ships with the app). Every model below is **Apache 2.0** (model cards read 2026-10-14) and runs in real time on a
phone, so live webcam and video are realistic.

| Mode | Model | Size | Gives |
|---|---|---|---|
| **People** | Selfie Segmenter (256 × 256 / landscape 144 × 256) | 0.25 MB | person vs background |
| **People parts** | Selfie Multiclass (256 × 256) | 16.4 MB | hair, face skin, body skin, clothes, accessories: pick any |
| **Objects** | DeepLab v3 (257 × 257, Pascal VOC) | 2.8 MB | 20 classes: person, cat, dog, bird, horse, sheep, cow, car, bus, bicycle, motorbike, train, boat, aeroplane, bottle, chair, dining table, potted plant, sofa, TV: pick any |
| **Click** | MagicTouch interactive segmenter (512 × 512 + a point) | 6.2 MB | whatever is under a point: click it on the preview, or wire a point (a Blob Track's Position, the Mouse) |

**Click** follows what it selected in a video: each frame's point is last frame's mask centre (unless a point is
wired), so a clicked ball or face stays selected as it moves.

Not now: SAM-family models (bigger, slower, a box/point prompt with the same use as Click), BiRefNet-class matting
for hair-fine stills (a later quality mode for stills and bakes), YOLO-seg (AGPL: not for a paid app), RMBG-1.4
(non-commercial).

## Refining the mask (live sliders, in the shader)

- **Threshold** and **Softness**: where the model's confidence becomes the mask, and how soft the edge is.
- **Grow / Shrink** (pixels, at the mask's size), **Invert**.
- **Smoothing** over time (less flicker; a little lag).
- **Edge refine**: the low-resolution mask snapped to the picture's own edges (a guided filter against the source
  at full size), so the outline follows hair and fingers instead of the model's 256 px grid. Phase 2.

## How it runs

The Depth node's pattern (lib/depth/engine.ts):

1. After each frame, the wired texture is copied at the model's size on the GPU (the Grabber) and sent to the
   segmentation worker (MediaPipe ImageSegmenter / InteractiveSegmenter, GPU delegate, CPU fallback).
2. The confidence mask comes back (Float32), is smoothed and uploaded to a half-float texture, the node's
   `u_tex_<node>`; the shader does Threshold, Softness, Grow, Invert and the cut-out.
3. The picture never waits: the last mask stays until the next arrives. **Update**: Live, Every Nth frame, or
   **Baked** (video: run once, keep the masks as a video beside it, smooth and exact for exports and web pages,
   as Depth's Bake depth).

Models are served by the app (`public/mediapipe/`, like the trackers' `.task` files) so nothing is fetched from
anywhere at run time; Click and Objects load only when first used.

## Phases

1. **Segment node, live**: People, Objects, Click (point on the preview or wired), all live for images, webcam and
   video; Threshold, Softness, Grow, Invert, Smoothing; Mask, Cut-out, Alpha, Mask texture, Edge; card with mode,
   class chips and a Pick button; examples (camera cut-out glow; click a ball and stamp it); docs; tests.
2. **Edge refine** and **Bake** for videos: shipped 2026-10-15. **People parts** still to come (opt-in download).
3. **Video sizes** (agreed 2026-10-12): Video Input Preview size (Full / 1080 / 720 / 540, shrunk on the GPU),
   exports read the original size by default, pixel-unit settings scaled to a 1080 reference, cost readouts.
4. A higher-quality still/bake mode (BiRefNet-class, opt-in download) if Phase 1–2 edges aren't enough.

## Open questions

- Decided 2026-10-14: ship People + Objects + Click (9.3 MB, downloaded with the user's OK); People parts later as an
  opt-in download.
- Phase 1 found: MediaPipe builds one kind of task per WASM instance, so each mode has its own worker. Click from a
  wired point moves to phase 2 (a point from the graph is a GPU value; Blob Track's can be read on the CPU).
- Web pages: live segmentation in exported pages needs the model files beside the page (size); Phase 1 exports a
  blank mask, Bake (phase 2) makes them exact.
