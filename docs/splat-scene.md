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
| Modifier | A chain of splat nodes run once per splat before drawing ("Per-splat modifiers" below) |

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
   asks for a new order when the view has turned more than 0.25°, or at any turn at all (Sort: every frame); a view that
   hasn't turned is never sorted again. The probe is read back only when a uniform it reads has changed since the last
   read (`lib/splats/uniformPrint.ts`; a program that reads a texture has no print and is read every frame), so a still
   camera with the clock paused costs no readback. The new order lands on a later frame; the camera itself is never
   late (the GPU reads it from the probe).
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

## Per-splat modifiers

Splats are changed **with nodes in the graph**, before they are drawn (the plan's phase 3). A chain of splat nodes
wired into the Splat Scene's **Modifier** input runs once for every splat, the way an Agents rule runs once per walker.

### The wire and the nodes

The `splat` wire carries one splat's state (in GLSL a `mat3`: its centre in the scene; its colour; its opacity, size
multiplier and dot radius). A chain starts from the splat as loaded (any Splat input left unwired) and ends in the
Modifier. The nodes are in the node browser under **Splats** (3D tools):

| Node | What it does |
|---|---|
| **Splat Attributes** | The splat as numbers: Position (in the scene), In the scan (its place in the scan, scene units, +Y up: noise read here sticks to the scan), Color, Opacity, Size, Radius, Index, Random (0–1, its own, never changes), Count |
| **Set Splat** | Writes back what is wired: Position, Offset (a move), Color, Opacity, Size, Dot size; Amount blends from the splat as it came |
| **Splat Dissolve** | A threshold (Amount 0 → 1) sweeps through 3D noise in the scan (or a Field you wire): splats below it fade and/or shrink and drift, with a glowing edge (Edge width, colour, Glow) |
| **Splat Explode** | Blows the splats out from a Center (Amount), each a little later than the last (Stagger), straight out or scattered, spinning; Return home brings them back |
| **Splat Wave** | A sine travelling along X / Y / Z / out from the middle, pushing any way; or a noisy Wobble; or a Twist |
| **Splat Colour** | Hue, saturation, brightness, contrast, and a tint that keeps each splat's brightness |
| **Splat Crop** | Keeps what is below a plane or inside a box or sphere (or the other side), measured in the scan or the scene, softly, with a glowing cut; sweep Offset to reveal |
| **Splat Size & Opacity** | Size ×, Opacity ×, an Opacity floor (denser), Keep a share of the splats (sparser) |
| **Splat Points** | Every splat as a crisp round dot, Dot size pixels (On is a switch Play can drive) |

**Relative to the scan** (Dissolve, Explode, Wave, Crop; on for new nodes, off for nodes saved before, schema
version 2): sizes and distances in the scan's own size (its core radius × Scale) from its middle, so a look reads the
same on a small object and a whole place ([splat-builder.md](splat-builder.md), "Effects in the scan's own size").

Between Splat Attributes and Set Splat any ordinary node works: Noise, Transform, maths, Expression Blocks, Time, LFOs.
Nodes that read the pixel (UV, a texture at the pixel) read a fixed point there: a splat isn't a pixel.

**On the card:** Splat Scene → **Add a modifier** adds a recipe (or *Your own nodes*: Splat Attributes → Set Splat) at
the end of the chain, wired in, one undo step; the card lists the chain ("Modifiers: …"). Modifiers apply in chain
order: an Opacity floor after a Dissolve brings dissolved splats back; before it, it doesn't.

**Play:** every slider is an ordinary param, a live uniform of the picture's table, so dragging never recompiles and
Play controls, mappings and keyframes drive them like any other (a top-level node: `nodeId::param`).

**Wiring a slider:** every number, vector and colour slider of the recipes (and Set Splat's Amount) is also an input
socket of the same name ([wireable-sliders.md](wireable-sliders.md)). Wired, the wire takes the slider's place and the
card shows its chip instead; unwired, the slider is the value, and the code is what it was. The headline sockets show
on the card; the rest come out from their slider (right-click → Control from outside), and stay out while wired:

| Node | On the card | On demand |
|---|---|---|
| Splat Dissolve | Amount | Noise scale, Evolve, Softness, Edge width, Edge colour, Glow, Drift |
| Splat Explode | Amount, Return home (and Center, as before) | Distance, Scatter, Stagger, Spin |
| Splat Wave | Amplitude, Frequency, Speed | |
| Splat Colour | Hue, Tint amount | Saturation, Brightness, Contrast, Tint |
| Splat Crop | Offset (and Center, as before) | Size, Plane faces, Softness, Edge width, Edge colour, Glow |
| Splat Size & Opacity | Size, Opacity, Keep | Opacity floor |
| Splat Points | On, Dot size | Solid |
| Set Splat | | Amount |

What is wired runs in the modifier program, once per splat: an LFO into Wave's Amplitude, Time into its Speed, a Noise
into Dissolve's Amount (read at a fixed point: one Amount for every splat, moving with time), or Splat Attributes →
maths into a slider (a different value for every splat). Its own sliders join the picture's table, so Play still
reaches them. A wire into an older graph's `__param_<key>` socket (the Splat builder's LFOs) keeps working.

