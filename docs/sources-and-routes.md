# Sources and routes

The newer shape of a mapping (implementation guide, phase 1). The engine and
the web runtime run it through one shared module, `src/play/kit/routes.js`
(`SSKit.routes` on an exported page), so a page behaves exactly like the app.

- A **Source** (`PlaySourceDef`, `record.sources`) is anything a mapping could
  read (MIDI, the mouse, an LFO, a hand, a trigger, another control…), read
  **once a frame**. It has outputs, each with any number of **Routes**:
  - a **Value** output gives the reading (0 to 1);
  - a **Step** output is the old Increment, counting through its own range
    (`lo`..`hi`); each route remaps it, so one counter can drive several
    controls. A Step that starts from "the current value" reads its first route.
- A **Route** (`PlayRoute`) goes to one control:
  - **Replace** sets it: `outMin` at the source's 0, `outMax` at its 1,
    through the curve. Several Replaces on a control: the last wins (as
    mappings always did).
  - **Add** moves it from where it is: the swing `outMin..outMax` (by default
    half the control's range either way, `rtAddSwing`, so a source at 0.5 adds
    nothing). Adds sum on top of the control's last Replace that frame, else
    its slider, and stay in range. On a colour or a button an Add acts as a
    Replace.
  - Each route has its own curve, channel (colours), smoothing and delay.
- A source with **no routes** is still read: conditions watch any source as
  `src:<id>` (0 to 1). An old mapping is a source with its id, so `src:<id>`
  works for it too (`map:<id>` stays an alias).

**Old mappings** are read as sources (`rtSourcesOf`): each becomes a source
with one Replace route carrying its range, curve, channel, smoothing and delay
(an Increment becomes a Step output over the same range). Nothing in a file
changes; the golden outputs (`src/play/__tests__/golden/`) show every example
and fixture behaves exactly as before.

**One frame** (`rtFrame`): sources are read and their routes written in record
order, so a source that reads another control sees what was written to it
earlier in the frame, as mappings did. Add routes are summed at the end.
Conditions run before sources in a frame, so a condition on `src:<id>` sees
the source as the frame before left it.

**Not yet**: the Inputs board that makes sources and routes in the UI (guide
phase 4); layer sets carrying a record's own sources (with the board); a Macro
slider source; reading control sources in dependency order (kept in record
order so behaviour doesn't change).

## The Inputs board (guide phase 4)

On the rail, **Inputs** replaces Controls and Mappings. The page id stays `controls`, and a saved `mappings` page opens there. The rail now reads **Inputs, Rules, Layers, Look, Sound**. Sound holds the Audio engine and the sound effects.

- **Controls column:** the controls board as before. Each control shows what drives it: its mappings, and every route from a source of the record (marked "(add)" for Add routes).
- **Sources column:** the record's own sources as cards, then the old mapping cards. The mapping cards keep Learn, MIDI auto-learn, increments, trigger sources and pairs. **+ Source** adds a source that drives nothing yet.
- **Map:** the + on a mapping card or Map on a source card starts Map mode (`inputs/mapMode.ts`). Every control becomes a target. A click routes the source there, or takes the route off. Esc or Done ends it.
  - Map works in the sidebar's controls list too.
  - On the first pick, a mapping becomes a source of the record with the same id (`routeOps.ts` `ownSource`), so its smoothing and delay state carry over.
  - New routes follow `connectDefaults`: a number Adds ±half the control's range; an on/off input Sets it, with a 120 ms glide.
- **Source card:** its source and options, Learn, and each route on two lines:
  - the control, on/off and remove;
  - Set or Add, with the range, the curve (drawn too), smoothing and delay folded.
  - A Step output uses the Increment editor.
- **Phones:** the two columns are tabs; Map mode shows the controls.

Not done yet:
- the shaded swing ring on sliders;
- clickable route chips (they open the detail windows, phase 5);
- grouping sources by kind.

## Random sources and readouts (guide phase 7)

- **Noise kinds:** Bell and Biased join Smooth, Drift, Random and Stepped.
  - Bell is the mean of three smooth noises: mostly near the middle.
  - Biased bends smooth noise towards the low or high end (Lean 0–100%).
  - **New each play** adds a per-play seed: Play's start in the app, the page's opening on a website. Without it, the seed stays and takes replay the same.
- **+ Source → Random:** Shake, Wander, Hop and Chaos. Each makes a noise source and goes straight into Map mode.
- **Reads a value:** a Text layer can show a value path (a control, a source, a layer's number, a distance…) instead of its text: as a number to N decimals, a percent, ON/OFF, or its text with `{v}` replaced (`klReadText` in the kit, so app and website match). A layer that reads a value redraws every frame.

Already in from the simplification work: percent of range; between, outside, not and never reached; rising and falling; counters (every Nth, N within T); route delay.
