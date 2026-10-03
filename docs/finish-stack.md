# The Finish stack

Play's **Finish** tab: colour grading, lens and screen effects, film effects,
camera shake, time displacement, warps, glitches, stylised looks (pixel sort,
halftone, ASCII, light leaks) and temporal effects (feedback, echo, datamosh,
motion extract) over the **final**
picture, the shader and every layer together. One ordered stack per Play record
(`play.finish`). Any effect can show only **somewhere** (its Where: a layer's
shape, the bright parts, or where the camera sees movement).

- Engine: `src/play/kit/finish.js` (+ `finishGlsl.js`, shared with the Studio's
  Tone Map and CRT Mask nodes). Part of the layer kit, so the app and exported
  pages run the same code.
- Record, parsing, control targets, Looks, custom effects' records:
  `src/types/playFinish.ts`.
- Stack presets and Your effects (the device's lists): `src/play/finishLibrary.ts`.
- UI: `src/components/play/finish/` (`FinishPanel`, `CurveEditor`,
  `ColourWheel`, `CompareHandle`, `savedLooks`).
- Tests: `src/play/__tests__/finish.test.ts`, `finishFollowups.test.ts`
  (the wipe, custom effects, presets, the library) and `finishMaps.test.ts`
  (Where, the maps, the new effects, particles born where a map says) and
  `finishCreative.test.ts` (pixel sort, halftone, ASCII, light leaks, presets and
  swatches, the passes a stage effect splits a stack into) and
  `finishTemporal.test.ts` (feedback, echo, datamosh and motion extract: their
  records, passes, grids, rings and maths); node packs carrying
  effects in `src/nodePacks/__tests__/nodePacks.test.ts`.

## Where it runs

| Place | How |
| --- | --- |
| Play preview, Stage (Full) | `play/overlay.ts` draws the layers as usual, then `fnCreate`'s renderer composites the WebGL picture and the layers' canvas into its own WebGL2 canvas, stacked above both. Null markers, hands and handles go on a separate guides canvas above that, so they are never graded or bent. |
| Recordings (MediaRecorder) and PNG snapshots | `startCompositing` / `snapshot` copy the finished canvas instead of picture + layers. |
| Takes, offline renders (FFmpeg, PNG sequence), transparent stills | `compositePixels` → `finishPixels`: the frame's RGBA goes through a second renderer (so the live preview's time ring is untouched) in pixels mode and is read back in place. Frame-exact: grain, flicker and shake are functions of the frame's time, and the time ring and every temporal effect's frames start over on the first frame. |
| Exported websites, Stage (Exact), Present | `play-runtime.js` creates the same renderer over its canvases when `SSKit.finish.active(play.finish)`. Mapped numbers drive it through the runtime's layer-property path. |

With no effects, the stack bypassed, or every effect off, nothing is created and
there is no extra pass: `fnActive(finish)` is false.

WebGL2 is required (texture arrays, multiple render targets, half floats). Without
it the renderer reports `ok: false` and the picture shows unfinished.

## The pass

One fragment shader is built from the effects that are on (`fnBuildFinal`),
compiled once per structure and cached (a stack with a stage effect is a few
of them; see below). Numbers are uniforms (one `vec4[]` per
effect), so dragging a slider or a mapping never recompiles.

1. **Geometry**, last effect first: camera shake, lens distortion, CRT
   curvature, Glitch's blocks and tears, Ripple, Displace, Mosaic and Mirror
   bend where the picture is read.
2. **Sampling**: chromatic aberration and Glitch's colour split read red and
   blue at offset points; time displacement chooses which frame each point reads.
3. **Colour**, in the stack's order: grade, vignette, CRT mask, bloom, halation,
   grain, flicker, Glitch's colour blocks, gradient map, posterize, edges,
   light leaks, pixel sort, halftone, ASCII, the temporal effects (feedback,
   echo, datamosh, motion extract), and your own effects wherever they sit in
   the stack.
