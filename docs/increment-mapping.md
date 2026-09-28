# Increment mappings

An ordinary mapping makes a control **follow** its source: the knob turns, the value moves with it. An **Increment** mapping moves the control in **steps** instead. Something happens (a beat, a signal, a source crossing a line) and the value moves by one step, then waits for the next one. With a glide each step slides instead of jumping.

It runs in the Play engine (`src/lib/playEngine.ts`), in takes and renders, and in website exports (`src/play/runtime/play-runtime.js`). The logic both share is the layer kit's `src/play/kit/increment.js`, inlined into exports as `SSKit.increment`, so a setup steps the same everywhere.

Example: **Increments: move in steps** (`playIncrement`) in the Play folder.

## Making one

In a mapping's row, **Kind** switches between **Follow** (the default) and **Increment**. Switching to Increment keeps the control and its range and starts with "+ an eighth of the range on every beat at the setup's clock tempo". Switching back to Follow drops the increment settings.

A folded row shows a one-line summary instead of the source, for example:

- `+0.5 ×2 on beat, wrap 8`
- `−2 every 0.5 s, bounce`
- `+10% on Hit`
- `+1 +1 at 0.6 ↕, glide 200 ms` (↕: also on the falling edge)

The open row keeps the **Steps** section open; **Range**, **Glide**, **Wrap back**, **Start and reset** and **Signals out** start folded with their own one-line summaries (remembered across increment rows). The footer shows the step count and a **Reset** button.

## What takes a step (On)

- **Trigger**: any trigger, as the trigger editor offers them. A **signal** is the usual one: an action's **Send a signal**, another increment's step signal, a pair's axis swap. Keys, notes, clicks, beats, gestures and conditions work too. The trigger's firing mode applies (once, every N while held…).
- **Threshold**: the mapping's **source** (any source: a reader, a control, live audio, MIDI…) reaching the **Level** (0 to 1 of the source). It is ready again only once the source has fallen below Level − **re-arm** (hysteresis), so a noisy source doesn't step twice. **Also falling** steps on the way back down too. A source already over the level when the mapping starts doesn't step until it has come back down.
- **Repeat**: every N **seconds** or **beats** (at the row's bpm), on the graph clock. **Only while** adds a condition (the "When a value…" editor): the ticks that come while it doesn't hold are skipped.

## The step

- **Direction**: + or −.
- **Step**: in the control's units.
- **Growth**:
  - **Constant**: the same step every time (0.5, 0.5, 0.5…).
  - **Compound**: the step is multiplied by the factor each time (0.5 ×2: 0.5, 1, 2, 4…).
  - **Additive**: the step grows by the factor each time (2 +1: 2, 3, 4…).
  - **% of value**: the step is that percentage of the current value (feels logarithmic), at least **min** so a value at 0 still moves.

Growth counts from the last wrap-back (or reset).

## Range and edges

The range is the mapping's usual `outMin → outMax`. At its ends the value can:

- **Clamp**: stop at the edge.
- **Wrap**: come round the other side (the top of the range is the bottom again).
- **Bounce**: turn back.

A wrap or a bounce glides through the edge rather than back across the range.

## Glide

**Glide** (ms) slides each step over that time along a curve (linear, smooth, ease in, ease out). 0 jumps. A step that comes mid-glide carries on from where the glide had got to.

## Wrap back

After **K** steps, the next increment returns to the start instead of stepping, and the growth starts over. **Snap** jumps back; **Glide** slides back over the glide time; **Ping-pong** turns round and walks back step by step (the growth starts over going back). K = 0 never wraps back.

## Start and reset

The start is the control's value when the mapping starts (switched on, made, or the setup loaded), or an explicit value. **Reset** (the footer's button) goes back to the start now, with the growth and direction. **Reset on** a signal does the same whenever that signal fires. Rewinding the clock starts every increment over too, so the same timeline always steps the same way. A render starts from scratch.

## Signals out

Each step can send a signal, and each wrap-back another (**Each step**, **Wrap back**). **Make <control>.step / .reset** creates the two signals named after the control and picks them. Other increments, actions and trigger mappings can listen to them, which chains increments into calculated motion: +2 on every beat, then +0.3 on every fifth, and so on.

Signals carry no values in Playfield, so the step number and the new value don't travel with them. To read where an increment is, use the control (`ctl:<control>`) or the mapping (`map:<mapping>`, its place across its range, 0 to 1) in a condition.

A signal sent by a step reaches whatever listens to it in the same frame when that comes later in the mapping list (or is an action next frame); an increment that listens to its own step signal steps at most once a frame.

## Plans

Increments are Pro (like signals and conditions). A setup with one opens on Free unchanged; the increment is kept but doesn't run.

## Takes and exports

A take records the controls' values as the increments drove them, so it plays back and renders as recorded. The website player runs the same kit code frame by frame (`src/play/__tests__/increment.test.ts` checks the runtime against the app).

## The file

An optional `increment` object on a mapping (older files load unchanged; a mapping without one follows its source):

```json
{
  "id": "m1", "controlId": "radius", "source": { "kind": "mouse", "axis": "x" },
  "outMin": 0.04, "outMax": 0.34, "curve": "linear", "smoothMs": 0, "enabled": true,
  "increment": {
    "on": "repeat", "trigger": { "on": "signal", "signal": "" },
    "threshold": 0.5, "hysteresis": 0.1, "falling": false,
    "every": 1, "unit": "beats", "bpm": 100,
    "step": 0.02, "growth": "compound", "factor": 1.5, "minStep": 0.01, "direction": 1,
    "limit": "clamp", "glideMs": 180, "glideCurve": "out",
    "wrapAfter": 5, "wrapBack": "glide", "start": "value", "startValue": 0.05,
    "stepSignal": "sig_step", "resetSignal": "sig_reset"
  }
}
```

Optional too: `when` (a condition, Repeat only) and `resetOn` (a signal id). Numbers out of reason are brought back in on load (`parseIncrement` in `src/types/play.ts`).

## Not yet

- Signals carry no value (step index, new value).
- Learn doesn't pick an increment's trigger; pick it in the trigger editor.
