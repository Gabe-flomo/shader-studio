# The Play split view

*Written 28 Sep 2026.*

The Play page has one navigation model (Play audit P1, 18 Oct 2026): a
labelled rail of categories on the left, the panel beside it showing one page
of the open category, and the picture on the right. It is how the Play page
opens (`DEFAULT_SPLIT`). There is no other set of sections: the old "Sidebar
beside the panel" mode, its tab strip (Controls, Layers, Finish, Sound,
Sources) and the S/M/L panel widths are gone, along with the `PlayTab` union
that sat beside the rail's own pages.

## The picture is always on the right

*Updated 18 Oct 2026 (Play audit P3/P21, user decision).* The panel, with the
rail, is on the left; the picture is on the right, on desktop and tablet alike.
It isn't a setting: the Layout menu's four "Panel left/right/above/below" rows
are gone and `SplitPrefs` has no `side`. Phones keep their stacked
picture-over-panel layout (`shell/PhoneSplit.tsx`).

- **Share.** The panel takes about a third of the width by default
  (`DEFAULT_RATIO` = 0.35) so the picture gets most of it. The divider still
  drags (`ratioAt`), between `RATIO_MIN` 0.2 and `RATIO_MAX` 0.7 and never
  below `MIN_PANEL_PX` (300) for the panel or `MIN_CANVAS_PX` (320) for the
  picture; a double-click goes back to the default.
- **Migration.** `SPLIT_PREFS_VERSION` is 4. A v2 save (or older) drops its
  `side` and takes the default ratio once, since it was measured with the
  panel right of the picture at half and half. A v3 save had a sidebar mode
  (`sidebar`: full, rail or hidden) and a tab-strip panel (`tab`): it opens on
  the rail, on the page the panel was showing (the rail's own page if the rail
  was out, else the tab's: Finish → Picture, Sound → Arrangement, Sources →
  Controls), with the rail's own ratio when it had one. A saved `background`
  page opens Layers (its pinned Background row).
- **Header and footer.** The preview's header (shape, resolution, frame rate,
  Overlay, Stage, Output…) and its footer sit in the picture's column, inside
  `PlaySplitArea`, so the panel runs the full height on the left. The header's
  "PREVIEW" label gives way first when the column is narrow.
- **Free never crops on Play.** Most shaders scale by the canvas height, so a
  frame narrower than square cut the sides off ("PRESS" read "RESS"). On the
  Play page (`usePlaySplit.available`), Free fills the area while it's at least
  square and letterboxes to square when it's narrower (`playFreeFit`,
  `PLAY_FREE_MIN_RATIO` in `utils/graphImportPlan.ts`). The other shapes
  letterbox as before; the Studio's preview is unchanged.
- **Tablet.** The same side-by-side layout (the panel at its 300 px minimum
  beside the picture on an 820 px iPad). Tablets have no preview header, so
  Stage sits in the top bar (`DesktopTopNav`, `compact` on Play). The middle
  tab level (Controls / MIDI file / Pad grid) stays until those pages move
  into the "+ Map" picker (audit P10).

State lives in `src/components/play/playSplit.ts`; the frame (bar, divider,
rail) in `PlaySplitArea.tsx`; PlayPage renders the panel's content through a
portal into the frame's body.

## Three views

`SplitPrefs` is `on`, `ratio`, `railPage`, `railPageMemory` and `railHidden`:

| View | What shows |
| --- | --- |
| **Rail and panel** (`on`) | The default: the rail down the panel's left edge, the page beside it, the picture on the right. |
| **Rail alone** (`!on`) | The panel's ×, ⌘⇧L or the preview's split button close the panel; the rail stays on the left of the picture, and clicking a category opens the panel on it. |
| **Picture alone** (`railHidden`) | ⌘⇧B hides the rail too, for the most room. ⌘⇧B again, the split button or ⌘1–5 bring it back. |

## Rail and pages

