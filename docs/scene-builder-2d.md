# 2D Scene Builder

A builder for flat pictures, like the 3D Scene Builder: pick shapes, bend the space they live in, add motion and copies, set the look, and Build writes a real node graph (every node with a note). Open it from **Builders → Scene builder → 2D scene** in the Nodes sidebar ([scene-builder.md](scene-builder.md)), or the Do… bar's "new 2d scene". Right-click any node of a built scene → **Edit in 2D Scene Builder** to change it again; Rebuild keeps the settings you changed on its nodes.

## The window

The sections in the left nav run as a pipeline, top to bottom: **Space** (bend the coordinates) →
**Shapes** (choose them) → **Combine** (join them) → **Modify** (change their distance) → Depth →
**Effects** (shader effects on the finished picture) → **Look** (colour, grade, glow) → Output, then
Recipe and Templates.

- **Layers** (left): shapes and combine groups, painted top to bottom (the last is on top). Select one to edit it; move it earlier or later, delete it, join it with the next layer (∪ with next, − next, or **Combine…** for the rest) or ungroup.
- **Space**: transforms applied to the picture's coordinates before the shapes measure them, top to bottom. At the top, a big **space view** (a grid seen through the whole stack; it stays in view as the stack scrolls, and hovering a transform shows the space after it). Then the stack: **space blocks** (below), and the built-in transforms (zoom, rotate with spin, move, pixelate, tile, mirror tile, mirror, kaleidoscope, polar repeat, polar, swirl, noise warp, wave, fisheye, invert; folded under *Built-in transforms*), and functions (*Add a function*). Each shows a thumbnail of a grid or checkerboard through it.
- **Shapes**: a gallery of 17 shapes (circle, ring, box, rounded box, triangle, diamond, pentagon, hexagon, octagon, star, burst, hexagram, heart, cross, ellipse, moon, vesica), then **Pictures** (Picture in pieces, below) and function shapes. The selected layer's inspector has its size, **Style** ([below](#style)), colour and glow; **Place** (position, rotate, scale, round, outline only); **Motion** (orbit, bob, spin, pulse, with speed, amount, direction and phase); **Duplicate** (a ring of copies, rings of rings, and the whole ring repeated at bigger sizes).
- **Combine**: the layers as a tree of combines, and the seven ways to join shapes ([below](#combine)).
- **Modify**: operations on the selected shape's or combine's distance before it is drawn ([below](#modify)).
- **Depth**: a picture with depth the shapes interact with (below, [Picture with depth](#picture-with-depth)).
- **Look** ([builder-look.md](builder-look.md)): the scene's **palette** (the app's palettes as swatch strips, the palette library's saved ones, or one of your own made right there and saved to the library); the background and each layer can take a **palette slot** instead of a free colour, so changing the palette recolours them; colour by (each layer's colour, or length, angle, x, y, time or distance through the palette); glow on all shapes or only layers marked Glow; the **grade**, a stack of the app's colour-grading nodes in order; tone map, vignette, grain. Bloom and Scanlines are no longer offered (a scene made with them keeps them, under *older effects*): **Effects → Glow** and **CRT mask** replace them.
- **Effects** ([builder-look.md](builder-look.md#effects)): shader effects on the finished picture as stacked cards, dragged into order: Displace (by noise, or by a picture through the shared picker or a Shader Texture), Swirl, Ripple, Lens, Pixelate, Kaleidoscope, Blur, Glow, Chromatic aberration and CRT mask.
- **Output**: the picture, or a view of how it works: distance bands, the mask, or the space as a checkerboard.
- **Recipe**: the whole scene as one line of the Playfield language, e.g. `kaleidoscope 8 · ring r=0.3 th=0.02 color=cyan @orbit(0.12 speed=0.12) · glow 0.008 · tone aces`. Edit and Apply, or paste one.
- **Templates**: starting points (two with a picture with depth).
- **Surprise me** (header): a whole random scene from a seed (see below). The seed shows beside it; type one and press Enter to make that scene again.
- **Preview** (right): the graph Build makes, compiled and drawn live.

## Style

How a layer is drawn, per layer (Shapes → **Style**; `style=` in a recipe):

- **Glow** (the default for every new shape): the shape as its distance field reads, its colour
  running out into a soft glow, colour × (amount ÷ (distance outside + amount)) ^ falloff. That is
  its own colour inside and at the edge and fades out from there, so the shape and its glow are one
  shape, with **no flat fill pasted over it**. It is the Grid builder's **Soft** glow
  ([grid-builder.md](grid-builder.md)), so the two builders look alike. Built as one Expression Block,
  *Glow shape*, with Amount and Falloff as live sliders (the Look's Glow sets them). A layer that
  doesn't glow (Look → Glow off, or Only layers marked Glow and it isn't) is the crisp shape alone
  (one SDF Fill). Once the Look's glow has been muted, the glow node passes a crisp fill through
  while muted, live.
- **Filled**: a flat filled shape (SDF Fill) with the Look's glow as a halo round it (Glow Layer,
  amount ÷ |distance|): the look every scene had before styles. Picture layers start Filled.
- **Outline**: a glowing line along the edge, the glow of abs(distance) (*Glow outline*). The Look's
  glow tint colours it.

Scenes made before styles have no `style` on their layers: they build exactly as before, as Filled.
Reopened (Edit in 2D Scene Builder), the style is written out as Filled, and their recipe says
`style=filled`, so the look stays whatever the default is. A nested item's style isn't used: the
layer it is in draws it.

## Glow types

How a distance becomes glow (Look → Glow → **Type**, or one layer's own under Shapes → **Glow
type**). The same formulas are the **Glow Layer** node's **Type** (`combiners.ts`,
`GLOW_TYPES` / `glowFormula`), so the node and the builder share them. i is the amount, p the
falloff, x = distance outside ÷ i:

| Type | Formula | Looks like |
| --- | --- | --- |
| Halo (inverse distance) | (i ÷ \|d\|)^p | a bright rim, slow tail (the classic glow, what Filled layers always had) |
| Soft | (1 ÷ (1 + x))^p | the colour inside running out into its glow: one shape (Glow style's default) |
| Exponential | exp(−0.35 · x · p) | an even glow with no long tail |
| Gaussian | exp(−(x ÷ 4)² · p) | a broad flat-topped bloom that ends cleanly |
| Neon | 0.6 · soft + 1.2 · exp(−\|d\| ÷ 0.35i) | a bright core line on the edge plus a halo |
| Rim (edge only) | (1 ÷ (1 + \|d\| ÷ i))^p | only the edge, inside and out |
| Inverse square | (1 ÷ (1 + x²))^p | lamp-like, bright near and soon gone |

With no type chosen, Glow-style layers use Soft and Filled layers' halo uses Halo, exactly as
before types. Amount and falloff are live sliders on the built node (Glow style: the *Glow shape*
Expression Block; Filled: the Glow Layer); changing the type rebuilds. Recipe: `glow type=neon`,
and on a layer `glow-type=gauss`.

## Modify

Operations on a shape's (or a combine's) **distance** d, negative inside and positive outside,
which change how it looks before it is drawn. Pick a layer, then add cards; they apply top to
bottom (numbered), after the item's place, motion, copies and combine. Each is an **Expression
Block** (d in, d out) whose numbers are sliders: live, and wireable on the node. ⊘ mutes one (live),
arrows reorder, Alt-click solos.

| Card | What it does | Recipe |
| --- | --- | --- |
| Ring (onion) | abs(d) − width: a disc into a ring; Count repeats it, ring inside ring | `@onion(0.02 count=3)` |
| Invert | −d: inside and outside swap | `@negate` |
| Ripples | d + amount · sin(d · freq − t · speed): rings near the edge, travelling | `@ripples(40 speed=2 amount=0.06)` |
| Grow / shrink | d − r: the edge moves out (rounding) or in | `@grow(0.03)` |
| Repeat rings | the distance repeated every Period: contour rings all the way out | `@bands(0.12 width=0.01)` |
| Displace | d pushed by smooth noise at the point (Scale, Speed) | `@displace(0.05 scale=4 speed=0.3)` |
| Fold (abs) | abs(d) | `@abs` |
| f(d) | your own line, d = …, checked as you type like a space block: d, x, y, uv, t, PI, TAU and its sliders | `@fd("d - amp * sin(d * 40.0)" amp=0.05)` |

A line that doesn't check is left out of the build with a warning. Code: `src/sceneBuilder2d/modify.ts`;
tests: `src/sceneBuilder2d/__tests__/modifyGlow.test.ts`.

## Expression lines

Every expression line in the builders (a space block's lines, Modify's f(d), the Grid builder's
math-path x and y) is the Expression Block's own line editor (`components/builders/ExprLineInput`
over `code/CodeField`'s CodeInput): the shared GLSL highlighter and colours, the same autocomplete
(the line's names and the GLSL reference), bracket marks, hover help naming the functions it calls
with what they do, the checker's error drawn on the field's edge, and on a space block, Make a slider
from the number under the caret. The target and operator selects stay as they were.

## Combine

The **Combine** tab joins shapes into one distance field, like the 3D builder's Combine
([scene-builder-3d.md](scene-builder-3d.md)):

- **The tree**: every layer, a combine shown as a badge (∪ union, − subtract, ∩ intersect, ⊕ xor,
  with its smooth amount) over the items inside it, indented. Click a row to pick it.
- **Join with the next layer**: seven picture buttons (hover each for what it does): Union, Smooth
  union, Subtract, Smooth subtract, Intersect, Smooth intersect, Xor. The picked item and the one
  after it become a combine. **› Into the combine above** and **‹ Out of its combine** move items
  in and out.
- **A combine**: its operator (the same seven buttons), **Smooth** (the blend radius k: 0 is the
  hard combine, above 0 the smooth one; Xor has none) and **Colour**: *Blend the shapes' colours*
  (new combines) or one colour for the group (combines from before). **Ungroup** takes it apart.
  The Shapes inspector shows the same controls for a selected combine, and a colour for each shape
  inside a blending one.

Each shape's place, motion, ring of copies and Round / Outline apply first; the combine then joins
the distances. What Build makes: the **Union**, **Subtract** and **Intersect** nodes (each takes a
Blend radius, k, as a param: a live uniform, so dragging Smooth never recompiles; their Blend
output is the 0–1 weight), and for Xor an Expression Block, max(min(a, b), −max(a, b)), with a
blend output. A combine that blends colours gets one *Combine colour* Expression Block per join,
mix(b, a, w) with w the join's Blend: the colours run into each other across a smooth join as the
shapes do. Subtract keeps the first shape's colour (a cut takes nothing of the cutter's). Rings at
several sizes are joined the same way.

In a recipe: `union( )`, `smooth-union( )`, `subtract( )`, `smooth-subtract( )`, `intersect( )`,
`smooth-intersect( )`, `xor( )`, then `k=` (the smooth amount, 0.1 unless given) and `mix` (blend
the shapes' colours):

```
smooth-union(circle r=0.3 at=(-0.15,0) color=coral, circle r=0.3 at=(0.15,0) color=sky) k=0.15 mix
xor(box size=0.3, circle r=0.25 at=(0.2,0)) style=outline
```

## Space blocks

A **block** is up to three lines in Expression Block style, each changing the point every shape
below looks from:

```
uv.x += amp * sin(y * freq + t * speed)
uv.y *= 1 + 0.2 * x
uv   = abs(uv) - offset
```

- **Targets:** `uv.x`, `uv.y` or `uv` (pick per line; `x` and `y` are read as `uv.x`, `uv.y` when typed as a target).
- **Operators:** `=`, `+=`, `-=`, `*=`. A line left empty leaves uv as it is; up to three lines.
- **Variables everywhere:** `x` and `y` (the point as it is now, after the lines above), `uv`
  (both), `t` (time in seconds), `PI`, `TAU`, and the block's sliders by name. So Graphtoy-style
  expressions work: `uv.x += sin(x + t) * y`. Whole numbers are fine (`sin(y * 4)`): they are
  written as floats for GLSL.
- **Checked as you type**, the way the GPU will (glslPatterns' strict type check): an unknown name
  ("“ampp” isn't known… Did you mean “amp”?"), an unknown function ("sinn() isn't a function GLSL
  knows. Did you mean sin()?"), a vec2 into `uv.x`, `uv = length(uv)` (one number into two),
  `%`, textures. A block that doesn't check is left out of the build with a warning.
- **Sliders:** library blocks come with theirs; on any block put the caret on a number and **Make
  a slider** (named from where it sits, as in the Expression Block), or type a name under
  *Add slider*. Typing past a slider's end extends it.
- **Run ×** (1–8) runs the lines that many times over: a fold becomes a fractal.
- **Chain:** blocks stack top to bottom, each one's uv feeding the next (↓ uv between cards).
- **Combine** (the link button on a block): two blocks, A and B, both run on the same uv and are
  joined: **Add** (`a + b − uv`, both pushes), **Subtract** (`uv + a − b`), **Multiply** (`a * b`,
  part by part: a copy of uv multiplied back into uv), **Blend** (`mix(a, b, amount)`). Each side
  is a full block (pick it *From library*). **Split** undoes it into A then B in a chain.

### The library

37 blocks in eight categories, each with a name, a line on what it does, a thumbnail of a grid
warped by it, and its numbers as sliders (search, filter by category, or **Random**, which offers
three blocks from three categories to pick from, sliders set somewhere sensible; *Three more* deals again):

| Category | Blocks |
|---|---|
| Trigonometric | Sine shift, Sine weave, Cross sines, Sine fold, Tangent tear |
| Exponential & log | Log-polar, Exponential bulge, Power pinch, Log spiral, Soft squash |
| Ripples & waves | Ripple rings, Water wobble, Standing waves, Shock ring, Two sources |
| Twists & polar | Twirl, Spiral, Spinning rings, Vortex, To polar |
| Mirrors & kaleidoscopes | Mirror, Mirror both, Kaleidoscope, Eight-fold, Wavy mirror |
| Fractal & recursive | Kali fold, Fold & turn (IFS), Tiles in tiles, Inversion repeats |
| Noise warps | Noise push, Noise swirl, Warp of a warp, Flow |
| Tiles & cells | Tile, Brick rows, Pixel steps, Terraces |

Where they come from: an audit of the 153 vec2 → vec2 moves the Expression Builder mined from the
examples (`src/exprBuilder/prebuilt/moves.json`) and the GLSL corpus. By use, the common ones are
offsets and scales, `floor` cells, `abs` folds, `fract` repeats (`fract(x * c) − 0.5`), sines of the
point and of the swapped point (`x + a·sin(x.yx·b + t)`), inversion (`x / max(dot(x, x), ε)`),
rotations (`rot2D`, by time or by distance), brick offsets (`step(1, mod(floor(y·n), 2))`) and
travelling waves (`vec2(sin(y·9 + t), cos(x·9 − t))`). The library writes those families as
blocks and fills in the classics the corpus only hints at (log-polar, kaleidoscope folds, Kali and
IFS folds, iq's warp of a warp).

### My blocks (saving your own)

**Save block…** (under Run × on any block, written by hand or changed from the library) saves it
to the library: a **name**, an optional line on **what it does**, a **category** (My blocks, or one
of the library's eight) and **Random may offer it** (off unless you tick it). It keeps the lines,
the sliders (names, values, ranges) and Run ×, and draws the same **warped-grid thumbnail** the
library draws for its own blocks (the same renderer, `renderWarpThumbnail`, stored as a 64 px
PNG). On a combine, **Save combine…** saves the whole thing: both blocks and how they join.

- The block in the scene links back to it (`From your “Wobble rings”`) and the button becomes
  **Save changes…**: saving under a name you already have replaces that block, which is how a
  saved block is edited.
- **In the library** a **My blocks** section comes first (and a *My blocks* tab shows only yours),
  each with its thumbnail, what it does and its sliders. Search covers them. A block saved into a
  library category also shows under that category's tab. Picking one adds it like a library block
  (a saved combine adds a combine).
- On each saved tile: **Rename**, **Duplicate**, **Copy** (a small JSON text to paste on another
  machine), **Export** (a `.spaceblock.json` file) and **Delete** (scenes that used it keep their
  own copy of its lines). **Import…** takes the copied text or a file; the thumbnail is redrawn and
  a taken name gets a number.
- **Stored** like rack presets: one list in localStorage, `shader-studio:space-blocks`
  (`src/sceneBuilder2d/savedBlocks.ts`). It goes into backups, library downloads and profile ZIPs
  (*space blocks.json*), the workspace folder (`presets/space blocks/*.spaceblock.json`), and the
  Files page shows them under Presets → *Space blocks (2D Scene Builder)* with their pictures.
- Not built: a second thumbnail of the current scene through the block.

### What Build makes

Each block is one **Expression Block**: a `uv` input wired from the stack above, a float slider
input per number (live uniforms, so dragging never recompiles), the lines (written out Run × times),
and `uv` returned. Its note says what the block does, that `x`/`y` were written as `uv.x`/`uv.y`,
and which sliders are live. A combine is three Expression Blocks: A and B (both wired from the same
uv) and the join (`a`, `b`, `uv` in; Amount a slider for Blend).

### In a recipe

```
space-block ripple-rings amp=0.05
space-block {uv.x += amp * sin(y * 8 + t); uv *= 1.2} amp=0.1 times=2 name="My wobble"
combine-blocks multiply a=kaleidoscope b={uv = abs(uv)} a_count=8
```

A library name prints only the sliders that differ from the entry; written lines print in `{ }`
with every slider. `combine-blocks` takes `add|subtract|multiply|blend`, `a=` and `b=` (a name or
lines), `amount=`, and `a_…` / `b_…` for each side's sliders and `times`.

One of **your saved blocks** prints with its name *and* its lines, so the recipe still works in a
project (or on a machine) that doesn't have it:

```
space-block my="Wobble rings" {uv.x += amp * sin(y * freq + t)} amp=0.15 freq=9
space-block my="Wobble rings" amp=0.3
combine-blocks multiply my=Pair a={…} b={…}
```

With lines in `{ }` the lines are used and the block keeps its link; `my=` alone looks the block up
in My blocks (its sliders by name, as for a library block) and says so, with a suggestion, when it
isn't there. `combine-blocks my=…` alone does the same for a saved combine.

### Later

- **Draw on UV space:** paint strokes on the space view that push the grid (a displacement map
  drawn by hand) and save as a block. Not built yet.

### Code and tests

`src/sceneBuilder2d/blocks.ts` (lines, checking, GLSL, the CPU map), `blockLibrary.ts` (the
library, Random), `build.ts` (the Expression Blocks), `recipe.ts` (`space-block`, `combine-blocks`),
`thumbnails.ts` (`renderWarpThumbnail`, `stackMap`), `components/sceneBuilder2d/SpaceBlocks.tsx`.
Tests: `src/sceneBuilder2d/__tests__/blocks.test.ts` (reading lines and operators, checking,
every library entry checks, runs, draws and compiles, chaining, the four combines, Random's three,
recipes) and `src/components/sceneBuilder2d/__tests__/spaceBlocks.test.tsx` (the library, Random,
errors as you type, Make a slider, three lines at most).

## Muting

Any card can be switched off for a while ([scene-builder.md](scene-builder.md#muting) has the
shared rules: ⊘ on the card, Alt-click solos, one undo step, saved with the scene):

| What | How it is muted |
| --- | --- |
| A space transform, block or combine (Space tab) | Live: its node passes the uv it was given straight through. In the example, Mirror both muted shows the picture before the fold. The tab's grid preview skips it too. |
| Size by depth, Space by depth (Depth tab) | Their ⊘ is their on/off: muted, the shapes don't read depth (one rebuild). |
| A layer or a shape in a combine (the layer list's ⊘, or its card) | Live: its distance is pushed far away (so unions, cuts and glows ignore it) and, for a layer, the picture behind passes through. |
| A motion (Shapes → Motion) | Left out of the build. |
| A ring of copies (Duplicate) | Left out: one copy. |
| The grid of an older scene (Shapes → Grid) | Live: the picture under the grid passes through. |
| Glow, tone map, bloom, vignette, grain, scanlines (Look) | Live: each effect's node passes its colour through. |
| The picture in pieces | Live: the picture under it passes through. |
| A Grade card (Look) or an Effects card | Left out of the build (the card's existing off flag, now the ⊘ with Alt-click solo; `muted` in a recipe reads as `off`). |

Recipe: `mirror xy muted`, `circle r=0.3 muted`, `@orbit(0.3 muted)`, `@ring(6 r=0.5 muted)`,
`grid 12 muted`, `glow muted`, `tone aces muted`, `bloom 0.6 muted`. Tests:
`src/sceneBuilder2d/__tests__/mute.test.ts`.

## Textures

Pictures through the shared picker ([scene-builder.md](scene-builder.md#textures)). The scene keeps
its pictures by name; each use reads its node.

- **Fill** (a layer's **Picture** card): the layer is painted with the picture instead of its colour,
  read at the layer's **own point**, after its place, motion and ring of copies, so the picture moves,
  turns and repeats with it, and bends with every space transform above. **Fit**: Fill (cover), Fit
  (contain: the layer's colour shows round it), Stretch, or Tile (with **Tiles**, repeating up the
  shape, seamless). **Zoom** for the others. Its alpha lets the layer's colour through.
- **Picture layer** (Shapes → **Picture**): a box the picture's shape (Half height), filled with it.
- **Background picture** (Look): the picture behind every layer, over the background colour. **Bent
  by the space** (on by default) reads it at the warped point, so **warping a picture is adding a
  block**: every built-in transform, every library block, written blocks and the four combines bend it.
  Off reads the screen.
- **Mask** (the Picture card): the layer and its glow only where a picture over the whole frame is
  bright (**Cut**, live), or dark (**Invert**).
- **Grid picture** (older scenes' grids): the grid's shapes carry a picture, cut up into them, in one
  of the Grid builder's modes ([grid-builder.md](grid-builder.md#pictures-in-pieces)): **In each
  shape** (the whole picture in every shape), **Mask** (the picture over the whole frame, read at the
  screen's point: the shapes are windows onto it), **Matte: colour** (each shape the picture's colour
  at its cell's centre) or **Matte: piece** (each shape its own piece from round its cell, turned,
  pushed and grown with it by the ripple; at rest the pieces make up the picture). The Grid block
  writes `place`, where to read it; a Picture fit and a Sample read it and paint it over the shapes.

What Build makes: per use a **Picture fit** Expression Block (q, the point; k, Tiles or Zoom, live;
the fit's lines; `inside` out), a **Sample (texture)** wired from the picture's node (Edges: Repeat
for Tile), and a block that paints or masks with it. Every node has a note.

### In a recipe

```
texture pond node=node_4 aspect=1.5
swirl 2
circle r=0.4 fill=pond fit=tile tiles=3 mask=pond mask-cut=0.3 mask-invert
picture pond h=0.3 at=(0.5,0) fit=contain zoom=1.2
background navy picture=pond fit=stretch still
grid 16 12 picture=pond picture-mode=piece
```

- `texture name [node=] [aspect=] [kind=image|shader]` declares a picture (printed first). A name
  used but never declared becomes one.
- On any layer: `fill=`, `fit=cover|contain|stretch|tile` (`fill` and `fit` read as cover and
  contain too), `tiles=` (Tile) or `zoom=`; `mask=`, `mask-cut=`, `mask-invert`.
- `picture name` is a picture layer; `background … picture= fit= tiles= [still]`.
- On the grid: `picture=` and `picture-mode=cell|mask|matte|piece` (piece when left out).

## Picture with depth

The **Depth** tab: a picture with depth the shapes interact with ([depth-mix.md](depth-mix.md)).

- **Picture with depth:** pick it with the shared picker; **Fit** (Fill, Fit, Stretch) says how it covers the frame.
- **Generate depth** works its depth out now, on this device, as the Texture card's Generate depth does (Depth
  Anything V2 Small; the first time it offers the one-time 50 MB download, which the browser keeps). The result is
  kept as an image beside the picture and Build puts it on the Depth node (Update: Baked). Without it, the built
  Depth node works the depth out live. The preview shows the generated depth, or the depth a Depth node on the canvas
  already has for the picture, or else the picture's brightness as a stand-in (the tab says which).
- **Preview:** Result | Picture | Depth | Shaped depth (plus Gradient, Size and Space when they are on), a heat-map
  toggle and a side-by-side strip: what the depth effects work from, in the Preview ([depth-mix.md](depth-mix.md#seeing-the-depth)).
- **Size by depth** (every layer grows on near things: *Size far*, *Size near*) and **Space by depth** (the point
  every shape is measured from moves by depth: *Move by* Shift, Zoom or Turn, *Amount*, *Direction*, *Focus*): two
  cards, each switched on and off by the shared ⊘ mute like every other card (off keeps the settings). Either, both
  or neither.
- **With the picture:** the look. **On top** (the scene over the picture: *Scene over it* Add, Screen, Over or Tint),
  **Occlude** (*Scene sits at*, *Softness*), **Fog** (*Density*, *Haze*, *Fog colour*), **Mix** (*Near shows*,
  *Amount*), **Light** (*Strength*, *Own light*, *Glow*). **Picture** is how bright the picture shows.
- **Depth range:** *Far end*, *Near end* and *Curve*: which part of the depth counts.
- **Gradient over depth:** a palette along depth (*On* the scene, the picture or both; *How*; *Amount*, *Cycles*,
  *Phase*, and *Flow*, which moves it through depth over time).

What Build makes: a **Picture fit** and **Sample (texture)** (the picture over the frame), a **Depth** node reading
the picture's node at the same place (so depth and colour line up), a **Depth Mix for the shapes** when size or space
is on (its *Scale* into each top-level layer's Transform *Grow*, times a pulse when it has one; its *Depth UV* as the
point the layers and the grid are measured from), and a **Depth Mix** after the layers and the grid that puts the
scene and the picture together (its Scene mask from the layers' union with *Over*; *Time × Flow* into its Phase).
Every setting is a live slider on those nodes; every node has a note.

Size by depth grows top-level layers; a grid keeps its own sizes (space by depth moves it).

### In a recipe

```
depth-picture pond size=(0.4,1.6) look=occlude at=0.5
depth-picture pond space=shift shift=0.6 dir=90 focus=0.3 gradient=sunset cycles=1.5 flow=0.05
```

`depth-picture name` then: `fit=cover|contain|stretch`, `size` or `size=(far,near)`, `space=shift|zoom|turn`,
`shift=`, `dir=`, `focus=`, `look=top|occlude|fog|mix|light`, `with=add|screen|over|tint`, `picture=`,
`range=(far,near)`, `curve=`, `at=`, `soft=`, `fog=`, `haze=`, `fog-color=`, `light=`, `own=`, `glow=`,
`near=picture|scene`, `mix=`, `gradient=<palette>|off`, `gradient-on=scene|picture|both`,
`gradient-how=multiply|colorize|add`, `gradient-amount=`, `cycles=`, `phase=`, `flow=`. The palettes are the Palette
node's: blue-teal, rainbow, warm, lemon, sunset, fire, forest, purple-haze, deep-purple, psychedelic. A recipe
doesn't carry a generated depth; Apply on the Recipe tab keeps it for the same picture.

## Grids are in the Grid builder

The 2D builder no longer makes grids: grids are built in the **Grid builder** (Scene builder → Grid,
[grid-builder.md](grid-builder.md)). There is no Grid tab, the grid templates are gone from
Templates, and Surprise me never makes one. **Picture in pieces** (a Pieces node, not a grid) moved
to Shapes → **Pictures**.

A scene made with a grid still loads and builds exactly as before. On reopening, Shapes shows a card,
*Grid (from an older scene)*: "This scene has a grid: edit it in the Grid builder". The Grid builder
draws its grids cell by cell, so this one can't be carried over: it stays in the scene read-only,
with its mute and Remove, and **Open the Grid builder** starts a new grid there. The recipe keeps
reading and printing `grid …` clauses. The two grid templates live on as `GRID_TEMPLATES_2D` (and as
their examples) for older scenes and tests.

## Surprise me

The header's **Surprise me** makes a good-looking random scene from a seed, as one undo step
(the toast offers Reroll and Undo). The same seed always gives the same scene
(`src/sceneBuilder2d/surprise.ts`, `surpriseScene2D(seed)`, pure):

- **Space:** one or two library blocks, or now and then a combine of two (add, blend, multiply),
  their sliders varied the way Random varies them. A stack that sends points to NaN or flings the
  grid far away is dealt again. Tangent tear and Pixel steps are left out (they look broken more
  often than good at random).
- **Shapes:** one to three glowing shapes (Glow style) (rings, stars, bursts, hexagons, outlines…) in colours
  from one harmonious palette; later ones as a ring of copies (sometimes rings of rings or several
  sizes); motion (orbit, bob, spin, pulse) on most.
- **Look:** glow on all, a dark ground near the palette's hue, ACES tone mapping (AgX lifted the
  dark ground to grey in every trial), sometimes colour by length, angle or distance through a
  palette, a little vignette; now and then the shapes take a library palette's slots, a same-frame
  Glow, a touch of grade (saturation, levels) and, rarely, one tasteful effect (a little chromatic
  aberration, a CRT mask).

Tests (`src/sceneBuilder2d/__tests__/surprise.test.ts`): seeded, 30 seeds build with no warnings,
compile and read back from their recipe, most use blocks, one undo step with the seed remembered.

## In the Scene builder

The 2D Scene Builder is the Scene builder's **2D scene** ([scene-builder.md](scene-builder.md)). It
stays self-contained: its data, recipe, graph, blocks, library and surprise are in
`src/sceneBuilder2d/` (pure, no React), its window and pieces in `src/components/sceneBuilder2d/`
(`SceneBuilder2DModal`, `SpaceBlocks`, `Preview2D`), and its state in its own store
(`useSceneBuilder2D`). The kind page calls `openWith(scene)` on a new scene, or on a build's saved
spec for **Edit this one**. Its header reads **Scene builder › 2D scene** (back to the kinds). The
main preview is held while it is open; its own preview draws every frame at the screen's density and
follows a slider while it moves (uniforms only when the shader stays the same). Its sliders reset on
double-click (to the shape's, block's, look's or grid's default), are bipolar on a ±N range, and
widen when you type past the end.

## Examples

**2D: Scene Builder** folder: Kaleidoscope of glowing rings, Orbiting shapes, A ring of rings, and two pictures with
depth on the "ridges at dusk" still: Circles sized by depth, Glow beaming through depth ([depth-mix.md](depth-mix.md#examples)).

## Functions

GLSL functions as building blocks, each built as a **Custom Function** node that carries the function (and any helpers it calls) and calls it:

- **Space → Add a function**: a function that bends space, `vec2 f(vec2 p[, float t])`, applied like any space transform.
- **Shapes → Function shapes**: a function that measures a shape, `float f(vec2 p[, float t])`: negative inside, positive outside.

Built in: twirl, complexSquare, circleInvert, sineWarp, brickOffset, breathe (space); flower, spiralLine, superellipse, wobblyBlob, twoBlobs (shapes). **Find more in your code and the examples** looks through your saved GLSL shaders and presets, the Convert examples, and the Custom Function nodes and Expression Blocks in this graph, your saved graphs and the examples. An Expression Block counts when it has one vec2 input, float inputs that are sliders (their values are written in) or one time input, and a vec2 or float result. In a recipe: `fn twirl`, `fn-shape flower color=pink` (built-ins only; functions from your code are kept in the scene but picked in the builder).

## Do… bar

`new 2d scene`, `2d scene builder`, `open the 2d scene builder` open the builder on a new scene.
