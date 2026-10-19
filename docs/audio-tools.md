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
- **Live** (the desktop app, Pro): a track in Ableton Live, through the **Playfield Send** plug-in (put it on the track;
  install it from Connect → Ableton · Audio). The tab lists every Playfield Send that is running, named after its track
  ("Live · Drums") when the Live connector is on, with a meter and its state (*Streaming*, *Paused in Live*, *Rendering
  in Live* while Live exports or freezes, which isn't sent). Pick one. A saved one that isn't running is listed as *Not
  found* and the card says *Waiting for Playfield Send 4821 (Drums)*, reading silence until it appears. It is never
  played to the speakers, so it has Play / Pause only, and an effect on it isn't heard either. Open ↗ adds a **Name**
  for a send the Live connector doesn't name (kept per Pairing ID), the stream's counters (buffer, drops, pads, gaps,
  dropouts) and the **Cushion** (how much audio the page keeps in hand, 30 ms by default, 10–100). It arrives about
  40–70 ms after Live plays it; **Sync offset** lines it up. Hidden in the browser; an exported page listens to the
  visitor's microphone in its place. See docs/playfield-send-plan.md.

- **The transport** (the top row of the card, and of the Open ↗ window; it stays on the card when you fold it):
  - **Play / Pause**: plays the file or the video's sound, or listens to the Mic. Paused, nothing plays and nothing is
    analysed (every listening node hears silence).
  - **Restart**: back to the trim's In (a File) or the video's start, and plays.
  - **Mute**: silent, but still analysed: the bands, triggers, learned sounds and every listening node go on as if you
    heard it. For pictures that move to a song you don't want to hear.
  - **Volume**: how loud you hear it. It acts after the analysis, so moving it moves no trigger.
  - The Mic and a Live track are never played to the speakers (the Mic would feed back; Live plays the track itself), so they have Play / Pause only.
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
- **Add a band**: **Kick**, **Snare**, **Hats**, **Notes** (each sends its hits and how loud it is, with that preset
  set), then **Sub**, **Bass**, **Vocals**, **Air** (how loud they are). Double-clicking the spectrum adds a **Custom
  band** there.
- **Each band** is one line (components/audio/BandRow.tsx): its colour and name, its range as a chip (*40–130 Hz*:
  drag its handle on the spectrum, or set its edges under Fine-tune), **What to catch** (see below), **Sensitivity**,
  and what it sends:
  - **Send a value**: how loud the band is, 0–1 (its energy from −60 dBFS to 0 dBFS), with a little meter;
  - **Send hits**: 1 for one frame on each hit, exactly what Envelope (Trigger mode), Counter and Sample & Hold count,
    with a light that blinks on each;
  - or both. Under it is the band's **scope** (below), and **Fine-tune**, folded, with a one-line summary of anything
    changed from the preset (open or folded is remembered for each band on this device).

Every band becomes an **output on the Audio Source**, named after it: *Bass* for its value, *Kick (trigger)* for its
hits. Wire *Kick (trigger)* straight into an Envelope's Gate for a pulse on every kick. Removing a band (or switching
off what it sends) takes its output away, and the wires from it go too.

Moving a band or the trim, Sensitivity and every Fine-tune setting change the picture at once without recompiling;
adding, removing or renaming a band recompiles (its outputs change).

If you hear nothing, click anywhere in the app: browsers only start sound after a click.

### What to catch, and Sensitivity
**What to catch** is the band's preset. Each sets the band and how hits are found in it:

| What to catch | Band | Listens for | Shortest gap | Ignores quieter than |
|---|---|---|---|---|
| **Kick** | 40–130 Hz | each kick, even over a held bass line | 60 ms | −55 dBFS |
| **Snare** | 150–300 Hz and 2–5 kHz together (body and crack) | snares and claps (noisy hits only) | 60 ms | −55 dBFS |
| **Hats** | 6–16 kHz | hi-hats and shakers, quiet and fast (noisy hits only) | 40 ms | −60 dBFS |
| **Notes** | 200 Hz–4 kHz | each new note; a held note or its vibrato doesn't fire again (tonal hits only) | 80 ms | −55 dBFS |
| **Custom band** | the one you drew | any new sound in it | 50 ms | −55 dBFS |

**Sensitivity** (0–1, 0.5 is the preset as tuned) is the one knob: higher catches quieter hits too, lower only the
clearest. Under the hood it scales how far a hit must stand out (δ, below): × 2 at 0, × ½ at 1.

