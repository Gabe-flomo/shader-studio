# Audio nodes

Make pictures that move with sound, right in the node graph. Find them in the node library under **Audio**,
and try the **Audio** examples folder first. (Plan and later phases: [audio-tools-plan.md](audio-tools-plan.md).)

Every graph starts with one **Audio Source**. Wire its **Audio** output into the nodes that listen to it. Those
give you ordinary numbers and textures you can wire anywhere.

## Audio Source
Where the sound comes from. The card has tabs, like the Texture node's Image | Video | Webcam:

- **File**: press **Load a sound…** and pick a song (mp3, wav, ogg, m4a…). Until then the card says
  *Load a sound, or switch to Mic.* and everything listening hears silence. The sound is kept in the media library
  (with the videos), so it comes back by itself when you reload or open the graph again. **Library** lists every sound
  kept there: **Use** puts one in the Audio Source, **✕** removes it from the library.
- **Mic**: press **Start** (the browser asks first). An audio interface or a virtual cable such as BlackHole works too.
- **Video**: pick a video node in the graph (a Texture node playing a video file, or a Baked node). Its own sound is
  what the Audio nodes hear, in step with the picture: it plays and loops with the video (there is no trim). You hear it
  through the speakers while Play is on. A video without a sound track reads silence; so does the webcam.

- **Play**: plays the file out loud, or listens to the Mic. The **Pause** button on the card does the same.
- **Loop** (File only): start again at the end of the trim (or the file). A Video loops as its video node does.
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

### Stems
**Separate** (on the card, and under *Stems* in the Open ↗ window) splits a File's song into stems on this device:
**Drums**, **Bass**, **Vocals** and **Other**. How it works, sizes and speeds: [stems.md](stems.md).

1. Press **Separate**. The first time, it offers the model: *HT-Demucs (4 stems) runs on this device and is downloaded
   once (126 MB). Nothing is sent anywhere.* Nothing downloads until you press **Download (126 MB) and separate**.
2. While it works the picture pauses and a screen says what is happening: the song, the step (downloading, segment 3 of
   24, encoding a stem), a progress bar, the time so far and about how long is left, and whether it runs on the GPU
   (WebGPU) or the CPU (WebAssembly). **Cancel** stops it; the picture plays again either way. A 3-minute song takes
   well under a minute on a GPU, several minutes on one CPU thread.
3. Pick a **Stem**: *Full mix*, *Drums*, *Bass*, *Vocals* or *Other*. The bands, Learn a sound, the learned sounds,
   Hit, Band level, Spectrum, Spectrogram, Waveform and the effects all hear that stem: Hit on the Drums stem finds the
   kicks without the bass line getting in the way. The window's waveform shows the stem.
4. **Hear**: *Full mix* (the default) plays the song while the analysis hears the stem; *This stem* plays the stem.

The stems play in step with the song, inside its trim and loop. They are kept in the library beside the song (Opus,
about 3.6 MB per stem for 3 minutes), so they come back after a reload and travel in .playfield / .playfile files. In
the window: **4 stems | 6 stems (+ guitar, piano)** picks the model for **Re-separate** (the 6-stem model is a second
download, 136 MB; its guitar is usable, its piano bleeds), **Remove stems** removes them. Loading another song leaves
the old song's stems unused. A web page carries the picked stem like the song (up to 6 MB; a bigger one stays out and
the page analyses the whole song).

### Learn a sound
Show it one clap (a cowbell, a word, one drum) and it fires whenever a sound like it plays.

1. In the Open ↗ window, switch the waveform to **Drag: Select** and drag across one hit of the sound (green). With
   nothing selected, the trim is used. A longer selection is fine: Learn takes the strongest hit inside it.
