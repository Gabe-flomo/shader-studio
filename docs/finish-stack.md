# The Finish stack

Play's **Finish** tab: colour grading, lens and screen effects, film effects,
camera shake and time displacement over the **final** picture, the shader and
every layer together. One ordered stack per Play record (`play.finish`).

- Engine: `src/play/kit/finish.js` (+ `finishGlsl.js`, shared with the Studio's
  Tone Map and CRT Mask nodes). Part of the layer kit, so the app and exported
  pages run the same code.
- Record, parsing, control targets, Looks, custom effects' records:
  `src/types/playFinish.ts`.
- Stack presets and Your effects (the device's lists): `src/play/finishLibrary.ts`.
- UI: `src/components/play/finish/` (`FinishPanel`, `CurveEditor`,
  `ColourWheel`, `CompareHandle`, `savedLooks`).
- Tests: `src/play/__tests__/finish.test.ts` and `finishFollowups.test.ts`
  (the wipe, custom effects, presets, the library); node packs carrying
  effects in `src/nodePacks/__tests__/nodePacks.test.ts`.

## Where it runs

| Place | How |
| --- | --- |
| Play preview, Stage (Full) | `play/overlay.ts` draws the layers as usual, then `fnCreate`'s renderer composites the WebGL picture and the layers' canvas into its own WebGL2 canvas, stacked above both. Null markers, hands and handles go on a separate guides canvas above that, so they are never graded or bent. |
| Recordings (MediaRecorder) and PNG snapshots | `startCompositing` / `snapshot` copy the finished canvas instead of picture + layers. |
| Takes, offline renders (FFmpeg, PNG sequence), transparent stills | `compositePixels` → `finishPixels`: the frame's RGBA goes through a second renderer (so the live preview's time ring is untouched) in pixels mode and is read back in place. Frame-exact: grain, flicker and shake are functions of the frame's time, and the time ring starts over on the first frame. |
| Exported websites, Stage (Exact), Present | `play-runtime.js` creates the same renderer over its canvases when `SSKit.finish.active(play.finish)`. Mapped numbers drive it through the runtime's layer-property path. |

With no effects, the stack bypassed, or every effect off, nothing is created and
there is no extra pass: `fnActive(finish)` is false.

WebGL2 is required (texture arrays, multiple render targets, half floats). Without
it the renderer reports `ok: false` and the picture shows unfinished.

## The pass

One fragment shader is built from the effects that are on (`fnBuildFinal`),
compiled once per structure and cached. Numbers are uniforms (one `vec4[]` per
effect), so dragging a slider or a mapping never recompiles.

1. **Geometry**, last effect first: camera shake, lens distortion, CRT
   curvature bend where the picture is read.
2. **Sampling**: chromatic aberration reads red and blue at offset points; time
   displacement chooses which frame each point reads.
3. **Colour**, in the stack's order: grade, vignette, CRT mask, bloom, halation,
   grain, flicker, and your own effects wherever they sit in the stack.
4. **The before/after wipe**, last: where it shows the picture before the stack,
   that is what is drawn (and the stack isn't run there at all).

Extra work only when asked for:

- **Glow** (bloom, halation, CRT glow): a quarter-size prefilter into two
  render targets (bloom and halation at once), then a quarter, an eighth and a
  sixteenth, each blurred with a separable 9-tap Gaussian: seven tiny passes.
  Half-float when `EXT_color_buffer_float` is there, else 8-bit with an
  `x / (1 + x)` encoding.
- **Time**: a `TEXTURE_2D_ARRAY` ring of reduced frames, written after the final
  pass.
- **Curves**: baked into a 256 × 2 `RGBA8` lookup when they change.

## Grade

Lumetri-style sections on one card:

- **Look**: starting points that only set the grade's own controls (Teal &
  orange, Bleach bypass, Faded print, Cross-process, Mono with toned shadows,
  Warm film, Day for night). Save your own with the disk button; saved looks
  live in `localStorage` (`shader-studio:finish-looks`) like palette presets.
- **Basic**: Exposure (stops, in linear light), Contrast (an S around 0.5 that
  never clips), Highlights, Shadows (luma-masked gammas), Whites, Blacks
  (levels), Temperature, Tint (luminance-preserving white balance in linear
  light), Vibrance, Saturation.
- **Curves**: RGB master and R/G/B (monotone cubic, Fritsch–Carlson: no
  overshoot), plus Hue vs Sat, Hue vs Hue (periodic Catmull-Rom) and Luma vs
  Sat. Click to add, drag, drag out or double-click to remove.
- **Colour wheels**: lift / gamma / gain, `x' = (g · (x + l · (1 − x)))^(1/γ)`;
  the puck pushes toward a hue with no brightness of its own, the slider is the
  level.
