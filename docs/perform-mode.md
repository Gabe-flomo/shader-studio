# Perform mode (Play audit P19) and the Output fixes (P23)

Round 5 of the Play page audit (2026-10-18). The user rule holds here too: **the picture is
always on the right**; the controls are on its left. Phones stack the picture on top.

## What Perform is

Perform is **the Stage's default view** (Stage → Full). The Stage stays the place where one Play is
shown on its own, the way people will play it, with nothing to edit; Perform is how its controls
look there: big, touchable, in a grid, like a Push or a Resolume deck rather than an editor.

```
┌ Stage bar: × Name  [Full|Exact]            [Screen|Phone] [shape] [▥] [⛶] [Output] [● Record] ┐
├──────────── controls (≈40%) ────────────┬──────────────── picture (≈60%) ─────────────────────┤
│ [⚄ Randomize ▾] [↺ Reset] [■ Panic]     │                                                      │
│ [● Take] [Takes 3 ▾]  [S M L] [ⓘ]       │          the picture, letterboxed to its shape       │
│ ┌────┐ ┌────┐ ┌──┐ ┌──┐ ┌──────────┐    │                                                      │
│ │fadr│ │fadr│ │◠ │ │◠ │ │  XY pad  │    │                                                      │
│ │    │ │    │ └──┘ └──┘ │          │    │                                                      │
│ └────┘ └────┘ ┌──┐ ┌──┐ └──────────┘    │                                                      │
│               │●▭│ │▦ │  pad  pad        │                                                      │
└─────────────────────────────────────────┴──────────────────────────────────────────────────────┘
```

- **Exact** (the website player itself) is unchanged in what it runs, but the exported page now
  has the same layout: its panel on the left, the picture on the right; stacked under 720 px.
- **The side-panel toggle** (▥) hides the controls for the picture alone.
- **A Present snapshot** on the Stage runs in Exact, as before; its notes sit in the left column.

## Control kinds → widgets

| Control | Widget | Why |
|---|---|---|
| Number with a 0–1 style range (min ≥ 0, max ≤ 1) | **Fader** (vertical, two cells tall) | Levels, mixes and amounts read best as a throw |
| Any other number (a wider or signed range, or whole steps) | **Knob** | Ranged numbers: angles, rates, counts |
| A switch (`toggle`) | **Toggle** (a big latch) | |
| A position pair (both halves shown) | **XY pad** (2 × 2 cells) | |
| Colour | **Swatch** (tap for the colour pad) | |
| Action (Burst, Scatter, Next line…) | **Pad** (fires on press) | Triggers |

A control a mapping drives shows its live value, a LIVE mark, and can't be dragged (as on the Stage
before). Faders and knobs: drag (vertical for both), double-click to go back to the value Perform
opened with; arrow keys step when focused. All targets are at least 44 px. No edit icons.

**Sizes S / M / L** set the grid cell: 88 / 112 / 148 px. Remembered on this computer.

## The bar

- **Randomize** — moves every control (not actions) by a random amount within its range, scaled by
  **Strength** (5–100 %, default 35 %; the ▾ beside the button). Switches flip with probability
  Strength/2; colours move toward a random colour. **One undo step** for the lot (⌘Z brings
  everything back). Controls a mapping drives are randomized too (their base value moves; the
  mapping keeps running alongside).
- **Reset** — every control back to the value it had when Perform opened (its *home*). One undo
  step. (Controls carry no default of their own; the opening values are the author's look.)
- **Panic** — stops all sound and lets go of momentary things: the tape stops, every Sound rack
  gets all-notes-off, Sampler pads stop, held keys, pads and clicks are released, Look actions let
  go. Controls keep their values.
- **Take** — *Record performance (take)* (lib/takes.ts), and a **Takes** list to watch one back
  or export it as a video: the same list as Sound → Arrangement → Takes.
- **S / M / L** and **ⓘ** (which keys, MIDI and so on do what: the old Sources legend).
- **Exit** is the Stage bar's ×, or Esc.

### Keys (Perform)

| Key | Does |
|---|---|
| Esc | Leave the Stage (the browser's Esc leaves fullscreen first) |
| ⇧R | Randomize |
| ⇧H | Reset (home) |
| ⇧P | Panic |

⌘R is the app's Record, so it isn't used. A Play's own key mappings win: if a setup maps R, H or P,
the Shift shortcut stays with the mapping. ⌘Z / ⇧⌘Z are the app's undo and redo.

## Screens

- **Desktop / laptop**: controls about 40 % on the left (min 300 px, max 620 px), picture right.
- **Tablet** (portrait 820 wide too): side by side, picture still on the right.
- **Phone** (≤ 640 px): picture on top (40 % of the height), controls below in a scrolling grid;
  the shape follows the phone rule (1:1 or Free only, `useShownAspect`).
- **Free never crops on the Stage**: it letterboxes to square when the picture area is narrower
  than square, as the Play page does.

## Output (P23)

- The surface preview keeps the picture's shape: the picture is fitted (letterboxed) into each
  surface instead of stretched, so a round glow stays round.
- One "start again" only: Presets' **Start over (one surface)** is gone (the Play panel ⋯ has *Clear
  Play setup…*; a mapping is reset by loading a preset or undoing).
- Section labels are all one style (small caps labels in sentence-case source text).

## Later (the full Play randomizer, not built here)

From the user's spec (2026-10-13): **Snap / Smooth** release (ease over a time), **Stay / Return**
(go back after a while), and **Run alongside / Override until done** for automated controls.
Perform's Randomize is the *Snap · Stay · Run alongside* case of that; the rest is a follow-up,
with the Randomize also on the Play page's Controls.

Also later: the exported page's panel could use the same big widgets.

Files: `src/play/perform.ts` (widget choice, randomize, home, panic, the grid sizes),
`src/components/play/Perform.tsx` (the grid and the bar), `src/components/play/Stage.tsx`.
