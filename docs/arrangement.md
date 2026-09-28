# The tape: Performance and Arrangement

The Engine tab has two views, like Finish's Picture and Sound:

- **Performance**: the racks as they play (docs/audio-engine.md): up to **8 racks**, each **1 instrument + up to 8 effects**, the lead rack, the tape's transport (Record, Play/Stop, where the tape is, a link to Arrangement).
- **Arrangement**: the **tape**, an OP-1-style multitrack of what was played into the racks: one lane per rack.

The feel is borrowed from the OP-1's tape (record onto a running tape, overdub on top, punch in anywhere, a count-in and metronome at the song's tempo), but the tape is **MIDI, not audio**: it keeps the notes played into each rack and its rack controls' moves. Playing it back sends the notes through each rack's instrument, so the sound, the readers, the picture's pad actions, mappings and a take recording meanwhile all happen for real. Since there's a screen, each lane also shows a rendered waveform of its track, its notes as bars, and its automation as lines.

## Recording

- **Record** (the red circle, in either view). Stopped, it records from the **record point** (the red marker on the ruler; click a lane or the ruler to move it; the first recording always starts at 0). Playing, it **punches in** where the tape is. Recording (or counting in), it stops. Each recording is **one undo step** ("Recorded Rack 1 on the tape").
- **What records**: what each rack receives (MIDI notes, the computer keyboard, the card's keys) goes on **its own track**, and so do its rack controls' moves. Which racks receive notes follows the lead rack rule (docs/audio-engine.md, "The lead rack"): the lead's track records; racks with their own device or channel record what they receive. A lane's **arm** button (the circle) leaves a track out when off.
- **The first recording sets the tape's length** (the performance time becomes the tape's time); loop turns on.
- **Past the end**: while recording, the tape doesn't loop; it runs on past the end and the recording **extends the tape**, up to **60 s**. At 60 s it stops, keeps what was recorded, and says "The tape is full at 60 s for now".
- **Overdub** (the default): everything plays, and only **where you play notes** (each new note's span, per track) or **move a rack control** (while it moves and 0.5 s after, per control: `TOUCH_HOLD`) does the new material replace what was there. Untouched spans keep the old material exactly. An old note sounding into a new span is cut where the span starts; an old automation curve is pinned just outside each touched span.
- **Re-record one rack**: click a lane's name to select it (its rack becomes the selected rack, so what you play goes to it unless another rack is locked as lead). Record then records only that track, from the record point, with **Replace** (everything from the record point to where you stop is replaced; the old material isn't heard meanwhile) or **Overdub**. Other tracks keep playing. "All armed tracks" deselects.
- **Count-in**: none, 1, 2 or 4 bars of 4/4 at the tape's **BPM** (taken from the setup's Clock source when it has one, else 120; editable). The tape **pre-rolls** from that far before the record point (before the tape's 0 it's silence) and counts down on screen; recording starts at the point. Notes played during the count-in aren't recorded.
- **Metronome**: off by default (silent). On, it clicks every beat while the tape runs (accented on the bar), and on the count-in's beats. The click is a 30 ms generated tone straight to the speakers: the performer hears it, recordings don't.
- **Fade in**: none, or an attack (10 ms to 1 s): new notes' velocity ramps up from the record point over it.

## Playback

