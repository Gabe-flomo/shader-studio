# Conditions, signals and pair controls

Three Play features that make a setup react to itself: triggers that watch any number, named signals that chain actions together, and controls that play two values as one. All of them run in the Play engine (`src/lib/playEngine.ts`), in takes and renders, and in website exports (`src/play/runtime/play-runtime.js`). The logic the app and the runtime share is in the layer kit's `src/play/kit/signals.js`, so both behave the same.

Examples: **Conditions and signals** (`playConditions`) and **Pairs, XY pads and axis swap** (`playPairs`) in the Play folder.

## Condition triggers: "When a value…"

A trigger kind for actions and trigger mappings. It watches one value and fires when a condition on it becomes true.

**The value** is a path (`sgParseValueRef`):

| Path | What it reads |
| --- | --- |
| `ctl:<control>` | A control on the panel, in its own units (what a mapping drives it to, else its slider) |
| `layer:<layer>::<key>` | A layer's property, as a mapping or a following null has it now |
| `finish:<effect>::<key>` | A Finish effect's number |
| `audiofx:<chain>:<effect>::<key>` | An audio effect's number (docs/audio-effects.md) |
| `map:<mapping>` | A mapping's source reading, 0 to 1 (a trigger mapping's envelope) |
| `mouse:x`, `mouse:y` | The pointer, 0 to 1 (y up) |
| `dist:<A>\|<B>` | How far apart two things are, in picture heights |

A distance's ends (anchors) are a layer (its centre, as proximity measures it), a hand point (`hand:<side>:<point>`), the pointer (`mouse`), a point on the picture (`pt:<x>,<y>`, 0 to 1, y up), or the MIDI pad grid's last pad (`pad:last`: its column across and row up, 0 to 1, like the Pad grid X and Y sources; no position before a pad is hit). The pickers offer the last pad when the setup has a pad grid; it is most useful as a pair mapping's **Position** source.

**The comparison:**

