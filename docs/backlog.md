# Backlog: ideas and the recommended order

Collected from the owner's notes on 27 September 2026. Each item is planned, not built, unless it says otherwise. The order is the recommended one; items close together can run in parallel.

## Order

1. **Finish what's paused:** p5.js import with multi-file scripts and a Console; the pop-out node pack builder (including `.play` carrying videos).
2. **Finish stack follow-ups:** multi-pass custom effects, shader HDR for halation and bloom. (Custom effects from a graph is skipped for now: see Later / skipped.)
3. **Files page:** a Notes section; tidy the settings entries.
4. **Actions and controls:** done (condition triggers, signals, pair controls, axis swap); what's left is under its heading.
5. **MIDI:** knob lock, key-press note ranges, grid controllers (Push, Launchpad).
6. **Audio:** built-in effects → a drum pad sampler layer → Audio Unit hosting → VST3 hosting.
7. **Older open items:** the pop-out window is built as the output window (`projection.md`: a projector or second display, projection mapping, the Stage's Present canvas on it); left: test it on real projectors, a camera of its own for Camera layers there. GPU recovery on Present/Stage, undo for Play, live sliders inside 3D groups.
8. **Waiting on the owner:** the licence service, payments and hosting (see `accounts-and-plans.md`), encrypted Pro code, the paper texture image.

## Finish stack follow-ups

Done: the animatable before/after wipe (`finish.compare`), stack presets, and custom effects from a snippet (Your effects, node packs, sealing, exports). See `finish-stack.md`.

- **Multi-pass custom effects** (their own blurs, feedback).
- **Shader HDR for halation and bloom.** Feed the shader's picture from before tone mapping into the stack.

## Files page

- **Notes section:** every note, grouped by where it lives (Play notes per graph; node comments per graph). Each shows a preview, its owner, a date and **Go to**. Stats: the most-commented nodes and graphs, notes per graph, and nodes with or without comments. Search, filter and sort.
- **Settings:** take raw preference keys out of the main tree. If shown, use an **App settings** group with readable names and **Reset to default**. They stay in profile ZIPs and backups.

## Actions and controls

Done: condition triggers on any value ("When a value…", proximity is its distance case), "Send a signal" actions and "When a signal fires" triggers (in Learn and the source picker, with a loop guard), pair controls (Pair with…, Add as position, the XY pad), pair mappings (position or one source, Affect A / B / both, per-axis range, curve, smoothing and condition) and axis swap, in takes, renders and website exports. See `conditions-and-signals.md`.

- **A grid pad as a position source** (with the MIDI grid controllers below).
- **The XY pad on the Stage and in the website player's panel** (both show a pair's two sliders for now).

## MIDI

Built: knob lock, note ranges and the pad grid (Push, Launchpad, learned grids; the Pad Grid node; lighting the pads over Web MIDI out). See `midi.md`. Still to do: the desktop app's native MIDI bridge (WKWebView has no Web MIDI).

- **Knob lock:** touch a knob; it shows as the active input; **Lock** binds that CC and channel to the mapping. Several knobs can be locked.
- **Note range:** press a key for the low end and another for the high end. Only notes inside the range count; **Reset to full range** undoes it.
- **Grid controllers (Push, Launchpad):** read the pad's column and row (known layouts, or "learn the grid" by tapping corners) plus velocity and pressure. An offset and scale line the pads up with a grid shader's cells, so hitting a pad triggers or resizes the matching cell (a per-cell array or data texture). Later: light the pads back over MIDI out.

## Audio

Built: effect chains (filter, echo, reverb, distortion, compressor) on each sound and the master bus, mappable, in renders and website exports. See `audio-effects.md`. Still to do: the rest of this section.

- **Built-in effects** on the app's audio (audio layers, video sound, Audio Input songs, the MIDI synth), as an ordered chain:
  - reverb (room, hall, plate);
  - echo (feedback, ping-pong, tempo sync);
  - filter (low, high, band, with resonance);
  - distortion (soft, hard, fold, tube, bitcrush).
  Every parameter is mappable, and it applies in offline renders and website exports.
- **Drum pad sampler layer:** shipped (docs/drum-pads.md). Follow-ups:
  - Banks (A/B), a Sounds tab in the Library, pad samples in presentations, the pad grid on websites.
  - Slicing, time-stretch, and filter or pitch envelopes per pad.
- **Plugin hosting (desktop only):** Audio Units shipped in the Audio engine (docs/audio-engine.md). Follow-ups are listed there: web sounds through AU effects, the engine's sound in recordings and renders, VST3.

## Nodes infer their types (asked 22 October 2026)

Not built. Math nodes that work on any type should take whatever is wired in and work out their output type, without picking a type on the card or using a special node. For example, Multiply should take a colour × a float, or a vec2 × a float, straight away.

**Today:** the vectorizable nodes (`VECTORIZABLE_NODES` in `nodes/definitions/math.ts`: Add, Subtract, Multiply, Divide, Mix, Sin, Pow, Floor, Smoothstep…) have one type for the whole node, `params.outputType`, set with the float / vec2 / vec3 pills (`changeNodeVectorType`). Both operands follow it. The only automatic switch is dropping the node onto an existing wire (`insertIntoWire` → `genTypeFor`, `components/NodeGraph/wireFit.ts`). A plain connect still checks against the socket's current type (`lib/typesCompatible.ts`), so a vec3 colour into a float Multiply's A is refused. There is no vec4 pill.

