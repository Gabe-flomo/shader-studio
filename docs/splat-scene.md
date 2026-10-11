# Splat Scene

A Gaussian splat scan from another app, drawn through Playfield's camera and put together with ray-marched shapes by
distance. The node is in the node browser under 3D Scene. The plan it belongs to is `docs/depth-and-splats-plan.md`
(section 2, phase 2).

## Loading a scan

| Format | From | Read |
|---|---|---|
| `.ply` | The 3DGS standard (Postshot, Polycam, Luma, Scaniverse, Nerfstudio, gsplat exports) | Binary, little or big endian, any property types; `x y z`, `f_dc_0..2`, `opacity`, `scale_0..2`, `rot_0..3`, and `f_rest_*` for spherical harmonics up to degree 3 |
| `.splat` | antimatter15's viewer format (32 bytes a splat) | Yes; it has no harmonics |
| `.spz` | Niantic's compressed format (Scaniverse) | Versions 1–3 (gzip). Version 4 (ZSTD streams) is refused with a message; export as `.ply` or an older `.spz` |
| `.ksplat` | GaussianSplats3D | Not yet: the card says so |

Also refused with a clear sentence: SuperSplat's compressed `.ply` (a `chunk` element), ASCII `.ply`, point clouds and
meshes (no `scale_0` / `rot_0` / `opacity`), cut-short files, and anything over 1 GB.

Three ways to load it:

- **Drop** the file on the card's picture;
- **Load…** (or **Replace…**), the file picker;
- **From the library:** a scan already kept here, or one the workspace folder brought from the other app (desktop and
  browser share it: docs/workspace-folder.md).

### Where the file is kept

In the library, by reference, like a video: the bytes go into the library's file store (`lib/backgroundLibrary.ts`, the
`videos` store, type `model/x-splat-<format>`), and the node keeps only `videoId`, `fileName` and `bytes`. So a scan:

- travels in **.playfile** bundles (`playfile/bundle.ts` finds `videoId`; past 200 MB the export asks first, as for
  videos), in library ZIPs, the backup folder and the workspace folder;
- is left out of every *video* list (Video layers, Time Cube, Texture, the Library's videos: `listVideos()` skips
  `isSplatType`), and counts towards storage with the videos.

The Files page doesn't list scans yet (a follow-up).

### Parsing

In a Web Worker (`lib/splats/worker.ts`, `workerCore.ts`): the file is read (`format.ts`), thinned to **Max splats**
(evenly through the file, `subset.ts`), laid out for the GPU (`pack.ts`) and a small picture made, without touching the
editor's thread. Times here (Apple Silicon): a 281 k-splat `.splat` in 12–25 ms, the 1 M-splat `train.splat` in 45–60
ms, a 255 MB SH-3 `.ply` of it in 280 ms.

## Wiring

| Input | What |
|---|---|
| Ray Origin, Ray Dir | The March Camera's (or any camera's rays). Unwired: a camera 3 back on +z, lens 1.5 |
| Scene, Scene distance, Scene hit | The March Loop's Color (or the lighting after it), Distance and Hit. Unwired: the splats over black |
| Position, Rotation, Scale | Optional sockets ("Control from outside" on the sliders): wire Time, Play or anything to move the scan |

| Output | What |
|---|---|
| Color | The scan and the scene put together: the nearer wins at each pixel |
| Alpha | How much of the scan shows (0 where the scene hides it) |
| Distance | The nearer surface's distance (the splats' or the scene's), the March Loop's kind |
| Hit | 1 where the splats (alpha ≥ *Solid at*) or the scene are solid |
| Scene in front | 1 where the scene's surface hides the splats |
| Splat distance | The splats' own distance at this pixel |
| Splats texture | The splats alone (premultiplied colour, alpha), for Sample, Blur and the Texture tools |

**Add to scene** (on the card) wires a loose Splat Scene to the graph's first March Loop: its camera's rays, what the
Output shows now as Scene, the loop's Distance and Hit, and puts its Color on the Output. A March Loop or GI Lit card
has **Add a splat scan** (the sparkle icon), which adds a Splat Scene wired the same way. Both are one undo step.

## Settings

- **Place:** Position, Rotation (degrees, X then Y then Z: the Transform node's order), Scale, and **Up is**: most scans
  have y pointing down (3DGS, COLMAP), so −Y turns them over; +Y leaves them as they are. **Fit to the scene** sets
  Position and Scale so the scan's middle (its box without the farthest 1 % each way) sits at the centre, about 3
  units across. Position, Rotation and Scale are live uniforms: dragging them, Play mappings and keyframes never recompile.
- **Look:** Splat size (scales every Gaussian), Opacity.
- **Quality:** Max splats (100 k – 4 M), Sort (when the camera moves, or every frame), SH degree (0 flat colour … 3),
  Resolution (full, or half: a quarter of the pixels to fill).
- **Compositing:** Edge softness (how gently the scene and the splats cross, in scene units), Solid at.

## How it draws

A raster pass before the picture (`lib/splats/engine.ts`, `render.ts`, `shaders.ts`), not a per-pixel shader:

1. **The probe.** The compiler makes a small program per Splat Scene (`compiler/splatGraph.ts`): the chain wired into
   Ray Origin, Ray Dir, Position, Rotation and Scale, ending in the node itself, drawn over 8 × 1 float texels: the eye,
   the rays at the picture's centre, half a height right and half up, and the scan's model matrix (with Splat size and
   Opacity). It uses the picture's own uniforms, so sliders, Play and time drive it. Nodes that read `vUv` directly (the
   UV node a March Camera is often wired from) read the probe's point.
