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

- **The transport** (the top row of the card, and of the Open ↗ window; it stays on the card when you fold it):
  - **Play / Pause**: plays the file or the video's sound, or listens to the Mic. Paused, nothing plays and nothing is
    analysed (every listening node hears silence).
  - **Restart**: back to the trim's In (a File) or the video's start, and plays.
  - **Mute**: silent, but still analysed: the bands, triggers, learned sounds and every listening node go on as if you
    heard it. For pictures that move to a song you don't want to hear.
  - **Volume**: how loud you hear it. It acts after the analysis, so moving it moves no trigger.
  - The Mic is never played to the speakers (it would feed back), so it has Play / Pause only.
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
- **Bands, as an equaliser** (after FabFilter Pro-Q; components/audio/BandEqEditor.tsx): the live spectrum (log
  frequency 20 Hz – 20 kHz, a dB scale, a falling peak-hold line; hover shows the frequency and note, "440 Hz · A4").
  Each band is a numbered handle on its filled curve. **Double-click** to add a band there; drag a handle sideways
  for its frequency, up / down or scroll over it for its width (up narrows); click it for its floating panel:
  name, colour, Freq and Width (type, or drag the label), **Shape** (Band, Low cut = everything above, High cut =
  everything below), **Slope** (12 / 24 / 48 dB/oct), **Solo** (hear just that band), Delete. Keys: Delete,
  ← → a semitone (Shift: a third of an octave), ↑ ↓ width (a cut: slope), Esc. Delete removes the selected band
  wherever the focus is in the window (never the node behind it). A band's lo / hi are what it measures and are
  the −3 dB points of its curve: each curve is the exact response of the biquads Solo and Hear hovered play
  (lib/audioTools/bandFilter.ts), drawn against a 0 dB line near the top with a dB scale on the right (to −48):
  a Band peaks at 0 dB with Q = √(2^N)/(2^N − 1) for N octaves (0.1 oct is Q 14.4, a narrow spike), a cut is a
  Butterworth that is −3 dB at its corner and falls at its slope. The bright line is the bands together (the
  most any lets through). Bands saved before shapes open as Band.
- **Add a band**: Sub, Bass, Kick, Snare, Hi-hat, Vocals, Air. Kick, Snare and Hi-hat come as triggers with Hit's
  ranges (Threshold 0.5, 0.35 and 0.2: broad, noisy bands read lower); the others send their level.
  **Add a detector**: Kick, Snare, Hats, Melody notes: bands that listen for a kind of sound (see *Detect* below).
- **Each band** has a name and a colour, **Low** and **High** in Hz, its **Detect** (Level unless you pick another;
  see *Detect* below) and **Only**, its **Gate**, and what it sends out:
  - **Value**: the band's level, 0–1, with **Attack**, **Release** (rise and fall times in seconds) and **Gain**;
  - **Trigger**: 1 for one frame each time the band's level rises above its **Threshold** (see *Triggers* below),
    exactly what Envelope (Trigger mode), Counter and Sample & Hold count;
  - or both. The row shows the band's live level and flashes on each hit; a trigger band has its **trigger scope**
    under it.

Every band becomes an **output on the Audio Source**, named after it: *Bass* for a Value, *Kick (trigger)* for a
Trigger. Wire *Kick (trigger)* straight into an Envelope's Gate for a pulse on every kick. Removing a band (or
switching off what it sends) takes its output away, and the wires from it go too.

Moving a band or the trim, and its Attack / Release / Gain and trigger settings, change the picture at once
without recompiling; adding, removing or renaming a band recompiles (its outputs change).

If you hear nothing, click anywhere in the app: browsers only start sound after a click.

### Triggers: a line that stays put
A trigger (a band's, and Hit's) watches the band's **level** (0–1, the same number its Value shows before Attack /
Release / Gain), or what its Detect picked (see *Detect* below), against lines that never move:

