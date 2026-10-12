# Time cube in space: repeat and warp

A Time Cube View's box is a 3D thing, so the space it sits in can be repeated and warped like any other 3D scene:
an endless hall of boxes, a line of them riding a wave, one box whose frames twist along time. The view does this
two ways:

- **Its own settings** (the Space part of the card, and the Time Cube builder's **Space** section): **Repeat** on a
  grid, **Each copy** (a moment, a hue and a turn per copy) and **Warp** (twist, bend, wave, noise). Every slider is a
  live uniform; Repeat and Warp are switches (one recompile each).
- **The Space socket**: a Scene Group with a **Time Cube Shape** in it. The view draws its box wherever that shape
  is, through every warp in the group (Twist 3D, Bend 3D, a displacement, a Warp Builder group) and a **Repeat Scene**
  round it. This is how the rest of the 3D tools apply.

With Repeat and Warp off and nothing in Space, the view compiles exactly as it did before (a test checks that the
shader's `main()` is the same text, for every Time Cube example).

## The approach, and why

Two designs were on the table.

**(a) Do it inside Time Cube View.** The view already marches each ray through its box front to back. Let the
march go from box to box: map each sample point into the nearest box's own space (which copy it is in, then the warp)
and read the frames there.

**(b) A Time Cube shape for the scene raymarcher.** A rounded-box distance in a Scene Group, every space operation
and Repeat Scene for free, with a material that reads the frames where the ray hits.

(b) composes best with the 3D tools, but the March Loop is a surface marcher: it stops at the first surface and
shades that point. The Time Cube's look is a volume: frames before the slice see-through, a crisp slice frame inside
the box, the box behind showing through. With (b) alone, every copy would be an opaque box painted with the frame at
its surface, or the material would need its own march inside the box, which can't follow a warp because only the
scene function knows it.

So the view does both, sharing one march:

- The march is (a): the view's own ray, stepping through space. Between boxes it sphere-traces to the nearest one;
  inside a box it steps through the frames exactly as the single-box view does (the same transfer function, feather,
  key, tint, look), so the soft, see-through look survives. Rays go on through a box to the boxes behind it.
- Where the box is comes from a **space function** applied to every sample: the view's own warp and repeat, or the
  wired **Scene Group** (b), called as a function at every step. The Time Cube Shape in it measures the box at the
  point it is given (already warped by the nodes before it, already moved into its copy by Repeat Scene) and leaves
  that point behind for the view to read the frames at. Any vec3 → vec3 warp a Scene Group can hold works, with no
  inverse needed: every sample is mapped forward, the usual way a distance function is warped.

### What it costs in looks

Kept: the see-through frames before the slice and solid after, the crisp slice frame (drawn where a box's side of
the slice flips between two samples, at the interpolated point), the feather, the colour key with its pulse and
drift, darkness-is-clear, side tint, edge softness (a soft skin over Edge softness, at least a pixel, so silhouettes
are anti-aliased), the rim glow and the silhouette outline (from the closest the ray came to any box), Flow, tilts and
every stack axis.

Left out in space (the switches stay; they come back when Space is off):

- **Highlights** and **Frame motion**. Their exact per-sheet drawing and moved frames need the one box's
  analytic planes.
- The **shadow** and the **box edges** outline. Both are worked out from one box's geometry.

Different from the single box:

- The single box finds its surface exactly (an analytic ray / rounded-box test). In space the surface is found by
  sphere tracing to within half a pixel, then the first stretch inside starts at a random part of a step. Side by
  side with the plain view at the same settings the picture matches; the sides are a touch softer.
- Warps stretch space, so the distance a warped box reports overshoots. Steps are shortened by how much the warp can
  stretch (Amount × Frequency × reach from its axis), never longer than the box's size when warped, and never longer
  than half a cell when repeated (so a turned or warped neighbour isn't stepped over). With a wired Space,
  **Step (wired Space)** (0.6) is that factor, like a March Loop's Step Scale.
- The rim glow follows the closest the ray came to any box, so in a hall it also glows faintly in the gaps.

## Settings (Time Cube View, and the builder's Space section)

| Card | Setting | What it does |
|---|---|---|
| Repeat | Repeat the box | Copies on a grid (switch). |
| | Repeat along | A floor (X and Z), a row (X), a line into the distance (Z), a tower (Y), a wall (X and Y), everywhere. |
| | Gap | Space between neighbouring boxes, in frame heights × Box size. |
| | Copies each side | 0 = forever (up to Far), else this many each side of the middle copy. |
| | Mirror every other | Flips every other copy, so neighbours face each other. |
| | Turn per copy° | A random turn round the upright axis per copy, up to this either way; the cells grow to fit. |
| Each copy | Time per copy | Moves each copy's slice (in Flow, its flow) along by this much of the clip. |
| | Time steps by | Place (one step per copy), distance from the middle (rings), or random. |
| | Hue per copy | A random turn round the colour wheel per copy, up to this. |
| Warp | Warp | Off, Twist (frames turn along time), Bend (time curves up), Wave (time snakes), Noise (wobbly space). |
| | Warp what | Each box (every copy alike, round its own middle) or the whole space (before the repeat, so copies differ). |
| | Amount, Frequency, Speed | Strength; how tightly it repeats along time; animation (Twist and Bend breathe, Wave and Noise travel). |
| Far & fog | Far | How far rays look in space. |
| | Fog | Fades far copies into the Background. |
| | Step (wired Space) | The step factor for a wired Space's warps. |

Each copy's settings use the view's own Repeat or, with a Repeat Scene in Space, its cells (Repeat Scene's
`g_cell3`, recorded by the shape).

The warps work in a frame whose z is the box's time axis (whichever way Stack along puts it), so Twist always turns
the frames round the line of time and Bend always curves time.

## The Space socket and Time Cube Shape

```
Scene Group:  Scene Pos → Twist 3D (or any warps) → Time Cube Shape → Scene Output
                     │
Repeat Scene ◄───────┘ (optional)
     │
     └──► Time Cube View · Space
```

- **Time Cube Shape** (3D Primitives) is the view's box as a shape. The view sets the box's size (`g_tcB`, from its
  Time stretch, Box size and Corner roundness) before it measures the scene. The shape measures its rounded box at its
  Position and, when it is the nearest box so far, keeps that point (`g_tcQ`) and its Repeat Scene cell (`g_tcCell`)
  for the view. Measured by something else (a March Loop alone), it is a rounded box of its own Size.
- The view calls the wired scene function once per step and reads the nearest box's point. Other shapes in that
  Scene Group are not drawn by the view (draw them with a March Loop and wire its Color into Background and its
  Distance into Scene distance, as before).
- The globals are declared by the view when Space is wired, and by the compiler whenever a scene function contains a
  Time Cube Shape (`shaderAssembler.ts`, next to Repeat Cell's).

## Performance

Measured in headless Chrome (ANGLE Metal, Apple M3 Pro), in the app's preview (749 × 806), Ball action clip at the
default 128 frames: the median GPU time of the last 30 frames (`lib/perfStats.ts`), after the volume had loaded.
Every graph ran at 60 fps (the display's rate); the GPU time says how much of the 16.7 ms frame it uses.

| Graph | GPU ms / frame |
|---|---|
| Time cube: a video as a box of time (plain view, Good) | 1.5 – 2.0 |
| Time cube: fly-through (plain view, camera in the box) | 4.2 |
| Twisted time (one box, twist, Good) | 3.4 – 3.8 |
| Time train (endless line, wave on the whole space, Draft) | 4.7 – 5.5 |
| Repeat Scene and 3D warps (5 × 3 twisted boxes via a Scene Group, Draft) | 4.5 – 6.0 |
| Infinite hall (endless floor, Draft) | 5.5 – 6.1 |

What costs what:

- Off, nothing: the plain view's code is unchanged and the space helpers are pruned.
- In space, every step maps a point (a few multiplies for the repeat, a sin/cos pair for a warp, the scene function
  for a wired Space), so a step costs a little more than the plain view's. The march is bounded: Quality's steps plus
  160 for the gaps, and it stops when the pixel is nearly opaque or past Far.
- A hall costs most where rays graze many boxes; Fog lets you lower Far without a hard edge. Draft quality is the
  examples' choice for halls and trains.

## Examples (Time Cube folder)

All use the built-in Ball action clip; every node has a note.

- **Time cube: infinite hall**: the box on an endless floor, each ring of copies a moment later, in fog (Play controls
  for time per copy, gap, fog, hue and the camera).
- **Time cube: twisted time**: one long box with Warp: Twist, breathing.
- **Time cube: time train**: Flow, a line of boxes into the distance, Wave on the whole space, each box later.
- **Time cube: Repeat Scene and 3D warps**: Time Cube Shape behind a Twist 3D in a Scene Group, repeated 5 × 3 by
  Repeat Scene, wired into Space; each copy its own moment and hue.

The builder's presets **Infinite hall of cubes**, **Twisted time** and **Time train** are read from the first three.

## Tests

- `src/lib/timeCube/__tests__/timeCubeSpace.test.ts`: the settings and the socket; off, the plain shader is
  unchanged for every example; repeat on every axis set, mirror, every warp on each box and the whole space, with
  keys, flow, tilt, feather, outline and stack axes, compile and parse (GLSL parser) with live uniforms; Highlights and
  Frame motion left out in space; the Space socket through Twist 3D and Repeat Scene (globals declared once, the scene
  called per step); a Time Cube Shape in a March Loop alone; an empty Scene Group falls back to the plain view; the
  examples; the warps run on the CPU (`glslRun`): amount 0 is the identity, twist keeps time and the distance from the
  axis, twist and bend breathe, wave stays within its reach.
- `src/timeCubeBuilder/__tests__/timeCubeBuilder.test.ts`: the Space section's cards, the presets, the summaries.
- In the browser (headless Chrome, GPU compile and pictures): every example compiles on the GPU with no errors; the
  plain view and the space march match side by side at the same settings.

## Code

- `src/nodes/definitions/timeCube.ts`: the settings (`SPACE_PARAM_KEYS`, `spaceOn`), `TC_SPACE` (hash, warps),
  `spaceMarch()` in Time Cube View's `generateGLSL`, `TimeCubeShapeNode`, `TC_SPACE_DECL`.
- `src/compiler/shaderAssembler.ts`: declares the globals when a scene function holds a Time Cube Shape.
- `src/timeCubeBuilder/spec.ts`, `presets.ts`, `picture.ts`; `src/components/timeCubeBuilder/TimeCubeBuilder.tsx`.
- `src/store/timeCubeExamples.ts`: the four examples.
