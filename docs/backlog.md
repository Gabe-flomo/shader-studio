# Backlog: ideas and the recommended order

Collected from the owner's notes on 27 September 2026. Each item is planned, not built, unless it says otherwise. The order is the recommended one; items close together can run in parallel.

## Order

1. **Finish what's paused:** p5.js import with multi-file scripts and a Console; the pop-out node pack builder (including `.playfile` carrying videos).
2. **Finish stack follow-ups:** custom effects from a graph (the Picture node and Publish as Finish effect), multi-pass custom effects, shader HDR for halation and bloom.
3. **Files page:** a Notes section; tidy the settings entries.
4. **Actions and controls:** condition triggers, "send a signal" actions, pair/position controls, axis swap.
5. **MIDI:** knob lock, key-press note ranges, grid controllers (Push, Launchpad).
6. **Audio:** built-in effects → a drum pad sampler layer → Audio Unit hosting → VST3 hosting.
7. **Older open items:** a pop-out Present/Stage window, GPU recovery on Present/Stage, undo for Play, live sliders inside 3D groups.
8. **Waiting on the owner:** the licence service, payments and hosting (see `accounts-and-plans.md`), encrypted Pro code, the paper texture image.

## Finish stack follow-ups

Done: the animatable before/after wipe (`finish.compare`), stack presets, and custom effects from a snippet (Your effects, node packs, sealing, exports). See `finish-stack.md`.

- **Custom effects from a graph.** A **Picture** source node (the finished frame) wired through any nodes, then **Publish as Finish effect**: the compiled graph becomes an ordinary custom effect (its exposed sliders its settings). The conversion is written up in `finish-stack.md`, "From a graph (next step)".
- **Multi-pass custom effects** (their own blurs, feedback).
- **Shader HDR for halation and bloom.** Feed the shader's picture from before tone mapping into the stack.

## Files page

- **Notes section:** every note, grouped by where it lives (Play notes per graph; node comments per graph). Each shows a preview, its owner, a date and **Go to**. Stats: the most-commented nodes and graphs, notes per graph, and nodes with or without comments. Search, filter and sort.
- **Settings:** take raw preference keys out of the main tree. If shown, use an **App settings** group with readable names and **Reset to default**. They stay in profile ZIPs and backups.

## Actions and controls

- **Condition triggers on any value:** when a layer property, control, source or distance (shape↔null, shape↔shape, layer↔screen point) is below, above, equal to (within a tolerance) or crosses a number. This generalises the proximity triggers, with the same firing modes and hysteresis.
- **"Send a signal" action:** instead of changing a property, emit a named signal. Other actions and mappings can trigger on "when signal X fires", which chains conditions. Signals appear in Learn and the source picker.
- **Pair controls:** right-click any value → **Pair with…** / **Add as position with Y** to make a two-value control (x,y, or any two values such as radius and glow). It keeps a slider per value, disabled while mapped, and shows an XY pad for positions. Layers and graphs still see plain values.
- **Pair mappings:** Affect A / Affect B / Affect both, with per-axis range, curve, smoothing and an optional per-axis condition. Position sources include the mouse, a null, a hand point, a grid pad and a layer centre. A position condition: "when A is within d of B".
- **Axis swap:** while driving A, switch to B when A crosses a swap threshold; a separate swap-back threshold returns it. It resets on rewind and can send a signal on each swap.

## MIDI

- **Knob lock:** touch a knob; it shows as the active input; **Lock** binds that CC and channel to the mapping. Several knobs can be locked.
- **Note range:** press a key for the low end and another for the high end. Only notes inside the range count; **Reset to full range** undoes it.
- **Grid controllers (Push, Launchpad):** read the pad's column and row (known layouts, or "learn the grid" by tapping corners) plus velocity and pressure. An offset and scale line the pads up with a grid shader's cells, so hitting a pad triggers or resizes the matching cell (a per-cell array or data texture). Later: light the pads back over MIDI out.

## Audio

- **Built-in effects** on the app's audio (audio layers, video sound, Audio Input songs, the MIDI synth), as an ordered chain:
  - reverb (room, hall, plate);
  - echo (feedback, ping-pong, tempo sync);
  - filter (low, high, band, with resonance);
  - distortion (soft, hard, fold, tube, bitcrush).
  Every parameter is mappable, and it applies in offline renders and website exports.
- **Drum pad sampler layer:** a grid of pads with banks, each holding a sample.
  - Per pad: start/end with a waveform view, loop points, one-shot or gate, reverse, pitch, volume and pan, ADSR, choke groups, and velocity to volume.
  - Triggers: clicks, keys, MIDI notes and grid pads, actions and signals, takes.
  - Effects: one chain for the whole sampler.
  - It feeds the audio readers and is mixed into renders. Samples live in the library and `.playfile`.
- **Plugin hosting (desktop only):**
  - Audio Units first (AVAudioEngine and AVAudioUnit), then VST3 (check the SDK licence).
  - List parameters as mapping targets and open the plugin's own window.
  - Needs a native audio engine, the disable-library-validation entitlement, matching chip builds, and ideally plugins running out of process.
