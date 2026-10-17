# Curves and Threshold

Two picture tools in **Texture tools**, the same as After Effects' Curves and Threshold. Source: `src/nodes/definitions/curves.ts`; the card editor is `src/components/NodeGraph/CurvesEditor.tsx`.

## Curves

Curves changes the tones of a picture by a line you draw. On the card's graph, the bottom edge is what comes in (dark on the left, bright on the right) and the height is what goes out. The dashed diagonal means "no change".

- **Master** shapes red, green and blue together. **Red**, **Green**, **Blue** and **Alpha** each shape their own channel, after Master (After Effects does the same).
- **Drag a point** to move it. **Click the curve** to add a point (up to 12). **Drag a point out of the box**, right-click it, or double-click it to remove it.
- The curve is smooth and never bulges past your points. **Linear** joins the points with straight lines instead (good for hard steps). **Reset curve** makes it the diagonal again.
- **Presets** set every curve at once: Increase contrast (an S), Decrease contrast, Brighten, Darken, Invert, Posterize (4 steps) and Cross-process.
- **Open ↗** shows the same editor large.

Wire a **Texture** (a picture, a video, a Pass), a **Color**, or a plain **Value** from 0 to 1 (a mask or a fade: Curves then shapes that number with Master). Outputs: **Color**, **Value** (the Value through Master, or the brightness of Color) and **Alpha**.

Some shapes to try: an S adds contrast; lifting the left end gives a faded, matte black; pulling the middle up brightens without blowing out the whites; a curve that goes down is a negative.

### Why dragging is instant

Each point is sent to the shader as a live number, the same way a slider is. Dragging a point changes those numbers and the picture updates on the next frame, without rebuilding the shader. Adding or removing a point rebuilds it once.

## Threshold

Threshold splits a picture into what is brighter than **Level** (kept, white) and what is darker (black).

- **Read**: compare the brightness, or one channel (Red, Green, Blue, Alpha).
- **Softness**: how wide the fade between black and white is, centred on Level. 0 is a hard cut.
- **Invert**: keep the darker side instead.
- **Color out**: the picture kept where the mask is, or the black and white mask itself.

Outputs: **Mask** (0 to 1, for Mix, Mask and the like) and **Color**.

## Examples

In the **Pictures** folder: **Pictures 8 · Curves** grades the Room and cat photo with an S curve and then a cross-process look; **Pictures 9 · Threshold** makes a soft mask of the lamp light and dims the rest of the room.
