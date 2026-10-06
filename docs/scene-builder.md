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
volumetric · smooth-union(sphere r=1, cone h=2 rot=(30,0,0)) k=0.3 · twist 0.5 · polar-repeat 6 · camera dist=4 orbit=10
```

## Opening it

- **Node browser, Builders (first section):** **3D Scene Builder** opens it on a
  new scene, on the desktop and on a phone. Searching "builder" or "scene" shows it too.
- **Node browser / add menu:** "New 3D scene…" in the 3D Scene category. Search
  "scene builder", "recipe" or "describe 3D" to find it.
- **Empty canvas:** right-click → **Builders** → **3D Scene Builder…** (at the top level).
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

The window has the Expression Block editor's layout:

- side panels that fold from the header (⌘[ the **Scene** tree, ⌘] the
  **Preview**), and become drawers on a narrow window;
- Undo and Redo for the form (⌘Z / ⌘⇧Z while it is open);
- **Done** in the footer.

Its shell, `src/components/builders/BuilderWindow.tsx`, is meant to be shared
by the other builders (Grid Rules, Agent Rules).

## The sections

**Scene tree (left panel).** The combine tree. Groups show their operator (∪
union, − subtract, ∩ intersect; ~ when smooth) and hold shapes and other groups.
Drag a row onto the top or bottom edge of another row to reorder it, or onto
the middle of a group to nest it inside. A small tag shows how many warps bend
an item.

**Shapes.** One card per shape, folded to a summary until you open it. Each
card has:

- name and shape type;
- the shape's own sizes;
- position;
- rotation, in degrees about X, then Y, then Z;
- colour and shine, its material;
- in Glass mode, whether it is made of glass.

The shapes are every 3D primitive the app has: sphere, box (round > 0 makes it
a Rounded Box), torus, cone, capped cone, cylinder (rounded with round > 0),
capsule, plane, octahedron, pyramid, ellipsoid, hex prism, tri prism, chain
link, box frame, capped torus, solid angle, cross, gyroid and Schwarz-P. A
gyroid or Schwarz-P fills all of space, so it is cut to a ball (Ball radius; 0
fills the scene).

**Combine.** Shows the tree as a formula, then one card per group:

- operator: union, smooth union, subtract, smooth subtract, intersect or
  smooth intersect;
- blend radius k, for the smooth operators;
- name;
- its items in order, with buttons to move them up, down or out of the group.

Subtract cuts every later item out of the first one.

**Bend space.** Pick what to bend: the whole scene, a group or a shape. Then
stack warps on it. Warps run top to bottom:

| Warp | What it does | Node |
|---|---|---|
| move | shifts what follows | Translate 3D |
| turn | turns what follows about one axis | Rotate 3D |
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
| noise | pushes space about with smooth noise | 3D Domain Warp |
| displace | bumps on the surface (changes the distance) | Displace 3D |

Each warp that stretches space shows a **Step Scale** hint. Such a warp makes
the scene's distances too large, so a full step can jump through a surface.
The hint is how much of each step it is safe to take (Hart's Lipschitz bound;
see the ray-marching guide, "Warps that stretch space"). With Step Scale on
**auto** (Quality), the loop uses the smallest hint any warp or shape asks for.
The Bend space tab lists who is asking.

**Look.**

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
- Flatten (0 perspective … 1 orthographic);
- Translate X / Y / Z, which move the camera and the point it looks at
  together.

It builds a March Camera:

- Translate becomes its Target;
- Flatten becomes its **Flatten** setting. This setting is new. A camera
  without it compiles exactly as before.

**Quality.**

- Steps;
- Max distance;
- Step scale: auto, or a fixed value;
- Jitter.

**Recipe.** The whole scene as text. Type or paste a recipe and the form
follows as you type, as long as the recipe reads cleanly. Mistakes are listed
with their line and column (click one to select it). **Apply what reads** uses
the clauses that are fine. While you aren't typing, the text follows the form.
**Show the words** lists the vocabulary.

**Templates.**

- Glowing orb (volumetric);
- Smooth-blob sculpture;
- Infinite pillars (repeat + fog);
- Twisted torus;
- Glass objects on a plane;
- Menger-like fold (crosses folded into a grid by Repeat and cut from a cube);
- GI-lit room.

Each template is a recipe, so reading one is a good way to learn the language.

**Describe.** See "Scene → words" below.

**Preview (right panel).** The graph Build will make, compiled and drawn live by
a small WebGL2 canvas of its own. It doesn't touch the main canvas. Below the
preview: build warnings, and the list of nodes it will make.

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

In the Scene Builder each tab (Shapes, Combine, Bend space, Look, Camera, Quality, Output,
Recipe, Templates, Describe) and the empty scene tree has its card; an example adds its recipe
clause to the scene (one undo step).

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

### Values

| Value | Written |
|---|---|
| number | `1`, `-0.5`, `.25`, `30deg`, `0.5rad` |
| vector | `(x,y,z)`. One number fills all three: `size=0.5` is `(0.5,0.5,0.5)` |
| colour | `#rrggbb`, `#rgb`, `(r,g,b)` in 0–1, or a name: white black grey silver red orange yellow gold green teal cyan blue navy purple violet pink magenta brown cream sky night |
| name | a word, or `"in quotes"` |

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

