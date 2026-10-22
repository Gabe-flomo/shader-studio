# Kuwahara

**Texture tools → Kuwahara.** The painterly, oil-paint filter. For each
pixel it looks at the regions round it, picks the one whose colours vary
least, and uses that region's average colour.

A region that crosses an edge has both sides of the edge in it, so its
colours vary a lot and it loses. The pixel takes its colour from a region on
its own side. The result: edges stay crisp, while flat areas and fine
texture turn into flat patches, like brush strokes.

## Kinds

| Kind | What it compares | Look |
|---|---|---|
| Classic | 4 overlapping squares meeting at the pixel (above left, above right, below left, below right). The calmest one wins outright. | Blocky, square strokes, very hard edges. Good for cartoons. |
| Generalised | 8 soft sectors of a disc (Papari et al.), each read weighed by which sector it falls in and how far out it is. The sectors are blended, the calmest counting most. | Smoother and rounder, the most painterly. |
| Anisotropic | Generalised, with the disc stretched into an ellipse along the edge at the pixel. | Strokes follow the shapes. |

Anisotropic is a light version: the edge direction comes from one 3 × 3
edge read at the pixel (8 extra reads), not from a smoothed edge map in a
separate Pass as in the full method. It costs about the same as
Generalised, but on fine noisy detail the stroke direction can flicker.

## Settings

| Setting | What it does |
|---|---|
| Kind | Classic, Generalised or Anisotropic (above). |
| Radius | How far it looks, in reads: the brush size, 1 to 8. Live. A Colour chain stops at 4 (below). |
| Sharpness | Generalised and Anisotropic: how strongly the calmest sector wins. Low blends them all (soft, nearly a blur); high picks one (crisp strokes). Live. |
| Spacing | Picture pixels between reads: a bigger brush for the same cost, with gaps on fine detail. Live. |
| Mix | 0 is the original, 1 the painted colour. Live. |

Outputs: **Colour** (the result, blended by Mix) and **Variance** (how much
the colours vary in the region it chose, the three channels added: near 0
on flat areas, higher on edges and detail, so a handy detail mask).

## Where it reads from, and what it costs

It reads the same way as [Convolve](convolve.md):

- **Texture** (a Pass's Texture, a picture's, a video's or the webcam's):
  read at neighbouring pixels. Cheap, and Radius goes up to 8.
- **Colour ƒ** (a field socket, see [field-sockets.md](field-sockets.md)):
  any colour chain is worked out again at **every** read. That is a lot of
  reads: Classic at Radius 4 is 81 a pixel, Generalised about 50. A light
  chain (a noise and a palette) is fine; a heavy one gets slow fast. So
  Radius stops at 4 here.
- A chain that reads the previous frame can't be worked out elsewhere, so
  the colour passes through unchanged and the card says so.

**For a big brush, wire a Pass or a picture into Texture**, or raise
Spacing. The card shows how many reads a pixel costs.

Reads per pixel, roughly:

| Radius | Classic | Generalised | Anisotropic |
|---|---|---|---|
| 2 | 26 | 14 | 22 |
| 4 | 82 | 50 | 58 |
| 6 | 170 | 114 | 122 |
| 8 | 290 | 198 | 206 |

## Examples (folder: Painterly)

- **An oil-painted photo**: Walkway cat through Generalised, Radius 6.
- **Classic and Generalised side by side**: Room and cat, split down the
  middle.
- **A watercolour**: soft Kuwahara, Posterize for layers of paint, noise
  for paper grain.
- **A painted noise landscape**: noise and a palette, painted through
  Colour ƒ with no Pass.
- **A live painting**: Anisotropic on a picture; switch the Texture card to
  Webcam to be painted live.
- **A comic with ink outlines**: Classic and Posterize for flat fills, a
  Pass, then Convolve's Outline drawn on top as ink.

Code: `src/nodes/definitions/kuwahara.ts`, the shared reads in
`src/nodes/definitions/neighbourReads.ts`, the card in
`src/components/NodeGraph/KuwaharaCard.tsx`, examples in
`src/store/kuwaharaExamples.ts`.
