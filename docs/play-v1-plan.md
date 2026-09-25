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
- **Step 4, triggers and envelopes: done** (`src/play/triggers.ts`). A Trigger source fires on a key, a click, a beat, a MIDI note, an OSC message or an audio hit and plays an envelope (ADSR, velocity), a toggle, a step or a random value. Noise sources (smooth, drift, random, stepped) sit beside the LFO.
- **OSC and live audio: done.** `npm run osc-bridge` (tools/osc-bridge.mjs) brings OSC from Ableton or TouchOSC in; a Live audio source listens to a mic or a virtual cable carrying Ableton's sound. First-time setup: docs/connecting-ableton.md (also in the app, Mappings → ⓘ).
- **Step 5, MIDI files and offline export: not started.** Quantise-to-scale and latch processors, MIDI clock and Ableton Link are next after it.

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
| Noise | smooth, drift, random (every frame) or stepped (posterised time, optional levels) | graph clock; reseed for a different path |
| Trigger | a key, a click on the picture, a beat, a MIDI note, an OSC message or an audio hit → envelope / toggle / step / random | presses are counted, so a quick tap is never missed; row Learn picks what fires it |
| Live audio in | level, bass, low-mid, high-mid, treble of a mic or a virtual cable | Listen asks for the microphone; pick BlackHole / CABLE Output for Ableton |
| OSC | one argument of an OSC address, scaled from min..max | needs `npm run osc-bridge`; Learn picks the next address |
| MIDI CC, note, velocity, gate, bend | Web MIDI or the keyboard stand-in | Learn takes the next message |

Every mapping's curve can also be **drawn**: pick Draw and drag across the pad; the samples are stored with the mapping.

**Ableton, TouchOSC, Max, TouchDesigner.** Three routes, all in: MIDI through a virtual port, OSC through the bridge (`npm run osc-bridge`; the Tauri shell could later listen on UDP itself), and Ableton's sound through a virtual audio cable into the Live audio source. See docs/connecting-ableton.md. Still to come: **Ableton Link** and **MIDI clock** into the Clock source.

**Later.** Multi-touch positions as extra XY pairs; webcam brightness and motion through the Video Input node; envelopes and triggers (step 4).

---

## Layers

The picture is a texture. Things drawn over it in JavaScript feed the bus, and the picture feeds them back. Layers live in the play record (`layers`), so they travel with the graph, with play files and with the web page export. A 2D canvas sits over the WebGL canvas and is painted right after each shader frame, while the picture is still in the drawing buffer.

- **Null.** A draggable point. Its X and Y are a mapping source, and (like every numeric layer property) can be made a control with the + next to it, so a null can drive sliders and be driven by an LFO, a clock, the mouse or another control. "The position of a shape drives a slider" is one mapping.
- **Text and image.** *Over* the picture with a blend mode; *reveal*, where the picture shows only inside the shape and a colour fills the rest; or *luma*, where the picture's brightness is the layer's alpha. Images are stored as downscaled data URLs.
- **Particles.** A small physics system shared by the app and web exports (`src/play/particle-sim.js`, after the author's p5 sketch). Each particle has a velocity that *steers* toward its field:
  - *flow*: the brightness under it is a heading (black points right; Turns = full rotations from black to white), so particles stream along the picture's contours;
  - *climb* / *descend*: uphill toward light or downhill toward dark, collecting on highlights or in shadows. Flat areas have no slope: *wander* keeps them drifting on the noise field, *settle* lets them slow and freeze into the patterns along edges;
  - *noise*: an evolving flow field that ignores the picture (swirl size, evolve);
  - *none*: only the attractor moves them.
  An **attractor** (the mouse over the picture, or a null) can gravitate, spiral or repel, and catches particles that reach it. Particles are **born** anywhere, at the edges, in the centre or at a null; at the **edges** they wrap, bounce or respawn; a **life** respawns them after a few seconds. **Look**: dot, square, triangle, streak, ring, star or an uploaded PNG/JPG/SVG sprite (square crop optional), facing their motion, spinning or upright; colour from a tint, the picture, or one of ten cosine palettes (a + b·cos(2π(c·t + d))) picked by heading, speed, age or brightness. **Size and opacity can follow** brightness, speed, age or nearness to a null (particles grow near the null). Every number is a control target. **Mask** turns them into a stencil: they show the picture instead of a colour.
- **Picture: Shown / Layers only** (`display` in the record). Layers only covers the shader with a backdrop colour; it keeps rendering underneath, so a Reveal matte shows it inside text or images and masked particles show it where they are.
- **Help.** Every built-in field has a tooltip. Controls show the param's hint from its node definition and the comment written on the node in the graph (the ⓘ next to the label).

## On a website

The code button on the Play page opens **Put it on a website**. Two modes: a **player** (picture + controls) or a **background** (the picture only, filling the section it is pasted into, or the whole page behind everything; it never takes clicks or keys from the page, pauses off-screen and in hidden tabs, and shows a still frame for reduced motion). Two outputs: a **snippet** (`<div>` + `<script>`) for any page or site builder, or a **page** to host or iframe (`?mode=background` turns a page into the background). Several embeds can share one page; the runtime installs once. The dialog's right half is a **live preview**: the real snippet running on a mock landing page, blog post or portfolio (`src/play/mockSites.ts`), placed where the options say, at desktop or phone width.

Each export writes one self-contained file: the compiled fragment shader on a WebGL quad, the uniform values as they are, the controls panel, the mapping engine and the layers, in about 65 KB plus any images. It runs on any site or in a CodePen. MIDI, live audio, OSC and phone motion sit behind Enable buttons in the player because browsers require a gesture. It cannot run image, video or audio inputs, MIDI Input node outputs, previous-frame feedback, echo or GPU particle systems; the export names what a graph uses.

---

## Set lists and the pop-out window (after V1)

Several instruments switched by key or program change with a crossfade, and a second-monitor preview window in Tauri. Both sit on top of the bus and the per-graph `play` record.
