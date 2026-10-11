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
  and their uniforms, in one store write (`writeParams`: live uniforms, no rebuild, no recompile; a param with no
  uniform, a mode or a string, compiles at once). A change of wiring (an effect added, removed, turned off or moved; the world turned
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
  it, and three rings (red X, green Y, blue Z) turn it round that axis of the world (`place.ts turnAbout`: the turn is
  composed as a matrix and read back as the Splat Scene's X, Y, Z degrees). Sizing and turning keep its middle where it
  is. Each drag is one undo step. The gizmo follows a turning camera (the preview clock, `timeTick.clockNow`).
- **Its own size:** while the window is open the main preview draws at the viewport's size (`lib/previewSize.ts`,
  `LiveViewport ownSize`), so the picture fills the viewport sharp whatever shape the preview panel has; it goes back
  when the window closes.
- **The picture comes first:** the viewport takes the preview's canvas itself (`lib/previewMirror.ts
  adoptPreviewCanvas`: one draw a frame, straight to the screen, no copy), the graph and the node browser behind the
  window are frozen, and the preview skips its readbacks and thumbnails for them (`builders/builderFocus.ts`). All of
  it comes back when the window closes. Measured in [scene-builder.md](scene-builder.md), "The builder's picture comes
  first": orbiting `train.splat` went from 11.4 / 22.9 ms a frame (p50 / p95) with a picture that didn't follow the
  drag, to 5.7 / 6.3 ms following it.
- **A paused clock** still shows the picture: the viewport keeps asking the main preview for a frame until one comes
  (the first ask can land while the Scene builder's kind page still holds the preview), so it shows the last frame
  rather than "the preview is hidden" (that note is only for a preview that really can't draw: its panel hidden). The
  Agent Builder's viewport is the same code.
- **Open as nodes** closes and selects the Splat Scene (its card lists the modifier chain). **Done** closes and frames
  the build on the graph.

## The sections

| Section | What you do there |
|---|---|
| **Scan** | Drop a scan on the picture, **Load…** / **Replace…**, **From the library**, or **Example** (the generated ball or rings). The file's facts (splats, size, format, SH), its thumbnail and its size in units. **Quality**: Fast (500k, SH 0, half resolution), Balanced (2M, SH 1) or Best (4M, SH 3, sorted every frame), and the four settings under it. A new file is fitted to the view once it is read. |
| **Place** | **Fit to view** (its middle at the centre, about 3 units across: the card's Fit to the scene), **Centre**, **Stand on the floor** (its lowest point on the world's floor, or y = −1). Which way is up: **Turn over** (−Y / +Y), **Stand it up** (a scan lying on its back), **Turn 90°**. Position, Turn, Scale, Splat size, Opacity. |
| **Effects** | The Modifier chain as stacked cards: **Dissolve**, **Explode** (Return home), **Wave**, **Colour grade**, **Crop**, **Size & opacity**, **Points**. Add one from the tiles (each a small live picture), drag a card onto another to put it first, or ▲ ▼; the ⊘ mutes one (left out of the chain, kept in the stack: see Muting); 🗑 removes it. The first card applies first. An open card has a live mini preview of that effect on a point cloud, every setting of its node, and **Animate**: an LFO wired into one setting's socket (From → To, Speed). **Your nodes**: a run of nodes you added on the Splat Scene card (Splat Attributes → … → Set Splat, or any splat node) shows as a card of its own, in its place; move it, mute it or take it out of the stack like the others (below). |
| **Scene** | **A world**: a floor (height, colour), shapes (Ball, Box, Ring, Pillar, Pill, Gem: where, size, colour), a light (Studio, Sunset, Night, Overcast), shadows and fog. The world is the 3D Scene Builder's graph (`buildSceneGraph`); the scan is put together with it by distance. **Blending with the world**: Edge softness and Solid at (the Splat Scene's Compositing, written on the scan node); dimmed with "Add a world to blend the scan with it." while there is no world. **Background**: a colour, a gradient, or a picture (the shared picture picker). |
| **Camera** | Distance, Angle, Elevation, Lens, **Turntable** (degrees a second), what it looks at, **Look at the scan**. |
| **Look** | Bloom (intensity, threshold, radius), then Tone (As scanned, ACES, AgX, OkLab, Filmic). |

Sliders are `BuilderSlider`s. Right-click one that sets a node param (an effect's settings, Scale, Splat size, Opacity,
the camera's Distance and Lens, the bloom, an animation's Speed) for the node card's Play menu.

## Effects in the scan's own size

The builder's effect nodes measure **relative to the scan** (each node's `relative` setting, on): their place in the
scan is taken from the scan's middle and divided by its size (its core radius × Scale), and their distances (Explode's
Distance, Wave's Amplitude, Dissolve's Drift) are multiplied by it. Noise scale 1.5 is "patches about a radius / 1.5
across", Crop's Size 1 is the whole scan and Offset −1 … 1 sweeps through it, on a small object and on a whole place
like `train.splat` alike, fitted or not. Explode's Center (sliders) is from the scan's middle, in scan sizes.

The modifier program gets the scan's box as a uniform (`u_spb_<id>`: its middle in its own coordinates and its core
radius, from the file's facts; `compiler/splatGraph.ts`, `lib/splats/render.ts setBox`) and sets `sp_mid`, `sp_midW`
and `sp_unit` for the nodes. Graphs saved before keep scene units: the four nodes are at schema version 2, and older
saved nodes load with `relative` off (`SPLAT_RELATIVE_VERSION`), so they look exactly as they did; nodes made now
(the card's Add a modifier, the node browser) have it on. The examples keep scene units. It is a switch on each
node's card ("Relative to the scan").

## Your nodes

Anything on the Splat Scene's Modifier chain that the builder didn't make (it marks its own nodes by role, `fx:e2`)
is yours: **Edit this one** reads the chain and puts each run of your nodes in the stack as a **Your nodes** card,
after the effect it follows (`apply.ts adoptCustomChains`), named by its nodes ("Splat Attributes → Set Splat"). A
rebuild never builds, changes or removes them; it wires each run in its place: whatever comes before it in the stack
feeds the run's start (every Splat input of the run that came from outside it, and a Splat Attributes reading the same
splat beside it), and the run's end feeds what comes after (`wireRunStart`). Their own wiring stays. Turned off, a run
is left out of the chain; taken out of the stack, its nodes stay on the graph, unwired. Templates and Surprise me keep
your cards (after their own effects); the recipe writes them as `yours tail=<node>`.

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
small world, with the scan stood on its floor (Place → Stand on the floor, by the scan's box as the engine read it);
the camera at a pleasant angle, turning most of the time; bloom when something glows. The same seed gives the same
scene; your scan and its placement stay (with a world, only its height changes); your nodes stay; one undo step. The seed is shown and can be typed (SurpriseBar).

## Muting

Any effect card, your own nodes included, can be muted for a while to see the scan without it: the ⊘ on the
card's header (the same mark as a node's bypass). A muted card keeps every setting and its place in the stack; it
dims and says Muted, and its line in the left nav and the recipe says so too. Each mute is one undo step and is
saved with the scene, so it survives Build and Edit this one. **Alt/Option-click** the ⊘ to solo a card (every other
card muted); do it again to bring them all back.

A muted effect is left out of the Modifier chain: the card before it feeds the card after it, exactly as if it were
not there. The splat chain compiles in the scene's own modifier program, where the live mute gate other builders use
does not reach, so a mute rebuilds the chain (nothing else changes) instead of moving a uniform. In the graph the
muted effect's node is simply not there until you unmute it.

In the recipe a muted card's line has the `muted` flag (`wave muted amplitude=0.02`, `yours muted tail=…`); taking
the word away turns it back on. `off`, the word recipes used before, still reads as muted. Saved scenes from before
are unchanged: the mute is the card's old off switch.

## Under the hood (⌘⇧D)

The scene as a recipe, one line per part, editable (Apply or ⌘↵). ⌘⇧D opens it with the text focused.

```
scan file="train.splat" id=… bytes=32848256 max=2000000 sh=1 sort=moves res=full
place at=(-0.342,-0.54,-0.776) turn=(0,0,0) scale=0.024 up=-y size=1 opacity=1
dissolve amount=0.4 scale=1.6 edge=0.07 edgeColor=(1,0.5,0.15) animate=amount:0.08:0:1
wave muted mode=wobble amplitude=0.02
world on floor=on floor-y=-1 light=sunset shadows=on fog=0.02
shape sphere at=(1.4,-0.6,-0.4) size=0.4 color=(0.85,0.3,0.2)
background gradient color=(0.09,0.1,0.14) color2=(0.02,0.02,0.03)
camera dist=3.6 angle=25 elev=12 fov=1.5 turntable=8 target=(0,0,0)
look tone=aces bloom=on bloom-intensity=0.5 bloom-threshold=0.8 bloom-radius=32
```

An effect line is its kind and its node's own settings; `muted` leaves it out of the chain (`off`, the older word, still reads); `animate=param:speed:from:to`.
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

### Laggy while dragging (fixed)

Dragging a slider or orbiting felt laggy for two reasons. The live sync wrote a change of settings with
`updateNodeParams` without its uniforms, which asks for a full compile 500 ms after the last change: the picture stood
still for the whole drag (0 sorts while orbiting) and jumped half a second after it, with a recompile. And every tick
re-rendered the graph behind the window (cards, wires, minimap, the node browser) and copied the preview into the
viewport. Now one store write a tick carries the params and their uniforms, and the builder's picture comes first
(above).

### A fix it needed

Adding a modifier to a Splat Scene leaves the picture's shader as it was (the chain compiles into its own program),
so the preview took the slider-only path and dropped the chain's new uniforms: an effect added after the scan was
drawn ran with its sliders at 0 (a Dissolve that never dissolved; the card's own **Add a modifier** had the same
problem). `ShaderCanvas`'s param fast path now adds names the uniform table doesn't have yet.

### Bloom without feedback

The old Bloom node blurs the frame before (`u_prevFrame`), which is the finished picture, its own glow included: on a
bright scan the glow fed back into itself frame after frame and washed the picture out. The builder now builds the
same-frame chain the Bloom card's "Upgrade to same-frame glow" makes: Pass → Glow (texture), Bloom → Add glow, so the
glow only ever reads this frame's picture before it is added. The tone map comes after it. Measured on `train.splat`:
the picture's mean brightness 108 with bloom off, 116 with it on, the same 1.5 s and 4.5 s later (it no longer climbs).

## Not yet

- A new file is still fitted to the view (the effects no longer need it, but Fit keeps the camera sliders sensible).
- A run of your nodes that sits first in the chain with its Splat Attributes left unwired keeps reading the splat as
  loaded when it is moved later (wire Attributes into the run, or move it on the card).
- Ray-marched props aren't measured relative to the scan.