The rail (`PlayRail.tsx`) has an icon per category, with a tooltip, the open
category highlighted (and a bar on the rail's edge), and a count on Layers and
Mappings. Clicking an icon opens that category straight away, on the page it
was last on (else its first) — no drawer in between (`railPageMemory`,
`openRailCategory` in `playSplit.ts`). A category with more than one page also
gets a tab strip in the panel's header, right beside its name (`RailPageTabs`
in `PlayRail.tsx`), so switching pages doesn't mean going back to the rail;
clicking a tab switches, ←/→ move through the strip when it's focused
(wrapping; Home/End jump to the ends). A category with only one page (Layers,
Rules, Finish) shows no strip, just its description. ↑/↓ move through the
rail's own icons. With the panel closed, no category is lit.

**Mappings is always reachable**: it shares the Controls icon (its rail
category since 2026-09-28: the owner's call — the two were so closely
related), so its tab is always one click from the rail, whatever page or
category is open; ⌘⇧M jumps straight to it — the Controls page with its
Sources side showing (`useInputsBoard`), not just the category — opening the
panel first if it's closed (`goToMappings` in `playSplit.ts`). Phones get the
same: the Controls page has a Controls / Sources switch at its top, driven by
the same store.

**⌘1–5 jump to a rail category** in the rail's own order, top to bottom
(`railControls`/`railLayers`/`railSignals`/`railFinish`/`railEngine` in
`useShortcuts.ts`, wired in `App.tsx`; `goToRailCategory` in `playSplit.ts`),
same as clicking its icon: the category opens on the page it was last on, else
its first (so ⌘1 opens Controls on whichever of its tabs it was left on). A
plain browser tab claims ⌘1–5 for switching its own tabs before the page ever
sees the keydown, so ⌃1–5 do the same five things there, fixed (not in the
remappable shortcuts panel). Each rail icon's tooltip shows its ⌘ combo, and
each icon has its name under it (like the phone's bottom row).

The categories and pages are data (`railPages.ts`):

| Category | Pages |
| --- | --- |
| Controls (⌘1 / ⌃1) | Controls · MIDI file · Pad grid |
| Layers (⌘2 / ⌃2) | Layers (the Background is its pinned first row) |
| Rules (⌘3 / ⌃3) | Rules |
| Finish (⌘4 / ⌃4) | Picture |
| Sound (⌘5 / ⌃5) | Arrangement · Effects |

The order and the shortcuts match (the Play audit, 2026-10-18, P18: the rail
used to read Controls, Rules, Layers… while ⌘5 was Rules). The old Actions
page folded into Rules; a saved `actions` page opens Rules.

The panel's header is one row at every width: what doesn't fit scrolls or
ellipsizes, and its ⋯ (the Play setup: Open Play setup, Import .play, Export
.play, Put it on a website, Clear Play setup; `playSetupMenu.tsx`) and ×
stay on it. A phone's Controls ⋯ carries the same setup actions.

Controls' rail badge is the controls count (not mappings', so the two counts
never get added into one confusing number); the mappings count sits in the
icon's tooltip instead, alongside the ⌘1 combo.

When the Engine's Arrangement view lands, it becomes a second Engine page
(add it to `RAIL_PAGES` and the category's `pages`, and a case in PlayPage's
`renderPage`).

**Following you.** A layer clicked on the picture (or revealed from a note, a
control's "Go to layer") opens the Layers page; a Finish or sound effect
revealed opens Picture or Sound → Effects; a control group revealed opens
Controls (`followReveals` in `playSplit.ts`, started once). The panel opens if
it was closed, and a phone's page follows the same way. Anything else that
wants a page calls `showPage` (a toast's "Show", a rack's "Sound effects…").

**The pages.** Every page has the same 44 px header (title, count, tools on the
right) and at most two columns, stacking below 640 px (`WIDE_PANEL_PX`):

- **Controls:** the Controls board (below).
- **Layers:** the list beside the selected layer's editor, big editors in
  full with the jump strip (`BigEditorScaffold`, docs/editor-layout.md).
  Signals has its own category. **The Background is the list's pinned first
  row** (Play audit P13, `layers/BackgroundPinnedRow.tsx`): the Background
  layer's own card when the setup has one, else a row saying what the picture
  is under the layers (the shader, a colour, an image…). Picking it opens the
  Background's settings (`BackgroundSettings` in `FullPages.tsx`: Shader /
  Graph… / Image… / Video… / Colour, and its matte) beside the list, like a
  layer's editor; in a stacked list they open under the row (folded at first,
  remembered). It doesn't drag, pick or group. There is no Background page,
  no Background bar above the list, and Add layer no longer offers Background
  (its Graph…, Image… or Video… makes the one Background layer). Old setups
  with a Background layer load as before: it becomes the pinned row. Free
  keeps the row above the locked Layers page.
