# Depth, splats, and agents as splats: plan

Agreed with the user (2026-10-09):

- A **Depth node**: an image or video in, a depth texture out, computed on this device. It offers
  **three models in the same node** for testing; once one proves best, the others go.
- **Splat files from other apps**: load a Gaussian splat file (Polycam, Luma, Scaniverse,
  Postshot…) and render it through Playfield's camera, together with ray-marched scenes.
- **Agents as splats**: walkers drawn as Gaussian splats, and a splat scene turned into walkers
  that forces and fields can move.
- **Not** splatting your own footage (capturing 3D from a video). It needs camera tracking and long
  GPU training; capture in another app and import the file.

## 1. Depth node

**The models** (all from the Hugging Face ONNX exports Transformers.js reads; sizes checked
2026-10-09 through the HF API):

| Model | Repo | Download (q4f16 / fp16) | What it's like |
|---|---|---|---|
| Depth Anything V2 Small | `onnx-community/depth-anything-v2-small` | 19 MB / 50 MB | Fast, sharp edges, relative depth. The likely default |
| Depth Anything V2 Base | `onnx-community/depth-anything-v2-base` | 73 MB / 195 MB | Cleaner surfaces and fine detail, about 3× slower |
| MiDaS DPT-Hybrid | `Xenova/dpt-hybrid-midas` | 118 MB / 267 MB | The classic model; smoother, softer edges |

These are not in the table: Depth Pro (Apple, metric, 600 MB–3.8 GB, too big to try casually),
and GLPN (indoor only).

**Rules**

- Each model is an opt-in download, offered when the node first needs it. It works offline after
  that and nothing is sent anywhere. It uses the same pattern as the image model (`src/imageModel/`: config,
  worker, client; pinned revisions; the desktop bundle can carry the files).
- Licences: check each model's licence before shipping.
  - Depth Anything V2 Small is Apache-2.0.
  - Base has been CC-BY-NC.
  - MiDaS is MIT.
  - A non-commercial model is fine for testing but can't ship in a paid release. The node must say so.

**The node**

- **Inputs:** a texture (Image, Video, Pass, the picture) and the model (a dropdown of the three).
- **Settings:**
  - Resolution (the model's input side; a smaller side is faster).
  - Update: live, every Nth frame, or baked.
  - Near is: bright or dark.
  - Smoothing over time, for video flicker.
- **Outputs:**
  - **Depth**, a 0–1 field (sampled at UV like any texture).
  - **Depth texture**, for Pass-style use.
  - **Near mask**, with a cut-off and softness: cut out the subject or replace the background.
  - **Normals from depth**: relight a flat picture with the lighting nodes.
  - **Parallax UV**: a small camera shift for 2.5D.
- **Video:** it runs in a worker, one frame at a time at the model's speed. It reuses the last
  depth until the next arrives, so the picture never waits. **Bake depth** runs a clip once and stores
  a depth video beside it, the same as Bake does for nodes, so playback, recordings and export are smooth
  and deterministic.
- **Compare:** while testing, one button shows the three models side by side on the same frame,
  with their time per frame.
- **Web export:** a baked depth works on pages. Live depth on pages comes later; the node says so.

## 1b. Depth in 3D scenes (the user's focus: before splats)

With depth and the camera's field of view, every pixel becomes a point in 3D, and its slopes give a
surface direction. The picture becomes a surface the scene can light and hide things behind.

- **Depth composite.** The picture's colour and depth against a 3D scene's colour and depth: the
  nearer one wins, per pixel. Objects go behind or in front of people.
  - **Calibrate:** the model's 0–1 depth is relative, so map it with *Nearest* and *Farthest* sliders
    in scene units, or "the subject is at distance X".
  - **Edges:** softness, plus a tighten option for halos around hair.
  - **Agents:** Draw agents' Depth socket takes it, so walkers pass behind people too.
- **The picture as a lit surface.** Lights and glowing objects light the picture:
  - each pixel's 3D point and normal take light from the scene's lights (the light rigs) and from
    glowing SDF objects (an emissive shape counts as a light at its surface, with its colour and
    falloff), added to the picture's own colour;
  - **relight:** dim the picture's own light and add new lights;
  - **shadows:** a ray from the pixel to each light, checked against the SDF scene, so 3D objects
    shade the picture; the picture's own depth bumps shade it too, roughly.
- **The picture as the environment.** Objects reflect the picture and pick up its ambient colour, so
  a chrome sphere shows the room.
- **Camera match.** A still photo or tripod footage, with a fixed March Camera at a similar field of
  view (a "match the picture's camera" helper sets it). Moving cameras wait for tracking (later).
- **Limits:** the picture's own lighting is baked in (relighting adds and tints, but can't remove a
  harsh shadow), and the surface is the visible front only.

## 1c. Pieces: a picture rebuilt from things that can move

The user (2026-10-09), after After Effects' CC Ball Action: take an image (or video, or depth) and
rebuild it out of pieces (circles, squares, spheres, particles). Each piece takes the picture's colour
at its **home**, the place it started. The picture isn't a copy laid on top: it is *made of* the pieces,
so whatever happens to the pieces (drift, scatter, swirl, fall, orbit) happens to the picture.

- **Pieces (2D, in the shader).** A node: Picture + Shape (circle, square, hexagon, a glyph) + Count.
  Each cell draws its shape at **home + offset**, coloured from the picture at **home**.
  - **Offset** is any vec2 field you wire: noise, time, a Follow-a-field field, the mouse.
  - Size can follow brightness (halftone-like) or depth.
  - The cell search checks neighbours, as Repeat Scene does, so pieces can travel past their cells
    and overlap.
  - Outputs: Colour, Mask, Piece ID, Home.
  - It's the simple workflow the Halftone Grid only half covers.
