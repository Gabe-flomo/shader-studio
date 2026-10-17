# Audio tools in the graph — plan

Audio-reactive pictures built in the node graph, without the Play page. Replaces the Audio Input node
(a file with per-band floats), which is retired: hidden from the node list and search, while saved graphs
that use it still load and run.

## Data flow

```
Audio Source ──audio wire──▶ Band level / Hit / Spectrum / Spectrogram / Waveform ──floats, textures──▶ the picture
     │
     └── lib/audioEngine (a file, played within its trim) or lib/liveAudio (microphone / audio input)
                │
     lib/audioTools/engine.ts: one probe AnalyserNode per source (FFT 2048, no smoothing),
     read once per rendered frame on the CPU (lib/audioTools/dsp.ts, pure and unit-tested)
```

- The `audio` socket type carries no GLSL: it only says which source an analysis node listens to. Only
  the Audio nodes take it (no promotions), so it can't be wired into a number by mistake.
- Floats (Level, Time, Band level's Level / Peak, Hit's Trigger / Envelope / Count / Strength) are live
  uniforms (`u_aud_<slug>_<channel>`), written each frame through the input bus (lib/inputBus.ts) like MIDI Input's.
- Spectrum, Spectrogram and Waveform are small 8-bit RGBA textures (`u_tex_<slug>`, with a `_px` define so
  Sample (texture) can read them), filled on the CPU and bound through the store's node textures, as Blob Track does.
- Hit's Trigger is 1 for exactly one rendered frame per hit: a rising edge above 0.5, which is what Envelope
  (Trigger mode), Counter and Sample & Hold count. So Hit → Envelope / Counter needs no extra node.

## Phase 1 — Listen + trigger (built)

| Node | In | Out |
|---|---|---|
| Audio Source | — | Audio, Level (RMS 0–1), Time (s) |
| Band level | Audio | Level, Peak |
| Hit | Audio | Trigger, Envelope, Count, Strength |
| Spectrum | Audio, UV | Value (at this pixel's x), Texture (bins × 1) |
| Spectrogram | Audio, UV | Value (frequency across, time down), Texture (bins × history) |
| Waveform | Audio, UV | Value (−1…1 at this x), Texture (samples × 1) |

Audio Source plays a file or listens to the microphone / an audio interface. (Phase 1 also had a built-in
test loop; it was removed in the Audio Source redesign below.)

Examples: an "Audio" folder of four commented graphs (kick ring pulse, spectrum bars, spectrogram waterfall,
waveform line). They open on the File tab, empty: load a sound or switch to Mic.

## Audio Source redesign (built)

- **Tabs** File | Mic | Video on the card (as the Texture node's), no Source dropdown.
  The `source` param is `file`, `mic` or `video`; a saved `loop` opens as `file` (retypeAudioSource, run on load).
- **Card readout**: a 48-bin log spectrum with the bands' ranges under it, plus a thin level meter.
- **Open ↗ window** (components/audio/AudioSourceWindow.tsx): the file's waveform (audioEngine.peaks, decoded
  once) with In / Out trim handles (params `trimIn` / `trimOut`, seconds; Out 0 = the end); playback loops inside
  the trim (AudioBufferSourceNode loopStart / loopEnd; audioEngine.position wraps inside it). Mic: a scrolling
  waveform. A live log spectrum labelled in Hz: drag to add a band, drag edges to move one; quick bands Sub, Bass,
  Kick, Snare, Hi-hat, Vocals, Air (Kick / Snare / Hi-hat as triggers with Hit's ranges and onset settings).
- **Bands** (`params.bands`, lib/audioTools/bands.ts): id, name, colour, Low / High Hz, Value (Attack, Release,
  Gain) and / or Trigger (Sensitivity, Cooldown). Each sends `u_aud_<slug>_<band>_v` / `_t` live uniforms written by
  the engine on the source's own analysis frame (the same path as Band level and Hit). The node's outputs follow
  the bands (`syncSockets`, the store's retype chain and graphBuilder); a removed output's wires are dropped.
- **No recompile while editing**: band ranges, their settings and the trim go through `updateNodeParams(…,
  { live: true })` (the engine reads params every frame); adding, removing, renaming a band or changing what it
  sends recompiles.
- The test loop's code is gone from the Audio nodes (lib/testLoop.ts stays: the Play page's Audio readers use it).

### Known gaps in Phase 1
- ~~Web export hears silence~~ (done, below: "On a web page").
- ~~A Video's sound as a source~~ (done, below: "The Video tab").
- ~~Audio nodes inside a group compile but hear nothing~~ (done): the engine walks every group's subgraph
  (lib/audioTools/graphWalk.ts), following an `audio` wire through group input and output ports to its source, and
  the compiler binds an inner node's live uniforms and texture to its original id (shaderAssembler registerAudioTool,
  at both group levels). Plain, iterated and nested groups. Agents groups: not done (their programs don't take live
  uniforms from inside); wire the numbers in from outside.
- ~~A loaded file isn't kept across reloads~~ (done, below: "Sounds kept in the library").
- Desktop app (WKWebView): the microphone path is untested there.
- Nice-to-haves not built: Loudness (LUFS-like), Centroid (brightness), Chroma (12 notes as three vec4s).

## Sounds kept in the library (built)
- A picked file goes into the media library's video store as an audio record (`addVideoFile`: drum pad samples live
  there too, lib/backgroundLibrary.ts), and the Audio Source keeps its id as `params.sampleId`. `sampleId` (not a new
  key) because playfile/bundle.ts `videoIdsIn` and lib/videoUsage.ts already follow `videoId` / `sampleId`, so a
  .playfield / .playfile carries the sound, and the library's usage counts see it, with no new code. It travels the way
  videos do (library ZIPs, backups, the workspace folder); the desktop path is untested.
