# Grid builder

The Scene builder's **Grid scene** kind (docs/scene-builder.md). You work on a mini version of the
grid and draw on it: place shapes in cells, make them move, run a pattern over the cells, bend the
grid with warps, and add simple When/Do rules between shapes. Everything runs on the GPU as real
nodes. One switch turns the drawing into a Grid Rules simulation, and its editor has the way back.

Code: `src/gridScene/` (spec, GLSL, build, apply, store, surprise, templates, actions) and
`src/components/gridScene/` (the window and the mini grid).

## Grid scene and Grid Rules

The kind page's **Grid scene** opens the Grid builder. Grid Rules (the simulation grid: Life, sand,
heat, Wireworld) is reached from it:

- **Make it a simulation → Grid Rules** in the builder's header builds the drawing (if it changed),
  adds a Grid Rules node whose drawn start is it, puts the Output on the simulation and opens the Grid
  Rules editor.
- The Grid Rules editor of a node made that way has **‹ Pattern grid**: the Output goes back to the
  drawing and the Grid builder opens on it. The Grid Rules node stays; jumping again reuses it.
- A plain Grid Rules node is still one Do… bar phrase away ("new grid rules"), and a Grid Rules node
  already in the graph is listed by the Scene builder's "Edit this one" and opens in its editor.

Why one kind and not two: the two are the same idea seen two ways (cells you set up by hand, cells
that a rule steps), so the kind page keeps four cards and the switch between them sits where the
work is. Drawing first and then simulating is the path the jump makes easy; the other way round
(a simulation with no drawing) is the Do… bar's.

### What carries over

The drawing's placed cells, as they are at that moment, are the simulation's **drawn start**
(Grid Rules' Start: Your drawing, the node's `startCells`, see grid-rules.md "A drawn start"): every
drawn shape is a live cell (state 1), cropped to the drawn cells. The Grid Rules builder's try board
and the node's own board both start from it. A drawing of another size than the board is placed in
the middle, as the drawn-start mode does. The node is made with `startCells` in
`simulationFromGrid` (`gridScene/actions.ts`, `drawnStartOf`). The board is Coarse (⅛), so each
drawn cell is one board cell, and Life evolves it. **Reset** on the Grid Rules node deals the board
again from the drawing as it was when you jumped; jumping again updates the drawing on the same
node. Nodes made by an older jump (a Start image through a Pass) keep working, and the next jump
switches them to the drawn start. The rule starts as Life; any preset can be picked in the editor.

## The window

A viewport-first layout like the Agent Builder (StudioShell):

- **Left:** the brush (the shapes, A to F, and an eraser), the mini grid, columns and rows (2 to
  24), Clear cells, and the sections.
- **Centre:** the live preview: the graph Build makes, compiled and drawn by the builder's own
  WebGL canvas (useBuilderPreview: every frame, at the screen's density, uniforms only when only a
  number changed). The main preview behind the window is held while it is open.
- **Right:** the selected section's settings.
- **Bottom:** starting points (Pixel heart, Checker dance, Ripple pond, Spiral stars, Traffic,
  Warped weave, Orbiters). Loading one replaces the form, one undo step.
- **Header:** Scene builder › Grid scene (back to the kinds; a changed drawing is built first),
  Surprise me (seeded, one undo step), undo and redo, Make it a simulation, Build (Rebuild when
  editing a built grid) and **Done** (builds what changed, closes, and frames it on the graph:
  finishBuilder).

Every number is a BuilderSlider (double-click resets, bipolar ranges, typing past the end widens
it).

### Drawing

- Click or drag on the mini grid to place the brush's shape; a drag fills every cell it crosses and
  is one undo step however long it takes.
- Right-click (or Alt-drag, or the eraser) clears.
- The brush shape's motion paths are drawn faintly through its cells, from the same sums the
  shader uses (`motionAt`).
- Cells a rule points at (a cell, a column, a row) are ringed. **Pick on the grid** in a rule waits
  for a click on a cell (Esc stops it).
- Up to 128 drawn cells: every one is a few lines of the shader and every pixel looks at each.
  The pattern's fill covers the rest of the grid at no extra cost.

### Text

Words in the Agent Builder's stroke font (`agentBuilder/strokeFont.ts`), two ways
(`src/gridScene/textMask.ts`):

- **The text stamp.** **Text** beside the words and their height (3–12 cells) under the brush: while
  it is on, pointing at the mini grid fills the cells the letters will cover, and a click puts the
  brush's shape in every one (the first shape while the eraser is picked; right-click or Alt clears
  them). One undo step a stamp, within the 128 drawn cells. The cells are the ones Grid Rules' text
  start and try-board stamp use (`gridRules/textCells.ts`), so **Make it a simulation** starts Life
  from the letters.
