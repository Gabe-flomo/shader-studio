# Node retirements: one node per effect (2026-10-17)

The node audit (October 2026) found the same effect offered two, three or five times: a version that reads
**last frame's picture** (`u_prevFrame`, so anything moving lags and smears) next to a newer one that reads a
**texture in the same frame** (a Pass, a picture, a video), and several distance-to-glow and UV-warp nodes that
were one formula each. This sweep keeps one node per effect, the texture version where there is one.

## How a node is retired

- **Merged** (the old type is gone from the registry): when the survivor can do exactly what the old node did,
  the old type is an alias (`src/nodes/definitions/aliases.ts`, `NODE_ALIASES`). A saved graph that has one
  opens with the survivor in its place, the old settings carried over, wires and Play controls kept.
- **Hidden** (still registered): when the survivor works differently (a texture instead of a colour, a Pass in
  the graph), the old node stays registered so saved graphs load and render exactly as before, but nothing
  offers it: not the node browser, search, the Do bar, suggestions or the builders
  (`src/nodes/notOffered.ts`, `SWEPT_EFFECT_TYPES`).
- Every example, builder, recipe and suggestion that used a retired node uses the survivor.

Tests: `src/nodes/__tests__/effectSweep.test.ts` loads an old graph with each retired type, checks each merged
mode against the old maths on the CPU, and checks no example uses a retired type.

## The families

| Effect | Survivor | Merged into it | Hidden (still loads) |
|---|---|---|---|
| Trails / feedback | **Feedback (texture)**; build your own with a **Pass** and its Previous | – | Previous Frame (Feedback), Motion Blur, Fade (feedback) |
| Time delay | **Echo**, **Cache** / Cache Read (unchanged) | – | – |
| Picture glow | **Glow (texture)**: Bloom chain, Smooth, Fast, **Deep glow** | Deep Glow (texture) → Method Deep glow | Bloom |
| Blur | **Blur (texture)**, **Radial Fast Blur** | – | Gaussian Blur, Radial Blur |
| Lens blurs | **Depth of Field (texture)** (Focus Depth / Point), **Tilt-Shift (texture)** (new) | – | Lens Blur, Depth of Field, Tilt-Shift Blur |
| Chromatic aberration | **Chromatic Aberration (lens)** | RGB Split (texture) → Channel split, Blur 0 | Chroma Shift, Chromatic Aberration (UV offsets) |
| Edges | **Edges (texture)** | – | Sobel Edges |
| Distance → glow | **SDF Glow**, Mode list | Glow Layer, Distance Falloff, Deep Glow (SDF) | Point Light 2D |
| UV warps | **UV Warp**, Kind = Smooth / Jitter / Curl / Swirl | UV Warp (Smooth), (Curl), (Swirl), Swirl / Vortex | – |

Kept on purpose:

- **Echo**: discrete copies of the picture *Delay* frames apart. Feedback (texture) is a continuous fade and
  Cache Read reads one delay, so neither does it.
- **Pixelate** (2D Space): a UV-space pixelate, not a picture effect.
- **Displace** (2D Space): moves the UV by a vector; Displace (texture) moves a texture's read by a map.
- **Posterize**: no texture version exists. (Radiance Cascades 2D was retired later the same day: see below.)
- **Pass + Sample (texture) of its Previous**: the build-your-own feedback path (Passes 3).

## SDF Glow's modes

Each mode is the old node's formula, with that node's settings shown only for it (`effects.ts`, `LightNode`):

