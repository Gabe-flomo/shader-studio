# SDF Bevel

**SDF Bevel** (SDF → Style, next to SDF Fill) lights a flat 2D shape as if it were raised, so logos, buttons, badges and tiles look 3D. Tick Invert and the shape is engraved instead. It is Bevel and Emboss in Photoshop, a bevel in After Effects or Figma. Source: `src/nodes/definitions/sdfBevel.ts`.

It works like SDF Fill (a distance in, the shape painted) with Normal from Height's lamp: the distance becomes a height, the height's slope says which way the surface faces, and one lamp lights it with a shiny highlight and a soft drop shadow.

## What it reads

- **Distance ƒ**: any 2D shape's distance, negative inside: Circle SDF, Box SDF, Shape SDF, a Union of several, an Onion ring, or a noise turned into a distance with Remap.
- **Fill**: the shape's own colour (a Gradient, a Palette, a picture). Empty: the Fill colour setting.
- **Background**: what is round the shape (another node's picture, another bevel's Colour). Empty: the Background colour setting.
- **UV**: where to read the distance. Empty: this pixel.

### Exact slope and shadow, or the next pixel

Distance is a field socket (the small **ƒ**, see `docs/field-sockets.md`): the node gets the wired chain as a function of position, so it reads the distance one pixel to each side of the point for an exact slope, and once more towards the light for the drop shadow.

Some chains can't be read anywhere: one with Echo, a blur or Previous Frame reads the previous frame. Then the node does not stop with an error: it finds the slope from how the height changes to the next pixel on screen (`dFdx` / `dFdy`), which is a little coarser, and draws **no drop shadow**.

## Profiles

How the bevel climbs from the outline (0) to Width in (full Depth):

| Profile | Feel |
|---|---|
| Chamfer (straight) | A straight slope: crisp facets, cut stone, a gem's faces. |
| Round (quarter circle) | Steep at the outline and rounding over onto a flat top: a soft, pressable button. |
| Cove (scooped in) | Flat at the outline and steep near the top: a moulded, scooped edge. |
| S-curve (ogee) | Scooped in at the bottom, rounded over at the top: a picture-frame moulding. |
| Pillow (soft dome) | Rises at the outline and eases flat: puffy, like a cushion or a gummy sweet. With a wide Width the whole shape is one dome. |
| Steps (terraces) | **Steps** flat levels, each with a short ramp: a relief map's contour layers. |

## Settings

| Setting | What it does |
|---|---|
| Profile, Steps | The bevel's shape (above); Steps is the terrace count. |
| Width | How far in from the outline the bevel goes, in picture units (the picture is 2 high). Wider than the shape is thick: a dome with no flat top. |
| Depth | How high the top stands, in picture units. About Width gives a 45° chamfer; less is gentler. |
| Invert | Engraved instead of raised: the shape is cut in, and the shadow falls inside the cut. |
| Light from | The lamp's direction in degrees: 0 from the right, 90 from the top, 180 from the left. |
| Light height | How high the lamp is: low gives strong lit and dark sides; 90 is straight in front. |
| Light colour | The lamp's colour, for the lit side and the highlight. |
| Ambient | Light that reaches the dark side too: 0 is black. |
| Specular, Shininess | How bright and how tight the shiny highlight is: 0 is matt; about 1 with high Shininess is glossy plastic. |
| Shadow, Shadow distance, Shadow softness | The drop shadow's darkness (0 is none), how far it falls away from the light, and how blurred it is. Only when the distance can be read elsewhere. |
| Edge softness | How soft the shape's outline is, in pixels: 1 is smooth with no jaggies. |
| Outline, Outline colour | A line along the outline this wide (0 is none), in its own colour. |
| Fill, Background | The colours used when nothing is wired into those sockets. |
| Mode | What Colour shows: Lit shape, Normal as colour, or Height as grey. |

Every number is a live slider (no recompile); Width, Depth, Light from, Light height, Ambient and Specular can also be wired (right-click the slider → Control from outside): wire Time × 30 into Light from and the lamp goes round. Profile, Invert and Mode change the code.

## Outputs

- **Colour**: by Mode. Lit shape: the shape lit (Fill × (Ambient + lamp × Light colour) + highlight) over Background, with the shadow and the outline.
- **Shaded**: the light alone, 0 to 1, with the shadow taken off. Multiply your own colours by it.
- **Normal**: which way the surface faces, length 1 (x across, y up, z out of the screen).
- **Height**: 0 outside and at the outline, Depth on the flat top (below 0 when engraved).
- **Mask**: 1 on the shape, 0 outside, soft over Edge softness: for Mask or Alpha Blend.

## Examples

In the **Bevel** folder (`src/store/bevelExamples.ts`):

- *A glossy app button*: a Rounded Box with a Round bevel and a Gradient fill, a white ring raised on it by a second SDF Bevel.
- *A gold star badge*: a Shape SDF star, Chamfer, warm light circling it.
- *A seal cut into stone*: a ring and a star, Invert with Chamfer grooves, on speckled noise stone.
- *A floor of soft tiles*: Infinite Repeat → Rounded Box → Pillow, each tile its own colour, shadows on the grout.
- *A terraced island map*: Noise → Remap as a distance → Steps, the sun moving round.
- *Soft blobs under a moving light*: three moving circles in smooth Unions → Pillow, the light driven by Time.
