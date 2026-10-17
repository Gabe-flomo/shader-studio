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
| Glow Layer | Color | Distance to surface, UV X, UV Y, Radial, Angle |
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
- **From / To**: the driver's values at the bar's left and right ends. Height runs from −1 to 1 at
  first; set From 0 and To 2 to put the whole bar on the upper half of a scene. Swap them to flip it.
- **Presets**: the app's palettes, built in (Sunset, Ocean, Fire, Mono, Neon, Earth, Dusk, Forest…)
  and yours. **Save as preset** names the gradient and keeps it in the Library's palettes, the same
  store the Palette and Stops Palette nodes and the Play and Present backgrounds use, so a preset
  saved here shows up in all of them, and theirs show up here. Rename or delete yours from the same
  menu. A palette with more than 8 colours is resampled to 8 stops.

**Solid** switches back to the single colour. The gradient is kept behind it, so switching to
Gradient again brings it back.

## How it compiles

The colour param is untouched. The gradient is stored next to it as flat params:

| Param | What |
| --- | --- |
| `<key>__grad` | `{ on, along, interp, n }`: the shape of the gradient |
| `<key>__gc0…7` | each stop's colour (vec3) |
| `<key>__gp0…7` | each stop's place, 0–1 |
| `<key>__gfrom`, `<key>__gto` | the driver's range |

With the gradient on, the setting compiles to one call:

```glsl
pfGradient(pfGradT(<driver>, from, to), n, blend, c0 … c7, p0 … p7)
```

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
| Angle | round the middle, one turn | 0 → 1 |

To offer a gradient on another colour setting: list its drivers on the ParamDef (`gradient: [...]`),
call `gradientColourGlsl(params, key, ctx, drivers)` in the node's GLSL with what the context has
(`pos`, `normal`, `eye`, `value`, `uv`), fall back to the solid colour when it returns null, and add
`PF_GRADIENT_GLSL` through `glslFunctionsFor` (or the compiler's function set) when the gradient is on.
The uniform patcher and the card pick it up from the ParamDef.

## Scene Builder

A shape's Colour row has the same switch. The gradient is saved in the scene's spec. Built, a
shape's Color node gets the gradient and its Point and Normal wired from the march loop's hit point
and normal (inside Materials, through the group's Hit Pos and a Normal port). In GI mode the first
shape's gradient becomes the GI Lit March Group's Albedo gradient. The recipe text does not carry
gradients yet: a scene rebuilt from typed recipe text loses them.
