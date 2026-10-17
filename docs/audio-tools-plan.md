# Audio tools in the graph — plan

Audio-reactive pictures built in the node graph, without the Play page. Replaces the Audio Input node
(a file with per-band floats), which is retired: hidden from the node list and search, while saved graphs
that use it still load and run.

## Data flow

```
Audio Source ──audio wire──▶ Band level / Hit / Spectrum / Spectrogram / Waveform ──floats, textures──▶ the picture
     │
     └── lib/audioEngine (a file, the test loop) or lib/liveAudio (microphone / audio input)
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

Audio Source plays a file, the built-in test loop (synthesised at runtime with an OfflineAudioContext:
kick, snare, hats and a voice; no binary files) or listens to the microphone / an audio interface.

Examples: an "Audio" folder of four commented graphs on the test loop (kick ring pulse via Hit → Envelope,
spectrum bars, spectrogram waterfall, waveform line).

### Known gaps in Phase 1
- Web export (the play runtime) doesn't run the Audio nodes yet: an exported page hears silence. The old
  Audio Input's song is embedded in exports; porting lib/audioTools to the runtime is the follow-up.
- A Video's sound as a source (the Play page's Video layers have one; the graph's Video node doesn't yet).
- Audio nodes inside a group compile but hear nothing (the engine follows top-level wires only).
- A picked file isn't kept across reloads (same as Audio Input).
- Desktop app (WKWebView): the microphone path is untested there.
- Nice-to-haves not built: Loudness (LUFS-like), Centroid (brightness), Chroma (12 notes as three vec4s).

## Phase 2 — Learn a sound (plan only)
Hit-by-example: record a few examples of a sound (a clap, one drum), keep a spectral fingerprint (mean and
spread of log-band energies over the onset window), then match each onset against it (cosine or Mahalanobis
distance) → Trigger and Similarity. Needs a capture UI on the card; the fingerprint lives in params.

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
- One test loop or several (tempos, styles) for examples?
- Float textures for Spectrum (more range) once web export is done?