4. **The before/after wipe**, last: where it shows the picture before the stack,
   that is what is drawn (and the stack isn't run there at all).

**Stage effects** read the picture *around* each point after the effects above
them: Pixel sort (a run of pixels), Halftone and ASCII (a cell's centre)
(`FN_STAGE_KINDS`). The **temporal effects** (`FN_TEMPORAL_KINDS`: Feedback,
Echo, Datamosh, Motion extract) keep frames of their own, so they split a stack
the same way. Each one starts a pass of its own (`fnSegments`): the pass
before it draws into a full-size `RGBA8` target (premultiplied, upright) and the
stage effect reads that through `fnRead`, so every effect above reaches it (a
Grade then Halftone prints the graded colours). Geometry, the colour splits and
Time displacement happen in the first pass only; the wipe in the last only.
Only the last pass flips for an offline render's read-back; the temporal
effects keep their frames in the passes' own (upright) space, so a render reads
them the same way the preview does. A stack with no stage effect, or one only at the top, is still
a single pass, built exactly as before. Every pass reads the same map textures,
so a Where works wherever the effect lands. Edges and a Brightness map read the
picture as it came in, so they never split a stack.

Extra work only when asked for:

- **Glow** (bloom, halation, CRT glow): a quarter-size prefilter into two
  render targets (bloom and halation at once), then a quarter, an eighth and a
  sixteenth, each blurred with a separable 9-tap Gaussian: seven tiny passes.
  Half-float when `EXT_color_buffer_float` is there, else 8-bit with an
  `x / (1 + x)` encoding.
- **Halation's tight bleed**: three half-size passes of its own (the largest
  source of each 2 × 2 block, then a max-spread across and down), on top of
  the glow chain, which gives it its Reach tail.
- **Time**: a `TEXTURE_2D_ARRAY` ring of reduced frames, written after the final
  pass.
- **Curves**: baked into a 256 × 2 `RGBA8` lookup when they change.
- **Maps** (a Where, Displace's or Time's Layer map): up to four textures,
  `uM0`..`uM3` (`fnMapKeys`), uploaded each frame: a layer drawn alone
  (`layerAlpha`) or the camera's motion map (`motion`).
- **Temporal effects**: before the pass it heads, each runs passes of its own
  over that pass's input (`temporalPass`): Feedback's history update, a frame
  into Echo's or Motion extract's ring, Datamosh's three steps. Details below.
- **Stage passes**: two full-size `RGBA8` targets, used in turn.

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
| Halation | Amount, Reach, Threshold, Highlight headroom, Warmth, Growth, Conserve; presets Subtle, Classic cine (the measured reference, and the defaults), Strong |
| Film grain | Amount, Size (px at 1080p), Colour, Response (to brightness), Frames a second (0 holds it) |
| Flicker | Amount, Speed |
| Camera shake | Amount, Speed, Rotation, Gate weave; zoomed to hide the edges |

### Halation

Film halation: light strong enough to pass through the emulsion bounces off
the film's back and re-exposes it from behind, reaching the red-sensitive
layer first. On screen it is a **thin red bleed hugging bright edges**, landing
on the darker picture right beside them.

The shape and colour are measured from a reference: the Joo.Works "ACES lite
Halation" PowerGrade for DaVinci Resolve (the `.drx` is encrypted, so we
measured what it does to a frame, below). `FN_HAL` in `finish.js` holds the
fitted numbers; Classic cine and the defaults are that fit.

![A grey ramp on a dark wall before (top) and after (bottom) halation at the defaults: the red bleed starts about 0.6–0.78 along (the threshold, marked with its knee) and grows toward white; the clipped end bleeds furthest.](finish-stack/halation-ramp.png)

**The pass**, all in linear light:

1. **Source**: the red channel's scene energy over the threshold, with a soft
   knee (`fnHalSource`). Threshold is in stops from white on the headroom
   estimate (`fnEnergy`: below 0.75 linear nothing changes; above it the tones
   squeezed toward white open up so that display 1.0 becomes `2^headroom`). The
   default, −1.15 stops, is linear 0.45 (0.70 on screen), with a knee of ±30 %:
   the bleed fades in from 0.59 to 0.78 on screen. A colour with no red (teal)
   never bleeds. A second source, the dimmest channel over 1.5 × white, feeds
   Growth: only light brighter than white in every channel.