On one item: `@kind(args)` right after the item, as in `box @twist(2)`. For
the whole scene: a clause, `kind args`, as in `twist 2`. Arguments are
positional (in the order below) or `key=value`.

| Warp (aliases) | Arguments (default) |
|---|---|
| move (translate, offset) | by (0,0,0) |
| turn (rotate) | axis x/y/z (y) · angle 0° |
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
| noise (domain-warp, warp) | amt 0.3 · scale 1 · octaves 3 |
| displace (bumps, ripple) | amp 0.05 · freq 8 |

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
| `camera` (cam) | dist 4 · angle 35 · elev 17 · orbit 0 (°/s) · zoom 1.5 · flatten 0 · x y z |
| `quality` | steps 96 · dist 20 · step auto (or a number) · jitter 1 |
| `output` (show) | picture depth distance height normal hit position steps ao shadow, then optionally `palette …` |
| `colour by` (color by) | an output, then `palette …` (default sunset): `colour by depth palette sunset` |

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
    sphere · box at=(1,0,0) · colour by depth palette sunset
    gi · torus · output normal

```
surface
smooth-union(sphere r=0.55 color=(0.85,0.45,0.3), sphere r=0.36 at=(0.55,0.5,0.1)) k=0.35
plane y=-0.6
background top=(0.45,0.6,0.85) bottom=(0.85,0.75,0.65)
camera dist=3.8 orbit=6
```

```
surface · union(cylinder r=0.22 h=1.6, box size=(0.36,0.06,0.36) at=(0,1.55,0)) @repeat((2,100,2)) · plane y=-1 · fog 0.9
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
  - A distance node it doesn't know (an Expression Block, Scale 3D, Onion)
    becomes `custom(…)`, and so does a warp it doesn't know.
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
| `src/sceneBuilder/recipe.ts` | Recipe parser and printer |
| `src/sceneBuilder/build.ts` | Spec → nodes, with notes and roles |
| `src/sceneBuilder/recognize.ts` | Graph → spec (Describe) |
| `src/sceneBuilder/apply.ts` | Build into a graph; rebuild, keeping edits |
| `src/sceneBuilder/edit.ts` | Tree edits for the form |
| `src/sceneBuilder/templates.ts` | Templates, as recipes |
| `src/sceneBuilder/store.ts`, `actions.ts` | The window's state, and the glue to the node graph |
| `src/components/sceneBuilder/` | The window, its tabs, scene tree and live preview |
| `src/components/builders/BuilderWindow.tsx` | The shared builder shell |
| `src/store/sceneBuilderExamples.ts` | The examples folder |
| `src/sceneBuilder/__tests__/sceneBuilder.test.ts` | Tests |
