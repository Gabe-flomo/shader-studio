# Track mattes and masks

*Play layers, 26 Sep 2026. After Effects' track mattes and layer masks, for every layer the kit draws.*

Two ways to cut a layer:

- **Matte**: another layer decides where this one shows, by that layer's **Alpha** (where it is solid) or its **Luma** (where it is bright), either way **Inverted** if you like. Any layer can be matted and any layer can be a matte: particles, text, images, the camera, shapes, Script layers (2D and 3D), cloners, brushes, glyphs, contours, audio, lenses, bodies, and the Background layer (the picture itself). Nulls draw nothing, so they are neither.
- **Mask**: a shape the layer owns (not a layer of its own): a rectangle, an ellipse, a polygon clicked corner by corner, or a freehand outline. Masks move and turn with their layer, have **Feather**, **Expand**, **Opacity** and **Invert**, and combine by **Add**, **Subtract** or **Intersect** when there are several.

## Using them

Every layer card (except nulls and the Background layer) starts with two buttons.

**Matte** opens a small panel: pick the matte **Layer** (or **+ New shape**), **By** Alpha or Luma, **Invert**, and **Matte: Show it on the picture too**. Layers that would make a loop (a matte of a matte of … this layer) are left out of the list, and the panel says which and why. **Go to** jumps to the matte; **Remove** takes it off.

- **A hand path** (a Shape → Path through nulls on your fingertips, see tracking.md) makes a matte you hold between your hands: the layer shows inside the frame your thumbs and index fingers make (or everywhere else, inverted). With Hand lost → Fade, the matte fades out while a hand is away.
- **New shape** makes a solid white Shape layer (a box in the middle of the picture, no zone action), puts it right above the layer in the stack, hooks it up as an Alpha matte and selects it, so its handles are on the picture straight away.
- A layer becomes **hidden** the first time it is used as a matte, as in After Effects. It keeps running (particles move, scripts draw) and still works as the matte; its eye switch is "Show matte". The matted layer keeps its own visibility.
- **In the list**, a matte that sits right after the layer it mattes is tucked under it, joined by an elbow, with *Matte for …* under its name (a link back). A folded card says *Matte · Shape 1 · Alpha · 2 masks*. A hidden matte isn't dimmed like a hidden layer: it is at work.
- **On the picture**, a hidden matte can't be clicked (it isn't there), but once it is selected in the list its handles work, and dragging inside its box moves it.

**Mask** (then **Add mask**) offers Rectangle, Ellipse, Polygon and Freehand. A rectangle or ellipse starts over 70% of the layer's box (the middle of the picture for layers without one); a polygon or freehand outline is drawn on the picture (Enter, a double-click or the first corner closes a polygon). The masks are listed on the card in the order they combine; the open one is the one with **amber handles** on the picture (the layer's own handles are blue). On the picture, a press on another mask's outline opens that mask; a press elsewhere lets go of it and the layer gets its handles back. The ⋯ menu's *Reset to defaults* keeps the matte and the masks.

## Saved form

On any layer except nulls and the Background layer (`src/types/playLayers.ts`):

```jsonc
"trackMatte": { "id": "layer_…", "mode": "alpha" | "luma", "invert": false },
"masks": [{ "id": "m1", "shape": "rect" | "ellipse" | "polygon", "points": [], "op": "add" | "subtract" | "intersect", "invert": false }],
"mask_m1_x": 0, "mask_m1_y": 0, "mask_m1_w": 0.5, "mask_m1_h": 0.5, "mask_m1_rotation": 0,
"mask_m1_round": 0, "mask_m1_feather": 0, "mask_m1_expand": 0, "mask_m1_opacity": 1
```