**Play** plays from the record point (from the top when it's at the end). **Loop** (on by default once there is a length) starts over at the end, letting held notes go at the wrap; off, playback stops at the end. **M** mutes a track, **S** solos (only soloed tracks play), the trash clears a track (an undo step). Automation plays as the Play engine's overrides on the rack controls (as a take playing back does): the faders' dots follow it.

## Rack controls (Configure)

On a rack card, **Configure** (the target icon) on the instrument or an effect picks up to **8** of its parameters (`RACK_CONTROLS_MAX`) as **rack controls**:

- In the desktop app, on an Audio Unit: **touch a control in the plug-in to add it**, as in Ableton. Configure opens the plug-in's window and the engine watches its parameters: whatever the person moves there is added at once, with its live value (with 8 already, the first on the strip makes room: "Replaced <name>"). Parameters that move on their own and preset changes aren't added; nothing is added while a take or the tape records. How it's detected: docs/audio-engine.md, "Configure: touch to configure". A plug-in that doesn't report its window's moves adds nothing, and after 20 s Configure says so.
- **Pick from list…** (on the desktop), and in a browser (a Granulator's settings) always: the parameter list (filterable).

Rack controls are ordinary Play controls on `au:<rack>:<slot>::<address>` in the group **"<rack> · <instrument or effect>"** (it follows renames): mappable to a MIDI knob, recorded by takes, recorded on the tape. They show as a strip of small faders on the rack card. Configure renames, reorders (the Controls tab's order follows) and removes them (the control, its mappings and its moves on the tape go too). Stored as the slot's `controls` (addresses, in order).

## In the record

`play.arrangement` (`src/types/playArrangement.ts`), kept alongside takes:

```ts
{
  length: number;          // s, 0 until the first recording, ≤ 60
  loop: boolean; bpm: number; metronome: boolean;
  countIn: 0 | 1 | 2 | 4;  // bars
  fade: number;            // ms, 0 = none
  tracks: { [rackId]: {
    notes: { t, n, v, d }[];          // s from the tape's start, MIDI note, velocity 0..1, length s
    auto: { [auTarget]: number[] };   // flat [t, v, t, v…]
    mute?, solo?, arm
  } }
}
```

A rack removed takes its track; a file's track for a rack it lacks is dropped on parsing. Free keeps the tape and plays none of it (like the racks). Mute, solo, arm, loop, metronome, count-in, BPM and fade are settings (not undo steps); recordings and clears are undo steps.

## Takes and the tape

A take is a performance of the whole page; the tape is the engine's own multitrack. They meet two ways:

- **A performance over the tape**: Record → Performance has **Play the Audio engine's tape along, from its top** (on by default when the setup has a tape). Starting a take plays the tape from 0; its notes pass through the Play overlay and its automation through the controls, so the take records them like anything played live (and whatever you play on top). The take notes `tape: { at: 0 }`. Rendering it is the ordinary take render.
- **Make a take** (Arrangement) turns the tape itself into a take (`lib/tapeTake.ts`): each audible track's notes as `ae:<rack>` pad events and each rack control's moves as a control track, `tape: { at: 0, made: true }`. Render it from Record like any take.

Either way the existing render path replays the tape **sample-exactly** offline: Audio Unit and sample player racks through the native replay (`engineRender.ts` jobNotes / jobParams → `ae_render_take`, #336), a Granulator through the kit's grain engine (`recordingAudio.ts` renderGrains). The live replay sends the same notes at the same seconds (tested).

## Lane previews

Each lane's waveform is its track rendered offline, alone (`lib/tapePreview.ts`), after each recording and when the rack changes: a Granulator with renderGrains (anywhere), Audio Units and the sample player with the native render (desktop), the browser's sample player with an OfflineAudioContext. An Audio Unit in a browser shows notes only. Nothing is heard.

## Where things are

| Piece | File |
| --- | --- |
| The record, merge rules, timing (pure) | `src/types/playArrangement.ts` |
| The transport, playback, recording, touch automation | `src/lib/tape.ts` (wired by `lib/tapeWire.ts`, from `audioEngineWire.ts`) |
| The tape as a take | `src/lib/tapeTake.ts` |
| Lane previews | `src/lib/tapePreview.ts` |
| Rack controls (pure, `touchRackControl` for touch to configure) and the touched-parameter event | `src/play/rackControls.ts`, `src/lib/paramWatch.ts`; native side `src-tauri/src/audio_engine/touch.rs` |
| UI | `src/components/play/engine/ArrangementPanel.tsx` (transport, lanes), `RackControls.tsx` (strip, Configure), `AudioEnginePanel.tsx` (the two views) |

Perf: the transport ticks every 8 ms without touching React; the store changes only on phase and count-in beats. The playheads, the time readout and the faders' dots move on their own animation frame only while the tape runs; lanes redraw their canvas only when their track, preview or size changes.

Dev: `__shaderStudioDev.tape` / `useTape` / `audioEngine` (`audioEngine.setMasterVolume(0)` for silent checks) with `midiEngine.handleBytes(0x90, 60, 100, 'Keys')`.

## Tests

- `src/play/__tests__/arrangement.test.ts`: overdub keeps untouched spans (notes and automation), replace takes the span, per-track replace, the length set and extended to 60 s, count-in and metronome timing, loop wrap, note scheduling, mute/solo, fade in, parsing and migration, the tape in the Play record (a removed rack's track, Free), a take of the tape, the touched-parameter event.
- `src/lib/__tests__/tape.test.ts`: the runtime against a hand-moved clock: a first recording, extension and the 60 s cap, playback with loop wrap, mute, automation overrides, punch-in while playing, count-in pre-roll, per-track replace, arming, touched rack controls, undo steps, rack controls (add/rename/reorder/regroup/remove; a touched parameter added, the first on the strip replaced when full, its mappings going too), and replay parity with the offline render (native job notes and a Granulator's pad hits).

## For the owner to try (desktop, AU racks)

1. Two racks with Audio Unit synths (DLSMusicDevice). Arrangement → Record, play a MIDI keyboard for a few seconds, Record again to stop. The lane shows the notes, then the waveform (native render). Play: it loops through the synth, the spectrum and readers move.
2. Select the second rack's card (it becomes the lead), Play, press Record while it plays, play a line, stop: the first rack's notes are untouched.
3. Configure on the synth: its window opens; turn a knob: it's added at once. Add two. Map a MIDI knob to one; record while turning it: its line appears on the lane; play back: the fader's dot follows. Try a third-party AUv3 and an AUv2: whether the window's moves are reported.
4. Count-in 1 bar with the metronome on, record from the middle: the clicks line up with the notes already there; the new notes land after the point.
5. Make a take → Record → render with FFmpeg: the video's sound has the tape.
6. Record past the end until 60 s: the notice, the tape kept.