### How it runs

The compiler (`compiler/splatGraph.ts`) makes a **modifier program** per Splat Scene from the chain wired into its
Modifier, ending in an internal SplatModOut: a program of the picture's kind (as the probe is, and as an Agents group's
update shader is), whose prelude makes each fragment one splat: its index from the texel, its data from the splat
texture, the scan's placement from the probe, and the per-splat globals (`sp_base`, `sp_local`, `sp_index`,
`sp_rand`, `sp_count`, `sp_radius`, `sp_T`) the splat nodes read (they carry `__splatProgram` there; anywhere else,
such as a node's eye preview, they read a pretend splat at the pixel). The picture compiles **without** the chain
(`pictureGraphOf`: a node that also feeds the picture stays in it), and the chain's uniforms are merged into the
picture's table (fresh slugs, so two scans' chains never share one).

Per frame (`lib/splats/render.ts`): the probe, then the modifier program over 2048 × ⌈n / 2048⌉ texels into two
targets (RGBA32F: centre and size, a negative size being a dot's radius; RGBA16F: colour and opacity), then the splats
with the shader's modifier variant (`SPLAT_VERT_MOD`), which reads them and skips a splat with no opacity or size left
before projecting it. View-dependent colour (SH) is added on top of the modified colour. Without float render targets
the scan draws unmodified and the card says so.

### Sorting moved splats

The compile knows which nodes move splats and by which params (Explode's Amount, Wave's Amplitude, Dissolve's Drift,
Set Splat with Position or Offset wired); one of those wired (into its socket or a `__param_` socket) or keyframed counts
as moving whatever its slider says. While any is non-zero, the engine sorts by the **moved** positions instead
of the scan's own: a small pass works out every moved splat's depth along the camera's forward ray (four a texel), it
is read back without stalling (a pixel-pack buffer and a fence: 4 MB at 1 M splats), and the worker sorts those depths
(`orderByDepth`, the same counting sort). One read or sort at a time, so it runs as fast as the worker sorts (a frame
or a few behind a fast move, never holding a frame), and stops when the depths stop changing (a fingerprint of them).
The 4 MB read itself is skipped while the camera (the probe's last reading) and the uniforms the modifier reads are as
they were at the last read: a still scene with the clock paused reads nothing back and lets the preview's loop stop
(before, a moving modifier kept a read in flight and the preview drawing forever).
A splat a modifier breaks (NaN) takes no part. Offline renders read and sort for every frame, waited for. Moves along
the view's sideways axes don't change the order, so they don't sort again.

### Cost (1 M splats, Apple Silicon, browser pane, 2026-10-10)

| | Splat pass at 1280 × 720 |
|---|---|
| Generated ball, 1 M, no modifier | 1.9 ms |
| Same, with Set Splat (colour by an Expression Block) → Explode → Wobble | 2.7 ms (the modifier program alone ≈ 1.2 ms with the probe and a sync) |
| `train.splat` (1 026 508), no modifier | 3.4 ms |
| Same, Dissolve at Amount 0 / 0.5 | 4.4 ms / 4.0 ms (dissolved splats are skipped) |
| Moved-splat sort: depth read (main thread) / worker sort | 0.7 ms / 7–10 ms, every few frames while moving |

### Examples

- **3D: Splat modifiers** (3D Basics): a generated ball (`demo: 'blob'`), Splat Attributes → an Expression Block
  (colour by height) → Set Splat → Splat Explode (Amount on an LFO, through its param socket) → a wobble.
- **Splats: a scan dissolving** (Play folder, *Splats in Play*): a generated ball turning, its Modifier a Splat
  Dissolve; Play sweeps Dissolve (Amount) with an LFO and the mouse sets the edge glow. Drop a real scan on its card.

### For a Splat builder

Built: [splat-builder.md](splat-builder.md) (the Scene builder's Splat scene). What it rests on:


- Lay modifiers down with `addSplatModifier(nodes, splatId, pick, nextId)` (`nodes/recipes/splatModifierRecipes.ts`),
  which appends to the chain; `splatModifierChain` reads it back (scan first). A builder's stack is that chain.
- Each recipe is one node with plain params (all live uniforms): a builder sets params, never GLSL. Custom looks are
  Splat Attributes → ordinary nodes → Set Splat. To animate a slider, wire into its socket (the param's own key).
- A new moving node needs a line in `splatMoveGate` (`nodes/definitions/splatModifiers.ts`), or the sort won't follow
  it; its gate params count as moving while wired or keyframed. A new slider gets its socket from the node's
  `withParamSockets` list.
- `SplatModOut` packs state into the targets (size sign = dot); a new per-splat channel needs a third target.

## Agents as splats

The plan's phase 4 (docs/depth-and-splats-plan.md, section 3): walkers drawn as splats, and a scan turned into walkers
that forces and fields move.

### The Splats look (Draw agents)

Draw agents' Style **Splats**: every walker a soft oriented Gaussian, stretched along its velocity, so clouds, smoke and
liquids read as volumes (and a scan reads as a scan).

- **Splat size** (its sigma, picture units; in 3D it shrinks with distance), **Size by** Fixed, Speed (bigger the
  faster), or a More memory number × **Memory scale** (an Emit from a splat scan keeps each splat's own size in w);
  **Stretch** (how much longer along its motion at full speed: Fast is); **Opacity** (how much one covers at its middle).
- Colour by any of the usual options (Colour by Agent for a scan's own colours); Brightness multiplies it.
- **Maths:** the Splat Scene's. In 3D the covariance Σ = s⊥² I + (s∥² − s⊥²) v̂v̂ᵀ goes through the camera's EWA Jacobian
  (built-in camera or a scene's, with Flatten); in 2D through the picture's scale; then the same quad √(2λ) along the
  ellipse's axes and exp(−|v|²) weight (kit/agentShaders.js AG_SPLAT_VERT; CPU mirror lib/agentSplats.ts, tested).
- **No sort:** walkers move every step, so they are put together without an order (weighted blended OIT, McGuire &
  Bavoil 2013): two half-float targets, colour added and cover multiplied, near splats weighted up in 3D
  ((camera distance / depth)⁴). The resolve is the weighted mean colour × the cover 1 − Π(1 − α). Any order gives the same
  pixel (tested), so it is deterministic.
- **Compositing:** with Camera from / Camera ray / Depth wired, splats behind the ray-marched scene are hidden, as dots
  are. The new **Distance** output (Σαwd / Σαw, far where none) is the Splat Scene's kind: wire Color, Distance and
  Density (as Hit) into a Splat Scene's Scene inputs and a scan and the walkers meet by distance.
- Web pages draw Splats as Points (the export dialog says so).

### Emit from a splat scan

Emit's Shape **Splat scan**: each splat is born as a walker, walker i from splat i, at its place (the scan's core box
fitted to Size round X, Y, Z; 2D seen from the front), in its colour, its **home** (x, y, z) and its **size** (w) kept in
More memory. The card picks the scan (Load…, From the library, a generated ball; kept by `videoId` like the Splat
Scene's, so .playfiles carry it). **Up is** turns most scans over; **Skip below** leaves out faint floaters.

- The engine reads the scan through the splat worker, thinned evenly to the group's count, into an RGBA32F texture
  (lib/agentScans.ts, lib/splats/walkers.ts: two texels a splat) the Emit reads at birth. Until it arrives no walker is
  born from it; when it lands the group starts over.
- Any other Shape can **Remember home** too (the Pieces' picture in pieces uses it): the birth place goes into More
  memory x, y, z.
- The group keeps per-walker state (colour) by itself; the home needs More memory (a rules group with a Home memory).

### Return home (shared)

A rule action and an Agent Builder Forces card: a spring toward the **Home** memory (a memory kind of its own, always
More memory x, y, z) with **Strength**, **Damping** (2√strength settles without overshoot) and **After** (seconds from
birth before it pulls, eased in over half a second). In text: `home home 6 delay=1 damping=3`. The maths is
agentRules/home.ts; the generated GLSL is checked against it on the CPU. Any kind with a Home can use it: a scan blown
apart, a picture in pieces (docs/pieces.md).

### Scan to walkers (Agent Builder)

A start card, **Scan to walkers** (Particles' sections), 2D and 3D: a generated ball of 250 000 splats (256k walkers),
blown out from the middle by a field (your own vx = x, vy = y, vz = z plus curl noise, for its first 1.2 s), then
Return home (spring 9, damping 4.5, after 1.5 s) and drag bring it back. Look: Splats, sized by its own splat size,
coloured by its own colour (Look → Colour → Its own). Examples: **Agent rules 12 · Scan to walkers** and **13 · … in 3D**.

### Cost (Apple Silicon, browser pane, 2026-10-11)

262 144 walkers (250 000 live) at 532 × 706: the step 0.7 ms, the splat draw about 10 ms while blown apart (big, near
splats fill more), noisy (other work on the machine). A smaller Opacity or Splat size, or a lower count, is cheaper.

## Web pages

Not yet. An exported page reads the scan as empty and the rest of the scene draws as usual; the export dialog says
so (`play/exportScope.ts`, "Splat Scene scans"). Shipping the file and the raster pass in the page is a follow-up.

## Not yet

- `.ksplat`, `.spz` version 4 (needs a ZSTD decoder), SuperSplat's compressed `.ply`.
- Scans in the Files page's lists.
- A Splat Scene inside a group (it draws only at the top level; the card says so).
- The camera's Flatten / Reverse perspective: the splats are drawn with a pinhole camera.
- Exact per-splat occlusion (see the limit above).
- Modifier chains inside a plain group (the `splat` wire through group ports isn't supported; keep chains at the top
  level), per-splat textures in a modifier (a Sample reads at a fixed point), and the scan's centre as an attribute.
- Modifiers on exported web pages (with the scan itself).
