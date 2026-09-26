# The Cloner layer

One layer that makes many copies of a thing, arranges them (grid, ring,
line, along a brush stroke, or on a particles layer's points), gives each
copy an index, and lets the copies vary by that index and by *effectors*:
falloffs around a null or a shape that push, grow, turn, fade, tint or hide
the copies near them. The After Effects / MoGraph "cloner + effector"
pattern, kept small.

**Built (first version).** Add a Cloner in Play's Layers panel. It lives in
`src/types/playLayers.ts` (`ClonerLayer`), draws in `src/play/kit/kit.js`
(`drawCloner`) with the pure parts in `src/play/kit/layers.js`
(`klClonerLayout`, `klClonerCopies`, `klDrawCopy`), and its editor is
`ClonerEditor` in `src/components/play/layers/editors.tsx`. Web exports get
it for free, since they ship the same kit. What follows is the design as
built; the last section says what is left out.

## What a copy is

A copy is a *source*: an existing layer the cloner draws again with a
per-copy transform and tint. Sources that make sense first:

- a **shape** layer (box, circle, polygon, line);
- a **text** or **image** layer (a glyph, a logo);
- a **null** (invisible copies whose positions other things read: particles
  attract to them, a sensor reads them, the graph's Layers node sees them).

The source layer keeps its own settings; the cloner does not edit it. The
source can stay visible or be hidden and only live in its copies.

## Arrangement

| mode | parameters | index order |
| --- | --- | --- |
| **grid** | columns, rows, spacing x/y, jitter | row-major |
| **ring** | count, radius, start angle, sweep (360 = full circle), face centre | around the ring |
| **line** | count, from (x, y), to (x, y) | along the line |
| **path** | count, a **brush** layer's stroke, spread 0..1 | along the stroke |
| **points** | one copy per particle of a **particles** layer, or per glyph of a **glyphs** layer | the source's order |

Every copy gets `i` (0-based) and `t = i / (count - 1)` (0..1), the two
numbers everything below is written against.

## Per-copy variation ("step")

For each of position, scale, rotation, opacity and hue there is a **per
step** amount and a **random** amount (seeded, so it is stable). Copy `i`
gets `base + step × i + random(seed, i) × amount`. This alone gives the
classic MoGraph looks: a staircase, a spiral (ring + rotation step + scale
step), a fan, a scattered field.

## Effectors: falloff around a null or shape

An effector is a **null** or a **shape** layer chosen in the cloner, with a
falloff and a set of deltas:

- **falloff**: radius (picture heights) and softness; inside the radius the
  weight is 1, fading to 0 at the edge with the softness curve;
- **deltas** applied × weight: move (x, y), scale, rotate, opacity, hue
  shift, and **hide** (weight above a threshold hides the copy).

Because a null already follows the mouse or another null on a spring, and
its x/y are already Play sources and controls, "objects grow as the null
comes near" is the default behaviour with no new plumbing. Several effectors
add up. A shape effector uses the shape's own geometry (inside = 1, fading
out over `reach`), so a moving circle can push a wave through a grid.

## Controls, nulls, mappings

Every numeric property of the cloner (count, spacing, radius, step amounts,
effector radius and strength…) is a `LayerNumericProp`, which is what makes
a layer property a Play control today, drivable by a null, an LFO, audio,
MIDI or a mapping curve. So "the effector's strength follows the bass" or
"the ring's radius is null B's x" is the existing right-click → *Make a
control* flow.

## Rendering

The layer kit draws layers in JavaScript with a shared renderer. A cloner
resolves to a list of (transform, tint, opacity) per copy each frame, then
calls the source's draw once per copy with that transform pushed onto the
canvas. Shape sources are cheap; text and image sources cache their raster.
Counts up to a few hundred are fine at 60 fps on a phone; the editor shows
the count and warns past a thousand. `toShader` works the same as for other
layers: the copies are what the graph's Layers node sees.

## Editor

One section per part: **Source**, **Arrangement**, **Step**, **Effectors**
(a list, each naming its null or shape), plus the usual look controls.
On-canvas: the arrangement's handles (grid corner and spacing, ring radius,
line ends) draggable like the transform handles shapes already have.

## Files it touches

- `src/types/playLayers.ts`: `ClonerLayer` interface, defaults, schema,
  numeric props.
- `src/play/kit/layers.js`: `drawCloner` resolving copies and delegating to
  the source's draw; effector weights; the seeded random.
- The layer editor: a Cloner panel with the four sections.
- `docs/`: this page, kept current.

## Not in the first version

- **On-canvas handles** for the arrangement (grid corner, ring radius, line
  ends): the sliders and controls do it for now.
- **Copies as zones.** Copies of a null or a shape are drawn but do not act
  on particles; the original still does.
- **Copies of text and image layers use the "over" matte only** (reveal and
  luma mattes draw the plain layer).
- **Effectors are one falloff shared by every effector layer** chosen; a
  second, different falloff means a second cloner.
- Nested cloners, per-copy time offsets into keyframes, copies as physics
  bodies. Each is possible later; none is needed for the idea to feel good.

## How a copy is drawn

The source is drawn once per frame, at its own place and with its own driven
values, into a scratch canvas; each copy blits that canvas moved from the
source's centre to the copy's, scaled, turned, faded and hue-shifted. Shapes
and text blit only their bounding box, so a few hundred copies stay cheap.