- **Threshold**: it fires when the level rises above this line.
- **Release** (× Threshold, 0.8 to start): it re-arms only once the level falls back below Threshold × Release. A held
  note, a swell or a level wobbling round the line fires **once**, not again and again. Nearer 1 re-arms sooner (for
  kicks over a busy bass line); lower needs a deeper dip.
- **Gate**: below it the band is **silence**: its Value reads 0 and nothing fires, so hiss, hum or a noise bed never
  triggers. It closes only after the level has stayed under it for 80 ms, so noise hovering round it doesn't flicker.
  **Learn noise** sets it for you: on a File, select a quiet stretch (Drag: Select) and press it; on the Mic or a Video,
  let it play the quiet for two seconds first. The Gate goes just over the loudest of that noise.
- **Min ms** (10 to start): how long the level must stay above Threshold to fire, so one noisy blip doesn't. At 60
  frames a second one frame is already 17 ms, so live it only matters at higher Min ms; a File's analysis (every 5 ms)
  uses it fully.
- **Cooldown**: the shortest gap between two hits. A rise inside it is ignored (not fired late).

**The trigger scope**, under each trigger band in the window, is how you tune it by eye: the last five seconds of the
level it measures (newest on the right), the **Threshold** (solid, the band's colour), **Release** (dashed) and
**Gate** (grey, with the silence shaded under it), and a yellow tick wherever it fired. **Drag a line** up or down to
move it (it picks the nearest). The top-left says whether the gate is open, whether it is armed, and how many hits so far.
Aim for: one tick per drum hit, the Threshold under the hits' peaks, the Gate over the noise floor between them.

### Detect: what a band listens for
A band's **Detect** picks what its Value sends and its Trigger fires on. The Threshold, Release, Min ms and Cooldown work
on that number the same way; the **Gate** still reads the band's *level* (below it the band is silence, whatever it
detects). Every choice is a number 0–1 (play/kit/audioTools.js "Detect"; the app and exported pages run the same code):

- **Level** (the default; every band from before is Level): how loud the band is, as above.
- **Hits**: onsets. How much the band's bins rose since the last frame (spectral flux: only rises count, on
  log-compressed magnitudes), measured against the band's own recent average (half a second) and its loudness now:
  flux ÷ (flux + 3 × recent average + 0.02 × loudness). 0.5 means "three times as much new sound as lately". A held note
  has no flux, so a kick over a held bass line reads near 1 at each kick and near 0 between, where Level stays over its
  line and merges the kicks into one.
- **Transient**: attack sharpness. How far the band's level (in dB) jumped above a slow follower of itself (0.1 s), over
  15 dB. A click, a snap or a drum reads 1; a swell that rises 50 dB a second stays under 0.4.
- **Noisy ↔ tonal**: spectral flatness of the band (the geometric over the arithmetic mean of its bins' power, in dB,
  over 30 dB): 0 is a pure tone, about 0.9 white noise, silence 0. Hats, snares and breath read high, chords and notes
  low. It needs a band a few FFT bins wide (a bin is about 23 Hz).
- **Brightness**: where the band's energy sits: its spectral centroid, on a log scale from the band's bottom (0) to its
  top (1). A filter opening reads as a rising line.
- **Drums only**: separates the drums from sustained sound first (harmonic / percussive separation: across time a
  held note is steady, across frequency a hit is broad; a median each way and a soft mask), then finds Hits on the
  drums alone. A bass line changing note under the kick is ignored; Hits would fire on every new note. A snare's low end
  is a drum too, so it can fire a Kick band: narrow the band or raise the Threshold if it does.

**Only** (Any / Noisy / Tonal), on Level, Hits, Transient and Drums only: lets a hit through only when what *arrived* in
the band just after it (its bins' rises over the next 40 ms, weighted by how much rose) is noisy (drums, hats, snares)
or tonal (melodic notes). **Noisy at** (0.3 to start) is the line on that flatness. A live hit waits those 40 ms to be
judged (a File's are judged ahead, so they don't). Only never touches the Value.

**The scope** draws the number Detect picked in the band's colour, with the level faint behind it (what the Gate
reads). A band that sends only a Value and detects a feature gets a scope too (its Gate line is the only one to drag).