| Modes | Settings | Was |
|---|---|---|
| Glow, Haze, Bounded, Simple | Falloff | SDF Glow |
| Halo, Soft, Gaussian, Neon, Inverse square | Reach (Glow Layer's Intensity), Power | Glow Layer (`glowFormula`) |
| Cone | Falloff (Distance Falloff's Rate) | Distance Falloff |
| Point light | Falloff Model (Squared / Inverse / Linear), Intensity, Radius, Gamma | Point Light 2D's falloffs |

Names are short and plain (2026-10-19); each mode's formula is its option's tooltip and is listed in the Mode's
**?** (`SDF_GLOW_MODES`). The saved `value` ids (`glow`, `haze`, `halo`, `invsq`…) never changed.

**Retired modes (2026-10-19).** Ring light, Exponential (Glow Layer's, not Glow), Rim, Bounded inverse power,
Gaussian bump, Wyvill bump and Deep glow are no longer in the Mode list, the 2D Scene Builder's Glow type list
(Exponential, Rim), the Do bar or Randomize (`SDF_GLOW_RETIRED_MODES`, the ParamDef's `retiredOptions`). A saved
node set to one compiles exactly as before, with its settings (Ring Freq, Power, Intensity, Radius, Saturation,
Edge Softness), and its card reads **Ring light (retired)** and so on. A Glow Layer, Distance Falloff or Deep Glow
(SDF) opened from an old graph still migrates to the matching (retired) mode. The four Play examples with rings
(Climb, Two hands, Terminal, Piano roll scale) keep Ring light: no offered mode draws rings.

Tint takes a gradient (by distance from the shape, or across the picture), as Glow Layer's Color did. A
migrated Glow Layer's **Glow** output is SDF Glow's **Tinted**; Distance Falloff's **Falloff** is **Glow**.
Per distance (March Loop banding) applies to the classic modes only.

## UV Warp's kinds

`transforms.ts`: each kind emits its old node's call (`smoothWarpOffset`, `uvWarpOffset`, `curlWarpOffset`,
`swirlWarpOffset`), with only that kind's helper in the shader. Swirl / Vortex is Swirl round (0, 0) with no
spin. A UV Warp saved before Kind (the old *UV Warp (Jitter)*) stays Jitter (version 2, `migrateParams`); a new
one starts Smooth.

## Glow (texture), Deep glow

Deep glow is the old Deep Glow (texture): its own mip chain of hidden passes (`compiler/blurPasses.ts`,
`isDeepGlow`), Chromatic spread, Preserve colour and Composite (shown for it only). Glow (texture) gained a
**Color** output (the picture with the glow added, for every method) and sockets for its sliders, which drive
every hidden pass as well as the final read.

## The new lens nodes

- **Depth of Field (texture)**: Focus **Depth** blurs by how far each pixel's depth is from Focal Dist (the
  depth from Dist, or from the texture's alpha: put a March Loop's Distance into the Pass's Alpha); Focus
  **Point** is the old Lens Blur (Focal Length, Aperture, Focus Distance round a Focal Point). Same circle of
  confusion and the same Disc / Hex / Oct bokeh reads as the old nodes, from the same frame.
- **Tilt-Shift (texture)**: the old band and 1D Gaussian along it (σ = 2 × the local blur), from the same frame.

## Examples that changed

groupCarryDomainWarp (UV Warp, Smooth), neonFloorGrid (SDF Glow, Halo), the 2D Scene Builder examples
(sb2*: SDF Glow; sb2 with bloom: Pass + Glow (texture)), volAnimatedRepeat (Pass + Chromatic Aberration (lens),
Channel split), comboBloomDots and fcTrippyNoise (Pass + Glow (texture), Bloom chain), comboBlurDirectional
(now *Wave Texture + Blur*: Blur (texture); the old one-direction Kawase blur has no texture version),
dofDepthBlur (depth in the Pass's alpha → Depth of Field (texture)), tiltShiftScene (Tilt-Shift (texture)),
motionBlurTrails (Feedback (texture)), feedbackSmear and fcMainFrame (the picture's Pass and its Previous),
passFeedbackTrails (the fade built by hand, Keep per frame), ttMotionTrails (Feedback (texture)).

# The catalogue sweep (2026-10-17, second round)

The same rules (merged = an alias, hidden = still registered and offered nowhere: `CATALOGUE_RETIRED_TYPES` in
`src/nodes/notOffered.ts`), for the rest of the node audit's duplicates. Tests:
`src/nodes/__tests__/catalogueSweep.test.ts`.

## Old transforms → Transform

Transform 2D, UV Transform 2D, Rotate 2D, Translate / Rotate / Scale 3D and Translate / Rotate / Scale 4D are hidden.
A graph that has one switches it to a **Transform** when it opens (every load path: examples, saved graphs, imported
files, Present snapshots, `replaceGraph`), with the same plan as the card's Switch to Transform, but only where the
numbers are exactly the same: a setting whose units change (an angle in radians becoming degrees) is never carried on
load, so a Rotate 3D with a non-zero Angle, a UV Transform 2D or Rotate 2D with an unwired angle stays as it was. Play
controls on a switched setting follow it (`mv::tx` → `mv::x`), and so do a group card's overrides. The 4D Scene
Builder's spin is a 4D Transform now (it used Rotate 4D); the 3D builder already wrote Transforms.

Examples rewritten to Transform: every one that had an old transform (the 4D folder, curved space, Learn's
Transform / Truchet / Wood, Learn 3D's Combine, the web shaders, Grid tour, the 3D scenes). Six could not switch as
they were (a Translate with only Z wired, a Rotate 3D with its Angle wired): a Make Vec3 now carries the wire into
the Transform's Offset or Turn. sdCrossScene3D's Rotate 3D had settings the node never read (it drew unturned): it is
an identity Transform you can turn.

## 3D shapes and folds

| Old | Now | How |
|---|---|---|
| Fold 3D | **Mirror Fold 3D**, Offsets 0 | Merged (alias): `abs(p) − 0.0` is `abs(p)`; each axis as Fold 3D read it |
| Vertical Capsule | **Capsule SDF 3D** | Merged: the same function under another name (and its "Half Height" was the full height) |
| Rounded Box | **Box SDF 3D**, Edges Rounded | Merged: the same `sdf3d_roundedBox` call; its Radius is Rounding |
| Rounded Cylinder | **Cylinder SDF 3D**, Edges Rounded | Merged where exact: its Radius was half the outside radius (IQ's formula doubles it), so the Cylinder's Radius is twice it and the call halves it again. One with its Radius *wired* can't be doubled: it stays a Rounded Cylinder (hidden) |

Box SDF 3D and Cylinder have **Edges** (Sharp / Rounded) and a **Rounding** slider (and socket) shown for Rounded. Sharp
emits exactly the plain shape's code, and the hidden Rounding is no uniform, so every existing box and cylinder compiles
as before. The 3D Scene Builder's Round is that Rounding now (it used to swap in the rounded node).

A merge that is exact except in one wiring is an alias with `when` (`definitions/aliases.ts`): nodes it holds for
migrate, the rest keep their (hidden, still registered) type.

3D Domain Warp, Turbulence 3D and Mirror Fold 3D were filed under 3D Primitives, so they sat ungrouped in the 3D
Shapes row; they are **3D Transforms** now, in its Warp and Fold groups.

Examples changed: curvedReverse, learn3dCombine and learn3dOrbit (Rounded Box → Box SDF 3D, Edges Rounded).

## Radiance Cascades 2D

Hidden (still registered, so a saved graph loads and renders as before): it was too slow for what it gave. No example,
recipe or builder used it. For light from a shape, use **SDF Glow** (its Point light mode for a lamp with a falloff).

## Shapers → Shaper

Ten shaping curves were ten nodes with the same sockets (x, Shape, sometimes a second Shape, Bipolar). They are one
**Shaper** with a **Curve** picker: Exp ease, Circular ease in / out, Exp seat, Circle seat, Exp sigmoid, Logistic
sigmoid, Circle sigmoid, Elliptic sigmoid, Quadratic Bezier (`shapers.ts`, `SHAPER_CURVES`). Each Curve runs its old
node's generator, so the code is exactly the old node's; only the Quadratic Bezier brings its helper. The card draws
the curve (the same curve picture the old nodes had) and the Bezier editor opens for the Quadratic Bezier curve.
Shape is shown for the curves that read it, Shape Y for Elliptic sigmoid and Quadratic Bezier. Saved shapers are
aliases (`curve` set, the old defaults filled: Logistic's started at 0.7). **Cubic Bezier** stays its own node (four
control settings, and its own editor).

Example changed: learnShapers (Exp Sigmoid → Shaper, Curve Exp sigmoid; the same code, renamed uniforms).

## Chladni

Chladni Plate, Chladni Field, Chladni Superposition and Wave Term were four nodes for one formula. They are one
**Chladni** node (type id `chladniField`, so graphs saved with Chladni Field load unchanged):

- square plate: `waveTerm(n, m) + Mix · waveTerm(m, n) + Σ Weight_i · waveTerm(n_i, m_i)` (Terms 2–6, folded under
  *More modes*); round plate: `cos(n·θ + Mix·π)·cos(m·π·r) + Σ Weight_i · cos(n_i·θ)·cos(m_i·π·r)`.
- Mix −1 is the classic plate, `cos nπx cos mπy − cos mπx cos nπy` (the old Plate), Mix 0 a single wave (Wave Term).
- **Lines** (and **Color**, Lines × Brightness) draw the still lines anti-aliased with `fwidth`: the old Plate's
  Density. They are expressions on the outputs, so nothing is added to a shader that doesn't wire them.
- **Wobble** (the old Plate's turbulence) pushes the point by a noise first; off, no noise code at all.

| Old | Chladni with |
|---|---|
| Chladni Plate | Mix −1, Aspect Fill, Bounded Infinite, Wobble On; Density → Lines (the same value; its literal π and the shader's PI are the same float32) |
| Chladni Superposition | Mix 0 (adding 0 × the swapped term changes nothing); n1 / m1 → n / m |
| Wave Term | Mix 0; Value → Field |
| Chladni Field | itself |

**Chladni Mode Frequency** stays (one Frequency knob → n and m). The agents' **Chladni** force is separate.

Examples changed: agentRidePath (notes; its shader picks up the new settings). The two Physics examples load as they
did ("Chladni (Quick)").

## Small duplicates

| Old | Now | How |
|---|---|---|
| Vec2 → Angle | **Vector Angle**, its new Vector input | Merged: the same `atan(v.y, v.x)`; Result → Angle |
| Vec2 Swizzle, Vec3 Swizzle | **Swizzle** | Merged: Input vec2 / vec3, Pattern = the old Mode |
| Vec2 Const | **Constant** (vec2) | Merged: the same `vec2(x, y)`; Val → Value |
| Simple SDF | Shape SDF, Circle / Box / Ring SDF | Hidden: the same shapes, not the same float operations |
| SDF Colorize | SDF Fill | Hidden: SDF Fill mixes the other way round (`mix(bg, fill, 1 − t)`), equal to rounding only |

Considered and left for now:

- **Color Ramp → Stops Palette**: Color Ramp is a chain of `mix()` calls between evenly spaced stops; Stops Palette
  interpolates differently, so the colours are close but not the same. Three builders (the Look grade's Duotone and
  Gradient map, the 2D and 3D Scene Builders' ramps) write Color Ramps, so it stays offered.
- **One Colour Adjust node** for Brightness / Contrast, Saturation, Hue Rotate, Lift / Gamma / Gain, Shadows /
  Highlights and Tone Curve: a node that runs every step would turn a migrated single step into several (not exact);
  one with a step picker adds nothing over the six. Q12 gives them one home (Colour grading) instead.
- **Size-switching matrix nodes** (Mat2 / Mat3 Construct, Inspect, × Vec, Inverse, Mix): the Mat3 versions have a
  third vector socket, so one node needs its sockets to follow a Size setting; a later round.

Examples changed: gridLavaLamp (Vec2 Const → Constant), colorStopsCycle (Vec2 → Angle → Vector Angle), learnRect
(Vec2 Const → Constant).

## Rows: one home per kind of node

- **Colour grading** holds every adjustment of a finished colour: Brightness / Contrast, Invert, Hue Range and
  Colour Matrix moved there from Colour, beside Saturation, Hue Rotate, Lift / Gamma / Gain, Shadows / Highlights,
  Tone Curve, Tone Map and Grain. **Colour** makes colour: pick, palettes, gradients, Luminance and Float → Color
  (moved from Math), conversions and blends.
- **Texture tools** holds every node that works on a texture: the "(texture)" effects (Blur, Glow, Edges, Depth of
  Field, Tilt-Shift, Displace, Jump flood), Chromatic Aberration (lens), Radial Fast Blur, Displacement Map and Sample
  (texture) moved there from Passes, which now holds the Pass. Its groups: Effects, Read, Shape the values, Channels,
  Time, Look and track. Motion (texture) stays an input (Inputs & media).
- **Combiners** has no glows left (they were merged into SDF Glow in the first round); its row text no longer says so.
- `CATEGORY_GROUPS` lists only types that sit in the row (Mix, Blend Modes, Make Vec3, Saturation and Fract were
  listed in rows they weren't in), and every offered node of a grouped row is in a group: Mirror 2D and Motion 2D
  (2D Space Basic), Quantize and Weighted Average (Math), Collide (3D scene) and Grid Rules (Agents), Field to Lines,
  Combine RGB, Repeat Cell, Curve Trace 3D and Time Cube Shape (3D Shapes, Traced), Curve Trace and Text (2D Shapes,
  Lines & text), and the screen finishes (Effects, Screen).

The definitions' categories changed with the rows (so search's category word and the card colour follow); the
structure map keeps each node's stage (Luminance stays a number).

- **Particles** (the one node of its own row) is in the **Agents** row, under Start here (since 2026-10-19 in Start here itself, with the Agents group and Grid Rules: no one-node groups, [node-browser.md](node-browser.md)); the
  one-node Particles row is gone on desktop and phone. Its search aliases are unchanged.

## Search

The audit ran the real scorer over 230 everyday words; the misses now land (`src/nodes/searchNodes.ts`):
`SEARCH_WORDS` adds words per node (sine → Sin, lerp → Mix, raymarch → March Loop Group, tonemap / hdr / exposure →
Tone Map, perlin / worley, hsl, font, checkerboard, slider, record, people, vhs, dither…) and `SEARCH_LEADS` makes a
node the first answer for its words (square → Box SDF, heart / star / hexagon → Shape SDF, "translate 3d" → Transform).
A select's option labels count when the node lists the param in `searchOptions` (Shape SDF's Shape: every one of its
shapes finds it). An alias that is the whole query now ranks above a label that only starts with it ("if" → Select,
not IFS). `catalogueSweep.test.ts` checks the words against the real scorer.

## Examples

- **3D: Hello Sphere** (`rayMarchOutputs3D`) was the same graph as Learn's **42 · Extra: first ray march**, which is
  built from it and adds notes and Play controls. The Learn one is kept; the old key opens it (`MERGED_EXAMPLES`).
- **fourDCliffordTorus**: inside its Scene Group, the Multiply's B read the Wobble Constant outside the group directly
  (it compiled only through the load-time repair); it now reads the group's Wobble port.

## Multi-Light: Background and sun angles

Thirteen 4D examples finished with the same seven nodes: March Loop → Split Vec3 → Expression → Multi-Light (its Sun
Dir from a Make Vec3) → Select (Hit, a background Colour) → Vignette → Tone Map. Multi-Light now has **Sun**
(*Azimuth & elevation* or *Direction X / Y / Z*; X / Y / Z stays the default, so every Multi-Light made before reads
the same) and **Background** (*Black* as before, or a **Background colour** where Hit is 0). The 4D finish
(`finish` / `finishGlow` in the 4D example files) drops its Make Vec3, Colour and Select: Multi-Light at Azimuth
50.7°, Elevation 50.1° (the old (0.55, 0.85, 0.45), normalised) with its own background. Examples changed: the 13 4D
examples that use it.

## Brush

The eight grid simulations (Life, Life-like, Brain, Water, Heat, Fire, Sand, Wire) each painted with the same five
nodes: Mouse (Pixels) → Multiply by the Pass's scale → Circle SDF round it → Compare (< 0) → Multiply by a Constant that
Play mapped to the mouse button. **Brush** (Inputs & media, `definitions/brush.ts`) is that chain in one node: Radius,
Softness, Value, Scale (the Pass's) and Paint (*While pressed* reads the mouse button itself, so it paints in the editor
too; *Always*). The eight examples use it, and their "(mouse button)" Play controls and mappings are gone.

## New examples

Every newer node has a short commented example: **Texture tools 22 · Deep glow on a video** (Glow (texture), Deep
glow), **Texture tools 23 · Displace a video by a noise** (Displace (texture)), **Audio 10 · Hit and Band Level**. Chromatic
Aberration (lens), Depth of Field (texture), Tilt-Shift (texture) and Band Level already had one (volAnimatedRepeat,
dofDepthBlur, tiltShiftScene, beatGrid).

## Folded sections on big nodes

Emit (Births · Life and speed), March Camera (Camera · Lens & focus · Projection), March Loop Group (March · Advanced ·
Look), GI Lit March Group (March · Advanced · Look · Quality), Mandelbrot / Julia (Fractal · Orbit trap · Colour), Shape
SDF (Shape), Array (Layout · Place · Combine · Look) and Multi-Light (Sun · Background · Light colours) have card sections:
the first open, the rest folded with their one-line summaries (`lib/sectionSummary.ts`). Folding is display only, so
every setting stays a uniform and Play controls on them keep working.

## Simple / All

Time Cube View (104 settings) and Frame Stack (70) open on a **Simple** set: the 15 and 13 settings the examples
change (`simpleParams` on the definition: slice, shape, glow, box and camera for Time Cube View; layout, cards, scan and
camera for Frame Stack). **All** shows every section. Display only (per card, per session, like folded sections):
every setting stays a uniform and keeps its value, so Play controls and graphs that set the others work as before.
