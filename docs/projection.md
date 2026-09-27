# Output window and projection mapping

The **output window** shows only the picture (the shader, the layers, the Finish stack), with no UI, on a projector or a second display. It stays in step with the app: same graph, controls, mappings, clock, layers and actions. The **Mapping** editor lays that picture onto real surfaces: corner pins, mesh warps, masks, edge blends and test patterns.

Both are **Pro** (`play.output` and `play.projection` in `src/lib/plan.ts`). On Free, the **Output** button carries a Pro badge and opens the Pro sheet.

## Quick start

1. Connect the projector and let the computer see it as a display (extended, not mirrored).
2. On the Play page, click **Output** in the preview header.
3. Under **Output**, choose the display (the desktop app lists every display by name and resolution), leave **Full screen on that display** on, and click **Open output window**. The choice is remembered.
   - In a browser, the output opens as a pop-up window. Drag it onto the projector, then press **F** (or double-click) there for full screen. In Chrome, **Find my screens** lists the displays and places the window on the chosen one.
4. Turn on **Show handles (H)** and pick the **Grid** test pattern.
5. Drag the four corners (in the editor's preview or on the projector itself) until the grid sits on the wall. The arrow keys nudge the grabbed corner by 1 projector pixel, Shift by 10. ⌘Z undoes.
6. Switch the pattern back to **Picture** and press **H** to hide the handles.

The mapping saves with the Play (in its record, `play.projection`), so it goes wherever the Play goes, including `.playfile`. **Presets** keep a mapping on this computer under a name and a venue or projector, to load into any Play.

## The Mapping editor

- **Surfaces.** Each one has:
  - a **corner pin**: four points, warped with a true perspective (homography), so a rectangle seen at an angle lines up exactly.
  - an optional **mesh warp**: a grid of points (2 × 2 up to 8 × 8) inside the corner pin, **Smooth** (a spline through the points, for domes, columns and curved screens) or **Straight** (for folded or faceted surfaces).
  - **what it shows**: the whole picture, the shader only, the layers only, one layer, or one group's layers.
  - **part of the picture**: a region (left, top, width, height), so several surfaces can each take a piece.
  - **edge blend**: feathered left, right, top and bottom edges for overlapping projectors, with an S-curve and the projector's gamma (2.2 typical). Two overlapping ramps add up to even light.
  - **brightness** and **gamma**.
- **Masks.** Polygons drawn on the output (click the corners in the preview; Enter or a click on the first point finishes) that black out part of it, such as a doorway or a window. **Invert** blacks out everything outside instead.
- **Test patterns.** Grid (with coloured corners: red, green, blue and yellow clockwise from top left, so you can see which way round a surface is), crosshair, colour bars (with a grey step strip for levels), and solid white.
- **Editing.** Drag corners, mesh points and mask points in the preview or on the output. Drag inside the selected surface (or a mask) to move all of it. Arrow keys nudge, ⌘Z and ⇧⌘Z undo and redo, and **H** shows or hides the handles on the output. On the output, **P** steps through the test patterns and **Esc** leaves edit mode.
- A mapping that changes nothing shows the picture whole (letterboxed) rather than stretched to the output's shape. The first edit starts from that fitted position, so nothing jumps.

The preview shows the whole picture on every surface, from a snapshot of the app's picture about 15 times a second. The output shows each surface's own source at full frame rate.

## Present and the Stage

- The output always follows the app's picture, so the Stage in **Full** mode is on the projector too (the Stage bar shows **On the output**).
- A **Present** canvas on the Stage (a snapshot) can go to the output with **Show on output**. The projector then shows that canvas and follows the Stage's page (its clock, controls and pointer), while the laptop keeps the controls. Leaving the Stage gives the output back to the Play.
- A canvas whose Script layers are someone else's code runs sealed off. The output can't follow it, so it isn't sent.

## How the output stays in sync

The output runs its **own renderer**: the website player (`src/play/runtime/play-runtime.js`) in **follow mode**, inside `output.html`. Frames are not copied across windows.

- **The record.** The Play as the web player takes it (the compiled shader, the bundle and the scripts) is sent when its *structure* changes: a new shader, a layer added, new media. Moving a slider or a layer's number doesn't rebuild it. In the desktop app, the record waits in the app (`output_record_put` / `output_record_get`) because it can be megabytes. The new player starts behind the old one and replaces it when ready.
- **Frames**, about 60 a second: the clock, the pointer, and only the uniforms and layer numbers that changed (every uniform of the app's material, so controls, mappings, MIDI and audio nodes all come through). A full frame goes out on request and every 120 frames. If a frame goes missing, the output waits for the next full one.
- **Actions** (bursts, drops, next line…) ride in the frames and are fired by the output's layer kit.
- **The clock** runs on between frames. Small differences ease in; a seek snaps.
- The output draws the player's canvases through the **warp pass** (`src/output/warpRenderer.ts`, WebGL2) as its last step: surfaces, then masks through the stencil buffer.

Transport: Tauri events between the two windows in the desktop app (`pf-output-down` and `pf-output-up`), or a `BroadcastChannel` in the browser. The protocol is in `src/output/protocol.ts`.

Files: `src/types/projection.ts` (the record, parse and migrate, presets), `src/output/warp.ts` (homography, mesh, triangles), `src/output/mappingEdit.ts` (handles, nudge, undo), `src/output/outputHost.ts` (the main window's side), `src/output/outputPage.ts` + `output.html` (the output window), `src/components/output/` (the editor), `src-tauri/src/output_window.rs` (displays, the window, full screen).

## What the output leaves out

- **Sound.** The output is silent. The main window plays everything.
- **Camera layers.** The output has no camera of its own, so they stay dark there.
- **The pad grid's cells** show at rest (the controller talks to the main window).
- Simulations (particles, falling letters, bodies) run in each window from the same clock and actions. They look alike but don't match grain for grain.
- A Present snapshot's own actions (layer bursts fired inside its page) aren't forwarded yet. Its values and clock are.

## To test on real hardware

These can't be checked without a projector:

- The display list and names on macOS (built-in, HDMI, USB-C adapters, AirPlay), and the output going full screen on the chosen one (macOS makes a new Space for it). Check that moving to another display works while the output is open.
- The frame rate and latency at 1080p and 4K on the projector, including with texture uploads from the player's canvases in WKWebView.
- What happens when the main window is minimised or hidden (its frames pause; the output's clock runs on).
- Edge blending across two projectors, with the gamma set to match the projectors.
- Dragging handles on the projector itself, with a mouse on that screen.
