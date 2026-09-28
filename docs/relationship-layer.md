# The Relationship layer

A layer that holds **members**, two or more existing layers with a position
(nulls, shapes, text, images, video, the camera, a lens, a cloner, a data
layer, or another relationship), and a **relationship** between them that
moves them every frame like a small force simulation. Members stay ordinary
layers: their X and Y are driven, the way a null following the mouse rides a
spring. The relationship draws nothing (only a debug overlay while editing).

**Built.** Add layer → Particles & physics → **Relationship**. The type is
`RelationshipLayer` in `src/types/playLayers.ts`; the simulation is
`src/play/kit/relationship.js` (pure, no DOM, prefix `rl`), run by the kit
(`src/play/kit/kit.js`, step 1b, right after the null springs) so the app,
takes, offline renders and website exports all run the same code; the editor
is `RelationshipEditor` in `src/components/play/layers/editors.tsx`. Examples:
**Relationship: a chase** (`playChase`) and **Relationship: orbits and the
picture** (`playOrbit`). Tests: `src/play/__tests__/relationship.test.ts`.

## Members

Pick members with the chips in the layer's editor. Each has:

- a **role** (chase only): *chaser* or *prey*. Repel and attract treat everyone alike.
- a **mass**: heavier moves less under the same force (0.1–10).
- a **Picture** reaction (below).

A relationship holds **24 members at most** (`RELATION_MAX_MEMBERS`). Every
pair is looked at every frame (O(n²)), which at that size is a few hundred
distance checks, cheap next to drawing; the cap is there so a setup can't
grow past it by accident.

While a layer is a member its X and Y belong to the relationship: a mapping
on them is ignored, like a following null's. Dragging the member on the
picture (or editing its X/Y) puts it back there and the simulation carries on
from that place. A member that leaves the relationship (or whose relationship
is hidden or deleted) is its own layer again at once.

Units: positions are picture heights with X scaled by the aspect, so a
distance of 0.5 is half the picture's height in any direction; speeds are
picture heights per second.

**In the Layers list**, a relationship's members show tucked under its row
(indented, with a connector line, a colour dot and a role chip — Chaser,
Prey or Member), so it is obvious which layers it drives without opening the
editor. The row shows a member count and a fold arrow (collapse/expand,
remembered per layer). A member in several relationships nests under the
first one, by list order, and carries a small "+N" chip for the others.
Selecting the relationship row highlights its members' rows faintly, and
selecting a member outlines its relationship row. The nesting is
display-only — it never changes the layers' actual order (their z-order, and
what a drag reorders): a member dragged elsewhere in the list is still a
member; only the editor's chips take it out of the relationship. See
`src/play/relationshipNesting.ts` and `LayersPanel.tsx`.

## Kinds

**Chase / Follow.** Each chaser looks for the closest prey within its
**Sight** and runs at it (**Speed**, **Acceleration**, **Turn rate**: a low
turn rate makes wide arcs). With nothing in sight it **wanders**: a slow walk
along a smooth noise of the clock, so it is the same in every run. Prey runs
from any chaser within its **Flee distance**, at 85% of the speed (so a chase
in the open ends in a catch, not a stalemate); otherwise it wanders a little
too. One chaser with many prey, or one prey with many chasers, both work.

**Repel.** Every pair closer than **Repel within** pushes apart. The **curve**
is linear (fading evenly to nothing at the distance) or inverse square
(gentle far off, hard when they nearly touch), times **Strength**.

**Attract.** Every pair pulls together, in one of two modes:

- **Keep a distance**: they are pulled together until **Keep apart**, and
  can't cross it. At the boundary a soft spring (its stiffness is
  **Springiness**) pushes back and the closing speed rebounds by
  **Bounciness**, so they jostle rather than stick.
- **Overshoot**: gravity-like. **Falloff** 0 pulls as hard from far as from
  near; 1 falls off as the inverse square. They pass through each other and
  orbit (a heavy member is a sun).

## Motion

- **Springiness**: how stiff the soft contacts are (the keep-apart boundary and a Repel wall).
- **Bounciness**: how much of a bounce is kept at a wall or the boundary (0 barely rebounds).
- **Damping**: how quickly motion dies out. 0 keeps every push; orbits want it near 0.
- **Max speed**: a cap on any member's speed.

The simulation takes two substeps of at most 50 ms each per frame, so a slow
frame can't fling anything through a wall.

## Walls

Per role (chasers, prey; or members): what happens at the picture's edge.

| Wall | What happens |
| --- | --- |
| **Bounce** | Rebounds off the edge, keeping Bounciness of its speed |
| **Repel** | A soft boundary a tenth of the picture inside the edge pushes it back (Springiness) |
| **Wrap** | Leaves one side, comes in from the other |
| **Respawn** | Leaving the picture puts it at **Respawn at** at once |
| **Escape** | May leave the picture. Out there it is out of sight (a chaser loses it and wanders) and out of every force; after **Respawn after** seconds it comes back at **Respawn at** |

**Respawn at**: a random place, the layer's own X/Y (**Its own place**), or
the **far side**: the edge point farthest from the chasers.

## Catches