- **The pattern's mask.** Patterns & warps → **Only in words**: the wave changes only the cells whose
  middle the words cover, and **Fill empty cells** puts its shape only there, so the fill spells the
  words and moves with the wave. Words, Size, Weight, Across and Up (cells from the grid's middle).
  In the shader the mask is a function of its own (`gs_mask`: the font's strokes, one line each, as
  the Agent Builder's text: no texture); the mini grid tints the same cells, worked out on the CPU
  with the same distance (`textMaskAt`; `gridText.test.ts` checks them cell for cell). Changing the
  words rebuilds; the pattern's numbers stay live.

### Sections

| Section | What it sets |
|---|---|
| **Shapes** | Up to six shapes: kind (circle, square, ring, diamond, triangle, hexagon, star, plus, cross, heart), colour, size (a share of half a cell: 1 touches the neighbours), turn, spin, pulse, outline. Add and remove shapes (a removed shape's cells and rules go with it). |
| **Motion** | The brush shape's path: still, up and down, side to side, both at once, circle, figure eight, bounce, travel, hop. The **XY control** sets how far (in cells, y up): drag the point, the path is drawn round it; X and Y sliders beside it. Speed (cycles a second) and lag (each cell starts (x + y) × lag of a cycle later: the motion runs through the drawing as a wave). Travel and hop wrap round the grid. |
| **Patterns & warps** | A wave over the cells: ripple, diagonal, checker, rings, spiral, stripes, random. It changes every shape's size, turn, push, hue or brightness by Amount; Waves is how many across the grid, Speed in cycles a second, Arms for the spiral. **Fill empty cells** puts a shape in every cell you didn't draw on, its size following the wave (checker + fill is a checkerboard that swaps). **Only in words** limits the wave and the fill to the cells some words cover (see Text). **Grid warps**: up to three space blocks from the 2D Scene Builder's library (the same picker: categories, search, Random), bending the space the whole grid is drawn in, lines and all. |
| **Rules** | When … Do … for every drawn cell, checked in the shader each frame, top to bottom. When a shape *is in the cell (x, y)*, *is in the column*, *is in the row*, *shares a cell with* another shape, or *is near* it (within N cells). Do: *becomes* another shape (its kind, size and colour), *turns a colour*, *swaps colours with* the other shape (both ways), *grows by*, *hides*, *spins*. A rule that names a shape that isn't there is shown as off. |
| **Look** | Background, grid lines (on or off, colour, width in cells), the grid's size, glow (amount, falloff), tone map. |

## What Build makes

```
UV ─► warps (Expression Blocks) ─┬─► Grid scene (Expression Block + helpers) ─► colour, d
Time ────────────────────────────┤      ▲ motion, look, edge, colour per shape
per shape: Colour, Shape A (Expression Block of sliders)
Ground & lines (Expression Block over the background) ◄─ the warped UV
Glow Layer (d, colour) ─► Add over the ground ─► SDF Fill ─► Tone Map ─► Output
```

- **Shape A, B…**: an Expression Block whose sliders are the shape's numbers (size, turn, spin,
  pulse, outline, move X and Y, speed, lag). Its result is the motion (x, y, speed, lag); `look`
  and `edge` are exposed outputs. Colour is a Colour node. All live: no recompile.
- **Grid scene**: an Expression Block with the pattern's sliders (amount, freq, speed, arms). Its
  helper functions (in the node's functions) draw the grid: for every drawn cell, where its shape is
  now, which cell that is, the pattern's wave there, the rules, and the shape's distance; the
  nearest shape gives the colour. Each function's name ends in a hash of its code, so two grid
  scenes in a graph never clash. Result: the colour; `d`: the distance (picture units).
- **Ground & lines**: the background, a faint checker of the cells (tint) and the cell borders,
  read in the warped space so the lines bend with the warps.
- Every node has a note. The structure (the cells, a path's kind, the pattern's kind, the rules,
  the warps) is code: changing it rebuilds; numbers are uniforms.

The UV node keeps the spec (`gridScene`), so the Scene builder lists the build ("Grid scene · 10 ×
10 · 27 cells drawn") and **Edit this one** reopens it exactly as built. A rebuild keeps each node's
id (Play controls and your wires stay), its place, and a slider you changed on a node that the new
spec leaves alone (`src/gridScene/apply.ts`, the 2D Scene Builder's scheme).

## Textures

Pictures through the shared picker ([scene-builder.md](scene-builder.md#textures)):

- **Picture cells:** the shape kind **Picture** shows a picture inside each of its cells, filling
  the cell's square (Fill, keeping the picture's shape), turning, spinning and pulsing with the
  shape. The scene function writes the winning cell's place on its picture (`inout vec4 pic`: xy the
  place, z 1 for a picture, w its slot); a Sample (texture) per picture reads it and paints it over.
  Scenes without picture cells compile to the same code as before.
- **Picture pattern:** the pattern **Picture** puts a picture over the grid; each cell takes its
  brightness there (read at the centre of the pixel's cell), as the wave: bright is the wave's top, so
  the picture drives the size, turn, push, hue or brightness, and the fill of empty cells.
- **Picture mask** (Patterns): shapes only in the cells where a picture is bright (**Cut**, live),
  or dark (**Invert**).

The pattern and the mask share one read of the same picture. Read per cell, a shape reaching into a
neighbouring cell takes that cell's value.

## Surprise me

A whole grid scene from a seed (`src/gridScene/surprise.ts`), the same seed always the same:
a 6 to 14 cell grid; one to three shapes in one harmonious palette on a dark ground; cells drawn as
a motif (a mirrored pixel sprite, a ring, a diagonal, a border, a scatter); motion for most shapes;
a pattern most of the time (sometimes filling the empty cells); now and then a gentle warp (one of
the library's blocks that bends a grid without tearing it, at or below its default strength) and a
rule between two shapes. One undo step; Reroll and Undo in its toast.

## The Do… bar

- "new grid scene", "grid builder", "draw on a grid" open the Grid builder on a new grid.
- "open the scene builder" (and "scene builder") opens the kind page; "3d scene builder" is the 3D
  Scene Builder.

## Not yet

- Shapes moving through the pattern's fill don't push it aside; the fill only skips the cells you
  drew on.
- Rules see each shape where it is now; there is no memory (a shape that became a star goes back
  when it leaves the column). A "stays changed" Do would need a feedback pass.
- The jump to Grid Rules starts every drawn shape as state 1; shapes as different states (for
  Stages, Patterns, Blocks) are a follow-up.
- Keyframes and the Play menu on the builder's own sliders (as for the 2D and 3D builders); the
  built nodes' sliders have both.
