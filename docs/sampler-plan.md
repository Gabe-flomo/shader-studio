# Sampler: plan (replaces Drum pads)

*18 Oct 2026.* The Drum pads layer (docs/drum-pads.md) "doesn't feel right" to someone who lives in Ableton, and editing it is clunky (the editor only fits the split view). This plan replaces it with one **Sampler** layer, modelled on Ableton's Simpler, Sampler and Drum Rack, minus the DAW-only parts (warping to a set tempo, racks of arbitrary devices, sends to return tracks).

## 1. What Ableton does, and what makes it feel right

### Simpler (one sample, three modes)

- **Classic**: the sample plays while the note is held, through an ADSR. With **Loop** on, it loops between the loop markers while held, then goes into Release. Polyphonic (Voices 1–32); **Retrigger** restarts a voice already playing that note rather than stacking another. Glide and Legato appear with Voices = 1.
- **One-Shot**: plays the region to its end whatever the note length. ADSR is replaced by **Fade In / Fade Out**; a **Trigger** switch makes note-off ignored (on) or a gate (off). The default one-shot always ends with a short fade so it never clicks.
- **Slice**: the sample is cut into slices (by **Transient** with a Sensitivity, by **Beat** divisions, into N **Region**s, or **Manual**), and slice 1 plays on C1, slice 2 on C#1, and so on, each slice its own one-shot (or gate). Slices show as lines over the waveform; drag them, double-click to add or remove. Each slice keeps the same envelope and filter.
- **The waveform** is the centre of the device: a dark surface, the region lit, everything else dimmed. **Start** and **End** markers are draggable flags; in Classic the **loop brace** sits inside, with its **Crossfade** shown as a ramp on the loop's start. Mouse wheel / pinch **zooms** around the pointer, dragging the overview scrolls. **Snap** puts markers on zero crossings (or warp markers), so a cut never clicks. Hovering a marker shows its value; double-click resets.
- **Controls** below: Gain, Transpose (semitones), Detune (cents), Spread, Pan, Vel → Vol (and its curve), Voices, Retrigger. The **Filter** (Clean/OSR/MS2/SMP/PRD circuits; LP/HP/BP/Notch/Morph, 12/24 dB) with Frequency, Res, Env amount, Vel → Freq, Key → Freq and an LFO amount. **Envelopes** for Amp, Filter and Pitch, each with Attack/Decay/Sustain/Release, and **slopes** (A/D/R) you can drag in the envelope picture; **LFO** (shapes, rate in Hz or synced, retrigger, attack) to filter, pitch, pan, volume.

### Sampler (multisampling)

- **Zone editor**: a strip of keys across the top, one row per sample below. Each row is a bar from its lowest to its highest key; drag the bar ends to resize, the middle to move, and the faded ends set a **crossfade** range. Tabs swap the same view for **Velocity** (0–127 across) and **Sample Select** (an arbitrary selector, used for round robin). The **root key** of a sample sits on its row; samples dropped together auto-map, and the root comes from the file name when it carries a note ("Piano_C3.wav").
- **Round robin**: zones that overlap play in turn (Round Robin) or at random (Random), instead of all together (layering).
- **Per sample**: root key, detune, volume, pan, sample start/end, sustain loop (with crossfade), release loop, reverse. **Pitch tracking** follows the key from the root (a drum sample can turn it off).
- **Global**: the same filter, envelopes, LFOs, Glide (portamento) and Voices as Simpler, plus a modulation matrix.

### Drum Rack

- **Pads = chains**: each pad is its own instrument (usually a Simpler) receiving one note. The **pad view** shows a 4 × 4 window over 128 notes; the **pad overview** beside it (a tall strip of the 128 notes) lets you drag the window up and down a row at a time. The default window is C1–D#2 (36–51).
- A pad shows its **note name** and the sample's name; it lights when hit; it has Mute, Solo and Preview buttons on hover. **Drop a sample** on a pad and it becomes a Simpler on that pad; drop several and they spread across consecutive pads. Dragging one pad onto another swaps (or with Cmd, copies). **Hot-swap** replaces a pad's sample while browsing, auditioning each.
- **Choke groups** (1–16): a hit cuts every other chain in its group; the cut is quick but faded, so a closed hat stops an open hat without a click.
- **Per pad**: volume, pan, sends (A/B), and the instrument's own controls; a **Show/Hide chains** list with each pad's Receive / Play note, and Choke.

