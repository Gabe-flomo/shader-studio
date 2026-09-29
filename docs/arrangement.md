# The tape: the Arrangement view

The Engine tab is **one view, laid out like Ableton Live's Arrangement**. The Performance view (a card per rack, with a switch to the Arrangement) is **removed**: the Arrangement is the engine, and adding a rack is adding a track.

## The Arrangement view

```
┌ transport: ▶/❚❚  ■  ●  | loop  metronome  count-in  BPM  1.3.2 0:02.3 / 0:04.0 | fade in  make a take  MIDI ┐
│ track header (colour, instrument, name, Lead, ●  M  S, volume, meter) │ lane: bars and beats, clips (audio-looking) │
│ …one per rack, drag to reorder                                        │ loop brace, record point, playhead           │
│ + Add track                                                                                                           │
│ Master (mute, volume, meter)                                          │                                              │
├──────────────────────────────────────── drag to resize ────────────────────────────────────────────────────────────┤
│ the selected track's device chain: MIDI in → instrument → (Sound effects) → effects / Listener → + Add              │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Tracks are racks** (`play/engineView.ts` `engineTracks`): up to **8**, each **1 instrument + up to 8 effects**. The header and the device chain are docs/audio-engine.md, "The track and its device chain"; the Master and Listeners are there too. **Add track** adds a rack, selects it and offers the instrument picker.
- **The timeline**: the ruler is in **bars and beats** at the tape's BPM (4/4; labels thinned when bars are narrow, `rulerTicks`), with the **loop brace** over the tape's length when Loop is on, the tape's end, and the **record point** (the red marker; click the ruler or an empty stretch of a lane to move it). The view spans the tape and some room (the whole 60 s while recording).
- **Narrow panels and phones** (under 560 px of panel): the header sits above its lane, the tracks stack, the whole view scrolls, and the device chain scrolls sideways.

## The transport

- **Play/Pause** (one button; **Space** while the engine has focus, unless a rack has the computer keyboard or you're typing): stopped, it plays from the record point; playing, it **pauses where the tape is** (the record point moves there, so the next Play carries on); recording, it stops recording (kept, one undo step) and pauses there; counting in, it cancels. `play/engineView.ts` `transportPlan`, run by `tape.togglePlay()`.
- **Stop** stops whatever runs (a recording is kept) and goes **back to the start** (`tape.stopToStart()`).
- **Record**, **Loop**, **Metronome**, **Count-in**, **BPM** and **Fade in** as below; the position reads **bar.beat.sixteenth** and time / length. **Make a take** and the **MIDI** devices and monitor (the antenna) are at the end.

## Clips

What a recording puts on a lane is a **clip**, drawn like audio: a block in the track's colour, a title strip, and a **waveform**: the track's sound rendered offline (lane previews, below; a quiet track is drawn up to 4× bigger), or, where the rack's sound can't be rendered here (an Audio Unit in a browser), an **envelope drawn from the notes' velocities and density** (each note an attack, decay, sustain while held and release, with a little grain: `clipWave`). Notes are never shown as notes, and there is **no note editing**. Rack control moves show as thin lines.

Under the clips the tape is still **MIDI, not audio** (the OP-1-style tape it grew from): it keeps the notes played into each rack and its rack controls' moves, and playing it back sends them through each rack's instrument, so the sound, the readers, the picture's pad actions, mappings and a take recording meanwhile all happen for real.

- **Select** a clip (click it; it's outlined, and its track is selected). **Mute** it (the eye on it, or right-click): it stays on the lane, greyed, and doesn't play (nor in a take made from the tape). **Delete** it (the trash, right-click, or Delete/Backspace): its notes and moves come off the tape. **Trim** it by dragging either end: what falls outside goes, and a note sounding past a new end is cut there; an end stops at the neighbouring clip and the tape's ends. Each is one undo step.
- **Where clips come from**: each recording adds its span (from where it started to where it stopped) to each track it wrote on; a span overlapping a clip joins it (and a muted clip recorded over plays again). A tape recorded before clips existed shows its material as clips: runs of notes and moves closer than 1 s (`trackClips`).
- **While recording**, each track being recorded shows a red clip growing from the record point to the playhead, like Ableton's arrangement record.

## Recording

- **Record** (the red circle). Stopped, it records from the **record point** (the red marker on the ruler; click the ruler or an empty stretch of a lane to move it; the first recording always starts at 0). Playing, it **punches in** where the tape is. Recording (or counting in), it stops. Each recording is **one undo step** ("Recorded Rack 1 on the tape").
- **What records**: what each rack receives (MIDI notes, the computer keyboard, the keys in its MIDI in device) goes on **its own track**, and so do its rack controls' moves. Which racks receive notes follows the lead rack rule (docs/audio-engine.md, "The lead rack"): the lead's track records; racks with their own device or channel record what they receive. A lane's **arm** button (the circle) leaves a track out when off.
- **The first recording sets the tape's length** (the performance time becomes the tape's time); loop turns on.
- **Past the end**: while recording, the tape doesn't loop; it runs on past the end and the recording **extends the tape**, up to **60 s**. At 60 s it stops, keeps what was recorded, and says "The tape is full at 60 s for now".
- **Overdub** (the default): everything plays, and only **where you play notes** (each new note's span, per track) or **move a rack control** (while it moves and 0.5 s after, per control: `TOUCH_HOLD`) does the new material replace what was there. Untouched spans keep the old material exactly. An old note sounding into a new span is cut where the span starts; an old automation curve is pinned just outside each touched span.
- **Re-record one rack**: pick **Record this track alone…** in its ⋯ menu (select the track too, so what you play goes to it unless another rack is locked as lead). Record then records only that track, from the record point, with **Replace** (everything from the record point to where you stop is replaced; the old material isn't heard meanwhile) or **Overdub**. Other tracks keep playing. "All armed tracks" (in the transport) goes back to every armed track.
- **Count-in**: none, 1, 2 or 4 bars of 4/4 at the tape's **BPM** (taken from the setup's Clock source when it has one, else 120; editable). The tape **pre-rolls** from that far before the record point (before the tape's 0 it's silence) and counts down on screen; recording starts at the point. Notes played during the count-in aren't recorded.
- **Metronome**: off by default (silent). On, it clicks every beat while the tape runs (accented on the bar), and on the count-in's beats. The click is a 30 ms generated tone straight to the speakers: the performer hears it, recordings don't.
- **Fade in**: none, or an attack (10 ms to 1 s): new notes' velocity ramps up from the record point over it.

## Playback

**Play** plays from the record point (from the top when it's at the end). **Loop** (on by default once there is a length) starts over at the end, letting held notes go at the wrap; off, playback stops at the end. **M** on a header mutes the rack (live and on the tape; a tape from before keeps its own track mute, which **M** clears), **S** solos on the tape (only soloed tracks play), a muted clip is skipped, and **Clear its clips…** (⋯) clears a track (an undo step). Automation plays as the Play engine's overrides on the rack controls (as a take playing back does): the faders' dots follow it.

## Rack controls (Configure)

In the device chain, **Configure** (the target icon) on the instrument or an effect picks up to **8** of its parameters (`RACK_CONTROLS_MAX`) as **rack controls**:

- In the desktop app, on an Audio Unit: **touch a control in the plug-in to add it**, as in Ableton. Configure opens the plug-in's window and the engine watches its parameters: whatever the person moves there is added at once, with its live value (with 8 already, the first on the strip makes room: "Replaced <name>"). Parameters that move on their own and preset changes aren't added; nothing is added while a take or the tape records. How it's detected: docs/audio-engine.md, "Configure: touch to configure". A plug-in that doesn't report its window's moves adds nothing, and after 20 s Configure says so.
- **Pick from list…** (on the desktop), and in a browser (a Granulator's settings) always: the parameter list (filterable).

Rack controls are ordinary Play controls on `au:<rack>:<slot>::<address>` in the group **"<rack> · <instrument or effect>"** (it follows renames): mappable to a MIDI knob, recorded by takes, recorded on the tape. They show as small faders on their device, with their live values. Configure renames, reorders (the Controls tab's order follows) and removes them (the control, its mappings and its moves on the tape go too). Stored as the slot's `controls` (addresses, in order).

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
    mute?, solo?, arm,
    clips?: { t, d, mute? }[]      // the lane's clips (absent on older tapes: worked out from the material)
  } }
}
```

