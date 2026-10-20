# Combine

Combine puts together what the builders made, without wiring the graph: a photo in a 3D scene, a 3D scene on a
photo, people replaced by a 2D build. Each join is a **verb**, and a verb builds the graph you would wire by hand,
from nodes that already exist. Every node it adds has a note. The plan, with what later phases add, is
[combine-plan.md](combine-plan.md).

Phase 1: the Combine window, the layer stack, the verb picker, the saved and reopenable stack, and two verbs, **Place
in** and **Replace mask with** (one fill for all), with the new **Blob Space** node.

Phase 2: **Collide with** and **Follow the shape** (points on a 2D build's shape or in a 3D scene), the new **Follow
surface (3D Scene)** node, and **one-line expressions** on a verb's numbers.

## Two ways in

- **Combine** on the Scene builder's kind page (the ninth card). It opens on an empty stack with "+ Add a layer"
  open: the first layer is the base.
- **Add to this…** beside Done in every builder of the Scene builder (2D, 3D, Grid, Agents, Splat, Time Cube, Warp,
  Grid simulation). The builder's Done runs as usual, then Combine opens with that build as layer 1 and "+ Add a
  layer" open. It is the same Scene builder session: nothing reaches your graph until Combine's Done, and the whole
  visit is one undo step.

Combine is off on a phone. A graph Combine made opens there as plain nodes.

## The window

- **Layers** (left): bottom-up, the base at the bottom. Each card shows its product, a short verb line, the passes it
  adds (+1 when a picture worked out per pixel needs a Pass to become a texture), a mute switch and a menu (Edit
  product, Remove). Clicking a layer shows the stack **up to that layer** in the viewport and selects its settings;
  clicking it again, or Esc, shows the whole stack.
- **Viewport** (middle): the main preview, live. Every change is built into the draft at once; a slider only writes
  the glue's params (live uniforms, no recompile).
- **Settings** (right): the selected layer's verb. The primary section is open and the rest fold with a one-line
  summary. Choices are picture tiles (Card / World / By depth, Over / By depth, Box / Square / Circle) before sliders.
- **Presets** (bottom): Photo in a room, People → rings, Photo as the world, Shapes on a photo, Sparks trace a star,
  Dust settles on shapes. Each makes its
  products the way their builders would and replaces the stack (the products the previous preset made go with it).
- The header counts the graph's passes (Passes N/8), amber at the last full-quality pass and red over it.

## + Add a layer

Two steps in one panel:

1. **What**: products already in the graph ("From this graph": builds and loose Texture / Video Inputs, Segments, Blob
   Tracks), a mask (People, Objects, Click) when the layer below is a picture, a built-in photo or video or your own
   picture, or **New** in a builder (2D, 3D, Agents, Splat, Grid, Time Cube, Warp). New opens that builder in the same
   session; its Done brings the build back as the new layer, and its × comes back with the graph as it was.
2. **How**: only the verbs that join the pair, each with its ways as tiles. "On" picks any layer below as the target
   (default: the top one).

Only valid pairs are offered (combine-plan.md §1.1). Two 3D builds join in the 3D builder, not here.

## Place in

| A on B | How | The glue |
|---|---|---|
| Picture on a picture | Over (Normal), Screen, Add, Multiply, Overlay | Mix by Amount, or Blend Modes |
| Picture in a 3D scene | **Card** | the picture on a Picture Card in a small Scene Group of its own, marched through the scene's March Camera; Compare on the two March Loops' Distances, Multiply by the card's Hit, Select: the card shows only where it is nearer, so the scene's objects pass in front of it |
| | **World** | Picture Environment along the camera's rays (its Ray Dir and axes), Select by the scene's Hit: the picture all round the objects |
| | **By depth** | the picture's Depth node and Depth Composite with the March Loop's Distance and Hit: objects go behind and in front of what is in the photo |
| 3D scene on a picture | **Over it** | Select by the scene's Hit (times Amount) |
| | **By depth** | the picture's Depth node and Depth Composite |
| Splats in a 3D scene | | the Splat Scene's Ray Origin / Ray Dir / Distance / Hit wired from the scene, its own Scene unwired; a Simple Expression lays it over by its Alpha |
| Points on a picture or in 3D | | Draw agents draws the walkers over the layer below itself (its Background is wired from it), Mix by Amount; a 3D group sees through the scene's camera and hides behind its surfaces. A Draw agents whose Background is its own palette is laid over by its Density instead (Select) |

A picture worked out per pixel (a 2D build) gets a **Pass** when a node needs it as a texture (the card, the world,
Depth). The layer card shows the +1.

**Depth** uses the existing opt-in flow: the Depth section shows **Generate depth** (builders/depthPicture.ts). Nothing
downloads until you press it. Generated depth is kept on the layer and its Depth node plays it (Update: Baked).
Without it the Depth node works depth out live once the model is downloaded.

The card is marched apart from the scene so the 3D build stays as its builder made it. So the card isn't lit by the
scene's lights and casts no shadow on it yet (combine-plan.md §2.1 had it in the Scene Group; that needs the 3D
builder to own it).

