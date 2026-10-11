# Scene builder

The Scene builder is the one builder in the side list. It opens on **What kind of scene?**, and the
kind you pick turns the window into that kind's builder:

| Kind | Builder | What it makes |
|---|---|---|
| **2D scene** | the 2D Scene Builder ([scene-builder-2d.md](scene-builder-2d.md)) | shapes, rings of rings, kaleidoscopes, motion and glow |
| **Agent scene** | the Agent Builder ([agent-builder.md](agent-builder.md)) | trail followers, particles, flocks, crowds, orbiters, in 2D or 3D |
| **Grid scene** | the Grid builder ([grid-builder.md](grid-builder.md)), with a switch to Grid Rules ([grid-rules.md](grid-rules.md)) | shapes drawn on cells, motion, patterns, grid warps, rules between shapes; or a simulation: Life, sand, heat, Wireworld |
| **3D scene** | the 3D Scene Builder ([scene-builder-3d.md](scene-builder-3d.md)) | ray-marched shapes, combined, bent, lit and seen through a camera |

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
    Builder.
  - **Start over** takes it away, as one undo step ("Scene builder: started over"): the build's
    nodes, and anything only they read from or that reads only from them (its picture, its Draw
    agents). The Output and nodes outside the build stay. Then the kind page, with a line saying
    what went.
  - **Add another** goes to the kind page with **Keep my graph** picked.

What counts as made by a builder: a 2D build or a Grid scene (its UV node holds the spec), a Scene
Group the 3D builder made, a Grid Rules node, and a rules Agents group (`builtScenes`).

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
Look, Output, Recipe, Templates) or, in the 3D Scene Builder, Grid Rules and the
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
Agent Builder is the exception: its picture is the main preview, mirrored, so it keeps running.

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