2. **Tight bleed: a max-spread, not a blur.** At half size, each 2 × 2 block
   keeps its largest source (so a one-pixel glint survives), then a separable
   pass takes, for each texel, the largest `source × e^(−d²/2σ²)` within 4.5 σ,
   across and then down (exact for a gaussian, since it factors). σ is 4.5 px
   of a 1080-line picture, scaled with the picture. So the bleed at a distance
   *d* from a bright part is that part's excess × e^(−d²/2σ²) **whatever its
   size**: a two-pixel glint bleeds as far and as strongly as the edge of a
   big bright shape. That is what the reference does, and what a blur can't
   (a blur makes small glints far weaker than edges).
3. **Reach tail**: a true blur of the source from the glow chain (the eighth
   level, σ ≈ 16 px, fading in over Reach 0 → 0.5 up to the fitted strength;
   then widening to the sixteenth, σ ≈ 32 px, from 0.5 → 1). The faint wide
   haze the reference also has.
4. **Only onto the darker side**: the bleed is scaled by how dark the pixel
   itself is (all of it below linear red 0.17, none above 0.53), so the bright
   part never turns red; its surroundings do.
5. **Tint** (`fnHalTint`): red, plus green where the bleed is strong,
   `dG = warmth · dR² / (dR + 0.076)` (orange right at the edge, red further
   out), minus a little blue, `0.07 · dR` (never more than half the pixel's
   own blue, so a black surround keeps its hue).
6. **Conserve**: the bright part darkens evenly by Conserve × its excess over
   the threshold (1 takes its red down to the threshold). The reference
   darkens highlights only slightly (1–2 of 255): default 0.03.
7. **Growth**: a white spread from the second source, through the same
   max-spread, added as `x + (1 − x)(1 − e^(−w))`.

`fnHalPixel` is one pixel of this on the CPU (for the tests). The ramp above
was made with the same maths offline, which matches the shader to within 4/255
on the reference frame.

**Measuring the reference.** Two 8-bit Rec.709 exports of one 1920 × 1080
frame (a white dog on wet sand: soft, low-contrast, specular glints), before
and after the PowerGrade:

- **Mean change by source brightness** (after − before, of 255):
  luma 48–79 R +2.5/+2.0, G +0.2, B −0.2 (the dark pixels beside bright
  edges: the bleed); luma 160–191 R +1.2/+0.5, G −0.2/−0.4, B −0.5/−0.7;
  luma 224–255 all channels −1.3…−2.2 (highlights slightly darker).
- **Threshold, from isolated glints** (24 local maxima on the sand): the
  glints whose red peaks at 164 or below make no change at all; from 191 up
  the bleed 3–6 px out grows in proportion to *linear red − 0.50*
  (191 → +3, 206 → +13.5, 227 → +30 of 255). Fitting the whole frame put the
  threshold at linear 0.45 with a 30 % knee (0.40–0.50 fit equally well).
- **Radius**: around glints the bleed is a ring peaking 4 px from the centre
  (the glint itself is untouched), half at ~7 px, 5 % by 12 px, a faint
  tail to ~20 px. Across the dog's back into the sky, relative to 4 px out:
  6 px 0.59, 8 px 0.28, 10 px 0.11. Both fit a gaussian falloff of σ ≈ 4.4 px
  **from the source's edge**, with one strength for glints and edges alike
  (≈ 0.8–1 × the excess), which is a max-spread, not a blur: a blur fitted to
  the edges gives glints roughly a tenth of their measured bleed.
