# Gradient colours

A colour setting can be **Solid** (one colour, as always) or a **Gradient**: 2–8 colour stops laid
along something the node knows about, such as the height of a 3D surface, the direction it faces,
or how far a pixel is from a shape's edge.

Code: `src/lib/colourGradient.ts` (the maths, the params, the GLSL), `src/components/ui/GradientSetting.tsx`
(the editor), `src/components/NodeGraph/GradientColourParam.tsx` (the node card row).

## Where it is offered

| Place | Setting | Along (drivers) |
| --- | --- | --- |
| March Loop Group, GI Lit March Group | Albedo | Height, Distance from centre, Along X, Along Z, Normal (up → down), Depth, Noise |
| 3D Scene Builder shapes (Surface mode; GI mode uses the first shape's) | Colour | Height, Distance from centre, Along X, Along Z, Normal (up → down), Noise |
| Color node | Color | the same as the Scene Builder; it reads the Point (and Normal) wired into it |
| SDF Fill | Fill | Edge → inside, UV X, UV Y, Radial, Angle |
| SDF Glow (was Glow Layer's Color) | Tint | Distance to surface, UV X, UV Y, Radial, Angle |
| Colorize | Colour | Field brightness, UV X, UV Y, Radial, Angle |

A setting only offers drivers its node can give. A Color node needs a 3D point wired into **Point**
(a march loop's Hit Pos); until one is wired it shows its solid colour. SDF Fill and Glow Layer had
no colour setting before (their colour came only from the socket): the new swatch starts white, the
colour they always used, and a saved graph that never touched it compiles to the same shader.

Not offered yet: Draw agents (it already colours along a palette with Colour by), the background
colours of the march loops (a ray that misses has no surface to measure), the mobile graph browser's
colour rows, and colour settings on other nodes.

## The editor

Click **Gradient** beside the swatch. Then:

- **The bar**: click it to add a stop, drag a handle to move it, click a handle for its colour,
  Backspace removes one (never below 2; at most 8).
- **Along**: what picks the place on the bar at each pixel.
- **Blend**: Smooth eases into each stop, Linear mixes straight, Constant holds each colour until
  the next stop (bands).
- **Wrap | Mirror** (Angle only, the periodic driver): how the gradient goes round. **Wrap** (the default)
  is cyclic: past the last stop it blends back into the first, so there is no seam where the angle wraps.
  **Mirror** runs the stops 0 → 1 over half a turn and back 1 → 0 over the other half.
- **From / To**: the driver's values at the bar's left and right ends, as small sliders (drag, or type a
  number; typing past an end widens the slider, as everywhere). Height runs from −1 to 1 at first; set From 0
  and To 2 to put the whole bar on the upper half of a scene. Swap them to flip it. For Angle, From is where
  round the circle the gradient starts and To − From how much of a turn it spans (1 = one turn, 0.5 = the
  gradient twice round), so animating From turns a colour wheel with no seam.

### Animating From and To

While a setting is a Gradient, its node has two more input sockets, **‹Setting› from** and **‹Setting› to**
(SDF Glow's are *Tint from* and *Tint to*). A wire there replaces the slider, the way a socket replaces a slider
anywhere: wire Time into *Tint from* on an Angle gradient and the wheel turns. The slider row shows the wire
instead. Switching back to Solid takes the sockets away (a wired one stays until it is unwired).

Right-click the From or To row (or use the knob menu) for **Add to Play controls**: each is a Play control
target (`nodeId::tint__gfrom`), so MIDI, keys, LFOs and the rest can drive it. Its range is the driver's default
range with as much again each side, and typing past the end widens it. Both are live uniforms: dragging,
wiring values in Play, or any mapping never recompiles the shader.
- **Presets**: the app's palettes, built in (Sunset, Ocean, Fire, Mono, Neon, Earth, Dusk, Forest…)
  and yours, each with a small strip of its colours beside its name. **Save as preset** names the gradient and keeps it in the Library's palettes, the same
  store the Palette and Stops Palette nodes and the Play and Present backgrounds use, so a preset
  saved here shows up in all of them, and theirs show up here. Rename or delete yours from the same
  menu. A palette with more than 8 colours is resampled to 8 stops.

In the 3D Scene Builder's recipe a shape's gradient is quoted text:
`sphere gradient="height linear 0..2: navy 0, orange 0.5, (1,0.9,0.6) 1"` (the driver, the blend
when it isn't smooth, the range when it isn't the driver's own, then the stops). Describe reads a
shape's gradient back off the graph's Color node (src/sceneBuilder/recipeGradient.ts).

**Solid** switches back to the single colour. The gradient is kept behind it, so switching to
Gradient again brings it back.

## How it compiles

The colour param is untouched. The gradient is stored next to it as flat params:

| Param | What |
| --- | --- |
| `<key>__grad` | `{ on, along, interp, n, repeat? }`: the shape of the gradient (`repeat`: `wrap` or `mirror`, periodic drivers only) |
| `<key>__gc0…7` | each stop's colour (vec3) |
| `<key>__gp0…7` | each stop's place, 0–1 |
| `<key>__gfrom`, `<key>__gto` | the driver's range; also the From / To socket keys |

With the gradient on, the setting compiles to one call:

```glsl
pfGradient(pfGradT(<driver>, from, to), n, blend, c0 … c7, p0 … p7)
```

A periodic driver (Angle) goes round instead of clamping:

```glsl
pfGradientWrap(pfGradU(<driver>, from, to), n, blend, c0 … c7, p0 … p7)              // Wrap
pfGradient(pfGradMirror(pfGradU(<driver>, from, to)), n, blend, c0 … c7, p0 … p7)    // Mirror
```

`pfGradU` is `(v − from) / (to − from)` unclamped (turns). Wrap takes its fraction and lays one turn over the
stops' stretch of the bar plus a closing segment, as long as the average gap between stops, where the last colour
blends back into the first (Constant holds the last colour there). So stops at 0, ½ and 1 share the turn in thirds,
and stops at 0, ¼, ½ and ¾ land on the quarters. Mirror is `1 − |1 − 2·fract(u)|`. `evalGradientWrap`,
`mirrorT` and `evalGradientAt` are the same maths in JS, and the setting's swatch draws one turn from them.

A gradient saved before Wrap / Mirror existed has no `repeat` and wraps: an Angle gradient's hard seam where
the angle crossed ±π is gone, which is the point. One that relied on the cut (it is hard to see why one would)
can get it back with stops that end on the same colour they start with.

A wire into From or To (the `<key>__gfrom` / `<key>__gto` sockets) is passed to `gradientColourGlsl` with the
node's inputs and replaces that uniform in the call.

The stop colours, places and the range are live uniforms, so dragging a stop or picking its colour
never recompiles. Adding or removing a stop, changing Along or Blend, or switching Solid ↔ Gradient
rebuilds the shader. Exported pages and the web player get the uniforms like any other setting.

The blend weights are the Stops Palette's (`nodes/definitions/color.ts`): Smooth is
`f·f·(3 − 2f)`, Linear is `f`, Constant is its Bands. `evalGradient` in `colourGradient.ts` is the
same maths in JS; the tests check it against the Stops Palette and run the GLSL on the CPU.

Drivers (`GRADIENT_DRIVERS`) map a context's values onto a number:

| Driver | Value | Default From → To |
| --- | --- | --- |
| Height | world Y of the point | −1 → 1 |
| Distance from centre | length of the point | 0 → 1.5 |
| Along X / Along Z | world X / Z | −1 → 1 |
| Normal (up → down) | the normal's Y | 1 → −1 |
| Depth | distance from the camera | 2 → 8 |
| Noise | a soft value noise of the point × 2 | 0 → 1 |
| Distance to surface | the glow's distance | 0 → 0.3 |
| Edge → inside | minus the fill's distance | 0 → 0.3 |
| Field brightness | the Field's value | 0 → 1 |
| UV X / UV Y | the pixel's place | −1 → 1 |
| Radial | distance from the middle | 0 → 1 |
| Angle (periodic: Wrap / Mirror) | round the middle, one turn | 0 → 1 |

To offer a gradient on another colour setting: list its drivers on the ParamDef (`gradient: [...]`),
call `gradientColourGlsl(params, key, ctx, drivers, inputVars)` in the node's GLSL with what the context has
(`pos`, `normal`, `eye`, `value`, `uv`), fall back to the solid colour when it returns null, and add
`PF_GRADIENT_GLSL` through `glslFunctionsFor` (or the compiler's function set) when the gradient is on.
The uniform patcher, the card, the From / To sockets (the store's `withGradientRangeSockets`) and the Play
control list pick it up from the ParamDef.

## Scene Builder

A shape's Colour row has the same switch. The gradient is saved in the scene's spec. Built, a
shape's Color node gets the gradient and its Point and Normal wired from the march loop's hit point
and normal (inside Materials, through the group's Hit Pos and a Normal port). In GI mode the first
shape's gradient becomes the GI Lit March Group's Albedo gradient. The recipe text does not carry
gradients yet: a scene rebuilt from typed recipe text loses them.