- **Below** / **Above**: true while the value is under / over the threshold. Once true, it stays true until the value goes back past the threshold by the **hysteresis**, so a value hovering at the edge doesn't flicker.
- **Equals**: true while the value is within the **tolerance** of the threshold (plus the hysteresis to let go).
- **Crosses ↑** / **Crosses ↓**: the moment the value passes the threshold going up / down. It has to have been on the other side first (a value that starts above doesn't count as crossing up), and it is ready again only once it has gone back past the hysteresis.
- **Is not**: equals turned round: true while the value is further than the tolerance from the threshold (it lets go once back within the tolerance less the hysteresis).
- **Between** / **Outside**: a band with two edges (`threshold` and `hi`, either way round). Between is true inside it and holds until the hysteresis past an edge; Outside is true beyond either edge and lets go once the hysteresis back inside (at the middle, for a band narrower than twice the hysteresis).
- **Never reached** / **Never dropped to**: true while the highest (lowest) value seen is still under (over) the threshold. It needs one reading first, and starts over when the clock goes back, so a replayed timeline reads the same.

**Raw or %.** The switch beside the value puts the thresholds (and the hysteresis and tolerance) in the value's own units, or as a share of its range: 50% is the middle, whatever the range. The range is the control's own min and max, the layer property's, the Finish or sound effect number's, 0..1 for a mapping's reading and the pointer; a distance has none, so it uses the range seen so far. The range is looked up when the condition runs (`play/conditionRange.ts`), so widening a slider keeps 50% at its middle. Switching keeps the thresholds in the same place.

A missing value (a hand out of view, a deleted layer) is never true, and a crossing forgets which side it was on.

**Firing modes** work as for every trigger: Once when it becomes true, Continuously or Every N while it stays true, and **When it stops** when it becomes false. A crossing is a single tap (a press and its release in one frame), so it fires once in every mode.

**The meter** in the editor shows the value now against its range, the threshold, the shaded part where the condition is met and the lighter strip of the hysteresis.

**Proximity** is the distance case: a proximity trigger is `dist:A|B` below (closer) or above (farther) its distance, with its margin as the hysteresis. Both kinds run through one tick (`tickConditionTriggers`). Switching a proximity trigger to "When a value…" keeps its distance, threshold and margin.

## Signals

A **signal** is a named event the setup defines (Layers → **Signals**: add, rename, fire by hand with ▶, delete).

- **Send a signal** is an action: in an action's **Do**, pick Send a signal and the signal. It needs no layer.
- **When a signal fires** is a trigger kind: actions and trigger mappings fire on it. In a mapping's Source picker each signal is also listed under **From the setup** (a trigger on it playing an envelope).
- An **axis swap** can send a signal on each swap (below).
- **Learn** takes a signal: while listening, fire one (▶ on the list, or anything that sends it) and it becomes the trigger or the source.
- An **Increment** mapping steps a control on a signal (or a threshold, or a repeat) and can send a signal on each step and each wrap-back, so increments chain: docs/increment-mapping.md.

Signals pass down a chain in the same frame: A sends S1, an action on S1 sends S2, an action on S2 bursts particles, all in one frame, in whatever order the actions are listed. Two guards keep a loop from hanging the page (`sgRunActions`):

- each signal fires at most once a frame;
- a chain passes through at most 8 links a frame (`SG_DEPTH`). Whatever is left carries on next frame, so a long chain is late by a frame, not lost.

A loop (S1 sends S2, S2 sends S1) therefore runs at most once around per frame.

Deleting a signal leaves what sent or listened for it in place, marked **Missing signal**. Signals themselves aren't recorded in takes: what they did is (the actions they fired, the controls they moved).

## Pair controls

Two controls played as one. On the Controls tab, right-click a slider (long-press on a phone):

- **Pair with…** another slider: any two values, such as radius and glow;
- **Add as position with Y** (or X): the control and its X/Y partner (a layer's `x` and `y`, a node's `posX` and `posY`) as a position. The partner's control is made if the panel doesn't have it.

A layer's property rows offer **Add as position with …** too.

A pair shows as one card: a slider for each value, each disabled while a mapping drives it, and an **XY pad** for a position (drag the dot; an axis a mapping drives stays put). On the Stage and in the website player's panel a position pair is just the XY pad, under the pair's name (a pair of two values stays two sliders). The pair's own mappings, rename and **Unpair** are on the card and its right-click menu. The two controls stay ordinary controls (`pairs` only groups them), so layers and graphs still see two plain values, and takes record two tracks.

## Pair mappings

Mappings → **Pairs** → **Map a pair**. Each has:

- **Source**: a **Position** that drives both axes at once (across the picture drives A, up drives B): the pointer, a null or any layer's centre, a hand point, or a point. Or **One value**: any mapping source, sent to **A only**, **B only** or **Both**.
- **Per axis**: its range, curve and smoothing, and an optional **Only while…** condition (Below, Above or Equals on any value, the same editor as a condition trigger). While the condition doesn't hold, the axis keeps its last value. "Only while the pointer is within 0.1 of the null" is a distance condition: `dist:mouse|<null>` below 0.1.
- **Axis swap** (One value only): drive A until A's value crosses **To B** (going up or down), then drive B until B's value crosses **Back** (going up or down), then A again. The axis not being driven holds where it was. Each swap can send a signal. Rewinding the clock (or **Start on A**) starts on A again; a render starts on A.

Where a plain mapping and a pair mapping drive the same control, the pair mapping (run after the plain ones) wins.

## Plans

Condition and signal triggers are Pro sources, like proximity. A pair mapping runs on Free when its source is the pointer (as a position) or a Free source, with no conditions or swap signals; otherwise it needs Pro (`pairMappingNeedsPro`).

## The file

All optional, and left out when empty (older files load unchanged):

```json
{
  "signals": [{ "id": "sig_…", "name": "Reached" }],
  "actions": [
    { "id": "a1", "do": "signal", "signal": "sig_…", "layerId": "", "amount": 1, "enabled": true,
      "trigger": { "on": "value", "value": "dist:cursor|goal", "cmp": "below", "threshold": 0.1, "hysteresis": 0.03, "tolerance": 0.01 } },
    { "id": "a2", "do": "burst", "layerId": "pop", "amount": 200, "enabled": true, "trigger": { "on": "signal", "signal": "sig_…" } }
  ],
  "pairs": [{ "id": "pair_…", "label": "Circle", "a": "ctlX", "b": "ctlY", "position": true }],
  "pairMappings": [{
    "id": "pmap_…", "pairId": "pair_…", "affect": "a", "enabled": true,
    "source": { "kind": "value", "source": { "kind": "lfo", "shape": "triangle", "rate": 0.12, "phase": 0 } },
    "a": { "outMin": -0.5, "outMax": 0.5, "curve": "linear", "smoothMs": 60 },
    "b": { "outMin": -0.5, "outMax": 0.5, "curve": "linear", "smoothMs": 60, "when": { "value": "mouse:x", "cmp": "above", "threshold": 0.5, "hysteresis": 0.03, "tolerance": 0.01 } },
    "swap": { "at": 0.4, "dir": "up", "backAt": -0.4, "backDir": "down", "signal": "sig_…" }
  }]
}
```

A condition may also carry `hi` (a band's other edge) and `"unit": "pct"`; both are left out when unset.

A slider can show as a switch (`"toggle": true` on a float control): off is its low end, on its high end, a plain number underneath, so mappings, conditions and takes see a slider. The Beat trigger's `"unit": "hz"` shows its pulse as a rate; the timing is the same (`bpm / 60 / beats` a second).

A pair needs two different float controls, each in one pair at most; a pair mapping needs its pair. A condition whose value path isn't one is dropped with its trigger. A value path to something missing is kept and simply never holds.

## Website exports

The runtime runs conditions, signals, pair mappings and axis swaps through the inlined kit (`SSKit.signals`), frame for frame like the app (`src/play/__tests__/conditionsSignals.test.ts` checks one against the other). A percent condition's range comes with the bundle (`condRanges`: value path → [lo, hi]), since the page has no list of layer properties. A switch shows as a checkbox. The exported player's panel shows a position pair as an XY pad (`.ssp-xy`; an axis a mapping drives stays put) and any other pair as two sliders. The pad grid's last pad (`pad:last`) is read from the page's own pad grid.

## Not yet

- Nothing listed.