- **Compositing**: the bleed lands only on pixels darker than the source; a
  pixel of red 175 right beside a glint of 227 gets nothing, one of 93 goes
  to 147. Additive in linear light (the edge falloff matches an additive
  model; a pure lighten doesn't), gated by the receiving pixel's own red.
- **Colour** of the positive bleed, in linear light: R 1 : G ≈ 0.27 : B ≈ −0.1
  right beside a strong source, R 1 : G ≈ 0.04 : B ≈ −0.07 further out.
- **Energy**: not conserved. The bleed adds far more light than the sources
  lose (a 227 glint core drops by 1; its ring gains up to +54).

The final numbers come from a least-squares fit of this model to the frame
(σ, gain, tail, receive range, tint and conserve; 482,000 pixels in and around
the bleed): mean squared error per channel 6.70 → 2.23, where the best
*blur*-based model reached 4.03. On the whole frame the shader takes it from
3.09 (no halation) to 1.11; the old model (before this rebuild) left the frame
unchanged, since nothing in it was brighter than its threshold.

(The frames are the owner's reference exports and aren't in the repo.)

**Controls**:

| Control | What it does |
| --- | --- |
| Amount | Scales the bleed (and Growth). 1 is the reference. |
| Reach | The wide tail: 0 none, 0.5 the reference (σ 16 px), 1 wider (σ 32 px) |
| Threshold | Stops from white; −1.15 is the reference (0.70 on screen). Above 0 only light over white bleeds (the old model's range) |
| Highlight headroom | How far over white a clipped part is taken to be (stops): clipped lamps bleed further than merely bright paper |
| Warmth | Green in the strong part of the bleed: 0 pure red, 1 orange |
| Growth | White spread from light over white in every channel |
| Conserve | How much the bright part itself gives up |

**Older effects**: a halation saved before this model (no `model: 2`) keeps
its numbers' meanings, but Amount is rescaled (old 0.7 = new 1, capped at 2)
and Conserve gets its default (`fnMigrateHalation`, run by `parseFinish`). Its
Threshold stays where it was (0.5 stops over white), so a saved stack still
bleeds only from clipped highlights until the threshold is lowered or a
preset is picked.

**Limit of the 8-bit estimate.** Everything the finish sees is an 8-bit
canvas, so a white card that clips at 1.0 is indistinguishable from a lamp.
The `finishHalation` example keeps paper at 0.90: it gets the thin rim (it is
over the threshold), and pushed to 1.00 it bleeds like a lamp.

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

## Where: an effect only somewhere

Every effect (built-in or your own) has a **Where**, under its settings:

| Where | The effect shows… |
| --- | --- |
| Everywhere (default) | everywhere, as before |
| Where a layer is | where that layer is opaque: its alpha, drawn alone by the kit even when the layer is hidden (a shape on hand nulls makes it follow a hand) |
| On the bright parts | by the picture's own brightness at each point |
| Where the camera sees movement | by the kit's motion map (needs a Camera layer, which can be hidden) |

**Invert** swaps in and out. In between, the effect fades: a warp moves the
picture only that much (`q = mix(q0, q, w)`), a colour step changes it only
that much (`c = mix(c0, c, w)`), a colour split splits only that much, and Time
displacement looks back only that far. Saved as `where`, `whereLayer` and
`whereInvert` on the effect; absent means everywhere, so older stacks are
unchanged. The layers a stack reads are `fnMapLayers(finish)` (the hosts pass
them as `env.alphaLayers`), and `fnUsesMotion(finish)` tells the kit to keep a
motion map (`env.needMotion`).

**The motion map** (`kit.motionMap()`, also `motionAt(x, y)`): the camera's
coarse grid (64 × 36), per cell how much changed since the last frame, rising
at once and fading over about a third of a second, so a gesture leaves a short
trail. It is mirrored like the Camera layer. It exists only while the camera is
sampled: a Camera layer, hidden or not, with something reading motion (a Where,
Displace, or particles born where it moves). Offline renders have no live
camera, so a motion map reads nothing there.

## Warps, glitches and feedback

Added together, in the spirit of TouchDesigner's image operators. Each is one
more block of the same pass. (Feedback, added with them, is now one of the
temporal effects, below.)

| Effect | What it does | Numbers |
| --- | --- | --- |
| **Glitch** | Blocks jump sideways, bands of scanlines tear, red and blue split row by row, some blocks swap colour channels; it changes `Speed` times a second | amount, blocks, speed, colour split, tear, colour blocks |
| **Ripple** | Rings of waves spreading from a centre (map a hand or the pointer onto the centre) | amount, wavelength, speed, fade out, centre |
| **Displace** | Pushes the picture by a map: drifting noise (heat haze), the picture's brightness, a layer's alpha, or camera motion | amount, direction, scale, speed |
| **Mosaic** | Big square pixels | cells |
| **Mirror / kaleidoscope** | Segments 1 folds one half onto the other along a line through the centre; 2 and up make a kaleidoscope of mirrored wedges. Spin turns the picture under the mirrors; Zoom goes in or out, and spun or zoomed, the picture repeats as mirrored tiles past its edges | segments, angle, centre, spin, zoom |
| **Gradient map** | Brightness becomes a shadows → midtones → highlights gradient | amount, midpoint, three colours |
| **Posterize** | A few flat levels per channel, with a 4 × 4 ordered dither; Colour below 1 maps brightness between a Dark and a Light palette colour (a handheld's greens, 1-bit) | levels, dither, colour, dark, light |
| **Edges** | Outlines where the picture's brightness changes (read before the stack's colour steps), in a colour, over the picture or alone on black; Glow adds a soft halo, Rainbow colours the lines by their direction | amount, width, threshold, edges only, colour, glow, rainbow |

Glitch, Ripple, noise Displace and the temporal effects keep the preview drawing
while the clock runs (`fnAnimated`), as do a spinning Mirror and rainbow Edges.

## Stylised looks

From the creative-effects pass (#443, rebuilt on the effects above: where they
overlapped, Glitch, Mirror, Posterize, Edges, Feedback and Displace stayed and
took #443's presets and extras instead).

| Effect | Group | What it does | Numbers |
| --- | --- | --- | --- |
| **Pixel sort** | Glitch | Each line along Direction is cut into staggered intervals of varied length; within one, the 24 samples brighter than Threshold are ranked and placed dark to bright in the bright places. A stage effect | threshold, length, direction, amount |
| **Halftone** | Stylise | Dot screens sampled at each cell's centre: black only, or C, M, Y, K at print's screen angles, multiplied onto the paper colour. A stage effect | dot size, angle, colour, amount, paper |
| **ASCII** | Stylise | Each cell picks one of ten 5 × 5 characters (`FN_ASCII_GLYPHS`, empty to dense) by brightness; coloured from the picture or one ink. A stage effect | character size, colour, background, contrast, ink |
| **Light leaks** | Film | Three warm blobs drift round the edges, hot in the middle and redder at the fringe, screened over the picture | amount, hue, size, speed |

## Temporal effects

Feedback, Echo, Datamosh and Motion extract (`FN_TEMPORAL_KINDS`) keep frames of
their own between draws. Each heads a pass of its own (`fnSegments`), and before
that pass the renderer updates its frames (`temporalPass`) from the pass's input:
the picture as the effects above it left it (the stage target of the pass
before), or, first in the stack, the picture itself. They start empty on a new
size, on a render's first frame and on Reset, and a render steps them frame by
frame, so a render is the same every time and matches the preview: a browser
check rendered each one live and through the offline path and compared, and
rendered twice from a fresh renderer, with no difference (Feedback's Tunnel
differs by at most 1/255, from float rounding).

An effect that is gone from the stack lets go of its frames.

### Feedback

Trails that fade behind what moves, crisp, with the live picture sharp on top
(the TouchDesigner Feedback TOP pattern: a history that is transformed, levelled
and composited each frame).

- **History**: a full-size pair of targets used in turn, half-float when the GPU
  can draw it (`EXT_color_buffer_float`, else 8-bit), plus an 8-bit copy of the
  source (for Moving parts and Over). Each frame:
  `history = source ⊕ max(trail × Trail − 0.003, 0)`, where the trail is the last
  history moved by Zoom, Rotate and Drift and turned by Hue drift, and ⊕ is the
  Blend's (lighten and over keep the brighter, screen and add add light). The
  small floor means a trail always fades out completely; before, an 8-bit copy of
  the output kept the low values forever (3/255 × 0.85 rounds back up to 3/255),
  which left a permanent haze over everywhere anything had moved.
- **Crisp**: with Zoom, Rotate and Drift at 0 the trail is read texel for texel
  (`texelFetch`), so it never blurs however long it lasts; moved, it is read
  filtered (that softening is what a tunnel looks like).
- **Local**: Zoom now defaults to 0, so trails stay where things were (it was
  0.01: every trail grew from the centre over the whole picture). Tunnel and
  Spiral are presets.
- **Composite**: the trail meets the live picture by the Blend: Lighten, Screen,
  Add, Over (the trail over the picture, under where the source is now: needs a
  source with gaps) or Blend (the source smeared into its own past, the old
  Smear).

| Control | What it does |
| --- | --- |
| Source | Whole picture, One layer (drawn alone, hidden or not: only its trail, over the untouched picture), Moving parts (where it changed since the frame before), Bright parts |
| Trail | How much of the trail stays each frame |
| Zoom, Rotate, Drift X/Y | Move the trail each frame: tunnels and spirals |
| Hue drift | Turns the trail's colour each frame |
| Blend | Lighten, Screen, Add, Over, Blend |

Presets: Ghost trail (default), Tunnel, Spiral, Smear.

**Saved stacks**: a Feedback saved before this keeps its numbers (its zoom
included) and gets Source = Whole picture, so it looks as it did, apart from
the haze being gone and two changes of where it sits: it now feeds back the
picture as the effects *above* it left it (not the finished frame, so effects
below it no longer loop through it), and it heads a pass of its own.

### Echo

After Effects' Echo: sharp copies of the source from a moment ago.

- A ring of past frames of the Source (`ensureFrameRing`, shared with Motion
  extract's code): 4, 8, 16 or 32 frames, growing as needed and never
  shrinking while its size stays, at full size up to 128 MB
  (`FN_ECHO_COPIES_CAP`), so the copies are as sharp as the picture; past it the
  frames are kept a little smaller.
- Each frame the newest copy is Echo time frames back, the next twice that and
  so on (`fnEchoPlan`), at most 30 frames back (fewer copies when Echo time ×
  Echoes would reach further). The newest is Starting intensity strong, each
  older Decay times the one after it, laid oldest first by the Operator:
  Lighten, Add, Screen, Behind (under the source as it is now: needs a source
  with gaps) or In front.
- **Strobe** holds the copies still between steps: the newest is the last frame
  on a multiple of Echo time, so they jump instead of following.

| Control | What it does |
| --- | --- |
| Source | As Feedback's |
| Echo time | Frames between one copy and the next |
| Echoes | How many copies (1–8) |
| Starting intensity, Decay | The newest copy's strength, and each older one's share of the one after it |
| Operator | Lighten, Add, Screen, Behind, In front |
| Strobe | Copies jump each Echo time instead of following |

Presets: Echo (default: three copies four frames apart), Ghost trail, Strobe
echo; with layers in the setup, **Layer echo** sets Source to the first layer
(Behind, five copies).

### Datamosh

The codec glitch where a video loses its keyframes (I-frames) and the next
frames' motion (P-frames) moves the *old* picture: colours from before smear
and bleed, block by block, along whatever moves.

1. **Brightness at a quarter size** (`FN_MOSH_LUMA`): each texel the mean of
   4 × 4 pixels of the pass's input, or of a layer drawn alone (Motion from).
2. **Block vectors** (`FN_MOSH_VEC`): one texel per block, where the block came
   from in the frame before. Block matching on 16 samples a block: the last
   vector (the predictor), the median of its neighbours' last vectors, then a
   step search of 8, 4, 2 and 1 quarter-size pixels around the best so far
   (±15, ±60 px of the full frame a frame). The cost adds a little per pixel
   moved and per pixel away from the neighbours' median (an encoder's
   preference too: on repeating textures, where many matches are as good, the
   blocks agree), and a flat block doesn't move. **Sustain**: a block keeps the
   larger of its new vector and what is left of its last one, so movement
   lingers and swells (the classic "bloom"). Vectors are kept as 16 bits an axis
   in an RGBA8 texel (`fnMoshEncode`).
3. **The held picture moves** (`FN_MOSH_ADV`, full size): each pixel takes the
   held picture from where its block's vector (× Push) says, a whole number of
   pixels, read without filtering (so it never blurs however long it is held),
   plus Bleed × the frame's residual (the frame minus the frame before, moved
   the same way: what a codec would add). Refresh heals it toward the live
   picture (Refresh² a frame); a keyframe (every Keyframe-every seconds, on the
   clock, so a render's land on the same frames: `fnMoshKeyframe`), or the first
   frame, takes the live picture as it is. While **Mosh** is on nothing heals.

| Control | What it does |
| --- | --- |
| Motion from | The picture, the camera (a Camera layer, hidden or not: your movement smears the picture) or any layer |
| Amount | How much of the moshed picture shows |
| Bleed | How much of each frame's new detail gets through (0: only the old pixels move; 1: a clean picture) |
| Block size | Pixels of a 1080p picture (8–96; a codec's are 16) |
| Push | Vectors × this: above 1 smears faster than things move |
| Sustain | How much a block keeps moving after the movement stops |
| Refresh | How fast it heals to the live picture (0 never) |
| Keyframe every | Seconds between snaps back to the live picture (0 never) |
| Mosh | A switch: while on, nothing heals. The card's **Hold to mosh** button holds it |

Presets: Bloom (default), Melt, Blocky, Pulse (a keyframe every second), On cue
(heals fast: it moshes only while Mosh is held).

**Mosh on cue**: Finish effects have no actions of their own (actions act on
layers), so Mosh is a number, mappable like any other: map a key onto it (held:
moshes while the key is down), or have a rule **send a signal** and map that
signal (a trigger source on the signal) onto Mosh, or use **Set from a signal**.

Offline renders have no live camera, so with Motion from the camera the picture
holds still there (unless Refresh or a keyframe brings it back).

### Motion extract

The motion extraction trick: the frame inverted at 50 % over a copy from a moment
ago, `0.5 + (then − now) / 2`, so whatever stayed still cancels to mid-grey and
only movement shows, as edge-like outlines (`fnEchoPixel` is the maths).

- A ring of past frames (as Echo's: 4–32 frames, growing, at most 64 MB,
  `FN_ECHO_CAP`, past which the frames are kept smaller). Both frames compared
  come from the ring, so a smaller ring still cancels still parts exactly.
- Until the ring has Delay frames it compares with the oldest it has (the first
  frame shows no movement).

| Control | What it does |
| --- | --- |
| Delay | Frames ago (1–30): longer catches slower movement, thicker outlines |
| Gain | Contrast of the movement |
| Colour | 0 grey, 1 the picture's own colour shifts, 2 more vivid |
| On black | 0 the classic mid-grey, 1 black (only how much changed: abs difference) |
| Edges | Movement along the picture's own edges (now or then) shows more, flat areas less |
| Neon | Two-tone: what arrives glows cyan, what leaves magenta |
| Amount | How much of it shows over the picture |

Presets: Classic grey (default), On black, Neon motion.

Glow effects (Bloom, Halation, CRT glow) read the picture as it came in, not
the temporal effects' output, so a Bloom after Motion extract glows from the
original picture, not the outlines.

## Presets, swatches and notes

An effect's declaration (`FN_EFFECTS[kind]`) can carry `presets` (named sets of
numbers: they only set numbers, so a mapping or control on one keeps working),
`colours` (three hidden numbers edited as one swatch, each still a control
target) and a `note` (a line under its sliders). The card shows a Preset row
for any effect that has them, the one it's on lit (and named in the folded
card's summary); one preset is always the defaults. Effects without an editor of
their own get their sliders, swatches and note from the declaration.

| Effect | Presets |
| --- | --- |
| Glitch | Subtle, Broken (default), Meltdown |
| Displace | Liquid (default), Heat haze, Marble (for the Noise map) |
| Mirror / kaleidoscope | Mirror (default), Mandala, Crystal, Butterfly |
| Posterize | Poster (default), Retro PC, Handheld, 1-bit, Sunset duo |
| Edges | Chalk (default), Neon, Ink outline, Laser |
| Feedback | Ghost trail (default), Tunnel, Spiral, Smear |
| Echo | Echo (default), Ghost trail, Strobe echo; Layer echo on the card |
| Datamosh | Bloom (default), Melt, Blocky, Pulse, On cue |
| Motion extract | Classic grey (default), On black, Neon motion |
| Halation | Subtle, Classic cine (default), Strong |
| Pixel sort | Drip (default), Sideways, Melt |
| Halftone | Comic (default), Newsprint, Pop art |
| ASCII | Colour (default), Terminal, Big type |
| Light leaks | Warm (default), Rose, Burn |

Swatches: Vignette's colour, Bloom's tint, the Gradient map's three colours,
Posterize's Dark and Light, Edges' colour, Halftone's paper, ASCII's ink.

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
  layers, before the stack: a neighbour's colour doesn't include the steps
  above), `px` is one pixel in uv units, `time` the clock in
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

**The source saturates.** The red source over the threshold goes through
`srcMax · tanh(excess / srcMax)` (`fnHalSat`, `srcMax` 0.3): the reference's
brightest glint (red 227, an excess of about 0.3) is about the most anything
bleeds, so a clipped white, a lamp with six stops of headroom and a bright
paper all bleed like that glint instead of two hundred times more, and the
rim stays thin and red-orange rather than a wide yellow halo. The tail
(Reach) defaults to 0.25.

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
| Halation (reference model: glow chain + three half-size passes) | 0.77 |
| Time displacement (Medium) | 0.45 |
| All eleven effects | 1.08 |

The warps, glitch, gradient map, posterize and mosaic are a few instructions
each in the same pass; Edges adds four picture reads, Feedback one full-frame
copy, and each map texture one small upload. (Not measured on the M3 Pro; they
were checked for compiling and drawing in Chromium's software WebGL.)

The stylised looks, measured the same way at 1440 × 900 (in the browser pane,
another machine), each after a Grade so the stage ones run as a second pass:
Grade alone 0.27 ms; with ASCII 0.32, Halftone 0.34, Edges with glow and rainbow
0.38, Light leaks 0.43, Pixel sort 1.34 (24 samples and their ranking per
pixel). Grade, Halftone, ASCII and Pixel sort together (four passes): 0.99.

The temporal effects, measured the same way at 1440 × 900 (headless Chrome,
ANGLE Metal, an Apple laptop; 120 frames of a moving picture between two GPU
syncs, uploads included):

| Stack | ms / frame | Graphics memory |
| --- | --- | --- |
| Grade alone (the baseline) | 0.16 | |
| Datamosh (Bloom) | 0.58 | 22 MB (two full-size pairs, the quarter-size brightness and vectors) |
| Datamosh, block 8 | 0.51 | the same |
| Motion extract, Delay 3 | 0.33 | 21 MB (4 frames) |
| Motion extract, Delay 30 | 0.19 | 64 MB (32 frames, kept at 0.62 size) |
| Feedback (Ghost trail) | 0.50 | 31 MB (half-float history and an 8-bit source, two of each) |
| Feedback (Tunnel) | 0.45 | the same |
| Echo (3 copies) | 0.29 | 83 MB (16 frames) |
| Echo (8 copies, Moving parts) | 0.43 | 128 MB (32 frames, kept at 0.88 size) |
| Grade, Datamosh, Motion extract, Echo (four passes) | 1.10 | |

The live preview draws the finished frame at the overlay's size, capped at about
2.1 million pixels, so a retina preview costs no more than a 1080p one. Renders
use their own size.