- **Signals:** one flow (`signalFlow.ts`). Each named signal is a card (rename,
  fire, delete) with its **When** (the actions that send it, and layers that
  do: Born, Died…) and its **Then** (the actions that fire on it, and the
  mappings and swaps that listen), each with a + to add one. Reactions with no
  signal between (a key bursts particles) are listed below. The selected
  reaction's editor sits beside the list; a selected signal shows what it is
  sent by and heard by. **Create a signal from it** in a slider's + menu (and
  in a control's right-click menu) makes a signal that fires when the value
  crosses the middle of its range (`play/createSignal.ts`) and opens it here.
- **Finish → Picture / Sound:** the stack or the sound's chains, without the
  Picture/Sound switch (each is a page).
- **Sound → Arrangement:** the racks as cards in a grid.
- **Mappings:** a workspace: a table of source → control grouped by the kind
  of source (MIDI and OSC; keys, mouse and gamepad; audio; LFOs, clocks and
  noise; triggers; picture, hands and sensors; controls and data:
  `mappingGroups.ts`), each row with its switch, a live meter and solo; a
  search and group chips above; the selected row's editor beside it (↑/↓ move
  the selection). Pair mappings follow the table.
- **MIDI file**, **Pad grid:** their card, at a readable width.

**Phones** have no split view; the picture sits over the panel, and the same
categories are a row along the bottom of the panel (`PlayRailBar`). The page
shown is the same state as the panel's (`usePlaySplit.railPage`), so ⌘⇧M,
reveals and a toast's "Show" move a phone's page too; a page a phone has no
room for (the MIDI file, the pad grid) shows its Controls page instead
(`phonePageFor`). A window
narrower than 600px gets this layout too, mouse or not (`playStacked` in
`lib/viewport.ts`; the rest of the app still goes by `phone`), since the
side-by-side layout has no room there. Since Play audit P20 (2026-10-18):

- **Controls and Layers go straight to their page** (`phonePagesOf` in
  `railPages.ts`); only Sound, with two pages, opens a sheet of them.
- **Controls** has a **Controls / Sources** switch at its top (the tablet's
  narrow board does the same). Sources lists the mappings and sources with the
  MIDI file and the pad grid at the bottom (no pages of their own on a phone).
  The header under it holds only **+ Control** and **⋯**, both 44px; Suggest
  controls, Stage, notes and the Play setup are in the ⋯.
- A control's **driven-by chip** opens what drives it in Sources: the switch
  flips to Sources, the card and its group unfold, and it's scrolled to and
  flashed (`driverCardFor` in `mappingGroups.ts`). Since round 3 (P7) desktop
  does the same with the same code: the narrow board's tab flips to Sources
  (`useInputsBoard`), or the wide board's column scrolls to it.
- Control cards fold their move/details/remove tools into one ⋯ and let a
  long name wrap onto a second line, instead of cutting it short.
- **Layers** carries the canvas row (shape, quality, frame rate, full screen,
  guides; it wraps instead of running off the edge) at its top, and the
  **Background** as the list's pinned first row, the same model as desktop
  (P13). Tablets, whose preview has no header, get the same canvas row there.

## The Controls board

