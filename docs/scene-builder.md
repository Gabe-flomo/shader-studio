# Scene builder

The Scene builder is the one builder in the side list. It opens on **What kind of scene?**, and the
kind you pick turns the window into that kind's builder:

| Kind | Builder | What it makes |
|---|---|---|
| **2D scene** | the 2D Scene Builder ([scene-builder-2d.md](scene-builder-2d.md)) | shapes, rings of rings, kaleidoscopes, motion and glow |
| **Agent scene** | the Agent Builder ([agent-builder.md](agent-builder.md)) | trail followers, particles, flocks, crowds, orbiters, in 2D or 3D |
| **Grid scene** | the Grid builder ([grid-builder.md](grid-builder.md)), with a switch to Grid Rules ([grid-rules.md](grid-rules.md)) | shapes drawn on cells, motion, patterns, grid warps, rules between shapes; or a simulation: Life, sand, heat, Wireworld |
| **3D scene** | the 3D Scene Builder ([scene-builder-3d.md](scene-builder-3d.md)) | ray-marched shapes, combined, bent, lit and seen through a camera |
| **Splat scene** | the Splat builder ([splat-builder.md](splat-builder.md)) | a Gaussian splat scan, placed, with stacked effects (dissolve, explode, wave, grade, crop, points), optionally in a ray-marched world |

Each builder keeps its own code and docs. The Scene builder only routes between them
(`src/builders/sceneKinds.ts`, `src/components/builders/SceneBuilderShell.tsx`).

## Opening it

- **Node browser, Builders:** the one entry, **Scene builder**. Searching for any kind's words
  ("2d", "slime", "wireworld", "raymarch", "rules") finds it.
- **Empty canvas:** right-click → **Builders** → **Scene builder**.

What it shows first depends on the graph:

- **A graph no builder made** (or an empty one): the kind page. When the graph has anything besides
  its Output, the page asks first: "Your graph has N nodes: **Clear and start over** | **Keep my
  graph**". **Clear and start over** is the default. Picking a kind then clears everything but the
  Output (unwired) as an undo step of its own ("Scene builder: cleared the graph"), and the kind
  makes its scene as the next step. Undo takes back the scene, then the clear. **Keep my graph**
  adds the new scene beside what is there.
- **A graph a builder made:** what the builder made, reopened as it was built: **Edit this one**
  (the default; Enter), **Start over** or **Add another**. With several, they are listed with
  their kind and picture; a selected one (or a selected node of one) is picked first.
  - **Edit this one** opens the kind's builder on it: a 2D or 3D build on its saved spec (the
    recipe stored on the build, so the form is exactly as it was built), a Grid scene in the Grid
    builder on its saved spec, a Grid Rules node in its editor, a rules Agents group in the Agent
    Builder, a splat scene in the Splat builder on its saved spec (kept on its Splat Scene).
  - **Start over** takes it away, as one undo step ("Scene builder: started over"): the build's
    nodes, and anything only they read from or that reads only from them (its picture, its Draw
    agents). The Output and nodes outside the build stay. Then the kind page, with a line saying
    what went.
  - **Add another** goes to the kind page with **Keep my graph** picked.

What counts as made by a builder: a 2D build or a Grid scene (its UV node holds the spec), a Scene
Group the 3D builder made, a Grid Rules node, a rules Agents group, and a Splat Scene the Splat builder
made (`builtScenes`).

### Straight to one kind

Entry points that name a kind still open it directly, without the kind page: the Do… bar's
"new 2d scene", "new 3d scene", "new grid scene", "new grid rules", "new agent rules", "edit this scene", "edit the
rules"; a Recipe chip's **Open**; a Grid Rules card's editor button; right-click → **Edit in Scene
Builder**. These keep their own behaviour (Grid Rules adds its node beside the selection). The
Agent Builder's own start page asks about clearing the graph the same way, with the same default.
"Open the scene builder" in the Do… bar opens the kind page (it used to open the 3D builder).

## Finding your way

Every kind's header starts with **Scene builder › 2D scene** (› the group's name in the Agent
Builder). **Scene builder** goes back to the kind page; what you built stays in the graph, and the
page then keeps the graph by default. The kind's sections are its tabs (2D: Space, Shapes, Grid,
Look, Output, Recipe, Templates) or, in the 3D Scene Builder, the Splat builder, Grid Rules and the
Agent Builder, the left nav of the studio shell. The Agent Builder's start page also has **‹** for the kind page. The
kind page and every kind's window are the same size (1440 × 900), so picking a kind doesn't jump.

### ⌘⇧D: straight to the recipe

