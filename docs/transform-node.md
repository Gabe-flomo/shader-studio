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

The card follows its Dimension (`previewTypeOf`, `nodeCategory`):

- **Colour**: a 2D / 3D / 4D chip on the header in its category colour (2D Space flamingo, 3D Transforms
  pink, 4D violet). The graph outline and the graph stats count it in that category too.
- **Preview**: in 2D the checkerboard diagram of the 2D space nodes (what any pattern looks like through it,
  Place or Apply); in 3D and 4D a short Move / Rotate / Scale list, as the 3D transforms have. Inside a Scene
  Group it previews like Translate 3D does there.

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

## Switch to Transform

Every old transform card has a **Transform** pill (beside Switch). It replaces the node in place with the
Transform above (`src/nodes/toTransform.ts`), as one undo step: the same id, its wires (a wired Translate /
Angle / Scale goes to Offset / Turn / Grow), its settings (renamed: tx → Move X; converted: an angle in
radians → degrees), keyframes and input expressions with their setting, Play controls retargeted, and the
Scene Group card's overrides renamed. Right-click the pill to switch every old transform node in the graph
(groups included); the ones that can't switch are left, and the message says why.

The pill is greyed out, with the reason on hover, when the switch would change the picture:

- a setting wired that a Transform has no socket for: Translate's X / Y / Z wired one by one, UV Transform
  2D's vec2 Scale, Rotate 3D's Angle (Transform's Turn is all three axes), Rotate 4D's Angle (degrees; Turn
  is radians);
- an angle in radians that is keyframed, on a Play control or set from the group's card (its values would
  need converting too);
- Rotate 2D with nothing in its Input (it turns the point (0, 0); a Transform reads the UV).

`src/nodes/__tests__/toTransform.test.ts` runs each type before and after on the CPU: Transform 2D,
Translate 3D / 4D, Rotate 4D, Scale 3D / 4D and Rotate 2D with a wired angle give exactly the same numbers;
the ones whose angle changes from radians to degrees (UV Transform 2D, Rotate 2D's slider, Rotate 3D) agree
to float rounding (1e-7).

**A tiny rounding difference is said, not blocked.** Those three (with a non-zero angle on the slider) switch,
but the plan carries a note (`TransformPlan.inexact`): "Output may differ by a tiny rounding amount". On the
card the pill reads **Transform ≈**, and clicking it opens the note with **Switch** and **Keep** instead of
switching at once. **Switch all** (right-click), when any switch has that difference, first shows a short list
(`SwitchAllDialog`): the exact nodes and the rounding ones in two groups, each with a switch to leave the whole
group out and a box per node, and the ones that can't switch with why; **Switch N** switches the ticked ones as
one undo step (`previewSwitchAll`, `switchAllChoice` in `toTransform.ts`). With every switch exact, Switch all
switches straight away as before. The toast says "same picture", or how many are up to a tiny rounding
difference. `src/components/NodeGraph/__tests__/switchToTransformChoice.test.tsx` covers the choice flow.

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
- **Rebuilding an older 3D builder scene** (Translate / Rotate / Scale 3D): the old node and the Transform
  that replaces it are the same item. An untouched one rebuilds without a word; a setting you changed on it
  is carried onto the Transform under its new name and unit, and listed as kept. One that can't be carried
  (an older Rotate whose role is now part of the shape's Transform) is listed with what to do.
- **GLSL import**: a rotation (`mat2(c, -s, s, c) * v`, `v * m`, a `rot(a)` helper) becomes a Transform in
  2D, Apply mode: a number angle is its Rotate (degrees), a computed one is wired into Turn.
