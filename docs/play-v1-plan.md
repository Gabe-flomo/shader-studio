# Shader Studio Play — the V1 plan

*Written 24 Sep 2026. This is the explainer version: what we are building, why it fits the app we already have, and the order we build it in.*

---

## Where it stands

- **Step 1, the input bus: done.** It also carries Play's param writes (`param:nodeId::key`, resolved through the compiler's binding map), tells the render loop when a value actually moved, and wakes a sleeping loop when an input arrives.
- **Step 2, the MIDI Input node: done.** Web MIDI plus the QWERTY stand-in. The Tauri/macOS bridge (`midir`) is still to do.
- **Step 3, the Play page: done** (`src/components/play/PlayPage.tsx`, `src/lib/playEngine.ts`, `src/play/`). Controls from the candidate list (floats and colours), a mappings drawer with range, curve, smoothing and colour channel, collapsible rows, Learn. Bool toggles are not offered: a `bool` param bakes into the shader, so it can't be a live control.
- **Play files.** There is no second file. A graph carries its Play setup under the top-level `play` key, so Save in the top bar, Export, Import and the saved-graphs list all keep the panel and the mappings with the graph. Open a saved graph, go to the Play tab, and the setup is there. "Export play file" on the Play page writes the same graph with a `kind` marker (so importing it opens on Play) and with driven controls baked at their live value, so it opens looking exactly as the picture did.
- **Layers: done.** Twelve kinds drawn over the picture by one shared layer kit (`src/play/kit/`, `src/play/particle-sim.js`) that the app (`src/play/overlay.ts`) and web exports both run; types and file schema in `src/types/playLayers.ts`, editors in `src/components/play/layers/`. Zones, actions, sensors and the graph's Layers node tie them to everything else; see the Layers section below.
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

**One kit, two hosts.** Everything a layer does is in `src/play/kit/` (geometry, drawing, bodies, the frame orchestrator) and `src/play/particle-sim.js`, as plain JS. The app's overlay and the web runtime are thin hosts that hand the kit the pointer, live audio, the camera and images each frame; the exporter inlines the kit into the page. Every layer kind is described once in `src/types/playLayers.ts`: its interface, its defaults, and a schema that checks a file's values (a bad or missing value falls back to the default, so old and hand-edited files load).

The kinds:

