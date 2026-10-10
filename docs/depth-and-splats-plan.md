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
| 2 | Splat Scene node: load and render, with the camera and depth compositing | A scan from Polycam / Luma renders inside a March Loop scene and is occluded correctly |
| 3 | Per-splat modifiers | A scan dissolving by noise, driven from Play |
| 4 | Agents as splats: the Splats look, then Emit from a splat file and return home | A scan blown apart by a field, flowing back |

Each phase is one PR with tests, checked in the browser.
