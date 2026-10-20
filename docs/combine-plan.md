# Combine: plan

Put two things the builders made together without wiring the graph: a photo in a 3D scene, particles
sliding round a shape, people replaced by a 3D scene. Each join is a **verb**. A verb builds the same
graph you would wire by hand, from the nodes that already exist. Every node has a note, and nothing is
a monolithic node. Planning only: nothing here is built yet.

User decisions (2026-10-20) are marked **[D1]–[D9]**.

## 1. Products and verbs

**Products** (what a layer brings):

| Product | Made by | What it is in the graph |
|---|---|---|
| **Picture** | 2D builder, Grid, Warp, Time Cube, Texture builder (§6), Texture / Video Input, Shader Texture | a colour (vec3) and, when one exists, a texture |
| **Picture + depth** | a Picture plus `depth` (Depth Anything V2 Small, baked or live) | colour, `depth.depth`, `depth.texture`, `depth.normal`, and Depth Light's `point` / `normal` |
| **3D scene** | 3D Scene Builder (`sceneGroup` + March Camera + March Loop), Splat builder | Scene Group `scene`, the loop's `color` / `dist` / `hit`, March Camera `ro` / `rd` |
| **Points** | Agent Builder (rules Agents group + `drawAgents`), Splat Scene, Turn into points | an Agents group: `agents` → Draw Agents (`color`, `texture`, `distance`) |
| **Mask / regions** | `segment`, `blobTrack`, 2D shapes (any SDF), `textureMask`, Depth's `nearMask` | a float mask or SDF; for blobs, the Blob data texture (16 × 3) |
| **Motion** | `opticalFlow` (2 passes), `textureChange` | flow (vec2) and its texture, speed, change mask |

Hand, face and pose tracking are Play sources, not graph nodes, so they aren't Motion products here.
They stay a Play feature.

