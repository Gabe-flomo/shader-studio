# The Play split view

*Written 28 Sep 2026.*

The split view puts a big panel beside the Play picture (⌘⇧L, or the split
button in the preview's toolbar). It is how the Play page opens: split, with
the sidebar folded into the icon rail (`DEFAULT_SPLIT`; saves from before this
was the default take it once, keeping their side, ratio and page). The panel sits left, right, above or below
the picture; the divider between them drags (double-click: half and half).
State lives in `src/components/play/playSplit.ts`; the frame (bar, divider,
rail) in `PlaySplitArea.tsx`; PlayPage renders the panel's content through a
portal into the frame's body.

## The sidebar beside the panel

The panel's bar has three buttons for the sidebar (`SplitPrefs.sidebar`):

| State | What shows |
| --- | --- |
| **Sidebar** (`full`) | The sidebar as usual; it leaves out whatever the panel shows (`sidebarView`). The panel has a tab strip: Controls, Layers, Finish, Engine, Mappings. |
| **Rail** (`rail`) | The sidebar folds into a rail of icons on the panel's left edge; the panel shows one page full width. |
| **None** (`hidden`) | The picture and the panel only (the tab strip picks the section). |

⌘⇧B toggles the rail, and goes back to whatever the sidebar was before
(`sidebarBefore`). With the split closed it opens it with the rail out.

## Rail and full-width pages

The rail (`PlayRail.tsx`) has an icon per category, with a tooltip, the open
category highlighted (and a bar on the rail's edge), and a count on Layers and
Mappings. Clicking an icon opens that category straight away, on the page it
was last on (else its first) — no drawer in between (`railPageMemory`,
`openRailCategory` in `playSplit.ts`). A category with more than one page also
gets a tab strip in the panel's header, right beside its name (`RailPageTabs`
in `PlayRail.tsx`), so switching pages doesn't mean going back to the rail;
clicking a tab switches, ←/→ move through the strip when it's focused
(wrapping; Home/End jump to the ends). A category with only one page (Controls,
Engine) shows no strip, just its description. ↑/↓ move through the rail's own
icons.

**Mappings is always reachable**: it shares the Controls icon (its rail
category since 2026-09-28: the owner's call — the two were so closely
related), so its tab is always one click from the rail, whatever page or
category is open; ⌘⇧M jumps straight to it — on the Mappings tab specifically,
not just the category — opening the split first if it's closed (`goToMappings`
in `playSplit.ts`). Phones get the same: Controls' sheet always has a Mappings
tab.

**⌘1–5 jump to a rail category** (`railControls`/`railLayers`/`railFinish`/
`railEngine`/`railSignals` in `useShortcuts.ts`, wired in `App.tsx`; `goToRailCategory` in
`playSplit.ts`), same as clicking its icon: the category opens on the page it
was last on, else its first (so ⌘1 opens Controls & Mappings on whichever of
the two it was left on). A plain browser tab claims ⌘1–4 for switching its own
tabs before the page ever sees the keydown, so ⌃1–5 do the same five things
there, fixed (not in the remappable shortcuts panel). Each rail icon's tooltip
shows its ⌘ combo.

The categories and pages are data (`railPages.ts`):

| Category | Pages |
| --- | --- |
| Mappings (⌘1 / ⌃1) | Controls · Mappings · MIDI file · Pad grid |
| Layers (⌘2 / ⌃2) | Layers · Background |
| Signals (⌘5 / ⌃5) | Signals |
| Finish (⌘3 / ⌃3) | Picture · Sound |
| Engine (⌘4 / ⌃4) | Arrangement |

The first three are Play's three nouns (the simplification plan, 2026-09-30):
Layers act on the picture, Mappings bring values in, Signals report what is
happening and set things off. Signals sits third on the rail but keeps ⌘5,
so the older shortcuts didn't move. The old Actions page folded into Signals;
a saved `actions` page opens Signals.

Controls' rail badge is the controls count (not mappings', so the two counts
never get added into one confusing number); the mappings count sits in the
icon's tooltip instead, alongside the ⌘1 combo.

When the Engine's Arrangement view lands, it becomes a second Engine page
(add it to `RAIL_PAGES` and the category's `pages`, and a case in PlayPage's
`renderPage`).

**Width.** Folding the sidebar into the rail gives the panel the sidebar's
width, and the picture keeps its size: opening the rail measures the area and
the sidebar and works out the rail's own divider position (`railRatioFor`).
Dragging the divider in rail mode moves only that (`railRatio`), so leaving the
rail puts the sidebar, the panel's section and the divider back exactly as
they were. Above or below the picture, the rail still sits on the panel's
left edge and the share stays as it was.