In the panel (the rail's Controls page) the controls are a board (`ControlsBoard.tsx`) instead of one grid:

- **Groups** by where each control comes from (`controlGroups.ts`): a group
  the author named (audio readers' groups too), else its rack ("Rack 1 ·
  Sample player"), its layer, the Finish stack, the sound effects, or the
  graph ("From the graph"). Groups keep the panel's order and fold (remembered).
  A pair shows once, as its card.
- **Layer cards:** a layer's controls sit in a small card of their own, and
  its **+ Parameter** adds another of the layer's numbers to it (the ones not on
  the panel yet).
- **Live graphs:** each card that something drives (an enabled mapping or a
  route) has a small trace of its value over the last six seconds under its
  slider; a control only moved by hand has none (its line would be flat): a line for sliders, a filled level for audio
  readers, a step for buttons, a colour strip for colours, and a dot trail
  (with both values as lines) for pairs. Every trace in a group is drawn on
  one canvas laid over the group. One `requestAnimationFrame` loop
  (`controlTrace.ts`) samples every control 30 times a second into a ring
  buffer (`TraceBuffer`) and draws, and it only runs while a group or the
  isolated strip is on screen and unfolded. No React state changes per tick.
- **Isolate:** click a control's name to pin its graph, larger, in a strip at
  the top with its value now, the lowest and highest seen, and what drives it.
  Several can be pinned; Show all clears them. Double-click the name to rename.
- **Filters:** one row: a search, one **Show** dropdown (all controls, mapped,
  unmapped, then each kind and each group the setup has more than one of;
  `controlGroups.ts` `showOptions`/`filterOfShow`) and the view toggle. Below
  eight controls (`FILTERS_FROM`) the search and the dropdown stay hidden and
  the view toggle sits on the first group's heading, so the first card is
  right under the header.
- **Notes:** a setup's notes fold into the ⓘ beside the Controls title
  (folded at first, remembered on this device: playUi's `folded`,
  `NOTES_FOLD_KEY`); the card's own chevron folds them again.
- **Flat grid** (the grid button) brings back the single grid of cards,
  remembered on this device. A phone keeps its single list.
- **A control's details** (its chevron): where it comes from, its range as
  text (no min/max editor: typing a value past either end on the slider
  widens it, the slider rule), and **Driven by** with its label over the text
  and **+ Map** / **+ Null** under it.

## A new graph starts fresh

Opening another graph (an example, a saved graph, an imported file:
`graphEpoch` changes, not a Code-page conversion preview) puts each rail
category back on its primary page (Controls, Layers, Picture, Arrangement),
forgets the remembered sub-pages, and clears the Finish view and the old
graph's layer selection (`resetOnGraphLoad.ts`,
mounted once in App). An example not saved yet goes by its title in the top
bar, and the save form offers that title as its name (`exampleTitleOf`).

The cards are the same as everywhere: sliders, colours and buttons stay
usable inline; the graph is added under them.

## Tests

`src/components/play/__tests__/rail.test.ts` (the one page model, no `PlayTab`,
the rail's state, opening a category straight to its remembered page, ⌘⇧B and
⌘⇧M, reveals followed on desktop and phone),
`controlBoard.test.ts` (the trace buffer, the sampler loop, the board's and the
workspace's groups), `controlsDensity.test.tsx` (the header's notes ⓘ, the
filter row, folded mappings, the built-in group, the reset on a new graph, the
control card's details) and `railPagesMount.test.tsx` (every page mounted in
jsdom, wide and narrow, the phone's pages, its Controls / Sources switch,
header, chip and Layers top, the rail's click-through, the panel header's
tab strip, PlayPage rendering nothing but the page, and the Background pinned
on top of the Layers list, all without a console error), `driverCard.test.ts` (what a phone's
chip opens) and `lib/__tests__/viewport.test.ts` (`playStacked`),
`pictureRight.test.tsx` (the picture on the right with the panel open, the
rail alone, or the picture alone; the header and footer in its column, the
default share, tablet Stage, and Free's letterbox on Play),
`playSplit.test.ts` (prefs, the v3 and v4 migrations: the full sidebar onto
the rail; ratios; the three views) and `play/__tests__/addLayerMenu.test.ts`
(Add layer doesn't offer Background).
