# Normal from Height

**Normal from Height** (Texture tools) turns any height into the way the surface faces, and lights it with one lamp, so flat noise looks embossed, like terrain or like water. It is Bump → Normal in Blender, Normal Map in TouchDesigner. Source: `src/nodes/definitions/normalFromHeight.ts`.

It sits next to **Height Light**, which colours a height map from Low to High and lights it under a sun. Normal from Height is the general one: any float as the height, a shiny highlight, and the normal or slope as colour.

## What it reads

- **Height ƒ**: any float. Noise, an SDF's Distance, a picture's brightness (Texture → Luminance), a Sin of a distance for rings.
- **UV**: where the height is read, in picture coordinates. Empty: this pixel.
- **Colour**: the surface's own colour, lit by the lamp. Empty: white.

### Exact slope, or the next pixel

Height is a field socket (the small **ƒ**, see `docs/field-sockets.md`): the node gets the wired chain as a function of position, so it can read the height anywhere. It reads it on four sides of the point, **Sample distance** pixels away, and takes the differences: an exact slope, as smooth as the height itself. A picture read works too: textures can be read anywhere.

Some chains can't be read anywhere: one with Echo, a blur or Previous Frame reads the previous frame, which only exists at this pixel. Then the node does not stop with an error. It takes the plain value and finds the slope from how it changes to the next pixel on screen (`dFdx` / `dFdy`). That is coarser (it sees 2 × 2 pixel blocks) and Sample distance does nothing, but it always works.

## Settings

| Setting | What it does |
|---|---|
| Strength | How deep the bumps are: 0 is flat, more is steeper slopes and stronger shading. |
| Sample distance | How far to each side the height is read, in pixels. Wider is smoother, softer bumps. |
| Invert | Swap high and low: bumps become dents. |
| Light from | The lamp's direction in degrees: 0 from the right, 90 from the top, 180 from the left. |
| Light height | How high the lamp is: 10–30° rakes across and shows every bump; 90 is straight in front. |
| Light colour | The lamp's colour, for the lit side and the highlight. |
| Ambient | Light that reaches the shadows too: 0 is black shadows. |
| Specular | How bright the shiny highlight is: 0 matt, about 1 glossy. |
| Shininess | How small and sharp the highlight is. |
| Mode | What Colour shows: Lit surface, Normal as colour, or Slope as colour. |

Every number is a live slider (no recompile); Strength, Light from, Light height, Ambient and Specular can also be wired (right-click the slider → Control from outside). Invert and Mode change the code.

## Outputs

- **Normal**: which way the surface faces, length 1: x across, y up the picture, z out of the screen.
- **Shaded**: the light alone, 0 to 1 (Ambient + lamp + highlight, clamped). Multiply your own colours by it.
- **Colour**: by Mode. Lit surface: Colour × (Ambient + (1 − Ambient) × lamp × Light colour) + Light colour × highlight. Normal as colour: Normal × 0.5 + 0.5. Slope as colour: the tilt in red and green, 0.5 where flat.
- **Slope**: which way the height rises and how fast, in height per picture unit, before Strength. Use it to bend where a picture is read, as water does.

## How it works

Slope = ((h(right) − h(left)), (h(up) − h(down))) / (2 × distance), with Invert turning it round. Normal = normalize(−Slope × Strength, 1). The lamp's direction comes from Light from and Light height; the diffuse light is max(dot(Normal, lamp), 0); the highlight is Blinn-Phong: max(dot(Normal, normalize(lamp + view)), 0) to the power Shininess, × Specular, with the view straight out of the screen.

## Examples

In the **Bump & Dither** folder: *Normal from Height: hammered metal from noise* (FBM, a sharp highlight), *terrain under a moving sun* (Light from wired to Time), *water rings over a photo* (Slope bends where a photo is read, the highlight added on top). Opening by key: `bumpPhotoRelief` (a photo's brightness as height, in its own colours) and `bumpBevelShape` (a star's distance as a bevel, Normal as colour). Built in `src/store/surfaceExamples.ts`.