**Fine-tune** has the rest, in plain words (each a ruler slider: drag, or click its number and type; typing past the
end widens it; double-click puts back the preset's):

- **Band edges** (Hz): nudge a preset's band for an unusual kit.
- **Shortest gap between hits** (ms): raise it if one drum fires twice, lower it for rolls.
- **Ignore quieter than** (dBFS): under this the band is silence: no hits, Value 0. **Learn noise** sets it just over
  a quiet stretch: on a File select one (Drag: Select) and press it; on the Mic or a Video, let it hear the quiet for two
  seconds first.
- **Track room noise** (Auto / On / Off): lifts that line to 10 dB over the noise it hears, followed as it changes (a
  room, a hissy line). Auto is on for the Mic and Live tracks, off for files and videos.
- **Only** (As the preset / Any / Noisy only / Tonal only) and **Noisy at**: keep only the hits whose new sound is noisy
  (drums) or tonal (notes), judged on the 5 ms after each.
- **The value sends** (Loudness / Brightness / Noisiness), **Smoothing in** / **out** (ms) and **Value gain**.

### How hits are found
One method for every band, the one onset-detection research and tools (madmom, librosa, aubio) settled on
(play/kit/audioTools.js "The hit detector"; the app and exported pages run the same code):

1. **A frame every 5 ms**: the last 1024 samples (2048 for a band reaching under 150 Hz, the Kick's: shorter windows
   make a low note's level ripple), Hann-windowed.
2. **Loudness in dBFS**: the band's energy (a full-scale sine is 0 dBFS). The Value maps −60 → 0 and 0 → 1; the
   silence line compares with it, on the same scale live and ahead.
3. **New sound** (the onset function): the band's frequencies through a small log-spaced filterbank, log-compressed
   (log(1 + λ·X)), and how much each rose since half a window ago (rises only, averaged). Notes and Custom bands first
   take the old frame's highest of three neighbouring filters, so a note bending in pitch doesn't count as new.
   It is divided by its own running maximum (falling over 2 s), never less than a floor and never less than what a 12
   dB jump would read at the band's current level, so a held note's ripple, a noise bed or silence stays near 0.
4. **A hit** is a frame that is the highest of the last 20–30 ms, at least δ above the average of the last 60–150 ms (δ
   is the preset's, scaled by Sensitivity), at least the shortest gap after the last hit, while the band is louder than
   its silence line (which closes 6 dB under it, after 80 ms). It fires on the rise, so a held sound fires once, and a
   kick over a held bass still stands out because the bass doesn't rise.

**The scope**, under each band, shows why: the new sound as a filled area (the band's colour) with the line it must
rise above (dashed), the band's loudness (grey) with its silence line (dotted) and the room's noise floor (faint, with
Track room noise on), and a tick on the top edge for each hit. Its caption counts **hits per pass** of a File (the
whole loop, from the file analysed ahead) or **hits per second** live, and says *listening* or *quiet — gate closed*.
A legend under it names each line.

**Never in silence.** Digital silence, −70 dBFS pink noise, −80 dBFS white noise, a held −30 dBFS chord and a held
−40 dBFS tone fire nothing on any preset (a test checks it, live and ahead).

**How fast.** A hit is decided about 15–22 ms after its onset (the window has to see it: 22 ms for the Kick's longer
window; Snare, Hats and Notes add 5 ms to judge noisy / tonal), and shows on the next frame the picture draws. A File's
hits are stamped where they are heard, so they land on the sound (see *Files* below).

**How well.** Measured on test songs with known onsets (lib/audioTools/__tests__/accuracy.test.ts: precision, recall and
F within ±30 ms; `ACCURACY_OUT=table.md` writes the table). On a real 120 BPM drum loop the Kick, Snare and Hats presets
reach F 1.00, 0.72 and 1.00 (the Snare also catches a percussion hit that isn't a snare); on the synthetic songs 0.74,
0.92, 0.77 and 1.00 for Notes. The hardest case is a bass line changing note under the kick: a new bass note is new
sound in the Kick's band too.

**Old graphs.** Bands from before open in today's terms: What to catch from their range and old Detect (Hits, Transient
and Drums only on a low band become Kick; a high band Hats; a band across body and crack Snare; Only tonal Notes),
Sensitivity from their old Sensitivity or read back off a v2 Threshold (Threshold = 0.7 − 0.4 × Sensitivity), or 0.5;
a Brightness or Noisy ↔ tonal band sends that as its value. The fixed Threshold, Release, Gate, Min ms and Cooldown
lines are gone: the preset sets them.

### Files: analysed ahead, fired as you hear them
A File's whole song is in memory, so its bands' frames are worked out **ahead**: once, over the whole file, in the
background (a few seconds for a long song; the window says *Analysing the file…*, then *Hits: the file analysed
ahead*). They are the very frames the live detector would see, so a File and the Mic agree. Each hit is then fired when
playback is **heard** reaching it, not when a frame happens to read the sound: the same at 30, 60 or 120 frames a
second, and lined up with the speakers. A Hit wired straight to a File works the same way. Changing Sensitivity, the
shortest gap, the silence line or Only re-picks the hits at once; moving a band's range or its preset analyses again
(the live frame stands in for the moment). Where playback is heard is read off the audio clock each frame; when that
clock steps back a little (it can, by a render quantum or when the browser's latency estimate changes) nothing is heard
twice: only a real loop round the end fires the start again. (Reading such a step as a loop used to fire every hit in
the file at once: the thousands of hits in silence.) The Mic and a Video are analysed live: each animation frame steps
the detector through every 5 ms of new sound, so it finds the same hits.

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
How loud one band of frequencies is, 0–1 (its energy from −60 dBFS to 0 dBFS, as a band's Value). Pick a **Band** (Sub, Bass, Low mid, Mid, High, Air) or *Custom* and
set **Low** and **High** in Hz. **Attack** and **Release** are rise and fall times in seconds: a slow Release
leaves a tail after each hit. **Gain** scales the result. **Peak** holds the highest Level for a moment, then falls.

## Hit
Finds hits: a kick, a snare, a hi-hat, each new note, with the same detector as a band (see *How hits are found*
above). Wired straight to a File it is analysed ahead.

- **Sound**: Kick, Snare, Hi-hat, Notes, Any, or Custom (**Low** to **High**): what to catch, with that preset.
- **Sensitivity**: how eager it is (0.5 is the preset as tuned).
- **Min interval** (ms) and **Silence gate** (dBFS): the shortest gap between hits and the level under which the band is
  silence (0: the Sound's own). **Track room noise**: Auto (on for the Mic and Live tracks), On or Off.
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
- On a web page the bands' hits are found live, with the same detector (each frame steps it through every 5 ms of new
  sound), held back by the page's output latency and the Sync offset; Volume and Mute travel too.
- The old **Audio Input** node is retired: it's no longer in the node list, but graphs that use it still work.