## Collide with and Follow the shape

Points (an Agent Builder build) on a **2D build** (its shape: the distance each of its layers is drawn with, joined by
a Union when there are several) or in a **3D scene** (its Scene Group). Both add plain nodes, each with a note, inside
the points' Agents group, between what moved the walker (the builder's Move) and Agent Output; the shape comes in
through a port the group gains (**Shape (Combine)**, a number chain read wherever the walker is, or **Scene
(Combine)**, read on the coarse 48³ grid). The walkers are drawn over the layer below as Place in draws them. A 2D
group can't go in a 3D scene (the layer says so); a 3D group on a 2D shape works through the depth but is seen through
its own camera (a warning says so).

| Verb, way | 2D shape | 3D scene |
|---|---|---|
| Collide · **Bounce** / **Slide** | Collide after Move (Bounce 0.6 / 0), then a Simple Expression turns the heading to the new velocity | Collide (3D Scene), the same |
| Collide · **Settle** | Gravity → Integrate (Edges Slide) → Collide (no bounce, Friction ≥ 0.4): they fall and pile up | the same in 3D: dust on a floor, a ball, a block |
| Follow · **Trace** | Ride a Path, Level = Offset (just outside the edge), a thin band | Follow surface, Around the axis, near the surface |
| Follow · **Orbit** | Ride a Path at a Distance | Follow surface, Around, a shell at a Distance |
| Follow · **Cling** | Flow down the slope of abs(d − Offset) (a Simple Expression) plus a little Curl noise → Integrate | Follow surface, Cling: each its own way along it |
| Follow · **Flow along** | Flow Around the shape (Push) and the same cling → Integrate | Follow surface, Along the axis: over the top and round again |

Settings: How (tiles) is the primary section; Surface (margin, the grid's size in 3D) and Draw (Amount) fold. In 3D an
Axis (Up, Across, Depth) picks what Trace and Orbit circle and which way Flow along goes.

Nodes Combine put inside a group carry the build's key and a role like the glue, so a rebuild keeps their ids (Play
controls on them stay); the ports it added and Agent Output's wires before are kept in the meta (`inner`) and put
back before every rebuild and by Start over. A group its builder regenerated in the meantime keeps its own wires.

## Follow surface (3D Scene) (node)

Simulation, inside a 3D group. It reads a Scene on the same grid as Collide (3D Scene) (the engine fills one grid
program for each, compiler/agentGraph.ts `SCENE_GRID_TYPES`). Each step: the surface's normal from the grid's slope,
the velocity kept along the surface and steered (Steer) toward the mode's way at Speed (each walker ± Speed
variation), a step, then the pull back to the surface at Offset (Pull: a share of the gap, at most 0.15 a step).

- **Modes**: Cling (its own way), Around (round the Axis), Along (the Axis's way; where the surface faces the axis the
  pull lets go and the walker lifts off, and leaving the grid that way it comes back in at the other side).
- **Inputs**: Scene, Position, Velocity, Speed, Offset. **Outputs**: Position, Velocity, Heading, Distance, Along
  (the angle round the axis, 0–1).
- Outside the grid there is no surface: it heads for the grid's centre. In a 2D group it passes the walker through.
- `followSceneStep` is the maths in JS; the tests run the node's GLSL against it.

## Expressions

A number with **ƒ** beside it can be a one-line expression instead: the line is a Simple Expression's (checked as you
type, built when you leave the field), compiled to a **Simple Expression** node wired where the number went. Its
names are the verb's: the walkers' `speed`, `age` and, on a 2D shape, `d` (how far the walker is from the edge), plus
`t` (time). A number under the caret offers **Make a slider**: it becomes a name with a slider of its own, a
**Constant** node wired into the expression. A line that doesn't check builds nothing (the slider's number is used)
and says why under the field. × on ƒ goes back to the plain slider.

| Verb | Can be a line |
|---|---|
| Place in, Replace mask with | Amount |
| Collide with | Bounce, Friction, Gravity (Settle) |
| Follow the shape | Speed, Offset / Distance, Band (Trace, Orbit), Push (Flow along), Drift (Cling) |

Collide's Bounce and Friction gained sockets for it (a wire overrides the slider), on Collide and Collide (3D Scene).

## Replace mask with

Two layers: a **mask** on a picture, and a **fill** on the mask.

- **The mask** (People, Objects and their kinds, or Click) is a Segment on the picture below. Until a fill goes on
  it, the layer shows the picture dimmed where nothing is found. Its sections: Find (primary), Edge (Threshold,
  Softness, Grow), Blobs (how many).