**⌘⇧D** (Ctrl+Shift+D on Windows and Linux) opens the Do… bar from anywhere, but inside a kind it
jumps to that scene's recipe instead, with its text focused and ready to type (the settings panel
unfolds if it was folded):

| Kind | Where ⌘⇧D goes |
|---|---|
| 2D Scene Builder | the **Recipe** tab |
| 3D Scene Builder | **Under the hood**, the recipe as text |
| Grid Rules | **As text** |
| Agent Builder | **Advanced rules** on **Every rule** (its When … Do … lines; the first one focused) |
| Agent Rules window | the **Recipe** tab |
| Grid scene | **Rules** (a Grid scene has no recipe text) |
| Splat builder | **Under the hood**, the recipe as text |

The kind page and the Agent Builder's start page have no recipe, so ⌘⇧D closes them (they would
cover the bar) and opens the Do… bar; "new 2d scene" and the like there open a kind again.
One mechanism (`src/builders/windows.ts`): each kind with a recipe listens while it is open
(`useBuilderRecipeRequest`); the shortcut calls `requestBuilderRecipe()`, the topmost listener
answers, and the Do… bar opens when nobody does. `StudioShell` unfolds its inspector on the same ask.

**Done** closes the window and frames what was built on the graph (`src/builders/finish.ts`); the
kind page's × closes it with nothing to frame.

## The preview comes first

