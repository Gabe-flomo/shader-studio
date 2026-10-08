# 2D Scene Builder

A builder for flat pictures, like the 3D Scene Builder: pick shapes, bend the space they live in, add motion and copies, set the look, and Build writes a real node graph (every node with a note). Open it from **Builders → 2D Scene Builder** in the Nodes sidebar. Right-click any node of a built scene → **Edit in 2D Scene Builder** to change it again; Rebuild keeps the settings you changed on its nodes.

## The window

- **Layers** (left): shapes and combine groups, painted top to bottom (the last is on top). Select one to edit it; move it earlier or later, delete it, join it with the next layer (∪ with next, − next) or ungroup.
- **Space**: transforms applied to the picture's coordinates before the shapes measure them, top to bottom: zoom, rotate (with spin), move, pixelate, tile, mirror tile, mirror, kaleidoscope, polar repeat, polar, swirl, noise warp, wave, fisheye. Each shows a thumbnail of a checkerboard through it.
- **Shapes**: a gallery of 17 shapes (circle, ring, box, rounded box, triangle, diamond, pentagon, hexagon, octagon, star, burst, hexagram, heart, cross, ellipse, moon, vesica). The selected layer's inspector has its size, colour and glow; **Place** (position, rotate, scale, round, outline only); **Motion** (orbit, bob, spin, pulse, with speed, amount, direction and phase); **Duplicate** (a ring of copies, rings of rings, and the whole ring repeated at bigger sizes).
- **Look**: background, colour by (each layer's colour, or length, angle, x, y, time or distance through a palette), glow on all shapes or only layers marked Glow, tone map, bloom, vignette, grain, scanlines.
- **Output**: the picture, or a view of how it works: distance bands, the mask, or the space as a checkerboard.
- **Recipe**: the whole scene as one line of the Playfield language, e.g. `kaleidoscope 8 · ring r=0.3 th=0.02 color=cyan @orbit(0.12 speed=0.12) · glow 0.008 · tone aces`. Edit and Apply, or paste one.
- **Templates**: five starting points.
- **Preview** (right): the graph Build makes, compiled and drawn live.

## Examples

**2D: Scene Builder** folder: Kaleidoscope of glowing rings, Orbiting shapes, A ring of rings.

## Functions

GLSL functions as building blocks, each built as a **Custom Function** node that carries the function (and any helpers it calls) and calls it:

- **Space → Add a function**: a function that bends space, `vec2 f(vec2 p[, float t])`, applied like any space transform.
- **Shapes → Function shapes**: a function that measures a shape, `float f(vec2 p[, float t])`: negative inside, positive outside.

Built in: twirl, complexSquare, circleInvert, sineWarp, brickOffset, breathe (space); flower, spiralLine, superellipse, wobblyBlob, twoBlobs (shapes). **Find more in your code and the examples** looks through your saved GLSL shaders and presets, the Convert examples, and the Custom Function nodes and Expression Blocks in this graph, your saved graphs and the examples. An Expression Block counts when it has one vec2 input, float inputs that are sliders (their values are written in) or one time input, and a vec2 or float result. In a recipe: `fn twirl`, `fn-shape flower color=pink` (built-ins only; functions from your code are kept in the scene but picked in the builder).

## Do… bar

`new 2d scene`, `2d scene builder`, `open the 2d scene builder` open the builder on a new scene.