- **Split toning**: highlight hue and amount, shadow hue and amount, balance.
- **HSL secondary**: a hue range (centre, width, softness) and its hue shift,
  saturation and luminance.
- **Tone and amount**: the Tone Map node's modes, applied in linear light after
  exposure and white balance; Amount fades the whole grade.

`fnGradePixel` is the same maths on the CPU. The tests check it on known
values, and a browser check compared it with the GPU on 64 pixel/grade pairs:
worst difference 1.4 / 255.

## Lens, screen and film

| Effect | Numbers |
| --- | --- |
| Lens distortion | Distortion (barrel/pincushion), Edges (r⁴), Fill frame (auto-zoom so a barrel never shows past the edge) |
| Chromatic aberration | Amount, Falloff (radial) |
| Vignette | Amount, Size, Roundness, Feather, Colour |
| CRT | Curvature, Scanlines, Mask, Cell size, Stagger, Glow, Pulse. The mask is the CRT Mask node's GLSL. |
| Bloom | Amount, Threshold, Radius, Tint |
| Halation | Amount, Reach, Threshold, Highlight headroom, Warmth, Growth; presets Subtle, Classic cine, Strong |
| Film grain | Amount, Size (px at 1080p), Colour, Response (to brightness), Frames a second (0 holds it) |
| Flicker | Amount, Speed |
| Camera shake | Amount, Speed, Rotation, Gate weave; zoomed to hide the edges |

### Halation

Modelled on how it happens in film: light strong enough to pass through the
emulsion bounces off the film's back and re-exposes it from behind, reaching the
red-sensitive layer first.

1. The prefilter decodes each pixel to linear light and estimates **scene
   energy** with an inverse shoulder (`fnEnergy`): below a knee (0.75 linear)
   nothing changes; above it the tones squeezed toward white open up so that
   display 1.0 becomes `2^headroom`. It does this per pixel, before averaging, so
   a one-pixel lamp keeps its energy.
2. Three source terms, each a soft-knee threshold scaled by how far above it the
   energy is: **red** from the red channel's energy, **green** from green (at 1.5×
   the threshold, weaker), **white** from blue (at 4×, weakest: only extreme
   light). A colour with little red makes no red halo.
3. Red is taken from the wide levels (eighth and sixteenth, by Reach), green from
   the quarter and eighth, white from the quarter only: red widest, white tight.
4. Added back in linear light as `x + (1 − x)(1 − e^(−halo))`, which saturates
   gently toward white instead of clipping, then re-encoded.

So the halo goes red → warm red-orange → white as the source gets brighter, and
the white term makes very bright sources look bigger.

**Limit of the 8-bit estimate.** Everything the finish sees is an 8-bit canvas,
so a white card that clips at 1.0 is indistinguishable from a lamp. The
`finishHalation` example keeps paper at 0.90 (as a correctly exposed picture
would) and shows what happens when it's pushed to 1.00.

**Follow-up: the shader's own HDR.** When the graph ends in a Tone Map node,
the Studio already renders it into a float target. Exposing that pre-tone-map
colour to the Finish stack (a define that skips the final Tone Map, the Finish
pass applying the same mode afterwards) would give halation and bloom real
super-whites. It needs the Finish pass to run in the graph's own WebGL context
(or a second, encoded readout of the picture), so it is left for a follow-up.

## Time displacement

The last N frames, reduced, in a texture array; each pixel reads the frame its
map points at, blending between neighbours (Smooth). Maps: slit-scan (Direction),
brightness, noise (Scale, Speed), radial (Centre), or a layer's alpha (the kit
draws that layer alone, even when hidden, through `env.alphaLayers`).

| Quality | Frames | Size | Cap |
| --- | --- | --- | --- |
| Low | 16 | ¼ | 8 MB |
| Medium (default) | 32 | ½ | 20 MB |
| High | 64 | ½ | 48 MB |

The size shrinks further until the ring fits its cap (`fnRingSize`); at 1440 × 900
Medium keeps 32 frames at 472 × 295 (18 MB). Frames back is capped by the frames
kept. Offline renders start the ring over on their first frame and fill it in
order (`fnRing`), so a render is identical every time.

## The before/after wipe

`finish.compare` is `{ on, pos, angle, softness }`: a divider across the
picture with the picture **before** the stack on one side and the finished one
on the other.

- **Before / after** in the Finish tab turns it on and shows the **Before /
  after wipe** card: Position (0..1 along its direction; 0 is all finished, 1
  all before), Angle (degrees; 0 is upright with *before* on the left, 90 level
  with *before* below) and Softness (the width of the blend).
- It is part of the record: it is saved, and drawn in the preview, Stage,
  recordings, takes, offline renders, stills, exported websites and Present.
  Off, the pass skips it (`uWipe.x = 0`).
