# Audio nodes

Make pictures that move with sound, right in the node graph. Find them in the node library under **Audio**,
and try the **Audio** examples folder first. (Plan and later phases: [audio-tools-plan.md](audio-tools-plan.md).)

Every graph starts with one **Audio Source**. Wire its **Audio** output into the nodes that listen to it. Those
give you ordinary numbers and textures you can wire anywhere.

## Audio Source
Where the sound comes from. The card has tabs, like the Texture node's Image | Video | Webcam:

- **File**: press **Load a sound…** and pick a song (mp3, wav, ogg, m4a…). Until then the card says
  *Load a sound, or switch to Mic.* and everything listening hears silence.
- **Mic**: press **Start** (the browser asks first). An audio interface or a virtual cable such as BlackHole works too.

(A Video's sound will be a third tab later.)

- **Play**: plays the file out loud, or listens to the Mic. The **Pause** button on the card does the same.
- **Loop** (File only): start again at the end of the trim (or the file).
- **Gain**: how loud the bands and the listening nodes hear it, not how loud you hear it. Raise it for a quiet microphone.
- Outputs: **Audio** (for the nodes below), **Level** (how loud it is right now, 0–1), **Time** (seconds played),
  and one output per band (below).

The card shows a small live spectrum (bass on the left, log frequency) with your bands under it, and a thin level meter.

### Open ↗: trim and bands
**Open ↗** on the card opens a big window:

- **Waveform**: the whole file. Drag the yellow **In** and **Out** handles (or drag across the waveform) to trim it:
  playback loops inside the trim, and the white line is where it is now. Type exact **In** / **Out** seconds under it,
  or press **Whole file**. On the Mic tab it's a live scrolling waveform instead.
- **Spectrum**: live, log frequency, labelled in Hz. **Drag across it to add a band** over that range; drag a band's
  edge to move it; click a band to pick it.
- **Add a band**: Sub, Bass, Kick, Snare, Hi-hat, Vocals, Air. Kick, Snare and Hi-hat come as triggers with Hit's
  ranges and onset settings; the others send their level.
- **Each band** has a name and a colour, **Low** and **High** in Hz, and what it sends out:
  - **Value**: the band's level, 0–1, with **Attack**, **Release** (rise and fall times in seconds) and **Gain**;
  - **Trigger**: 1 for one frame on each hit in the band (**Sensitivity**, **Cooldown** in ms), exactly what
    Envelope (Trigger mode), Counter and Sample & Hold count;
  - or both. The row shows the band's live level and flashes on each hit.

Every band becomes an **output on the Audio Source**, named after it: *Bass* for a Value, *Kick (trigger)* for a
Trigger. Wire *Kick (trigger)* straight into an Envelope's Gate for a pulse on every kick. Removing a band (or
switching off what it sends) takes its output away, and the wires from it go too.

Moving a band or the trim, and its Attack / Release / Gain / Sensitivity / Cooldown, change the picture at once
without recompiling; adding, removing or renaming a band recompiles (its outputs change).

If you hear nothing, click anywhere in the app: browsers only start sound after a click.

### Learn a sound
Show it one clap (a cowbell, a word, one drum) and it fires whenever a sound like it plays.

1. In the Open ↗ window, switch the waveform to **Drag: Select** and drag across one hit of the sound (green). With
   nothing selected, the trim is used. A longer selection is fine: Learn takes the strongest hit inside it.
2. Press **Learn** (under *Learned sounds*). On the Mic, play the sound and press **Learn last hit**: it takes the
   strongest hit of the last two seconds heard (it works after a file played, too).
3. A row appears: **Sound 1** (rename it: *Clap*), its colour, a small picture of its fingerprint (its loudness from
   low to high frequencies), and:
   - **Match** (0–1, 0.8 to start): how alike a hit has to be to fire. Raise it if other drums fire it, lower it if it
     misses some. The bar under the fingerprint shows how close the last hit was; the white tick is Match.
   - **Cooldown**: milliseconds before it can fire again.
   - What it sends: **Trigger** (1 for one frame when it fires, like a band's) and / or **Match** (how alike the last
     hit was, 0–1, fading to 0 in half a second).
   - **Re-learn** takes a new example from the selection (or the last hit, on the Mic); ✕ removes it.

Each learned sound becomes outputs on the Audio Source: *Clap (trigger)* and *Clap (match)*. Its fingerprint is
saved with the graph. Match, Cooldown and Re-learn change it at once, without recompiling.

How it hears: every moment, the whole spectrum is watched for a hit (a sudden rise, as Hit does). Then the next 50 ms
or so are compared with each learned sound: their loudness across 40 frequency bands (the overall loudness taken
away, so a quiet clap matches a loud one) and a little of how fast they fade. So the trigger comes about 50 ms after
the hit. Two sounds at exactly the same moment (a clap on a kick) mix, and match less well.

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
- Each card shows a small live readout: Audio Source's spectrum, a meter, a flash on each hit, the spectrum, the waterfall or the wave.
- The Audio examples open on the File tab with nothing loaded: load any song, or switch to Mic.
- Bands, the trim and the tab are saved with the graph.
- The Audio nodes work inside groups too (plain, iterated, and a group inside a group): wire an Audio Source's Audio
  into the group and on to the nodes inside, or keep the Audio Source inside. In an Agents group, keep the Audio nodes
  outside and wire their numbers in.
- Web pages exported from Playfield don't play the Audio nodes yet (they hear silence).
- A loaded file has to be loaded again after a reload (the card names the file it had). Graphs from before this
  change that used the built-in Test loop open on the File tab, empty.
- The old **Audio Input** node is retired: it's no longer in the node list, but graphs that use it still work.
