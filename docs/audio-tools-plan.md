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

- **Tabs** File | Mic on the card (as the Texture node's), no Source dropdown; room for a "Video sound" tab later.
  The `source` param is `file` or `mic`; a saved `loop` opens as `file` (retypeAudioSource, run on load).
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
- Web export (the play runtime) doesn't run the Audio nodes yet: an exported page hears silence. The old
  Audio Input's song is embedded in exports; porting lib/audioTools to the runtime is the follow-up.
- A Video's sound as a source (the Play page's Video layers have one; the graph's Video node doesn't yet).
- ~~Audio nodes inside a group compile but hear nothing~~ (done): the engine walks every group's subgraph
  (lib/audioTools/graphWalk.ts), following an `audio` wire through group input and output ports to its source, and
  the compiler binds an inner node's live uniforms and texture to its original id (shaderAssembler registerAudioTool,
  at both group levels). Plain, iterated and nested groups. Agents groups: not done (their programs don't take live
  uniforms from inside); wire the numbers in from outside.
- A loaded file isn't kept across reloads (same as Audio Input): the card names the file to load again. Keeping it
  in the media library like videos needs an audio library store (backgroundLibrary has images and videos only).
- Desktop app (WKWebView): the microphone path is untested there.
- Nice-to-haves not built: Loudness (LUFS-like), Centroid (brightness), Chroma (12 notes as three vec4s).

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

## Phase 3 — Audio → audio, with energies for visuals (plan only)
Filters (low / high / band pass), a resonator bank, spectral freeze / blur / gate. Each changes the sound you
hear and also outputs its energies as floats, so the picture follows exactly what the effect does.
Built on the existing effect chains (lib/audioFx.ts) where possible.

## Phase 4 — Stems (plan only)
Stem separation (drums / bass / vocals / other) as an offline bake with a local model, each stem becoming its
own Audio Source. Any model download only after asking the user.

## Phase 5 — The Spectrogram as a field (plan only)
Give Spectrogram (and Spectrum) a field-socket output (docs/field-sockets.md): a float function of position,
`fieldFn(pos)`, reading the history texture at any point, so it plugs in wherever an SDF or a noise field goes —
warp it, threshold it into shapes, let agents ride or sense it, use it as a height. Needs the field compiler to
accept a sampler-backed function (the texture is already a uniform, so the function just samples it).

## Open questions
- Should Audio Source follow the graph clock (pause with the picture) or keep its own transport? Now: its own
  Play switch, plus the app's master audio pause.
- Float textures for Spectrum (more range) once web export is done?