### The feel, in specifics

- Hits are **tight**: a note starts at the note's own time, never at the next audio block or animation frame. Sample start, envelope and filter all start on the same sample.
- **No clicks**: chokes, voice steals, retriggers and the one-shot end are all short fades (2–5 ms). A sample's start/end can snap to zero crossings.
- **Smooth envelopes**: curved stages (an exponential-ish decay sounds natural; linear sounds mechanical); release starts from wherever the level is, not from the sustain level.
- **The envelope picture is the editor**: drag the corner points for time and level, drag a segment's middle up or down for its slope, and the numbers follow.
- **Velocity → volume** has its own curve; a soft hit is quieter but still there.
- **Preview while browsing** (the app already has Splice-style auditioning in the Sounds tab and linked folders).

## 2. The plan for Playfield

### One layer, one engine

- **Layer kind `sampler`**, label **Sampler**, in Add layer → Inputs & helpers (where Drum pads was). The old kind `drumpad` stays registered as an alias: a record with `kind: 'drumpad'` parses into a `sampler` layer in its **Drum view**, with every pad, number, choke, key/MIDI/grid setting, Sample index and Volume kept as it was.
- **One engine**, `src/play/kit/sampler.js` (pure Web Audio, shared by the app, offline renders and web exports, names prefixed `sm`/`SM_`). A voice is: `BufferSource` → filter (0, 1 or 2 biquads for 12 / 24 dB) → amp envelope → release gain → kill gain → volume (with velocity) → tremolo → pan → the layer's output. Every stage is scheduled on the AudioContext clock at the hit's time, with AudioParam automation only:
  - **Envelope stages**: linear ramps when a slope is 0 (so migrated pads sound exactly as before), otherwise `setValueCurveAtTime` with a shaped curve (`smShape`). The amp envelope never needs cancelling:
  - **Release** is a separate gain that goes 1 → 0 over Release (shaped by its slope), so it always starts from where the level is, with no `cancelAndHold` (Firefox lacks it, and cancels are a click source).
  - **Choke, voice steal and retrigger** use a third gain, 1 → 0 over 4 ms: never a jump.
  - **Pitch envelope** and **filter envelope** are `ConstantSource`s (0 → 1 → Sustain, then their own release gain) scaled to cents into `BufferSource.detune` / `BiquadFilter.detune`. The **LFO** is an `Oscillator` into pitch (cents), filter (cents), amp (tremolo) or pan. **Glide** is a linear ramp on `detune` from the previous note.
  - **Loop crossfade** is baked: a copy of the buffer whose last `xfade` seconds before the loop end are blended (equal power) with the audio leading into the loop start, so the wrap is continuous. Cached per buffer and loop.
  - **Voices**: a cap per layer (32 for drums, Voices for Keys), stealing the oldest (released first) with the 4 ms kill.
- **Hits are pads**: every hit names a pad 1–128 (`pad` actions, takes, rules, as today). Pad *n* is note `(base + n − 1) mod 128`, base = 36 by default (the old Base note), so the old pads 1–16 are the same pads and every old number keeps its name (`pad3_pitch`). In the Keys view, pad *n* is simply that note.

### Drum view (replaces Drum pads)

- **128 pads**, 16 visible: a 4 × 4 window with a **pad overview** strip (32 rows × 4) beside it; click or drag the overview to move the window a row at a time, like Drum Rack. Pads show the note name (C1) and the sample's name, light on hits, accept dropped files (several files fill consecutive pads), and a click plays (higher is harder) and selects.
- **Per pad** (a chain): its sample or generated drum, mode (One-shot / Classic), loop, reverse, choke group 1–16, and the full voice settings (below), every number a layer property `pad<N>_<key>`, so a mapping target.
- **Keys** (Z X C V…) and the **pad grid** play the visible window; MIDI notes play any pad; actions and signals play pad numbers; takes record every hit.
- **Slice to pads**: a pad's sample cut at its transients onto the next pads (like Ableton's "Slice to Drum Rack").

