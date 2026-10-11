# Splat builder

The Splat builder is the Scene builder's **Splat scene** kind: a window for putting a Gaussian splat scan on screen
and changing it without wiring. It writes the graph you would wire by hand ([splat-scene.md](splat-scene.md)): a Splat
Scene, its Modifier chain (one recipe node per effect), a March Camera, and, when you want one, a ray-marched world
from the 3D Scene Builder's own builder. Every node has a note. Every number is a node param, so it is a live uniform.

## Opening it

- **Scene builder → Splat scene** (the kind page's fifth card, a point cloud dissolving). The kind page asks to clear a
  graph no builder made first, as for every kind ([scene-builder.md](scene-builder.md)).
- **A splat scene the builder made:** the Scene builder offers **Edit this one** (it reopens from the spec saved on the
  Splat Scene), Start over or Add another. Right-click any node of it → **Edit in Splat builder** does the same.

## Built as you go

The scan is drawn by the main preview's raster pass, so the builder's picture **is** the main preview, mirrored
(`LiveViewport`, as in the Agent Builder), and every change is built into the graph at once
(`splatBuilder/actions.ts`):

- opening on a new scene builds it: one undo step, "Splat builder: built a splat scene";
- after that each change is synced quietly, once a frame at most. A change of settings only writes the nodes' params
  (live uniforms: no recompile). A change of wiring (an effect added, removed, turned off or moved; the world turned
  on) rebuilds, keeping every node's id by its role (`fx:e2`, `camera`, `scan`, `w:march`…), so Play controls stay
  pointed at them (`paramDiff` decides which);
- closing (Done, ×, or back to the kinds) makes the whole session one undo step, "Splat builder: changed the splat
  scene". Inside the window ⌘Z / ⌘⇧Z undo the builder's own history and the graph follows.

A rebuild keeps a setting you changed by hand on a node when the builder hasn't changed it since (the Grid builder's
fingerprints, `apply.ts`).

## The window

