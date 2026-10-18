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
| Glow (exp), Haze, Bounded, Ring Light, Simple (1/d) | Falloff, Ring Freq | SDF Glow |
| Halo, Soft, Exponential, Gaussian, Neon, Rim, Inverse square | Reach (Glow Layer's Intensity), Power | Glow Layer (`glowFormula`) |
| Bounded inverse power, Gaussian bump, Cone, Wyvill bump | Falloff (Distance Falloff's Rate), Power | Distance Falloff |
| Deep glow | Intensity, Radius, Saturation, Edge Softness | Deep Glow (SDF) |
| Point light | Falloff Model (Squared / Inverse / Linear), Intensity, Radius, Gamma | Point Light 2D's falloffs |

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
