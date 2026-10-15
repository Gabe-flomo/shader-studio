# Blob Track

**Blob Track** (Texture tools) finds the separate bright shapes in a mask and follows them, each with an
ID that stays with it while it moves. It does what TouchDesigner's Blob Track TOP does.

Wire a mask into **Mask**: white shapes on black. A keyed video, a Mask (texture) through a Pass, Depth's
near mask through a Pass, a frame difference (Change). Left empty, it reads the picture itself (a frame late).

## Outputs

| Output | What it is |
|---|---|
| Count | How many blobs are seen now. |
| Position | The picked blob's centre, in picture coordinates (as UV). Wire it into a shape's centre to follow it. |
| Size | The picked blob's box, width and height in picture units. |
| Area | How much of the frame the picked blob covers, 0–1. |
| ID | The picked blob's ID. New blobs count up from 1. |
| Found | 1 while there is a blob at Pick. |
| Inside | 1 inside any blob's box. |
| Nearest | Distance to the nearest blob's centre (picture units): a glow or rings round every blob. |
| Overlay | Everything at once, to check what is found: the mask dimmed, the stamps, then the marks. |
| Marks, Marks alpha | The boxes, centre markers, labels and connections in their colours, and where they are: mix any picture to Marks by Marks alpha. |
| Stamped, Stamp alpha | The Stamp picture on every blob, and where it is. |
| Blob data | The blobs as a 16 × 3 float texture (below). |

**Pick** chooses the blob the single-blob outputs report: 0 is the oldest one seen now (the lowest ID),
1 the next, and so on. It is a live slider and a socket.

## Settings

- **Find:** Threshold, Channel (brightness, red or alpha), Invert (dark shapes on light), Resolution (the
  long side the mask is read at: 80, 160 or 320 px), Min size and Max size (shares of the frame), Max blobs
  (up to 16, the biggest kept).
- **Follow:** Max jump (how far a blob may move in a frame and keep its ID, as a share of the frame's
  height), Memory (frames a lost blob's ID is kept, so a flicker doesn't renumber it), Smoothing (blends
  position and size with the last frame's).
- **Show:** Pick.
- **Marks** (the tracking-overlay look):
  - **Boxes:** Box, Corner brackets or None; **Box colour** by ID or Line colour.
  - **Centre:** Dot, Cross ✕ or None, in Centre colour.
  - **Labels:** None, ID (`#3`) or x / y (the centre in preview pixels from the top left), in Label colour at
    Text size. Drawn from the preview's font atlas (`u_fontTexture`), four taps a pixel so small text stays smooth.
  - **Line width** and **Line colour**.
- **Connections:** **Connect** Off, Chain (in ID order, each to the next), Nearest, Two nearest or All pairs.
  A pair is always drawn from the older blob to the newer, so a pair found twice is one curve. **Bend** arcs
  the lines (a quadratic Bézier, its exact distance), **Arrows** puts an arrowhead halfway along, pointing
  older → newer, and **Flow** runs three dots along each line.
  **Line style** (solid, dashed, dotted), **Line colour by** (Line colour, the older blob's ID colour, or a
  gradient from one blob's colour to the other's), **Wobble** (moving noise shakes the lines) and **Max link**
  (connections longer than this share of the picture's height are left out). Labels can also be a **Hex code**
  (`0x3FA9C2`, from the ID; re-rolled each step in Jump). **Box padding** grows the boxes.
- **Motion:** where the marks (boxes, centres, labels, connections, stamps) are drawn.
  - **Follow:** on their blobs, gliding with them.
  - **Jump:** each mark holds, then snaps to its blob at random moments, each blob on its own clock about
    **Jump rate** times a second, landing **Scatter** off it. **Flicker** blinks marks out for a step, and
    Chain / Nearest connections re-pick a random partner each step (All pairs stays all pairs).
  - **Pulse:** the marks stay put for **Hold** seconds, then are placed again together. Packets with tails run
    along the connections, older → newer, at **Flow** speed (the rest of each line dims), and each box pulses
    on its own beat (**Pulse rate**).

  The holding is done by the engine (`placeMarks` in `lib/blobs/track.ts`) into row 2 of the blob texture;
  Position, Size, Inside and Nearest always follow the blobs themselves. For your own warp of the marks,
  wire one into **UV**.
- **Stamp:** wire a texture into **Stamp** and it is drawn on every blob. **Fit:** Box (stretched to the box),
  Square (the picture's shape, as big as the blob) or Circle (Square, cut round). **Scale**, **Sheet cells**
  (a 2 × 2 … 8 × 8 sprite sheet, each blob showing one cell by its ID) and **Spin by ID** (each blob's stamp
  turned its own way, kept while followed). Stamps are drawn under the marks.

## How it works

The finding runs on the CPU, outside the shader (`lib/blobs/engine.ts`), like the Depth node's model:

1. Right after the preview draws, the wired texture is copied small on the GPU (Resolution on its long
   side) and read back.
2. `lib/blobs/track.ts` thresholds it, labels the 8-connected regions (a flood fill each), measures each
   one's box, centre (the mean of its pixels) and area, and drops those outside Min…Max size.
3. Blobs are matched to the last frame's tracks by nearest centre, closest pairs first, no further than
   Max jump. Unmatched blobs get new IDs; unmatched tracks are remembered for Memory frames.
4. The result is uploaded to the node's own float texture (`u_tex_<node>`, BLOB_SLOTS × 3 texels):
   row 0 holds the centre x, y and box width, height (0–1 texture coordinates), row 1 the ID, area, age in
   frames and 1 for a blob, row 2 where its marks are drawn (held in Jump and Pulse). The shader loops over the 16 slots for Count, the picked blob and the Overlay.

It runs every frame while the preview plays, and once after any change while paused. At 160 px it takes
a few milliseconds a frame in the dev build, most of it the GPU readback; the card shows the count, the size
it reads at and the time.

## Limits (v1)

- Web pages don't track yet: the exported page sees no blobs.
- A Blob Track inside a Pass reads only textures the main picture also binds.
- Pick isn't a Play control (Play skips whole-number sliders).
- Not yet: Play sources from blobs, per-blob outputs beyond the picked one (use Blob data), blob outlines.

Examples: Texture tools 13 · Blob Track: a tracking overlay (brackets, crosses, x / y labels, curved arrows),
and 14 · a picture on every blob (Stamp). Code: `src/nodes/definitions/blobTrack.ts`, `src/lib/blobs/`.
Tests: `src/lib/blobs/__tests__/blobTrack.test.ts`.