**Verbs** (layer A, the new one, joined to layer B, the one it's on):

| Verb | Reads as | Result product |
|---|---|---|
| **Place in** | "Put A in B" | B's kind |
| **Relight with** | "Light B (a photo) with A (a scene or a rig)" | Picture |
| **Collide with** | "A's points bounce, slide or settle on B" | Points |
| **Follow the shape** | "A's points trace B's outline, cling to it, or flow along it" | Points |
| **Spawn from** | "A's points are born from B" | Points |
| **Turn into points** | "B becomes a point cloud or splats" (no second product) | Points |
| **Replace mask with** | "Fill B's people or blobs with A" | Picture |

### 1.1 Matrix: which pairs are valid

Rows are the new layer (A), columns are what it goes on (B). A dash means the pair isn't offered;
the verb picker shows only valid verbs ([§3.3](#33-verb-picker)).

| A ↓ / on B → | Picture | Picture + depth | 3D scene | Points | Mask / regions | Motion |
|---|---|---|---|---|---|---|
| **Picture** | Place in (blend) | Place in (blend) | Place in (card, material, surroundings) | – | Replace mask with | – |
| **Picture + depth** | – | – | Place in (backdrop with depth) | – | Replace mask with | – |
| **3D scene** | Place in (over) | Place in (by depth), Relight with | Place in (union of scenes)* | – | Replace mask with | – |
| **Points** | Place in, Spawn from, Follow (brightness) | Place in (occluded by depth), Spawn from (z from depth) | Place in (voxels / shapes), Collide with, Follow the shape, Spawn from (surface) | – | Collide with, Follow the shape, Spawn from | Follow (pushed by the flow), Spawn from (where it moves) |
| **Mask / regions** | Replace mask with† | Replace mask with† | – | – | – | – |
| **Light rig** (3D builder look) | – | Relight with | – | – | – | – |
| *(none)* | Turn into points | Turn into points | Turn into points (its picture) | – | – | – |

\* Two 3D builds merged into one Scene Group is a 3D builder job. Combine offers **Open both in the 3D
builder** here instead of making its own graph.
† A mask layer on a picture *starts* Replace: the next layer is the fill.

## 2. What each verb builds

Pass cost uses `nodePassNote` (checked 2026-10-20). Depth, Segment, Blob Track, Cache, Depth Mix,
Depth Composite, Depth Light, Picture Card, Agents and Splat Scene add **0** passes: they run on their
own engines or inline. Optical Flow adds 2. A Pass, Shader Texture, Feedback (texture) or Data
Texture adds 1 each.

**Photo depth [D3]:** the local model already exists. It is Depth Anything V2 Small (Apache-2.0,
~50 MB, 27 MB on WebAssembly), in `src/depthModel/` (Transformers.js worker, pinned revision). Its
download is opt-in: the Depth card's Download button, and `depthModelOffer` / `downloadGenerateModel`
in `builders/depthPicture.ts`, which the 2D and 3D builders' **Generate depth** row
(`DepthGenerateRow.tsx`) uses. Combine reuses that row and adds no new model. A layer needing depth
shows the same offer, and nothing downloads until the user presses it. Segment's MediaPipe models ship
with the app (`public/mediapipe/`), so they need no download. MobileCLIP (`src/imageModel/`) isn't
needed here.

### 2.1 Place in

| Pair | Graph it builds (node types) | Missing | Passes | Perf risk |
|---|---|---|---|---|
| Picture → 3D (card) | `textureInput` → Group port → `pictureCard` in the Scene Group (distance, unioned with the scene), plus a second `pictureCard` after the loop on Hit Pos (colour into the lights, glow added). Settings shared through one `makeVec3` / Constant (the pictures-in-3d.md "use it twice" pattern) | – | 0 | low; large cut-out areas seen edge-on use up Max Steps |
| Picture → 3D (on a shape) | `textureMaterial` after the loop on the picked shape's Hit Pos, through the same Transform | – | 0 | low |
| Picture → 3D (surroundings) | `pictureEnvironment` into the loop background and reflections | – | 0 | low |
| Picture + depth → 3D (backdrop) | the depthRecipes "Add a picture with depth" chain: `textureInput` → `depth` (baked) → `depthComposite` with the loop's color / dist / hit; camera faced at the picture | – | 0 | medium: Depth live on video |
| 3D → Picture | loop `color` over the picture by `hit` (`select` or Alpha Blend) | – | 0 | the scene's own cost |
| 3D → Picture + depth | `depthComposite` (objects hidden behind nearer parts of the photo); optional `depthMix` Fog / Occlude for the look | – | 0 | as above |
| Points → 3D | an Agents group in 3D; Draw Agents `camOrigin` / `camRay` ← March Camera, `depth` ← March Loop dist; Shape Voxel / Cube / Sphere; Background ← the loop's colour | – | 0 (+1 for a Sprite from a picture that isn't a Pass) | shapes cost per walker: the existing Shape cost note shows it |
| Points → Picture (+ depth) | Draw Agents Background ← picture; with depth, Draw Agents `depth` ← Depth Composite's `pictureDist` (and the March Camera that matches it) | – | 0 | low |
| Splats → 3D | `splatScene` with `ro` / `rd` / `scene` / `dist` / `hit` (its compositing as now) | – | 0 | sort cost at 1 M+ splats |
| Picture → Picture | Alpha Blend / Blend Modes / Mix, with an optional mask | – | 0 | none |

**Small extension, later:** a Picture Card's **Relief** (displace the card by a depth texture) for
"Picture + depth as a 2.5D card in 3D". It's a new setting on `pictureCard`, not a new node. It's not
needed for phase 1.

### 2.2 Relight with

| Pair | Graph | Missing | Passes | Perf |
|---|---|---|---|---|
| 3D scene → Picture + depth | `depth` → `depthLight` (picture, nearness, ro / rd from a `marchCamera` facing the picture, Glowing scene ← Scene Group port, Shadows from ← scene), linked to the first glowing object; Where ← 1 − Depth Composite's `front` when the objects are placed too | – | 0 | **high with Shadows from**: a shadow march per pixel. Offer Shadows off by default on video |
| Light rig → Picture + depth | one `depthLight` per rig light (key, fill, rim), chained Color → picture, with positions and colours from the look (Daylight, Studio, Golden hour, Moonlight, Neon rim from `lightRecipes.ts`); **Own light** from the look (Moonlight low) | a pure table mapping each look to Depth Light settings (`combine/rigLooks.ts`), not a node | 0 | low: no scene to march |
| Alternative (flat, no camera) | `depth.normal` → `heightLight` (sun from / height) for a hillshade relight | – | 0 | none |

### 2.3 Collide with (bounce, slide, settle)

| Pair | Graph (inside the Agents group, after Integrate) | Missing | Passes | Perf |
|---|---|---|---|---|
| Points + 2D shape | the shape's SDF chain (copied into the group as a field, or brought in through a group port) → `agentCollide` Shape ƒ; Bounce / Friction from the mode; **Settle** = Collide (bounce 0, high friction) + `agentGravity` | – | 0 | the SDF is read once per walker per step: cheap |
| Points + mask (Segment, Mask (texture)) | mask texture → `jumpFloodTexture` (distance) → `agentCollide` Shape ƒ, reading the distance through a Sample (texture) field | – | 0 (JFA's are hidden passes, on their own budget) | the JFA per frame on video: medium |
| Points + 3D scene | Scene Group port → `agentCollideScene` (48³ grid) | – | 0 | the grid is refilled every step: medium for heavy scenes |
| Points + Picture + depth | collide with the photo's depth surface | **later**: "Collide (depth)", the depth as a height field in 3D | – | – |

### 2.4 Follow the shape (priority) [D5]

Modes are **Trace** (move along the outline), **Cling** (stay on the surface, drifting), **Flow
along** (pushed along the surface by a direction) and **Orbit** (circle the shape at a distance).

| Pair | Mode | Graph | Missing | Passes |
|---|---|---|---|---|
| Points + 2D shape / mask | Trace | `agentRidePath` (Path ƒ = the SDF; Level = offset; Width = band) | – | 0 |
| | Cling | `agentFlow` Slope, negative strength, Field ƒ = `simpleExpr` `abs(d - offset)` | – | 0 |
| | Flow along / Orbit | `agentFlow` Around on the SDF (+ Cling for Orbit at a distance) | – | 0 |
| Points + picture (brightness) | Flow along | `agentFlow` Around / Slope on a Sample (texture) brightness field | – | 0 |
| Points + Motion | Pushed by the flow | `opticalFlow` texture → a Sample (texture) field read at each walker → `agentFlow` (Slope on speed) or `agentWind` by the flow vector | **check**: whether a force can take a vec2 field directly. If not, add a small **Push by texture** force (`agentPushTexture`: Field ƒ vec2 → force) | 2 (Optical Flow) |
| Points + 3D scene | Trace / Cling / Flow along / Orbit | **new node `agentFollowScene`** "Follow surface (3D Scene)" that reuses `agentCollideScene`'s 48³ grid: pull to the iso surface at Offset, project the velocity onto the tangent plane, a tangent direction for Trace / Orbit (round an axis) or Flow along (a world direction or a wired vec3) | **yes** | 0 |

`agentFlow` in 3D pushes only in the picture plane, so the 3D case needs the new node.

### 2.5 Spawn from

| Pair | Graph | Missing | Passes |
|---|---|---|---|
| Points from a picture | `agentEmit` Shape **Picture (where bright)** ← picture texture; colour by the picture | – | 0 (+1 when the picture is a computed chain: it needs a Pass to be a texture) |
| from a mask | `agentEmit` Shape **Field** (Where ƒ = the mask) | – | 0 |
| from Motion | `agentEmit` Field ← `textureChange` Motion or Optical Flow Speed above a threshold, Rate mode | – | 0 / 2 |
| from Picture + depth (in 3D) | Emit Picture in a 3D group, z from the Depth texture | **check**: whether Emit Picture places in 3D by a depth. If not, add an Emit setting **Depth from** (texture) | 0 |
| from a 3D scene's surface | **new Emit shape "Scene surface"**, which births on the `agentGridOut` grid's iso cells (the P3 item in gpu-particles-plan.md) | **yes** (an Emit option) | 0 |
| Splats from a picture | Turn into points (§2.6) with Draw Agents Style Splats | – | – |

### 2.6 Turn into points (live / baked) [D6]

Any texture (and its depth, when there is one) becomes a point cloud: one walker per cell of a grid
over the picture, coloured by it, pushed out in z by its depth, drawn as Dots, Splats or Voxels.
They are real walkers, so the other verbs work on them next (explode with Collide, Follow, forces).

| Mode | Graph | Missing | Passes | Perf |
|---|---|---|---|---|
| **Live** | Agents group (3D when there is depth): `agentEmit` **new Shape "Grid over the picture"** (N × M walkers, each home UV kept in More memory) → a **new `agentPictureAt`** "Picture at home" (samples a texture at the walker's home UV: colour and depth, every step) → position = home + depth × Depth scale; Draw Agents (Splats / Dots / Voxel) | **2 small pieces**: an Emit shape and a sampler node | 0 (+1 when the source is a computed chain) | walkers × steps: 256 × 256 = 65 k is fine, 1 M is the ceiling. Live depth on video runs at the model's speed (the last depth is reused) |
| **Baked, image** | the same, but the texture is a Baked / Texture node (and the depth baked with Generate depth) and `agentPictureAt` reads once (Update: Once) | – | 0 | cheapest |
| **Baked, video** | `cache` (Frames 32–128, Frame size 256) records the clip once, Record off; `cacheRead` with Delay ← time (an LFO or Time → Modulo) feeds `agentPictureAt`, and its depth comes from a baked depth video in the same Cache | – | 0 (Cache isn't a pass) | memory: 128 × 256 px frames fit one 4096 atlas; the card already lowers Frame size when not |

Whether to bake is a choice on the layer, with what each costs ("Live: depth every frame, ~N ms ·
Baked: no model at play time").

### 2.7 Replace mask with [D4]

**Masks:** People (`segment` People), Objects (`segment` Objects + kinds), Click (`segment` Click +
Follow), Blobs in a mask (any mask → Pass → `blobTrack`), a drawn shape (an SDF).

**Fill modes:**
- **One fill for all.** Every blob shows the same fill, fitted to each blob. One fill node is evaluated once
  per pixel at the blob-local UV.
- **Per blob.** Each blob gets its own fill; blobs without one get the **Rest** fill, or the picture.
  Blobs are chosen **By order** (oldest first: #1, #2, …, the default, steady when blobs come and go)
  or **By ID** (a tracked ID; IDs grow as new blobs appear, so it's for short clips).

**Sticking:** the fill follows the blob's position and size (Blob data row 0, already smoothed by Blob
Track's Smoothing). **Fit** is Box (stretch), Square or Circle; **Padding**, **Spin by ID**, **Keep
upright**. For People / Objects masks without blobs, the fill is either the whole frame (masked) or
stuck to the mask's bounds (Blob Track on the mask, Max blobs 1).

| Fill product | How it's fitted to a blob | Passes |
|---|---|---|
| a Picture with a texture (image, video, Baked, Pass) | `readTexture` with UV ← the blob-local UV | 0 |
| a procedural Picture (2D build, Texture builder chain) | its UV input ← the blob-local UV (re-evaluated per pixel: no pass) | 0 |
| a 3D scene | March Camera's UV ← the blob-local UV (the scene renders inside the box) | 0, but **costs a full march per fill** |
| Points | Draw Agents `texture` → `readTexture` at the blob-local UV | 0 |

**Graph:** `segment` (or the mask) → [Pass when it isn't a texture] → `blobTrack` (Blob data) →
**new `blobSpace`** "Blob Space" (per pixel: Slot, ID, Local UV in the blob's box, Inside, Edge, and
Fit / Padding / Spin) → fill(s) read at Local UV → for Per blob, a chain of `select` nodes, each with
Mask = `simpleExpr` `inside * float(slot == k)` → final `select` with Mask = the segment mask (soft
edge), over the original picture.

**Missing:** `blobSpace`. Blob Track's own Stamp does "one picture on every blob" but only for
textures and only as its overlay, not as UV for any fill. This is the one new node Replace needs.
It reads the 16 × 3 Blob data in a loop of 16, like Blob Track's Inside. **Passes:** 0–1 (a Pass only
when the mask isn't a texture). **Perf:** the Blob Track readback (a few ms at 160 px); N fills × the
fill's own cost per pixel. Each fill is evaluated only where `inside` is > 0 (the `select` is
evaluated eagerly by the GPU, so the fills are wrapped in an `if`: the builder sets Branch on its
`select`, or the plan adds one if it's missing).

### 2.8 Inline expressions [D5]

Wherever a verb has a number that could vary, its slider can become a one-line expression. The
field is the builders' `ExprLineInput` (the Expression Block's line editor). It compiles to a
**Simple Expression** (`simpleExpr`) node whose inputs are the verb's names, wired into that param's
socket, so it's a node you can see and edit like any other.

| Verb | Names offered | Example |
|---|---|---|
| Place in | `t`, `uv`, `depth` | card Rotation Y = `t * 20.0` |
| Collide with | `hit`, `speed`, `d` (distance), `t` | Bounce = `0.2 + 0.6 * step(1.0, speed)` |
| Follow the shape | `along`, `d`, `speed`, `id`, `t` | Speed = `0.3 + 0.2 * sin(along * 6.28 + t)` |
| Spawn from | `b` (brightness), `mask`, `t` | Rate = `b * 400.0` |
| Turn into points | `b`, `depth`, `t` | Depth scale = `0.5 + 0.5 * sin(t)` |
| Replace mask with | `id`, `slot`, `size`, `area`, `t` | Fill scale = `1.0 + 0.1 * sin(t * 3.0 + id)` |
| Relight with | `t`, `depth` | light X = `sin(t) * 2.0` |

**Make a slider** (ExprLineInput's existing caret action) turns the number under the caret into a
Constant input on the Simple Expression, and that is what Add to Play can then target ([D8]).

## 3. UI

These follow the builders UX verdict: the viewport comes first, settings are pictures and short
labels, panels fold (primary section open, others folded with a one-line summary), and there are no
paragraphs.

### 3.1 Two ways in [D1]

1. **Combine** on the Scene builder's kind page (`SCENE_KINDS`, a ninth card): *"Put what you made
   together: a photo in 3D, particles on a shape, people replaced by anything."* It opens with the
   graph's built scenes (`builtScenes`) as ready products.
2. **Add to this…** in every builder's footer, next to Done (2D, 3D, Grid, Agents, Splat, Time Cube,
   Warp, Texture builder). It keeps the same Scene-builder session (`sceneDraft`): the current build
   becomes layer 1, the Combine window opens with **+ Add a layer** already open, and only Combine's
   Done writes to the graph. The whole visit is still one undo step.

```
 ┌ 3D Scene Builder ───────────────────────────────────────────────┐
 │                                                                 │
 │                 [ viewport ]                                     │
 │                                                                 │
 ├─────────────────────────────────────────────────────────────────┤
 │ Presets ▾                        [Add to this…]  [ Done ]       │
 └─────────────────────────────────────────────────────────────────┘
```

### 3.2 The Combine window

```
 ┌ Scene builder › Combine ───────────────────────── Passes 6/8 ─ × ┐
 │ LAYERS          │                                 │ PEOPLE → 3D ▾ │
 │ ┌─────────────┐ │                                 │ ┌──────────┐  │
 │ │▣ Fill people│ │                                 │ │ ●all ○per│  │
 │ │  with 3D    │ │                                 │ └──────────┘  │
 │ │  ⟳ 0 passes │ │         [ live viewport ]       │ Fit ▢ ◻ ○     │
 │ ├─────────────┤ │                                 │ Padding ──●── │
 │ │◉ People     │ │                                 │ Follow  ✓pos  │
 │ │  (Segment)  │ │                                 │         ✓size │
 │ ├─────────────┤ │                                 │ ƒ scale       │
 │ │▤ Video      │ │                                 │ [1.0+0.1*sin…]│
 │ │  (base)     │ │                                 │               │
 │ └─────────────┘ │                                 │ ▸ Edges (soft)│
 │ [+ Add a layer] │                                 │ ▸ Blend       │
 ├─────────────────┴─────────────────────────────────┴───────────────┤
 │ Presets ▾  Photo in a room · Sparks on outline · People→galaxy ·… │
 │                                       [Add to this…] [  Done  ]   │
 └───────────────────────────────────────────────────────────────────┘
```

- **Layer stack** (left, folds with ⌘[): bottom-up, the base at the bottom. Each card has a thumbnail
  (a downsampled preview of that layer's result), a two-word verb line, a pass badge (0 / +1 / +2, amber
  when it uses a grace pass), mute (the builders' MuteToggle: gates, no recompile) and ⋯ (Edit product
  in its builder, Retarget, Duplicate, Remove). Drag to reorder where the verbs still make sense
  (invalid drops are refused with a shake and the reason).
- **Stacks have no fixed depth [D2].** The limits are the pass budget (§5) and frame time. Each card's
  ⋯ shows its GPU time (gpuTimer) when it's been measured.
- **Settings** (right, folds with ⌘]): the selected layer's verb settings. The verb's primary section
  is open. Visual pickers (Fit icons, mode tiles with a looped mini-preview) come before sliders.
- **Viewport:** the live result. Clicking a layer card isolates it in the viewport (the eye pattern),
  showing the result up to that layer. Click again or Esc returns to the whole stack.
- **Presets strip:** at most 4 built-ins plus user presets (`stripPresets.ts`, `userPresets.ts`).
  Built-in suggestions: *Photo in a room* (Picture → 3D, card), *Sparks on the outline* (Points
  follow a shape), *People → galaxy* (Replace mask with a 3D scene), *Photo as splats* (Turn into points).

### 3.3 Verb picker

**+ Add a layer** opens two steps in one popover. First pick the product, then the verb.

```
 ┌ Add a layer ─────────────────────────────────────────────┐
 │ WHAT                                                      │
 │ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐     │
 │ │ pic  │ │ 3D   │ │points│ │ mask │ │motion│ │ new… │     │
 │ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘     │
 │  From this graph: [2D scene · 3 layers] [Agents · slime]  │
 │                                                           │
 │ HOW  (on: Video ▾)                                        │
 │ ┌───────────┐ ┌───────────┐ ┌───────────┐                 │
 │ │ ▶ preview │ │ ▶ preview │ │ ▶ preview │   ✕ greyed:     │
 │ │ Place in  │ │ Follow    │ │ Spawn from│   Collide with  │
 │ └───────────┘ └───────────┘ └───────────┘   "needs a shape"│
 └───────────────────────────────────────────────────────────┘
```

- **What:** the six product tiles, then "From this graph" (`builtScenes`, plus loose Texture / Video
  Input, Segment and Blob Track nodes), then **New…**, which opens that kind's builder inside the
  session. Its Done (or Add to this…) returns here with the build as the new layer.
- **How:** only verbs valid for (product, target) from §1.1, each with a small looped preview of the
  idea (a stock clip, not the user's scene). A verb that would push the graph past the pass grace is
  shown locked with "needs 2 passes, 1 left" (§5).
- **On:** the target layer. It defaults to the layer below and can be any layer below.

### 3.4 Replace mask: blob fills without congestion

```
 FILL     ● One for all   ○ Per blob
 ┌─────────────────────────────────────────────────┐
 │ #1 [🖼 galaxy ▾]  #2 [▣ 3D orb ▾]  #3 [ + ]  … │   ← chips appear as blobs are found
 │ Rest [▤ original ▾]                 By: order ▾ │
 └─────────────────────────────────────────────────┘
 STICK   Fit [▢ box][◻ square][○ circle]  Padding ─●─
         ✓ follow position  ✓ follow size  ☐ spin by ID
 ƒ  scale [ 1.0                         ]  (id, slot, size, t)
```

- Chips show only blobs that exist (live from Blob Track). Up to 6 are shown, then "+N" opens a grid.
- A chip's fill well opens the same product picker (§3.3, What only).
- Hovering a chip rings its blob in the viewport. Clicking a blob in the viewport selects its chip.
- Per-blob inline expressions are one field with `slot` / `id` available, not one field per blob.

### 3.5 Phone [D9]

Combine and Add to this… are off on phone (`usePhoneLayout().phone`). A graph Combine made opens on
phone as plain nodes, like any graph.

## 4. Data model

The pattern follows the other builders. The spec lives on an anchor node's params, every built node
carries a role, and ids are kept by role so wires and Play controls survive a rebuild.

```ts
// src/combine/spec.ts
interface CombineSpec {
  v: 1;
  layers: CombineLayer[];          // bottom (base) first
}
interface CombineLayer {
  id: string;                      // 'L1', 'L2'… stable
  product: ProductRef;
  verb: VerbId | 'base';           // 'placeIn' | 'relight' | 'collide' | 'follow' | 'spawn' | 'toPoints' | 'replaceMask'
  on?: string;                     // target layer id (default: the one below)
  settings: Record<string, number | string | boolean>;   // the verb's own, typed per verb
  exprs?: Record<string, string>;  // param → one-line expression (§2.8)
  fills?: { mode: 'all' | 'perBlob'; by: 'order' | 'id'; rest?: ProductRef; blobs: { key: number; fill: ProductRef }[] };
  muted?: boolean;
}
type ProductRef =
  | { kind: 'build'; scene: SceneKind; id: string }        // a builder's build (its own meta stays on it)
  | { kind: 'node'; nodeId: string; output: string }       // a loose node's output
  | { kind: 'rig'; look: string };                         // a light-rig look
```

- **Where it's kept:** `params.combine` (`COMBINE_META`) on the **top** compositing node of the stack
  (the node feeding Output). Glue nodes carry `_cbRole = '<layerId>:<role>'`, and `_cbBuild` is the
  anchor's id.
- **Products keep their own meta.** A 3D scene layer is still a 3D build (its `sceneGroup` holds
  `params.sceneBuilder`), so **Edit product** opens the 3D builder on it. Combine owns only the glue.
- **Recognize:** `combineMetaOf(node)` and `findCombineBuild(nodes, id)` (`byRole`). `builtScenes`
  gains kind `'combine'` (detail: "3 layers · Place in, Replace mask"). `selectedBuiltScene` finds
  the Combine build from any glue node, and `builtSceneIds` returns glue only (products stay unless
  Start over is chosen for them too).
- **Rebuild:** `buildCombine(spec, graph)` is pure, mapping spec to glue nodes and wires, with
  `idFor(role)`. `applyCombine` diffs by role. `checkEdits` (as in `sceneBuilder/apply.ts`): a glue node
  rewired by hand is kept and its role is marked hand-edited. Reopening then says "1 node edited by hand:
  **Keep my edits** (default) | **Rebuild it**".
- **Missing product:** if a ProductRef's node is gone, that layer shows "Product missing: pick
  another", and the rest still build.
- **Saved files / pages:** nothing new. The spec is a param, and the graph is ordinary nodes.

## 5. Pass budget: warn, grace, lock [D7]

**Today:** `MAX_PASSES = 8` (`compiler/passExpand.ts`). `passGraph.ts:209` fails the compile above 8.
The Passes chip (`components/shell/PassBudget.tsx`) is grey (ok), amber at ≥ 7 (`warn`), and red
above 8 (`over`). Nothing stops adding a node, so the failure comes after the fact.

**New constants:**

| Name | Value | Meaning |
|---|---|---|
| `MAX_PASSES` | 8 | full quality up to here (unchanged name and value; every existing note still says "of 8") |
| `GRACE_PASSES` | 2 | extra passes allowed at lower quality |
| `HARD_MAX_PASSES` | 10 | the compile limit and the lock line |

**Behaviour by `used`:**

| used | Compile | Quality | Chip | Adding a pass-type node |
|---|---|---|---|---|
| 0–6 | ok | full | grey "Passes 6/8" | allowed |
| 7–8 | ok | full | amber (as now) | allowed. Combine warns on the layer: "uses the last full-quality pass" |
| 9–10 | **ok (grace)** | **lowered** (below) | amber with a ½ badge: "Passes 9/8 · lower quality (grace 1 of 2)" | allowed up to 10 |
| 10 | ok (grace) | lowered | as above, "grace 2 of 2 · passes locked" | **locked**: refused |
| > 10 | fails as today (`overBudgetMessage`, now naming 10) | – | red | only reachable by loading an older file or a paste of a big graph. Nothing is changed silently |

**Lower quality in grace (one rule, predictable):** while 9–10 passes are in use, every pass whose
**Scale is 1 (full)** draws at **½**. A fixed-size Shader Texture halves its size, never below 128.
Passes the user already set to ½ or below, Optical Flow's own low-res passes and the hidden Blur / Glow
passes are left alone. Applied in `passGraph.ts` where `pass.scale` is set (`graceScale(budget)`), so
`ShaderCanvas` allocates the smaller targets with no new code path. Pages export with the same rule.
**Export** (video, ProRes, PNG) renders at full scale even in grace, because offline frame time
doesn't matter. The export dialog says "Rendered at full quality: in the preview, 2 passes run at
half resolution."

**Texture-unit guard:** grace is allowed only if every compiled program still binds ≤
`MAX_TEXTURE_IMAGE_UNITS` (16 guaranteed in WebGL2). Otherwise the compile fails as today with
"too many textures read at once" and the program named. This keeps `PASS_LIMIT_WHY` true.

**The lock (at 10):** one guard, `wouldExceedPasses(nextNodes)` → `passBudget(next).used >
HARD_MAX_PASSES`, memoised like `passBudget`. It's checked before any change that can add a pass:
- `addNode`, `addBuiltNode`, `duplicateNodes`, paste, recipe and starter builds, and builder / Combine Done;
- `toggleBypass` (un-bypassing a Pass);
- param changes that open a pass (the `CONDITIONAL_NOTES` settings: Draw Agents Sprite source, March Camera
  Lens Smooth, Curve Trace Beam, Grid Rules Texture, a Value at Point getting wired).

It refuses with a toast: "Locked: this would need 11 passes, and 10 is the most. Bypass or remove a
pass first." The toast has a **Show passes** action that opens the chip's panel. In the node browser
and quick-adds, pass-type nodes (those `nodePassNote` returns a "Uses N" note for) show a lock and
"Locked: 10 of 10 passes" and can't be dragged in. Bypassing or removing a pass unlocks them at once.

**In Combine:** each layer card shows its pass cost. A verb option that would cross 8 shows "uses grace
(lower quality)". One that would cross 10 is locked in the picker with the reason, and offers the
cheaper variant when there is one (Baked instead of Live, a texture fill instead of a Pass-made one).

**Tests:** `passBudget` levels (`ok` / `warn` / `grace` / `over`); `graceScale` (which passes halve,
fixed sizes, user scales untouched); the compile at 9, 10 and 11; the lock on each add path and on
`toggleBypass`; the chip states (extend `passBudgetChip.test.tsx`); export at full scale.

## 6. Texture builder [D6]

A builder for playing with the **Texture tools** (39 nodes in the library row, Passes included) on any
picture or video, with the same builder shell (viewport first, layer-style stack, presets strip, Done,
Add to this…). It makes a **Picture** product.

**Name clash:** docs/texture-builder.md already calls the **Shader Texture** node "the texture
builder". This plan uses **Texture builder** for the new kind and renames that doc's subtitle to
"Shader Texture". See open question 1.

```
 ┌ Scene builder › Texture ──────────────────────── Passes 3/8 ─ × ┐
 │ SOURCE [▤ street.mp4 ▾]  │                         │ OUTLINE ▾  │
 │ STACK                    │      before │ after     │ Draw ○◎≋   │
 │ ┌──────────────────────┐ │   [ split viewport ]    │ Width ─●── │
 │ │◉ Segment · people    │ │                         │ Glow  ──●─ │
 │ │◉ Jump flood    +0    │ │                         │ Tint  ■    │
 │ │◉ Outline · rings     │ │                         │ Amount ●── │
 │ │◉ Feedback · trails +1│ │                         │            │
 │ └──────────────────────┘ │                         │            │
 │ [+ Add a tool]           │                         │            │
 ├──────────────────────────┴─────────────────────────┴────────────┤
 │ Presets: Thermal · Ink outline · Motion trails · Relief          │
 │                                     [Add to this…] [  Done  ]    │
 └──────────────────────────────────────────────────────────────────┘
```

- **Source:** the shared `TexturePicker` (file, paste, library, an existing Texture node, a new Shader
  Texture) or the graph's own picture.
- **Stack:** blocks applied top to bottom. Each block is one Texture tools node with its visual settings
  and an **Amount** (mixes with what came in). Blocks are grouped in the add menu:

| Group | Blocks (node types) |
|---|---|
| Find | Depth, Segment, Blob Track, Analyze, Optical Flow |
| Shape the value | Mask (texture), Levels (texture), Curves, Threshold, Channel, Channel Colours |
| Neighbours | Neighbours, Blur, Glow, Edges, Jump Flood → Outline (distance) |
| Bend | Read (texture), Displace (texture), Displacement Map, Flow (texture) |
| Time | Feedback (texture), Change (texture), Cache / Cache Read |
| Light & depth | Height Light, Depth Mix, Depth of Field, Tilt-Shift |
| Lens | Chromatic Aberration (lens), Radial Fast Blur |

  Plumbing nodes (Data Texture, Render Targets, Read Channels, Read Neighbours, Show Data, Shuffle,
  Sample) aren't blocks. The builder inserts **Pass** nodes itself.
- **Passes are visible:** a block whose input must be a texture but receives a computed chain gets a
  Pass inserted before it. Its card shows "+1", and the header chip counts. The §5 lock applies (a
  block that would cross 10 is locked in the menu).
- **Viewport:** a before / after split by default, with the divider draggable. Clicking a block shows the
  result up to that block.
- **Spec and recognize:** `TextureSpec { v:1, source, blocks: { id, type, params, amount, muted }[] }` on the
  source node (`params.textureBuilder`, as the Time Cube keeps `_tcBuilder`), `_txRole` on the blocks, and kind
  `'texture'` in `SCENE_KINDS` and `builtScenes`.
- **Not in v1:** branches (two chains merged). It is a straight chain only, so you put an Edit inside
  the graph for branches.

## 7. Play [D8]

- Combine adds **no Play controls automatically**.
- Right-click a Combine or Texture builder slider → **Add to Play controls** (`paramPlayItems` via
  `BuilderSlider`'s `lazyParam`). This needs a `combine/paramMap.ts` (spec path → role → node + param),
  as `sceneBuilder/paramMap.ts` does.
- **Only after materialising:** while the session hasn't been Done (`sceneDraft` active and the layer
  not yet in the committed graph), the item shows disabled: "Add to Play after Done". After Done (or
  when reopening an existing build) it works as on node cards, and the control survives rebuilds
  (ids kept by role).
- Inline expressions: the expression itself isn't a control. Its **Make a slider** constants are, by
  the same right-click.
- The Play page layout rule (picture right, panel left) is untouched. Combine doesn't add Play layers.

## 8. Missing nodes and pieces (all small)

| New | Kind | For | Phase |
|---|---|---|---|
| `blobSpace` "Blob Space" | node (Texture tools) | Replace mask: per-pixel slot / ID / local UV / inside, with Fit and Padding | 1 |
| `agentFollowScene` "Follow surface (3D Scene)" | node (Simulation) | Follow the shape in 3D (Trace, Cling, Flow along, Orbit) on the 48³ grid | 2 |
| `agentPushTexture` "Push by texture" | node, **only if** no force takes a vec2 field | Points pushed by Optical Flow | 2 |
| Emit shape **Grid over the picture** | `agentEmit` option | Turn into points | 4 |
| `agentPictureAt` "Picture at home" | node (Simulation) | Turn into points: colour / depth at each walker's home UV, Update live / once | 4 |
| Emit shape **Scene surface** | `agentEmit` option | Spawn from a 3D scene | 4 |
| Emit **Depth from** | `agentEmit` option, if missing | Spawn from a Picture + depth in 3D | 4 |
| rig looks table `combine/rigLooks.ts` | data, not a node | Relight with a light rig | 5 |
| Picture Card **Relief** | setting | Picture + depth as a 2.5D card (optional) | later |
| Collide (depth) | node | Points colliding with a photo's depth | later |

## 9. Phases (one PR each, ordered for value)

| # | PR | Contents | Tests | Examples (built from nodes, commented) |
|---|---|---|---|---|
| 0 | **Pass grace & lock** | §5 in full; it's independent of Combine and makes later phases safe | §5 tests | none (behaviour) |
| 1 | **Combine shell + Place in + Replace mask (one for all)** | `src/combine/` (spec, build, apply, recognize, store, actions), the Combine kind card, the window (stack, verb picker, viewport isolate), Add to this… in every builder footer, Place in (every pair in §2.1), Replace mask with One for all + `blobSpace`, presets strip | spec ↔ build round trip; recognize / reopen / Start over; each Place in pair compiles (golden snapshot); `blobSpace` maths (CPU mirror); Add to this… keeps one undo step; Done / × / back leave the graph as before | *Photo in a room* (card in a 3D scene), *People → galaxy* (Segment + Blob Space + 2D build), *Splats behind glass* |
| 2 | **Follow the shape + Collide with + inline expressions** | §2.3, §2.4, `agentFollowScene`, (`agentPushTexture` if needed), the inline expression field → `simpleExpr` across verbs, Make a slider | each mode builds the hand-wired graph (role diff); `agentFollowScene` CPU mirror (pull to iso, tangent projection); expressions compile and refuse bad lines | *Sparks on the outline* (Ride a Path), *Sand settles on letters* (Collide + Gravity), *Fireflies over a sculpture* (Follow surface 3D) |
| 3 | **Per-blob fills** | Replace mask Per blob (chips, By order / ID, Rest), the per-blob `select` chain, viewport ↔ chip linking | slot ordering stable when a blob leaves; By ID; Rest; mute per fill | *Three dancers, three worlds* |
| 4 | **Spawn from + Turn into points (live)** | §2.5, §2.6 Live, Emit shapes Grid and Scene surface, `agentPictureAt`, Emit Depth from | one walker per cell; home UV kept; colour matches the picture (CPU mirror); scene-surface births land within a cell of the surface | *Photo as splats*, *Smoke from a statue*, *Motion makes sparks* |
| 5 | **Relight with + baked points** | §2.2 (scene and rig), rig looks table; Turn into points Baked (image) and Baked video via Cache | rig → Depth Light settings table; Cache-backed points play the clip in order; baked costs no model at play time | *Moonlit portrait*, *Golden-hour street*, *A clip as a point cloud* |
| 6 | **Texture builder** | §6: kind, shell, stack, inserted Passes, spec / recognize, presets, Add to this… | each block builds its node; Pass insertion; the lock in the add menu; reopen | *Thermal*, *Ink outline*, *Motion trails*, *Relief* |

Each phase also brings the docs (`docs/combine.md`, `docs/texture-tools-builder.md`) and What's new
entries with `release:sync`. Play right-click ([D8]) ships with each phase's sliders.

## 10. Open questions (few)

1. **Name of the Texture builder kind.** "Texture builder" clashes with the Shader Texture doc's
   subtitle. Should it be **Texture** on the kind page (the doc renamed to "Shader Texture"), or another
   name, such as **Picture tools**?
2. **Grace at export.** The plan exports at full quality even when the preview runs in grace (§5). Is
   that right, or should export match the preview exactly?
3. **Per-blob default.** Should the default be **By order** (steady when blobs come and go) or **By ID**
   (a blob keeps its fill until it's lost)?