- **Null.** A point to drag or animate. Its X and Y are a mapping source, and every number on every layer can be made a control (the + beside it). A null can **follow** the mouse or another null on a spring (Spring, Wobble), and can take a **particle role**: emitter, absorber, attract, repel or vortex.
- **Text, image, camera.** *Over* the picture with a blend mode, *reveal* (the picture inside the shape) or *luma* (the picture's brightness as alpha). Text can be a **sequence**: one line at a time, stepped by a Next action or every few seconds, arriving with a cut, fade, rise or typewriter. The camera layer is the webcam; its motion is a sensor, and particles, glyphs and contours can read it instead of the shader.
- **Particles** (`particle-sim.js`, after the author's p5 system). Each particle's velocity *steers* toward a field:
  - *flow*: brightness is a heading (Turns full rotations from black to white, plus Direction). At Turns 1, black and white point the same way and mid grey the opposite, so particles skate along bright shapes and never get inside: the edge is a one-way valve;
  - *climb* / *descend*: uphill or downhill in brightness; on flat areas they *wander* on noise or *settle* and freeze into edge patterns;
  - *noise*: an evolving flow field; *none*: only forces.
  On top: an attractor (mouse, mouse while pressed, or a null; gravitate, spiral, repel), **flocking** (alignment, cohesion, and separation inside a *personal space*, summed so a crowd pushes harder than one neighbour: flocks stay loose instead of collapsing into dots), collisions, zones, and null roles. Particles are born anywhere, at the edges, the centre, a null or an emitter; wrap, bounce, respawn or reappear at a *random* spot at the edges; live for a Life with birth and death fades; or exist only in **bursts** fired by an action. A seed makes a run repeatable. Look: dot, square, triangle, streak, ring, star or a PNG/SVG sprite (tintable); colour from a tint, the picture or ten cosine palettes; size and opacity can follow brightness, speed, age or nearness to a null; **links** join near neighbours (plexus); **mask** shows the picture through them; trails fade by time, so they are the same length at any frame rate.
- **Shape.** Box, circle, line, a drawn polygon or freehand lasso, a text or image layer's shape, or the bright parts of the picture. It can be seen (fill, outline with animatable Trim), be an invisible **zone**, or both. Zone actions: wall (slide or bounce), container, attract, repel, sink, portal (out of another shape), emitter (born inside, pushed out), absorber (pulled straight in and swallowed; reborn at an emitter, so an emitter and an absorber draw field lines), wind, vortex (with *Tilt*: the swirl leans back like a disc seen side-on, orbits become ellipses and particles grow on the near side), drag, tint, resize, sensor. Zones are signed distance functions (`kit/geometry.js`); layer and picture shapes become distance grids by a chamfer transform.
- **Bodies.** Letters of a word, circles or boxes that fall with gravity (angle and strength are controls), bounce, stack, and land on walls, brush strokes and (optionally) the bright parts of the picture.
- **Brush.** Paint by dragging, hovering or with a moving null; strokes fade and can be walls.
- **Audio.** The live input, or a song loaded into the layer (session only; it plays through the master volume), as a waveform, spectrum bars, a ring, a blob or a scrolling spectrogram.
- **Glyphs.** The picture, the camera or *another layer* (particles, text, strokes: glyph layers can stack) as ASCII, halftone dots, squares, lines or crosses. The ramp can be emoji (split by grapheme, drawn in their own colours with Colour → Own); Offset shuffles cells through the ramp, Spread gives each cell its own stray.
- **Contours.** Topographic lines through the picture's brightness, drifting with Flow.
- **Lens.** A circle that magnifies, pixelates, blurs, inverts, desaturates or mirrors what is under it; it can follow the mouse or a null.

**Text fonts** can come from the web: a Google Fonts link (the css2 link, the pasted `<link>`, the font's page), a family name, or a .woff2/.ttf URL. Nothing else is fetched.

**Editing.** Each editor is foldable sections (folds are remembered per layer kind); Flocking, a text Sequence and a shape's Look have their switch in the heading. Double-click a ruler to reset it; a layer's ⋯ menu duplicates, resets to defaults or deletes; wherever a layer can use a null, *+ New null here* makes one. With the Layers tab open, click a layer on the picture to select it; the selected one gets handles (drag a corner to resize from the opposite side, Shift keeps the shape, Alt keeps the centre, the knob turns it, Shift snaps to 15°). Right-click a layer for the same menu plus quick actions. **Show field** on a particles layer draws its field (grey arrows) and the pull of the attractor and force zones (orange), while editing only.

**Layers talk back.** Sensors are mapping sources: a shape's *fill* (how crowded with particles it is) and *hover*, particles' *speed* and *spread*, the camera's *motion*, and the *distance* between two nulls. Shapes are triggers: *click*, pointer *enters*, particles *fill* it past a level (on a website too). **Actions** fire on any trigger (key, click, beat, audio hit, MIDI note, OSC, shape): burst, scatter, reset or freeze particles, next / previous / random line, drop bodies again, clear the brush, show / hide / toggle any layer.

**The Layers node** (Sources → Layers) is the other direction: what the layers draw becomes a texture the shader reads (Color, Alpha) plus a signed **Distance** to them in UV units, so SDF Glow makes particles, text and strokes glow, and anything a texture can feed works. It reads the previous frame. Each layer's "Seen by the Layers node" switch chooses what it sees; the app binds it in `src/play/layersTexture.ts`, the web runtime binds it too.

- **Picture: Shown / Layers only** (`display` in the record). Layers only covers the shader with a backdrop colour; it keeps rendering underneath, so a Reveal matte shows it inside text or images and masked particles show it where they are.
- **Help.** Every built-in field has a tooltip. Controls show the param's hint from its node definition and the comment written on the node in the graph (the ⓘ next to the label).
- **Recording.** Videos (both paths) and screenshots include the layers.
- **Examples**: see *The Play folder* below. Particle Glow, Flow Around Words and Letter Drop are its last three: bigger pieces that combine several techniques.

## The Play folder and notes

The first folder in Examples is **Play**: one small example per technique, numbered in learning order (01 Controls from the graph … 46 Glowing text and strokes, then the three combined pieces, 49 in all). Each one is a simple graph (a glowing circle, an FBM landscape, or UV → Layers → SDF Glow) with a Play setup that shows one idea and nothing else. The order runs controls and mappings → sources (keys, triggers, beats, live audio, MIDI, OSC, tilt) → nulls → the non-particle layers → particles → zones and sensors → the Layers node.

- **Notes** (`PlayRecord.notes`): plain text shown in a card at the top of the Play page. A blank line starts a paragraph, a line starting with `• ` is a bullet and `**bold**` is bold. Drag a layer (its heading) or a control (its grip) onto the card to link it: `[[layer:<id>]]` shows as a chip with the current name, and clicking it opens that layer or flashes that control. The card grows into a page of its own with the expand button. Every Play example's notes have the same three parts: *What it shows*, *How it's built*, *Try this*. Anyone can write notes on their own setup (the speech-bubble button in the Controls header, or the pencil on the card). They travel with the graph and in play files, so a setup made for teaching carries its own explanation.
- **Where things live**: `src/store/playExampleIndex.ts` has the names, descriptions and order (light, so the examples browser can list them without loading the graphs); `src/store/playExamples.ts` builds the records from small helpers, so each one is exactly what the parser produces. The examples test checks that the folder comes first, the numbers match the order, every record parses without loss and has notes, and every control points at a live param or layer.

## Controls

Add control lists the graph's live params and, in a folder per layer, every layer number. A control named after its layer follows the layer's renames. The chevron on a control (or a tap on the card) opens its details: where it comes from with **Go to layer** / **Show in graph** (the Studio opens centred on the node), the hint and node note, the range, and what drives it.

The panel is S, M or L wide; the picture's shape is the row of little frames in the preview header.

MIDI inside another site's frame (a preview on claude.ai, for example) is blocked by that site; the app now says so instead of showing nothing.

## On a website

The code button on the Play page opens **Put it on a website**. Two modes: a **player** (picture + controls) or a **background** (the picture only, filling the section it is pasted into, or the whole page behind everything; it never takes clicks or keys from the page, pauses off-screen and in hidden tabs, and shows a still frame for reduced motion). Two outputs: a **snippet** (`<div>` + `<script>`) for any page or site builder, or a **page** to host or iframe (`?mode=background` turns a page into the background). Several embeds can share one page; the runtime installs once. The dialog's right half is a **live preview**: the real snippet running on a mock landing page, blog post or portfolio (`src/play/mockSites.ts`), placed where the options say, at desktop or phone width.

Each export writes one self-contained file: the compiled fragment shader on a WebGL quad, the uniform values as they are, the controls panel, the mapping engine and the layers, in about 65 KB plus any images. It runs on any site or in a CodePen. MIDI, live audio, OSC and phone motion sit behind Enable buttons in the player because browsers require a gesture. It cannot run image, video or audio inputs, MIDI Input node outputs, previous-frame feedback, echo or GPU particle systems; the export names what a graph uses.

---

## Set lists and the pop-out window (after V1)

Several instruments switched by key or program change with a crossfade, and a second-monitor preview window in Tauri. Both sit on top of the bus and the per-graph `play` record.
