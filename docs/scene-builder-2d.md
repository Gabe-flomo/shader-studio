# 2D Scene Builder

A builder for flat pictures, like the 3D Scene Builder: pick shapes, bend the space they live in, add motion and copies, set the look, and Build writes a real node graph (every node with a note). Open it from **Builders → Scene builder → 2D scene** in the Nodes sidebar ([scene-builder.md](scene-builder.md)), or the Do… bar's "new 2d scene". Right-click any node of a built scene → **Edit in 2D Scene Builder** to change it again; Rebuild keeps the settings you changed on its nodes.

## The window

- **Layers** (left): shapes and combine groups, painted top to bottom (the last is on top). Select one to edit it; move it earlier or later, delete it, join it with the next layer (∪ with next, − next) or ungroup.
- **Space**: transforms applied to the picture's coordinates before the shapes measure them, top to bottom. At the top, a big **space view** (a grid seen through the whole stack; it stays in view as the stack scrolls, and hovering a transform shows the space after it). Then the stack: **space blocks** (below), and the built-in transforms (zoom, rotate with spin, move, pixelate, tile, mirror tile, mirror, kaleidoscope, polar repeat, polar, swirl, noise warp, wave, fisheye, invert; folded under *Built-in transforms*), and functions (*Add a function*). Each shows a thumbnail of a grid or checkerboard through it.
- **Shapes**: a gallery of 17 shapes (circle, ring, box, rounded box, triangle, diamond, pentagon, hexagon, octagon, star, burst, hexagram, heart, cross, ellipse, moon, vesica). The selected layer's inspector has its size, colour and glow; **Place** (position, rotate, scale, round, outline only); **Motion** (orbit, bob, spin, pulse, with speed, amount, direction and phase); **Duplicate** (a ring of copies, rings of rings, and the whole ring repeated at bigger sizes).
- **Depth**: a picture with depth the shapes interact with (below, [Picture with depth](#picture-with-depth)).
- **Look**: background, colour by (each layer's colour, or length, angle, x, y, time or distance through a palette), glow on all shapes or only layers marked Glow, tone map, bloom, vignette, grain, scanlines.
- **Output**: the picture, or a view of how it works: distance bands, the mask, or the space as a checkerboard.
- **Recipe**: the whole scene as one line of the Playfield language, e.g. `kaleidoscope 8 · ring r=0.3 th=0.02 color=cyan @orbit(0.12 speed=0.12) · glow 0.008 · tone aces`. Edit and Apply, or paste one.
- **Templates**: starting points (two with a picture with depth).
- **Surprise me** (header): a whole random scene from a seed (see below). The seed shows beside it; type one and press Enter to make that scene again.
- **Preview** (right): the graph Build makes, compiled and drawn live.

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
- **Grid picture** (Grid → **Picture**): the grid's shapes carry a picture, cut up into them, in one
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
- **Shapes and depth:** **Size by depth** (every layer grows on near things: *Size far*, *Size near*) and **Space by
  depth** (the point every shape is measured from moves by depth: *Move by* Shift, Zoom or Turn, *Amount*,
  *Direction*, *Focus*). Either, both or neither.
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

## Surprise me

The header's **Surprise me** makes a good-looking random scene from a seed, as one undo step
(the toast offers Reroll and Undo). The same seed always gives the same scene
(`src/sceneBuilder2d/surprise.ts`, `surpriseScene2D(seed)`, pure):

- **Space:** one or two library blocks, or now and then a combine of two (add, blend, multiply),
  their sliders varied the way Random varies them. A stack that sends points to NaN or flings the
  grid far away is dealt again. Tangent tear and Pixel steps are left out (they look broken more
  often than good at random).
- **Shapes:** one to three glowing shapes (rings, stars, bursts, hexagons, outlines…) in colours
  from one harmonious palette; later ones as a ring of copies (sometimes rings of rings or several
  sizes); motion (orbit, bob, spin, pulse) on most.
- **Look:** glow on all, a dark ground near the palette's hue, ACES tone mapping (AgX lifted the
  dark ground to grey in every trial), sometimes colour by length, angle or distance through a
  palette, a little bloom and vignette.

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