While a builder with a picture of its own is open (the kind page, the 2D and 3D Scene Builders,
Grid Rules), the main preview behind it is held (`src/builders/previewPriority.ts`, using
`lib/previewHold.ts`): it stops drawing and keeps its last frame, its clock waits, and the
builder's preview has the GPU to itself. An output window or a recording keeps full speed. The
Agent Builder and the Splat builder are the exceptions: their picture is the main preview, mirrored (a scan is drawn by
the main preview's raster pass), so it keeps running, and the Splat builder builds every change into the graph as you
go. For those two, everything that isn't their picture waits instead (below).

### The builder's picture comes first (Splat builder, Agent Builder)

While one of them is open, `src/builders/builderFocus.ts` has the focus (set by `watchBuilderPreview`, cleared when it
closes) and only the picture runs:

- **The graph behind the window is frozen** (`components/builders/FreezeBehindBuilder.tsx`, a Suspense freeze): the
  node cards and their inline previews, the wires, the minimap, the recipe and suggestion strips, and the node browser
  don't re-render on the builder's writes. They keep their state and catch up in one render when the window closes.
  (`BuilderWindowsHost` stays outside the freeze, inside NodeGraph.)
- **The preview skips what only the hidden panels use** (ShaderCanvas, `focus`): the pixel under the pointer, the
  histogram, the selected node's probe, Scope and LFO cards, the eye preview's readouts and scopes, and the Pass and
  Agents node thumbnails. The Agent Builder's own spotlight and Under the hood still draw.
- **One draw, straight to the viewport** (Splat builder): the preview already draws at the viewport's size (`ownSize`),
  so the viewport takes the preview's canvas itself (`lib/previewMirror.ts adoptPreviewCanvas`) instead of copying
  each frame into a 2D canvas, and nothing is left drawing under the window. The canvas goes back to its panel when the
  window closes (or before the preview unmounts). The Agent Builder's viewport is a different shape from the preview,
  so it still copies (one drawImage a frame).
- **A slider tick is one store write** (`splatBuilder/actions.ts writeParams`): the changed params and their uniforms
  together, no rebuild and no compile. Before, the params went in without their uniforms and each tick asked for a full
  compile 500 ms later, so the picture stood still during a drag and caught up after it.
- **The scan is read back and sorted only when it can have changed** ([splat-scene.md](splat-scene.md)): the probe and
  the moved depths are read only when what they read has changed; Sort: every frame skips a view that hasn't turned.

Measured with `train.splat` (1.03 M splats, Balanced), in the browser pane at 1500 × 950 (the pane's screen runs at
about 175 Hz, a frame every 5.7 ms), a slider (Place › Opacity) and an orbit (Angle and Elevation)
for 3 s each, a tick every 16 ms, medians of three runs. Main-thread busy is the time a frame the page's main thread
was not free (scripts, React, style and layout), measured with a message-channel probe.

| | Before (main) | Live sync | + frozen graph, skipped readbacks | + canvas in the viewport | + read/sort only on change |
|---|---|---|---|---|---|
| Orbit: the picture follows the drag | no (0 sorts; caught up 500 ms after) | yes | yes | yes | yes |
| Orbit: frame time p50 / p95 | 11.4 / 22.9 ms | 9.1 / 25.1 ms | 5.7 / 11.3 ms | 5.7 / 6.3 ms | 5.7 / 6.3 ms |
| Orbit: main thread busy a frame | 11.3 ms | 13.3 ms | 4.6 ms | 3.0 ms | 3.1 ms |
| Slider: frame time p50 / p95 | 5.7 / 17.1 ms | 8.4 / 24.6 ms | 5.7 / 6.4 ms | 5.7 / 6.4 ms | 5.7 / 6.3 ms |
| Slider: main thread busy a frame | 6.8 ms | 9.7 ms | 2.9 ms | 2.4 ms | 2.5 ms |

The live sync column is slower than main because it does the work main skipped: the picture now changes on every tick
(about 60 sorts a second while orbiting). The last fix shows with the clock paused and a moving effect (Wave), still:
before, 142 probe reads and 79 depth reads (4 MB each) a second and the preview never stopped drawing; after, none, and
the loop stops. With Sort: every frame and a still camera: no sorts (before, one per probe reading).

Where the time went before (a JS profile of 3 s of orbit): React re-rendering the graph behind the window (the node
cards, the node browser's per-row counts) was most of it; then the per-frame copy of the preview into the viewport
(about 1.3 ms a frame) and the probe's readback.

The 2D and 3D previews (`src/components/builders/useBuilderPreview.ts`):

- draw every frame at the screen's pixel density (up to 2×), not 30 a second at CSS pixels;
- compile while a slider moves, at most every 50 ms (the first change at once, the last always),
  instead of waiting until the drag stops;
- set uniforms only, with no new program, when a compile's shaders are the same as the last one's
  apart from comments. The compiler writes each node's note into the code, and a note can quote a
  value ("3.6 away"), so comments don't count.

The windows re-render only the tab being edited on a slider tick: the frame reads a shape count
and a mode, not the whole spec, and the panel that counts what Build makes recounts a few times a
second.

### Measured

Frames while dragging a slider for 2.6 s (150 ticks, one every 16 ms), in the browser pane at
1500 × 950, before (main at 290fb46c) and after:

| | Before | After |
|---|---|---|
| 3D (Twisted torus template over the Glow marcher example), Camera › Distance | | |
| main preview behind the builder | 117 draws/s | 0 (held) |
| builder preview | 27 draws/s, 331 × 240 px | 58.5 draws/s, 662 × 480 px |
| preview updates during the drag | none (160 ms after release) | every frame; 0 relinks |
| frame time p50 / p95 | 17.1 / 19.7 ms | 16.7 / 18.2 ms |
| main-thread cost of a tick p50 / p95 | 4.1 / 7.5 ms | 3.6 / 6.5 ms |
| 2D (Surprise me, seed 12345), Shape › Size | | |
| builder preview | 27 draws/s | 58.5 draws/s, 622 × 520 px |
| preview updates during the drag | none (134 ms after release) | every frame; 0 relinks |
| frame time p50 / p95 | 17.0 / 18.4 ms | 16.8 / 17.7 ms |
| main-thread cost of a tick p50 / p95 | 5.6 / 6.1 ms | 2.5 / 3.5 ms |

## Sliders

Every builder's number slider is the app's ruler slider through one wrapper
(`src/components/builders/BuilderSlider.tsx`), so it behaves like a node card's:

- **Double-click** resets it: to its default where the builder knows one (a shape's or a block's
  setting, the 3D camera, quality and look, the 2D look and grid, every Grid Rules and Agent Builder
  setting with a default), otherwise to the value it had when it came into view.
- **Bipolar:** a range symmetric about zero (−N … N: rotations, speeds, offsets) marks zero on the
  ruler and tints the stretch from zero to the needle. A node card's bidirectional slider does the
  same.
- **Typing past the end** widens the range (no min/max fields). The builder remembers the wider
  range while the app runs, by setting.
- **Right-click** on a slider that is a real node's param opens the node card's Play menu: **Add to
  Play controls** (or **Remove from Play controls**). That is every Grid Rules slider, and the
  Agent Builder's settings on the nodes round the group (Born's Size, Shot out at and Lives for;
  Trail's Fades, Spreads and How much food; Look's Size, Brightness and Streak length). The 3D
  Scene Builder edits a spec, not nodes: its sliders map each value to the node param it builds
  (`sceneBuilder/paramMap.ts`, BuilderSlider `lazyParam`), found when the menu opens, once the scene
  is built ([scene-builder-3d.md](scene-builder-3d.md), "Play controls from the builder").

Not yet: keyframes from a builder slider, and the Play menu on the 2D builder's sliders.

## Textures

Pictures are a source like any other in every kind of scene: upload one, paste one, pick one from the
library or the graph, and use it as a fill, a layer, a surface, a background, cells, a pattern or a mask.

### The picture picker

Every place in the builders that takes a picture shows the same row: the picture it reads now (a
thumbnail and its name), **Pick…** / **Change**, and ✕ for none. **Pick…** opens the scene's own
pictures first, then the ways to take a new one (`components/builders/TexturePicker.tsx`):

| Way | What it makes |
|---|---|
| **Upload or drop a picture** | a new Texture node with the picture (kept in the image library and embedded in the node, as the Texture card does: [texture-node.md](texture-node.md)) |
| **Paste a picture or its link** (⌘V in the field, or a link and Enter) | the same; a link is fetched as the card's **Load** is, and kept as its Source |
| **Image library** | the same, from Files → Backgrounds |
| **From the graph** | nothing new: the Texture, Shader Texture (or anything else with a Texture output) already there |
| **New Shader Texture** | a new Shader Texture ([texture-builder.md](texture-builder.md)), Start from: Circles; edit what it draws on its card |

A new node is one undo step ("Added a picture: pond"), placed in view; the picture loads into it a
moment later. The picker's store side is `src/builders/textureActions.ts`.

### One node per picture, a reference in the spec

A scene's spec keeps a list of its pictures (`textures`): each a **name** (what the recipe and the
lists call it), the **node** it reads (its `texture` output) and the picture's **aspect**. Uses name
a picture; picking the same picture twice reads the same node. Build wires each use from that node
(a Sample (texture) reading it, or Picture Environment), so a new picture dropped on the Texture card
shows in the built scene at once. **Edit this one** reopens the scene with the same references.