- Both are absent when unused, so files from before them load and save unchanged.
- **Mask numbers are layer numbers** (`mask_<id>_<prop>`, like a Script layer's `p_` keys), so the + beside them makes a control (`layer:<id>::mask_m1_feather`), mappings drive them, takes record them, and web pages carry them, with nothing special anywhere. x and y are the offset from the layer's centre in picture heights (y up), turned with the layer; w, h, feather and expand are in picture heights. Polygon points are in the mask's own box (-0.5..0.5 each way), so Width and Height stretch them.
- The parser drops a matte on itself, junk masks and stray mask numbers, clamps the rest, and `parsePlayRecord` → `repairMattes` drops a matte on a missing layer or a null, and the link that closes a loop.
- Deleting a layer unhooks the layers it matted; deleting a mask takes its numbers and the controls (and their mappings) that drove them.

## How it draws (`src/play/kit/mattes.js`, `kit.js`)

A layer with a matte or masks, a layer that is a matte, and a layer a glyph layer reads are each drawn **into a canvas of their own** once a frame (`renderLayer`, cached per frame, so particles step once however many layers read them). There the layer draws with its own blend (so additive particles still add up among themselves), then:

1. **Matte**: its matte is rendered the same way (so a matte can have a matte of its own), then multiplied in. Alpha is `destination-in` (inverted: `destination-out`), exact at full resolution. Luma needs the matte's brightness as alpha, which no composite operation gives, so the matte is read back at up to 960 px on its long side, turned into white-with-alpha `L·a` (Rec. 601 brightness over black; inverted `1 − L·a`) and multiplied in, scaled up.
2. **Masks**: all of the layer's masks are combined into one canvas and multiplied in (`destination-in`). Each mask is its outline filled, grown (a stroke) or shrunk (a stroke cut out) by Expand, softened by Feather, inverted, then combined with the ones before it at its Opacity: Add is `source-over` (a + m − a·m), Subtract `destination-out` (a·(1 − m)), Intersect `destination-in` (a·m). A stack that starts with Subtract or Intersect starts from everything, as in After Effects. The mask canvas is drawn again only when a mask or the layer's place changes.
3. The result lands on the picture with the layer's blend.

**Feather** is the blurred shadow of the shape, at half size (the shape is drawn in one half of a double-width canvas and its shadow lands in the other, which is the half used). Canvas `filter` would be simpler, but WKWebView (the Mac app) has no canvas filter, and shadows blur everywhere.

**Picture mattes and layer mattes.** Text, image and camera layers still have their picture matte (Over / Reveal / Luma against the picture). That decides what the layer paints; the track matte and the masks then cut *that*. They multiply: Reveal + an Alpha matte shows the picture inside the letters only where the matte is. A layer with Reveal or Luma lands with Normal blending, as before. Particles' Mask (the picture through the particles) works the same way: it is how they paint.

**Everywhere the kit runs.** The app's overlay, web pages and Present (the inlined kit), offline renders and takes (`compositePixels` runs the kit frame by frame) and the Layers node read-back (a matted layer lands in the node's buffer already cut; a hidden matte doesn't) all go through the same `kit.frame`, so they match. A hidden layer that is a matte counts as running for the render loop (`isAnimated`) and for camera use in exported pages.

**Cost.** Nothing changes for layers without a matte or masks: they draw straight onto the overlay as before. A matted or masked layer costs one full-size canvas and one extra draw (plus one per matte), reused frame to frame and released when the layer stops needing it. Alpha mattes are GPU composites. A luma matte adds a read-back of at most 960 × 540 pixels a frame. A static mask costs one draw a frame; a moving or animated one redraws its canvas (a feathered one at half size).

**Not yet.** A Cloner copies its source without the source's matte or masks. Masks follow a layer's position and turn but not its size. Hidden mattes can't be clicked on the picture (select them in the list).

## Where things live

| | |
|---|---|
| `src/play/kit/mattes.js` | the maths, the mask geometry, the canvas passes (shared with web pages) |
| `src/play/kit/kit.js` | `renderLayer`, which layers draw on their own canvas, hidden mattes that keep running |
| `src/types/playLayers.ts` | types, parsing, `MASK_PROPS`, `matteCandidates`, `repairMattes` |
| `src/play/mattes.ts` | record edits: set a matte, New shape, add / change / move / remove masks |
| `src/play/transform.ts`, `src/play/overlay.ts` | mask handles, drawing mask outlines on the picture |
| `src/components/play/layers/MatteMask.tsx` | the Matte and Mask buttons, the matte panel, the mask list |

**Examples** (Play → *Mattes & masks*): *Matte: a photo through particles* (a photo matted by a hidden particles layer and its trails) and *Masks: text through a moving window* (text matted by a hidden circle an LFO sweeps across, over ASCII cut by a feathered ellipse mask whose Feather is a control).
