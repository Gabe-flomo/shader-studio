# Toolbars that fit

A toolbar never loses a button. When there isn't room for everything, the least-used items move into
a **⋯** menu at the bar's end, and they come back as the bar widens. As a last resort (the items that
must stay are wider than the bar on their own) the bar scrolls sideways with faded edges. Nothing is
ever cut off or out of reach, at any width down to 280 px.

## The shared pattern: `FitToolbar`

`src/components/ui/FitToolbar.tsx` (the folding maths is `ui/fitLayout.ts`, pure and tested).

- Each item has a **priority** (higher stays longer, default 50). The bar measures itself and its items
  with a ResizeObserver; when they don't fit, room is made for the ⋯ and items are kept in priority
  order (a tie keeps the earlier one) until one doesn't fit — it and everything below it fold. The
  order on the bar never changes; folding only removes.
- `pinned`: never folds (Save, the shader name's neighbour; full screen is just high priority).
- `menu: 'always'`: only ever in the ⋯ (rarely used actions: the Code page's file actions).
- `menu: 'never'`: dropped, not moved, when out of room (the PREVIEW label, a "Read as Shadertoy" badge).
- `divider`, `grow`: a thin line between groups (shown only between two items still on the bar) and a
  spacer that takes the free room.
- `group`: a heading in the ⋯ (Edit, Tools, View, File on the Code page).
- An item is either a **plain action** (`label`, `icon`, `onSelect`: an icon button on the bar, a row
  that runs it in the ⋯) or **any control** (`node`: drawn as it is on the bar; in the ⋯ it sits beside
  its label, so a picker with its own popover — resolution, frame rate, overlay — works the same in both
  places). An item can have both: a labelled button on the bar (`node`) and a plain row in the ⋯ (`onSelect`).
- `fitTo`: a bar inside a box that is only as wide as its content (the canvas's floating toolbar)
  measures the box's container instead of itself.
- `keepFocus`: clicks on ⋯ and its rows don't take focus (the Code editor keeps its selection for Explain).

Components that open a dialog from a toolbar keep the dialog's state outside the button (the Output
dialog: `useOutputDialog` + `OutputDialogHost`), so the button can live in a ⋯ that closes.

## Where it's used

| Toolbar | Stays longest → folds first | Always in the ⋯ |
|---|---|---|
| **Preview header** (Studio, Play; `PreviewHeader items`) | Full screen, Canvas shape, Stage, Finish, Panel, Resolution, Frame rate, Output, Guides, Overlay, Float, Brightness histogram; the PREVIEW label is dropped first | |
| **Page canvas header** (Code → Shader/Convert Full canvas; `PageCanvas`) | the page's own switch, Full screen, Canvas shape, Record, Resolution, Frame rate, Overlay | |
| **Code → Shader toolbar** (`GLSLPage`) | Save (pinned), Explain, Tidy, Convert to nodes, Saved shaders and functions, Full canvas, Discover functions, Code Explorer, Copy the shader | Convert step by step · Open the graph’s generated code · Download saved shaders… · New blank shader · Clear the editor |
| **Canvas toolbar** (`CanvasToolbar`) | Fit, Zoom, Auto layout, Outline, Maximize, Randomise, Clear, the stats | |
| **Code → Functions bar** (`FunctionBuilder/Toolbar`) | the function (pinned), Save to Expression Block (pinned), Save group, Sessions, the view range | |

The canvas shape in the preview headers is one dropdown showing the current shape (a little frame in
its proportion and its name) instead of eight frames in a row; the row of frames stays where there is
room for it (Play's tablet Canvas row, the Stage).

### The Code page's Shader toolbar, renamed

| Was | Now | Where |
|---|---|---|
| Tidy (text only) | **Tidy** (icon + "Rewrite the text as Playfield GLSL…" tooltip) | bar |
| (i) icon | **Explain** (labelled) | bar |
| Convert | **Convert to nodes** (tooltip and ⋯ row; the bar keeps "Convert") | bar |
| Step by step | **Convert step by step** | ⋯ Tools |
| copy icon | **Copy the shader** | bar, folds |
| search icon | **Discover functions** | bar, folds |
| code icon | **Code Explorer** | bar, folds |
| popout icon "Show saved shaders and functions" | **Saved shaders and functions** (sidebar icon) | bar, folds |
| layout icon | **Full canvas** | bar, folds |
| graphs icon "Load the node graph's compiled shader…" | **Open the graph’s generated code** (glossary: *Generated code*) | ⋯ File |
| export icon "Download every saved shader…" | **Download saved shaders…** | ⋯ File |
| reset icon "Reset to the blank template" | **New blank shader** | ⋯ File |
| trash icon "Clear the editor" | **Clear the editor** | ⋯ File |

## Other bars made to fit (no ⋯)

- **Modal headers** (`ui/Modal`: builders' windows, the Audio Source window, Record…): the title and
  subtitle keep one line each (ellipsis, the full subtitle as a tooltip) — wrapped, they ran past the
  60 px header and cut off a builder's "Scene builder ›" link — and the actions scroll sideways when
  they don't fit. The dialog is named by its title for assistive tech.
- **Scene builder windows** (`builders/studio/StudioShell`): the actions scroll sideways on desktop as
  on a phone, and the main action (Done) and × always stay in view; the title keeps 140 px.
- **The top bar** (`DesktopTopNav`): past its last fold stage (a browser window narrower than the desktop
  app's 900 px minimum) the bar scrolls sideways and the page strip keeps room for the current page.

## Checking

- `src/components/ui/__tests__/fitToolbar.test.tsx` renders the preview header, the Code page's
  toolbar, the canvas toolbar and the Functions bar in jsdom with mocked widths (1400 → 120 px) and
  asserts every action is on the bar or in the ⋯, nothing is in both, and what's on the bar fits.
- In the dev build, `__shaderStudioDev.overflow()` has the browser checks (`src/dev/overflowCheck.ts`):
  - `findUnreachable(root?)` lists controls less than half visible after every clipping ancestor and
    the window (a sideways scroller counts as reachable);
  - `sweepPages()` visits every top-bar page and Code tab at the current window width;
  - `sweepReach(selector, widths)` squeezes each match (a header, a dialog, `[data-node-id]` cards) and
    checks it on its own.

  ```js
  const o = await __shaderStudioDev.overflow()
  await o.sweepPages()                                   // at the window's width
  await o.sweepReach('[data-preview-header]', [280, 360, 480])
  await o.sweepReach('[data-node-id]', [null])           // every card as it is
  ```

  The in-app browser pauses rendering while its pane is hidden, so ResizeObservers don't fire there;
  run the sweeps with the pane showing (or take a screenshot between steps).

## Sweep, 2026-10-19 (1440, 1024, 820, 600, 390; panels narrowed)

Before: the preview header ran off the side at every width with the default preview column (Overlay,
Finish, Full screen, histogram and Float unreachable even at 1440); Play's at 820 and below; the
Code page's Shader toolbar from 820 down (Explain and the file actions); the Functions bar scrolled with
no sign of it; Scene builder windows cut off Done (Grid, Splat, Warp at 820) and the "Scene builder ›"
link (2D); the top bar lost Record and ⋯ in a browser window under ~500 px. After: none at any width
checked. Phones (375–390 with touch) and the Play rail pages were already clean; node cards, the Record
dialog, App settings and the Audio Source window had nothing out of reach.