**The rule (GLSL's own):** the output takes the widest type wired in, the one with the most components. Each other input is promoted to it the way `coerce()` already does. A float broadcasts (`vec3(x)`), which is exactly `colour * 0.5`. vec2 into a vec3 node pads with 0, and vec3 → vec4 adds alpha 1. Inputs that aren't wired (sliders) broadcast too.

**Plan:**
1. **Auto as the default type.** The pills gain **Auto**, the default for new nodes. The node's type is worked out from its wires on every connect and disconnect, then written to `outputType` and the socket types (the same path as the pills). The compiler and saved graphs therefore don't change. Picking float / vec2 / vec3 / vec4 locks the type, as today.
2. **Any type can land on an Auto input.** In Auto, the wire-drop highlight and `connectNodes` accept any of float…vec4 on the node's operand sockets. The node then re-infers its type.
3. **Downstream follows.** When a node's output type changes, the nodes it feeds re-infer in turn, in graph order (bounded, so a loop can't spin).
   - A fixed input downstream that can't take the new type is shown on the wire as a mismatch. It is never dropped silently.
   - The fix offered is to lock the upstream type or to add a Swizzle.
4. **Disconnecting** narrows the node back to the widest type still wired in, or float with nothing wired.
5. **Add vec4** to the vectorizable arithmetic nodes, so colours with alpha work too.
6. **Rules that aren't "widest wins":** Dot and Length always output a float. Mix's T and Smoothstep's edges may be a float or the node's type. Pow keeps broadcasting a float exponent. Each of these needs its inference spelled out per node, not the general rule.
7. **The GLSL → nodes converter and the examples** keep their explicit (locked) types, so nothing that exists today changes what it renders.

**Open question:** should a vec2 and a vec3 wired into the same node widen to vec3 (pad), or be refused? GLSL refuses this. Widening is friendlier but can hide a mistake. The suggested answer is to widen and mark the wire, as the vec2 → vec3 promotion already does on a single wire.

## Later / skipped

Skipped for now by the owner (27 September 2026). The write-up stays for when it comes back.

- **Custom effects from a graph.** A **Picture** source node (the finished frame) wired through any nodes, then **Publish as Finish effect**: the compiled graph becomes an ordinary custom effect (its exposed sliders its settings). The conversion is written up in `finish-stack.md`, "From a graph (next step)".

## Playfield as a DAW plugin (later)

Asked 28 September 2026. A lighter Playfield packaged as an Audio Unit, VST3 and CLAP instrument/effect for Ableton and other DAWs.

- **What the DAW sends in directly:** the track's audio (for the readers), MIDI notes and CCs, tempo and transport (the picture's clock follows the song, including scrubbing and loops), and automation lanes for any control. No virtual cables or OSC.
- **What it drops:** the app's own audio effects and Audio engine (the DAW has those), Convert, the Files page. It keeps Play, layers, mappings and the Finish stack, and opens `.play` Plays as presets.
- **Where the picture goes:** the plugin window, an output window on a second display or projector, and Syphon (Mac) or NDI so Resolume, OBS or a video track can take the feed.
- **How:** a native plugin shell (JUCE, or Rust `nih-plug`) embedding a web view that runs the existing website runtime (`play-runtime.js`), so there is one codebase. Costs: a second product to sign and ship, DAW quirks, a web view inside a plugin window on each platform, and its own licence check.
- **When:** after the Audio engine settles and the licence work is done.

## The Files page as a home (asked 28 September 2026)

Make Files data-driven and discoverable. Inspiration: dashboard layouts with a greeting card, stat tiles with small charts, card grids and a calendar (the owner sent four references).

- **Overview first.** Files opens on a home view:
  - **Activity:** saves, renders, takes and imports over the last week or month as small charts and totals ("14 saves this week"), with the calendar days that had activity.
  - **Recent:** a carousel of rendered thumbnails of recent Plays, graphs and GLSL files (posters already exist for examples; render or cache posters for saved work), each opening the item.
  - **Most used:** nodes, functions, layer kinds and node patterns you use most.
  - The tree, Notes, Clean up, Workspace and App settings stay as sections beside it.
- **Pattern discovery (idea only for now; the owner asked to hold it).** Find recurring node patterns (common links such as UV → Circle SDF → SDF Glow, and uncommon ones) across a **scope you choose**: your saved graphs, a folder, your groups, the examples, imported graphs, or GLSL files (converted in the background when the converter succeeds). Show patterns as small graph cards with counts, "where it appears", and one-click actions: insert the pattern, make it a group, save it as a preset. Rank by frequency and by rarity.
- **Item pages.** Opening a function, graph, node or preset in Files shows a compact page: the code (folded, small), a live output preview, its controls (tweakable on the page, updating the preview), where it's used, notes and credits, and actions (open, export, duplicate, delete).
- **Node pages.** For a node: what it does, its inputs and outputs with hints, a live visual chosen by type (a plot for float functions like the Function Builder, a field/grid or arrows for vectors, a colour swatch for colours), example graphs that use it, and "insert into the current graph".
