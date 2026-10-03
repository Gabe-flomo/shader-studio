# Piano roll

*3 Oct 2026.* A MIDI clip's notes in an Ableton-style editor (phases 3–5 of
`docs/piano-roll-plan.md`). Code: `src/components/play/engine/PianoRoll.tsx`
(the editor), `src/play/pianoRoll.ts` (the grid and every note operation, pure
and tested in `src/play/__tests__/pianoRoll.test.ts`).

## Opening it

**Double-click a MIDI clip** on a lane (or a clip's right-click menu → Edit
notes). The editor opens in the device area under the arrangement; the
**Device / Notes** switch above that area goes back and forth. Choosing Notes
with no clip open opens the selected clip, or the track's first.
Double-clicking empty lane still adds a note there.

## Layout

- **Toolbar:** Draw mode (B), Split (E), the grid, triplets, the rows
  (All / Fold / Scale), scale highlight (K), zoom, and the Functions and
  Velocity sections. Both sections start folded; each remembers whether you
  opened it.
- **Keys** on the left. Live's names: middle C (60) is C3. Click a key to hear
  it (through the rack, as `audioEngineHost.input` notes) and select that
  row's notes in the clip (⇧ adds). Drag along the keys to play them.
- **Ruler:** bars and beats at the tape's BPM. Drag down to zoom in, up to zoom
  out, sideways to scroll. The **clip's brace** runs along its top; drag its
  ends to trim the clip.
- **Grid:** rows for each pitch (black keys darker). With a scale on the
  transport, its rows are tinted and its root row is stronger. Outside the
  clip is shaded, and other clips' notes show faintly.
- **Velocity lane** (folded by default): a stem per note.

## Editing

| Do | How |
| --- | --- |
| Select | Click a note. ⇧-click adds or removes it. Drag on empty grid for a box. ⌘A selects the clip's notes. Esc deselects. |
| Move | Drag (time snaps to the grid, pitch by row). ⌘ while dragging ignores the grid. |
| Copy | ⌥-drag. |
| Resize | Drag a note's left or right edge. |
| Add | Double-click empty grid. Or B for Draw mode: click or drag to add notes a grid step long, click a note to delete it. |
| Delete | Delete / Backspace, or double-click a note. |
| Split | E, then click a note to split it there. |
| Deactivate | 0 turns the selected notes off (kept and greyed, not played); 0 again turns them back on. |
| Nudge | ← → move by a grid step (⌘: 10 ms, off the grid). ⇧← ⇧→ change the length. ↑ ↓ a semitone, ⇧↑ ⇧↓ an octave. |
| Copy and paste | ⌘C, ⌘X, ⌘V (pastes at the insert marker, set by clicking empty grid). |

Notes moved or added past the clip's ends grow the clip, joining any clip they
reach. Every change is one undo step, labelled like the lane's edits.

## View and grid

- **F** folds to the pitches the notes use. **G** folds to the scale's notes.
  **K** turns the scale tint on or off.
- **+ / −** zoom in and out. **Z** zooms to the selection, **X** to the whole
  clip.
- The wheel scrolls the pitches (⇧ or sideways: time), ⌘/⌃-wheel zooms time,
  ⌥-wheel changes the row height.
- **Grid:** Adaptive (the finest power-of-two step at least 24 px wide) or a
  fixed 1/1 to 1/32, or Off. Triplets are ⅔ as long. **⌘1 / ⌘2** make it
  narrower or wider, **⌘3** toggles triplets, **⌘4** turns snapping off and on.
  In a browser tab, ⌘1–4 switch the browser's tabs, so use **⌃1–4** there.

## Velocity

Drag a stem up or down. Every selected stem moves with it. In Draw mode, draw
across the stems; ⇧ draws a straight ramp from where you started. The box at
the lane's left shows the selection's velocity (1–127). Type a value to set
them all.

## Functions

These act on the selection, or on every note in the clip when nothing is
selected:

- **Quantize** (⌘U) to the current grid, by an amount (%). Ends is optional.
  ⇧⌘U opens the Functions section.
- **Transpose** −12 / −1 / +1 / +12.
- **Fit to scale:** each note goes to the nearest note of the tape's scale
  (ties go down).
- **Invert:** the highest note becomes the lowest.
- **Reverse:** backwards in time.
- **Legato:** each note lasts until the next one starts.
- **×2 / ÷2:** stretch from the first note.
- **Humanize** by an amount: timing and velocity are nudged from a seed, so the
  same press gives the same result; each press moves to the next seed.
- **Chop** (⌘E) into N equal parts. **Join** (⌘J) joins same-pitch notes.
  **Duplicate** (⌘D) copies the selection right after itself, rounded up to
  the grid.

## Keys and focus

Shortcuts only work while the piano roll has focus (click in it), and never
while typing in one of its fields. Space still plays and pauses the tape.
While a rack holds the computer keyboard, plain keys play notes and the roll's
single-letter shortcuts stand aside, the same as the rest of the app.

## Not yet

- The chance lane (seeded probability per note).
- Editing several clips at once (phase 6).
- Notes stay `{ t, n, v, d }` in seconds, plus an optional `off`. The grid is
  worked out from the BPM, so a tempo change moves the grid, not the notes.