A rack removed takes its track; a file's track for a rack it lacks is dropped on parsing. Free keeps the tape and plays none of it (like the racks). Mute, solo, arm, loop, metronome, count-in, BPM and fade are settings (not undo steps); recordings and clears are undo steps.

## Takes and the tape

A take is a performance of the whole page; the tape is the engine's own multitrack. They meet two ways:

- **A performance over the tape**: Record → Performance has **Play the Audio engine's tape along, from its top** (on by default when the setup has a tape). Starting a take plays the tape from 0; its notes pass through the Play overlay and its automation through the controls, so the take records them like anything played live (and whatever you play on top). The take notes `tape: { at: 0 }`. Rendering it is the ordinary take render.
- **Make a take** (the transport) turns the tape itself into a take (`lib/tapeTake.ts`): each audible track's notes (muted clips left out) as `ae:<rack>` pad events and each rack control's moves as a control track, `tape: { at: 0, made: true }`. Render it from Record like any take.

Either way the existing render path replays the tape **sample-exactly** offline: Audio Unit and sample player racks through the native replay (`engineRender.ts` jobNotes / jobParams → `ae_render_take`, #336), a Granulator through the kit's grain engine (`recordingAudio.ts` renderGrains). The live replay sends the same notes at the same seconds (tested).

## Lane previews

Each lane's waveform (what its clips draw) is its track rendered offline, alone (`lib/tapePreview.ts`), after each recording and when the rack changes: a Granulator with renderGrains (anywhere), Audio Units and the sample player with the native render (desktop), the browser's sample player with an OfflineAudioContext. An Audio Unit in a browser has no render: its clips draw an envelope from the notes instead. Nothing is heard.

## Where things are

| Piece | File |
| --- | --- |
| The record, merge rules, timing (pure) | `src/types/playArrangement.ts` |
| The transport, playback, recording, touch automation | `src/lib/tape.ts` (wired by `lib/tapeWire.ts`, from `audioEngineWire.ts`) |
| The tape as a take | `src/lib/tapeTake.ts` |
| Lane previews | `src/lib/tapePreview.ts` |
| Rack controls (pure, `touchRackControl` for touch to configure) and the touched-parameter event | `src/play/rackControls.ts`, `src/lib/paramWatch.ts`; native side `src-tauri/src/audio_engine/touch.rs` |
| UI | `src/components/play/engine/ArrangementPanel.tsx` (transport, tracks, lanes and clips, master), `DeviceChain.tsx` (the device chain, the master's), `RackControls.tsx` (rack control faders, Configure), `AudioEnginePanel.tsx` (the Pro gate); the view as data: `src/play/engineView.ts` |

Perf: the transport ticks every 8 ms without touching React; the store changes only on phase and count-in beats. The playheads, the time readout and the faders' dots move on their own animation frame only while the tape runs; lanes redraw their canvas only when their track, preview or size changes.

Dev: `__shaderStudioDev.tape` / `useTape` / `audioEngine` (`audioEngine.setMasterVolume(0)` for silent checks) with `midiEngine.handleBytes(0x90, 60, 100, 'Keys')`.

## Tests

- `src/play/__tests__/arrangement.test.ts`: overdub keeps untouched spans (notes and automation), replace takes the span, per-track replace, the length set and extended to 60 s, count-in and metronome timing, loop wrap, note scheduling, mute/solo, fade in, parsing and migration, the tape in the Play record (a removed rack's track, Free), a take of the tape, the touched-parameter event.
- `src/play/__tests__/engineView.test.ts`: tracks follow racks (order, lead, mute, colour, reordering, a file), clips from recordings and from an older tape's material, delete / mute / trim, a muted clip left out of playback and of a take, a clip's waveform (the rendered sound over its span, or an envelope from the notes: never bars), the device chain's order with the Listener and where it reads, dragging effects and the Listener, the bar/beat ruler, and the transport's play/pause/stop rules.
- `src/lib/__tests__/tape.test.ts`: the runtime against a hand-moved clock: Play/Pause carrying on from where it paused, Stop back to the start, pausing a recording (kept) and a count-in (cancelled), a muted clip not played, a first recording, extension and the 60 s cap, playback with loop wrap, mute, automation overrides, punch-in while playing, count-in pre-roll, per-track replace, arming, touched rack controls, undo steps, rack controls (add/rename/reorder/regroup/remove; a touched parameter added, the first on the strip replaced when full, its mappings going too), and replay parity with the offline render (native job notes and a Granulator's pad hits).

## For the owner to try (desktop, AU racks)

1. Two racks with Audio Unit synths (DLSMusicDevice). Engine → Add track twice (DLSMusicDevice) → Record, play a MIDI keyboard for a few seconds, Record again to stop. A clip appears, its waveform drawn once the native render is back. Play: it loops through the synth, the spectrum and readers move.
2. Select the second track (it becomes the lead), Play, press Record while it plays, play a line, stop: the first rack's notes are untouched.
3. Configure on the synth: its window opens; turn a knob: it's added at once. Add two. Map a MIDI knob to one; record while turning it: its line appears on the lane; play back: the fader's dot follows. Try a third-party AUv3 and an AUv2: whether the window's moves are reported.
4. Count-in 1 bar with the metronome on, record from the middle: the clicks line up with the notes already there; the new notes land after the point.
5. Make a take → Record → render with FFmpeg: the video's sound has the tape.
6. Record past the end until 60 s: the notice, the tape kept.


## Showing the tape as MIDI or audio

*29 Sep 2026.* The tape is MIDI underneath either way. A track's ⋯ menu → **Show
the tape as** picks how its clips draw: **MIDI notes** (the default, back by the
owner's request: each note a bar, pitch up the lane over the track's own range,
velocity as opacity) or **Audio** (the rendered sound, or an envelope from the
notes when the sound isn't available here). `ArrTrack.show` ('midi' | 'audio';
absent = midi), kept when a track is cleared. Note editing on MIDI clips is the
next step.


## Editing notes

*29 Sep 2026.* On a lane showing MIDI, notes can be edited in place: **drag** a
note to move it in time (snapped to the beat; ⇧ free) and pitch (up or down a
row), drag its **right edge** to lengthen it, **⌥-drag** up or down for
velocity, **double-click** empty lane to add a note a beat long at that pitch,
and **Delete** removes the selected note. A note moved or added outside every
clip grows the clip to cover it (`addNote`, `patchNote`, `deleteNote`,
`clampNote`, `notePitchRange` in `types/playArrangement.ts`); notes stay sorted
by time. Each edit is one undo step, and takes and renders play the edited
notes.
