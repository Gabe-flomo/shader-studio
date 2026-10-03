# Ableton-style MIDI: scale lock and piano roll (plan, 2026-10-03)

## What exists

**Notes** are `{ t, n, v, d }` in seconds on the tape (`src/types/playArrangement.ts`). There are pure helpers to add, patch and delete notes (a note outside every clip grows the clip).

**Notes are edited in place on the lane** (`ArrangementPanel.tsx` `Lane`):
- drag to move;
- drag the edge to lengthen;
- ⌥-drag for velocity;
- double-click to add;
- Delete to remove.

There's no keyboard, no grid choice, no multi-select, and no split, quantize or scale.

**Live notes** from MIDI, the computer keyboard, the on-screen keys and Play notes all reach a rack through `audioEngineHost.input()`. There, Sample index already rewrites notes and remembers each one so its note-off matches; the tape records what was sent. That's where a scale lock goes.

**Scales:** `src/play/notes.ts` has five scales and nearest-snap with ties going down, which is Ableton's rule.

## Phases (each ships)

**1. Scale model and the tape's scale**
- `src/play/scales.ts`: Live's scale list, plus `snap(note, scale, root, 'nearest' | 'up' | 'down')` and `inScale`.
- `arr.scale = { on, root, name }`, with a Scale toggle, root and name in the transport bar.

**2. Scale lock on live input**
- Each rack's MIDI in gets **Snap to scale**: off, nearest, up or down.
- It's applied in `input()` before Sample index and skipped for tape playback.
- Held notes are remembered, so each note-off matches the note-on it rewrote.
- The snapped note is what records.

**3. Piano roll**
- Double-click a MIDI clip and the editor opens in the device area (Notes/Device switch).
- **Layout:**
  - Keyboard on the left (click to hear a note).
  - A bars.beats ruler (drag to zoom and scroll).
  - The clip's brace.
  - Scale rows tinted, the root row stronger (K).
- **Editing:**
  - Select, ⇧-select or marquee.
  - Move in time and pitch, ⌘-drag to copy, resize either edge.
  - B for Draw mode.
  - Arrows nudge: by a grid step in time, a semitone in pitch; ⇧ for octave and length; ⌘ ignores the grid.
  - 0 turns a note off.
- **View:**
  - F fold, G fold to scale.
  - +, -, Z and X zoom.
- **Grid:** adaptive or fixed 1/1–1/32, triplet; ⌘1–⌘4.

**4. Velocity lane**
- Drag stems, draw ramps, type a value.
- Later: a chance lane (seeded, so renders repeat).

**5. Operations**
- Split and chop (⌘E), join (⌘J), duplicate (⌘D).
- Quantize (⌘U, settings on ⇧⌘U, amount).
- Fit to scale, transpose, invert, reverse, legato, stretch ×2 and /2, humanize.

**6. (Optional) Several clips at once**, in colours, with a focus mode.

## Decisions (recommended, taken unless changed)

1. One scale for the whole tape, in the transport; a per-clip override later.
2. Record the snapped note (what you heard).
3. The lock lives on each rack's MIDI in.
4. Nearest, ties go down (up and down as options).
5. Notes stay in seconds; the grid comes from the BPM.
6. The editor opens in the device area.
7. Chance and deactivated notes come in phase 4.

Sources:
- https://www.ableton.com/en/manual/editing-midi/
- https://www.ableton.com/en/live-manual/12/clip-view/
- https://www.ableton.com/en/manual/live-midi-effect-reference/