- Its numbers are control targets under the id `compare`:
  `finish:compare::pos`, `::angle`, `::softness`. An LFO on Position is a
  moving wipe; the mouse, audio or a hand work as for any number.
- The grip on the picture (`CompareHandle`, while the Finish tab is open) moves
  `pos` along the wipe's direction and follows its angle. While a mapping
  drives the position or angle, the grip hides (it would show where the wipe
  rests, not where it is).
- In the pass: `fnWipe(p)` measures `p` along the direction
  `(cos angle, sin angle)` in the frame's aspect, 0..1 corner to corner (the
  slit-scan map's measure), then `step` or `smoothstep` around `pos`.

The editing-only divider it replaces (`uCompare`, the Play UI's `compare`
state) is gone: the wipe is the one divider.

## Stack presets

**Presets** in the Finish tab:

- **Save stack as preset…** keeps every effect in order with every setting:
  curves, the grade's tone and look, custom effects with their code. The wipe
  stays with the Play. The same name replaces the older preset.
- Each preset has **Replace stack** (its effects, and nothing else), **Add to
  stack** (after the stack's own; a built-in kind already in the stack is
  skipped and named in a note, since the stack has one of each), **Rename…**
  and **Delete**. Loaded effects get new ids, so they never collide with the
  stack's effects or their controls.

Stored in `localStorage` as a list, `shader-studio:finish-presets`
(`{ id, name, savedAt, finish }`, checked with `parseFinish` when read).

## Custom effects

**+ Add effect → Your effects → New effect code…** adds a custom effect
(`kind: 'custom'`) with a posterize to start from. Its card has an **Effect
code** editor (the GLSL page's editor, with error marks):

```glsl
uniform float levels; // 2..16 = 5 Levels
uniform float amount; // 0..1 = 1
uniform vec3 tint;    // color = #ff8800 Warm tint

vec3 effect(vec2 uv, vec3 color) {
  vec3 steps = floor(color * levels + 0.5) / levels;
  return mix(color, steps * tint, amount);
}
```

- `effect` gets `uv` (the point on the picture, 0..1) and `color` (the colour so
  far, after the colour steps above it) and returns the new colour.
- Helpers: `picture(uv)` reads the picture as it came in (the shader and the
  layers, before the stack: this is one pass, so a neighbour's colour doesn't
  include the steps above), `px` is one pixel in uv units, `time` the clock in
  seconds, `resolution` the size in pixels, `aspect` width over height.
- Settings: each `uniform float name; // min..max = default` is a slider,
  optionally with `step s` and a label after it; `uniform int` is a whole-number
  slider; `uniform vec3 name; // color = #rrggbb` is a colour, kept as three
  numbers `name.r`, `name.g`, `name.b`. No range means 0..1. Every one is a
  control target (`finish:<effect>::levels`), mapped like any other. Changing the
  code keeps the values of the settings that stay.
- Names the pass uses can't be settings (`time`, `color`, `uv`, `picture`,
  `px`, anything starting `fn`, `U_` or `u` + a capital…); the card says so.
- Any number of custom effects can be in a stack (built-in kinds are one each).

**In the pass** each is a function (`fnParseCustom`, `fnCustomStage`): its
settings are `#define`d onto a `vec4` uniform array `U_cx<i>` (so a slider
never recompiles), `effect` is renamed `fnCx<i>`, and every top-level function
and constant it declares gets a `_cx<i>` suffix, so two effects can use the
same helper names. The code is compiled under `#line 1 <1000 + i>`, so an
error names the effect and the user's own line (`fnCustomErrors`), and every
`#define` is `#undef`ined after it.

**A broken effect never blanks the picture.** The card checks the code as you
type (`fnCheckCustom`, on a small WebGL2 context of its own) and marks the
lines. The renderer compiles each custom effect alone once before using it; one
that fails is left out (its error in `info().custom[effectId]`) and the rest of
the stack runs. If they compile alone but not together, the stack runs without
them. Only broken effects: nothing is drawn and the picture shows unfinished.

**Your effects.** The card's menu has **Save to Your effects** (and **Rename…**).
Saved effects are listed under **+ Add effect → Your effects**, in
`shader-studio:finish-effects` (`{ id, name, code, savedAt, sealed?, pack? }`).
An effect in a stack keeps its own copy of the code (`defId` names the saved
one it came from), so a Play file, a preset or a website carries it whole.

**Sealed effects.** A node pack can carry effects (below); in a sealed pack
their code is encrypted like a sealed node's (`sealCustomCode`, the same
AES-256-GCM scheme). A sealed effect keeps `sealed` and an empty `code` in Your
effects, in a stack's record, in presets and in files; the code is filled in
only in memory (`finishCustomCode`, `renderableFinish`), and the card shows its
settings but not its code. As with sealed nodes, a website export must contain
the shader's text, so `playBundle` puts the code in.

