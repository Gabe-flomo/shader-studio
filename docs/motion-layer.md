# The Motion layer

*Play layers, 3 Oct 2026. Movement as a layer: a readout for mappings and rules, a matte, and a place particles are born.*

A **Motion** layer watches a source and keeps a grid of where things moved lately. From it come:

- **Readings** (sources and conditions): Amount, Area, Where X/Y, Direction X/Y.
- **A matte**: any layer can show only where it moves ("Show only where it moves"), with Feather and Invert.
- **A birthplace**: a Particles layer's Born → *Where it moves*, In → this layer.
- **A look**: nothing (readings only), the movement itself (like the Finish stack's Motion extract: grey, black or neon), a heat map of the grid, or its matte.

Add it from **Add layer → Picture effects → Motion**. A new one watches the camera when the setup has a Camera layer, else the setup's first Video layer, else the camera.

## Settings

| | |
|---|---|
| **Source** | **Camera** (the webcam; no Camera layer needed, *Mirror* flips it like one), **Picture** (the shader or the Background, everything under the layers), or **A layer** (what one layer draws: a Video layer, particles, a sketch…). A layer it watches keeps running while hidden, like a matte. |
| **Sensitivity** | 0..1, how small a change in brightness counts. The threshold is `0.015 + 0.2·(1 − s)²` (0.065 at the default 0.5; 0.015, about a webcam's noise, at 1). |
| **Delay** | Frames back the frame now is compared with (1–30). Longer catches slower movement. |
| **Smoothing** | 0–0.99, how slowly the grid and the readings follow, per 60th of a second (so 30 and 120 Hz ease alike). 0.85 leaves a trail. |
| **Cell size** | The grid's cell in picture heights: about `1 / cell` rows of square cells. |
| **Show** | Nothing · Movement (Look: Neon, Black, Grey; Gain) · Heat map · Matte. |
| **Feather** | How soft the matte's edge is, in picture heights. |

It **always measures**, hidden or not: the eye and Show only decide what it draws. Every number is a layer number, so the + makes it a control and mappings drive it.

## Readings

All 0..1, under the layer's **Accepts and emits** (live meters, **Map…**, **Signal**), in the condition value picker's *Layer readings* (`read:<id>::<read>`), the mapping source pickers (Sensor → the layer) and the + menu.

| Reading | Key | What |
|---|---|---|
| Motion amount | `motion` | √(the grid's mean): 0 still, about 0.2 a hand waving in a corner, 1 the whole picture moving. |
| Area | `area` | The share of cells moving (above 0.25). |
| Where X / Y | `moveX`, `moveY` | The centre of the movement (weighted by the square of each cell), y up. Held where it was while nothing moves. Also the layer's anchor, so distances and proximity triggers measure from where things move. |
| Direction X / Y | `dirX`, `dirY` | The mean flow: 0.5 still; 1 rightward / upward and 0 leftward / downward at 1.5 picture heights a second or faster. |

**Direction** is a whole-frame Lucas–Kanade estimate: brightness gradients of the two frames (at half the sample size), from the pixels that changed, solved for one shift; then turned into picture heights a second with Delay and the frame step, and eased by Smoothing. It is the mean of everything moving: two hands moving apart read still.

**Triggers for free.** A condition on a reading is a rule: *Amount crosses up through 0.15* = "motion starts", *falls under 0.06* = "motion stops", *Area above 0.35* = "big movement", *Where X rising* = "moving right". **Rules → Behaviours** has three ready-made: **Motion starts** (a layer's first action), **Big movement** (particles burst) and **Motion stops** (hide a layer), each asking for the Motion layer.

## As a matte

Any layer's **Matte → + Where it moves (Motion layer)** adds a hidden Motion layer right above it (watching what a new one watches) as its Alpha matte; or pick an existing Motion layer as the matte. A Motion layer as a matte is always its "where it moves" (white, alpha = a cell half moving is solid, `min(1, 2·grid)`), whatever its Show: the grid blurred by **Feather** (two box passes of Feather ÷ Cell size cells), scaled up smoothly. The matte panel shows its Feather; **Invert** shows the layer where nothing moves. Alpha and Luma read the same (it is white). It also works as the Background's matte.

## Particles born where it moves

Particles → Birth and death → Born **Where it moves** → **In**: *Camera (a Camera layer)* is the old behaviour (the camera's own motion map); a Motion layer uses that layer's grid. Particles are born in a cell in proportion to its movement (the last grid with something moving, so they keep coming from where something last moved). The Motion card's **Add particles born here** makes such a layer. Combined with a matte (particles matted by the same Motion layer) they show only where it moves.

The Studio's **GPU Particles node** is not changed. The grid is a texture in the graph now: the **Motion (texture)** node (Sources; `nodes/definitions/motionMap.ts`, filled by `play/motionTexture.ts` from the first Motion layer after each overlay frame, a frame late) gives **Amount** at a point and the whole grid as a **Texture**, for an Agents group (Emit Picture: born where it moves; a Trail's Add: food where it moves; Sense) or Sample, Glow, Blur. *Follow-up:* the Particles node's own spawn map could read the same texture.

## Everywhere the kit runs

- **The kit** (`src/play/kit/motion.js`, wired in `kit.js`): each frame, before anything draws, every Motion layer samples its source at a fixed size that depends only on the picture's shape (144 rows, at most 320 columns), steps its grid and reports its readings (`<id>::motion` … and `::ax/ay`). A watched layer is drawn once on its own canvas and reused.
- **Offline renders and takes** run the kit frame by frame with fixed steps from `kit.reset(seed)`, so a Motion layer watching the picture or a Video layer (seeked to each frame) gives the same grid and matte every render. A Motion layer is a simulated kind (`SIMULATED_LAYER_KINDS`), so renders warm it up from 0. A live camera is live: a render reads whatever the camera sees then (the Export dialog warns about live feeds, as for Camera layers).
- **Web pages** inline `motion.js` with the kit. A Motion layer watching the camera asks for it (`playUsesCamera`, the runtime's `usesCamera`), hidden or not. When there is no camera or the visitor says no, it reads still: Amount and Area 0, Where held, Direction 0.5; its matte is empty and particles born in it appear anywhere. The output window has no camera of its own (noted there).

## Saved form

```jsonc
{ "kind": "motion", "readFrom": "camera" | "picture" | "layer", "sourceId": "", "mirror": true,
  "sensitivity": 0.5, "delay": 2, "smoothing": 0.6, "cell": 0.04,
  "show": "hidden" | "extract" | "heat" | "mask", "look": "neon" | "black" | "grey", "gain": 3, "feather": 0.03,
  "opacity": 1, "blend": "screen" }
```

Particles gain `"motionId": ""` (absent in older files: the camera's map). Removing a layer clears Motion layers watching it and particles born in it. A Motion layer can be a matte but has no matte or masks of its own.

## Where things live

| | |
|---|---|
| `src/play/kit/motion.js` | the maths: sample size, threshold, grid, readings, flow, looks, heat colours, matte alpha |
| `src/play/kit/kit.js` | stepping before the draw, reporting, Show, the matte canvas, particles' spawn map |
| `src/types/playLayers.ts` | `MotionLayer`, defaults, schema, numbers, `motionWatchers` / `runsWhileHidden` |
| `src/play/motionLayers.ts` | where a new one looks, the source list, cleaning up references |
| `src/play/mattes.ts` | `addMatteMotion` (Where it moves) |
| `src/components/play/layers/MotionEditor.tsx` | the card |
| `src/play/behaviours.ts` | Motion starts, Big movement, Motion stops |

**Example**: Play → *Mattes & masks* → **Motion: reveal and trigger where it moves**: a Watcher on the picture (an orbiting, jumping glow) reveals a photo through its matte, sparks are born in it, a readout follows Where X/Y and shows Amount, and three rules fire on movement starting, getting big and stopping. Switch its Source to Camera or a Video layer to drive it yourself.
