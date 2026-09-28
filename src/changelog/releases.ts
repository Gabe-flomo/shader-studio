/**
 * Release notes: what's new in each update, newest first. Shown in the History panel's
 * What's new view; the newest id is also the app's version (package.json and
 * src-tauri/tauri.conf.json), which a test checks. How to add one: docs/release-notes.md.
 *
 * Ids are calendar versions, `YEAR.MONTH.N`: the Nth release of that month (2026.9.7 is the
 * seventh in September 2026). They are valid semver with no leading zeros, so the desktop
 * build accepts them, and they sort as numbers, part by part.
 *
 * Write for the person using the app, not the commit log: one line per highlight, what they
 * can do now, in their words.
 */
import type { Page } from '../components/page';

export type ReleaseArea = 'Studio' | 'Play' | 'Present' | 'Learn' | 'Files' | 'Desktop' | 'Phone' | 'Account';

export type ReleaseLink =
  /** A bundled example (a key of EXAMPLE_INDEX); `page: 'play'` opens it on the Play page. */
  | { kind: 'example'; key: string; page?: 'studio' | 'play'; label?: string }
  /** One of the app's pages. */
  | { kind: 'page'; page: Page; label?: string }
  /** A doc in the repository's docs/ folder, opened on GitHub. */
  | { kind: 'doc'; path: string; label?: string };

export interface ReleaseHighlight {
  area: ReleaseArea;
  text: string;
  link?: ReleaseLink;
}

export interface Release {
  /** `YEAR.MONTH.N`, see above. */
  id: string;
  /** ISO date, `2026-09-27`. */
  date: string;
  title: string;
  highlights: ReleaseHighlight[];
}

