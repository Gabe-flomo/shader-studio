# Dither

**Dither** (Color, next to Posterize) cuts a colour down to a few levels, as Posterize does, but with a fine pattern of dots in between the levels instead of flat bands: the look of 1-bit Macs, the Game Boy, newspaper print and GIFs. Source: `src/nodes/definitions/dither.ts`.

## What it reads

- **Colour**: the colour to dither.
- **Position**: where each pixel is, in screen pixels, for the pattern. Empty: this pixel on screen (`gl_FragCoord.xy`).

## Settings

| Setting | What it does |
|---|---|
| Pattern | The dots between levels: **Bayer 2×2 / 4×4 / 8×8** (an ordered cross-hatch, coarse to fine), **Blue noise** (looks random but neighbours differ, so no clumps), **White noise** (plain grain), **Lines** (diagonal lines, a print halftone). |
| Mode | **Colour**: each channel on its own. **Black and white**: the brightness only. **Two colours**: the brightness mapped from Dark colour to Light colour (a print duotone). **Four colours**: one of four colours of your own by brightness (the Game Boy's greens to start). |
| Levels | How many levels each channel keeps: 2 is on or off (1-bit), 16 is nearly smooth. Four colours always uses 4. |
| Pixel size | How big each dot is, in screen pixels: 3–6 for a chunky retro look. For a fully pixelated picture, also pixelate what goes in (Pixelate on its UV). |
| Strength | How much pattern: 0 is plain flat bands (as Posterize), 1 is full dither. |
| Dark / Light colour | Two colours mode. |
| Colour 1–4 | Four colours mode, darkest to lightest. |

Levels, Pixel size, Strength and the colours are live sliders (no recompile); the first three can also be wired. Pattern and Mode change the code.

## Outputs

- **Colour**: the dithered colour.
- **Mask**: the brightness after dithering, 0 to 1 in Levels steps. At 2 levels it is a 1-bit mask, to cut one picture into another.

## How it works

Each pixel (or Pixel size block) gets a threshold t from the pattern, 0 to 1. The offset is o = mix(0.5, t, Strength). A value x in 0–1 with n = Levels − 1 steps becomes floor(x × n + o) / n: at Strength 0 that is ordinary rounding; with the pattern, a value a quarter of the way between two levels lands on the upper level in a quarter of the pixels.

- **Bayer** is built from bits, with no table: the 2×2 matrix is fract(dot(p, (0.5, 0.75 p.y))) (0 2 / 3 1, in quarters); the 4×4 is the 2×2 inside a coarser copy of itself at a quarter of the strength, the 8×8 once more. Each threshold is offset half a step, so they centre on 0.5.
- **Blue noise** is interleaved gradient noise (Jimenez 2014): fract(52.98 × fract(dot(p, (0.0671, 0.0058)))).
- **White noise** is a hash of the pixel.
- The functions are declared once per shader, however many Dither nodes there are (`DITHER_GLSL`), and only the ones used are kept.

## Examples

In the **Bump & Dither** folder: *1-bit Bayer clouds* (FBM in black and white, Bayer 8×8) and *Game Boy: four greens, chunky pixels* (Four colours, Pixel size 4). Opening by key: `ditherBlueSwirl` (blue noise on a palette swirl, 3 levels per channel). Built in `src/store/surfaceExamples.ts`.