**Following you.** While the rail is out, a layer clicked on the picture (or
revealed from a note, a control's "Go to layer") opens the Layers page; a
Finish or sound effect revealed opens Picture or Sound; a control group
revealed opens Controls (`followReveals` in `PlaySplitArea.tsx`).

**The pages.** Every page has the same 44 px header (title, count, tools on the
right) and at most two columns, stacking below 640 px (`WIDE_PANEL_PX`):

- **Controls:** the Controls board (below).
- **Layers:** the list beside the selected layer's editor, big editors in
  full with the jump strip (`BigEditorScaffold`, docs/editor-layout.md).
  Signals has its own category.
- **Signals:** one flow (`signalFlow.ts`). Each named signal is a card (rename,
  fire, delete) with its **When** (the actions that send it, and layers that
  do: Born, Died…) and its **Then** (the actions that fire on it, and the
  mappings and swaps that listen), each with a + to add one. Reactions with no
  signal between (a key bursts particles) are listed below. The selected
  reaction's editor sits beside the list; a selected signal shows what it is
  sent by and heard by. **Create a signal from it** in a slider's + menu (and
  in a control's right-click menu) makes a signal that fires when the value
  crosses the middle of its range (`play/createSignal.ts`) and opens it here.
- **Background:** the background row, and a link to the Background layer's
  editor when there is one.
- **Finish → Picture / Sound:** the stack or the sound's chains, without the
  Picture/Sound switch (each is a page).
- **Engine → Performance:** the racks as cards in a grid.
- **Mappings:** a workspace: a table of source → control grouped by the kind
  of source (MIDI and OSC; keys, mouse and gamepad; audio; LFOs, clocks and
  noise; triggers; picture, hands and sensors; controls and data:
  `mappingGroups.ts`), each row with its switch, a live meter and solo; a
  search and group chips above; the selected row's editor beside it (↑/↓ move
  the selection). Pair mappings follow the table.
- **MIDI file**, **Pad grid:** their card, at a readable width.

**Phones** have no split view; the same categories are a row along the bottom
of the panel (`PlayRailBar`), and a category with several pages opens them in
a sheet. A page that isn't a whole section (Signals, Background, MIDI
file, Pad grid) shows in place of its tab (`usePlayUi.phonePage`).

## The Controls board

In the panel (the rail's Controls page, and the tab strip's Controls section)
the controls are a board (`ControlsBoard.tsx`) instead of one grid:

- **Groups** by where each control comes from (`controlGroups.ts`): a group
  the author named (audio readers' groups too), else its rack ("Rack 1 ·
  Sample player"), its layer, the Finish stack, the sound effects, or the
  graph ("From the graph"). Groups keep the panel's order and fold (remembered).
  A pair shows once, as its card.
- **Layer cards:** a layer's controls sit in a small card of their own, and
  its **+ Parameter** adds another of the layer's numbers to it (the ones not on
  the panel yet).
- **Live graphs:** each card has a small trace of its value over the last six
  seconds under its slider: a line for sliders, a filled level for audio
  readers, a step for buttons, a colour strip for colours, and a dot trail
  (with both values as lines) for pairs. Every trace in a group is drawn on
  one canvas laid over the group. One `requestAnimationFrame` loop
  (`controlTrace.ts`) samples every control 30 times a second into a ring
  buffer (`TraceBuffer`) and draws, and it only runs while a group or the
  isolated strip is on screen and unfolded. No React state changes per tick.
- **Isolate:** click a control's name to pin its graph, larger, in a strip at
  the top with its value now, the lowest and highest seen, and what drives it.
  Several can be pinned; Show all clears them. Double-click the name to rename.
- **Filters:** search, group, mapped or not, kind (sliders, colours, buttons).
- **Flat grid** (the grid button) brings back the single grid of cards,
  remembered on this device. The sidebar keeps its single list.

The cards are the same as everywhere: sliders, colours and buttons stay
usable inline; the graph is added under them.

## Tests

`src/components/play/__tests__/rail.test.ts` (the page model, the rail's state
and restore, opening a category straight to its remembered page, ⌘⇧B and ⌘⇧M),
`controlBoard.test.ts` (the trace buffer, the sampler loop, the board's and the
workspace's groups) and `railPagesMount.test.tsx` (every page mounted in
jsdom, wide and narrow, the phone's pages, the rail's click-through and the
panel header's tab strip, all without a console error).