export const RELEASES: Release[] = [
  {
    id: '2026.9.18',
    date: '2026-09-28',
    title: 'Granulator: Emit and Spectral',
    highlights: [
      { area: 'Play', text: 'Granulator Emit mode: grains shoot from spawn points that travel through the sample, forwards, backwards or both, and wrap, bounce or jump at the ends.', link: { kind: 'doc', path: 'docs/granulator.md' } },
      { area: 'Play', text: 'Granulator Spectral mode: grains play frequency bands, not slices; drag the band on the spectrogram, and each grain\'s band and energy can drive the picture.', link: { kind: 'doc', path: 'docs/granulator.md' } },
      { area: 'Play', text: 'Grains → nulls puts the nulls in their own folder, and layers you add later stay out of it.' },
      { area: 'Play', text: 'The granulator\'s generated samples are down to the pad chord; setups that used the others play the pad chord.' },
    ],
  },
  {
    id: '2026.9.17',
    date: '2026-09-28',
    title: 'Plug-ins that talk back, quick links, one Controls tab',
    highlights: [
      { area: 'Files', text: 'Save a set of layers with their mappings, controls and actions, and racks as presets; both load back from Add layer, Add track or Files.', link: { kind: 'doc', path: 'docs/presets.md' } },
      { area: 'Play', text: 'Matte the picture with any layer (a shape, a path, a hand path), with Invert and a soft edge. Start over clears Play in one undoable step.' },
      { area: 'Play', text: 'Arrangement: Play/Pause runs the picture too, the timeline scrubs (|◀ ◀◀ ▶▶ ▶|, Home/End, editable bar.beat), and devices fold to a header.' },
      { area: 'Desktop', text: 'Move a rack control and the plug-in\'s own knob follows; A–K keep playing notes while the plug-in window is in front.', link: { kind: 'doc', path: 'docs/audio-engine.md' } },
      { area: 'Play', text: 'Quick link: ⌘-click one control, then another, and pick the direction to map them — an audio reader onto a radius in two clicks.' },
      { area: 'Play', text: 'Controls and Mappings share one rail category with tabs; ⌘1–4 jump to Controls, Layers, Finish and Engine.', link: { kind: 'doc', path: 'docs/split-view.md' } },
      { area: 'Play', text: 'The script editor keeps the caret where you click after scrolling; the Keyboard and Hands pills no longer cover the top bar.' },
    ],
  },
  {
    id: '2026.9.16',
    date: '2026-09-28',
    title: 'Signals from every particle, rail tabs, recovery',
    highlights: [
      { area: 'Play', text: 'The Audio engine is one Arrangement view, laid out like Ableton: tracks with audio-style clips, a device chain per track, listeners as devices, one Play/Pause.', link: { kind: 'doc', path: 'docs/arrangement.md' } },
      { area: 'Play', text: 'Every particles layer and Agents can send a Born and a Died signal, and reads how many were born or died this step.', link: { kind: 'doc', path: 'docs/particles-multiply.md' } },
      { area: 'Play', text: 'Rail categories open straight to their pages, shown as tabs in the panel header; ⌘⇧M jumps to Mappings from anywhere.', link: { kind: 'doc', path: 'docs/split-view.md' } },
      { area: 'Files', text: 'Autosave: the open project is saved aside every 5 minutes (or every minute, or on every change) in Files → App settings.', link: { kind: 'doc', path: 'docs/crash-recovery.md' } },
      { area: 'Files', text: 'If Playfield closes unexpectedly, the next launch offers to recover what you hadn\'t saved, untitled or not.', link: { kind: 'doc', path: 'docs/crash-recovery.md' } },
      { area: 'Desktop', text: 'Plug-ins load in their own process where macOS allows, so a crashing one takes itself down, not Playfield.', link: { kind: 'doc', path: 'docs/audio-engine.md' } },
      { area: 'Desktop', text: 'A new or updated plug-in is tried out safely first; one that crashes is switched off with a Try again button instead of crashing the app.', link: { kind: 'doc', path: 'docs/audio-engine.md' } },
    ],
  },
  {
    id: '2026.9.15',
    date: '2026-09-28',
    title: 'Agents',
    highlights: [
      { area: 'Play', text: 'Pausing time (Space) now freezes the layers too — agents, particles and relationships hold still until you play again.' },
      { area: 'Play', text: 'The Layers page has a draggable divider between the list and the editor.' },
      { area: 'Desktop', text: 'Configure by touch: turn a knob in the plug-in\'s own window and it becomes a rack control, like Ableton. The full list is still a click away.', link: { kind: 'doc', path: 'docs/audio-engine.md' } },
      { area: 'Play', text: 'The Signals page now shows which layers send a signal (Multiply, Relationship, Increment) and who listens.' },
      { area: 'Play', text: 'A Function source: type a formula of t (seconds) and b (beats) — sin(t*2)*0.5+0.5, fract(b/4), noise(t) — and map it like any source.' },
      { area: 'Play', text: 'Goo edges are sharp at any size, and Agents gravity is ten times gentler so the whole slider is usable.' },
      { area: 'Studio', text: 'The preview bar follows the theme in light mode.' },
      { area: 'Play', text: 'An Agents layer: a crowd of entities steered by a stack of rules (seek, flee, flock, orbit, gravity, springs, fields), with Boids and Predator-prey presets.', link: { kind: 'example', key: 'playBoids', page: 'play' } },
    ],
  },
  {
    id: '2026.9.14',
    date: '2026-09-28',
    title: 'Less on screen at once',
    highlights: [
      { area: 'Play', text: 'Editors open collapsed: one main section, the rest folded to a one-line summary. Expand all or fold all; each section remembers.' },
      { area: 'Files', text: 'Sample browsers audition like Splice: arrow down plays the next sound, left restarts, right skips 3 s, Enter picks. Auto-preview can be turned off.' },
      { area: 'Play', text: 'Multiply particles that annihilate now just meet and vanish, with no burst.', link: { kind: 'doc', path: 'docs/particles-multiply.md' } },
      { area: 'Studio', text: 'The top bar fits narrower windows: labels drop first, rarely used buttons fold into a ··· menu, and nothing runs off the edge.' },
      { area: 'Play', text: 'Increment mappings: move a control in steps on a beat, a signal or a threshold; steps can compound, glide, wrap back, and each step sends a signal.', link: { kind: 'example', key: 'playIncrement', page: 'play' } },
      { area: 'Play', text: 'The Play page opens in the split view with the icon rail.' },
      { area: 'Studio', text: 'Sliders no longer recompile the shader: whole-number sliders and sliders inside scene groups and march loops update live.' },
      { area: 'Play', text: 'Multiply particles: a Fullness control sets how much of the colony is alive; Multiply and Cull actions; split, full, annihilate and cleared signals.' },
    ],
  },
  {
    id: '2026.9.13',
    date: '2026-09-28',
    title: 'The Granulator',
    highlights: [
      { area: 'Play', text: 'A Granulator instrument in the Audio engine, modelled on Granulator III: Classic, Flux and Cloud modes, up to 64 grains, playable from MIDI or the keyboard.', link: { kind: 'example', key: 'granulator', page: 'play' } },
      { area: 'Play', text: 'Grains drive visuals (count, position, spread as sources; grains onto nulls), and a layer can drive grains: particles inside a boundary shape become grains.' },
      { area: 'Play', text: 'Big layer editors in the split view share one layout: a section strip to jump around, tidier rows, and labels that wrap instead of overflowing.' },
      { area: 'Desktop', text: 'Plug-in windows open at the plug-in\'s own size, resize only where the plug-in allows, and remember where you left them.' },
      { area: 'Files', text: 'Linked folders: point the app at folders on your disk, and every picker (pads, video, images, fonts, songs) reads from them without copying.', link: { kind: 'doc', path: 'docs/linked-folders.md' } },
      { area: 'Play', text: 'The Audio engine has a tape: record each rack on its own track, overdub, punch in with a count-in, up to 60 s, and render it. One lead rack takes the MIDI.', link: { kind: 'doc', path: 'docs/arrangement.md' } },
      { area: 'Play', text: 'Split view: fold the sidebar into an icon rail, pages take the full width, and Controls show live graphs grouped by rack, layer or reader.', link: { kind: 'doc', path: 'docs/split-view.md' } },
      { area: 'Play', text: 'A relationship\'s members nest under it in the Layers list, with role chips.' },
    ],
  },
  {
    id: '2026.9.12',
    date: '2026-09-28',
    title: 'A Files home, readers as controls, a private file format',
    highlights: [
      { area: 'Files', text: 'Files opens on a home: activity for the week with a calendar, a carousel of your recent work as pictures, and what you use most.', link: { kind: 'doc', path: 'docs/files-page.md' } },
      { area: 'Files', text: 'Item and node pages: code folded small, a live preview with sliders, where it\'s used, and Insert into the graph.' },
      { area: 'Play', text: 'Every audio reader is now a control in an "Audio readers" group, with live meters on the rack, video and drum pad cards, and names by band (Lows, High mids…).', link: { kind: 'doc', path: 'docs/audio-readers.md' } },
      { area: 'Files', text: '.playfile is a Playfield-only file now: not a ZIP anyone can open; tampered files are refused; old files still open.', link: { kind: 'doc', path: 'docs/playfile-format.md' } },
      { area: 'Studio', text: 'The Convert and GLSL pages show the full canvas with its toolbar, with a Source / Converted / Split wipe on Convert.' },
      { area: 'Desktop', text: 'The projection editor\'s preview draws live, and corner handles stay reachable off the edge.' },
      { area: 'Play', text: 'Relationship layer: make layers chase, flee, repel or attract each other, climb or avoid bright areas, and read back distance and closing speed.' },
      { area: 'Play', text: 'Particles can Multiply: one buds into many, with an optional Goo look and annihilate-and-regrow loops.', link: { kind: 'example', key: 'playMultiply', page: 'play' } },
    ],
  },
  {
    id: '2026.9.11',
    date: '2026-09-28',
    title: 'MIDI that just works, undo on Play, and sound in renders',
    highlights: [
      { area: 'Play', text: 'A new knob mapping learns the first knob you turn; Lock ties it to one device. Velocity and gate rows can learn a note.', link: { kind: 'doc', path: 'docs/midi.md' } },
      { area: 'Desktop', text: 'Controllers like the Akai MPK mini now work: a rewritten MIDI bridge, plus a Monitor that shows every device and what it sends.' },
      { area: 'Desktop', text: 'Audio engine racks can take the computer keyboard (a toggle on the rack, Esc gives it back).', link: { kind: 'doc', path: 'docs/audio-engine.md' } },
      { area: 'Desktop', text: 'The Audio engine\'s sound is in recordings and rendered takes, and a web sound can be sent through Audio Unit effects.' },
      { area: 'Play', text: 'Undo and redo on the Play page (⌘Z, ⌘⇧Z), with every edit in History → Changes.' },
      { area: 'Present', text: 'Present, Stage and exported websites recover when the browser drops the graphics context.' },
      { area: 'Studio', text: 'Sliders: type a number past the end and the range grows to it; right-click is back to the Play and knob menu.' },
    ],
  },
  {
    id: '2026.9.10',
    date: '2026-09-28',
    title: 'Projectors, Audio Units, and a better phone',
    highlights: [
      { area: 'Desktop', text: 'An output window for a projector or second display, with projection mapping: corner pins, mesh warps, masks, edge blends and test patterns.', link: { kind: 'doc', path: 'docs/projection.md' } },
      { area: 'Desktop', text: 'The Audio engine: Audio Unit synths and effects on a Mac, played from MIDI or the keyboard, with reader dots on each rack\'s spectrum, and a Plugins setting.', link: { kind: 'doc', path: 'docs/audio-engine.md' } },
      { area: 'Desktop', text: 'MIDI controllers work in the desktop app through a native bridge; knob lock, note ranges and pad grids come along.', link: { kind: 'doc', path: 'docs/midi.md' } },
      { area: 'Phone', text: 'Turning the phone sideways keeps the phone layout, with a full-screen picture on Play; turning back restores it inside the safe area.' },
      { area: 'Phone', text: 'Audio pickers open Files (not the video picker), the drum pads open in the split view or a sheet, and the Record dialog fits the screen.' },
      { area: 'Play', text: 'Drum pads: save and load kits, Stop only while a sound plays, tap an empty pad to add a sound; a storage limit with a meter on Files.', link: { kind: 'example', key: 'drumPads', page: 'play' } },
      { area: 'Present', text: 'Capture a background: the time slider responds at once and settles when you let go.' },
      { area: 'Studio', text: 'The Palette node edits its stops on a gradient bar, like the Present picker, so the card stays one bar tall.' },
    ],
  },
  {
    id: '2026.9.9',
    date: '2026-09-27',
    title: 'p5 sketches, conditions, MIDI grids and sound effects',
    highlights: [
      { area: 'Play', text: 'Import p5.js sketches (paste, files or a folder) into Script layers, with tabs, a Console and "Make it a control".', link: { kind: 'example', key: 'p5MultiFile', page: 'play' } },
      { area: 'Play', text: 'Conditions and signals: act when any value crosses a threshold, and chain actions with named signals.', link: { kind: 'example', key: 'playConditions', page: 'play' } },
      { area: 'Play', text: 'Pair two controls into one (an XY pad for positions), affect X, Y or both, and swap axes at a threshold.', link: { kind: 'example', key: 'playPairs', page: 'play' } },
      { area: 'Play', text: 'MIDI: lock a mapping to one knob, set a note range from two keys, and map Push or Launchpad pads to grid cells.', link: { kind: 'example', key: 'playPadGrid', page: 'play' } },
      { area: 'Play', text: 'Sound effects: filter, echo, reverb, distortion and compressor chains on any sound, mappable and in renders.', link: { kind: 'example', key: 'audioEffects', page: 'play' } },
      { area: 'Play', text: 'Finish: an animatable before/after wipe, stack presets, and your own effects written as code.' },
      { area: 'Present', text: 'Add code from your own GLSL, a function, a node or a shader, with live plots and previews; full screen for slides and the canvas.' },
      { area: 'Files', text: 'A Notes section with every note and comment, readable App settings, a pop-out node pack builder, and History as cards.' },
    ],
  },
  {
    id: '2026.9.8',
    date: '2026-09-27',
    title: 'Finishing, one file format, and linked lessons',
    highlights: [
      { area: 'Play', text: 'Finish stack: grade the whole picture (curves, colour wheels, split tone, looks) with lens, CRT, grain and bloom.', link: { kind: 'example', key: 'finishGrade', page: 'play' } },
      { area: 'Play', text: 'Halation that behaves like film: lamps glow red to white and grow, white paper stays clean.', link: { kind: 'example', key: 'finishHalation', page: 'play' } },
      { area: 'Play', text: 'Time displacement: parts of the picture show older frames, as a slit-scan, by brightness or through a shape.', link: { kind: 'example', key: 'finishTime', page: 'play' } },
      { area: 'Files', text: 'One file format, .playfile: every download offers it, and it brings along the nodes, functions and images it needs.', link: { kind: 'doc', path: 'docs/playfile-format.md' } },
      { area: 'Files', text: 'Node packs can be signed by their maker and sealed so their code stays hidden.' },
      { area: 'Present', text: 'Link a graph to its presentation: loading one offers the other.' },
      { area: 'Play', text: 'Videos in the Library, drag-and-drop images and videos onto Play, and video sound in rendered takes.' },
    ],
  },
  {
    id: '2026.9.7',
    date: '2026-09-27',
    title: 'Sign-in, plans, and video with sound',
    highlights: [
      { area: 'Account', text: 'Sign in to Playfield. Free and Pro plans, with Pro features marked where you meet them.' },
      { area: 'Play', text: 'Video layer: drop in a video and its sound feeds the audio readers.', link: { kind: 'example', key: 'playVideoSound', page: 'play' } },
      { area: 'Play', text: 'Audio readers: place dots on a live spectrum; each one is a source and a trigger.', link: { kind: 'example', key: 'playAudioReaders', page: 'play' } },
      { area: 'Play', text: 'Hand paths: shapes whose corners follow your fingertips.', link: { kind: 'example', key: 'handPaths', page: 'play' } },
      { area: 'Play', text: 'Blend modes like Multiply and Difference now mix with the shader, not only with other layers.' },
      { area: 'Play', text: 'Split view (⌘⇧L): a big Controls, Layers or Mappings panel beside the picture, and a grouped, searchable Source picker.' },
      { area: 'Present', text: 'Themes (Classic, Landing, Article, Portfolio) you can tweak and save, and Google Fonts by pasting a link.', link: { kind: 'page', page: 'present' } },
      { area: 'Studio', text: 'Turning a slider off freezes it at the value it has right now.' },
    ],
  },
  {
    id: '2026.9.6',
    date: '2026-09-27',
    title: 'Files, data, and mattes',
    highlights: [
      { area: 'Files', text: 'The Files page: see, clean up, download and install everything you’ve saved.', link: { kind: 'page', page: 'files' } },
      { area: 'Files', text: 'Workspace folder: keep your work as real files, shared by the desktop app and the browser.', link: { kind: 'doc', path: 'docs/workspace-folder.md' } },
      { area: 'Play', text: 'Data layer: draw a dataset as points, paths, bars, pies or lines, and step through it.', link: { kind: 'example', key: 'dataCityBars', page: 'play' } },
      { area: 'Studio', text: 'Datasets can be typed in, fetched from a link or Kaggle, or streamed live, and read by the Data node.', link: { kind: 'example', key: 'dataWeatherYear' } },
      { area: 'Play', text: 'Track mattes and masks for every layer, After Effects style.', link: { kind: 'example', key: 'maskReveal', page: 'play' } },
      { area: 'Play', text: 'Layer groups in the Layers list (⌘G), like group tracks.' },
      { area: 'Play', text: 'Choose your camera (built-in, iPhone, capture card) and its resolution; steadier hands and a Hands light in the top bar.' },
      { area: 'Present', text: 'Backgrounds per step (colour, gradient, image or a capture from a graph), legibility blur and Google Fonts.' },
    ],
  },
  {
    id: '2026.9.5',
    date: '2026-09-27',
    title: 'Hand tracking and the Background layer',
    highlights: [
      { area: 'Play', text: 'Hand tracking: fingertips, pinches and gestures drive anything, all on your device.', link: { kind: 'example', key: 'handFingertips', page: 'play' } },
      { area: 'Play', text: 'Background layer: a queue of shaders, sketches, images and videos under every layer.', link: { kind: 'example', key: 'bgQueue', page: 'play' } },
      { area: 'Play', text: '3D Script layers: p5-style boxes, spheres and lights on three.js.', link: { kind: 'example', key: 'script3DShapes', page: 'play' } },
      { area: 'Play', text: 'Proximity triggers fire when two things come close; triggers can fire once, continuously, every N or on release.', link: { kind: 'example', key: 'playProximity', page: 'play' } },
      { area: 'Play', text: 'Add layer is a grouped, searchable menu, with folders for your own layer kinds.' },
      { area: 'Studio', text: 'History: every change named, with Restore to here, and every notice kept in Activity.' },
      { area: 'Studio', text: 'Rebuild (⌘⇧↵) recompiles and resets the GPU; the preview recovers from a lost GPU on its own.' },
      { area: 'Desktop', text: 'The desktop app can use the microphone for Live audio.' },
    ],
  },
  {
    id: '2026.9.4',
    date: '2026-09-27',
    title: 'Learn with The Book of Shaders',
    highlights: [
      { area: 'Learn', text: 'Learn follows The Book of Shaders chapter by chapter: 42 short lessons, each credited to its section.', link: { kind: 'example', key: 'learnColour' } },
      { area: 'Present', text: 'Sample presentations that teach the app: getting started, your first Play, field sockets and more.', link: { kind: 'page', page: 'present' } },
      { area: 'Present', text: 'Presentations are files: an Open list, a save state, download and import.' },
      { area: 'Play', text: 'Save a Script sketch as your own layer kind, plus eight new Script examples.', link: { kind: 'example', key: 'scriptFirst', page: 'play' } },
      { area: 'Studio', text: 'Expression knobs: a new name in an input expression becomes a slider.', link: { kind: 'example', key: 'playExprKnob', page: 'play' } },
      { area: 'Studio', text: 'Field sockets work inside groups.', link: { kind: 'doc', path: 'docs/field-sockets.md' } },
      { area: 'Studio', text: 'Convert handles vec4, swizzles, rotations and discard, and turns uniforms into Play controls.' },
      { area: 'Studio', text: 'Grid and Grid Pattern: Columns now counts the columns you see (old graphs keep their look).' },
    ],
  },
  {
    id: '2026.9.3',
    date: '2026-09-26',
    title: 'The Present page and recorded performances',
    highlights: [
      { area: 'Present', text: 'The Present page: teach with Plays in steps (text and maths, live canvases, code) as slides or a scroll, and export a web page.', link: { kind: 'doc', path: 'docs/present-guide.md' } },
      { area: 'Present', text: 'Live script blocks, camera and sound on steps, and the Stage from any step.' },
      { area: 'Play', text: 'Record a performance: play live for up to a minute, watch it back, render it.', link: { kind: 'example', key: 'playTake', page: 'play' } },
      { area: 'Play', text: 'Rendered takes match what you played: feedback, echo and particles included.' },
      { area: 'Play', text: 'Exported web pages run feedback, echo, GPU particles and image, video and audio inputs.' },
      { area: 'Studio', text: 'A Grid tour: eight numbered Grid examples.', link: { kind: 'example', key: 'gridTourBuiltIn' } },
    ],
  },
  {
    id: '2026.9.2',
    date: '2026-09-25',
    title: 'Examples, palettes, and MIDI',
    highlights: [
      { area: 'Play', text: 'MIDI Input node: play the shader from a controller, or from the computer keyboard.', link: { kind: 'example', key: 'midiGlowKeys' } },
      { area: 'Studio', text: 'Node Builder: publish groups, graphs and GLSL as your own node types.' },
      { area: 'Studio', text: 'The examples, pruned and filed in folders, with new pattern nodes and a preview that explains itself.' },
      { area: 'Studio', text: 'Palette tools: paste, presets, up to 32 stops and a Curve blend; new Colorize and Stops Palette nodes.', link: { kind: 'example', key: 'colorStopsCycle' } },
      { area: 'Studio', text: 'Voxelize, SDF Fill and smart connect; an outline view and a performance panel.', link: { kind: 'example', key: 'voxelTerrain' } },
      { area: 'Studio', text: 'Audio Input reaches the shader again.' },
      { area: 'Studio', text: 'Thin, translucent scrollbars.' },
    ],
  },
  {
    id: '2026.9.1',
    date: '2026-09-24',
    title: 'A new look',
    highlights: [
      { area: 'Studio', text: 'Redesigned throughout: light and dark themes, new node cards, pages and dialogs.' },
      { area: 'Phone', text: 'Phones get a keyframe editor, a node browser and numbers you can type.' },
      { area: 'Studio', text: 'Faster: sliders update live without recompiling, and pages load when you open them.' },
      { area: 'Studio', text: 'Hover a socket to trace its wires; a group card’s name jumps into the group.' },
      { area: 'Studio', text: 'Deep Glow and Bloom nodes, and keyframes inside nested groups.' },
      { area: 'Studio', text: '2× and 4× video exports render at real high resolution.' },
      { area: 'Studio', text: 'Problems with files, storage, media or the GPU are reported instead of failing silently.' },
      { area: 'Desktop', text: 'A trackpad swipe no longer navigates away from the app.' },
    ],
  },
];
