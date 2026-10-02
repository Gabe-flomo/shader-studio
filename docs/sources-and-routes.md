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