2. **The splats.** One instanced quad per splat (WebGL2, `RGBA32UI` textures: centre, colour, covariance as half
   floats; harmonics as bytes in a second texture). The vertex shader rebuilds the camera from the probe (forward is the
   centre ray; right / up and the lens come from how far the side rays lean), places the covariance in the world
   (M Σ Mᵀ), and projects it with the EWA Jacobian (Kerbl et al. 2023): Σ₂ = J W Σ Wᵀ Jᵀ + 0.3 px². The quad spans
   √(2λ) along the ellipse's axes, and the fragment weighs exp(−|v|²), alpha capped at 0.99, as 3DGS does. With SH
   degree > 0, the view-dependent colour is added from the view direction in the scan's own space.
3. **Back to front.** The worker sorts by depth along the view direction (in the scan's own space, Mᵀ · forward) with a
   counting sort on 16-bit keys. The engine reads the probe back without waiting (a pixel-pack buffer and a fence) and
   asks for a new order when the view has turned more than 0.25°, or every frame (Sort: every frame). The new order lands
   on a later frame; the camera itself is never late (the GPU reads it from the probe).
4. **Two targets.** Colour (premultiplied) and, in a second half-float target, Σ αᵢ Tᵢ dᵢ with the same alpha: divided
   by alpha it is the splats' distance at the pixel. The node samples both at the pixel and composites.

The CPU mirror of the maths is `lib/splats/math.ts` (covariance, projection, ellipse, weight, camera from the probe,
the model matrix); the tests check it against hand-worked values.

### Compositing with ray-marched shapes

Per pixel, the splats have a colour, an alpha and a distance; the scene has a colour, a distance and a hit. Where the
scene's surface is nearer than the splats (over *Edge softness*), the scene shows; otherwise the splats lie over the
scene by their alpha. So a sphere passing through a scan is hidden where the scan is in front of it, and hides the scan
where it is in front.

**Limit:** each pixel has one splat distance (the alpha-weighted mean). A solid surface reads right; a soft volume (fog,
hair, a semi-transparent halo) in front of and behind a shape at the same pixel blends as if it were at its mean
distance. Exact per-splat occlusion needs the scene's distance inside the splat pass (a follow-up).

### Offline renders

Export, Snapshot and Bake call `settleSplats` before each frame: the probe is read at once for the frame's time and the
scan sorted for it, waited for, so every exported frame is in order. Then the splats are drawn at the export's size.

## Performance

Measured in the app's browser pane on this Mac (Apple Silicon), 2026-10-10. The splat pass is the probe, the clear and
the splats; numbers are the average over 40 frames drawn back to back.

| Scan | Splats | Splat pass (720p) | Splat pass (1080p) | Sort (worker) |
|---|---|---|---|---|
| Generated rings | 100 000 | ≈ 2 ms | ≈ 2 ms | < 1 ms |
| Generated rings | 1 000 000 | 2–5 ms | 2–4 ms | ≈ 7 ms |
| `train.splat` (real, outdoor) | 1 026 508 | 2.4–3 ms | 2–3.5 ms | 5–7 ms |
| `train.splat` as a `.ply` with SH degree 3 | 1 026 508 | 2.8 ms (SH 0) / 3.9 ms (SH 3) | 1.8 ms (SH 0) / 3.4 ms (SH 3) | 5–7 ms |

The whole frame (the 3D: Shapes + Ground scene ray-marched, the splats and the composite) at 1280 × 720, rendered offline
with read-back: 6.3 ms with 100 k splats, 7.8 ms with 1 M. The sort runs in the worker and never holds a frame. A slower
laptop GPU will fill more slowly: lower Resolution to Half or Max splats first.

## Example

**3D: Splat scan in a scene** (3D Basics): a generated scan (two interlocking rings of 60 000 coloured Gaussians, no
file) in the Shapes + Ground scene, turning slowly so the rings pass through the sphere and the box. Drop a real scan
on its card to replace the rings.

The generated scan is the node's `demo: 'rings'` and `demoCount` params (`lib/splats/demo.ts`); it is also how the
100 k and 1 M timings above were made.

## Web pages

Not yet. An exported page reads the scan as empty and the rest of the scene draws as usual; the export dialog says
so (`play/exportScope.ts`, "Splat Scene scans"). Shipping the file and the raster pass in the page is a follow-up.

## Not yet

- `.ksplat`, `.spz` version 4 (needs a ZSTD decoder), SuperSplat's compressed `.ply`.
- Scans in the Files page's lists.
- A Splat Scene inside a group (it draws only at the top level; the card says so).
- The camera's Flatten / Reverse perspective: the splats are drawn with a pinhole camera.
- Exact per-splat occlusion (see the limit above).
- Phase 3, per-splat modifiers; phase 4, agents as splats (the plan).