2. Press **Learn** (under *Learned sounds*). On the Mic, play the sound and press **Learn last hit**: it takes the
   strongest hit of the last two seconds heard (it works after a file played, too). A row still waiting to be
   learned (the *Learn a clap* example's Clap) takes it; otherwise a new row is added.
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

### The Spectrogram as a field
**Field** is the same history as a *function of position*: across is frequency (on the Layout, log by default), up is
time (the newest at the top). Wire it into any field socket (ƒ) and that node reads it wherever it likes: **Height
Light**'s Height ƒ makes a lit landscape of the sound, **Ride a path**'s Path ƒ lets walkers ride where it equals Level,
**Sense**, **Shape Field** and **Grid Pattern** take it too. Used as a plain value it warps a picture (add it to a UV)
or thresholds into shapes (Step, Smoothstep). Its own settings (folded under *Field*): **Scale** zooms in (1 is the
whole history), **Offset X / Y** slide it (Y back in time), **Gain** multiplies it, **Edges** say what lies past the
history (Clamp, Repeat, Mirror). Scale, Offset and Gain are uniforms: they move without recompiling and Play can drive
them.

## Waveform
The sound itself, like an oscilloscope: the last few milliseconds across the picture. **Value** is the wave at this
pixel's left-right place, −1 to 1 (0 is silence). **Samples** sets how much sound fits across (1024 ≈ 21 ms).

## Audio → audio: Filter, Resonator bank, Spectral
These change the sound. Each takes **Audio** in and hands **Audio** on, so they chain:
*Audio Source → Filter → Resonator bank → Hit / Spectrum / …*. A node listening after an effect hears what the effect
made (a Spectrum after a low-pass Filter goes dark past the cutoff). Each also sends numbers for the picture.

**What you hear.** Each effect has **Listen** (on when you add it). The last node with Listen on in each chain plays
through the speakers; the effects before it, and the Audio Source's own sound, go quiet, so nothing plays twice. Turn
Listen off on every effect to hear the Audio Source as it is again. Two branches from one source, each ending in a
listening effect, both play. A Mic's chain is analysed but never played (it would feed back into the microphone). The
sound still follows the Audio Source's **Play** and the app's master volume, and is recorded with the songs.

**Live.** Every setting moves without recompiling (only a bank's Count recompiles). The numbers (Frequency, Resonance,
Root, Decay, Mix…) are uniforms too, so right-click → Play puts them on a Play control, and the sound follows it.

### Filter
**Type**: Low-pass (keeps what is under Frequency), High-pass, Band-pass, Notch, Peak. **Frequency** in Hz,
**Resonance** (Q: 0.71 smooth, higher rings at Frequency), **Gain** (Peak only, dB). The card draws the filter's curve
(0 dB in the middle, ±24 dB), filled as loud as the filtered sound: **drag across it** to sweep Frequency evenly
through the octaves. Outputs: **Audio**, **Level** (how loud the filtered sound is, 0–1).

### Resonator bank
4–12 tuned resonators that ring along with the sound, each when the sound has energy at its note. **Root** is the
lowest note as a MIDI number (45 = A2, 60 = C4); **Scale**: Minor, Major, Pentatonic, Minor pentatonic, Minor chord,
Major chord, Fifths (stacked), Harmonic series (the root × 1, 2, 3…). **Decay**: seconds a resonator rings (until 60 dB
down; longer is sharper and more singing). **Brightness**: 0.5 even, lower darkens the high notes, higher brightens
them. **Mix**: dry to all resonators. The card shows a bar per note with its name; the loudest is outlined.
Outputs: **Audio**, **Level**, **Energies 1–4**, **5–8**, **9–12** (vec4s: how hard each rings, 0–1, −60 dB to −10 dB),
**Loudest** (which one rings most, 0 is the root), **Peak** (its energy) and **Texture** (Count texels across, one per
note, for Sample (texture)).

### Spectral
Works on the spectrum (an FFT of 1024 samples, every 256). **Mode**: **Freeze** holds the sound as it was the moment
**Freeze** went on (each frequency keeps its loudness and goes on turning at its own rate: a drone) until it's off;
**Blur** smears each frequency over time (**Amount** 0 none … 0.99 a long wash); **Gate** keeps only the frequencies
louder than **Threshold** (dB; 0 is a full-scale tone). **Mix**: dry to all changed (the dry sound is delayed to line
up). It adds about 21 ms of delay. Outputs: **Audio**, **Level**, **Texture** (the spectrum of what comes out, 128 bins,
log). It runs in an AudioWorklet; where the browser has none, the sound passes through unchanged.

## Good to know
- Each card shows a small live readout: Audio Source's spectrum, a meter, a flash on each hit, the spectrum, the waterfall or the wave.
- The Audio examples open on the File tab with nothing loaded: load any song, or switch to Mic.
- Bands, the trim and the tab are saved with the graph.
- The Audio nodes work inside groups too (plain, iterated, and a group inside a group): wire an Audio Source's Audio
  into the group and on to the nodes inside, or keep the Audio Source inside. In an Agents group, keep the Audio nodes
  outside and wire their numbers in.
- **Web pages** exported from Playfield run the Audio nodes as the app does (the same sums, frame by frame): a File's
  sound travels in the page (up to 6 MB; a bigger one is listed as left out), and a Video's sound plays from its video
  (when that video is drawn in the picture, so the page carries it). Browsers only start sound after a tap, so the page
  shows **Tap to start sound** on the picture (a background page starts it on the first click or key, silently waiting
  until then). The Mic doesn't work on a web page: an Audio Source on its Mic tab stays silent there, and the export
  dialog says so. The effects run there too, with the same Web Audio graph (play/kit/audioChain.js) and the same rule
  for what is heard; a Play control on the page moves their numbers.
- Effects inside groups work as the listening nodes do: the chain follows the wire through group ports.
- A loaded sound is kept in this browser's library, with the videos. Graphs saved as a
  .playfield / .playfile carry the sound with them, like videos. On another computer without it, the card says
  *"name" isn't in this browser's library*: load it again. Graphs from before this change that used the built-in Test
  loop open on the File tab, empty.
- Stems on a web page: the picked stem travels with the song (see *Stems* above); the Mic and Video tabs have none.
- The old **Audio Input** node is retired: it's no longer in the node list, but graphs that use it still work.
