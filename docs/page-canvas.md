# The page canvas

*Shipped 2026-09-28. Code: `src/components/shell/PageCanvas.tsx`, `pageCanvasStore.ts`, `src/lib/previewHost.ts`; the Convert page's views in `src/components/convert/convertView.ts` and `SplitOverlay.tsx`.*

The Studio and Play share the main preview: the `ShaderCanvas` with its
toolbar (the picture's shape, full screen, Record), the time controls and the
hover readout under it. Other pages used to get either the app's fixed preview
column beside them (desktop) or small previews of their own. The **page
canvas** lets a page host that same preview inside its own layout, full size.

## What a page gets

`<PageCanvas page="convert" />` is the main preview, hosted: the same
`ShaderCanvas`, the preview header (the page's own controls first, then shape,
full screen and Record / Snapshot), the footer with play, reset, rebuild, the
clock and the pixel under the cursor. While a page hosts the canvas, App's own
preview column (and its divider) step aside, so there is only ever one
`ShaderCanvas`; the mounted one registers with `lib/previewHost`, which is
where Record and Snapshot take the picture from. ⌘⇧F goes full screen on a
hosted canvas as it does in the Studio.

On desktop the host sits at the right of the page with a drag divider on its
left edge; the width is remembered per page (never under 320 px, never
squeezing what sits beside it under 240 px; a room too small for both gives
half). `phone` renders the picture with the floating pill (play, reset, time)
and the phone full-screen chrome instead of the header and footer.

The state (`pageCanvasStore.ts`, `shader-studio:pageCanvas` in localStorage):
per page whether the canvas is hosted (`full`) or the page shows its small
previews and the app's column (`small`), the hosted width, and for Convert
the view and the wipe's position.

## Convert

**Small previews / Full canvas** sits under the editor (next to Check /
Functions; on a phone in the Check pane). Small is the page as it was: the
84 px pair in the check and the app's column showing the converted graph.
Full hosts the canvas beside the read-only node canvas with a
**Source / Converted / Split** switcher in its header:

- **Source**: the pasted shader on the main canvas. The main canvas renders the
  store's shader, the scratch graph's compile, unless `rawGlslShader` is set,
  so Source sets it to the paste (as the check wraps it) with the shader's own
  uniforms (the ones that became Play controls) pinned to their starting values
  as constants: the canvas's uniforms are the graph's, and the picture should
  match the check's.
- **Converted**: the graph, as the app's column showed it.
- **Split**: an A|B wipe. The main canvas keeps rendering the converted graph;
  the source is drawn over its left part in a canvas of its own
  (`SplitOverlay`, on `sideRender.ts`, the check's renderer), clipped at a
  divider you drag (arrow keys too). Same clock (`lib/timeTick`), same
  drawing-buffer size and mouse as the main canvas, so the halves line up.
  Record, Snapshot and the hover readout come from the main canvas, so in
  Split they are the converted side's; the footer says so.

The side-by-side pixel diff (Same picture / Differs) stays in the check in
both layouts: it is what proves the conversion, and it needs its two small
readback canvases. Without a converted graph (a refused shader) the canvas
shows the source whatever the switcher says.

Phone: the Check pane stacks the canvas (with the phone pill and the
switcher) over the report; the toggle is in the pane's top row.

## GLSL

The editor's toolbar has a **Full canvas** button. Off, the app's column shows
the shader as before; on, the page hosts the canvas beside the editor (42% of
the room until dragged) with the toolbar, and the way back (**Small preview**)
sits in the canvas's header, where it can't be pushed out of the editor's
crowded toolbar. On a phone, which has no preview column, Full canvas puts the
picture over the editor.

## Builder

The Function builder's preview is the function plot, not a shader preview;
it has no page canvas.

## The Studio graph's toolbar and Maximize graph

*2026-10-18. Code: `src/components/shell/CanvasToolbar.tsx`, `canvasGraphMenu.ts`, `graphLayout.ts`.*

The toolbar over the Studio graph has exactly three controls:

- **Maximize graph** (desktop; ⌘⇧G). The graph takes the whole window and the
  picture goes **behind** it, full size: the same preview column (the same
  `ShaderCanvas`, no second renderer) is moved under the graph's area and
  resized, its header, footer and divider step aside, and the aspect preset
  chosen in the preview's header still letterboxes it. The graph's background
  turns to a light dim (the dot grid stays) so the picture shows through; the
  cards and the code bar stay solid, and the pointer always goes to the graph.
  Again (or the button) brings the split back. Remembered on this device
  (`playfield.graphMaximized`). A floated preview stays a window.
- **Outline**: the list of nodes in evaluation order, with step-through.
- **Randomise**: a click randomises every setting on the level on screen (one
  undo step). A right-click, or a long press on touch, opens its menu:
  **Randomise settings** and **Randomise options…** (strength, locks, groups,
  focus, seed). This is the one place for it.

Where the rest went:

| Was on the toolbar | Now |
|---|---|
| Zoom −/%/+ | Scroll or pinch; the % sits in the canvas's bottom-left corner (click: 100%); **Zoom to 100%** in the right-click menu |
| Fit | **F**; **Fit all nodes in view** in the right-click menu |
| Auto layout (and its "by stage" menu) | **Auto layout** in the right-click menu (by data flow; stages are gone from the graph) |
| Minimap | **Show / Hide the minimap** in the right-click menu (setting `shader-studio:minimap`) |
| Next (⚡) | **Show / Hide Next suggestions** in the right-click menu |
| Flow strip | Removed (docs/structure-hints.md) |
| Node count, frame time | The bar under the graph (the Generated code bar), each still opening its panel |
| Graph ⋯: Outline | The toolbar's Outline |
| Graph ⋯: Show passes, Optimise, Bake, Reset to starter, Clear to UV and Output | The empty canvas's right-click menu (**View** and **Graph** sections) |
| Graph ⋯: Randomise settings / options | The Randomise button and its right-click menu |

The empty canvas's right-click menu opens inside groups too, and on a locked
canvas (Convert) with only its view items (Fit, zoom, minimap, passes).