A chaser within **Catch radius** (plus a small radius of its own and the
prey's) of a prey catches it: **Catches** counts up, **Catch** pulses to 1,
and the **signal** picked under Catch (or made with New signal) fires. A pair
is caught once per approach: it has to move to two and a half times the reach
apart before it can be caught again. **Then**: nothing, respawn the prey (at
Respawn at), or **swap roles** (the caught becomes the catcher, until the
layer is reset). The signal drives actions and trigger mappings like any
other: burst particles, step the text, flash a colour.

## Readings

Shown live with meters under **Readings** in the editor, mapped with Map…,
listed as **Layer sensor** in the source picker, and usable in conditions
through a mapping (`map:<mapping>` in a When a value… trigger). All 0..1:

| Reading | What it is |
| --- | --- |
| **Gap** | The closest pair's distance (a chase: the closest chaser and prey); 1 is a picture height or more |
| **Closing** | How fast that pair is closing in: 0.5 neither, 1 closing at Max speed, 0 parting at Max speed (the dot of their relative velocity and the line between them, normalised) |
| **Chase speed** | The chasers' mean speed (repel and attract: everyone's) against Max speed |
| **In sight** | 1 while any chaser has prey in sight |
| **Catch** | 1 on the frame of a catch, fading out over a quarter of a second |
| **Since catch** | Seconds since the last catch, 1 at ten or more (and before the first) |
| **Catches** | The count so far, 1 at twenty or more |
| **Picture** | The mean picture value under the members (see below) |
| **Distance** | To any other anchor, like every positioned layer |

The relationship's own anchor (for proximity triggers and distances) is its
members' centroid.

## The picture

Each member can also react to the **picture** under it, the shader or
whatever the Background shows, on top of the relationship's forces:

- **Picture**: off, **climb** (move toward higher values) or **descend** (away from them).
- **channel**: brightness (default), red, green, blue, hue, saturation, or **a layer's alpha** (pick the layer: text, a shape, an image, a script…).
- **Looks**: how far around it it samples, in picture heights. Eight samples on that ring give the gradient it climbs, so it feels the slope rather than one pixel.
- **Strength** (`m<n>_picture`, a mapping target per member, shown on the layer once its Picture is on).

The picture is the kit's coarse 64 × 36 grid, the same one particle flow
fields and the bodies' solid picture read; a layer channel is that layer as
it was drawn last frame, on the same grid. Nothing is read back beyond that,
so it is cheap; and offline renders have the picture per frame, so it is
deterministic there. The value under each member is reported as that member's
**Picture** reading (`<memberId>::picture`; every positioned kind lists it).
With the overlay on, the picture's pull on each member is a green arrow.

## Relationships of relationships

A relationship can be a member of another. To the parent it is one body at
its members' **centroid**, with mass the larger of its own and its member
count; whatever the parent does to that body moves every member of the child
by the same offset, on top of the child's own forces (the child runs first).

Limits, on purpose: only the offset is passed down (no rotation, no
squash), a group's own spread is not a collision shape for the parent, and a
cycle (A holds B holds A) runs each layer once with the loop's last link
ignored; nesting is followed four levels deep.

## Determinism

In a take or an offline render every random choice (a respawn point, a
wander seed) comes from the kit's seeded source, and the wander walk is a
function of the clock, so the same seed and frame times give the same motion;
`relationship.test.ts` runs a chase twice and compares every position. Takes
record the members' places like they record following nulls, and while a
take plays back or renders those recorded places win over the simulation.

## Web exports

`relationship.js` is inlined with the kit (`KIT_SOURCES` in
`src/play/exportHtml.ts`), so exported pages run the same simulation; the
runtime fires the catch signal from the `<id>::caught` count the same way the
app does (`tickRelationshipSignals` in both).

## The file

```json
{
  "id": "chase", "kind": "relationship", "label": "Chase", "visible": true, "toShader": false,
  "members": [
    { "id": "hunter", "role": "chaser", "mass": 1, "picture": "off", "channel": "brightness", "layerId": "", "radius": 0.06 },
    { "id": "prey", "role": "prey", "mass": 1, "picture": "climb", "channel": "brightness", "layerId": "", "radius": 0.08 }
  ],
  "relation": "chase", "speed": 0.55, "accel": 2.5, "turn": 0.5, "sight": 0.55, "flee": 0.3, "wander": 0.6,
  "strength": 0.6, "repelDistance": 0.3, "repelCurve": "linear", "attractMode": "overshoot", "minDistance": 0.2, "falloff": 0.5,
  "springiness": 0.5, "bounciness": 0.3, "damping": 0.3, "maxSpeed": 1,
  "wallChaser": "bounce", "wallPrey": "escape", "respawnAt": "far", "respawnDelay": 1.2,
  "catchRadius": 0.03, "onCatch": "respawn", "catchSignal": "caught", "debug": true,
  "m1_picture": 1, "m2_picture": 1
}
```

Unknown members (a deleted layer) are dropped on load; deleting a layer takes
it out of every relationship.

## Not yet

- Members' own shapes as collision bodies (everything is a point with a small radius).
- A member's rotation following its heading.
- Group rotation and squash for nested relationships.
