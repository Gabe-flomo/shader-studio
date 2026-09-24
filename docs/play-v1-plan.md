# Shader Studio Play — the V1 plan

*Written 24 Sep 2026. This is the explainer version: what we are building, why it fits the app we already have, and the order we build it in.*

---

## Where it stands

- **Step 1, the input bus: done.** It also carries Play's param writes now (`param:nodeId::key`, resolved through the compiler's binding map), tells the render loop when a value actually moved, and wakes a sleeping loop when an input arrives.
- **Step 2, the MIDI Input node: done.** Web MIDI plus the QWERTY stand-in. The Tauri/macOS bridge (`midir`) is still to do.
- **Step 3, the Play page: done** (`src/components/play/PlayPage.tsx`, `src/lib/playEngine.ts`, `src/play/`). Controls from the candidate list (floats and colours), a mappings drawer with range, curve, smoothing and colour channel, Learn for MIDI and keys, mouse and key sources. Saved under the graph's `play` key. Bool toggles are not offered: a `bool` param bakes into the shader, so it can't be a live control.
- **Steps 4 and 5: not started.**

---

## The one-sentence version

**Studio is where you build the instrument. Play is where you perform it.**

In Studio you wire nodes together and get a picture. In Play the node canvas goes away. You see the picture, a panel of the knobs you chose to expose, and your inputs (mouse, keyboard, MIDI, audio) mapped onto those knobs. Nothing you do in Play can break the graph, because Play never edits the graph. It only turns knobs.

---

## Why this is cheaper than it sounds

Three things in the app already do most of the work.

**1. Sliders are already "live".**
When you drag a slider in Studio, the app does not rebuild the shader. Any float or colour param compiles to a *uniform*, a variable the GPU reads every frame. Dragging just writes a new number into it. There is even a store method that writes a uniform with no undo entry and no recompile. That method is the whole mapping engine: a MIDI knob turning is a uniform write, nothing more.

The catch: not every param is a uniform. Integer steppers, "compile time" params, hidden params, and params with keyframes get baked into the shader as constants. Those cannot be Play controls. The panel will simply not offer them.

**2. The publish dialog already asks "which sliders do you want to expose?"**
When you publish a node, the dialog lists every eligible slider in the graph with a label, min, max and default. That list *is* Play's control panel definition. We reuse the same record and the same collector.

**3. The Audio Input node already turns an outside signal into floats.**
Audio comes in, gets split into bands, and each band becomes a float uniform written every frame. MIDI is the same shape: notes, velocity and knobs in, floats out. The MIDI Input node copies that pattern.

---

## The pieces, in the order we build them

### Step 1. An input bus (the plumbing)

Today the render loop hand-wires each outside signal: one block for audio, one for video, one for scopes. Adding MIDI the same way would be a fourth special case.

Instead we add one small module, the **input bus**. Every frame the render loop asks it "what uniform values do you have?" and writes them. Audio, MIDI, mouse, keyboard and envelopes all feed the bus. The render loop only knows about the bus.

Rules the bus follows:
- No allocations per frame. It reuses one result map.
- It resolves uniform names through the compiler's name map, so renaming or slugging a node never breaks a binding. (This is exactly the bug that currently breaks audio, and the bus fixes it by construction.)
- It is a plain module with no React and no store subscription, like the audio engine.

### Step 2. The MIDI Input node

A Sources node. In Studio it is just another float source you wire into anything.

Outputs:
- **note** — last note number, scaled 0 to 1
- **velocity** — how hard the last note was hit, 0 to 1
- **gate** — 1 while any key is held, 0 otherwise
- **pitch bend** — minus 1 to 1
- **CC 1..N** — one float per control-change number you add on the card, like audio bands

Params: MIDI channel (or all), smoothing time, and the list of CC numbers.

Where the MIDI comes from:
- **Web MIDI** in Chrome and Edge. Works in the browser build straight away.
- **Computer keyboard stand-in.** Two octaves on the QWERTY rows, so Safari, Firefox and phones get the same node with no hardware. It is also how you test without a controller.
- **Tauri on macOS needs a native bridge.** The desktop app renders in WebKit, which has no Web MIDI. A small Rust plugin using the `midir` crate forwards MIDI messages as events. This lands as its own step so it does not block the rest.

The node itself does not care which source it is. There is one MIDI source interface with three backends.

### Step 3. The Play page

A new top-level page next to Studio. Desktop keeps the studio container mounted underneath (the way the GLSL page does), so the preview canvas and its clock are shared, not remounted.

On the page:
- **The picture**, filling most of the screen.
- **The control panel**: the exposed params as sliders, colour pads and toggles, in the order the author arranged them.
- **The mappings drawer**: one row per binding. Source on the left, target param on the right, and in between the range, the curve, and smoothing.
- **Learn**: press it, move a knob or hit a key, and that becomes the source.

Saved per graph. The graph file gets one new top-level key, `play`, holding the exposed params, their layout, and the mappings. Save, load, export and import all need to carry it, because today they drop any key they do not recognise.

### Step 4. MIDI processing: triggers, velocity, envelopes, note-to-value

This is the Max for Live flavoured part. A mapping row is **source → processors → target**.

**Triggers.** Instead of streaming a value, a trigger row watches one note number and fires an action when it is pressed: pulse a param, toggle it, set it to a value, or fire an envelope. "If this key is pressed, do this."

**Velocity sensitivity.** Velocity is its own source with its own curve. A note can drive brightness by how hard it was hit, or set how tall an envelope peaks.

**Notes as values, then functions.** A note number is just a float once it is scaled. In Studio you can already run it through sine, smoothstep, or any math node. In Play the mapping row offers a short processor list: range, curve (linear, exponential, log), smoothing (attack and release), quantise to a scale, hold or latch, and a shaping function.

**Envelopes.** The keyframe system bakes curves into the shader as a function of global time, so it cannot be "started" by a key press. Envelopes therefore run on the CPU: note on starts an attack-and-release curve (or a saved keyframe preset) relative to the moment of the press, and the bus writes the result as a uniform each frame. Retrigger and a few voices come with that.

### Step 5. MIDI files and offline export

A Standard MIDI File parser is small and needs no dependency. A loaded file plays through the same bus on the graph's clock. Because the events are pinned to time, the visual is deterministic, and that is what lets the offline ffmpeg renderer produce a frame-perfect export of a MIDI-driven piece. Live performances record through the browser recorder, which captures the live canvas.

---

## What is out of V1

- **Effects rack**: chaining published colour-in, colour-out nodes after the output without opening Studio.
- **Set lists**: several instruments, switched by key or program change, with a crossfade.
- **Pop-out preview window** for a second monitor.

These are all designed to sit on top of the bus and the per-graph `play` record, so nothing in V1 has to be undone for them.

---

## Decisions already made

- Exposed controls come from the publish dialog's candidate list, and any Studio slider can also be pinned into Play. Both produce the same record.
- The instrument is stored per graph for V1. Set lists will reference graphs later.
- Play is a page in the same window. The pop-out window is a later Tauri feature.
- MIDI transport is an interface with backends. The node and the mappings never talk to Web MIDI directly.