- On `sync`, a File source with a `sampleId` and nothing open reads it back (`getVideo`) and loads it as if picked: the
  decoded waveform (audioEngine.peaks) and the web-export copy (mediaSources) come with it. Missing: the card says so.
- The card's **Library** popover lists the store's sounds (waveform thumbnail, length): Use, or ✕ (deleteVideo).

## The Video tab (built)
- `source: 'video'`, `params.videoNode`: a Video Input (the Texture node playing a video file) or a Baked node, at any
  depth. The engine finds its element (videoEngine.element / bakedVideos.element) and routes it once through a
  MediaElementSource (lib/videoSound.ts `mediaElementSourceOf`, one per element) → an inlet the probe reads → a gain
  joined to the speakers (audioEngine.connectOutside). The element is unmuted (after the page's first click when the
  browser wants one); leaving the tab, Play off or removing the source unplugs it and mutes it again (the video node
  plays muted). Time is the element's currentTime; a paused video reads silence. No trim: the video's own loop.
  Learn works from the last hit heard (as the Mic's).
- Not done: Video layers on the Play page as a source (they already feed Play's audio readers), the webcam's sound.

## On a web page (built)
- The per-frame sums moved to play/kit/audioTools.js (`at…` names): dsp.ts, bands.ts and learn.ts re-export them, the
  engine's tickInputs calls `atStepSource` / `atStepListener`, and the export inlines the same file (kit group
  `audioTools`, picked when the bundle has `media.audioTools`). So the page can't drift from the app.
- The store's webMedia adds `media.audioTools` (lib/audioTools/webExport.ts): each source (a File's data URL from
  mediaSources, a Video's sampler uniform, its bands, its learned sounds), each listening node's `listenerSpecOf`
  and texture size, and the uniforms (`u_aud_*` → `<id>::<channel>`) and samplers they fill. The Audio nodes'
  samplers no longer travel as blank images.
- runtime/play-runtime.js: one AudioContext; per source a probe analyser (FFT 2048, no smoothing); a File plays its
  decoded buffer looped inside the trim; a Video takes its page `<video>` through a MediaElementSource. Once a frame
  (`tickAudioTools`) the same gain, sums and texture uploads as the app. A player shows "Tap to start sound"; any
  click or key starts it; Pause suspends it. `handle.audioTools()` reads the values back (for checking a page).
- Left out: the Mic (play/exportScope.ts drops Mic sources and lists "The microphone and live audio", as for every
  other mic input; docs/web-export.md); a Video whose node isn't drawn (the page has no video for it); files over
  6 MB (listed).

## Phase 2 — Learn a sound (built)
Hit-by-example, in the Audio Source window (lib/audioTools/learn.ts, pure and tested on synthetic claps, stabs, kicks).

- **Fingerprint**: frames as the analyser sees them (FFT 2048; from a file, re-computed at 60 a second). The strongest
  onset in the selection (spectral flux over 40 log bands, 40 Hz – 16 kHz, each band counting the same); the frames of
  the next 50 ms give `spec` (mean band power in dB, floored 60 dB under its peak, centred, length 1: loudness-free)
  and `env` (4 loudness points across the window, relative to their peak).
- **Matching**: the same flux with Hit's adaptive threshold finds onsets live; 50 ms later the frames since make a
  fingerprint, and each learned sound scores 0.85 × cosine(spec) + 0.15 × envelope likeness. ≥ Match fires (Trigger,
  per Cooldown); the Match output holds the score and falls to 0 in 0.5 s.
- **Params**: `sounds` on the Audio Source: id, name, colour, match, cooldown, trigger, matchOut, spec (40), env (4).
  Outputs `<id>_t` "Name (trigger)" and `<id>_m` "Name (match)" after the bands', through the same retype chain;
  ids kept clear of the bands'. Match, Cooldown and Re-learn are live (no recompile).
- **Sources of an example**: File: the window's selection (Drag: Select) or the trim. Mic (or a file just played):
  the engine keeps the last 2.5 s of frames; Learn last hit takes the strongest onset there.
- **Example**: Audio 5 · Learn a clap: a Clap row waiting to be learned, already wired (Envelope, Counter, Match glow).
- Not done: several examples per sound (mean and spread), a "learn from the card" button, telling apart two
  sounds that hit at the same moment.

## Phase 3 — Audio → audio, with energies for visuals (built)
Filter, Resonator bank and Spectral (docs/audio-tools.md "Audio → audio"). play/kit/audioChain.js holds all of it,
shared by the app (lib/audioTools/engine.ts) and exported pages (runtime/play-runtime.js, SSKit.audioTools.chain):

- **Pure maths, tested**: the Web Audio spec's biquad (acBiquadCoeffs / acBiquadMag / acBiquadRun), a bank's tuning
  (acResonatorNotes / Hz / Q from Decay as T60 / gains from Brightness), energies of a block of samples, and the
  Spectral frames as source text (AC_SPECTRAL_CORE: FFT 1024, hop 256, Hann, overlap-add, dry delayed one frame), which
  the AudioWorklet loads from a Blob URL (as audioFx.js's bitcrusher) and tests evaluate.
- **Web Audio** (acBuild): Filter is a BiquadFilterNode (a low- / high-pass's Q handed over in dB, as Web Audio reads
  it); the bank is N band-pass biquads summed (make-up gain, dry / wet), each tapped by a 512-sample analyser for its
  energy; Spectral is the worklet (straight through until it loads). Each effect has a probe analyser for its Level and
  for the listening nodes after it. `update(spec)` moves numbers with setTargetAtTime (no clicks), rebuilds only a bank
  whose Count changed.
- **Chains**: graphWalk's `sourceId` is now the node whose sound a node takes (a source or an effect), through group
  ports as before. The engine builds an effect in its upstream's context (the shared AudioContext for File / Video, the
  Mic's own for the Mic) and connects upstream output → effect input: a File's per-track analyser (post its audioFx
  chain), a Video's inlet, the Mic's tap, or the previous effect's output.
- **What is heard** (graphWalk `audioHearing`, used by the engine and the export): the last effect with Listen on in
  each chain goes to the speakers (audioEngine.connectOutside: master volume and the record bus); a source with a
  listening effect after it goes quiet (a File's audioFx chain diverted to a dead gain, its analyser still reading; a
  Video's out-gain to 0). Mic chains never play.
- **Live and drivable**: the effects are not in SKIP_UNIFORM_TYPES, so their floats are `u_p_*` uniforms (unused in
  GLSL; registry.test.ts lists them as engine-read) with param bindings, so Play offers them. The store treats an
  effect edit as live (no compile, uniforms kept current) except a bank's Count. The engine reads a Play-driven value
  through `inputBus.paramValue` (param channels written this frame or the last); a page reads the uniform table.
- **Outputs**: Level (`level`), the bank's `e0`…`e11`, `loudest`, `peak` (floats; Energies are vec4s built from them in
  GLSL), and textures (bank: Count × 1 energies; Spectral: 128 × 1 log spectrum).

Not done: stereo-aware energies; the Mic chain heard through headphones (a "monitor" switch); per-note outputs
(Energies are vec4s); driving effect numbers from shader values (GPU → audio).

## The Spectrogram as a field (built)
Spectrogram's **Field** output (docs/audio-tools.md): a float of position, `texture2D(history, edge((texUv(pos) − 0.5)
/ Scale + 0.5 + Offset)) × Gain`. Nothing new in the field compiler was needed: inside a field function `g_uv` is the
position asked about, and the history texture is a global sampler, so the node re-emits as it does in main(). Scale,
Offset and Gain are uniforms (Spectrogram left SKIP_UNIFORM_TYPES; Min / Max dB became compileTime, as they were
effectively before). Tested in Height Light, Ride a path inside an Agents group (the walkers' program samples the
history), Step; example Audio 9 lights it as a landscape and bends stripes with it.

## Phase 4 — Stems (plan only)
Stem separation (drums / bass / vocals / other) as an offline bake with a local model, each stem becoming its
own Audio Source. Any model download only after asking the user.

## Phase 5 — The Spectrogram as a field
Built with Phase 3 (above, "The Spectrogram as a field"). Spectrum has no Field yet (its Value already is a function
of x).

## Open questions
- Should Audio Source follow the graph clock (pause with the picture) or keep its own transport? Now: its own
  Play switch, plus the app's master audio pause.
- Float textures for Spectrum (more range) once web export is done?