### Keys view (multi-sampler)

- **Zones**: each a sample (or generated sound) with key range, velocity range, root key, tune, gain, pan, start/end/loop markers, loop crossfade, reverse and **pitch tracking**. A dropped file's root key comes from its name ("Cello_A2.wav" → A2) else C3 (60).
- **Zone editor**: the keyboard across the top, one bar per zone, drag the ends or the middle; a **Key / Velocity** switch shows the same bars against velocity. Overlapping zones play **All** (layered), **Round robin** or **Random** (seeded, and a take records which played).
- **Modes**: **Classic** (gate, loop while held, release), **One-shot** (to the end, note-off ignored), **Slice** (the first zone's sample cut at its transients, slice *k* on the *k*-th pad/note from the base; slices drawn on the waveform, draggable, double-click to add/remove; Sensitivity).
- The computer keyboard plays notes like Live's (A W S E D F T G Y H U J K, Z/X octave); MIDI notes on any or one channel.
- **Global voice settings** for the instrument: layer properties `k_<key>` (`k_cutoff`…), mapping targets like the pads'.

### Shared voice settings

Gain (Volume), Pan, Transpose, Detune; **Amp envelope** A/D/S/R with A/D/R slopes, drawn and dragged in the envelope picture (envelopeGraph.ts's layout, plus slope handles); Vel → Vol with its curve; **Filter**: Off / LP / HP / BP at 12 or 24 dB, Frequency, Res, its own A/D/S/R and Env amount (semitones), Vel → Freq; **Pitch envelope** (amount in semitones, A/D/S/R); one **LFO** (sine, triangle, square, saw; rate, amount) to pitch, filter, amp or pan; Voices, Retrigger / Legato, Glide; One-shot Fade out.

### Editor

- **One editor** in the sidebar and the split view. The sidebar shows a compact version (view switch, the pads or the zones' mini map, the selected sound's waveform, the envelope and the main numbers) with **Expand** (the split view's big panel, or a full-height sheet on phones) for the zone editor and every section.
- **Waveform**: dark surface (`bg.render`), the region lit; drag **S**/**E** flags and the **loop brace**; the crossfade drawn as a ramp; wheel/pinch to **zoom** around the pointer, drag the overview to scroll; **Snap** to zero crossings (on by default); slice lines in Slice mode.
- Sections (tabs) are folded by default except the primary one (Pads / Zones), with summaries; sliders follow the app's conventions (type past the end to extend a soft range; right-click for the Play/knob menu).

### Migration, exports, renders

- `kind: 'drumpad'` → `sampler` with `view: 'drum'`; pads, numbers, settings unchanged; control targets `layer:<id>::pad3_pitch` unchanged. New numbers default to what the old engine did (linear stages, no filter, no pitch envelope, no LFO, 3 ms one-shot fade), so a migrated kit renders the same.
- Readers (`pads:<id>`), the effect chain (`layer:<id>`), recordings, frame-by-frame renders (`padHitsOf` / the offline mix), kits (drumKits.ts, now the Drum view's kits) and web exports (samples as data URLs on pads and zones) all go through the new engine.

### Order of work (commits on `claude/sampler`)

1. This plan.
2. Engine + Drum view + migration (and the old editor removed).
3. Keys view + zones.
4. Slice mode, LFO / filter / pitch envelope polish, docs/sampler.md.

### Tests

Scheduling (a hit at *t* starts at *t* ± 1 sample), envelope stage levels and slopes, choke within 4 ms without a discontinuity, round robin cycling, key/velocity zone selection, pitch tracking ratios, loop crossfade continuity, slice detection on a click train, Drum pads → Sampler migration equivalence (old and new engines' renders match), control aliases.
