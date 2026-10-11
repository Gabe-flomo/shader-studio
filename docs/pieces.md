# Pieces

A picture rebuilt from pieces that can move, After Effects' CC Ball Action style
([depth-and-splats-plan.md](depth-and-splats-plan.md), section 1c). Each piece has a **home**, the centre of its cell
on a grid laid over the picture, and takes the picture's colour there. The picture isn't laid on top: it is *made of*
the pieces, so moving the pieces moves the picture. Video plays inside them (every frame is read again).

Code: `src/nodes/definitions/pieces.ts` (both nodes), `src/sceneBuilder2d/pieces.ts` (the 2D builder's option),
`src/store/piecesExamples.ts`. Tests: `src/nodes/__tests__/pieces.test.ts`, `src/compiler/__tests__/piecesExamples.test.ts`,
`src/sceneBuilder2d/__tests__/pieces.test.ts`.

## Pieces (2D, Grid)

| Input | What it does |
|---|---|
| Picture | Texture Input, Video Input, Baked, a Pass. Unwired: a colour gradient |
| **Offset ƒ** | A field socket: any vec2 chain (a Vector Field, noise, the mouse, time), read at each piece's **home**. A Cell node in the chain gives the piece's cell, and Index a random 0–1 per piece |
| Amount | Times the offset. 0 puts every piece home. Wire an LFO to scatter and return |
| Turn ƒ | Degrees per piece, from any chain read at its home |
| Shape ƒ | Your own SDF, drawn in each piece's frame (−0.5…0.5, as Grid Pattern's Shape) |
| Depth | A Depth node's Depth texture, for Size by Depth |
| Background | What shows between the pieces (the layers behind, a dimmed picture) |

Settings: Shape (circle, square, hexagon, diamond, **glyph**: a mark picked by brightness, dot to block), Colour
(**Flat**: the colour at home, a mosaic; **Piece**: each carries the picture round its home, so at rest the pieces make up
the picture exactly), Pieces across, Size (1 touches the neighbours), Size by (brightness: a halftone; darkness: ink;
depth), Min size, Turn, Spin, On top (moved furthest, random, brightest), Find pieces, Search, Softness, Aspect (the
picture's width ÷ height, to fill the frame keeping its shape; 0 stretches), Stagger (a honeycomb). Every number is a
slider with a socket of the same name (docs/wireable-sliders.md).

Outputs: **Colour** (over Background), **Mask**, **Piece ID** (column, row), **Home** (picture units), Distance, Piece colour.

### How a pixel finds its pieces

A piece from home *h* is drawn at *h* + offset(*h*), so the pieces over a pixel X come from the homes with
*h* + offset(*h*) = X. Like the Grid builder (#818/#822), each pixel searches a bounded square of cells, live radius,
loops to a cap:

- **Every piece that can reach (sure, the default):** the cells round X out to the furthest any piece travels (the
  offset's length here and one step back, × 1.25), plus the piece's size and Search. Complete for fields of steady
  strength (a Vector Field's directions, a mouse push), however wild; pieces cross and overlap. The cap is 25 × 25 cells,
  so travel up to about 11 cells; beyond that, fewer pieces across or a smaller Amount.
- **Near where they came from (fast):** the fixed point *h* = X − offset(*h*) (4 steps) and the cells round it. Exact
  for an offset that is the same everywhere; right for smooth fields whose neighbouring offsets differ by less than a
  cell. Raise Search if pieces get cut.

Two top pieces are kept per pixel and composited **disjoint over**: pieces edge to edge at rest add up to a whole pixel
with no seam; where they overlap, the top wins. The tests run the GLSL on the CPU and compare against a search of every
cell (no clipping), and check that a moved piece reads the picture at its home.

Pictures are read with `textureLod` level 0: the reads are in loops (and, for Balls, in the scene function), where the
implicit level is undefined and speckles.

Why it beats the Halftone Grid for this: one node instead of Grid UV, Pixelate, Luma Radius and Dot Mask; pieces can
leave their cells and overlap without being cut; the colour comes from home, so the picture survives the motion.

## Balls (3D Primitives)

A grid of spheres or rounded boxes, each the picture's colour at its home, lifted towards the camera by the
brightness, darkness or a Depth texture, with a ring wave, a random push (Jitter) and a Displace wire. The picture reads
the right way round from a March Camera at Angle 0 ("Face a camera at Angle 0").

- **Its own grid** (default): the node is the whole picture (Width, Pieces across, rows from Aspect). It finds the
  cell the point is in, measures that ball, and caps the distance at the cell walls (towards cells that exist), so a ray
  never steps over a short ball into a tall neighbour. Off the grid, or in front of / behind the slab the balls can
  reach, the cap is lifted so rays don't run out of steps. After the March Loop, the same node at Hit Pos gives the
  colour of the ball there.
- **One ball per Repeat Scene copy:** put it in the Scene Group a Repeat Scene repeats (docs/repeat-scene.md); the
  copy's cell is its home, so Displace can come from Repeat Cell's Centre or Random. After the loop, wire Repeat Cell's
  Cell (looked up at Hit Pos). Use Neighbours **Wall cap** when balls only move along Z.

A texture can now cross into a Scene Group through a port (the sampler is a global; it is no longer made a parameter of
the scene function).

## In the builders

- **2D Scene Builder → Grid → Picture in pieces:** pick the picture (the shared picker), shape, pieces across, size,
  colour, size by, and what moves them (noise, flow, away from the mouse, still), with Scatter, Pace (an LFO eased into
  Amount) and Swirl size. Drawn over the layers and the grid, which show between the pieces. Recipe:
  `pieces pond count=40 shape=hexagon colour=piece size-by=brightness move=noise amount=0.35 speed=0.1 swirl=0.8`.
  Template: **Picture in pieces**.
- **3D Scene Builder:** the shape **Picture balls** (`picture-balls width=4 across=51 lift=0.5 ball=0.92 wave=0.08 jitter=0
  texture=pic`), picture through the shape's Picture (the shared picker). Its picture reaches the scene and the Materials
  group through a Picture port; its colour is a Balls node at the hit point. Template: **Picture as balls** (additive:
  nothing else changed).

## Examples (Pictures in pieces)

- **Pieces: scatter and return**: a photo from 32 circles across, a noise Vector Field into Offset ƒ, an eased LFO
  into Amount, the dim photo as Background.
- **Balls: a picture in 3D**: Repeat Scene, one ball per copy lifted by brightness, a wave from Repeat Cell's Centre,
  colour from Repeat Cell at Hit Pos.

Frame times (this Mac, browser pane, 1280 × 720, GPU timer): scatter and return 4.7 ms average, 6.7 ms worst over a
cycle; Balls example 5.1 ms (p95 7.7); the Picture as balls template 1.8 ms.

## Not yet

- **Pieces as walkers** (agents with a Return home force, drawn as dots or splats): the shared pieces are there now
  (docs/splat-scene.md "Agents as splats"): Emit's **Remember home** keeps each walker's birth place in a **Home**
  memory, the **Return home** rule action / Forces card springs it back (strength, damping, delay; agentRules/home.ts),
  and Draw agents' **Splats** look draws them. What is left is the Emit shape that births one walker per grid point
  with the picture's colour there.
- Travel beyond ~11 cells in the sure search is cut (the cap); a two-pass version (offsets in a texture) would lift it.
- Balls on their own grid move only along Z; sideways scatter needs the Repeat Scene layout with Nearest 8.
