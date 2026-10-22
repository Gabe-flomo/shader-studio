# Convolve

**Texture tools → Convolve.** TouchDesigner's Convolve: one node for every
classic picture filter, because blur, sharpen, emboss and edge finding are
all the same move.

## What a kernel is

Lay a small grid of numbers over a pixel, the middle cell on the pixel and
the others on its neighbours. Multiply each pixel under the grid by its
number and add the results: that sum is the new pixel. The grid is the
**kernel**; its numbers are **weights**.

Sharpen's 3 × 3 kernel:

```
 0  -1   0
-1   5  -1
 0  -1   0
```

The pixel counts 5 times, the ones above, below, left and right are taken
away once each. On a flat patch that gives the same colour back (5 − 4 = 1);
on an edge the difference from the neighbours is pushed further.

- Weights that **add up to 1** keep flat areas as they were (blurs, sharpen,
  emboss).
- Weights that **add up to 0** turn flat areas black and keep only change
  (outline, edges). Use **Add bias** 0.5 to see negative results as darker
  than grey, or **Absolute value** to make them bright too.

The grid is on the card. On Custom you type into it; on a preset it shows
that preset's weights, and typing into a cell copies them to Custom with
that cell changed (Normalize off, so the sum is exactly what the grid
shows).

## Settings

| Setting | What it does |
|---|---|
| Preset | Which kernel (below). |
| Size | 3 × 3 (9 reads) or 5 × 5 (25 reads, wider and slower). |
| Spacing | Picture pixels between reads. Wider reaches further for the same cost, with gaps on fine detail. Live. |
| Amount, Radius | Unsharp mask only (below). Live. |
| Angle | Emboss: where the light comes from (0 right, 90 up). Motion blur: which way the streaks run. Live. |
| Normalize | Custom only: divide by the sum of the weights when it isn't 0, so a grid of 1s is a blur, not a white-out. |
| Absolute value | Negative results become positive: an edge is bright on both sides. |
| Add bias | Added after the sum (and after Absolute value). |
| Mix | 0 is the original, 1 the filtered colour. Live. |

Outputs: **Colour** (the result, blended by Mix) and **Luma** (its
brightness, one number).

## The presets

| Preset | Kernel | Adds up to |
|---|---|---|
| Sharpen | 3 × 3: the cross above. 5 × 5: 2 × the pixel minus its Gaussian blur. | 1 |
| Unsharp mask | Original + Amount × (original − a Gaussian blur). Radius is the blur's width, in reads: small sharpens fine detail, large adds local contrast ("clarity"). | 1 |
| Emboss | The middle 1; each neighbour −(its offset · the direction to the light) ÷ (half the size): towards the light negative, away positive. | 1 |
| Outline (Laplacian) | −1 everywhere, size² − 1 in the middle (8 or 24). | 0 |
| Edge X (Sobel) | `-1 0 1 / -2 0 2 / -1 0 1`: positive where it gets brighter to the right. The 5 × 5 one is ÷ 16, so a slope reads as strongly. | 0 |
| Edge Y (Sobel) | The same turned: positive where it gets brighter upwards. | 0 |
| Box blur | Every weight 1 ÷ 9 (or 1 ÷ 25). | 1 |
| Gaussian blur | `1 2 1 / 2 4 2 / 1 2 1` ÷ 16; 5 × 5 from `1 4 6 4 1`, ÷ 256. | 1 |
| Motion blur | Each read weighed by how close it is to the line through the middle at Angle, then divided by the total. | 1 |
| Custom | Your grid (`k0`…`k24`, row by row from the top; 3 × 3 uses the middle 9). Live: typing a weight never recompiles. | yours |

The grid is laid out as the picture is: the top row is above the pixel, the
left column to its left.

## Where the neighbours come from

- **Texture** (a Pass's Texture, a Texture Input's Texture, a Video's): read
  at neighbouring pixels. Used first when both inputs are wired.
- **Colour ƒ** (a field socket, see [field-sockets.md](field-sockets.md)):
  any colour chain (noise, Voronoi, shapes, a picture read) is worked out
  again at each read, so no Pass is needed. It costs the chain's work 9 or 25
  times over, so a heavy chain may be faster through a Pass.
- A chain that **can't** be worked out elsewhere (it reads the previous
  frame: Echo, a blur, Bloom) passes through unchanged, and the card says so.
  Send it through a Pass and wire the Pass's Texture into Texture instead.

The card's last line always says which of these it is doing.

## Examples (folder: Convolve)

- **Sharpen a photo**: Walkway cat through Sharpen, read through Colour ƒ.
- **Noise embossed into stone**: Perlin Noise through Emboss 5 × 5, tinted
  sandstone; Play turns the light.
- **Voronoi cells drawn as ink lines**: Voronoi's flat Cell colour through
  Outline: zero inside the cells, a line on every border.
- **Motion blur on a swinging ball**: Motion blur 5 × 5 along the swing.
- **A Custom kernel that reads only the left neighbour**: a single 1 in the
  left middle cell moves the picture right by Spacing.
- **Unsharp-mask "clarity" on a photo**: Room and cat read as a Texture,
  Unsharp mask with a wide Radius.

Code: `src/nodes/definitions/convolve.ts` (the GLSL, and the kernels in JS
as `convolveKernel`), the card in
`src/components/NodeGraph/ConvolveCard.tsx`, examples in
`src/store/convolveExamples.ts`.
