# Transform

One node that moves, turns and scales a point in **2D, 3D or 4D** (`src/nodes/definitions/transformAny.ts`).
It is the default transform: the builders, recipes, the Do bar, suggestions and smart 3D placement make it.
The single-purpose nodes (Transform 2D, UV Transform 2D, Rotate 2D, Translate / Rotate / Rotate Axis / Scale 3D,
Translate / Rotate / Scale 4D) stay in the library and in saved graphs, unchanged.

## The card

- **Dimension** (2D, 3D, 4D): the sockets follow it (vec2 / vec3 / vec4). A wire that no longer fits comes off.
- **Mode**
  - *Place the shape* (default): the shape is moved, turned and scaled. The point is moved back, turned
    back (last turn first) and divided by the scale. Wire **Local** into a shape's Position.
  - *Apply to the point*: the point itself is scaled, turned about the **Pivot**, then moved. This is what
    UV Transform 2D, Rotate 2D, Rotate 3D and Scale 3D do, so the picture moves the opposite way.
- **Position** (always open): Move X / Y (/ Z / W), and the Pivot in Apply mode.
- **Rotate** (folded, "Rotate 30°"): one angle in 2D; Rotate X, Y, Z in 3D (applied X, then Y, then Z);
  six plane turns in 4D (XY XZ XW YZ YW ZW). **Spin** keeps turning (degrees a second) about one axis (3D)
  or in one plane (4D).
- **Scale** (folded, "Scale 1.0"): one Scale, and **Stretch per axis** for a scale per axis.

Folded sections remember their state per card for the session, like every sectioned card.

## Sockets

| In | | Out | |
|---|---|---|---|
| Position | the point (unwired in 2D: UV) | Local | the transformed point |
| Offset | added to Move (a motion) | Scale | how much bigger the shape is drawn: multiply its distance by it |
| Grow | multiplies Scale | Distance | Distance (in) put back in true units |
| Turn (rad) | added to Rotate (2D: the angle; 3D: X, Y, Z; 4D: the Spin plane) | | |
| Distance (in) | a shape's distance | | |

One node can't be on both sides of a shape (that is a loop), so the distance half of a scale is a second
Transform with the same Scale, its Distance sockets wired (the 3D Scene Builder writes it that way).

## What it covers

Each row is checked in `src/nodes/__tests__/transformParity.test.ts` (the GLSL of both run on the CPU).

| Old node | Transform settings |
|---|---|
| Transform 2D (Place 2D) | 2D, Place; UV → Position, Offset / Turn / Grow the same |
| UV Transform 2D | 2D, Apply; Pivot, Stretch per axis; Translate → Offset, Angle → Turn (a wired vec2 Scale has no socket: use Stretch) |
| Rotate 2D | 2D, Apply; Angle → Turn (or Rotate in degrees) |
| Translate 3D / 4D | 3D / 4D, Place, Move |
| Rotate 3D | 3D, Apply, Rotate on that axis (or Place with the angle negated) |
| Scale 3D | 3D, Apply, Scale; its distance half on Distance |
| Rotate 4D | 4D, Place, the plane's turn and Spin in that plane |
| Scale 4D | 4D, Place, Scale; its distance half on Distance |

Not covered, and still the node for the job: **Rotate Axis 3D** (a turn about any axis, axis-angle) and
**Transform Vec** (an expression per component).

## Where it comes from

- **Browser**: listed first in 2D Space › Basic, 3D Transforms › Move (added as 3D) and 4D Space (added as 4D).
- **Search**: first for transform, move, translate, place, position, rotate, turn, scale, offset; the specific
  nodes follow.
- **Dimension when added**: 3D inside a Scene Group or Space Warp Group, and on the top level of a graph with a
  March Loop; 2D otherwise (`transformDimHere`, `src/nodes/addScope.ts`). A 3D Transform added on the top level
  goes into the scene there, or gets its own Scene Group, camera and loop, like Rotate 3D (`smart3d.ts`,
  `scene3dShapes.ts`); a 4D one gets a Lift to 4D before it.
- **Do bar**: `create rotate`, `add move`, `create translate 3d`, `create transform 4d`… make a Transform in the
  dimension named. The old nodes are still made by their type name (`create rotate3d`), which is how a printed
  recipe names them.
- **Builders**: the 2D Scene Builder places shapes, rings, zoom, move and rotate with Transform; the 3D Scene
  Builder writes a shape's place and turn as one Transform and Move / Turn / Rotate / Scale as one each (Describe
  reads both these and the older Translate / Rotate / Scale 3D graphs). A shape added beside another is moved
  aside by a Transform. The Drifting smear recipe and the Zoom / rotate suggestion use it too.
