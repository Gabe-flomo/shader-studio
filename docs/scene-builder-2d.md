# 2D Scene Builder

A builder for flat pictures, like the 3D Scene Builder: pick shapes, bend the space they live in, add motion and copies, set the look, and Build writes a real node graph (every node with a note). Open it from **Builders → 2D Scene Builder** in the Nodes sidebar. Right-click any node of a built scene → **Edit in 2D Scene Builder** to change it again; Rebuild keeps the settings you changed on its nodes.

## The window

- **Layers** (left): shapes and combine groups, painted top to bottom (the last is on top). Select one to edit it; move it earlier or later, delete it, join it with the next layer (∪ with next, − next) or ungroup.
- **Space**: transforms applied to the picture's coordinates before the shapes measure them, top to bottom. At the top, a big **space view** (a grid seen through the whole stack; it stays in view as the stack scrolls, and hovering a transform shows the space after it). Then the stack: **space blocks** (below), and the built-in transforms (zoom, rotate with spin, move, pixelate, tile, mirror tile, mirror, kaleidoscope, polar repeat, polar, swirl, noise warp, wave, fisheye, invert; folded under *Built-in transforms*), and functions (*Add a function*). Each shows a thumbnail of a grid or checkerboard through it.
- **Shapes**: a gallery of 17 shapes (circle, ring, box, rounded box, triangle, diamond, pentagon, hexagon, octagon, star, burst, hexagram, heart, cross, ellipse, moon, vesica). The selected layer's inspector has its size, colour and glow; **Place** (position, rotate, scale, round, outline only); **Motion** (orbit, bob, spin, pulse, with speed, amount, direction and phase); **Duplicate** (a ring of copies, rings of rings, and the whole ring repeated at bigger sizes).
- **Look**: background, colour by (each layer's colour, or length, angle, x, y, time or distance through a palette), glow on all shapes or only layers marked Glow, tone map, bloom, vignette, grain, scanlines.
- **Output**: the picture, or a view of how it works: distance bands, the mask, or the space as a checkerboard.
- **Recipe**: the whole scene as one line of the Playfield language, e.g. `kaleidoscope 8 · ring r=0.3 th=0.02 color=cyan @orbit(0.12 speed=0.12) · glow 0.008 · tone aces`. Edit and Apply, or paste one.
- **Templates**: five starting points.
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

## One builder later

The scene builders are to become one builder with a "what kind of scene" start page. The 2D
builder stays self-contained for that: its data, recipe, graph, blocks, library and surprise are
in `src/sceneBuilder2d/` (pure, no React), its window and pieces in
`src/components/sceneBuilder2d/` (`SceneBuilder2DModal`, `SpaceBlocks`, `Preview2D`), and its
state in its own store (`useSceneBuilder2D`). A start page only needs `openWith(scene)` (or
`surprise(seed)`) and the window.

## Examples

**2D: Scene Builder** folder: Kaleidoscope of glowing rings, Orbiting shapes, A ring of rings.

## Functions

GLSL functions as building blocks, each built as a **Custom Function** node that carries the function (and any helpers it calls) and calls it:

- **Space → Add a function**: a function that bends space, `vec2 f(vec2 p[, float t])`, applied like any space transform.
- **Shapes → Function shapes**: a function that measures a shape, `float f(vec2 p[, float t])`: negative inside, positive outside.

Built in: twirl, complexSquare, circleInvert, sineWarp, brickOffset, breathe (space); flower, spiralLine, superellipse, wobblyBlob, twoBlobs (shapes). **Find more in your code and the examples** looks through your saved GLSL shaders and presets, the Convert examples, and the Custom Function nodes and Expression Blocks in this graph, your saved graphs and the examples. An Expression Block counts when it has one vec2 input, float inputs that are sliders (their values are written in) or one time input, and a vec2 or float result. In a recipe: `fn twirl`, `fn-shape flower color=pink` (built-ins only; functions from your code are kept in the scene but picked in the builder).

## Do… bar

`new 2d scene`, `2d scene builder`, `open the 2d scene builder` open the builder on a new scene.
