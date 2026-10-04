# Displacement Map

After Effects' **Displacement Map**, in three places that share one set of
rules (`src/play/kit/displace.js`):

| Where | What it moves | The map |
|---|---|---|
| **Play: a layer's Displace** (the Displace button under a layer's name, next to Matte and Mask) | that layer's own pixels, before it meets the picture; nothing else moves | another layer drawn alone (it can be hidden: it keeps running, like a matte), or the picture under the layers (the shader or the Background) |
| **Look: Displace → Push: By channels** | the whole finished picture | a layer drawn alone, or the picture |
| **Studio: the Displacement Map node** (Passes) | the Source: a Pass texture, or a colour chain read at the pushed position | the Map: any colour (with Map alpha) at this pixel, or a Pass texture |

## The rules

- **Use for horizontal / vertical displacement**: each direction reads one
  channel of the map at the point being drawn: Red, Green, Blue, Alpha,
  Luminance (Rec. 709), Hue (HSL, red 0, green ⅓, blue ⅔), Lightness
  ((max + min) / 2), Saturation (HSL), or a fixed **Full** (1), **Half**
  (0.5) or **Off**.
- **Mid-grey (0.5) moves nothing.** 1 moves by the full Max, 0 by minus Max:
  `push = (channel − 0.5) × 2 × Max`.
- **Max horizontal / vertical** are in pixels of a 1080-pixel-tall picture,
  so a setup looks the same at any size (Max 100 on a 720-tall preview is
  66.7 real pixels). Positive Max moves bright parts' pixels **right** and
  **up**; negative turns it round. On a layer they are layer numbers
  (`disp_maxH`, `disp_maxV`), in the Look effect numbers (`maxH`, `maxV`),
  on the node sliders: every one can be a control and be mapped.
- **The map's empty parts move nothing**: a colour channel fades to 0.5 with
  the map's alpha. The Alpha channel reads alpha itself, so with Alpha an
  empty part pushes the full Max the other way (as in After Effects).
- **Map behaviour** (a layer map): **Center map** reads the map where it lies
  on the picture (After Effects' default with comp-sized layers, which is
  what every Play layer is). **Stretch map to fit** scales the map's visible
  part (its box, found on a 128 × 72 grid of its alpha) to cover the
  picture. **Tile map** repeats that box across the picture. A full-picture
  map (the picture, a shader) is the same in all three.
- **Edge behaviour**: **Wrap pixels around** reads from the other side of
  the picture. Off: a layer gets nothing from past the edge; the Look and a
  Studio texture repeat the edge pixels; a Studio chain is simply read past
  the edge.
- It is a lookup: the pixel drawn at `p` is the source at `p − push`, with
  the map read at `p` (After Effects reads the map at the output pixel too).
- Deterministic: no randomness, so takes, renders and exported pages match.

## Play: a layer's Displace

`layer.displace` (`LayerDisplace` in `src/types/playLayers.ts`):
`{ on, map: 'layer' | 'picture', layerId, h, v, behaviour, wrap }`, with
`disp_maxH` and `disp_maxV` beside it on the layer. Absent = not displaced;
any kind that can have a matte can have one. `parseDisplace` checks a file's
value (a map that is the layer itself reads the picture). Record edits:
`addDisplace`, `patchDisplace`, `removeDisplace` in `src/play/mattes.ts`.
Adding one with a layer map hides that layer the first time, like a matte;
its row then says *Displaces …*.

In the kit (`kit.js`), a displaced layer is drawn on its own canvas; then,
in After Effects' order, its **masks**, its **Displacement Map**, its
**track matte**. The map layer is rendered alone (`renderLayer`, so its own
matte, masks and displacement apply) and both canvases go through a small
WebGL2 canvas of the kit's own (`dmCreate`): the layer is uploaded
premultiplied, the map straight. Without WebGL2 the layer draws unmoved. A
map that loops back to the layer reads as mid-grey (nothing moves).

## Look: Displace By channels

`dispMode: 'channels'` on a Displace effect whose Map is **A layer** or
**Brightness** (the picture), with `chanH`, `chanV`, `behaviour`, `wrap` and
the numbers `maxH`, `maxV`. Absent (every stack saved before) is the old
push along Direction, so older stacks render exactly as they did; their
shader is the same apart from the effect's uniform array growing by one.

## Studio: the Displacement Map node

Inputs: **Source ƒ** (a field socket: the chain is compiled again as a
function and read at the pushed position), **Source texture** (wins over
Source ƒ), **Map** and **Map alpha** (this pixel's colour), **Map texture**
(wins over Map), **UV**. Settings: Horizontal, Vertical, Max horizontal, Max
vertical, Edges. A chain that can't be a field (previous frame, particles,
Play layers) is refused on the card: put a Pass after it and wire its
Texture into Source texture. A Pass's **Color** wired into Source ƒ reads
that pixel only (Pass nodes are allowed in field chains elsewhere); wire its
Texture instead.

## Examples

- Play → *Displace: text rippling through a map*: a Text layer displaced by
  a hidden Script layer's red (sideways) and alpha (up and down).
- Play → *Displace: particles by the shader, the picture by a word*: a
  Particles layer displaced by the picture's red and green (with Wrap), and
  the Look's Displace By channels reading a hidden word's luminance.
- Passes → *Passes 7 · Displacement Map: a picture pushed by noise*: the node
  with a Truchet chain as Source ƒ and FBM noise as the Map (luminance).

## Not done

- **Expand Output**: Play layers already cover the whole picture, so there
  is no layer edge to grow past.
- Behaviour in the Studio node: its map is always picture-sized.
- A Particles layer is displaced as drawn pixels; the simulation itself (and
  what the particles read) doesn't move.