- **Balls (3D, CC Ball Action).** The same in a March Loop. Each piece is a sphere (or box) lifted by
  brightness or by the **Depth node**, coloured from home, displaced by a vec3 field. It uses Repeat
  Scene's per-cell centre and neighbour checks.
- **Pieces as walkers (agents).** Emit "picture as pieces":
  - one walker per grid point, its home kept in a named memory (a place, phase 4) and its colour
    taken from the picture at birth;
  - forces and fields scatter them, and a **Return home** card (spring to the home memory, with
    strength and delay) pulls the picture back together;
  - drawn as dots, discs or splats (section 3);
  - an Agent Builder kind or preset: "A picture in pieces".
- **Video:** pieces resample their home colour every frame, so the picture plays while it scatters.

## 2. Splat Scene node

- **Load** `.ply` (the 3DGS standard), `.splat`, `.spz` and `.ksplat` files from the workspace or a
  drop.
- **Render** as a raster pass:
  - sort the splats by depth (in a worker, or on the GPU), then draw them as instanced soft
    ellipses (each 3D Gaussian projected to the screen);
  - this is the same family of drawing as Draw agents, not a per-pixel shader;
  - the March Camera (Ray Origin / Ray Dir, as Draw agents' "Camera from / ray") is the camera;
  - **outputs** are Color, Alpha and **Depth**, so it composites with ray-marched SDF scenes by depth,
    putting splats inside SDF worlds and SDF shapes inside a scan.
- **Base:** choose between an open three.js splat renderer (Spark, GaussianSplats3D) and a small
  renderer of our own. Weigh licence, size, `.spz` support, and whether its per-splat shader hooks
  fit our node-made modifiers.
- **Per-splat modifiers:** a small group like the Agents rule, run per splat. It takes position,
  colour, opacity and scale in, and gives them out, with nodes such as Noise or Time wired in. Wobble,
  tint by height, explode by noise, dissolve by depth, and drive from Play.
- **Cost:** report frame times for a 1M-splat scan.
- **Web export:** the file and the renderer go into the page.

## 3. Agents as splats

- **Walkers drawn as splats:** a "Splats" look in Draw agents (and the Agent Builder's Look). Each walker
  becomes a soft, oriented Gaussian, stretched along its velocity and sized by a memory or its speed,
  so clouds, smoke and liquids read as volumes.
- **A splat scene as walkers:** Emit from a splat file, so each splat is born as a walker with its
  position and colour. Forces, fields and the Agent Builder then move it: blow a scan apart, swirl it,
  and let it flow back to its start positions (a "return home" force). It is drawn as splats.

## Phases

| Phase | What | Done when |
|---|---|---|
| 1 | Depth node with the three models (download, worker, live and baked video, outputs, compare) | The same video's depth from all three, side by side with timings; a near mask cuts out a subject |
| 1b | Depth in 3D scenes: depth composite (calibrate, edges, agents), the picture lit by lights and glowing objects with shadows, relighting, the picture as the environment | A glowing sphere behind a person in a photo, hidden by them and lighting their shoulder |
| 1c | Pieces: 2D Pieces node (offset field, neighbour cells), 3D balls by brightness/depth, pieces as walkers with Return home | A photo scattered by a field and flowing back home; a CC-Ball-Action-style 3D version |
| 2 | Splat Scene node: load and render, with the camera and depth compositing | A scan from Polycam / Luma renders inside a March Loop scene and is occluded correctly |
| 3 | Per-splat modifiers | A scan dissolving by noise, driven from Play |
| 4 | Agents as splats: the Splats look, then Emit from a splat file and return home | A scan blown apart by a field, flowing back |

Each phase is one PR with tests, checked in the browser.

**Later: camera tracking** (the user, 2026-10-09: after depth works). First import tracks from other tools (Blender `.chan` / JSON, After Effects, CamTrackAR, Record3D with LiDAR depth) to drive the March Camera per frame, plus an in-app solver for tripod pans. A handheld in-app tracker (features plus depth) and a COLMAP sidecar on the desktop app come later still.

### Phase 1 status (Depth node)

Built:
- the Depth node with three models, each pinned and licence-checked; Base is non-commercial and marked "testing only";
- live, every-Nth-frame and baked updates, with smoothing;
- five outputs: Depth, Depth texture, Near mask, Normals, Parallax UV;
- Compare models;
- Bake depth;
- baked depth in web pages (docs/depth-node.md).

The agent stopped at the usage limit while building. I finished it: the full suite passes (9102), and in the browser the card renders and the graph compiles with no errors.

Not yet done: running the real models in the browser, which needs the one-time download from Hugging Face. Timings and quality per model are still to measure.

Next: phase 1b (depth in 3D scenes).

### Phase 1b status (first part)

Built:
- **Depth Composite:** the nearer wins, with calibration in 1/distance, edge softness, the Scene in front mask, and a Show mode for calibrating;
- **Depth Light:** a point light or glowing object lights the picture; the picture's 3D point comes from the camera rays, its normal from screen-space slopes, with reach, wrap and own-light controls.

Checked offscreen with a synthetic near disc against a scene disc at distance 3: the near disc covers the scene, and a light between the camera and the disc lights it while a light behind it doesn't.

Next:
- shadows from SDF objects onto the picture (needs the scene's distance function at the picture's points);
- glowing SDF objects found automatically as lights;
- the picture as the environment;
- an example graph built from a photo.