A picture typed in a recipe (`texture brick`, or a use naming one never declared) has no node yet:
Build makes an **empty Texture node** named after it, beside the scene, and the spec then reads it
(`ensureSources`). Drop a picture on it.

**Start over** takes the picture's node away with the build when nothing else reads it.

### Where each kind uses pictures

| Kind | Uses | Docs |
|---|---|---|
| 2D scene | a shape filled with a picture (Fill, Fit, Stretch, Tile); a **Picture** layer; the background picture, read at the warped point so every space transform and block bends it; a mask | [scene-builder-2d.md](scene-builder-2d.md#textures) |
| 3D scene | a shape's surface (triplanar, planar, spherical, face), tiles, blend sharpness, offset, turn, bump from brightness; picture panels; the background from a picture; the template *A picture, repeated forever* | [scene-builder-3d.md](scene-builder-3d.md#textures) |
| Grid scene | a **Picture** cell shape; a **Picture** pattern (brightness drives size, turn, push, hue or brightness); a picture mask | [grid-builder.md](grid-builder.md#textures) |
| Grid Rules | Start → A picture: the same picker, wired into Start image | [grid-rules.md](grid-rules.md#a-picture-start) |
| Agent Builder | Where → Create new → **A picture…** (born inside, food, only when, a layer's region) | [agent-builder.md](agent-builder.md) |
| Splat scene | Scene → Background → **Picture** (the backdrop the camera looks at, with or without a world) | [splat-builder.md](splat-builder.md) |

### Looking good repeated

- **Seamless repeats.** A tiled picture is read through Sample (texture) with **Edges: Repeat**: it
  wraps in the shader but picks the mipmap from the unwrapped place (`textureGrad`), so there is no
  line where the picture starts again and no shimmer far away. Sample's default reads as before.
- **Mipmaps and anisotropy.** Pictures are uploaded with mipmaps and 8× anisotropic filtering (three
  clamps it to the GPU's), so a picture at a slant stays sharp. The builders' previews do the same.

### The previews

The builders' own previews compile a stand-alone graph with a stand-in Texture node per picture (same
id as the real one, `standIns`) and bind the real picture to it (`previewTextures.ts`): the picture
the app holds for a Texture node, a Shader Texture's last frame (its card thumbnail, refreshed a few
times a second), or a grey checker while there is none.

### Code and tests

`src/builders/textures.ts` (sources, stand-ins, `ensureSources`, fits, GLSL helpers),
`src/builders/textureActions.ts`, `src/components/builders/TexturePicker.tsx`,
`src/components/builders/previewTextures.ts`. Tests: `src/sceneBuilder2d/__tests__/textures.test.ts`,
`src/sceneBuilder/__tests__/textures.test.ts`, `src/gridScene/__tests__/gridTextures.test.ts`.

### Not yet

- Graph → spec (*Describe this graph*) doesn't read pictures back; a built scene reopens from its spec.
- Displacement from a picture in 3D (the bump only tilts the light); a picture inside a Scene Group's
  distance is a Pass away.
- Grid scenes read a picture pattern or mask once per cell, at the pixel's own cell, so a shape
  reaching into a neighbouring cell takes that cell's value.
- Video and webcam sources work through **From the graph** (a Texture node switched to Video), not
  from the picker's upload.