```
┌ Scene builder › Splat scene ── undo · redo · Under the hood · Surprise me (seed) · Open as nodes · Done ┐
│ Sections, each with a   │         the scan, live and big: drag to orbit,       │ the section's     │
│ one-line summary        │         scroll to zoom, the Place gizmo              │ settings          │
├─────────────────────────┴──────────────────────────────────────────────────────┴───────────────────┤
│ templates, as pictures                                                                              │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Viewport** (`components/splatBuilder/SplatViewport.tsx`): drag to turn the camera round (Angle, Elevation), scroll
  to come closer (Distance). In **Place** the scan has the 3D Scene Builder's gizmo (`sceneBuilder/viewMath.ts`, March
  Camera's own maths): the white middle moves it across the picture, X / Y / Z along one axis, the yellow square sizes
  it, the purple ↻ under the ring turns it round the vertical. Sizing and turning keep its middle where it is. Each drag
  is one undo step. The gizmo follows a turning camera (the preview clock, `timeTick.clockNow`).
- **Open as nodes** closes and selects the Splat Scene (its card lists the modifier chain). **Done** closes and frames
  the build on the graph.

## The sections

| Section | What you do there |
|---|---|
| **Scan** | Drop a scan on the picture, **Load…** / **Replace…**, **From the library**, or **Example** (the generated ball or rings). The file's facts (splats, size, format, SH), its thumbnail and its size in units. **Quality**: Fast (500k, SH 0, half resolution), Balanced (2M, SH 1) or Best (4M, SH 3, sorted every frame), and the four settings under it. A new file is fitted to the view once it is read. |
| **Place** | **Fit to view** (its middle at the centre, about 3 units across: the card's Fit to the scene), **Centre**, **Stand on the floor** (its lowest point on the world's floor, or y = −1). Which way is up: **Turn over** (−Y / +Y), **Stand it up** (a scan lying on its back), **Turn 90°**. Position, Turn, Scale, Splat size, Opacity. |
| **Effects** | The Modifier chain as stacked cards: **Dissolve**, **Explode** (Return home), **Wave**, **Colour grade**, **Crop**, **Size & opacity**, **Points**. Add one from the tiles (each a small live picture), drag a card onto another to put it first, or ▲ ▼; the switch turns one off (left out of the chain, kept in the stack); 🗑 removes it. The first card applies first. An open card has a live mini preview of that effect on a point cloud, every setting of its node, and **Animate**: an LFO wired into one setting's socket (From → To, Speed). |
| **Scene** | **A world**: a floor (height, colour), shapes (Ball, Box, Ring, Pillar, Pill, Gem: where, size, colour), a light (Studio, Sunset, Night, Overcast), shadows and fog. The world is the 3D Scene Builder's graph (`buildSceneGraph`); the scan is put together with it by distance. **Background**: a colour, a gradient, or a picture (the shared picture picker). |
| **Camera** | Distance, Angle, Elevation, Lens, **Turntable** (degrees a second), what it looks at, **Look at the scan**. |
| **Look** | Tone (As scanned, ACES, AgX, OkLab, Filmic) and Bloom (intensity, threshold, radius). |

Sliders are `BuilderSlider`s. Right-click one that sets a node param (an effect's settings, Scale, Splat size, Opacity,
the camera's Distance and Lens, the bloom, an animation's Speed) for the node card's Play menu.

## Templates

Each drawn as a small point-cloud picture. They bring effects, world, camera and look; **your scan and where you put it
stay** (on the example scan, the template's own placement).

| Template | What it is |
|---|---|
| Turntable | the scan turning slowly on a gradient, a light grade |
| Dissolve reveal | Dissolve with Amount on an LFO, a glowing edge, bloom |
| Exploded view | Explode on an LFO and a wobble |
| Hologram | Points, a cyan tint, a scan line (Crop's Offset on an LFO) and a shimmer, bloom |
| Scan in a scene | the scan on a floor with a ball and a pillar, a low sun |
| Cut reveal | a glowing plane sweeping up through the scan |

## Surprise me

`splatBuilder/surprise.ts`: a look from a seed (a reveal, a scatter, a hologram, a grade, a wave or a cut), one to four
effects with settings in ranges that read well, usually one animated; a calm background from one hue; now and then a
small world; the camera at a pleasant angle, turning most of the time; bloom when something glows. The same seed gives
the same scene; your scan and its placement stay; one undo step. The seed is shown and can be typed (SurpriseBar).

## Under the hood (⌘⇧D)

The scene as a recipe, one line per part, editable (Apply or ⌘↵). ⌘⇧D opens it with the text focused.

```
scan file="train.splat" id=… bytes=32848256 max=2000000 sh=1 sort=moves res=full
place at=(-0.342,-0.54,-0.776) turn=(0,0,0) scale=0.024 up=-y size=1 opacity=1
dissolve amount=0.4 scale=1.6 edge=0.07 edgeColor=(1,0.5,0.15) animate=amount:0.08:0:1
wave off mode=wobble amplitude=0.02
world on floor=on floor-y=-1 light=sunset shadows=on fog=0.02
shape sphere at=(1.4,-0.6,-0.4) size=0.4 color=(0.85,0.3,0.2)
background gradient color=(0.09,0.1,0.14) color2=(0.02,0.02,0.03)
camera dist=3.6 angle=25 elev=12 fov=1.5 turntable=8 target=(0,0,0)
look tone=aces bloom=on bloom-intensity=0.5 bloom-threshold=0.8 bloom-radius=32
```

An effect line is its kind and its node's own settings; `off` leaves it out of the chain; `animate=param:speed:from:to`.
Each effect line takes the id of the scene's next effect of its kind, so editing the text keeps the nodes. A scan
named by `file=` must be loaded (its `id` is the library's). Lines it can't read are listed; the rest applies.

## Code

| | |
|---|---|
| `src/splatBuilder/spec.ts` | the spec, effects, quality presets, summaries |
| `src/splatBuilder/build.ts` | spec → graph (`buildSplatGraph`), roles, the world from `sceneBuilder/build.ts` |
| `src/splatBuilder/apply.ts` | into the graph and rebuilt by role (`applySplatScene`), `paramDiff` for the live sync |
| `src/splatBuilder/actions.ts` | open, Edit this one, the live sync, the session's undo step, Done, Open as nodes |
| `src/splatBuilder/place.ts` | the scan's middle, Fit, Centre, Stand on the floor, turns that keep the middle |
| `src/splatBuilder/templates.ts`, `surprise.ts`, `recipe.ts` | templates, Surprise me, the recipe text |
| `src/splatBuilder/miniCloud.ts` | the CPU point cloud the pictures use (each effect, roughly) |
| `src/components/splatBuilder/` | the window, the viewport, the sections, `MiniCloud` |

Tests: `src/splatBuilder/__tests__/splatBuilder.test.ts` (every template and effect compiles, the stack is the chain
in order, reopen as built, hand edits kept, the live sync and its undo steps, Surprise me, the recipe, Place's maths)
and the kind page in `src/components/builders/__tests__/sceneBuilderShell.test.tsx`.

### A fix it needed

Adding a modifier to a Splat Scene leaves the picture's shader as it was (the chain compiles into its own program),
so the preview took the slider-only path and dropped the chain's new uniforms: an effect added after the scan was
drawn ran with its sliders at 0 (a Dissolve that never dissolved; the card's own **Add a modifier** had the same
problem). `ShaderCanvas`'s param fast path now adds names the uniform table doesn't have yet.

## Not yet

- Effects measure in scene units, so they read best on a fitted scan (a new file is fitted for you; a scan of a
  whole place fits small: scroll in).
- The gizmo turns only round the vertical; the other turns are sliders.
- Surprise me's world doesn't stand the scan on its floor (it doesn't know the scan's box): Place → Stand on the floor.
- No custom node chains (Splat Attributes → your nodes → Set Splat) from the builder: add them on the card; a rebuild
  replaces the chain the builder made.
- The viewport is the main preview's shape; a narrow preview gives a narrow picture.
