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
| **Scatter** | A stable random push per piece (picture units), added to Offset × Amount; works with Amount 0. Wire an LFO to scatter and return |
| Turn ƒ | Degrees per piece, from any chain read at its home |
| Shape ƒ | Your own SDF, drawn in each piece's frame (−0.5…0.5, as Grid Pattern's Shape) |
| Depth | A Depth node's Depth texture, for Size by Depth |
| Background | What shows between the pieces (the layers behind, a dimmed picture) |

Settings: Shape (**ball**: a shaded circle, circle, square, hexagon, diamond, **glyph**: a mark picked by brightness, dot to block), Colour
(**Flat**: the colour at home, a mosaic; **Piece**: each carries the picture round its home, so at rest the pieces make up
the picture exactly), Pieces across, Size (1 touches the neighbours), Size by (brightness: a halftone; darkness: ink;
depth), Min size, Turn, Spin, On top (moved furthest, random, brightest), Find pieces, Search, Softness, Aspect (the
picture's width ÷ height, to fill the frame keeping its shape; 0 stretches), Stagger (a honeycomb), and the CC Ball Action
set below (Scatter, Seed, Scatter turn, Scatter size, Instability, Dim floor, Ball look, Light angle, Shading, Focus,
Blur). Every number is a slider with a socket of the same name (docs/wireable-sliders.md).

### Scatter, the Ball shape and the rest (CC Ball Action)

After Effects' CC Ball Action has Scatter, Rotation, Twist and Instability. Pieces has:

- **Scatter**: every piece gets a stable random direction and distance from its cell and the **Seed**
  (`pieces_rand4`, Dave Hoskins' hash44): direction 2π·r.x, distance Scatter·√r.y (even over the disc), so raising Scatter
  pushes every piece further along its own line, smoothly. It adds to Offset × Amount and works with Amount 0.
- **Scatter turn**: up to that many degrees of random turn per piece. **Scatter size**: random size per piece (0.3:
  70%–130% of Size). **Instability**: every piece wobbles round its place, each at its own pace and phase (picture units).
- **Ball** shape, **Ball look**: **Glowing** (the default): each ball gives off its colour, brightest at its centre and
  falling off to a dim rim (the colour pushed up, not washed to white), a faint highlight; **Lit**: a sphere under a light
  from **Light angle** (lit side, highlight, dark rim). **Shading** 0 is a flat disc.
- **Dim floor**: lifts the darkest colours, so dark parts of the picture stay as dim balls rather than nothing.
- **Focus** and **Blur** (the particle camera's words): depth of field on the value that sizes the pieces (Size by
  depth, brightness or darkness; the brightness when it is Nothing). Out of focus a piece grows by Blur × |value − Focus|
  half cells, its edge as soft, and its coverage falls as its area grows, so it keeps its light (a soft disc, real
  transparency over the Background). Off (Blur 0) by default.

A new Pieces node starts as the reference look: Ball (Glowing), 120 across, Size 1.08, Scatter 0.012, Scatter size 0.12,
Dim floor 0.08. Saved nodes are unchanged: the code reads a missing key as 0 (and the shape as Circle), and with
Scatter, its turn and size, Instability and Dim floor all 0 and unwired the emitted GLSL is exactly what it was.

The search takes the scatter in: Scatter's full length (in cells), Instability × √2 and Blur's growth add to the
furthest travel, and Scatter size to the biggest piece, in both search modes, so no piece is cut. Past the cap (about 11
cells in Every piece, 3 in Near) the card says so, as the Grid builder does (`scatterReach`,
components/NodeGraph/ScatterReachNote.tsx; from the node's own numbers, a wired value can't be known there).

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

**Scatter** (X, Y and Z: a random point in a ball of radius Scatter per ball, from the **Seed**), **Scatter depth**
(towards or away from the camera only), **Scatter size**, **Twist** (degrees per scene unit from the middle: the outer
balls turn most), **Instability** (a wobble in X, Y and Z, each ball its own pace) and **Focus** / **Blur** (depth of
field along Z: an out-of-focus ball grows by Blur × |z − Focus| half cells, up to a cell and a half, and its colour thins
towards its edge so it keeps its light; the discs fade to black, not to what is behind them, so it suits a dark
background). All 0 by default; with them all 0 and unwired the code is what it was.

- **Its own grid, sideways:** the node measures this cell's ball and then the balls of the cells round it that could
  reach this cell, out to the furthest a ball moves sideways (Scatter, Instability × √2, a sideways Displace) plus the
  biggest ball (Scatter size, Blur), at most 3 cells each side (`BALLS_SEARCH_CAP`; the card warns past it). Only the
  rows and columns that could come near the point run (counted from the low end, stopped past the high end), and a
  neighbour is skipped before its picture is read when even its nearest possible place (sideways, and between 0 and
  Lift in depth) is further than the nearest found so far. The nearest ball wins: after the March Loop at Hit Pos its
  colour is the colour of the ball hit. When nothing reaches a neighbour (a live slider at 0) the loop is skipped.
- **Twist on its own grid** turns the space the grid stands in (exact, turning keeps |p|) and shrinks the distance by
  the turn's stretch; under Repeat Scene it moves each ball's centre (Repeat Scene's neighbours find it).
- **Scatter depth alone** stays on the cheap path: only the slab the balls fill grows.

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
  Template: **Picture in pieces**. Also **Scatter** (on the Pace's eased LFO with the move: an Expression "Scatter ×
  ease" into Pieces' Scatter), Seed, Scatter turn, Scatter size and Dim floor: `scatter=0.05 seed=4 scatter-turn=30
  scatter-size=0.2 dim=0.1` (missing words are 0, so older recipes build as before). The old "Scatter" row (the move's
  distance) is now **Fly**. A picture picked on the card starts as the Ball action look (Ball, 100 across, a little Scatter).
- **3D Scene Builder:** the shape **Picture balls** (`picture-balls width=4 across=51 lift=0.5 ball=0.92 wave=0.08 jitter=0
  scatter=0.02 depth-scatter=0.5 twist=10 instability=0.01 focus=0 blur=0 texture=pic`), picture through the shape's Picture (the shared picker). Its picture reaches the scene and the Materials
  group through a Picture port; its colour is a Balls node at the hit point. Template: **Picture as balls** (additive:
  nothing else changed).

## Examples (Pictures in pieces)

- **Pieces: scatter and return**: a photo from 32 circles across, a noise Vector Field into Offset ƒ, an eased LFO
  into Amount and (× reach 0.22) into Scatter, the dim photo as Background.
- **Pieces: ball action**: CC Ball Action on a shader: a moving kaleidoscope (a Shader Texture, 1024², every frame)
  rebuilt from 110 glowing balls across, Scatter 0.01 at rest with bursts from an LFO, Scatter size, Instability, Dim
  floor; the brightest on top.
- **Balls: scattered in depth**: the photo as Balls on its own grid (71 across); an LFO on Scatter depth (through the
  Scene Group's ports and straight into the colour's Balls) breaks it up towards and away from the camera; Focus and
  Blur as constants (Blur 0 to start), a glowing shade.
- **Balls: a picture in 3D**: Repeat Scene, one ball per copy lifted by brightness, a wave from Repeat Cell's Centre,
  colour from Repeat Cell at Hit Pos.

Frame times (this Mac, browser pane, 1280 × 720, GPU timer): scatter and return 4.7 ms average, 6.7 ms worst over a
cycle; Balls example 5.1 ms (p95 7.7); the Picture as balls template 1.8 ms.

With Scatter (headless Chrome on this Mac, the app's 608 × 769 preview, whole-frame GPU average): Pieces: ball
action 10.3 ms, at Scatter 0.3 (about 9 cells) 17.1 ms; scatter and return 16.3 ms; Balls: scattered in depth 12.8 ms
(the old Balls example 16.8 ms in the same run); with Blur 1.2 about 62 ms; with sideways Scatter 0.05 (0.8 of a cell)
about 95 ms, 0.15 (2.4 cells) about 115 ms. Sideways scatter on the 3D grid is the costly part: every ray step then
measures the neighbours too. Fewer balls across, or depth-only scatter, keep it cheap.

## Not yet

- **Pieces as walkers** (agents with a Return home force, drawn as dots or splats): the shared pieces are there now
  (docs/splat-scene.md "Agents as splats"): Emit's **Remember home** keeps each walker's birth place in a **Home**
  memory, the **Return home** rule action / Forces card springs it back (strength, damping, delay; agentRules/home.ts),
  and Draw agents' **Splats** look draws them. What is left is the Emit shape that births one walker per grid point
  with the picture's colour there.
- Travel beyond ~11 cells in the sure search is cut (the cap); a two-pass version (offsets in a texture) would lift it.
- Sideways scatter (and Blur) on the 3D own grid is several times dearer per frame than depth-only scatter; per-ball
  data in a texture (one pass) would let a step skip the hashes and picture reads.
- Blur's soft discs in 3D fade to black, not to what is behind (the March Loop has no transparency).
- Scatter turn has no 3D counterpart yet (boxes could turn per ball).