**Add a detector** (under *Add a band*) adds bands with their Detect set: **Kick** (Drums only, 30–150 Hz), **Snare**
(Drums only, noisy hits only, 150 Hz–5 kHz), **Hats** (Hits, noisy only, 6–16 kHz), **Melody notes** (Hits, tonal only,
200 Hz–2 kHz). Each is a trigger with Threshold 0.5 and Min ms 0.

**File, Mic, Video, web page.** A File is analysed ahead with the same sums every 5 ms (each flux compares with the
moment ~15 ms before, about a live frame), and its hits fire as they are heard. Drums only differs there: ahead, the
"held note" median is centred on each moment (0.1 s either side), so it sees how long a sound lasts both ways; live
(Mic, Video and every web page, even for a File) it can only look back (the last 0.2 s), so a note that has just started
looks "new" for a moment more. Hits, Transient, Noisy ↔ tonal and Brightness read the same live and ahead within a few
hundredths (the tests check it); live hits come a frame or so later, as before. The Value is always read live.

Graphs from before this change had a **Sensitivity** (a moving threshold). They open with a Threshold in its place
(0.5 for the old default; higher sensitivity is a lower line: 0 → 0.7, 1 → 0.3) and Release 0.8; a band that sent a
Value keeps no Gate, so its Value reads as it did.

### Files: analysed ahead, fired as you hear them
A File's whole song is in memory, so its trigger bands are worked out **ahead**: once, over the whole file, in the
background (a few seconds for a long song; the window says *Analysing the file…*, then *Triggers: analysed ahead*).
Each hit is then fired when playback is **heard** reaching it, not when a frame happens to read the sound: the same at
30, 60 or 120 frames a second, and lined up with the speakers. A Hit wired straight to a File works the same way.
Changing a Threshold, Release, Gate, Min ms, Cooldown or Only re-picks the hits at once; moving a band's range or
changing its Detect analyses that range again (the live frame stands in for the moment). The Mic and a Video are analysed live, frame by frame, with the
same Threshold, Release, Gate and Min ms.

**Latency.** The browser plays a sound a little after it renders it (a few ms wired, 150–250 ms on Bluetooth or
AirPlay). A File's hits are timed to when the speakers play them (the browser's own output latency, shown as
*output N ms* in the window); a Video's hits are held back by that much too. **Sync offset** (ms, in the window)
nudges them further: **+** if the picture still comes early, **−** if late. The Mic is heard in the room, so only a +
offset applies to it.

### Separate (removed)
Splitting a song into stems is gone. A graph that had a stem picked opens on the full mix and works as before; stems
already kept in the library stay there (they are not listed with the sounds). The research notes are in
[reports/stems-research.md](reports/stems-research.md).

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
Finds hits: a kick, a snare, a hi-hat. It fires each time its band's level rises above a fixed **Threshold**, as a
band's trigger does (see *Triggers: a line that stays put* above). Wired straight to a File it is analysed ahead.

- **Sound**: Kick, Snare, Hi-hat, Any, or Custom (**Low** to **High**).
- **Threshold**, **Release** (× Threshold), **Gate**, **Min time** (ms): the lines it fires on.
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
  into the group and on to the nodes inside, or keep the Audio Source inside. In an Agents group the Audio nodes work
  too (Band level, Hit, an Audio Source's bands drive the walkers: the agents' program shares the preview's live
  values): keep the Audio Source inside, or add a **Sound** input on Agent Inputs (+ Add an input from outside),
  wire the Audio Source outside into that socket on the group card, and the port into the Audio nodes inside.
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
- On a web page the triggers run live, frame by frame (the same Threshold, Release, Gate and Min ms), held back by the
  page's output latency and the Sync offset; Volume and Mute travel too.
- The old **Audio Input** node is retired: it's no longer in the node list, but graphs that use it still work.
