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

*Renamed 2026-10-17 (docs/glossary.md):* the rail reads **Controls, Layers, Rules, Finish, Sound** (⌘1–5 in that order, since 2026-10-18). The board is still the Inputs board in the code; on screen it is **Controls**, with its two columns **Controls** and **Sources**. ⌘1 is “Go to Controls”, ⌘⇧M “Go to Sources”.

- **Controls column:** the controls board as before. Each control shows what drives it: its mappings, and every route from a source of the record (marked "(add)" for Add routes).
- **Sources column:** the record's own sources as cards, then the old mapping cards. The mapping cards keep Learn, MIDI auto-learn, increments, trigger sources and pairs. **+ Map** (below) adds a source.
- **Map:** the + on a mapping card or Map on a source card starts Map mode (`inputs/mapMode.ts`). Every control becomes a target. A click routes the source there, or takes the route off. Esc or Done ends it.
  - Map works in the sidebar's controls list too.
  - On the first pick, a mapping becomes a source of the record with the same id (`routeOps.ts` `ownSource`), so its smoothing and delay state carry over.
  - New routes follow `connectDefaults`: a number Adds ±half the control's range; an on/off input Sets it, with a 120 ms glide.
- **Source card:** its source and options, Learn, and each route on two lines:
  - the control, on/off and remove;
  - Set or Add, with the range, the curve (drawn too), smoothing and delay folded.
  - A Step output uses the Increment editor.
- **Phones:** the two columns are tabs; Map mode shows the controls.
- **Route chips:** a control's "driven by" chip opens what drives it in the Sources column, on phones and desktop alike (Play audit P7; one implementation, PlayPage's `openDriver`): the Sources side shows (the phone's switch, the narrow board's tab, the drawer), its group and card unfold, and it scrolls into view with a brief outline. With nothing driving it, the chip isn't there; the details window is still a click away on the card.
- **Mapped by:** a control card's details list each mapping and route onto it as a chip; a click opens that one in Sources (`driverCardOf`). **Learn** there starts Learn mode with this control picked.
- **Target chip:** an open mapping card shows what it drives as a chip ("→ Radius ▾") beside its meter, instead of a CONTROL drop-down on every card. A click lists the controls to drive instead (retarget: the range resets to the new control's). A colour's channel picker sits beside it.
- **Swing ring:** under a driven slider, a thin strip is the control's range laid flat (the ruler above scrolls under its needle, so it can't show a span itself). The part its sources can move it across is shaded in the accent, with a tick at the live value. Worked out in `play/controlSwing.ts` (pure, tested), the way `rtFrame` plays routes:
  - each Replace route (an old mapping is one) covers its range, either way round; several cover their union;
  - Add routes sum on top of the last Replace, else the slider, so they reach from + Σ low ends to from + Σ high ends;
  - all kept in the control's range. Colours, buttons and switches have no strip.
  - Live values now poll for the record's own sources too, not only for mappings.
- **Drag a source onto a control:** source cards and mapping cards have a grip. Drop it on a control card (on the board or in the sidebar's list) and the route is made as a Map click makes it (`routeToControl`, so `connectDefaults` applies). The drag carries its own type (`inputs/sourceDrag.ts`, tested), so only a source lights a control up ("Drop to drive …"). A drop never takes a route off: onto a control the source already drives, or from a source with as many routes as it may have, it says so instead. Map mode works as before.
- **Sources by kind:** the sources column groups the record's own sources and the old mappings together by what they read: MIDI and OSC; keys, mouse and gamepad; audio; LFOs, clocks and noise; triggers; picture, hands and sensors; controls and data (`mappingGroups.ts` `groupSourceItems`, tested). Each heading folds its cards away and shows its count. From four cards on, a search box filters by name, what each reads and the controls it drives (a search shows folded groups too). Pair mappings, the MIDI file slot and the pad grid stay where they were.
- **Folded by default:** mapping cards, source cards and pair mapping cards start folded to their one line: a mapping reads "source › control" with "0.05–0.7 · linear" and its meter under it; a source card keeps its header (name, Map, on/off) with "what it reads → what it drives". Opening one is remembered on this device (playUi's `folded`, `mappingFoldKey` / `sourceFoldKey`); a mapping or input just added opens, to be set up. The group headings' folds are remembered too.
- **Built in:** at the very bottom, folded, the built-in signals (Signals: count, active, active share; docs/conditions-and-signals.md) as read-only cards with their value now and **Map**. They can't be deleted.
- **+ Map (Play audit P6):** the Sources header has one **+ Map** button (beside the hands toggle and the ⋯). It replaced Learn, Add (which silently made a MIDI CC mapping on the first control and asked the browser for MIDI access) and + Source (Random only). It opens a searchable picker grouped by kind (`mapPicker.ts`, tested): **Learn**, **MIDI** (knob or fader, note, velocity, gate, pitch bend, 12 notes → 12 targets…), **Keys**, **Mouse**, **Audio** (bands, readers, Spectrum readers…, an Audio Input node's band), **Hands**, **LFO / Beat** (LFO, Beat, Function), **Random** (Shake, Wander, Hop, Chaos, Noise), **Behaviours…** (the Behaviours library), then the rest under their own headings (More devices, From the setup, Face, Pose). Picking a type makes a source of the record, opens its card and starts Map mode; a knob or fader starts with no CC and takes the first knob turned (`midiAutoLearn` now covers the record's sources too). Free sees Pro on what it lacks. The empty state's **Map an input** opens the same picker.
  - **No MIDI prompt until asked:** only a MIDI kind or Learn calls `connectWebMidi` (`mapPickAsksMidi`). A setup with no MIDI never asks.
  - **Later (P10):** the MIDI file and the pad grid move in as MIDI kinds; `mapPicker.ts` notes where.
  - **Connect gear…** stays in the Sources ⋯.
- **Learn mode (`inputs/learnMode.ts`):** Ableton style. Every control card gets a blue overlay (`MapTarget`, `data-learn-target`); a click picks one (solid blue, "Move a knob or press a key…"). The next knob, note, key, sound or hand move becomes a mapping onto it across its whole range (`learnOnto`, tested). Learn stays on: another input replaces the one just learned (no second row), and another click picks another control. A strip over the controls (and in Sources) says what it waits for, with **Stop**; Esc stops it too (`playEngine` never learns Esc as a key). The + Map button reads **Learning** meanwhile and stops it on a click. Learn mode and Map mode end each other; the narrow board and the phone show the controls while it's on. A mapping row's own ✦ Learn (replace this row's source) is unchanged.
- **+ Map → MIDI → 12 notes → 12 targets…:** one note class per control or layer, any octave (docs/midi.md). The sidebar's mappings drawer is unchanged.

## Random sources and readouts (guide phase 7)

- **Noise kinds:** Bell and Biased join Smooth, Drift, Random and Stepped.
  - Bell is the mean of three smooth noises: mostly near the middle.
  - Biased bends smooth noise towards the low or high end (Lean 0–100%).
  - **New each play** adds a per-play seed: Play's start in the app, the page's opening on a website. Without it, the seed stays and takes replay the same.
- **+ Map → Random:** Shake, Wander, Hop and Chaos (and a plain Noise). Each makes a noise source and goes straight into Map mode.
- **Reads a value:** a Text layer can show a value path (a control, a source, a layer's number, a distance…) instead of its text: as a number to N decimals, a percent, ON/OFF, or its text with `{v}` replaced (`klReadText` in the kit, so app and website match). A layer that reads a value redraws every frame.

Already in from the simplification work: percent of range; between, outside, not and never reached; rising and falling; counters (every Nth, N within T); route delay.
