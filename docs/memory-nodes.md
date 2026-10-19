# Memory nodes

Numbers that remember last frame: **Lag**, **Spring**, **Envelope (ADSR)**, **Timer**, **Counter**,
**Sample & Hold** and **Speed (integrate)**, in Animation. They are TouchDesigner's Lag, Spring, Trigger,
Timer, Count, Hold and Speed CHOPs.

A shader forgets everything between frames, so on its own it can't glide towards a value, count beats or hold
a number. These nodes keep a small state on the GPU and carry it from frame to frame.

| Node | What it does | Outputs |
|---|---|---|
| Lag | Follows its input slowly: Rise and Fall are the seconds to get 63% of the way, up and down. | Value, Velocity |
| Spring | Follows like a weight on a spring: Frequency (swings a second), Damping (1 settles without overshoot). | Value, Velocity |
| Envelope (ADSR) | Gate on: Attack to 1, Decay to Sustain, hold; gate off: Release to 0. Trigger mode: each tap plays Attack and Decay to 0. | Value, Active |
| Timer | Counts seconds while Run is on (always, unwired) up to Length; Loop starts over; Reset goes to 0. | Seconds, Fraction, Done |
| Counter | Adds Step on each rising edge of Trigger, between Min and Max (Wrap, Stop or Free); Reset goes to Min. | Count, Fraction |
| Sample & Hold | Takes Value on each rising edge of Trigger, or (unwired) every Every seconds. | Value |
| Speed (integrate) | Adds up Rate per second: a speed becomes a position. Free, Wrap or Stop between Min and Max. | Value |

A *rising edge* is the moment an input goes above 0.5: a square LFO's beat, a MIDI note's gate, a mouse
button, a Compare.

## Wiring them

- Wire **single values**: an LFO, Time, Audio, MIDI, the Mouse's X or Y, a Blob Track's Count, a Play
  control. Inputs are read once a frame, at the picture's centre: a per-pixel picture (noise over UV) gives
  its centre pixel's value.
- Outputs are ordinary floats: wire them anywhere (a circle's radius, a palette's angle, a Cache's Delay).
- The Envelope's card draws its curve (after Ableton's): drag the peak for Attack, the next point for Decay
  (sideways) and Sustain (up and down), the end for Release; it writes on release (one recompile). While the
  preview runs, a dot rides the curve with the live value (read back from the GPU only while the card shows:
  `lib/memoryProbe.ts`).
- Chain them: a Lag into a Spring works. A memory node fed by another reads it one frame late.
- Settings are compile-time: dragging one recompiles. To drive a setting live, wire it from outside (put a
  Lag after a value instead of animating Rise).

## How it works

`compiler/memoryExpand.ts` opens every top-level memory node into **one shared Pass** (`__memory`, full
float, nearest, `__size` = how many nodes): texel *i* holds node *i*'s state (a vec4). The Pass's program
(the Memory step) works out every node's next state from last frame's (its Previous) and its inputs, by
`u_frameDt` seconds (0 while paused, so nothing moves). Each node is replaced by a Memory read that fetches its
texel. All of them together use one of the graph's 8 Pass slots.

The Mouse inside that Pass reads `u_pictureRes`, the picture's size, set by the pass runners (preview,
offline, web pages), so it lands where the pointer is.

## Limits (v1)

- Inside a group they don't remember: they pass their input through (Lag, Spring, Hold), or give 0.
- Settings aren't Play controls yet (they are compile-time).

Examples: Memory 1 · Lag and Spring follow a target (a jumping point until the mouse moves); Memory 2 · A beat with Envelope and Counter.
Code: `src/nodes/definitions/memory.ts`, `src/compiler/memoryExpand.ts`. Tests: `src/compiler/__tests__/memoryNodes.test.ts`.