### From a graph (next step)

Not built yet: a **Picture** source node in the Studio (the finished frame as
a texture sample at a uv; a test image in the Studio's own preview) and
**Publish as Finish effect** for a graph whose output depends on it. The
compiler's output is GLSL ES 1.00 (`gl_FragColor`, `varying vUv`,
`u_resolution`, `u_time`, parameter uniforms), so publishing would: compile the
graph; rename `main` to `effect(vec2 vUv, vec3 color)` and turn the
`gl_FragColor = …` into a `return`; map `u_resolution`/`u_time` to
`resolution`/`time` and `texture2D(u_picture, x)` to `vec4(picture(x), 1.0)`;
and write each exposed parameter (or Play control) as a
`uniform float name; // min..max = value` line, so it becomes the effect's
slider. The result is an ordinary custom effect, so everything above (the
pass, errors, Your effects, packs, exports) applies unchanged.

Multi-pass custom effects (their own blurs, feedback) come after that.

## Controls and mappings

Every number is a control target: `finish:<effectId>::<key>` (the wipe's
under the id `compare`; a custom effect's under its settings' names)
(`finishTarget`, `parseFinishTarget`). The mapping engine treats it like a layer
property under the id `finish:<effectId>` (`parsePropTarget`), so mice, keys,
audio readers, LFOs, hands, takes and the website runtime all drive it. The +
beside each slider makes one; **Add control → From the Finish stack** and **Map…**
list them too (`finishHosts`: the effects, then the wipe when the record has one). Removing an effect removes its controls and their mappings; a
file's control whose effect is gone is dropped on load.

## Record

```jsonc
"finish": {
  "on": true,
  "effects": [
    { "id": "grade", "kind": "grade", "enabled": true, "exposure": 0, …, "tone": "none",
      "curves": { "rgb": [0, 0, 1, 1], "r": […], "g": […], "b": […], "hueSat": [], "hueHue": [], "lumaSat": [] },
      "look": "teal-orange" },
    { "id": "time", "kind": "time", "enabled": true, "amount": 16, …, "map": "slit", "layerId": "", "quality": "medium" },
    { "id": "fx_custom_…", "kind": "custom", "enabled": true, "name": "Posterize", "code": "uniform float levels; …",
      "defId": "fx_…", "levels": 5, "tint.r": 1, "tint.g": 0.53, "tint.b": 0 }
  ],
  "compare": { "on": true, "pos": 0.5, "angle": 0, "softness": 0 }
}
```

`parseFinish` keeps known kinds only, one of each built-in kind (the first)
and any number of custom effects (with code or a sealed blob), clamps every
number to its range (a custom effect's ranges come from its code) and fills
missing ones with defaults. `compare` is optional (off unless `on: true`).
Older records have no `finish` and get none. Exports carry it as it is (sealed
effects with their code).

## In the library and files

| Where | What |
| --- | --- |
| Library ZIPs (`library.json`, and readable `finish stack presets.json`, `finish effects.json`, `finish looks.json`) | the three lists, merged on import like palettes |
| Profile ZIPs, Install | the same keys, merged as lists |
| `.playfile` | a `library` item when chosen on the Files page (or a whole library); effects also inside node packs |
| Files page | Presets → Finish stack presets, Finish effects (Your effects), Finish looks |
| Workspace folder | `presets/finish stacks/<Name>.finish.json`, `presets/finish effects/<Name>.effect.json` |
| Node packs | Builder → Node packs → Extras → **A Finish effect…**: carried in the `nodes` item's `finishEffects`, sealed with the pack; on import they go into Your effects (tagged with the pack) |


## Plans

The whole stack is **Pro** (`play.finish` in `lib/plan.ts`), like layers: it
works on the layers' picture and is a finishing tool for performances and
exports. On Free a setup with a stack plays without it, the stack stays in the
record, and the "needs Pro" note lists it.

## Performance

At 1440 × 900 on an Apple M3 Pro (Chrome, ANGLE Metal), throughput of the Finish
renderer per frame, measured as 60 frames between two GPU syncs:

| Stack | ms / frame |
| --- | --- |
| Off (empty, bypassed or all off) | 0 (no pass) |
| Uploads + a trivial pass | 0.42 |
| Grade (Teal & orange look) | 0.42 |
| Grade + bloom + grain | 0.69 |
| Halation | 0.72 |
| Time displacement (Medium) | 0.45 |
| All eleven effects | 1.08 |

The live preview draws the finished frame at the overlay's size, capped at about
2.1 million pixels, so a retina preview costs no more than a 1080p one. Renders
use their own size.
