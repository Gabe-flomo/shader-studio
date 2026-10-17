# Audio nodes

Make pictures that move with sound, right in the node graph. Find them in the node library under **Audio**,
and try the **Audio** examples folder first. (Plan and later phases: [audio-tools-plan.md](audio-tools-plan.md).)

Every graph starts with one **Audio Source**. Wire its **Audio** output into the nodes that listen to it. Those
give you ordinary numbers and textures you can wire anywhere.

## Audio Source
Where the sound comes from.

- **Source**: *Test loop* (a two-bar drum loop with kick, snare, hi-hats and a voice, made when the graph opens,
  so there's nothing to download), *File* (press **Pick file…** on the card), or *Microphone / input* (press
  **Start**; the browser asks first. An audio interface or a virtual cable such as BlackHole works too).
- **Play**: plays the file or loop out loud, or listens to the microphone. The **Pause** button on the card does the same.
- **Loop** (File only): start again at the end.
- **Gain**: how loud the listening nodes hear it, not how loud you hear it. Raise it for a quiet microphone.
- Outputs: **Audio** (for the nodes below), **Level** (how loud it is right now, 0–1), **Time** (seconds played).

If you hear nothing, click anywhere in the app: browsers only start sound after a click.

## Band level
How loud one band of frequencies is, 0–1. Pick a **Band** (Sub, Bass, Low mid, Mid, High, Air) or *Custom* and
set **Low** and **High** in Hz. **Attack** and **Release** are rise and fall times in seconds: a slow Release
leaves a tail after each hit. **Gain** scales the result. **Peak** holds the highest Level for a moment, then falls.

## Hit
Finds hits: a kick, a snare, a hi-hat. It watches its band for a sudden rise louder than the last moment or so.

- **Sound**: Kick, Snare, Hi-hat, Any, or Custom (**Low** to **High**).
- **Sensitivity**: higher catches quieter hits (and some false ones).
- **Cooldown**: milliseconds before another hit can count, so one drum doesn't count twice.
- **Decay**: seconds for the Envelope to fall back to 0.
- Outputs: **Trigger** (1 for one frame on each hit), **Envelope** (jumps to 1, falls in Decay), **Count**
  (hits so far), **Strength** (how loud the band was at the last hit).

**Trigger plugs straight into the memory nodes**: Envelope (Trigger mode) for your own rise and fall, Counter to
count beats, Sample & Hold to pick a new random value on every hit.

## Spectrum
The sound split into frequencies, low on the left. **Value** is the loudness of the frequency at this pixel's
left-right place, so "is this pixel below Value?" draws bars. **Texture** is the same as a strip for Sample (texture).
**Bins** is how many steps across; **Layout** *Log* gives each octave the same room (as we hear), *Linear* equal Hz;
**Min dB** and **Max dB** set what reads 0 and 1; **Smoothing** calms it.

## Spectrogram
The spectrum over time, as a waterfall: across is frequency, the top is now, and older moments slide down.
**History** is how many moments it keeps (128 is about two seconds). **Value** is the loudness at this pixel;
**Texture** the whole picture.

## Waveform
The sound itself, like an oscilloscope: the last few milliseconds across the picture. **Value** is the wave at this
pixel's left-right place, −1 to 1 (0 is silence). **Samples** sets how much sound fits across (1024 ≈ 21 ms).

## Good to know
- Each card shows a small live readout: a meter, a flash on each hit, the spectrum, the waterfall or the wave.
- The Audio nodes work at the top level of the graph; inside a group they hear nothing yet.
- Web pages exported from Playfield don't play the Audio nodes yet (they hear silence).
- A picked file has to be picked again after a reload.
- The old **Audio Input** node is retired: it's no longer in the node list, but graphs that use it still work.
