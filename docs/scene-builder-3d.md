# 3D Scene Builder

The 3D Scene Builder is a form for describing a ray-marched scene without
wiring it: which shapes, how they combine, how space bends, how it is lit, and
where the camera is. **Build** turns the description into an ordinary node
graph, with a plain-language note on every node. You can edit that graph
freely, and reopen it in the builder later.

It writes the same graph you would wire by hand: a Scene Group, a March Camera,
a March Loop (or GI Lit March Group, or Glass Scene), lighting, Tone Map and the
Output. It does not use a special node that hides the scene. Every setting is a
node param, so every slider is a live uniform and dragging it never recompiles.

The same description can be written as a **recipe**, a short line of text:

```
volumetric · smooth-union(sphere r=1, cone height=2 rot=(30,0,0)) k=0.3 · twist 0.5 · polar-repeat 6 · camera dist=4 orbit=10
```

## Muting

Any shape, group, warp, light or effect can be switched off for a while
([scene-builder.md](scene-builder.md#muting) has the shared rules: the ⊘ on its card or tree row,
Alt-click solos, one undo step, saved with the scene):

| What | How it is muted |
| --- | --- |
| A shape (tree row or card) | Live: its distance is pushed far away inside the Scene Group, so it draws nothing and unions ignore it. In Materials (a plain group, which has no gates) the same bypass is an Expression Block with a 0/1 Constant, so it never wins a colour. |
| A group (not the scene itself) | Live: its last combine measures far away. |
| A warp | Live: its node passes the point straight through; a modifier passes the distance; Scale gates both its halves. Muted, it no longer asks for a smaller march step (Step Scale on auto), nor does one on a muted shape or group. |
| Soft shadows, ambient occlusion | Live: their shade is 1 (fully lit). |
| The highlight (shine) | Live. |
| Fog, tone map | Live: the colour passes through. |

Recipe: `sphere r=1 muted`, `union(…) muted`, `@twist(2 muted)`, `shadows 16 muted`,
`fog 0.05 muted`, `tone aces muted`. The recogniser reads mutes back from a built graph. Tests:
`src/sceneBuilder/__tests__/mute.test.ts`.

## Opening it

- **Node browser, Builders (first section):** **Scene builder** → **3D scene** opens it on a
  new scene, on the desktop and on a phone ([scene-builder.md](scene-builder.md): on a graph a
  builder made, the Scene builder offers Edit this one / Start over / Add another first). Its
  header reads **Scene builder › 3D scene** (back to the kinds). Searching "builder" or "scene"
  shows it too.
- **Node browser / add menu:** "New 3D scene…" in the 3D Scene category. Search
  "scene builder", "recipe" or "describe 3D" to find it.
- **Empty canvas:** right-click → **Builders** → **Scene builder** → **3D scene** (at the top level).
- **Do… bar (⌘K):** "open the scene builder" or "new 3d scene"; "edit this scene"
  with a built Scene Group (or any node of it) selected.
- **A scene the builder made:** right-click any of its nodes → **Edit in Scene
  Builder**, or **Open in Scene Builder** in the Recipe chip on its Scene Group.
- **Any 3D graph:** right-click its Scene Group, March Loop or camera →
  **Describe in Scene Builder**, or right-click the empty canvas → **Describe
  this graph**. The builder's header also has **Describe graph**.

### The Recipe chip

A Scene Group the builder made shows its recipe on the card (and on the phone's node page): one or
two lines, cut short. A click shows the whole recipe, one clause a line, its words coloured (modes,
combines, shapes, warps, settings, numbers), with **Copy** and **Open in Scene Builder**. When the
scene's nodes were changed by hand since the build (a setting, a wire, a node added inside or
deleted; moving cards doesn't count), the chip says **edited since build**: the same check a
rebuild makes (`checkEdits`), so Open in Scene Builder will tell you what a rebuild keeps. A
hand-made Scene Group has no chip. The Do… bar's "show the recipe" opens it; "copy the recipe"
copies it. Code: `src/builders/recipe.ts`, `src/components/builders/RecipeChip.tsx`.

## The window

Since 2026-10-10 (Wave 5, item 15) the builder is on the Agent Builder's studio shell
(`components/builders/studio/StudioShell.tsx`), viewport first:

```
┌ Scene builder › 3D scene · name ── undo · redo · Under the hood · Describe · Surprise · Open as nodes · ⋯ · Done ┐
│ Sections, each with a │        the scene, live and big: drag to turn the camera,   │ the section's     │
│ one-line summary      │        scroll to zoom, click a shape, drag its gizmo       │ settings          │
├───────────────────────┴─────────────────────────────────────────────────────────────┴───────────────────┤
│ presets, as pictures · Surprise me                                                                       │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Left:** the sections (below), each with a one-line summary of the scene (`5: sphere, sphere, capsule…`,
  `smooth union k 0.35`, `3.8 away, 30° round, orbit 6°/s`), and **Describe** under "From the graph".
- **Right:** the picked section's settings. Each section opens with a short line of what you can build
  there and **Learn more** (`src/sceneBuilder/sections.ts`).
- **Bottom:** the templates as pictures (each drawn once a session by `specThumbs.ts`: the template built,
  compiled and drawn small), and **Surprise me** with its seed.
- **Top bar:** Undo and Redo (⌘Z / ⌘⇧Z), **Under the hood** (the recipe, below, in place of the settings;
  Esc goes back), **Describe** (reads the 3D graph on the canvas), **Surprise me**, **Open as nodes**, ⋯
  (**Build now** / **Rebuild now**, and **Build as a new copy** on a built scene) and **Done**.
- **Done** builds the scene when it isn't built or has changed (a rebuild of the scene it was opened on,
  keeping edits made on its nodes, as before), closes the window and frames the scene on the graph. **Open
  as nodes** does the same and opens the Scene Group, to see the shapes, combines and warps as nodes. × closes
  without building. The kind line under the name says which: "not built yet: Done builds it", "changed:
  Done rebuilds it" or "built".
- The side panels fold (⌘[ ⌘]); under 1100 px they are drawers; on a phone the window fills the screen.

Code: `src/components/sceneBuilder/SceneBuilderModal.tsx` (the window), `SceneViewport.tsx`,
`sectionPanels.tsx`, `specThumbs.ts`; the sections' words in `src/sceneBuilder/sections.ts`; the viewport's
maths in `src/sceneBuilder/viewMath.ts`. Older entry points that name a tab still work: Look opens Light &
colour, Quality opens Output, Templates and Recipe open Shapes (`sectionOfTab`).

### The viewport

The scene Build will make, compiled and drawn live (the same preview as before, `useBuilderPreview`), as
big as the window allows.

- **Drag** the picture to turn the camera round (Angle, Elevation); **scroll** to come closer (Distance).
  These write the Camera section's values: what you see is what Build makes. A drag is one undo step.
- **Click** a shape to pick it. Picking marches each shape's own distance on the CPU (the gallery's
  formulas, `thumbnails.ts makeSdf`), placed and turned as the build places it (`viewMath.ts pickShape`).
  A click from Mode, Camera or Output goes to Shapes.
- **The gizmo** on the picked shape: its white middle moves it across the picture, the **X**, **Y** and
  **Z** arrows move it along one axis, and the yellow square on its dashed ring sizes it (every length
  together, keeping its proportions: the linked Size). A drag writes the same values as the sliders (its
  Position, its sizes), live, and is **one undo step** however long it pauses (`store.beginGesture` /
  `endGesture`). The gizmo follows an orbiting camera.
- The picked shape's name, a hint, Build's warnings and the compile time are drawn over the picture;
  **Pause** stops the clock.

The camera maths is March Camera's own (`viewMath.ts cameraBasis`, `project`, `rayAt`, with Flatten), so
the gizmo sits where the shape is drawn. Not followed: warps other than Move on the shape or the groups
round it (the gizmo is where the shape would be without them), and rotations of the gizmo itself.

## The sections

They follow the recipe help's sections and say what you can build:

| Section | What you build there | Holds |
|---|---|---|
| **Mode** | how it is drawn | four picture cards (Surface, Volumetric glow, Glass, GI lit, each a small scene drawn in that mode), the mode's own settings (Glow, Glass, Global illumination) and, in Glass mode, which shapes are glass |
| **Shapes** | what is in the scene | the shape gallery (pictures), the shapes in the scene as chips, the picked shape: name, kind, **Size** (Linked, or Width · height · depth for a box, box frame and ellipsoid, Radius · height for a cylinder, capsule and prisms), its other settings, Position, Rotation, colour, shine, modifiers |
| **Combine** | how shapes join | six picture buttons (two discs shaded as the combine keeps them) for the group round the picked item, its blend k, and the scene as a tree (the Scene tree, below) |
| **Warps** | bent space | what to bend (chips), the stack as a flow (space comes in, each warp a card, the item is measured), the warps to add, and the step scale they ask for |
| **Light & colour** | colours and light | each shape's colour and shine, the lights, shadows and occlusion, fog and the background |
| **Camera** | where you look from | the camera's sliders |
| **Output** | what the scene shows | the outputs and palettes, the tone map, and Quality (steps, distance, step scale, jitter, warp safety) |

### Sliders in a narrow panel

Every builder slider keeps at least 64 px of track beside its number (`BuilderSlider` `TRACK_MIN`,
RulerSlider `trackMinWidth`), and X / Y / Z rows (Position, Rotation, Sun direction, a modifier's
vector) put one axis on each line. Before 2026-10-11 the three axes sat side by side: the number
chips took the whole column, the tracks were 0 px wide and only the numbers could be reached; in
a narrow panel the same happened to single sliders (a cone's Angle ° and Height).

### Play controls from the builder

Every slider is a `BuilderSlider`. Where a value builds a node param, right-click offers the node card's Play
menu (**Add to Play controls**), for the node the build made: the builder edits a recipe, so
`src/sceneBuilder/paramMap.ts` maps each value to the role of the node it builds and its param (a shape's
size → the shape node's param, its Position → `s1:at`'s x/y/z, a combine's k → its first join, a warp's
settings, the camera, the look's numbers, quality). The node is looked up when the menu opens
(`liveParam`), so the scene has to be built: before that, and for a value whose node isn't built yet, the
menu says so. A Play control drives the node, not the builder: a rebuild keeps it pointed at the same node
(ids are kept by role), and the builder's value is what the node is rebuilt with.

The older parts of the window, now inside the sections:

**Scene tree (in Combine).** The combine tree. Every combine is a box: a badge
with its operator (∪ union, − subtract, ∩ intersect, with `smooth` and its k
for the smooth ones) over the shapes and groups inside it, indented with a
guide line. So `smooth-union(a, b)`, then intersect with c, then subtract d
reads top to bottom as three nested boxes. Shapes show their picture and their
colour; any item's modifiers show as small chips under its name (click one to
open it in the inspector).

- **Click** a row to select it and edit it in the inspector (the Shapes tab).
- **⌘ / Shift-click** picks several rows. **Wrap in…** puts a new group
  (union, smooth union, subtract, smooth subtract, intersect or smooth
  intersect) around what is picked, at the first one's place; with nothing
  selected it adds an empty group. An item inside another picked one goes with
  it.
- **Drag** (desktop) a row onto the top or bottom edge of another row to
  reorder it, or onto the middle of a group (or an empty group's "drop here"
  box) to nest it inside.
- **Buttons** on the selected row: ▲ ▼ step it among its siblings, › moves it
  into the group just above it, ‹ moves it out of its group. On a touch screen,
  where there is no drag, these are always shown; with a mouse they show on
  hover.
- **+ Shape** opens the gallery as a pop-over.

The tree's operations are pure functions in `edit.ts` (`moveBy`,
`moveIntoPrevious`, `moveOut`, `wrapItems`, `insertShape`), tested on their own.

**Shapes.** Two parts:

- **The shape gallery** ("Add a shape"): a grid of small pictures, one per
  shape in the registry, plus Rounded box and Rounded cylinder. Click (or tap)
  a tile to add the shape beside the selection, or into it when it is a group;
  on a desktop, drag a tile onto a row of the Scene tree to put it before,
  after or inside that row. The pictures are drawn once per session by a small
  CPU ray marcher (`thumbnails.ts`: the SDF nodes' own formulas at the shape's
  default size, one soft light, a clear background), a few per frame, at the
  screen's pixel density. They have no background, so they read the same in
  the light and dark themes. A test checks that every registry shape has a
  tile and a picture.
- **The inspector**: the selected item.
  - A shape: name, shape type, its own sizes, position, rotation (degrees
    about X, then Y, then Z), colour and shine (its material) and, in Glass
    mode, whether it is made of glass, all with sliders.
  - A group: name, the operator (six buttons), blend radius k for the smooth
    ones, and its items in order with ▲ ▼.
  - Both: Duplicate, Ungroup (a group), Remove, and its **modifiers**.

**Modifiers.** Any shape or group has a stack of modifiers, shown as chips in
the inspector (`1 Move 0.35,0,0`, `2 Rotate 0,30,0`, `3 Round 0.06`). Click a
chip to edit it below (sliders), drag a chip onto another to reorder (or
Earlier / Later on the open one), × to remove, **+ Modifier** to add one:
move, rotate, scale, twist, bend, repeat, mirror, polar repeat, round, onion,
and under "More warps" every other warp. The stack reads outside in, like the
recipe: `box @move(1,0,0) @rotate(0,45,0)` is a turned box, moved. The build
puts the point's modifiers (move, rotate, scale, twist…) before the item's
distance (its SDF, or its group's combine) and the distance ones (round,
onion, displace, and Scale's correction) after it, innermost first, each with
a note. Whole-scene warps stay under Bend space.

| Modifier | Builds | Notes |
|---|---|---|
| move | a 3D Transform (Move) | |
| rotate | a 3D Transform (Rotate X, Y, Z) | X, then Y, then Z, like a shape's own Rotation |
| turn | a 3D Transform in Apply mode, one axis | turns the point, as Rotate 3D did |
| scale | a 3D Transform on the point (Scale = factor), and a second one after the distance (its Distance sockets) | keeps distances exact; keep the two Scales equal |
| round | Offset (amount = −r) | grows the surface out, rounding its edges |
| onion | Onion | a thin shell (cut it to see inside) |

A shape's own place and turn (`at=`, `rot=`) are one 3D Transform (role `s1:at`). Each Transform carries the
modifier it was made for (`_sbKind`) so Describe reads it back (docs/transform-node.md). Graphs from before
2026-10-10 used Translate / Rotate / Scale 3D; Describe still reads those.

**Combine (the older tab; the Combine section now has picture buttons and the tree).** Shows the tree as a formula, then one card per group:

- operator: union, smooth union, subtract, smooth subtract, intersect or
  smooth intersect;
- blend radius k, for the smooth operators;
- name;
- its items in order, with buttons to move them up, down or out of the group.

Subtract cuts every later item out of the first one.

**Warps (was Bend space).** Pick what to bend: the whole scene, a group or a shape. Then
stack warps on it. Warps run top to bottom:

| Warp | What it does | Node |
|---|---|---|
| move | shifts what follows | Transform (3D) |
| turn | turns what follows about one axis | Transform (3D, Apply mode) |
| rotate | turns about X, then Y, then Z | Transform (3D) |
| scale | grows or shrinks, distances kept exact | Transform (3D) × 2 |
| repeat | endless copies, one per cell | Repeat 3D |
| mirror-repeat | endless copies, every other one flipped | Mirrored Repeat 3D |
| limited-repeat | a few copies each way | Limited Repeat 3D |
| mirror | one half of space mirrored onto the other | Fold 3D |
| fold | mirror with an offset (fractal folds) | Mirror Fold 3D |
| polar-repeat | copies round an axis | Polar Repeat 3D |
| kaleido | repeated folds with a solid's symmetry | Kaleidoscope 3D |
| twist | turns space round Y more the higher it goes | Twist 3D |
| bend | curves space along X | Bend 3D |
| sine | shifts one axis by a sine of another | Sin Warp 3D |
| warp | pushes space about with smooth noise | 3D Domain Warp |
| displace | bumps on the surface (changes the distance) | Displace 3D |
| round | rounds edges, grows the surface (changes the distance) | Offset |
| onion | a thin shell (changes the distance) | Onion |

Each warp that stretches space shows a **Step Scale** hint. Such a warp makes
the scene's distances too large, so a full step can jump through a surface.
The hint is how much of each step it is safe to take (Hart's Lipschitz bound;
see the ray-marching guide, "Warps that stretch space"). With Step Scale on
**auto** (Quality), the loop uses the smallest hint any warp or shape asks for.
The Bend space tab lists who is asking.

**Look (now Mode, and Light & colour).**

- **Mode:**
  - **Surface:** a March Loop, then Soft Shadow, SDF Ambient Occlusion and
    Multi-Light, with a colour and a shine per shape.
  - **Volumetric glow:** the loop in volumetric mode, with Scene Distance →
    Volume Glow (+=) in its body and Glow to Color after it.
  - **Glass:** Glass Scene, with glass shapes in one Scene Group and the rest
    in another.
  - **GI lit:** the GI Lit March Group.
- **Lights:**
  - sun direction and colour;
  - a sky colour from above;
  - a bounce colour from below (the Multi-Light rig).
- **Shadows and ambient occlusion:** each can be on or off, with its own
  setting.
- **Fog:** a density, and a colour (the background's unless set).
- **Background:** a solid colour, or a gradient from top to bottom.
- **Tone map.**

**Camera.** The orbit camera used by Time Cube View, Frame Stack and Draw
agents:

- Distance;
- Angle, in degrees;
- Elevation, in degrees;
- Orbit speed, in degrees a second;
- Zoom;
- **Projection** (Perspective / Orthographic / Reverse, with hover help on each):
  - **Perspective** (the default): far things look smaller; **Flatten** (0 perspective … 1
    orthographic) blends it toward an isometric look;
  - **Orthographic**: the rays run parallel, so size doesn't change with distance and parallel
    edges stay parallel;
  - **Reverse** (reverse perspective, [curved-space.md](curved-space.md)): the rays start spread
    out and meet in front of the camera, so far things look bigger, like a Byzantine icon.
    **Strength** (0 parallel … 1 the rays meet exactly at Converge at) and **Converge at** (how
    far in front they meet; past it the picture flips). The point it looks at keeps its size;
- Translate X / Y / Z, which move the camera and the point it looks at
  together.

It builds a March Camera:

- Translate becomes its Target;
- Flatten becomes its **Flatten** setting (only in Perspective). A camera
  without it compiles exactly as before;
- Projection becomes its **Perspective** (Normal, Orthographic, Reverse), Strength and Converge
  at its Reverse strength and Converge at. Perspective sets nothing, so an older scene builds as
  before. Describe reads the card's Perspective back.

The viewport follows the projection (picking and the gizmo use the same maths, `viewMath.ts`).
In a recipe the projection is a word: `camera orthographic`, `camera reverse converge=6`
(`reverse=` is the strength), `camera perspective`, or `projection=…`.

**Quality (now in Output).**

- Steps;
- Max distance;
- Step scale: auto, or a fixed value;
- Jitter.

**Recipe (now Under the hood).** The whole scene as text. Type or paste a recipe and the form
follows as you type, as long as the recipe reads cleanly. Mistakes are listed
with their line and column (click one to select it). **Apply what reads** uses
the clauses that are fine. While you aren't typing, the text follows the form.
**Show the words** lists the vocabulary.

**Templates (now the presets strip, as pictures).**

- Glowing orb (volumetric);
- Smooth-blob sculpture;
- Infinite pillars (repeat + fog);
- Twisted torus;
- Glass objects on a plane;
- Menger-like fold (crosses folded into a grid by Repeat and cut from a cube);
- GI-lit room.

Each template is a recipe, so reading one is a good way to learn the language.

**Describe (in the nav, under From the graph, and the top bar's search button).** See "Scene → words" below.

**Preview (now the viewport).** The graph Build will make, compiled and drawn live by
a WebGL2 canvas of its own. It doesn't touch the main canvas. Build's warnings are drawn over it.

### Output

What the built scene shows. **Picture** is the default; the others are the march loop's own
measurements (the March Loop / GI Lit March already hand them out as sockets):

| Output | Recipe word | From | Shown as |
|---|---|---|---|
| Picture | `picture` | the lit chain | the picture (tone mapped) |
| Depth | `depth` | Depth (0 at the camera … 1 at Max Dist) | grey |
| Distance | `distance` | Distance (scene units ÷ Range) | grey |
| Height | `height` | Hit Pos's Y (−Range … +Range) | grey |
| Normal | `normal` | Normal × 0.5 + 0.5 | a colour (X red, Y green, Z blue) |
| Hit mask | `hit` | Hit | white where a ray hit |
| Position | `position` | Hit Pos (÷ Range, × Hit) | a colour |
| Steps | `steps` | Iter (0–1 of Max Steps) | grey |
| AO | `ao` | SDF Ambient Occlusion (Surface) / the loop's AO (GI) | grey |
| Shadow | `shadow` | Soft Shadow (Surface) / the loop's Shadow (GI) | grey |

**Colour the space** sends the number through a palette instead of grey: a cosine **Palette**
preset (sunset, rainbow, fire, forest, teal, warm, haze, psychedelic) or a **Color Ramp** stop set
(mono, heat, ice, terrain). Normal through a palette is by how much a surface faces up (n.y);
Position by distance from the centre. Presets in the tab: Depth map, Sunset depth, Height map,
Normals, Heat steps, Clay (AO), Ice distance.

What Build makes: an Expression Block (role `out:value`, with a note saying what it shows and
how it is scaled, and Range as a slider where there is one) wired from the loop's socket, then a
Palette (`out:palette`) or Color Ramp (`out:ramp`) when it colours the space; that goes to the
Output, untone-mapped. The lit picture's nodes are still built beside it, so wiring Tone Map back
into the Output shows the picture again. Volumetric glow has no surface (only Steps applies) and
Glass Scene hands out only its colour: there the builder warns and keeps the picture.

## Built-in guidance

Every builder window (`components/builders/BuilderWindow.tsx`) carries the same help, with its
words in `components/builders/helpContent.ts`:

- **How this works.** Each section opens with a short card: what it is, what it does, "you can do
  X to get Y", and one or more **worked examples** (click to insert). **Got it** hides a card;
  **Tips** in the header turns them all off, and turning it back on brings back every card you
  dismissed. Both are remembered per builder.
- **Empty states** (no shapes, no rules) always show their guidance; with tips off it folds to one
  line and its examples.
- **Field hints.** Every control has a plain-language hint on a **?** beside its label (hover or
  focus shows it).
- **Type-ahead.** Text fields complete as you type: ↑ ↓ to choose, Tab (or Enter, outside the Do…
  bar) to take one, Esc to close (`lang/complete.ts`).

A new builder adds its block to `BUILDER_HELP` and gets all of this by using `BuilderWindow`
(`<BuilderHelp id>`, `<EmptyHelp id>`, `<HintMark text>`, `<HintLabel hint>`). A test checks
that every registered section has help.

In the Scene Builder the studio's sections use a short line and Learn more instead (`sections.ts`); the
cards are still under the hood (Recipe), in Describe and in the empty scene tree; an example adds its
recipe clause to the scene (one undo step).

## Build and Rebuild

**Build** adds the graph beside what is on the canvas, wires it to the Output
(the first 3D scene takes the Output over, as adding a 3D node does), and
selects the march loop. It is one undo step.

The builder keeps what it built in two places:

- on the Scene Group: the spec, the build's id, and, for every node, what it
  built (its settings and wires);
- on every node: its role, a stable name for the part of the spec it comes
  from, such as `s2:at` (shape 2's Move), `light` or `mat:s3:s3:color`.

When you reopen the scene with **Edit in Scene Builder** and press
**Rebuild**, it compares node by node:

- **A node you didn't touch** is replaced by the new build.
- **A setting you changed on a node** that the new spec doesn't change is
  kept. For example, you turned the Soft Shadow's hardness up on the card, and
  in the builder you moved the camera.
- **Node ids are kept** for every role, so Play controls pointing at a node,
  and wires from your own nodes into the scene, stay connected.
- **What it can't keep** makes it ask first, with **Build a new copy** (leave
  this one and build beside it) or **Rebuild anyway**:
  - a setting both you and the builder changed;
  - a wire you moved;
  - a node of the scene you deleted;
  - a node you added inside the Scene Group.

**Build as a new copy** in the footer always builds beside the old scene.

## Scene → words

Describe reads the output too: a builder scene's `out:value` block carries the output it shows,
and in a hand-made graph the Output (or a Palette before it) wired straight to one of the loop's
sockets (Depth, Normal, Hit…) reads as that output. The lights and look are then read from the
picture chain beside it.


**Builder-made scenes** read back exactly. The recogniser rebuilds the spec from
the graph itself, using the roles and names the build left on the nodes. Every
template round-trips: spec → graph → spec gives the same spec, and the same
recipe.

**Any hand-made 3D graph** gets a best-effort description. It follows the
wires:

- from Output to the renderer (March Loop, GI Lit March Group or Glass Scene);
- from the renderer to its March Camera and Scene Group;
- inside the Scene Group, from Scene Output back to Scene Pos.

On the way it recognises:

- shapes;
- Union, Subtract and Intersect, smooth or not, and plain Min / Max;
- warps, including those in the loop body;
- moves and turns just before a shape, which become its position and rotation;
- a field cut to a ball;
- the render mode;
- the lights: Multi-Light, Soft Shadow and SDF AO;
- fog, background, tone map, camera and quality.

Older scenes without a Scene Output are read through their named return, or
their last distance.

What it doesn't know becomes `custom(Label)` (a shape) or
`custom-warp(Label)` / `@custom(Label)` (a warp). The Describe tab lists what
was and wasn't recognised, and how many nodes it read. **Open the recognised
part in the builder** puts it in the form, where Build makes a new scene beside
the original. Custom parts are left out, with a warning.

Free-form English (an AI model) is out of scope. Describe and the recipe parser
make no network calls.

## The recipe language

The recipe is the scene dialect of the shared Playfield language (`docs/playfield-language-plan.md`):
the Do… bar, Grid Rules and Agent Rules read the same values, settings, colours and
`@modifiers` through the same lexer and reader (`src/lang/`).

A recipe is **clauses** separated by `·`, `|`, `;` or new lines. `//` starts a
comment. Case doesn't matter for words. Numbers can carry units: `30deg`, `30°`
or `0.5rad` (angles are in degrees otherwise).

Each clause is one of these:

- **a render mode:** `surface`, `volumetric`, `glass` or `gi`, with its
  settings;
- **an item:** a shape or a combine. Top-level items are joined by a union;
- **a warp**, which bends the whole scene;
- **a setting:** sun, sky, bounce, shadows, ao, fog, background, tone, camera
  or quality.

Printing writes only what differs from the defaults.

**The pretty form.** Inside a combine's brackets, a new line that is indented (or starts with the
closing `)`) goes on with the clause, so a combine can put each item on its own line:

```
smooth-union(
  sphere r=0.55 at=(0,0.05,0) color=(0.85,0.45,0.3) shine=0.4 name=Body,
  capsule height=0.5 radius=0.12 at=(0.1,-0.3,0.55) rot=(0,0,60)
) k=0.35 name=Sculpture
```

`formatRecipe` / `printRecipe(spec, { pretty: true })` write this form (nested combines one
indent deeper); the one-line form and any spacing read back to the same scene. A new line that is
not indented still ends a clause, so a bracket left open while typing doesn't swallow the lines
under it.

### The Recipe tab

The tab shows the recipe as **rows**, one numbered row per clause, like an Expression Block's
lines: a combine's items each on their own indented line, its `k=` on the closing line; long
settings wrap with a hanging indent under the shape's name. Words are coloured in the code
editor's colours (light and dark): modes, shapes, combines, warps, settings, keys, numbers,
vectors, names and colours, with a small swatch before a colour (`color=(r,g,b)`, a hex, a colour
name). Click a row to change it (Enter keeps it, Shift+Enter adds a line, Esc leaves it; the
suggestions and the settings line work there too); a row that doesn't read stays open with its
mistake. Drag a row to move it (▲▼ on a touch screen); × deletes it; **+ Add a clause** adds one.
**Edit as text** switches to the whole recipe in a code editor (line numbers, the same colours,
mistakes underlined, a colour's swatch as a bar under it), remembered in this browser. **Copy**
copies the pretty form. The same colouring is in the Scene Group card's Recipe chip, in **Show
the words**, and in the Do… bar where a recipe shows (a 3D output's clause, "show the recipe").
Code: `src/sceneBuilder/highlight.ts` (tokens, clauses, the clause tree), `recipeRows.ts`,
`src/components/sceneBuilder/RecipeRows.tsx`, `RecipeCode.tsx`, `recipeColours.ts`.

**Help from the word.** Rest the pointer on a word (in the rows or the text) for a moment and its
help opens there: a mode, a shape, a setting (with its type, range and default) or a value (with
the setting's other choices, or other colours). Move into it to scroll it; click another word in
it (another mode, another choice, another colour) to put it in place of the one under the pointer.
While you type, the suggestions and the settings line appear at the word being typed. **Show the
words** opens the guide: Modes, Combine, Shapes, Warps, Settings, Camera, Colours and Output, each
with a short description; open one for its words, click a word for its help, an example to **Use**
and **Show me how** (a window that builds the example clause by clause, with a picture after each).
Code: `src/lang/help.ts` (sections, `helpAt`, the hover timing), `src/components/builders/WordHelp.tsx`,
`LanguageGuide.tsx`, `src/components/NodeGraph/ShowHowWindow.tsx`.

### Values

| Value | Written |
|---|---|
| number | `1`, `-0.5`, `.25`, `30deg`, `0.5rad` |
| vector | `(x,y,z)`. One number fills all three: `size=0.5` is `(0.5,0.5,0.5)` |
| colour | `#rrggbb`, `#rgb`, `(r,g,b)` in 0–1, or a name from the one colour table (`src/lang/colours.ts`): white black grey silver red orange yellow gold green lime teal cyan blue navy purple violet pink magenta brown cream sky night warm cool neon fire ice |
| name | a word, or `"in quotes"` |
| random | `random` (from the setting's interesting range), `random(0.2..2)`, `random(red, teal, gold)` |

**Randomness.** `sphere r=random` draws the radius from a range that looks good, not merely one
that is legal. A leading `random` draws every setting the line leaves unset:
`random sphere · box · twist`. `seed=42` anywhere in the recipe gives the same result every time;
without it the Recipe tab keeps one seed while you edit and **Roll again** draws a new one. The tab
lists what each random value became (`r=random → 0.43`) and **Keep these** writes them into the
recipe.

**Old words.** A few words changed meaning when the languages were joined. They still read, with a
hint and a **Use …** button that rewrites them: `glow` as a render mode (write `volumetric`;
`glow` is the glow step), the `noise` warp (write `warp`; `noise` is the 2D noise node), `show`
(write `output`), `group( )` (write `union( )`) and `both( )` (write `intersect( )`). Palettes
print as `palette=sunset`; `palette sunset` still reads. `@move(0,1,0)` takes the vector without
double brackets (`@move((0,1,0))` still reads).

### Shapes

`kind settings…` followed by any number of `@warp(…)`. Positional numbers fill
the settings in order: `torus 1 0.2` is `torus R=1 r=0.2`.

| Shape (aliases) | Settings (default) |
|---|---|
| sphere (ball, orb) | r 0.5 |
| box (cube, rounded-box) | size (0.5,0.5,0.5) half-size · round 0 |
| torus (donut, ring) | R 0.5 ring · r 0.2 tube |
| cone | angle 22.92° · h 1 |
| capped-cone (frustum) | h 0.5 · r1 0.4 · r2 0.1 |
| cylinder (pillar, column) | r 0.3 · h 0.5 half-height · round 0 |
| capsule (pill) | h 0.6 · r 0.2 |
| plane (floor, ground) | y −0.75 |
| octahedron (diamond) | s 0.5 |
| pyramid | h 0.8 |
| ellipsoid (egg) | size (0.6,0.3,0.4) |
| hex-prism, tri-prism | r 0.4 · h 0.2 |
| link (chain) | len 0.3 · R 0.25 · r 0.08 |
| box-frame (frame) | size (0.4,0.4,0.4) · t 0.05 |
| capped-torus (arc) | R 0.5 · r 0.1 · angle 68.75° |
| solid-angle (wedge) | r 0.6 · angle 57.3° |
| cross (plus) | s 0.3 |
| gyroid, schwarz-p | freq 3.5 · t 0.3 · ball 1.1 |

**Linked size.** Where a shape has several dimensions, `size` is them linked: `size=0.5` sets them
all, and `width=`, `height=` and `depth=` set one each (`box size=0.3 height=1`). A box, a box
frame and an ellipsoid: the three parts of their size; the vector form `size=(0.3,1,0.3)` still
reads. A cylinder, capsule, hex prism and tri prism: `size` is the radius and the height together,
`radius=` the radius (`width=` / `depth=` too), `height=` the height. Printed recipes write `size=`
when the dimensions are equal, else the ones that differ from the default by name: `cylinder
radius=0.22 height=1.6`. The cones and the pyramid write their height as `height=` too. The old
`r=` and `h=` still read, so older recipes parse as before.

Every shape also takes:

- `at=(x,y,z)`: where it is;
- `rot=(x,y,z)`: its rotation in degrees;
- `color=…`;
- `shine=0…1`;
- `glass`: made of glass, in Glass mode;
- `name=…`.

### Combines

`op(item, item, …)`, optionally followed by `k=…`, `name=…` and `@warps`:

| Op (aliases) | Means |
|---|---|
| union (add, combine, group) | the nearer surface wins |
| smooth-union (blend, merge, smooth) | melted together, k 0.3 unless given |
| subtract (cut, minus, difference) | every later item cut out of the first |
| smooth-subtract (smooth-cut) | a softened cut |
| intersect (intersection, both) | only where all overlap |
| smooth-intersect | a rounded overlap |

A plain op with `k` above 0 is the smooth one. Combines nest:
`subtract(box size=1, union(cross s=0.33, sphere r=1.3))`.

### Warps

On one item: `@kind(args)` right after the item, as in `box @twist(2)`; any
number of them, in order (the stack reads outside in). For the whole scene: a
clause, `kind args`, as in `twist 2`. Arguments are positional (in the order
below) or `key=value`. Inside an item's brackets, numbers joined by commas are
one vector: `@move(1, 0.5, 0)` is `by=(1,0.5,0)`, and that is how it prints.
`rotate` with an axis letter (`rotate y 30`, `@rotate(x 45)`) is the older
`turn`.

| Warp (aliases) | Arguments (default) |
|---|---|
| move (translate, offset) | by (0,0,0) |
| turn | axis x/y/z (y) · angle 0° |
| rotate (rotation) | by (0,0,0) degrees about X, then Y, then Z |
| scale (resize, grow) | s 1.5 (the factor) |
| repeat (tile, grid) | cell (2,2,2) |
| mirror-repeat (mirrored-repeat) | cell (2,2,2) |
| limited-repeat (repeat-n, array) | cell (1,1,1) · count (2,2,2) |
| mirror (symmetry) | axes, letters from xyz (xz) |
| fold (mirror-fold) | axes (xy) · offset (0,0,0) |
| polar-repeat (radial, around) | count 6 · axis=y |
| kaleido (kaleidoscope) | n 3 folds · sym=oct/tet/icos |
| twist | k 2 |
| bend (curve) | k 0.5 |
| sine (wave, sin) | amp 0.1 · freq 2 · axis=y (shifted) · from=x |
| warp (domain-warp; `noise` with a hint) | amt 0.3 · scale 1 · octaves 3 |
| displace (bumps, ripple) | amp 0.05 · freq 8 |
| round (inflate, soften) | r 0.05 |
| onion (shell, hollow) | t 0.03 (thickness) |

Nesting has no limit, and printing, parsing, Build and Describe round-trip any
depth: `subtract(intersect(smooth-union(sphere @move(0.3,0,0), box @rotate(30,0,45) @round(0.05)) k=0.2 @twist(1.5), cylinder @onion(0.04)) @mirror(xz), sphere r=0.3) @move(0,0.2,0)`
(the tests check this one and others, spec → recipe → spec → graph → spec).

### Modes and settings

| Clause | Settings |
|---|---|
| `surface` | (none: use sun, sky, shadows, ao) |
| `volumetric` | density 0.03 · falloff 10 · shell 0 · exposure 1.2 · tint |
| `glass` | ior 1.5 · dispersion 0.06 · tint |
| `gi` | bounce 0.4 · metal 0 · rough 0.5 · spec 0.5 |
| `sun` | dir=(0.6,0.7,0.4) · color |
| `sky` / `bounce` | a colour |
| `shadows` | hardness 16, or `off` |
| `ao` | step 0.06, or `off` |
| `fog` | density · color= (default: the background) |
| `background` (bg) | a colour, or `top=… bottom=…` for a gradient |
| `tone` | aces agx hable reinhard2 tanh oklab none |
| `camera` (cam) | dist 4 · angle 35 · elev 17 · orbit 0 (°/s) · zoom 1.5 · flatten 0 · x y z · `perspective` \| `orthographic` \| `reverse` (or `projection=`) · reverse 1 · converge 8 |
| `quality` | steps 96 · dist 20 · step auto (or a number) · jitter 1 |
| `output` (show) | picture depth distance height normal hit position steps ao shadow, then optionally `palette=…` |
| `colour by` (color by) | an output, then `palette=…` (default sunset): `colour by depth palette=sunset` |

### Errors

The parser never gives up on a whole recipe. Each mistake is reported with its
line and column and, where it can guess, a "did you mean":

- `sphre` → sphere;
- `colr` → color;
- an unclosed `(`;
- a setting a shape doesn't have.

The rest of the recipe still applies.

**Type checks.** A value of the wrong type is refused with its fix: `sphere r=(1,2,3)` → "r is a
number (a float); (1, 2, 3) is three numbers (a vec3). Take .x: r=1, or its brightness
(Luminance): r=1.86"; `shine=red` → "use its brightness (Luminance): shine=0.307".

**Type-ahead.** In the Recipe tab, suggestions appear as you type: at the start of a clause every
shape, combine, warp, mode, setting and output (each with a one-line description and its
signature, e.g. `sphere r=0.5 at=(x,y,z)`); after `@` the warps; inside a combine's brackets the
shapes; after a keyword its settings; after `color=` the colour names; after `palette` the
palettes. Below the box, the clause's signature with the setting being typed (or the next one to
fill) marked, and its hint. Matching: the name first (exact, then prefix), then an alias, a word
inside the name (`union` → smooth-union), letters in order, then a near typo ("circ" offers
cylinder).

### Examples

    scene: sphere · sphere at=(1,0,0) · output depth
    sphere · box at=(1,0,0) · colour by depth palette=sunset
    gi · torus · output normal

```
surface
smooth-union(sphere r=0.55 color=(0.85,0.45,0.3), sphere r=0.36 at=(0.55,0.5,0.1)) k=0.35
plane y=-0.6
background top=(0.45,0.6,0.85) bottom=(0.85,0.75,0.65)
camera dist=3.8 orbit=6
```

```
surface · union(cylinder radius=0.22 height=1.6, box width=0.36 height=0.06 depth=0.36 at=(0,1.55,0)) @repeat(2,100,2) · plane y=-1 · fog 0.9
```

```
glass ior=1.45 · sphere r=0.45 at=(-0.65,0,0) glass · box size=0.32 round=0.06 glass · plane y=-0.5 color=(0.3,0.25,0.35)
```

## Examples

The **3D: Scene Builder** examples folder has six scenes made in the builder:

- Glowing orb;
- Smooth-blob sculpture;
- Infinite pillars;
- Twisted torus;
- Glass objects;
- Menger-like fold.

Each one's recipe is in its description and in its Scene Group's note.
Right-click any node → Edit in Scene Builder to change it.

## Textures

Pictures through the shared picker ([scene-builder.md](scene-builder.md#textures)), plain colour
pictures (no PBR maps). In Surface mode; other modes keep the shapes' colours and say so.

- **On a shape** (its inspector's **Picture**): the picture colours the surface, read in the shape's
  **own space** (after its warps, move and turn: the Materials group hands each painted shape's point
  out), so it moves and turns with the shape, and **a Repeat warp repeats it forever**. Up to three
  painted shapes (one slot each).
  - **Wrap:** Triplanar (default: three projections blended by which way the surface faces; no
    stretching on any shape), Planar (along z), Spherical (a globe; a seam at the back), Face (once
    over the shape's front, keeping the picture's shape: a picture panel; **Make it a picture panel**
    sizes a box to the picture).
  - **Tiles** (repeats every 2 units; Face: a zoom), **Blend sharpness** (triplanar: 1 soft … 16
    crisp), **Slide across / up** (an offset, 1 is a whole picture), **Turn** (degrees). All live
    sliders on the built coordinates block.
  - **Bump** (bump from brightness): the lights read a normal tilted by how the pictures' brightness
    changes across the screen (Mikkelsen's surface gradient from screen derivatives: no extra reads
    of the picture, no tangents), so a plain photo gets some relief. Shadows and AO keep the shape's
    own normal. **depth** on the Bump block sets how deep.
  - **Good filtering.** Tiled maps read through Sample (texture) with Edges: Repeat (`textureGrad`
    from the unwrapped place): no seam where the picture repeats, no shimmer far away; pictures have
    mipmaps and anisotropic filtering.
- **Background** (Look › Background › Picture): the picture as the backdrop the camera looks at,
  through **Picture Environment** (from the depth work, [depth-node.md](depth-node.md)) on the
  camera's rays, Forward, Right and Up, its FOV the camera's Zoom.
- **Template: A picture, repeated forever.** A rounded cube painted triplanar, repeated in every
  direction by Repeat, with fog. Pick its picture under Pictures (or drop one on its Texture node).

Pictures in the builder's own pictures (the live viewport, the preset and Mode thumbnails, Surprise
me's check) are bound by `previewTextures.ts`: each sampler the shader reads gets the texture unit
its picture is uploaded on. Before 2026-10-11 the units were numbered by place in the list, so a
picture no shape reads (the template's, after another was picked: the GLSL compiler drops its
sampler) left the next one reading an empty unit, and the scene drew black; the thumbnails bound
no pictures at all (the "A picture, repeated forever" preset was black).

What Build makes: the Materials group gains **Picture slots** (which painted shape is nearest, x y z)
and each painted shape's point; per shape a coordinates block (Triplanar: three places and the
weights), its Sample (texture) nodes and a blend; **Surface pictures** paints them over the base
colour (and, with a bump, hands out **h**); **Bump from brightness** feeds Multi-Light and the
highlight.

### In a recipe

```
texture pond node=node_4 aspect=1.5
sphere r=0.6 texture=pond map=spherical tiles=2 tex-offset=(0.1,0.2) tex-rot=15 bump=0.5
box size=0.5 texture=pond sharp=8 @repeat(2)
background navy picture=pond
```

Shape keys: `texture=` (`tex=`, `picture=`), `map=triplanar|planar|spherical|face`, `tiles=`,
`sharp=`, `tex-offset=(x,y)`, `tex-rot=`, `bump=`. The recipe help (hover a word) has entries for
`texture`, these keys and `background picture=`.

## A picture with depth

The objects stand in a photo: they pass behind and in front of what is in it. **Light & colour → Picture with
depth** (Surface and GI lit; the march has to stop on surfaces to know what is nearer). It is "Add a picture with
depth" from the March Loop card ([depth-node.md](depth-node.md#add-a-picture-with-depth)), as plain choices:

- **Pick** the picture with the shared picker.
- **Generate depth** works its depth out now, on this device (Depth Anything V2 Small; the first time it offers the
  one-time 50 MB download, which the browser keeps). The result is kept as an image beside the picture, and Build puts
  it on the Depth node (Update: Baked): ready at once, and it goes into exported pages. Without it, the Depth node
  works the depth out live once the model is downloaded. Until there is a depth, the builder's preview uses the
  picture's brightness as a stand-in (the card says which it shows).
- **How:** **In the picture** (Depth Composite: the nearer one shows at each pixel), **…lit by the scene** (+ Depth
  Light: the scene's glowing shapes light the picture, its objects shadow it), **…lit, and reflected** (+ Picture
  Environment: the objects mirror the picture and take its colour).
- **Preview:** Result | Picture | Depth | Shaped depth in the viewport (Shaped depth is the picture's distance through
  Nearest and Farthest, near bright), with a heat-map toggle and a side-by-side strip ([depth-mix.md](depth-mix.md#seeing-the-depth)).
- **Nearest** / **Farthest** (where, in scene units, the picture's near and far things are) and **Edge softness**.
- **Face the picture** turns the camera to angle 0, height 0, no orbit: a photo is seen from the front.

What Build makes: the picture's Texture node → **Depth** → **Depth Composite** (the picture, its depth, and the lit
scene after fog, with the loop's Distance and Hit) → Tone Map. Lit adds **Only the picture** (1 − Scene in front) and
a **Depth Light** whose Glowing scene and Shadows from are the scene. Reflected adds a mirror direction, **Picture
Environment** and **Reflect the picture** before the composite. To make the Depth Light's point light follow a shape,
use **Link to scene object…** on its card after Build.

In a recipe: `depth-picture pond how=composite|lit|reflect near=1.5 far=8 soft=0.08`. The recipe doesn't carry a
generated depth (Edit this one keeps it, from the build's saved spec).

Code: `sceneBuilder/build.ts` (`emitDepthPicture3D`), `components/sceneBuilder/DepthPictureCard.tsx`; tests in
`src/sceneBuilder/__tests__/depthPicture.test.ts`.

## What Build makes, and what it leaves out

Build makes only what the scene uses: no Fog at density 0, no SDF Ambient Occlusion with AO off,
no Soft Shadow with shadows off, no Texture node for a picture nothing reads (the source stays in
the scene's Pictures), and nothing inside Materials that isn't handed out (the last shape's
"nearest so far", a lone painted shape's own distance). Turning one on later adds its node; a
rebuild keeps every other node's id (ids are kept by role), so wires and Play controls stay put.
A scene built before keeps working: reopening reads its spec, and a rebuild drops the nodes it no
longer makes. Not dropped: with another Output, the picture's lit nodes stay beside it, unwired,
so wiring Tone Map back shows the picture again.

## Limits

- **Per-shape colour and shine are a Surface-mode feature.** Each shape is
  measured again at the hit point, and Material Select picks the nearest one's
  colour, in a Materials group.
  - GI lit uses one colour (the first shape's).
  - Volumetric glow has one tint.
  - Glass colours what is behind the glass with one colour.
  The build says so when a scene has several colours in those modes.
- **Fog** is for Surface and GI. Volumetric and Glass leave it out, with a
  warning.
- **Glass Scene** draws its own sky, so the background setting doesn't apply.
- **Warps on the whole scene go in the Scene Group,** not the March Loop body,
  so shadows and AO see them too. A loop body's warps are still recognised when
  describing a graph.
- **Recognising hand-made graphs is structural.**
  - A distance node it doesn't know (an Expression Block, say) becomes
    `custom(…)`, and so does a warp it doesn't know.
  - Per-item transforms are read where they sit: Transform (3D), Translate 3D, Rotate 3D and
    Scale 3D on an item's point chain (a Scale 3D, or a Transform's Distance, after its distance is the
    scale's correction, paired with it), Offset (round), Onion and Displace 3D
    after its distance. A Displace goes back after the warp whose point it
    reads; Round and Onion, which don't depend on the point, go before the next
    modifier that has a place, else last. For a builder graph the order in its
    spec is kept.
  - Params driven by a wire are read at their slider value, and listed.
  - Colours are read from a single colour into Multi-Light, or from the loop's
    Albedo. Hand-made per-shape materials are not read.
- **The GI Lit March Group's ground colour** is the bounce colour × 4. It has
  no separate setting.
- **Rebuild can't merge structural edits** (rewired, deleted or added nodes).
  It offers a rebuild that drops them, or a new copy beside the old one.

## Code

| File | What |
|---|---|
| `src/sceneBuilder/spec.ts` | The spec, the shape and warp catalogues, step hints |
| `src/sceneBuilder/recipe.ts` | Recipe parser and printer (one line, multiline, pretty) |
| `src/sceneBuilder/highlight.ts`, `recipeRows.ts` | The recipe's coloured tokens, its clauses and rows, row edits |
| `src/sceneBuilder/build.ts` | Spec → nodes, with notes and roles |
| `src/sceneBuilder/recognize.ts` | Graph → spec (Describe) |
| `src/sceneBuilder/apply.ts` | Build into a graph; rebuild, keeping edits |
| `src/sceneBuilder/edit.ts` | Tree edits for the form: move, nest, wrap, gallery drops, modifier chips |
| `src/sceneBuilder/thumbnails.ts` | The gallery's tiles and its CPU thumbnail renderer |
| `src/sceneBuilder/templates.ts` | Templates, as recipes |
| `src/sceneBuilder/store.ts`, `actions.ts` | The window's state, and the glue to the node graph |
| `src/components/sceneBuilder/` | The window (`SceneBuilderModal.tsx`, on the studio shell), the viewport (`SceneViewport.tsx`), the sections (`sectionPanels.tsx`; the inspector, modifier chips and older tabs in `tabs.tsx`), scene tree, shape gallery, preset and mode pictures (`specThumbs.ts`) |
| `src/sceneBuilder/sections.ts` | The sections: words, Learn more, nav summaries |
| `src/sceneBuilder/viewMath.ts` | The viewport on the CPU: March Camera's maths, picking, gizmo drags, sizes |
| `src/sceneBuilder/paramMap.ts` | Recipe values → the node params they build (the Play menu) |
| `src/components/sceneBuilder/__tests__/studio.test.tsx` | The studio: sections, viewport drags, Play mapping, Surprise, reopen |
| `src/components/builders/BuilderWindow.tsx` | The shared builder shell |
| `src/store/sceneBuilderExamples.ts` | The examples folder |
| `src/sceneBuilder/__tests__/sceneBuilder.test.ts` | Tests |
| `src/sceneBuilder/__tests__/nestingModifiers.test.ts` | Deep nesting round trips, modifiers in build and Describe, the gallery, the tree's moves |
