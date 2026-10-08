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

## Next

- **Functions** from the Code Explorer applied as Expression Blocks to a shape, the space or the grid.
- 2D scenes in the Do… bar.

## Grid

The **Grid** tab adds a grid of cells drawn over the layers:

- **Cells**: columns × rows over a span round the centre; the shape's size as a share of its cell.
- **Shapes**: up to three of circle, box, ring, diamond, triangle, hexagon and cross, given out to cells all the same, as a checker, by column, by row, every Nth, or at random.
- **Ripples**: circular waves from the centre, the four corners, the mouse or a point (up to four, averaged), with rings per unit and speed. They change the shape's **size**, its **turn**, a **push** off the cell centre, or **morph** from the first shape into the second, or nothing (colour only).
- **Colour**: by shape (two colours), by the ripple, or a random value per cell (both through the Look palette), with or without glow.

It builds as one **Expression Block** whose lines are the maths step by step (cell size, which cell, the cell centre, the wave, the size, the shape choice, each shape's distance), with live sliders for size, amount, rings and speed. In a recipe: `grid 14 shape=circle shape=box ripple=corners freq=9 speed=0.35 target=morph amount=0.9` (`grid 0.5`, a cell size, is still Tile).

Examples: **Morphing ripple grid**, **Ripples that follow the mouse**.