- **The fill**: One for all (every blob shows the same fill). **On each blob**: Blob Track (reading the mask's red,
  Max size 0.95 so a person filling the frame counts) → **Blob Space**, the fill fitted to each blob (Box, Square,
  Circle; Padding, Fill scale, Spin by ID) and cut to the mask. **Whole mask**: the fill as it is, where the mask is.
  Select lays it over the picture under the mask.

How the fill is drawn on a blob depends on what it is:

| Fill | How |
|---|---|
| a picture worked out per pixel (a 2D build) | wired into Blob Space's **Fill**, a field socket: the chain is drawn again at each blob's Local UV, no pass |
| a picture with a texture (a photo, a video) | Blob Space's **Fill texture**, read at the blob's 0–1 UV |
| a 3D scene | its March Camera's UV is wired from Blob Space's Local UV: the scene renders inside each blob (a full march where the blobs are) |
| points | Draw agents' Image as Fill texture |

**Per blob** (each blob its own fill, By order or By ID) is phase 3. The data model has it (`fills` on the layer) and
Blob Space's **Fill: One blob, Pick by order / ID** is the node side of it; the window shows it as coming later.

## Blob Space (node)

Texture tools. Each pixel's place inside the blob it is on, from Blob Track's Blob data.

- **Inputs**: Blob data; Fill (vec3 field ƒ); Fill texture; Mask (where the fill may show inside the box); UV.
- **Outputs**: Color (the fill on every blob; each blob's ID colour with nothing wired), Alpha (Inside × Mask), Local
  UV (as the UV node gives it: Box squeezes the whole frame into the box, Square shows its middle square), Blob UV
  (0–1), Inside, Edge, Slot (0 the oldest blob seen now), ID, Size.
- **Settings**: Fit (Box, Square, Circle), Padding, Fill scale, Spin by ID, Edge softness; Fill: Every blob or One
  blob, Pick by order or ID, Which.
- A Cell node inside the fill chain gives the blob's Slot (x) and ID (y). The fill is only worked out where a blob is.
- The maths is mirrored on the CPU (`blobSpaceAt`) for the tests.

## What is saved

The stack (`CombineSpec`: layers bottom first, each with its product, verb, target, settings, mute, and a picture's
generated depth) lives on the top glue node, `params.combine`. Every glue node has a role (`L2:card:march`) and the
build key. Products keep their own builders' specs, so **Edit product** opens the 3D builder on a 3D layer as
anywhere else; its Done comes back to Combine.

- **Recognize**: the Scene builder lists a Combine build first ("Combined scene · 3 layers · Place in, Replace mask
  with"), found from any of its glue nodes. Edit this one reopens the stack as it was.
- **Rebuild**: the glue is rebuilt whole, ids kept by role. Wires the build set on a product's own nodes (a splat's
  rays, a 3D fill's camera UV, a 3D Agents group's camera) are recorded and put back before every rebuild and when
  the build goes. A glue setting you changed on its node is kept unless the stack changes it; a glue input you
  rewired is kept. Reopening a build with hand edits asks **Keep my edits** (the default) or **Rebuild it**.
- **Start over** takes only the glue; the products are builds of their own.
- **Missing product**: a layer whose product was deleted says "Product missing: pick another"; the rest still build.

## Play

Combine adds no Play controls. Right-click a slider whose value is one glue param (Amount, Nearest, Padding, Bounce,
Speed…, also on the nodes inside an Agents group) for **Add to Play controls** once the stack is in your graph (after
Done, or reopening a build); before Done the menu says why it is off. An expression is never a control; its Make a
slider Constants are, by the same right-click.

## Examples

*Combine: a photo in a room*, *Combine: people → rings*, *Combine: sparks trace a star* and *Combine: fireflies round
a sculpture* (store/combineExamples.ts), built from the presets and opened by key. They aren't in a folder (each keeps
its curated five); they show under Blob Space, Picture Card, Ride a Path and Follow surface (3D Scene).

## Code

`src/combine/`: `spec.ts` (the stack, verbs, the validity matrix), `products.ts` (a product found in the graph),
`build.ts` (the glue), `apply.ts` (into the graph, rebuild, patches, hand edits), `meta.ts` (recognize), `store.ts`,
`actions.ts` (the draft, Add to this…, New… and Edit product round trips), `presets.ts`; phase 2: `glue.ts` (the
pieces glue is made of), `points.ts` (Collide with, Follow the shape), `exprs.ts` (expressions), and the node
`nodes/definitions/agentFollowScene.ts`. The window is
`components/combine/CombineWindow.tsx`; Add to this… is `components/combine/AddToThis.tsx`. Tests:
`src/combine/__tests__/combine.test.ts`, `src/combine/__tests__/combinePoints.test.ts`, `src/nodes/__tests__/blobSpace.test.ts`.
