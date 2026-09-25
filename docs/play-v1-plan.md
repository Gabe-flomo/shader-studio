# Shader Studio Play — the V1 plan

*Written 24 Sep 2026. This is the explainer version: what we are building, why it fits the app we already have, and the order we build it in.*

---

## Where it stands

- **Step 1, the input bus: done.** It also carries Play's param writes (`param:nodeId::key`, resolved through the compiler's binding map), tells the render loop when a value actually moved, and wakes a sleeping loop when an input arrives.
- **Step 2, the MIDI Input node: done.** Web MIDI plus the QWERTY stand-in. The Tauri/macOS bridge (`midir`) is still to do.
- **Step 3, the Play page: done** (`src/components/play/PlayPage.tsx`, `src/lib/playEngine.ts`, `src/play/`). Controls from the candidate list (floats and colours), a mappings drawer with range, curve, smoothing and colour channel, collapsible rows, Learn. Bool toggles are not offered: a `bool` param bakes into the shader, so it can't be a live control.
- **Play files.** There is no second file. A graph carries its Play setup under the top-level `play` key, so Save in the top bar, Export, Import and the saved-graphs list all keep the panel and the mappings with the graph. Open a saved graph, go to the Play tab, and the setup is there. "Export play file" on the Play page writes the same graph with a `kind` marker (so importing it opens on Play) and with driven controls baked at their live value, so it opens looking exactly as the picture did.
- **Layers: done** (`src/play/overlay.ts`, `src/components/play/LayersPanel.tsx`). Nulls, text, images and particles drawn over the picture; see the Layers section below.
- **Web page export: done** (`src/play/exportHtml.ts`, `src/play/runtime/play-runtime.js`). One self-contained HTML file with the shader, the panel, the mappings and the layers.
- **Steps 4 and 5: not started.**

---

## Sources

A mapping is `source → range → curve → smoothing → control`. Every source reads as 0..1. A source that has never produced a reading (a knob nobody touched) leaves its control alone.

**In, today.** Listed in the order the drop-down shows them: what everyone has first, hardware last.

| Source | Reads | Notes |
|---|---|---|
| Mouse X / Y / button | pointer over the window | Play page only |
| Keyboard key | 1 while held | Play page only; Learn takes the next key |
| Another control | that control across its range | cross-modulation; chains work, a loop lags a frame |
| LFO | sine, triangle, saw, square, random-step at a rate in Hz, with a phase offset | runs on the graph clock, so pausing pauses it and offline export is deterministic |
| Clock (BPM) | the same shapes locked to a tempo, one cycle per N beats | tap tempo on the row |
| Audio band | one band of an Audio Input node | the node needs a file or the mic playing |
| Phone tilt | left/right, front/back, compass | iOS asks once; the row shows Enable |
| Gamepad | a stick axis or a button | polled; Learn takes the first stick moved or button pressed |
| Null position | a null layer's X or Y on the picture | drag it, or drive it from any other source |
| MIDI CC, note, velocity, gate, bend | Web MIDI or the keyboard stand-in | Learn takes the next message |

Every mapping's curve can also be **drawn**: pick Draw and drag across the pad; the samples are stored with the mapping.

**Ableton, TouchOSC, Max, TouchDesigner.** Today the route is MIDI: send from the DAW to a virtual MIDI port (IAC Driver on macOS, loopMIDI on Windows) and it appears as an ordinary MIDI source. Next is an **OSC source**: the app listens on a WebSocket, a tiny bridge (`node tools/osc-bridge.mjs`, or the Tauri shell listening on UDP directly) forwards OSC, and any address becomes a source. That gives Ableton's Max for Live devices and TouchOSC a direct line without MIDI's 7-bit resolution. **Ableton Link** for shared tempo and **MIDI clock** into the Clock source come with it.

**Later.** Multi-touch positions as extra XY pairs; webcam brightness and motion through the Video Input node; envelopes and triggers (step 4).

---

## Layers

The picture is a texture. Things drawn over it in JavaScript feed the bus, and the picture feeds them back. Layers live in the play record (`layers`), so they travel with the graph, with play files and with the web page export. A 2D canvas sits over the WebGL canvas and is painted right after each shader frame, while the picture is still in the drawing buffer.

- **Null.** A draggable point. Its X and Y are a mapping source, and (like every numeric layer property) can be made a control with the + next to it, so a null can drive sliders and be driven by an LFO, a clock, the mouse or another control. "The position of a shape drives a slider" is one mapping.
- **Text and image.** *Over* the picture with a blend mode; *reveal*, where the picture shows only inside the shape and a colour fills the rest; or *luma*, where the picture's brightness is the layer's alpha. Images are stored as downscaled data URLs.
- **Particles.** Points steered by a 64×36 brightness readback of the picture: *flow* (brightness is the heading, turns × 360°), *climb* (toward brighter) or *descend*. Trails, blend modes, colour from the picture.

## Web page export

"Export as a web page" writes one HTML file: the compiled fragment shader on a WebGL quad, the uniform values as they are, the controls panel, the mapping engine and the layers, in about 30 KB plus any images. It runs on any site or in a CodePen. `?panel=0` hides the panel; Space pauses the clock; MIDI and phone motion sit behind Enable buttons because browsers require a gesture. It cannot run image, video or audio inputs, MIDI Input node outputs, previous-frame feedback, echo or GPU particle systems; the export names what a graph uses.

---

## Set lists and the pop-out window (after V1)

Several instruments switched by key or program change with a crossfade, and a second-monitor preview window in Tauri. Both sit on top of the bus and the per-graph `play` record.
