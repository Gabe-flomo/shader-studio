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
    id: '2026.10.300',
    date: '2026-10-18',
    title: "Perform",
    highlights: [
      { area: 'Studio', text: "The Stage opens in Perform: big faders, knobs, XY pads and pads beside the picture, with Randomize, Reset, Panic and Take." },
    ],
  },
  {
    id: '2026.10.299',
    date: '2026-10-18',
    title: "Takes have a home",
    highlights: [
      { area: 'Studio', text: "Recording has clear names, takes live in Sound \u2192 Arrangement, and MIDI files and the pad grid are added from + Map." },
    ],
  },
  {
    id: '2026.10.298',
    date: '2026-10-18',
    title: "Simpler Play on phones",
    highlights: [
      { area: 'Studio', text: "Play on a phone: Layers starts with Background, sizes are 1:1 or Free, and Sound is just samples, readers and effects." },
    ],
  },
  {
    id: '2026.10.297',
    date: '2026-10-18',
    title: "One rail",
    highlights: [
      { area: 'Studio', text: "Play has one way around: the labelled rail on the left, the picture on the right. Background is the pinned top row of Layers." },
    ],
  },
  {
    id: '2026.10.296',
    date: '2026-10-18',
    title: "Phone tidy",
    highlights: [
      { area: 'Studio', text: "Phone: the code view is readable in light mode, and the graph is a plain list without the Graph toggle or Do\u2026 buttons." },
    ],
  },
  {
    id: '2026.10.295',
    date: '2026-10-18',
    title: "One + Map",
    highlights: [
      { area: 'Studio', text: "Play: one + Map button for every input, Learn highlights controls in blue, rules can set or nudge controls, Looks live in Finish Presets." },
    ],
  },
  {
    id: '2026.10.294',
    date: '2026-10-18',
    title: "Play on phones",
    highlights: [
      { area: 'Studio', text: "Play on a phone: a Controls / Sources switch to edit mappings, a two-button header, Canvas and Background inside Layers, names that wrap." },
    ],
  },
  {
    id: '2026.10.293',
    date: '2026-10-18',
    title: "Picture on the right",
    highlights: [
      { area: 'Studio', text: "On the Play page the picture is always on the right and gets most of the width; Free no longer crops." },
    ],
  },
  {
    id: '2026.10.292',
    date: '2026-10-18',
    title: "Calmer Play page",
    highlights: [
      { area: 'Studio', text: "Play: controls come first, mappings fold to one line, each action has one button, the rail has labels, Sound's tab is Effects." },
    ],
  },
  {
    id: '2026.10.291',
    date: '2026-10-18',
    title: "Cleaner pads",
    highlights: [
      { area: 'Studio', text: "The Sampler's pads take the full width; small \u2039 \u203a buttons above them move through the 128 notes." },
    ],
  },
  {
    id: '2026.10.290',
    date: '2026-10-18',
    title: "Sampler",
    highlights: [
      { area: 'Studio', text: "Drum pads become the Sampler, modelled on Ableton: a Drum view with 128 pads and a Keys view with zones, slicing, filter, envelopes and LFO." },
    ],
  },
  {
    id: '2026.10.289',
    date: '2026-10-18',
    title: "Time Cube from pictures",
    highlights: [
      { area: 'Studio', text: "Fill a Time Cube from a set of pictures, one per frame, in name order. Kept with the graph (or on disk on desktop), not in the Library." },
    ],
  },
  {
    id: '2026.10.288',
    date: '2026-10-18',
    title: "Scenes on Done",
    highlights: [
      { area: 'Studio', text: "The Scene builder leaves your graph alone until Done: going back, switching kinds or closing changes nothing, and Done is one undo." },
    ],
  },
  {
    id: '2026.10.287',
    date: '2026-10-18',
    title: "One Finish, new Library",
    highlights: [
      { area: 'Studio', text: "One Finish stack from Play, Studio and the 2D builder. The Library looks like Nodes: presets and media to drag in. Soft bokeh on the 3D camera." },
      { area: 'Studio', text: "Builder preset strips keep 4 built-ins and fold away. Next suggestions are off unless you turn them on." },
    ],
  },
  {
    id: '2026.10.286',
    date: '2026-10-18',
    title: "Builder on phones",
    highlights: [
      { area: 'Studio', text: "The Scene builder fits a phone: full-width controls, readable code lines, a short header and even button grids on every tab." },
    ],
  },
  {
    id: '2026.10.285',
    date: '2026-10-18',
    title: "True EQ curves",
    highlights: [
      { area: 'Studio', text: "EQ bands draw their real filter shape. Deleting a band keeps the node. A new scene kind replaces the last. Phone: node search, no + button." },
    ],
  },
  {
    id: '2026.10.284',
    date: '2026-10-18',
    title: "Toolbar order",
    highlights: [
      { area: 'Studio', text: "The graph toolbar is back in its old order with Fit and Auto layout, and without the Do bar or suggestions." },
    ],
  },
  {
    id: '2026.10.283',
    date: '2026-10-18',
    title: "Steady triggers",
    highlights: [
      { area: 'Studio', text: "Audio triggers fire when a band crosses a fixed line, with a noise gate and a scope; files are analysed ahead. Pause, mute, volume on the card. No stems." },
    ],
  },
  {
    id: '2026.10.282',
    date: '2026-10-18',
    title: "Band EQ",
    highlights: [
      { area: 'Studio', text: "Audio Source bands work like an EQ: drag handles on curves, double-click to add, scroll for width, Solo. Envelope cards show a curve you can drag." },
    ],
  },
  {
    id: '2026.10.281',
    date: '2026-10-18',
    title: "Fewer passes",
    highlights: [
      { area: 'Studio', text: "2D builder: kaleidoscope, CRT, swirl and other coordinate effects no longer need a Pass (your CRT + chroma + kaleidoscope: 3 passes to 1)." },
    ],
  },
  {
    id: '2026.10.280',
    date: '2026-10-18',
    title: "A tidier node library",
    highlights: [
      { area: 'Studio', text: "A tidier library (465 \u2192 434 nodes): old transforms, duplicate shapers and Chladni nodes merged; old graphs still open; search finds everyday words." },
      { area: 'Studio', text: "New Brush node for grid simulations; Multi-Light gets a background and sun angles; Particles moved into Agents; Audio Source can listen to what you hover." },
    ],
  },
  {
    id: '2026.10.279',
    date: '2026-10-18',
    title: "Echo, fixed",
    highlights: [
      { area: 'Studio', text: "Echo no longer blows out to white, Copies works, and it's a normal effect now: feed it a colour, get the colour with its echoes." },
      { area: 'Studio', text: "Output has an Alpha input and an Opacity slider; Record tells you clearly when a graph has no alpha to export." },
    ],
  },
  {
    id: '2026.10.278',
    date: '2026-10-18',
    title: "Status on top",
    highlights: [
      { area: 'Studio', text: "The node count and frame time are back at the top of the graph; the Performance panel scrolls inside itself." },
      { area: 'Studio', text: "2D builder: the Time slider on the Space card is gone (it only made the builder stutter)." },
    ],
  },
  {
    id: '2026.10.277',
    date: '2026-10-18',
    title: "Quieter grid hover",
    highlights: [
      { area: 'Studio', text: "Grid Rules: hovering a cell shows the cells it counts as a faint outline, so it no longer looks like a big brush." },
    ],
  },
  {
    id: '2026.10.276',
    date: '2026-10-18',
    title: "Nodes on the picture",
    highlights: [
      { area: 'Studio', text: "Maximize graph now shows the picture itself behind your nodes, with no dimming and no dot grid." },
    ],
  },
  {
    id: '2026.10.275',
    date: '2026-10-18',
    title: "A quieter canvas",
    highlights: [
      { area: 'Studio', text: "The graph toolbar is just Maximize, Outline and Randomise; Maximize puts the picture full size behind your graph, in your aspect preset." },
      { area: 'Studio', text: "Stages are gone from the graph; the rest lives in the canvas right-click menu. Recover and other choice dialogs are tidier." },
    ],
  },
  {
    id: '2026.10.274',
    date: '2026-10-18',
    title: "Soft grain",
    highlights: [
      { area: 'Studio', text: "March Camera: Lens Soft grain keeps the grainy depth of field you like and melts it into a soft haze (Softness sets how much)." },
      { area: 'Studio', text: "Grain no longer blows up into noise when Focal Dist is low; the blur now tops out at a few percent of the picture." },
    ],
  },
  {
    id: '2026.10.273',
    date: '2026-10-18',
    title: "One Library",
    highlights: [
      { area: 'Studio', text: "Everything you save lives in one Library: graphs, presets, functions, Expression Blocks, keyframes, your nodes, shaders and media, with search and folders." },
      { area: 'Studio', text: "One preset system across the builders and editors: save, rename, delete, export and import work the same way everywhere." },
    ],
  },
  {
    id: '2026.10.272',
    date: '2026-10-18',
    title: "Save before you lose it",
    highlights: [
      { area: 'Studio', text: "After 15 minutes on a new graph that hasn't been saved, Playfield asks you to name and save it (once per graph)." },
      { area: 'Studio', text: "Randomise is back on the canvas toolbar; the Do\u2026 bar has no button now (\u2318K still opens it)." },
    ],
  },
  {
    id: '2026.10.271',
    date: '2026-10-17',
    title: "One node per effect",
    highlights: [
      { area: 'Studio', text: "Each effect has one node now, working on a texture in the same frame, so moving things don't lag or smear; old graphs still open." },
      { area: 'Studio', text: "SDF Glow has every distance falloff, UV Warp has a Kind (Smooth, Jitter, Curl, Swirl), plus new Depth of Field and Tilt-Shift texture nodes." },
    ],
  },
  {
    id: '2026.10.270',
    date: '2026-10-17',
    title: "One name for each thing",
    highlights: [
      { area: 'Studio', text: "Clearer names (Publish node, Import shader, Finish, Controls, Sources), and one Code page for the shader editor, Convert and Functions." },
      { area: 'Studio', text: "A calmer canvas: rare actions in a Graph menu, card buttons on hover, one Next strip for suggestions, and one Layout menu in Play." },
    ],
  },
  {
    id: '2026.10.269',
    date: '2026-10-17',
    title: "Tidier Start sheet",
    highlights: [
      { area: 'Studio', text: "The Start sheet's example cards have room around their pictures, in two even rows." },
    ],
  },
  {
    id: '2026.10.268',
    date: '2026-10-17',
    title: "Easier to start, easier to save",
    highlights: [
      { area: 'Studio', text: "\u2318S saves (\u21e7\u2318S save as, \u21e7\u2318E export, \u2318A select all); the graph keeps its zoom, fits after Build, and Maximize gives it the window." },
      { area: 'Studio', text: "A Start sheet and Help \u2192 Learn on desktop; new nodes land in free space; adding a Play control takes one step; Esc closes popovers." },
    ],
  },
  {
    id: '2026.10.267',
    date: '2026-10-17',
    title: "Faster exports, tidier corners",
    highlights: [
      { area: 'Studio', text: "Desktop video export has a Speed choice: Fast uses the Mac's hardware encoder (the default), Best compression uses x264." },
      { area: 'Studio', text: "Gradients survive in Scene Builder recipes, presets show their colours, Splat and Time Cube builders pause, and Agents groups take a Sound input." },
    ],
  },
  {
    id: '2026.10.266',
    date: '2026-10-17',
    title: "Room to scroll on phones",
    highlights: [
      { area: 'Studio', text: "On a phone, node pages scroll as one page with only the node's name row pinned, so long lists of inputs are easy to reach." },
      { area: 'Studio', text: "In Both, drag the handle to give the preview a quarter, about half or most of the screen; your phone remembers it." },
    ],
  },
  {
    id: '2026.10.265',
    date: '2026-10-17',
    title: "Separate on Pro",
    highlights: [
      { area: 'Studio', text: "Separating a song into stems is part of Pro; every other Audio node stays free, and stems a song already has work on Free." },
    ],
  },
  {
    id: '2026.10.264',
    date: '2026-10-17',
    title: "Desktop preview fix",
    highlights: [
      { area: 'Studio', text: "Desktop app: the preview draws again (2026.10.263's new isolation setting stopped it); stems still separate on the GPU." },
    ],
  },
  {
    id: '2026.10.263',
    date: '2026-10-17',
    title: "Stems",
    highlights: [
      { area: 'Studio', text: "Audio Source can Separate a song into drums, bass, vocals and other on this device; pick a stem so kicks and claps are read from the drums alone." },
      { area: 'Studio', text: "Optional download adds guitar and piano. The stems are kept in the library with the song; a 3-minute song takes about half a minute on the GPU." },
    ],
  },
  {
    id: '2026.10.262',
    date: '2026-10-17',
    title: "Better on phones",
    highlights: [
      { area: 'Studio', text: "On a phone: a welcome with examples and Start a new scene, a labelled Preview / Both / Graph / Code switch, and node pages with their editors." },
      { area: 'Studio', text: "Bigger tap targets, long-press for an icon's name, builders keep Done in view, and Record no longer crashes on phones." },
    ],
  },
  {
    id: '2026.10.261',
    date: '2026-10-17',
    title: "Agents presets",
    highlights: [
      { area: 'Studio', text: "The Agents builder can save your setup as a preset with a picture too; it loads into 2D or 3D groups." },
    ],
  },
  {
    id: '2026.10.260',
    date: '2026-10-17',
    title: "ProRes",
    highlights: [
      { area: 'Studio', text: "Export ProRes .mov files, including 4444 with transparency for compositing, in the desktop app and in the browser." },
    ],
  },
  {
    id: '2026.10.259',
    date: '2026-10-17',
    title: "Your builder presets",
    highlights: [
      { area: 'Studio', text: "Every builder can save the scene as your own preset with a picture of it: load, rename or delete it later; presets stay in their builder." },
      { area: 'Studio', text: "Builder sections fold to a one-line summary and remember it, so the viewport gets the room." },
    ],
  },
  {
    id: '2026.10.258',
    date: '2026-10-17',
    title: "Agents builder, tidier",
    highlights: [
      { area: 'Studio', text: "Agents builder: cards fold to a summary, Respawn re-seeds walkers and keeps the trail, and the 3D view orbits, pans and zooms." },
      { area: 'Studio', text: "Built rules get real names (Follow trail, Keep apart) and become nodes you can click into (Turn toward, Wander, Avoid walls) instead of code." },
    ],
  },
  {
    id: '2026.10.257',
    date: '2026-10-17',
    title: "Gradients anywhere",
    highlights: [
      { area: 'Studio', text: "Colour settings switch between Solid and Gradient: colour 3D shapes by height, normal, depth or noise, and 2D fills by edge, radius or angle." },
      { area: 'Studio', text: "Save your own gradients as presets; they're shared with the Palette nodes and the Library." },
    ],
  },
  {
    id: '2026.10.256',
    date: '2026-10-17',
    title: "Filters and resonators",
    highlights: [
      { area: 'Studio', text: "New Audio effects you can hear and see: Filter, a Resonator bank tuned to a scale (its notes' energies drive visuals) and Spectral freeze, blur, gate." },
      { area: 'Studio', text: "Spectrogram has a Field output: use the sound's history like a noise field in Height Light, Ride a path or a threshold." },
    ],
  },
  {
    id: '2026.10.255',
    date: '2026-10-17',
    title: "Bounds and Glitch",
    highlights: [
      { area: 'Studio', text: "Bounds keeps a number or position inside a range with Clip, Wrap, Bounce or Soft; Direction flips a velocity at each wall." },
      { area: 'Studio', text: "Glitch takes two pictures and gives two back: swap blocks, cross channels, displace by the other, bit flips, slice shift." },
    ],
  },
  {
    id: '2026.10.254',
    date: '2026-10-17',
    title: "Sound that stays",
    highlights: [
      { area: 'Studio', text: "Audio Source keeps your sounds in the library, so they come back after a reload; a new Video tab listens to a video's own sound." },
      { area: 'Studio', text: "Exported web pages now run the Audio nodes: bands, triggers and learned sounds react after a tap to start sound." },
    ],
  },
  {
    id: '2026.10.253',
    date: '2026-10-17',
    title: "Smooth lens",
    highlights: [
      { area: 'Studio', text: "March Camera: Lens Smooth blurs by depth on the current frame, so depth of field is soft bokeh with no grain and no lag; Disc, Hex or Oct." },
    ],
  },
  {
    id: '2026.10.252',
    date: '2026-10-17',
    title: "Learn a sound",
    highlights: [
      { area: 'Studio', text: "Audio Source: select one clap (or any sound) in the window and press Learn; it fires a trigger whenever a sound like it comes back." },
      { area: 'Studio', text: "Audio nodes now work inside groups: Hit, Band level, Spectrum and the rest hear an Audio Source wired in from outside." },
    ],
  },
  {
    id: '2026.10.251',
    date: '2026-10-17',
    title: "Faster exports, live builders",
    highlights: [
      { area: 'Studio', text: "Video exports on the desktop send frames as raw bytes: a 1080p frame no longer spends half a second being converted, so exports are far faster." },
      { area: 'Studio', text: "Agent Builder settings (3D camera, forces, shapes) apply as you drag; built scene groups jump to wired nodes from socket tips; phone 2D builder fix." },
    ],
  },
  {
    id: '2026.10.250',
    date: '2026-10-17',
    title: "Audio Source, opened up",
    highlights: [
      { area: 'Studio', text: "Audio Source has File and Mic tabs and a spectrum on its card; Open it to trim the sound and drag frequency bands onto the spectrum." },
      { area: 'Studio', text: "Each band sends out a value, a trigger (a kick, a snare) or both, as its own output: Kick (trigger) into Envelope, Bass into a size." },
    ],
  },
  {
    id: '2026.10.249',
    date: '2026-10-17',
    title: "Send and Receive",
    highlights: [
      { area: 'Studio', text: "Send and Receive: name a value or texture with Send, then read it anywhere with Receive, even inside groups, with no wire across the graph." },
    ],
  },
  {
    id: '2026.10.248',
    date: '2026-10-17',
    title: "Curves",
    highlights: [
      { area: 'Studio', text: "Curves: drag points on Master, Red, Green, Blue and Alpha curves like After Effects; presets for contrast, invert, posterize and cross-process." },
      { area: 'Studio', text: "Threshold: a soft or hard mask from brightness or one channel, with Level, Softness and Invert." },
    ],
  },
  {
    id: '2026.10.247',
    date: '2026-10-17',
    title: "Measure shapes",
    highlights: [
      { area: 'Studio', text: "Overlay Shape: any SDF's outline, bounding box, centre and size, and the pointer's position and distance in its (even warped) space." },
      { area: 'Studio', text: "Overlay Distance: click two points for the distance between them, or From centre for distance and angle from the origin." },
    ],
  },
  {
    id: '2026.10.246',
    date: '2026-10-17',
    title: "Audio in the graph",
    highlights: [
      { area: 'Studio', text: "New Audio nodes: Audio Source (test loop, a file or the mic), Band level, Hit (kick, snare, hi-hat triggers), Spectrum, Spectrogram, Waveform." },
      { area: 'Studio', text: "Hit's Trigger plugs into Envelope and Counter; examples in the new Audio folder. Audio Input is retired (old graphs still work)." },
    ],
  },
  {
    id: '2026.10.245',
    date: '2026-10-17',
    title: "Tidier Segment",
    highlights: [
      { area: 'Studio', text: "Segment Objects shows the kinds it finds as chips; + Add opens a short grouped list instead of twenty chips at once." },
    ],
  },
  {
    id: '2026.10.244',
    date: '2026-10-17',
    title: "Show a band",
    highlights: [
      { area: 'Studio', text: "Histogram: click a bar or drag across several, and the preview shows only the pixels in that band of L, R, G or B; Esc shows all again." },
    ],
  },
  {
    id: '2026.10.243',
    date: '2026-10-17',
    title: "Patch the channels",
    highlights: [
      { area: 'Studio', text: "Shuffle: drag one channel's cell onto another to distort it by it (multiply, add, subtract, divide or an expression), shown as a wire." },
      { area: 'Studio', text: "Shuffle's A and B each switch between Channels and Texture on the card, so two textures, two vec4s or any mix work." },
    ],
  },
  {
    id: '2026.10.242',
    date: '2026-10-17',
    title: "Overlay",
    highlights: [
      { area: 'Studio', text: "Preview Overlay: see any space's grid with its real values over the picture (UV, pixels, warped), with a Warp blend from plain to warped." },
      { area: 'Studio', text: "Overlay Position: mark a point like the Mouse in any space, with its (x, y) there, and an arrow when it is off-screen." },
    ],
  },
  {
    id: '2026.10.241',
    date: '2026-10-17',
    title: "Pictures",
    highlights: [
      { area: 'Studio', text: "New Pictures examples on two built-in photos: Channel, Shuffle, Channel Colours, Height Light, Show data and a block swap." },
      { area: 'Studio', text: "Pixel sort: a picture sorts itself by brightness, live, between a Low and High you set, along rows or columns." },
    ],
  },
  {
    id: '2026.10.240',
    date: '2026-10-16',
    title: "Where a name was set",
    highlights: [
      { area: 'Studio', text: "Expression Blocks: rest on a name for 2 s to see the line that set it; a line's Explain folds with its preview." },
      { area: 'Studio', text: "Builder previews follow the mouse: grid ripples, brushes and Mouse nodes respond inside the builders." },
    ],
  },
  {
    id: '2026.10.239',
    date: '2026-10-16',
    title: "Words that match the node",
    highlights: [
      { area: 'Studio', text: "Node cards and descriptions use the node's own names: Step says 0 while Value is below Threshold, as step(Threshold, Value)." },
    ],
  },
  {
    id: '2026.10.238',
    date: '2026-10-15',
    title: "Sharper, baked masks",
    highlights: [
      { area: 'Studio', text: "Segment: Edge refine snaps the mask to the picture's own edges, and Bake works out a video's masks once so they play smoothly and export exactly." },
    ],
  },
  {
    id: '2026.10.237',
    date: '2026-10-15',
    title: "Random per cell",
    highlights: [
      { area: 'Studio', text: "Random (from ID): a steady random number for each cell, copy or walker. Jump flood now works out its own reach, so a distance field needs no code." },
    ],
  },
  {
    id: '2026.10.236',
    date: '2026-10-15',
    title: "Builders, with nodes",
    highlights: [
      { area: 'Studio', text: "The 2D and 3D scene builders make their glows and skies with nodes (Glow Layer, Gradient) instead of code blocks, so every built scene is easier to read." },
    ],
  },
  {
    id: '2026.10.235',
    date: '2026-10-15',
    title: "Passes, with nodes",
    highlights: [
      { area: 'Studio', text: "The Passes examples use Fade (feedback), Mask, Outline and Tone Map nodes where they used to copy them in code blocks." },
    ],
  },
  {
    id: '2026.10.234',
    date: '2026-10-15',
    title: "Clearer beginner examples",
    highlights: [
      { area: 'Studio', text: "Learn 3D's distance lesson and the Curves & Shapes examples now draw with nodes you can click into; more examples have notes on every node." },
    ],
  },
  {
    id: '2026.10.233',
    date: '2026-10-15',
    title: "Clearer agent labels",
    highlights: [
      { area: 'Studio', text: "Draw agents' Over is now Background, and Trail field's Image and Gain are now Texture and Exposure: the same settings, clearer names." },
    ],
  },
  {
    id: '2026.10.232',
    date: '2026-10-15',
    title: "Shuffle grid",
    highlights: [
      { area: 'Studio', text: "Shuffle has a click grid: pick where red, green, blue and alpha come from with one click each." },
    ],
  },
  {
    id: '2026.10.231',
    date: '2026-10-15',
    title: "Named channels everywhere",
    highlights: [
      { area: 'Studio', text: "Dropdowns that pick a channel (Channel, Height Light, Sense's Smell) show the Trail field's channel names, even inside an Agents group." },
    ],
  },
  {
    id: '2026.10.230',
    date: '2026-10-15',
    title: "Show data",
    highlights: [
      { area: 'Studio', text: "Show data: see what a number, a direction or four channels hold, as a heat map, direction colours, or channels side by side." },
    ],
  },
  {
    id: '2026.10.229',
    date: '2026-10-15',
    title: "Nodes, not code",
    highlights: [
      { area: 'Studio', text: "More examples colour their trails with nodes you can click into (Colorize, Gradient, Palette, Channel Colours) instead of code blocks." },
    ],
  },
  {
    id: '2026.10.228',
    date: '2026-10-15',
    title: "Clearer agent examples",
    highlights: [
      { area: 'Studio', text: "Agent examples lose code blocks that only drew a dark backdrop; visible skies are Gradient nodes, and painters and termites use Channel Colours." },
    ],
  },
  {
    id: '2026.10.227',
    date: '2026-10-15',
    title: "Smell and Crowd limit",
    highlights: [
      { area: 'Studio', text: "Sense: Smell picks which trail channel to follow, and Crowd limit makes crowded trail pull less; thirteen examples lose their code blocks for them." },
      { area: 'Studio', text: "Trail field: name its channels (grass, prey scent\u2026) and its outputs and wires use those names." },
    ],
  },
  {
    id: '2026.10.226',
    date: '2026-10-15',
    title: "Channel tools",
    highlights: [
      { area: 'Studio', text: "Channel: pick one channel of any data, compare it with another (A \u2212 B, A \u00f7 B), and shape it (0\u20131, remap, threshold) with no code." },
      { area: 'Studio', text: "Shuffle puts any channel into red, green, blue or alpha; Channel Colours gives each channel its own colour over a background." },
    ],
  },
  {
    id: '2026.10.225',
    date: '2026-10-15',
    title: "Height Light",
    highlights: [
      { area: 'Studio', text: "Height Light: light any height map like terrain (a trail, depth, noise, an SDF) with a sun, relief and two colours. Sand drift's dunes now use it." },
    ],
  },
  {
    id: '2026.10.224',
    date: '2026-10-15',
    title: "Controls on the Agents card",
    highlights: [
      { area: 'Studio', text: "Agents groups have a Controls section: right-click any slider inside \u2192 Pin to the group card, then Add all to Play in one click." },
    ],
  },
  {
    id: '2026.10.223',
    date: '2026-10-15',
    title: "Lighter riding",
    highlights: [
      { area: 'Studio', text: "Ride a path does about a quarter of the work it did, so Riding outlines and the Lissajous examples no longer heat up the machine." },
      { area: 'Studio', text: "Looks are gone: they repeated nodes that already exist. Agent-specific finishing nodes are being planned instead." },
      { area: 'Studio', text: "Performance panel: passes from examples you've closed no longer linger in Where the frame goes." },
    ],
  },
  {
    id: '2026.10.222',
    date: '2026-10-15',
    title: "Looks",
    highlights: [
      { area: 'Studio', text: "Looks: twelve standard finishes (vignette, grain, tone map, colour pop, glowing line, duotone\u2026) as Expression Blocks you can read and tweak." },
      { area: 'Studio', text: "Find them in the Expressions tab under Looks, or type a Look's name (or just \"look\") in the node search." },
    ],
  },
  {
    id: '2026.10.221',
    date: '2026-10-15',
    title: "Ride a path",
    highlights: [
      { area: 'Studio', text: "Ride a path: wire any shape into Path \u0192 (a circle, a Lissajous Curve, a Chladni Field, text) and walkers ride its outline as a band, following it as it moves." },
      { area: 'Studio', text: "New example, Riding outlines: one slider melts a circle into a Lissajous into a Chladni plate. The other ride examples now use a Lissajous Curve." },
      { area: 'Studio', text: "Lissajous Curve draws a smooth line: its distance is measured to the curve itself, no more beads." },
    ],
  },
  {
    id: '2026.10.220',
    date: '2026-10-15',
    title: "Clearer rules, truer Explain",
    highlights: [
      { area: 'Studio', text: "Agent rules read like a filter: When all of these are true, then do these. Rules can be renamed and fold to a one-line summary." },
      { area: 'Studio', text: "Explain shows values from memory nodes, Passes and videos; its line stays pinned. Quick map reaches Expression Block sliders." },
    ],
  },
  {
    id: '2026.10.219',
    date: '2026-10-15',
    title: "Value at point",
    highlights: [
      { area: 'Studio', text: "Value at point reads a value that changes across the picture (an SDF, a noise) once, at a point. Text does it for a wired Value, so readouts stay steady." },
    ],
  },
  {
    id: '2026.10.218',
    date: '2026-10-14',
    title: "Segment",
    highlights: [
      { area: 'Studio', text: "Segment (Texture tools) cuts people, objects or a thing you click out of a picture or video as a mask, on this device, with no green screen." },
    ],
  },
  {
    id: '2026.10.217',
    date: '2026-10-14',
    title: "Blob Track in 3D",
    highlights: [
      { area: 'Studio', text: "Blob Track Space 3D: each blob's marks stand at its depth (a Depth map or its size), turned by Yaw and Pitch in perspective, with stems and x / y / z labels." },
    ],
  },
  {
    id: '2026.10.216',
    date: '2026-10-14',
    title: "Text",
    highlights: [
      { area: 'Studio', text: "Text (2D Primitives) draws words in the picture; type {} for a live number from its Value input, like a Timer, a Counter or an Analyze reading." },
    ],
  },
  {
    id: '2026.10.215',
    date: '2026-10-14',
    title: "Optical Flow",
    highlights: [
      { area: 'Studio', text: "Optical Flow (Texture tools) finds which way each part of a moving picture moves: wire its Flow into Feedback (texture), Displace, particles or agents." },
    ],
  },
  {
    id: '2026.10.214',
    date: '2026-10-14',
    title: 'Analyze',
    highlights: [
      { area: 'Studio', text: 'Analyze (Texture tools) measures a picture into numbers: average colour and brightness, how much is lit and where, its brightest point, contrast and motion.' },
    ],
  },
  {
    id: '2026.10.213',
    date: '2026-10-14',
    title: 'Memory nodes',
    highlights: [
      { area: 'Studio', text: 'Memory nodes (Animation): Lag, Spring, Envelope (ADSR), Timer, Counter, Sample & Hold and Speed remember a number from frame to frame.' },
      { area: 'Studio', text: 'Smooth a jittery value, bounce to a target, swell and fade on a beat, count triggers, time a sequence. Examples in the new Memory folder.' },
    ],
  },
  {
    id: '2026.10.212',
    date: '2026-10-14',
    title: 'Cache',
    highlights: [
      { area: 'Studio', text: 'Cache (Texture tools) keeps the last frames of any texture on the GPU: delay it, freeze it, loop through it, like TouchDesigner\'s Cache TOP.' },
      { area: 'Studio', text: 'Cache Read takes more delays from the same frames, and a Delay map reads each pixel from its own moment (Time Machine).' },
    ],
  },
  {
    id: '2026.10.211',
    date: '2026-10-14',
    title: 'Blob Track motion',
    highlights: [
      { area: 'Studio', text: 'Blob Track Motion: Jump makes the marks hold, snap and flicker like a classic tracking overlay; Pulse parks them while data packets flow between.' },
      { area: 'Studio', text: 'Blob Track styling: dashed or dotted lines, lines coloured by ID or as a gradient, Wobble, Max link, Box padding and hex-code labels.' },
    ],
  },
  {
    id: '2026.10.210',
    date: '2026-10-14',
    title: 'Blob Track',
    highlights: [
      { area: 'Studio', text: 'Blob Track (Texture tools) finds the bright shapes in a mask and follows them, each keeping its ID as it moves, like TouchDesigner\'s Blob Track.' },
      { area: 'Studio', text: 'Blob Track Marks: boxes or corner brackets, crosses, ID or x / y labels, and curved connections between blobs with arrows and flowing dots.' },
      { area: 'Studio', text: 'Blob Track Stamp: any picture, video or shader on every blob: fitted, cut round, a sprite-sheet cell per ID. Examples: Texture tools 13 and 14.' },
    ],
  },
  {
    id: '2026.10.209',
    date: '2026-10-14',
    title: 'Voxels',
    highlights: [
      { area: 'Studio', text: 'March Loop: Voxels draws any 3D scene as cubes on a grid, lit face by face, with a live Voxel size. In the 3D Scene Builder under Quality too.' },
      { area: 'Studio', text: 'Draw agents: Sprite size sets how big each picture is (24 px by default, up to 64), so sprites no longer look like dots.' },
    ],
  },
  {
    id: '2026.10.208',
    date: '2026-10-14',
    title: 'Small fixes',
    highlights: [
      { area: 'Studio', text: 'Help tooltips stay on screen; Warp Builder vector arrows fit their cells; function cards are no longer covered by a second tip.' },
      { area: 'Studio', text: 'Draw agents\' Sprite takes any texture now: a picture, video or the camera works straight away.' },
    ],
  },
  {
    id: '2026.10.207',
    date: '2026-10-13',
    title: 'Sprites',
    highlights: [
      { area: 'Studio', text: 'Draw agents: a Sprite input draws every walker as a picture, a video or a shader (through a Pass) instead of a dot, in 2D and 3D. Own colours or tinted.' },
    ],
  },
  {
    id: '2026.10.206',
    date: '2026-10-13',
    title: 'Built-in effects',
    highlights: [
      { area: 'Studio', text: 'Presets › Built-in effects: Long exposure, Trails where it moves, Datamosh, Kaleidoscope feedback and Ripples, ready-made groups you can open.' },
      { area: 'Studio', text: 'Read neighbours (texture): the four texels round a pixel, read exactly, with the Laplacian and Gradient worked out. One node instead of four Samples.' },
    ],
  },
  {
    id: '2026.10.205',
    date: '2026-10-13',
    title: 'Tidy group cards',
    highlights: [
      { area: 'Studio', text: 'Groups: ⌘-click a slider on the group card (Ctrl-click on Windows) to hide it. The toast has Show it again; the parameter picker lists hidden ones.' },
    ],
  },
  {
    id: '2026.10.204',
    date: '2026-10-13',
    title: 'Your scene presets',
    highlights: [
      { area: 'Studio', text: '3D Scene Builder: + Save this scene keeps it as a named preset with a picture of it. Yours sit next to four built-ins and load only in the builder.' },
    ],
  },
  {
    id: '2026.10.203',
    date: '2026-10-13',
    title: 'Gliding voxels',
    highlights: [
      { area: 'Studio', text: 'Voxel agents glide between grid cells instead of jumping: a new Glide setting (0 snaps, 1 always easing), also in the Agents builder\'s Look.' },
    ],
  },
  {
    id: '2026.10.202',
    date: '2026-10-13',
    title: 'Particles that stay',
    highlights: [
      { area: 'Studio', text: 'Particle presets start with Fade and Dies off, so particles live for ever. Turn either card on in Life when you want them to go.' },
      { area: 'Studio', text: 'Feedback (texture) cards show their trail live, and no longer report a false shader error from their preview.' },
    ],
  },
  {
    id: '2026.10.201',
    date: '2026-10-13',
    title: 'Calmer agents',
    highlights: [
      { area: 'Studio', text: 'Agents and particles start as plain dots (Glow is one click away), and particles start without a trail: raise Deposit Amount for one.' },
      { area: 'Studio', text: 'Solid agent shapes (cubes, rods, voxels) now follow the camera\'s Orthographic and Reverse perspective, like dots and splats.' },
    ],
  },
  {
    id: '2026.10.200',
    date: '2026-10-12',
    title: 'Render Targets',
    highlights: [
      { area: 'Studio', text: 'Render Targets (MRT): up to four textures from one draw, each with its own type, precision and read. Counts as one Pass.' },
      { area: 'Studio', text: 'Each target has a last-frame output, so a simulation can keep motion in one target and colour in another. Try Texture tools 12.' },
    ],
  },
  {
    id: '2026.10.199',
    date: '2026-10-12',
    title: 'Data Texture views',
    highlights: [
      { area: 'Studio', text: 'Data Texture cards show the texture: Raw, Range, Channels or Arrows (r g as a vector field), with a Min…Max for the view.' },
      { area: 'Studio', text: 'Open ↗ pops out a big view with the exact stored value under the cursor, the inputs and outputs editor, and the storage settings.' },
    ],
  },
  {
    id: '2026.10.198',
    date: '2026-10-12',
    title: 'Data Texture',
    highlights: [
      { area: 'Studio', text: 'Data Texture: store up to four inputs (float to vec4) in the channels you pick, at full float, half or 8-bit, and read them back as typed outputs.' },
      { area: 'Studio', text: 'A read that feeds the node sees last frame, so it can run a simulation. Read channels reads any texture. Try Texture tools 11.' },
    ],
  },
  {
    id: '2026.10.197',
    date: '2026-10-12',
    title: 'Solid walkers',
    highlights: [
      { area: 'Studio', text: '3D Draw agents: a Shape setting draws walkers as cubes, spheres, rods, tiles or voxels, with Flat, Faces or Lit shading and an outline option.' },
      { area: 'Studio', text: 'Cheap by design: a cost note, Max shapes, Draw every Nth, Distant as dots and Half resolution. A million Faces cubes take about 10 ms. Try Voxel slime.' },
      { area: 'Studio', text: 'Draw agents and Splat Scene cameras get Orthographic and Reverse perspective, matching the March Camera. In both builders too.' },
    ],
  },
  {
    id: '2026.10.196',
    date: '2026-10-12',
    title: 'Feedback texture',
    highlights: [
      { area: 'Studio', text: 'Feedback (texture): one node for trails on any texture. Tail, Clean, Tint, Zoom, Turn, Move, Flow, Hue drift and Blend, all live. Reset clears it.' },
      { area: 'Studio', text: 'New Texture tools examples on the Ball action clip: a zoom tunnel, trails pushed by their own flow, and a camera echo.' },
    ],
  },
  {
    id: '2026.10.195',
    date: '2026-10-12',
    title: 'True reset',
    highlights: [
      { area: 'Studio', text: 'Reset is a true reset everywhere: feedback, trails, agents, step bars and smoothing all start over, so the first frame matches a fresh open.' },
      { area: 'Studio', text: 'Wires that would make a loop are refused, with the loop named and a "Use last frame\'s instead" fix. Old graphs with a loop say where it is and can remove it.' },
      { area: 'Studio', text: 'Draw agents: a Background setting, Palette by density, colours the space behind the walkers from their own density.' },
    ],
  },
  {
    id: '2026.10.194',
    date: '2026-10-12',
    title: 'Halls of time',
    highlights: [
      { area: 'Studio', text: 'Time Cube in space: repeat the box into rows, floors or endless halls, each copy at its own moment, and twist, bend or wave the space around it.' },
      { area: 'Studio', text: 'New Time Cube Shape node: wire it through Repeat Scene, Twist 3D or a Warp Builder group into Time Cube View\'s Space. Try the Infinite hall preset.' },
      { area: 'Studio', text: 'Warp Builder: right-click an empty slot for a short menu (Number, x, y, uv, time…). Function tiles show a small graph instead of a live picture: faster.' },
    ],
  },
  {
    id: '2026.10.193',
    date: '2026-10-12',
    title: 'Ball action clip',
    highlights: [
      { area: 'Studio', text: 'Examples that use a video now play a built-in Ball action clip: Time Cube, Frame Stack, Time Slice, Texture tools and Webcam CMYK.' },
      { area: 'Studio', text: 'New Time Cubes start with Ball action too. Choose video still offers the old painted test clip, and saved graphs that use it keep it.' },
    ],
  },
  {
    id: '2026.10.192',
    date: '2026-10-12',
    title: 'Time Cube builder',
    highlights: [
      { area: 'Studio', text: 'Scene builder: a Time Cube kind. The live box or stack of frames in the middle, every Time Cube and Frame Stack control at the side, 10 presets below.' },
      { area: 'Studio', text: 'Sliders move the real nodes with no recompile. Animate any of slice, flow, scan, spread, morph or shuffle with an LFO; Surprise me is one undo.' },
    ],
  },
  {
    id: '2026.10.191',
    date: '2026-10-12',
    title: 'Readable code',
    highlights: [
      { area: 'Studio', text: 'Generated code: a Readable view names variables after your nodes and sliders, groups lines by node, and folds away plumbing. Exact is one click away.' },
      { area: 'Studio', text: 'Click a line in the code to select its node; select a node to highlight its lines. Copy takes the view you see, and Readable still compiles.' },
    ],
  },
  {
    id: '2026.10.190',
    date: '2026-10-12',
    title: 'If tiles',
    highlights: [
      { area: 'Studio', text: 'Warp Builder: an If tile (if condition then … else …) with comparison tiles (> < ≥ ≤ = ≠) and and/or/not. A Smooth switch blends the edge instead of cutting.' },
    ],
  },
  {
    id: '2026.10.189',
    date: '2026-10-12',
    title: 'Warp Builder',
    highlights: [
      { area: 'Studio', text: 'Warp Builder: build space warps by dragging tiles (x, y, t, numbers, sin, abs, noise…) onto X and Y rows, watching a checkerboard, ring, vectors or heat view.' },
      { area: 'Studio', text: 'Warp Builder: stack blocks, loop them, save to My blocks, and move warps both ways with the 2D Scene Builder (Open in Warp Builder / Send to 2D).' },
    ],
  },
  {
    id: '2026.10.188',
    date: '2026-10-11',
    title: 'Hands, restyled',
    highlights: [
      { area: 'Play', text: 'The hand overlay is smoother and matches the app: curved, tapering fingers, round joints, a soft palm, theme colours, and fingertips that glow on a pinch.' },
      { area: 'Studio', text: 'The on-device explanation model is gone (589 KB lighter). Explain keeps its pattern names, sentences, explain view and step-through.' },
    ],
  },
  {
    id: '2026.10.187',
    date: '2026-10-11',
    title: 'Quick controls',
    highlights: [
      { area: 'Studio', text: '2D Scene Builder: pin any slider to Quick controls under the preview; each becomes a Play control on Build, and Open in Play takes you there.' },
      { area: 'Studio', text: 'Depth preview: see the Picture, the raw Depth (or a heat map) or the Shaped depth the effects read, in the 2D Depth tab and the 3D card.' },
      { area: 'Studio', text: 'Grid Rules: a slim strip shows the step and alive/dead share in green and red; born and dies markers are always on.' },
    ],
  },
  {
    id: '2026.10.186',
    date: '2026-10-11',
    title: 'Loops',
    highlights: [
      { area: 'Studio', text: 'Expression Blocks can loop: Before, looped lines (i, fi, n, k), Break when and After. Iterations is a live slider, and you can step through each pass.' },
      { area: 'Studio', text: '2D Scene Builder looped space blocks: Kali, IFS kaleidoscope, Mandelbox, iterated warp, Apollonian, Julia, spirals and log-polar zoom, with orbit traps.' },
      { area: 'Studio', text: 'New examples: Julia escape time, fbm octaves and a Kali fold, each a single looped Expression Block.' },
    ],
  },
  {
    id: '2026.10.185',
    date: '2026-10-11',
    title: 'Done means built',
    highlights: [
      { area: 'Studio', text: 'Fixed: Done in the 2D Scene Builder closed without building. Done now builds (or rebuilds) your edits, then closes; a failed build keeps the window open.' },
      { area: 'Studio', text: 'Closing a builder with unbuilt edits asks Build, Discard or Keep editing, and drafts are saved, so reopening brings back your last edits.' },
    ],
  },
  {
    id: '2026.10.184',
    date: '2026-10-11',
    title: 'Real lens fringes, deep glow',
    highlights: [
      { area: 'Studio', text: 'Chromatic Aberration rebuilt: smooth spectral rainbow fringes, channel split, blur that grows with the shift, and lateral, axial or prism lenses.' },
      { area: 'Studio', text: 'Deep Glow replaces Glow and Bloom: a long, natural tail with hot cores. Old Glow cards offer Upgrade to Deep Glow.' },
      { area: 'Files', text: 'Projects now save as .play files (.playfile still opens). Pieces and Balls are hidden from the library and builders for now.' },
    ],
  },
  {
    id: '2026.10.183',
    date: '2026-10-11',
    title: 'Combine, modify, recover',
    highlights: [
      { area: 'Studio', text: '2D Scene Builder: shapes glow like SDFs by default (Filled and Outline optional), a Combine tab (smooth union, subtract, intersect, xor) and Modify cards.' },
      { area: 'Studio', text: '2D Scene Builder: glow types (Soft, Gaussian, Neon, Rim…), effect order now truly matters, grids live in the Grid builder, and formula lines are highlighted.' },
      { area: 'Desktop', text: 'Crash recovery always offers your work after a crash or blank window, and saves a crash report you can show, copy or reveal. Autosaves are .playfiles.' },
    ],
  },
  {
    id: '2026.10.182',
    date: '2026-10-11',
    title: 'Desktop polish',
    highlights: [
      { area: 'Desktop', text: 'Fixed: dragging a slider could drag its whole card away as a ghost. Cards now reorder from their grip, and drag-and-drop works on desktop.' },
      { area: 'Desktop', text: 'No more native Reload/Inspect menu or draggable images in the app; pinch zooms the graph and the keyframe editor.' },
    ],
  },
  {
    id: '2026.10.181',
    date: '2026-10-11',
    title: 'Ball action',
    highlights: [
      { area: 'Studio', text: 'Pieces: Scatter (seeded, with turn and size), Instability, Dim floor, and a Ball shape that glows from its centre. Example: Pieces: ball action.' },
      { area: 'Studio', text: 'Balls (3D): Scatter in X, Y and Z, Scatter depth, Twist and Instability; balls can now move sideways without being cut off.' },
      { area: 'Studio', text: 'Pieces and Balls get Focus and Blur like the particle camera. 3D sideways scatter and Blur are slow for now.' },
    ],
  },
  {
    id: '2026.10.180',
    date: '2026-10-11',
    title: 'Map a hand from the card',
    highlights: [
      { area: 'Studio', text: 'Texture webcam: live hand chips (pinch, openness, palm, roll, nearness). Click one, then any slider, and it becomes a Play control mapped to your hand.' },
      { area: 'Studio', text: 'The camera picker on a Texture card and on the Play page now stay in sync.' },
    ],
  },
  {
    id: '2026.10.179',
    date: '2026-10-11',
    title: 'Softer rays',
    highlights: [
      { area: 'Studio', text: 'Light rays, Brightest: a new Opacity (0.6) lets objects show through, and each ray fades out smoothly instead of stopping. Average is unchanged.' },
    ],
  },
  {
    id: '2026.10.178',
    date: '2026-10-11',
    title: 'Polish',
    highlights: [
      { area: 'Studio', text: 'Fixed: a wired UV (or Baked, Group Output and group param input) couldn\'t be disconnected by clicking its socket.' },
      { area: 'Studio', text: 'Every builder card can be removed: the trash stays in view, 2D layers each get a ×, and Delete removes the focused card.' },
      { area: 'Studio', text: 'Help opens on tap on phones, long names and select values wrap, live numbers no longer jitter, sub-sections are indented, and switches match.' },
    ],
  },
  {
    id: '2026.10.177',
    date: '2026-10-11',
    title: 'Choosing a source',
    highlights: [
      { area: 'Studio', text: 'Agent Builder: Where has External…, which asks what kind of source (graph, group, picture, texture, or create new) and then shows only that choice.' },
      { area: 'Studio', text: 'A picked source shrinks to a thumbnail with Change and ×. The same flow for Born, Only when, field regions, slopes, walls and food.' },
    ],
  },
  {
    id: '2026.10.176',
    date: '2026-10-11',
    title: 'Calmer explanations',
    highlights: [
      { area: 'Studio', text: 'Agent Builder legend: numbers once, beside the title, in steady digits; the words below stay put while you drag.' },
      { area: 'Studio', text: 'Expression Blocks: the Explain row shows the pattern name, its sentence and Open explain view. Panning over a card no longer flips its faces.' },
      { area: 'Studio', text: 'The explain view now keeps any error inside itself with a Back button, instead of taking down the app.' },
    ],
  },
  {
    id: '2026.10.175',
    date: '2026-10-11',
    title: 'Fixes: text, depth, convert',
    highlights: [
      { area: 'Studio', text: 'Text on grids keeps every stroke at every size: a cell counts if any part of a letter touches it, and letters keep a gap.' },
      { area: 'Studio', text: 'Depth Mix: Light keeps the picture\'s colour instead of bleaching it, and Fog and Occlude now look clearly different.' },
      { area: 'Studio', text: 'Fixed: Guided Convert drew wrong when a shader had its own resolution, time or mouse variable. Muted warps no longer slow 3D scenes.' },
    ],
  },
  {
    id: '2026.10.174',
    date: '2026-10-11',
    title: 'Light rays',
    highlights: [
      { area: 'Studio', text: 'Radial Fast Blur: long zoom streaks and light rays from any picture, in Average, Brightest (god rays) or Add, with a threshold so only bright parts streak.' },
      { area: 'Studio', text: 'Light rays also as a builder Effects card and a Play Finish effect. Any length costs about 1 ms at 1080p. Examples: LIGHT, and Colour burst.' },
    ],
  },
  {
    id: '2026.10.173',
    date: '2026-10-11',
    title: 'Math paths and loose grids',
    highlights: [
      { area: 'Studio', text: 'Grid builder: math paths (curves like Lissajous, rose and harmonograph, or your own x and y of t) and path modifiers: wave, noise, twist, repeat, ease.' },
      { area: 'Studio', text: 'Grid builder: vary motion, size, spin and pulse per cell (seeded, smooth or per cell), and share one motion across shapes with an offset.' },
    ],
  },
  {
    id: '2026.10.172',
    date: '2026-10-11',
    title: 'Preview with the keys',
    highlights: [
      { area: 'Files', text: 'Every media picker previews from the keyboard: ↑/↓ move and preview, ←/→ restart or skip, Space plays, Enter picks. Sounds, pictures and videos alike.' },
      { area: 'Files', text: 'A click now previews instead of choosing straight away; double-click, Enter or Use it chooses. Only one preview plays at a time.' },
    ],
  },
  {
    id: '2026.10.171',
    date: '2026-10-11',
    title: 'Builders on your phone',
    highlights: [
      { area: 'Phone', text: 'Every builder fits a phone: the picture on top, the sections as swipeable tabs in the bottom bar, and tapping one opens its settings in a sheet.' },
      { area: 'Phone', text: 'New graph on a phone starts from the Scene builder (an empty graph is one tap away). Sliders follow your finger; double tap resets.' },
      { area: 'Studio', text: 'Grid simulation is its own Scene builder kind, opening Grid Rules directly, beside Grid scene.' },
    ],
  },
  {
    id: '2026.10.170',
    date: '2026-10-11',
    title: 'Drawn paths',
    highlights: [
      { area: 'Studio', text: 'Grid builder motion: Angle and Angle spin turn any path; draw your own path or Generate one, open (snap back, ease back, ping-pong) or closed.' },
      { area: 'Studio', text: 'Grid builder sliders get the right-click Play menu: add a built value to Play controls or keyframes.' },
      { area: 'Studio', text: 'Guided Convert: open a helper function as its own group, and recognised patterns (circles, rotations, tiles, palettes, fbm) become library nodes.' },
    ],
  },
  {
    id: '2026.10.169',
    date: '2026-10-11',
    title: 'Mute anything',
    highlights: [
      { area: 'Studio', text: 'Mute any card in any builder (⊘): space blocks, shapes, warps, effects, rules, behaviours. Alt-click solos one. Live mutes never recompile.' },
      { area: 'Studio', text: 'Splat scans turn and scale around their middle, so rotating no longer swings them out of view, and big edge splats are no longer clipped.' },
      { area: 'Studio', text: 'Nested sections on cards are indented with a guide line; Position and Rotation read X/Y/Z. Splat compositing is greyed out until a world is wired.' },
    ],
  },
  {
    id: '2026.10.168',
    date: '2026-10-11',
    title: 'Palettes, effects and scan walkers',
    highlights: [
      { area: 'Studio', text: '2D Scene Builder Look: pick or make a palette and give shapes and background palette slots, plus a stack of colour grades. Bloom and Scanlines retire.' },
      { area: 'Studio', text: 'New Effects page: displace by noise or a picture, swirl, ripple, lens, pixelate, kaleidoscope, blur, glow, chromatic aberration and CRT mask, in any order.' },
      { area: 'Studio', text: 'Agents as splats: a Splats look for walkers, Emit from a splat scan, and Return home. Scan to walkers blows a scan apart and lets it flow back.' },
    ],
  },
  {
    id: '2026.10.167',
    date: '2026-10-11',
    title: 'Pieces and movers',
    highlights: [
      { area: 'Studio', text: 'Pieces: a picture rebuilt from shapes that keep their home colour, scattered by any field and drawn back. Balls: the same in 3D, lifted by brightness or depth.' },
      { area: 'Studio', text: 'Grid Rules: cells with a heading, Move and Collide cards (bounce, turn, merge, explode) and four recipes: Bouncing cells, Fireworks, Movers that merge, Traffic.' },
      { area: 'Studio', text: 'Stacked rules open as nodes, one pass per card. Grid builder rules can stay changed and use and/or/else; shapes pick their simulation state.' },
      { area: 'Studio', text: 'Agent Builder preview: pause, step forward and step back through the last 60 frames.' },
    ],
  },
  {
    id: '2026.10.166',
    date: '2026-10-11',
    title: 'Depth Mix',
    highlights: [
      { area: 'Studio', text: 'Depth Mix: combine a scene with a picture\'s depth: size by depth, space by depth, occlude, fog, light or mix, plus a gradient that flows along depth.' },
      { area: 'Studio', text: '2D Scene Builder Depth tab and a 3D "Picture with depth" card: pick a picture, generate its depth on this device, choose how the scene meets it.' },
      { area: 'Studio', text: 'Examples: Circles sized by depth, and Glow beaming through depth.' },
    ],
  },
  {
    id: '2026.10.165',
    date: '2026-10-11',
    title: '3D builder fixes',
    highlights: [
      { area: 'Studio', text: '3D Scene Builder: Position and Rotation get one slider per axis, so every slider can be dragged. Fixed: a picture could turn the whole scene black.' },
      { area: 'Studio', text: '3D Scene Builder camera: Perspective, Orthographic or Reverse projection. Built scenes no longer include unused picture or material nodes.' },
      { area: 'Studio', text: 'Fixed: seven Ray March 3D sliders (Repeat, Noise Warp, Cone Angle, Twist, Round, Blend) never showed on the card.' },
    ],
  },
  {
    id: '2026.10.164',
    date: '2026-10-11',
    title: 'Paste any recipe',
    highlights: [
      { area: 'Studio', text: 'Paste a 2D Scene Builder or Splat builder recipe into the Do bar and it builds, ready to edit. Recipes from other projects fill in missing pictures.' },
    ],
  },
  {
    id: '2026.10.163',
    date: '2026-10-11',
    title: 'Clean grid glow',
    highlights: [
      { area: 'Studio', text: 'Grid builder: fixed shapes sliced by a seam on Travel and Hop with lag, and the blocky glow patches between cells.' },
      { area: 'Studio', text: 'Grid builder glow style: Soft (default) runs each shape\'s colour into its glow, so it reads as one shape; Halo keeps the old rim.' },
    ],
  },
  {
    id: '2026.10.162',
    date: '2026-10-11',
    title: 'Surprise, unfrozen',
    highlights: [
      { area: 'Studio', text: 'Fixed: Surprise me in the Agent Builder (3D slime especially) could freeze the walkers so later Surprises only changed colour. Every Surprise now restarts.' },
      { area: 'Studio', text: 'Surprise me skips presets that need their own setup, and a surprise that would not compile is undone and rerolled.' },
    ],
  },
  {
    id: '2026.10.161',
    date: '2026-10-11',
    title: 'My blocks',
    highlights: [
      { area: 'Studio', text: '2D Scene Builder: save your own space blocks and combines with a picture of what they do. My blocks leads the library; export, import and copy as text.' },
      { area: 'Studio', text: 'Insert on a wire: float nodes fit any wire (broadcast), and genType nodes like Exp take the wire\'s type. Related search only lists nodes that can connect.' },
    ],
  },
  {
    id: '2026.10.160',
    date: '2026-10-11',
    title: 'Wire any slider',
    highlights: [
      { area: 'Studio', text: 'Wire into sliders: every splat modifier control, and 553 sliders on 157 nodes, can be driven from the graph. Right-click a slider → Control from outside.' },
      { area: 'Studio', text: 'Splat builder is smooth: the picture follows drags and orbits (about 6 ms a frame at 1M splats), and the graph behind it rests while it is open.' },
      { area: 'Studio', text: 'Labels on node cards and builder panels are never cut off; long names wrap. Fixed: the Explain view crashed in a tab opened before an update.' },
    ],
  },
  {
    id: '2026.10.159',
    date: '2026-10-11',
    title: 'Node search, redesigned',
    highlights: [
      { area: 'Studio', text: 'Shift+Space search is wide and follows light/dark mode. It opens on category tiles (plus Builders, Recent, Favourites); open one to browse its nodes.' },
      { area: 'Studio', text: 'Typing shows Matches (exact, prefix, fuzzy, keywords) then Related nodes that fit what you selected, top 8 as tiles, with a preview panel.' },
    ],
  },
  {
    id: '2026.10.158',
    date: '2026-10-11',
    title: 'Splat builder, refined',
    highlights: [
      { area: 'Studio', text: 'Splat effects can measure in the scan\'s own size, so dissolve, explode, wave and crop look right on an object or a whole street.' },
      { area: 'Studio', text: 'Splat builder: X/Y/Z rotation rings, your own node chains kept as cards, a viewport with its own shape, and bloom that no longer washes out scans.' },
      { area: 'Studio', text: 'Fixed: a builder opened from the kind page with the clock paused showed "The preview is hidden" instead of the last frame.' },
    ],
  },
  {
    id: '2026.10.157',
    date: '2026-10-11',
    title: 'Faster moving grids',
    highlights: [
      { area: 'Studio', text: 'Grid builder: big motion with lag is up to 4× faster, and dragging any shape slider past its built range never clips or rebuilds.' },
      { area: 'Studio', text: 'Grid builder: "Copies match the drawn cell" makes every repeated copy move and look alike. Fixed: swap rules with a partner failed to compile.' },
    ],
  },
  {
    id: '2026.10.156',
    date: '2026-10-11',
    title: 'Splat builder',
    highlights: [
      { area: 'Studio', text: 'Splat builder: a Splat scene kind in the Scene builder. Load a scan, place it with handles, stack effects as cards, add a world, camera and turntable.' },
      { area: 'Studio', text: 'Splat builder templates: Turntable, Dissolve reveal, Exploded view, Hologram, Scan in a scene, Cut reveal. Plus Surprise me and Edit this one.' },
      { area: 'Studio', text: 'Fixed: an effect added to a scan already on screen ran with all its settings at 0 until the shader rebuilt.' },
    ],
  },
  {
    id: '2026.10.155',
    date: '2026-10-11',
    title: 'Pictures in pieces',
    highlights: [
      { area: 'Studio', text: 'Grid pictures: Mask (shapes are windows onto a still picture), Matte: colour (one colour per shape) or Matte: piece (each shape carries its piece as it moves).' },
      { area: 'Studio', text: 'Grid builder: drawing is data now (no rebuild, full 24×24, 2.6× faster). Draw modes: only here, repeat, mirror, rotate 4. Big fill shapes no longer clip.' },
      { area: 'Studio', text: 'New nodes: Cell Picture and Cell Pattern bring matte pieces and repeat/mirror cell lookups to hand-built grids.' },
    ],
  },
  {
    id: '2026.10.154',
    date: '2026-10-11',
    title: 'Splat modifiers',
    highlights: [
      { area: 'Studio', text: 'Splat modifiers: wire nodes into a Splat Scene to change every splat: dissolve by noise, explode and return home, wave, colour grade, crop, size, points.' },
      { area: 'Studio', text: 'Splat Attributes and Set Splat let any node chain move or recolour splats, live from Play. Sorting follows moved splats so scans stay correct.' },
    ],
  },
  {
    id: '2026.10.153',
    date: '2026-10-10',
    title: 'Frame rate',
    highlights: [
      { area: 'Studio', text: 'Frame rate: pick Auto (your screen\'s max) or 6–60 fps in the preview header. At 12 fps time steps in 1/12 s jumps for a stop-motion look.' },
      { area: 'Studio', text: 'Frame rate is saved with the graph and kept in recordings, exports, Bake and web pages: a 60 fps video of a 12 fps graph holds each picture.' },
    ],
  },
  {
    id: '2026.10.152',
    date: '2026-10-10',
    title: 'Splats and pictures',
    highlights: [
      { area: 'Studio', text: 'Splat Scene: load a Gaussian splat scan (.ply, .splat, .spz) and render it through the March Camera, hiding and hidden by ray-marched shapes.' },
      { area: 'Studio', text: 'Splat Scene: a million splats in a few milliseconds, placed with Position/Rotation/Scale sliders. Add a splat scan from any March Loop card.' },
      { area: 'Studio', text: 'Every scene builder takes pictures: fill shapes, warp a background through space blocks, wrap 3D shapes and repeat them forever, or put a picture in grid cells.' },
      { area: 'Studio', text: 'Pictures in 3D tile without seams or shimmer, with sharpness, slide, turn and bump-from-brightness sliders.' },
    ],
  },
  {
    id: '2026.10.151',
    date: '2026-10-10',
    title: 'Guided Convert',
    highlights: [
      { area: 'Studio', text: 'Guided Convert: turn a shader into a graph step by step. Select lines, make them nodes, an expression or one function, and pick sliders and inputs.' },
      { area: 'Studio', text: 'Guided Convert: unconverted code keeps running as functions, so the picture stays the same at every step (checked). Group steps, undo, or convert the rest.' },
    ],
  },
  {
    id: '2026.10.150',
    date: '2026-10-10',
    title: 'Paste a picture',
    highlights: [
      { area: 'Studio', text: '⌘⇧D opens the Do bar from any page. Inside a scene builder it jumps to that scene\'s recipe instead.' },
      { area: 'Studio', text: 'Paste a picture: ⌘V a copied image or image link onto a Texture card, or onto the canvas for a new one. The card keeps the link as its source.' },
      { area: 'Desktop', text: 'Image and video links load from any site in the desktop app, including ones that block web pages.' },
    ],
  },
  {
    id: '2026.10.149',
    date: '2026-10-10',
    title: 'Web pages: backgrounds and input',
    highlights: [
      { area: 'Files', text: 'Web export focuses on backgrounds and input: mouse, clicks and keys work, even in the small snippet. Tracking, camera, MIDI and mic are left out and say so.' },
      { area: 'Studio', text: 'Recipes write radius= and height= for cylinders, cones and capsules (r= and h= still work). Switch to Transform warns when output differs by rounding.' },
    ],
  },
  {
    id: '2026.10.148',
    date: '2026-10-10',
    title: 'Text grids',
    highlights: [
      { area: 'Studio', text: 'Grid Rules: start from text (the letters come alive), stamp words on the try board, and draw your own neighbourhood up to 7×7 with weights.' },
      { area: 'Studio', text: 'Grid scene: stamp text onto the mini grid or keep a pattern only inside words. Open as nodes now works with drawn and text starts.' },
    ],
  },
  {
    id: '2026.10.147',
    date: '2026-10-10',
    title: '3D Scene Builder, rebuilt',
    highlights: [
      { area: 'Studio', text: '3D Scene Builder in the Agent Builder layout: sections for Mode, Shapes, Combine, Warps, Light, Camera and Output, with pictures throughout.' },
      { area: 'Studio', text: '3D Scene Builder: orbit the preview, click a shape and drag its handles to move or resize it. Sliders get the Play menu once built.' },
      { area: 'Studio', text: 'Grid Rules: stack rule cards on a base (cells meet and explode, too crowded, drift, big clusters change), with four ready-made recipes.' },
      { area: 'Studio', text: 'Inside a Shader Texture the view centres its nodes, the minimap shows the inside, and the preview shows the texture (or where it is used).' },
      { area: 'Studio', text: 'Grid scene: Make it a simulation now starts Grid Rules from your drawing.' },
    ],
  },
  {
    id: '2026.10.146',
    date: '2026-10-10',
    title: 'Switch to Transform',
    highlights: [
      { area: 'Studio', text: 'Old transform cards have a Transform pill that swaps them for the universal Transform, keeping wires, keyframes and Play controls. Right-click switches all.' },
      { area: 'Studio', text: 'Transform shows a 2D / 3D / 4D chip and the right preview. GLSL import turns rotations into Transform.' },
    ],
  },
  {
    id: '2026.10.145',
    date: '2026-10-10',
    title: 'Grid Rules, rebuilt',
    highlights: [
      { area: 'Studio', text: 'Grid Rules builder in the Agent Builder layout: draw cells on a try board, step back and forward, and use your drawing as the start.' },
      { area: 'Studio', text: 'Grid Rules: stencils you click to edit, Blocks as before/after per rule then Together, Smooth settings in plain words, and slower Waves.' },
    ],
  },
  {
    id: '2026.10.144',
    date: '2026-10-10',
    title: 'Grid builder',
    highlights: [
      { area: 'Studio', text: 'Grid scene builder: draw shapes on a mini grid, give them motion, add patterns and warps, and rules like "when A is in column 5, become a star".' },
      { area: 'Studio', text: 'Grid scene: Make it a simulation turns your drawing into a Grid Rules start (and back). Templates, Surprise me, and Edit this one reopen it.' },
    ],
  },
  {
    id: '2026.10.143',
    date: '2026-10-10',
    title: 'Transform by default',
    highlights: [
      { area: 'Studio', text: 'Transform is the default way to move, turn and scale: Position is open, Rotate and Scale fold with a summary, and the controls grow from 2D to 3D to 4D.' },
      { area: 'Studio', text: 'Builders, the Do bar and search use Transform now. In 3D it joins or makes a Scene. The smaller transform nodes are still there.' },
    ],
  },
  {
    id: '2026.10.142',
    date: '2026-10-10',
    title: 'One Scene builder',
    highlights: [
      { area: 'Studio', text: 'One Scene builder: pick 2D, Agent, Grid or 3D scene. It starts fresh by default, or reopens a scene a builder made to edit it.' },
      { area: 'Studio', text: 'While a builder is open the canvas behind it pauses: 2D and 3D previews run twice as often, sharper, and update while you drag.' },
      { area: 'Studio', text: 'Builder sliders work like the app\'s: double-click to reset, centred two-way sliders, type past the end to widen, right-click Play menu.' },
    ],
  },
  {
    id: '2026.10.141',
    date: '2026-10-10',
    title: 'Recipes explain themselves',
    highlights: [
      { area: 'Studio', text: 'Recipes and the Do bar: rest on a word to see its help right there, and pick another mode, choice or colour from it.' },
      { area: 'Studio', text: 'Show the words is now a guide in sections (Modes, Combine, Shapes, Warps, Settings, Camera, Colours, Output) with types and examples.' },
      { area: 'Studio', text: 'Shapes take size= for every side at once, or width=, height= and depth= one by one. Show me how steps through a command with a render per step.' },
    ],
  },
  {
    id: '2026.10.140',
    date: '2026-10-10',
    title: 'Transform any space',
    highlights: [
      { area: 'Studio', text: 'Transform: one node that moves, turns and scales 2D, 3D or 4D space. Place 2D is now called Transform 2D.' },
      { area: 'Studio', text: 'SDF Fill no longer draws faint lines along grid cell edges (Pixel hearts and other cell scenes).' },
      { area: 'Studio', text: 'Builders: Done closes the builder and zooms to what it built. Socket tooltips wrap and stay on screen, without the browser tooltip doubling them.' },
      { area: 'Files', text: 'Fixed: small web export pages showed only black. The mouse now works in them too.' },
    ],
  },
  {
    id: '2026.10.139',
    date: '2026-10-10',
    title: 'Drag the diagrams',
    highlights: [
      { area: 'Studio', text: 'Agent Builder: drag the diagrams (feelers, turn arcs, Born, arrows, fields, view ring) and the sliders follow, one undo per drag.' },
      { area: 'Studio', text: 'Agent Builder: any input can be wired from the graph, from a group, or a new Shader Texture or group. The Sensors demo walker now rides the trail.' },
      { area: 'Studio', text: 'Agent Builder: text as food (slime grows into the letters) or as a wall, in a smooth shader-drawn font you can edit and drag.' },
    ],
  },
  {
    id: '2026.10.138',
    date: '2026-10-10',
    title: 'Space blocks',
    highlights: [
      { area: 'Studio', text: '2D Scene Builder: space blocks of uv.x / uv.y / uv lines with x, y and t, a library of 37 warps, Random offers three, and blocks chain or combine.' },
      { area: 'Studio', text: '2D Scene Builder: Surprise me makes a whole scene (warps, shapes, motion and colours) from a seed, as one undo step.' },
    ],
  },
  {
    id: '2026.10.137',
    date: '2026-10-10',
    title: 'Shader Texture and small exports',
    highlights: [
      { area: 'Studio', text: 'Shader Texture: a node with its own graph drawn into a texture you can wire anywhere (food, masks, starts). Starters, edit inside, update on change.' },
      { area: 'Studio', text: 'Agent Builder: pick Where from the graph\'s shapes with thumbnails or draw one, named trail swatches, and Look for every kind.' },
      { area: 'Studio', text: 'Group sockets look and work the same everywhere: locks on built-ins, + Add an input, rename and remove. Scene Pos and Output only inside 3D.' },
      { area: 'Play', text: 'Built-in signals (count, active, share) and MIDI notes in any octave, with Map 12 notes to 12 targets.' },
      { area: 'Files', text: 'Web export is small: a plain shader exports as a ~12 KB snippet instead of 1.5 MB, plus Copy GLSL. The full player only brings what the graph uses.' },
    ],
  },
  {
    id: '2026.10.136',
    date: '2026-10-10',
    title: 'Autosave',
    highlights: [
      { area: 'Files', text: 'Saved graphs are grouped Today, This week and Earlier (newest first), with folders after, and the lists scroll inside themselves.' },
      { area: 'Studio', text: 'Autosave: a saved graph you change is saved as a new minor version every 5 minutes (2–15), on by default while it is open. The chip shows the countdown.' },
    ],
  },
  {
    id: '2026.10.135',
    date: '2026-10-10',
    title: 'Everyday fixes',
    highlights: [
      { area: 'Studio', text: 'New nodes land where you are looking (builders, Do bar, recipes), and Convert / Auto layout keep graphs compact instead of stranding nodes far left.' },
      { area: 'Studio', text: 'Agent Builder: smooth How far ahead slider, Surprise me is back, Edit this one / Start over / Add another, and advanced rules stay in the builder.' },
      { area: 'Studio', text: 'Expression Blocks: select a number → Make a slider; Copy as code and Make a function; a simpler card; Functions fold out from the side.' },
      { area: 'Studio', text: 'Fixed: the preview after a lost GPU context (no more console errors), and the Do bar reads back agents recipes it printed.' },
    ],
  },
  {
    id: '2026.10.134',
    date: '2026-10-10',
    title: 'Pictures inside 3D scenes',
    highlights: [
      { area: 'Studio', text: 'March Loop: Add a picture with depth sets up a picture, its depth and a Depth Composite in one click, optionally lit by the scene and reflected.', link: { kind: 'doc', path: 'docs/depth-node.md' } },
      { area: 'Studio', text: 'Depth Light: Link to scene object makes a light follow a shape or its Translate, live. Picture Environment lets objects reflect the picture.' },
      { area: 'Studio', text: 'Depth: try other models (experimental, Compare side by side); Depth Pro and ZoeDepth give metres. A webcam runs live.' },
    ],
  },
  {
    id: '2026.10.133',
    date: '2026-10-10',
    title: 'One Texture node',
    highlights: [
      { area: 'Studio', text: 'One Texture node for pictures, videos and the webcam: upload, drop, pick from the library, or paste an image URL. Crop, rotate, tile and trim on the card.', link: { kind: 'doc', path: 'docs/texture-node.md' } },
      { area: 'Studio', text: 'Fixed: saved graphs reopen with their pictures. Each is kept in the library and embedded small in the graph, so it survives reloads and travels in .playfiles.' },
      { area: 'Studio', text: 'Webcam on the card with Play\'s camera and hand controls; map a hand to any slider. Generate depth adds a wired Depth node (or Depth Composite in 3D).' },
    ],
  },
  {
    id: '2026.10.132',
    date: '2026-10-10',
    title: 'Glow and shadows on pictures',
    highlights: [
      { area: 'Studio', text: 'Depth Light: wire a Glowing scene and its objects light the picture from wherever they are, any shape, following as they move. No positions to type.' },
      { area: 'Studio', text: 'Depth Light: Shadows from casts the scene\'s objects\' soft shadows onto the picture.' },
      { area: 'Studio', text: 'Depth keeps one model (Depth Anything V2 Small). A video\'s depth is baked first so it plays smoothly.' },
    ],
  },
  {
    id: '2026.10.131',
    date: '2026-10-09',
    title: 'Pictures in 3D scenes',
    highlights: [
      { area: 'Studio', text: 'Depth Composite: a picture with depth and a 3D scene, the nearer wins per pixel, so 3D objects pass behind and in front of people.', link: { kind: 'doc', path: 'docs/depth-node.md' } },
      { area: 'Studio', text: 'Depth Light: a light or glowing object in the scene lights the picture where it faces it, fading with distance; chain several for more lights.' },
    ],
  },
  {
    id: '2026.10.130',
    date: '2026-10-09',
    title: 'Depth',
    highlights: [
      { area: 'Studio', text: 'Depth node: depth from any image, video or texture, worked out on this device by one of three models you can compare (downloaded once, when first used).', link: { kind: 'doc', path: 'docs/depth-node.md' } },
      { area: 'Studio', text: 'Outputs a near mask (cut out a subject), normals (relight a flat picture) and parallax UV (a 2.5D shift). Bake depth for smooth video and web pages.' },
    ],
  },
  {
    id: '2026.10.129',
    date: '2026-10-09',
    title: 'Walkers that remember',
    highlights: [
      { area: 'Studio', text: 'Agent Builder Memory: name up to four numbers a walker keeps (counter, timer, on/off, a value, a place, a level that fades), each with live range.' },
      { area: 'Studio', text: 'Change them with cards (count, set, toggle, add up what it smells, decay, reset) or an expression; use them in "only when", sliders and colour.' },
      { area: 'Studio', text: 'Ants with food is now cards, with carrying and away memories; a card can have two "only when" conditions.' },
    ],
  },
  {
    id: '2026.10.128',
    date: '2026-10-09',
    title: 'Follow a field',
    highlights: [
      { area: 'Studio', text: 'Agent Builder: Follow a field. Pick fields from moving tiles (curl, vortex, source, saddle, dipole, waves, spiral…) and stack them with weights, masks and spin.' },
      { area: 'Studio', text: 'Write your own field as vx, vy in x, y, t, checked as you type. Ride it (trace its lines) or Push (swing past them); the field is drawn over the picture.' },
    ],
  },
  {
    id: '2026.10.127',
    date: '2026-10-09',
    title: 'A calmer viewport',
    highlights: [
      { area: 'Studio', text: 'Agent Builder: one "On the picture" legend explains each overlay in plain words from its values; the drawings carry small tags instead of scattered labels.' },
      { area: 'Studio', text: 'Hover a legend entry, tag or control to light the other two. Click one to focus it: its control alone, a short explanation and a looping demo.' },
    ],
  },
  {
    id: '2026.10.126',
    date: '2026-10-09',
    title: 'Under the hood',
    highlights: [
      { area: 'Studio', text: 'Agent Builder: Under the hood shows the walkers\' state textures channel by channel (position, heading, age, life, memory…) and the trail channels.' },
      { area: 'Studio', text: 'Hover a texel to ring its walker with its numbers, click a walker to light its texel, Follow one as it moves.' },
      { area: 'Studio', text: 'Fixed: holding a key on a slider\'s number box could crash the panel ("Maximum update depth").' },
    ],
  },
  {
    id: '2026.10.125',
    date: '2026-10-09',
    title: 'Particles, flocks and orbiters',
    highlights: [
      { area: 'Studio', text: 'Agent Builder builds particles (forces as arrows), flocks (view radius ring, neighbours lit), orbiters (the orbit circle) and crowds, each from cards.' },
      { area: 'Studio', text: 'Walker kinds as chips: add, rename, colour; picking one spotlights its walkers. Any card can say "only when…", and cards drag to reorder.' },
    ],
  },
  {
    id: '2026.10.124',
    date: '2026-10-09',
    title: 'The new Agent Builder',
    highlights: [
      { area: 'Studio', text: 'Agent Builder starts with what you are making (trail followers, particles, flocks, orbiters), each with a moving picture.', link: { kind: 'doc', path: 'docs/agent-builder.md' } },
      { area: 'Studio', text: 'Trail followers build from cards (Born, Senses, Turning, Moving, Trail) around the live picture; each draws its diagram on a walker as you drag.' },
      { area: 'Studio', text: 'Presets along the bottom as picture cards, including slime variants: veins, cells, mesh, clumps.' },
    ],
  },
  {
    id: '2026.10.123',
    date: '2026-10-09',
    title: 'Fewer, clearer builders',
    highlights: [
      { area: 'Studio', text: 'March Loop and GI Lit cards show Warp safety (Off, Auto, Careful, High), Show (the steps heatmap) and Jitter pattern; Max step appears with Warp safety on.' },
      { area: 'Studio', text: 'Agent Rules and the 3D Agent Builder are one Agent Builder (2D or 3D). The Expression Builder is hidden while it is reworked.' },
    ],
  },
  {
    id: '2026.10.122',
    date: '2026-10-09',
    title: 'Explain view',
    highlights: [
      { area: 'Studio', text: 'Expression Block: a line\'s fold is a short summary with Open explain view: the line, its steps, a big live picture (the main canvas pauses), and Try values.' },
      { area: 'Studio', text: 'When a line moves with time, the explain view adds Time: play, scrub, speed, and a filmstrip of the picture over a few seconds.' },
      { area: 'Studio', text: 'The model explains a line inside the explain view; the editor keeps Explain the block.' },
    ],
  },
  {
    id: '2026.10.121',
    date: '2026-10-09',
    title: 'Smarter Expression Builder',
    highlights: [
      { area: 'Studio', text: 'Expression Builder ranks what usually comes next in shaders like yours, hides dull moves (Show hidden), and names what you built: cell repeat, domain warp…' },
      { area: 'Studio', text: 'Surprise me builds a random chain of moves that work; Undo takes it back. Each "used in" opens the code it came from.' },
    ],
  },
  {
    id: '2026.10.120',
    date: '2026-10-09',
    title: 'Expression Builder',
    highlights: [
      { area: 'Studio', text: 'Expression Builder: start from UV, a world position or Time and grow an expression from moves found in real shaders, each shown as a live picture.', link: { kind: 'doc', path: 'docs/expression-builder.md' } },
      { area: 'Studio', text: 'Tune a move\'s numbers before or after picking it, go back to any step, then Add to graph: a commented Expression Block with sliders. Do… bar: "new expression".' },
    ],
  },
  {
    id: '2026.10.119',
    date: '2026-10-09',
    title: 'Previews under their line',
    highlights: [
      { area: 'Studio', text: 'Expression Block: ▶ on a line opens its picture right under that line, not at the bottom of the list; ↑ / ↓ move it along with the line.' },
    ],
  },
  {
    id: '2026.10.118',
    date: '2026-10-09',
    title: 'Beam and Ride a curve',
    highlights: [
      { area: 'Studio', text: 'Curve Trace Beam mode: an oscilloscope screen that keeps a fading trail, at a cost that doesn\'t grow with Persistence (dense figures 10× cheaper than Live).', link: { kind: 'example', key: 'curveTraceBeam' } },
      { area: 'Studio', text: 'Agents: Ride a curve puts walkers on a Curve Trace-style curve (waves, Rotary, Morph), each with its own place, speed and lane across a ribbon. 2D and 3D.', link: { kind: 'doc', path: 'docs/agents-group.md' } },
      { area: 'Studio', text: 'New examples: Curve Trace: oscilloscope beam, Walkers on a harmonograph, Morphing ribbon.' },
    ],
  },
  {
    id: '2026.10.117',
    date: '2026-10-09',
    title: 'Auto preview resolution',
    highlights: [
      { area: 'Studio', text: 'Preview resolution has Auto (the new default): a scene heavy enough to slow the app drops to ½, ⅓ or ¼ and comes back up when it fits. The button reads Auto ½.' },
      { area: 'Studio', text: 'The ? help marks show one tooltip, not two.' },
    ],
  },
  {
    id: '2026.10.116',
    date: '2026-10-09',
    title: 'Faster Curve Trace',
    highlights: [
      { area: 'Studio', text: 'Curve Trace skips the parts of the curve that can\'t be nearest: a Live dot with a long trail does about an eighth of the GPU work, with the same picture.', link: { kind: 'doc', path: 'docs/curve-trace.md' } },
    ],
  },
  {
    id: '2026.10.115',
    date: '2026-10-09',
    title: 'Explain, rebuilt',
    highlights: [
      { area: 'Studio', text: 'Expression Block lines have a Build-up: each input and step as a small picture with its range. Click a row or ← → to show it on the preview.', link: { kind: 'doc', path: 'docs/expression-explainer.md' } },
      { area: 'Studio', text: 'Explain always asks the on-device model: each line in plain words, then what the whole block does. It reads measured values and where each input comes from.' },
      { area: 'Studio', text: 'A bigger optional model, Olmo 3 7B (3.8 GB, WebGPU), for machines with 16 GB or more. Save and Load now sit beside the graph name in the top bar.' },
    ],
  },
  {
    id: '2026.10.114',
    date: '2026-10-09',
    title: 'No more angle seams',
    highlights: [
      { area: 'Studio', text: 'Gradient Angular has no seam on the left any more (the old one-turn version is Angular, full turn). The 2D Scene Builder\'s colour by angle is seamless too.' },
      { area: 'Studio', text: 'Polar Space and Log-Polar Space have a Seam setting: Mirrored (no seam) for noise, ramps and gradients; Full turn for petals, arms and colour wheels.' },
    ],
  },
  {
    id: '2026.10.113',
    date: '2026-10-08',
    title: 'Agents around a shape',
    highlights: [
      { area: 'Studio', text: 'Agent Rules in 3D: Look → Around a shape adds a lit torus, sphere or box the walkers flow round and hide behind. Do… bar: "new 3d agents round a shape".', link: { kind: 'doc', path: 'docs/agent-rules.md' } },
      { area: 'Studio', text: 'Adding an Agents group offers Rules in 3D; switching a 3D setup to 2D removes the camera and adds the trail palette, so 2D ⇄ 3D round trips cleanly.' },
    ],
  },
  {
    id: '2026.10.112',
    date: '2026-10-08',
    title: '3D Agent Builder',
    highlights: [
      { area: 'Studio', text: '3D Agent Builder: walkers in a ball, a volume trail and an orbiting camera in one click, with the rules editor open. Do… bar: "new 3d agents".', link: { kind: 'doc', path: 'docs/agent-rules.md' } },
      { area: 'Studio', text: 'Agent Rules has a Space 2D / 3D switch that converts the whole setup (sensors, Emit shape, trail, camera) in one undo step.' },
      { area: 'Studio', text: 'In 3D the Look tab has the camera (distance, angle, elevation, orbit, zoom, depth of field); new 3D templates: slime, flock, orbiters, curl smoke.' },
    ],
  },
  {
    id: '2026.10.111',
    date: '2026-10-08',
    title: '4D in the Scene Builder',
    highlights: [
      { area: 'Studio', text: '3D Scene Builder adds 4D shapes: hypersphere, tesseract, duocylinder, Clifford torus, 24-cell and quaternion Julia/Mandelbrot, sliced at W with 4D rotations.' },
      { area: 'Studio', text: 'Cones in the 3D Scene Builder now point up; builder help titles read cleaner.' },
    ],
  },
  {
    id: '2026.10.110',
    date: '2026-10-08',
    title: 'Series everywhere',
    highlights: [
      { area: 'Files', text: 'Export a saved graph as this version or the whole series in one .playfile; opening a whole series brings every version back.' },
      { area: 'Play', text: 'Background: queue a series\' every version, or the newest of each family, and step through iterations of one idea with Change background.' },
    ],
  },
  {
    id: '2026.10.109',
    date: '2026-10-08',
    title: 'Graph series',
    highlights: [
      { area: 'Studio', text: 'Saving makes a series: Minor for a tweak (2.3 → 2.4), Major for a new direction (→ 3.0), Save in place, or New graph. The name chip shows Curves 2.3.', link: { kind: 'doc', path: 'docs/graph-series-plan.md' } },
      { area: 'Studio', text: 'Saving under a name that is already a series adds a new family to it; older saves read as 1.0, 1.1…' },
      { area: 'Files', text: 'Files shows each graph\'s versions as 2.3, grouped into families. History is capped by size (App settings), keeping each family\'s first and latest.' },
    ],
  },
  {
    id: '2026.10.108',
    date: '2026-10-08',
    title: 'Live harmonograph',
    highlights: [
      { area: 'Studio', text: 'Curve Trace Live mode: X and Y in Hz move a dot that leaves a trail; slow, a dot with a tail, fast, a solid figure, like a museum harmonograph.', link: { kind: 'example', key: 'curveTraceLive' } },
      { area: 'Studio', text: 'Curve Trace has a Head output (the moving dot) for drawing it bright.', link: { kind: 'doc', path: 'docs/curve-trace.md' } },
      { area: 'Files', text: 'Graphs and Play setups now export as .playfile in one click; JSON files still open.' },
    ],
  },
  {
    id: '2026.10.107',
    date: '2026-10-08',
    title: 'Clearer explanations, cleaner bar',
    highlights: [
      { area: 'Studio', text: 'Explanations read shading as ideas: the floor, the sunlight, the sky light, a rim; later lines reuse them, and colours show as swatches.' },
      { area: 'Studio', text: 'The graph\'s name sits in the top bar (Untitled until saved): click it to name and save. Page tabs are icons that open on hover.' },
      { area: 'Studio', text: 'Nodes library: 2D/3D Shapes, 4D split into Shapes, Space and Projection, Agents and Agent presets, Chladni; alphabetical throughout.' },
      { area: 'Studio', text: '3D examples are lighter: shadows and occlusion only where lighting is the point (the sun button adds them anywhere).' },
    ],
  },
  {
    id: '2026.10.106',
    date: '2026-10-08',
    title: 'Better bloom, quieter background',
    highlights: [
      { area: 'Studio', text: 'Upgrade an old Bloom to a same-frame glow (right-click or the card\'s spark button): no lag or smear behind moving things, a soft core and a long tail.', link: { kind: 'doc', path: 'docs/blur-and-glow.md' } },
      { area: 'Studio', text: 'Glow (texture) Bloom chain has Tail, for a long, dreamy falloff; Tone Map has Jodie Reinhard, which keeps bright glows coloured.' },
      { area: 'Files', text: 'App settings → Background: slow down or pause while another window is in front, and free GPU memory after 3 minutes hidden, so other tabs don\'t run short.', link: { kind: 'doc', path: 'docs/background.md' } },
    ],
  },
  {
    id: '2026.10.105',
    date: '2026-10-08',
    title: 'Curve Trace',
    highlights: [
      { area: 'Studio', text: 'Curve Trace (2D) and Curve Trace 3D: continuous Lissajous and harmonograph curves as distance fields you can colour, glow or combine like any SDF.', link: { kind: 'doc', path: 'docs/curve-trace.md' } },
      { area: 'Studio', text: 'Draw a curve with a moving pen and a fading trail, or morph between two figures. Lateral or rotary motion; waves or your own formula in t.', link: { kind: 'example', key: 'curveTracePen' } },
      { area: 'Studio', text: 'New examples: pen drawing, morph, harmonograph intervals and a 3D Lissajous knot.', link: { kind: 'example', key: 'curveTraceKnot' } },
    ],
  },
  {
    id: '2026.10.104',
    date: '2026-10-08',
    title: 'Repeat Scene combine',
    highlights: [
      { area: 'Studio', text: 'Repeat Scene can melt, carve or intersect its copies with the Not repeated scene (Combine + Blend), not just place them side by side.', link: { kind: 'doc', path: 'docs/repeat-scene.md' } },
      { area: 'Studio', text: 'Repeat Cell has a Centre output, so copies can react to a point. New example: Repeat Scene: around a centrepiece.', link: { kind: 'example', key: 'repeatSceneCentrepiece' } },
    ],
  },
  {
    id: '2026.10.103',
    date: '2026-10-08',
    title: 'Repeat Scene',
    highlights: [
      { area: 'Studio', text: 'Repeat Scene repeats a whole 3D scene in a grid and checks neighbouring cells cheaply, so copies can overlap without being sliced.', link: { kind: 'doc', path: 'docs/repeat-scene.md' } },
      { area: 'Studio', text: 'Repeat Cell gives each copy its own random size, place or colour. New example: Repeat Scene: overlapping bubbles.', link: { kind: 'example', key: 'repeatSceneBubbles' } },
      { area: 'Studio', text: 'Switch a March Loop Group to a GI Lit March Group and back (right-click, or the Light the scene card); body, settings and wires kept.', link: { kind: 'doc', path: 'docs/light-scene.md' } },
    ],
  },
  {
    id: '2026.10.102',
    date: '2026-10-08',
    title: 'Light the scene',
    highlights: [
      { area: 'Studio', text: 'Light the scene: the sun button (or right-click) on a March Loop Group lights a 3D or 4D scene in one click, wired to the Output.', link: { kind: 'doc', path: 'docs/light-scene.md' } },
      { area: 'Studio', text: 'Eight looks: Daylight, Studio, Golden hour, Moonlight, Clay, Neon rim, Wax / skin and Quick. Picking another replaces the rig.' },
    ],
  },
  {
    id: '2026.10.101',
    date: '2026-10-08',
    title: 'Warp safety everywhere',
    highlights: [
      { area: 'Studio', text: 'Warp safety now works in volumetric loops and the GI Lit March Group; GI\'s shadow, bounce and reflection rays step safely too.', link: { kind: 'doc', path: 'docs/warp-safety.md' } },
      { area: 'Studio', text: 'New Stretch output on the march loops: wire it into Soft Shadow or SDF AO so their rays don\'t tear through warped space.' },
      { area: 'Studio', text: '3D Scene Builder: Quality → Warp safety (recipe: quality warp=careful), which also wires Stretch into its shadows and AO.' },
    ],
  },
  {
    id: '2026.10.100',
    date: '2026-10-08',
    title: 'Warp safety',
    highlights: [
      { area: 'Studio', text: 'Warp safety on the March Loop: Auto, Careful or High stop twisted, bent or folded 3D space from tearing, without slowing every ray.', link: { kind: 'doc', path: 'docs/warp-safety.md' } },
      { area: 'Studio', text: 'March Loop Show → Steps heatmap: see where rays struggle (orange to white) to tune Max step and Max steps.' },
      { area: 'Studio', text: 'March Camera takes one vec3 Target input instead of three floats; the X/Y/Z sliders still set it when nothing is wired.' },
    ],
  },
  {
    id: '2026.10.99',
    date: '2026-10-08',
    title: '4D fractals',
    highlights: [
      { area: 'Studio', text: '4D fractals: Quaternion Julia and Quaternion Mandelbrot shapes, sliced into 3D like the other 4D shapes, under 4D → Fractals.', link: { kind: 'doc', path: 'docs/4d.md' } },
      { area: 'Studio', text: 'New example 4D: Quaternion Julia, where the fractal boils and curls as its constant drifts and it turns in 4D.' },
    ],
  },
  {
    id: '2026.10.98',
    date: '2026-10-08',
    title: '2D builder functions',
    highlights: [
      { area: 'Studio', text: '2D Scene Builder functions: bend space with a GLSL function (twirl, z², inversion…) or draw a shape from one (flower, spiral, wobbly blob…).', link: { kind: 'doc', path: 'docs/scene-builder-2d.md' } },
      { area: 'Studio', text: 'Find more pulls functions from your saved code, the Convert examples and the Expression Blocks in the examples; each becomes a Custom Function node.' },
      { area: 'Studio', text: 'Type new 2d scene in the Do bar to open the 2D Scene Builder.' },
    ],
  },
  {
    id: '2026.10.97',
    date: '2026-10-08',
    title: '2D grid scenes',
    highlights: [
      { area: 'Studio', text: '2D Scene Builder Grid tab: a grid of cells with up to three shapes given out by checker, column, row, every Nth or at random.', link: { kind: 'doc', path: 'docs/scene-builder-2d.md' } },
      { area: 'Studio', text: 'Ripples from the centre, corners, the mouse or a point travel through the grid and change each cell: size, turn, a push, or a morph between shapes.' },
      { area: 'Studio', text: 'Two new examples: Morphing ripple grid and Ripples that follow the mouse. In recipes: grid 14 shape=circle shape=box target=morph.' },
    ],
  },
  {
    id: '2026.10.96',
    date: '2026-10-08',
    title: 'Worked examples',
    highlights: [
      { area: 'Studio', text: 'Worked examples: each step of a line\'s step-by-step shows its value with sample inputs and a small bar of its range across the picture.', link: { kind: 'doc', path: 'docs/worked-examples.md' } },
      { area: 'Studio', text: 'Change the sample values in the With row (angle = 0.5, iTime = 2…) and every step updates.' },
    ],
  },
  {
    id: '2026.10.95',
    date: '2026-10-08',
    title: '2D Scene Builder',
    highlights: [
      { area: 'Studio', text: 'The 2D Scene Builder: pick shapes from a gallery, bend the space (tile, kaleidoscope, warp…), add motion and rings of copies, set the look, then Build.', link: { kind: 'doc', path: 'docs/scene-builder-2d.md' } },
      { area: 'Studio', text: 'It writes a real node graph with notes, previews live, has a Recipe tab, and right-click → Edit in 2D Scene Builder brings a built scene back to the form.' },
      { area: 'Studio', text: 'New examples folder 2D: Scene Builder: a kaleidoscope of glowing rings, orbiting shapes, and a ring of rings.' },
    ],
  },
  {
    id: '2026.10.94',
    date: '2026-10-08',
    title: 'Model step-by-steps',
    highlights: [
      { area: 'Studio', text: 'Explain these steps: with the explanation model downloaded, a line\'s step-by-step can be explained by the model, a sentence per step with a confidence dot.', link: { kind: 'doc', path: 'docs/retired-experiments.md' } },
      { area: 'Studio', text: 'Settings: turn on Explain step-by-steps with it automatically to have the model explain steps as soon as you open them.' },
    ],
  },
  {
    id: '2026.10.93',
    date: '2026-10-08',
    title: 'Library regrouped',
    highlights: [
      { area: 'Studio', text: 'The Nodes library is regrouped: 2D tools, 3D tools, 4D tools, SDF, Colour, Effects (with post-processing), Simulation, Generators and Math & Logic.' },
      { area: 'Studio', text: 'Every library section explains itself: open 2D Primitives to read what an SDF is, or hover a row for a one-line summary.' },
    ],
  },
  {
    id: '2026.10.92',
    date: '2026-10-08',
    title: '4D to 2D',
    highlights: [
      { area: 'Studio', text: '4D straight to 2D: 4D Wireframe 2D draws a turning tesseract as flat glowing lines, and Plane Slice 4D cuts any 4D shape with a plane into morphing 2D shapes.', link: { kind: 'doc', path: 'docs/4d.md' } },
      { area: 'Studio', text: 'Two new 4D examples: Flat tesseract and Plane through a duocylinder, plus a step-by-step guide to 4D projection in the docs.' },
    ],
  },
  {
    id: '2026.10.91',
    date: '2026-10-08',
    title: 'Trigger buttons',
    highlights: [
      { area: 'Studio', text: 'Trigger settings are buttons: Start over on Agents and Burst on Emit and Particles. Play, keys, beats and rules can still fire them.' },
    ],
  },
  {
    id: '2026.10.90',
    date: '2026-10-08',
    title: 'Suggest group controls',
    highlights: [
      { area: 'Play', text: 'Suggest controls now finds group controls too: settings on a group face and one level inside are always measured, since they often change the picture most.' },
    ],
  },
  {
    id: '2026.10.89',
    date: '2026-10-08',
    title: '4D scenes build themselves',
    highlights: [
      { area: 'Studio', text: 'Adding a 4D shape or transform now builds the 3D scene for it: a Scene Group with a Lift to 4D, plus a camera and march loop, like 3D shapes do.', link: { kind: 'doc', path: 'docs/4d.md' } },
      { area: 'Studio', text: 'A second 4D shape joins the scene beside the first and shares its Lift, so one W slices both. 4D transforms get a tesseract to show what they do.' },
    ],
  },
  {
    id: '2026.10.88',
    date: '2026-10-08',
    title: '4D projection',
    highlights: [
      { area: 'Studio', text: '4D projection: 4D Wireframe draws the tesseract, 5-cell, 16-cell or 24-cell as glowing edges in perspective or orthographic, like the classic cube in a cube.', link: { kind: 'doc', path: 'docs/4d.md' } },
      { area: 'Studio', text: 'Project 4D gives a 4D shape its solid shadow, and Stereographic 4D with Hopf Circles draws the famous linked rings of the 3-sphere.' },
      { area: 'Studio', text: 'Four new 4D examples: Rotating tesseract, 24-cell wireframe, Duocylinder shadow and Hopf rings.' },
    ],
  },
  {
    id: '2026.10.87',
    date: '2026-10-08',
    title: 'Volumetric port fix',
    highlights: [
      { area: 'Studio', text: 'Fixed: turning on volumetric in a scene whose shapes take settings through Scene Group ports (like the 4D examples) no longer fails with undeclared identifiers.' },
    ],
  },
  {
    id: '2026.10.86',
    date: '2026-10-08',
    title: '4D shapes',
    highlights: [
      { area: 'Studio', text: 'More 4D shapes: duocylinder, spherinder, cubinder, cylindrical prism, ditorus, Clifford torus, and the 5-cell, 16-cell and 24-cell.', link: { kind: 'doc', path: 'docs/4d.md' } },
      { area: 'Studio', text: '4D transforms and noise: Scale, Repeat, Mirror/Fold and Twist in 4D, plus Noise 4D for wobbling 4D shapes or evolving textures.' },
      { area: 'Studio', text: 'Five new 4D examples: Duocylinder dance, The 24-cell, Clifford torus, a morphing 4D lattice, and a gallery of every 4D shape.' },
    ],
  },
  {
    id: '2026.10.85',
    date: '2026-10-08',
    title: '4D slices and shadows',
    highlights: [
      { area: 'Studio', text: 'Lift to 4D has a slice direction: face-, edge- or corner-first. Corner-first turns a tesseract into a tetrahedron, then an octahedron, then back.', link: { kind: 'doc', path: 'docs/4d.md' } },
      { area: 'Studio', text: 'Shadows and ambient occlusion now work in scenes whose shapes take settings through Scene Group ports, and Play can reach settings inside a Scene Group.' },
      { area: 'Studio', text: 'New example: Tesseract, all three slices, side by side. The 4D examples now have shadows and AO.' },
    ],
  },
  {
    id: '2026.10.84',
    date: '2026-10-08',
    title: 'Curved space',
    highlights: [
      { area: 'Studio', text: 'Curved space: a Space curvature setting on March Loop groups bends rays through spherical (k > 0) or hyperbolic (k < 0) space, exactly, and works on Play.', link: { kind: 'doc', path: 'docs/curved-space.md' } },
      { area: 'Studio', text: 'March Camera gets a Perspective choice: normal, orthographic or reverse, where farther things look bigger.' },
      { area: 'Studio', text: 'Three new examples in Curved space: a spherical world of spheres, a hyperbolic tunnel of columns, and a reverse-perspective room.' },
    ],
  },
  {
    id: '2026.10.83',
    date: '2026-10-08',
    title: 'First taste of 4D',
    highlights: [
      { area: 'Studio', text: 'A first taste of 4D: Lift to 4D, Rotate 4D (six planes), Translate 4D, Hypersphere and Tesseract nodes, sliced into a normal 3D scene.', link: { kind: 'doc', path: 'docs/4d.md' } },
      { area: 'Studio', text: 'Two 4D examples: a turning tesseract slice, and a hypersphere swelling and shrinking inside a hollow tesseract as the slice sweeps.' },
    ],
  },
  {
    id: '2026.10.82',
    date: '2026-10-08',
    title: 'Explain with confidence',
    highlights: [
      { area: 'Studio', text: 'Explain more is more careful: it only sees the code and what feeds each input, not node names, and each answer gets a confidence dot with a not sure tag.', link: { kind: 'doc', path: 'docs/retired-experiments.md' } },
      { area: 'Studio', text: 'Pick your explanation model in Settings: the fast Qwen2.5-Coder 1.5B or Qwen3 4B, which thinks first and is better at maths. Compare models shows both answers.' },
    ],
  },
  {
    id: '2026.10.81',
    date: '2026-10-08',
    title: 'Suggest controls',
    highlights: [
      { area: 'Play', text: 'Suggest controls: Playfield tries every setting across its range and lists the ones that change the picture most, smoothly and without blanking it.', link: { kind: 'doc', path: 'docs/suggest-controls.md' } },
      { area: 'Play', text: 'Each suggestion shows a filmstrip of what it does and a usable range. Tick the ones you want and add them to Play in one step.' },
    ],
  },
  {
    id: '2026.10.80',
    date: '2026-10-08',
    title: 'Explain more (experimental)',
    highlights: [
      { area: 'Studio', text: 'Experimental: an optional local model (1.4 GB, on your device) adds Explain more under code explanations, plus Explain this node and Explain this block.', link: { kind: 'doc', path: 'docs/retired-experiments.md' } },
      { area: 'Studio', text: 'Its answers are labelled and can be wrong; they sit under the built-in explanation with the facts it was given. Download or remove it in Settings.' },
    ],
  },
  {
    id: '2026.10.79',
    date: '2026-10-08',
    title: 'Relevant nodes',
    highlights: [
      { area: 'Studio', text: 'The Nodes library shows what fits: 3D-only categories fold into Not for this graph in a 2D graph, and come first inside a 3D scene.' },
      { area: 'Studio', text: 'Fits here: select a node or drag a wire and the library lists nodes that take its output, ranked by how often they follow it. Show all brings everything back.' },
    ],
  },
  {
    id: '2026.10.78',
    date: '2026-10-08',
    title: 'Randomise options',
    highlights: [
      { area: 'Studio', text: 'Randomise options on the canvas dice: strength, colours, choices, settings on a group face or inside groups, and a seed.' },
      { area: 'Studio', text: 'Lock any slider (hover it for the lock) or skip a whole node, and Randomise never touches it. Locks are saved with the graph.' },
      { area: 'Studio', text: 'Focus on what changes the picture: Randomise measures which settings change the image most and moves those more, leaving dead ones alone.' },
    ],
  },
  {
    id: '2026.10.77',
    date: '2026-10-08',
    title: 'Honest GPU timing',
    highlights: [
      { area: 'Studio', text: 'Honest GPU timing: the Performance panel shows your shader measured on its own, separate from all GPU work in the frame, plus a timer-floor note on Macs.' },
      { area: 'Studio', text: 'Hovering the preview no longer redraws the whole shader to read one pixel colour, so the GPU reading stays flat instead of climbing.' },
    ],
  },
  {
    id: '2026.10.76',
    date: '2026-10-08',
    title: 'Simpler Surprise',
    highlights: [
      { area: 'Studio', text: 'Do bar Surprise writes a random line again, leaning a little toward the shapes, steps and palettes your graphs use. Step through lines with the arrows.', link: { kind: 'doc', path: 'docs/surprise.md' } },
      { area: 'Studio', text: 'Retired experiments: Evolve, Deep, ratings and the Taste page are gone. The image model stays, now under Settings, for future help features.', link: { kind: 'doc', path: 'docs/retired-experiments.md' } },
    ],
  },
  {
    id: '2026.10.75',
    date: '2026-10-07',
    title: 'Taste by look',
    highlights: [
      { area: 'Studio', text: 'A small image model runs on your device to learn how things look: Deep and Surprise avoid near-duplicates and lean toward looks you like.', link: { kind: 'doc', path: 'docs/retired-experiments.md' } },
      { area: 'Files', text: 'Steer by any words: "neon city" or "underwater" in the taste context box become by-look chips. See it under How things look, or turn it off in Settings.' },
    ],
  },
  {
    id: '2026.10.74',
    date: '2026-10-07',
    title: 'Your taste page',
    highlights: [
      { area: 'Files', text: 'A Your taste page in Files: a plain-language profile of what you like, what it learned with a trace back to each pick or rating, and a log of every signal.', link: { kind: 'doc', path: 'docs/retired-experiments.md' } },
      { area: 'Files', text: 'Steer your taste: type context like "dark, lots of motion, no fBm" and see the chips it understood, or boost, avoid or ban any technique.' },
      { area: 'Files', text: 'Take your taste with you: export a .playfield-taste profile and import it on another install, where it keeps learning on top.' },
    ],
  },
  {
    id: '2026.10.73',
    date: '2026-10-07',
    title: 'Evolve and your taste',
    highlights: [
      { area: 'Studio', text: 'Evolve in the Do bar: pick between two surprises, then choose a Refine of your pick or a Branch inspired by it, round after round.', link: { kind: 'doc', path: 'docs/retired-experiments.md' } },
      { area: 'Studio', text: 'Playfield learns your taste on your machine (no cloud): from Evolve picks, likes, and what you keep or undo. Surprise, Deep and suggestions lean toward it.' },
      { area: 'Studio', text: 'Like or dislike saved graphs, examples, GLSL shaders, palettes and pattern cards. A Your taste panel shows what it learned, with Reset and Export.' },
    ],
  },
  {
    id: '2026.10.72',
    date: '2026-10-07',
    title: 'Inspired surprises',
    highlights: [
      { area: 'Studio', text: 'Surprise is inspired by 2-3 real graphs or GLSL files (examples and your own), borrowing techniques and code from each. The toast links to its sources.', link: { kind: 'doc', path: 'docs/surprise.md' } },
      { area: 'Studio', text: 'A Do bar Surprise now replaces the current graph (one undo step), and results vary far more: 42 technique combinations in 50 rolls, up from 12.' },
      { area: 'Studio', text: 'Surprise arrows: step through several candidates with ‹ › before keeping one. Deep mode tries up to 16 and shows the best 5, with why-chips.' },
      { area: 'Studio', text: 'The Do bar is cleaner: just the input. The full reference is behind the ⓘ button.' },
    ],
  },
  {
    id: '2026.10.71',
    date: '2026-10-07',
    title: 'Pattern discovery',
    highlights: [
      { area: 'Studio', text: 'Patterns in the Code Explorer: 41 techniques in 13 families (light falloff, domain warp, tiling, wave interference...) with the graphs that use each one.', link: { kind: 'doc', path: 'docs/reports/pattern-discovery.md' } },
      { area: 'Studio', text: 'Each technique shows its maths and its variants side by side. Open a graph to see the matching nodes, or right-click a node for its patterns.' },
    ],
  },
  {
    id: '2026.10.70',
    date: '2026-10-07',
    title: 'Do bar crash fix',
    highlights: [
      { area: 'Studio', text: 'Fixed: typing create palette, create mix or create crt-screen with some nodes selected could blank the whole app. The Do bar now can never take the app down.' },
      { area: 'Studio', text: 'More examples rebuild from Show as commands: 184 of 398 now come out identical, up from 166.', link: { kind: 'doc', path: 'docs/reports/language-pressure-test.md' } },
    ],
  },
  {
    id: '2026.10.69',
    date: '2026-10-07',
    title: 'Show as commands',
    highlights: [
      { area: 'Studio', text: 'Show as commands: a new button in the Do bar header shows the current graph as Do-bar commands you can copy, with anything it cannot express marked.', link: { kind: 'doc', path: 'docs/playfield-language.md' } },
    ],
  },
  {
    id: '2026.10.68',
    date: '2026-10-07',
    title: 'Sand jitter',
    highlights: [
      { area: 'Studio', text: 'Blocks rules have a Jitter setting that breaks up the row bands while sand falls; Falling sand uses it by default and still settles into a smooth heap.', link: { kind: 'doc', path: 'docs/grid-rules.md' } },
      { area: 'Studio', text: 'The Grid Rules preview now rolls the same dice as the canvas, so random rules look identical in both. jitter= also works in recipes.' },
    ],
  },
  {
    id: '2026.10.67',
    date: '2026-10-07',
    title: 'One Playfield language',
    highlights: [
      { area: 'Studio', text: 'One Playfield language across the Do bar and the Scene, Grid Rules and Agent Rules recipes: same words, same colour names, same value syntax.', link: { kind: 'doc', path: 'docs/playfield-language.md' } },
      { area: 'Studio', text: 'Randomness anywhere: falloff=random, random(0.2..2), a leading random, and seed=42. The Recipe tab shows what it picked, with Roll again.' },
      { area: 'Studio', text: 'Do bar autocomplete after verbs: create lists what you can make, connect suggests wires from your graph with socket types.' },
      { area: 'Studio', text: 'Surprise me in the Do bar (with a size, 2D or 3D), a history of what you typed, and Rebuild from recipe on builder-made nodes you edited.' },
      { area: 'Studio', text: 'Every builder has a Recipe tab, and the Commands reference is generated from the language itself so it never goes stale.' },
    ],
  },
  {
    id: '2026.10.66',
    date: '2026-10-07',
    title: 'Shadertoy alpha fix',
    highlights: [
      { area: 'Studio', text: 'Shadertoy shaders that write alpha 0 now show up instead of rendering black, in the GLSL tab, Convert and GLSL import, as Shadertoy shows them.' },
    ],
  },
  {
    id: '2026.10.65',
    date: '2026-10-07',
    title: 'Falling sand fix',
    highlights: [
      { area: 'Studio', text: 'Falling sand in Grid Rules now piles into real heaps: the preset has a floor and starts as a cloud of grains instead of a striped sheet.', link: { kind: 'doc', path: 'docs/grid-rules.md' } },
      { area: 'Studio', text: 'The Grid Rules preview now matches the canvas at the walls, so grains in the edge columns no longer hang in the air.' },
    ],
  },
  {
    id: '2026.10.64',
    date: '2026-10-07',
    title: 'Surprise me',
    highlights: [
      { area: 'Studio', text: 'Surprise me in every builder: a random 3D scene, a Grid Rules rule that stays alive, or new Agent Rules walkers. Each shows its seed.', link: { kind: 'doc', path: 'docs/surprise.md' } },
      { area: 'Studio', text: 'Surprises are one undo step, with Reroll and Undo in the toast. Type a seed back in to get the same result again.' },
      { area: 'Studio', text: 'Blank, blown-out or dead results are skipped automatically, and Randomize now picks interesting values instead of any value.' },
      { area: 'Studio', text: 'Scene Builder adds a Random shape button and a dice to randomise any item; the canvas toolbar has a dice for the whole level.' },
    ],
  },
  {
    id: '2026.10.63',
    date: '2026-10-07',
    title: 'Walker kinds',
    highlights: [
      { area: 'Studio', text: 'Agent Rules has a Kind choice in the Species tab: Trail followers, Particles, Flock (boids), Ants, Swarm or Crowd.', link: { kind: 'doc', path: 'docs/agent-rules.md' } },
      { area: 'Studio', text: 'A real Neighbours node: walkers find each other through a shared grid, so flocks and crowds react to actual nearby walkers.' },
      { area: 'Studio', text: 'The Boids and Crowd examples are rebuilt on real neighbours, running 64k walkers smoothly, plus new Particles and Swarm templates.' },
    ],
  },
  {
    id: '2026.10.62',
    date: '2026-10-07',
    title: 'Builder tabs',
    highlights: [
      { area: 'Studio', text: 'Builders use tabs: Grid Rules (Presets · Neighbourhood · Born & Survive · Start · Brush · Colours) and Agent Rules (Species · Rules · Trails · Look).' },
      { area: 'Studio', text: 'Born & Survive explains itself: 3×3 pictures for each count (born, stays, lonely, crowded), a live sentence, and a mini-board with Glider and Blinker.', link: { kind: 'doc', path: 'docs/grid-rules.md' } },
    ],
  },
  {
    id: '2026.10.61',
    date: '2026-10-07',
    title: 'A visual Scene Builder',
    highlights: [
      { area: 'Studio', text: 'Scene Builder: a shape gallery with real thumbnails; click or drag shapes in, then edit them in an inspector.', link: { kind: 'doc', path: 'docs/scene-builder-3d.md' } },
      { area: 'Studio', text: 'Combines nest any way you like: smooth-union two shapes, intersect that with a third, subtract a fourth. Wrap in… groups a selection.' },
      { area: 'Studio', text: 'Any shape or group can carry modifiers (move, rotate, scale, twist, round, onion…) as chips; @move(1,0.5,0) now works in recipes.' },
    ],
  },
  {
    id: '2026.10.60',
    date: '2026-10-06',
    title: 'Structure hints',
    highlights: [
      { area: 'Studio', text: 'A flow strip above the canvas (Space → Shape → Shape it → Colour → Post, with 3D, pass and agent flows) lights your stages and suggests the next.', link: { kind: 'doc', path: 'docs/structure-hints.md' } },
      { area: 'Studio', text: 'Stage colours on cards, gentle notices for odd orders (never blocking), and Auto layout → Arrange by stage. The builders show their flow too.' },
    ],
  },
  {
    id: '2026.10.59',
    date: '2026-10-06',
    title: 'Function cards',
    highlights: [
      { area: 'Studio', text: 'Function cards: click a function in read-only code (or ⌥-click / hover in editors, long-press on touch) for its signature, plain meaning and plot.', link: { kind: 'doc', path: 'docs/expression-explainer.md' } },
      { area: 'Studio', text: 'Each card explains that exact call ("here: 0 to 1 as d goes from 0.3 to 0.32") with How is this used? and snippets; F1 opens it at the caret.' },
    ],
  },
  {
    id: '2026.10.58',
    date: '2026-10-06',
    title: 'Builders up front',
    highlights: [
      { area: 'Studio', text: 'A Builders section tops the node browser (3D Scene Builder, Grid Rules, Agent Rules), also on right-click and in the Do… bar ("new 3d scene").' },
      { area: 'Studio', text: 'Built cards show their recipe or rule as a chip with Copy and Open, and say "edited since build" when you have changed the nodes.' },
      { area: 'Studio', text: 'The Recipe tab colours every word and shows one row per clause, with combined shapes indented like a tree. Edit as text still works.', link: { kind: 'doc', path: 'docs/scene-builder-3d.md' } },
    ],
  },
  {
    id: '2026.10.57',
    date: '2026-10-06',
    title: 'Clearer explanations',
    highlights: [
      { area: 'Studio', text: 'Explanations read plainly first: "silent is 1 while a stays under 0.02…", with a tag for the common job it does; the literal steps fold away below.' },
      { area: 'Studio', text: 'Names, numbers and code in explanations are coloured chips, like the code above; hover one to light where it is read.' },
      { area: 'Studio', text: 'Lines that map one number to another show a small plot of the curve, with its edges marked: click it to enlarge.' },
    ],
  },
  {
    id: '2026.10.56',
    date: '2026-10-06',
    title: 'New features on phones',
    highlights: [
      { area: 'Studio', text: 'Phones and tablets: builders open full screen with tabs, the Do… bar has a button, previews get Show as, and ? help opens on tap.' },
      { area: 'Studio', text: 'Touch: hold for "is this typical?" and function uses, the brush paints with a finger, and the clip trimmer has big handles and Set In / Set Out.' },
      { area: 'Studio', text: 'Time Cube can choose and edit a video on phones, line previews have ▶ and ▲▼, and the Code Explorer opens on mobile.' },
    ],
  },
  {
    id: '2026.10.55',
    date: '2026-10-06',
    title: 'Do bar commands',
    highlights: [
      { area: 'Studio', text: 'Do… bar commands: chain steps ("create a ring, colour it by the length of the space, then output it") and edit graphs you already have.', link: { kind: 'doc', path: 'docs/do-bar-commands.md' } },
      { area: 'Studio', text: 'Connect, disconnect, insert between, multiply/add with, output, switch, set, make bigger: one undo each, with a picker when a name fits several nodes.' },
      { area: 'Studio', text: 'A Commands reference (ⓘ in the bar) lists every verb with examples to Try and Show me how. Grid Rules presets work as phrases ("game of life").' },
      { area: 'Studio', text: 'Fixed: made-node descriptions say "radius 0.3 (adjustable)". Termites now pile up, fireflies flash together, and forest fires sweep.' },
    ],
  },
  {
    id: '2026.10.54',
    date: '2026-10-06',
    title: 'Builders that help',
    highlights: [
      { area: 'Studio', text: 'Builders explain themselves: How this works cards with clickable examples, ? hints on every control, and a Tips switch to hide or show them.' },
      { area: 'Studio', text: 'Type-ahead in recipes, the Do… bar and rule pickers, plus type checks that refuse bad wires and offer a fix (use its brightness, take .x).' },
      { area: 'Studio', text: 'Scene Builder Output: depth, normal, distance, hit, steps, AO, or colour by depth/height/normal through a palette ("output depth").', link: { kind: 'doc', path: 'docs/scene-builder-3d.md' } },
    ],
  },
  {
    id: '2026.10.53',
    date: '2026-10-06',
    title: 'Grid fixes',
    highlights: [
      { area: 'Studio', text: 'Grid fixes: the Breathing example\'s dots now stay centred in every cell; Neighbor Dist can check 3×3 or 5×5; Tile has a Cell ID output.' },
      { area: 'Studio', text: 'Grid Pattern pushes are capped at what Overflow can draw, and grid hashes no longer break down at very large cell numbers.' },
    ],
  },
  {
    id: '2026.10.52',
    date: '2026-10-06',
    title: 'Grid Rules',
    highlights: [
      { area: 'Studio', text: 'Grid Rules: one node and an editor for cellular simulations: Count (Life and friends), Stages, Smooth (heat, waves, reaction-diffusion).', link: { kind: 'doc', path: 'docs/grid-rules.md' } },
      { area: 'Studio', text: 'Patterns (3×3 stencils, first match wins) and Blocks (2×2 before → after pictures that keep every count) for Wireworld, sand and gas.' },
      { area: 'Studio', text: 'The grid examples rebuilt as 2-node Grid Rules versions; Open as nodes shows the wired version. Brush painting now works in the Studio too.' },
    ],
  },
  {
    id: '2026.10.51',
    date: '2026-10-06',
    title: 'Suggestions and the Do bar',
    highlights: [
      { area: 'Studio', text: 'Suggestions: select a node for its likely next moves (Glow, Rings, Warp, Tone map…), ranked mostly by your own graphs and by what the preview shows.', link: { kind: 'doc', path: 'docs/suggestions.md' } },
      { area: 'Studio', text: 'The Do… bar (⌘K): type "circle in the middle with a glow, falloff 8" or "repeat 6 times around" and it builds the nodes.' },
      { area: 'Studio', text: 'Ask "is this typical?" about a wire, teach the Do… bar your own phrases from a selection, and insert snippets in code editors.' },
    ],
  },
  {
    id: '2026.10.50',
    date: '2026-10-06',
    title: 'Code Explorer',
    highlights: [
      { area: 'Studio', text: 'Code Explorer: search how a function is used across examples, your graphs, presets and linked GLSL: patterns ranked by count, with real code.', link: { kind: 'doc', path: 'docs/code-explorer.md' } },
      { area: 'Studio', text: 'Plain-words search ("soft circle edge"), what feeds a function and what it feeds, Open to jump to the node and line, and How is this used? in the editors.' },
    ],
  },
  {
    id: '2026.10.49',
    date: '2026-10-06',
    title: 'Explain and make a node',
    highlights: [
      { area: 'Studio', text: 'Explain: each Expression Block line gets a plain reading ("a soft-edged circle of radius 0.3"), step by step, from 62 shader idioms.', link: { kind: 'doc', path: 'docs/expression-explainer.md' } },
      { area: 'Studio', text: 'Make a node from this: turn an idiom or part of a line into a node or preset, numbers as sliders. Where else is this used? finds matches.' },
      { area: 'Studio', text: 'Explain also on the card\'s code page, per statement in Custom Functions, and for a selection on the GLSL page.' },
    ],
  },
  {
    id: '2026.10.48',
    date: '2026-10-06',
    title: 'Scene Builder and Agent Rules',
    highlights: [
      { area: 'Studio', text: '3D Scene Builder: describe shapes, how they combine, space warps, look and camera in a form; Build makes a real, readable node graph.', link: { kind: 'doc', path: 'docs/scene-builder-3d.md' } },
      { area: 'Studio', text: 'Scenes round-trip as recipe text, e.g. "volumetric · smooth-union(sphere, cone) k=0.3 · twist 0.5"; Describe reads hand-made 3D graphs.' },
      { area: 'Studio', text: 'Agent Rules: write agent behaviour as When … Do … lines with named states; Open as nodes shows the same rule as ordinary nodes.', link: { kind: 'doc', path: 'docs/agent-rules.md' } },
      { area: 'Studio', text: 'New folders: 3D: Scene Builder (six scenes) and Agents: rules (slime, ants, boids, predators, infection, termites, fireflies, coral).' },
    ],
  },
  {
    id: '2026.10.47',
    date: '2026-10-06',
    title: 'Whole-picture previews',
    highlights: [
      { area: 'Studio', text: 'Previews now keep the picture\'s real shape and fit it in the panel, so nothing is cropped or stretched; Slice gets its own strip below.' },
    ],
  },
  {
    id: '2026.10.46',
    date: '2026-10-06',
    title: 'Agent simulations',
    highlights: [
      { area: 'Studio', text: 'Simulations: agents: predators and prey, coral growth, sand dunes, crowd lanes, painter bots, termites, fireflies and infection, each a hand-written rule.', link: { kind: 'doc', path: 'docs/simulations-agents.md' } },
      { area: 'Studio', text: 'Every rule is built from Agent Inputs, Compare and Expression Blocks with a note on each node, so you can copy the pattern for your own.' },
    ],
  },
  {
    id: '2026.10.45',
    date: '2026-10-06',
    title: 'See each line',
    highlights: [
      { area: 'Studio', text: 'Expression Block editor: \u25b6 on any input, line or Return previews that value (Range, Slice, Grid, Arrows, colour); \u2191\u2193 step through the lines.', link: { kind: 'doc', path: 'docs/node-previews.md' } },
      { area: 'Studio', text: 'Custom Functions can preview any local variable from a dropdown. Previews never change the saved graph.' },
    ],
  },
  {
    id: '2026.10.44',
    date: '2026-10-06',
    title: 'Grid simulations and one clip editor',
    highlights: [
      { area: 'Studio', text: 'Simulations: grids: Game of Life, Life-like rules, Brian\'s Brain, caves, water ripples, heat, forest fire, falling sand and Wireworld, all from existing nodes.', link: { kind: 'doc', path: 'docs/simulations-grids.md' } },
      { area: 'Studio', text: 'The clip editor now opens for Video Input, Video layers, Baked clips, background videos and the Library, with trim, segments, speed, loop and crop.', link: { kind: 'doc', path: 'docs/clip-editor.md' } },
      { area: 'Studio', text: 'Source / Result playback shows exactly the frames or playlist you will get. Video Input files now survive a reload.' },
    ],
  },
  {
    id: '2026.10.43',
    date: '2026-10-06',
    title: 'Roomier code editors',
    highlights: [
      { area: 'Studio', text: 'Expression and Custom Function cards: airier code lines, and a Preview page (Range, Grid, colour…) in place of the signature.' },
      { area: 'Studio', text: 'Their editors fold the Functions panel (closed by default, \u0192 Functions or \u2318]) and the Inputs panel (\u2318[) so the code gets the room.' },
    ],
  },
  {
    id: '2026.10.42',
    date: '2026-10-06',
    title: 'Code on the card',
    highlights: [
      { area: 'Studio', text: 'Expression Blocks and Custom Functions show pages on the card: the code (read-only, coloured), a function signature from the wiring, your note and description.' },
      { area: 'Studio', text: 'Flip pages with the dots or arrows; double-click or Edit opens the full editor, where line editing now lives.' },
    ],
  },
  {
    id: '2026.10.41',
    date: '2026-10-05',
    title: 'A preview for every node',
    highlights: [
      { area: 'Studio', text: 'Preview controls live on the node card; the top banner just says what is previewed, with Exit.' },
      { area: 'Studio', text: 'No more empty or "no preview" boxes: texture and colour nodes show their real output, agent nodes show live trails, diagrams or stats.' },
    ],
  },
  {
    id: '2026.10.40',
    date: '2026-10-05',
    title: 'Smooth blurs and glows',
    highlights: [
      { area: 'Studio', text: 'Blur and Glow (texture) no longer show ghost copies or rings: new Smooth (true Gaussian) and Bloom chain methods, with Fast kept for cheap previews.', link: { kind: 'doc', path: 'docs/blur-and-glow.md' } },
      { area: 'Play', text: 'Look bloom, halation, CRT and edge glow, particle glows, and layers sent into the shader now use the same smooth blur.' },
    ],
  },
  {
    id: '2026.10.39',
    date: '2026-10-05',
    title: 'Agents in 3D',
    highlights: [
      { area: 'Studio', text: 'Agents groups can run in 3D: Space 3D gives walkers depth, a volume trail to sense, and forces with z.', link: { kind: 'doc', path: 'docs/agents-group.md' } },
      { area: 'Studio', text: 'Draw agents gets an orbit camera with the same controls as Time Cube and Frame Stack, plus drift and depth of field, or a 3D scene\'s camera.' },
      { area: 'Studio', text: 'Collide (3D scene) lets walkers bounce off ray-marched shapes. Five 3D examples: slime, flock, torus swarm, galaxy, fireflies.' },
    ],
  },
  {
    id: '2026.10.38',
    date: '2026-10-05',
    title: 'Edit the clip',
    highlights: [
      { area: 'Studio', text: 'Time Cube: Edit clip… opens a trimmer with a filmstrip, In/Out handles and ticks showing exactly which frames are sampled.', link: { kind: 'doc', path: 'docs/time-cube.md' } },
      { area: 'Studio', text: 'Keep several segments (reorder, reverse), share frames by length or equally, add a speed ramp, crop, rotate and flip.' },
    ],
  },
  {
    id: '2026.10.37',
    date: '2026-10-05',
    title: 'Preview detail',
    highlights: [
      { area: 'Studio', text: 'Preview arrows now scale with strength: the strongest is a full arrow, weak ones are short or a dot. A Detail setting makes Grid and Arrows finer.' },
    ],
  },
  {
    id: '2026.10.36',
    date: '2026-10-05',
    title: 'Previews that explain',
    highlights: [
      { area: 'Studio', text: 'Node previews have Show as: vec2 values as a warped Grid, Arrows or a colour Wheel, so you can see how space moves.', link: { kind: 'doc', path: 'docs/node-previews.md' } },
      { area: 'Studio', text: 'Numbers auto-range with a key (no more white squares), a Slice plot shows input vs output, and constants read "= 3.0 everywhere".' },
    ],
  },
  {
    id: '2026.10.35',
    date: '2026-10-05',
    title: 'Texture tools',
    highlights: [
      { area: 'Studio', text: 'Texture tools: Mask, Levels, Flow, Neighbours, Change, Outline, Fade and Read turn any texture into masks, directions and glows.', link: { kind: 'doc', path: 'docs/texture-tools.md' } },
      { area: 'Studio', text: 'They work on Passes, images, video, Baked and agent trails; Mask and Levels also shape plain numbers. Seven new examples.' },
    ],
  },
  {
    id: '2026.10.34',
    date: '2026-10-05',
    title: 'Fewer nodes',
    highlights: [
      { area: 'Studio', text: 'Removed ten rarely used nodes: Glow Falloff, the 3D Fractals, Chladni 3D and its particles, the orbital nodes, and Print Float / Text.' },
      { area: 'Studio', text: 'Graphs that used them still open, with a removed card that says what to use instead.' },
    ],
  },
  {
    id: '2026.10.33',
    date: '2026-10-05',
    title: 'Time cube feather and camera',
    highlights: [
      { area: 'Studio', text: 'Time Cube View: Feather fades the frames around the slice over a span, with side and curve. Opacity sliders now respond evenly from 0 to 1.', link: { kind: 'doc', path: 'docs/time-cube.md' } },
      { area: 'Play', text: 'Camera Translate X / Y / Z fly the time cube camera through space; all camera sliders map on Play. New fly-through example.' },
      { area: 'Studio', text: 'Removed from Time Cube View: Swing, Lightning, Focus and Frame effects. Saved graphs still open.' },
    ],
  },
  {
    id: '2026.10.32',
    date: '2026-10-04',
    title: 'Cleaner time cubes',
    highlights: [
      { area: 'Studio', text: 'Time Cube View: clean slice and highlight edges, no stray sheets or hatching, and a smooth depth of field with Fast / Smooth quality.' },
      { area: 'Studio', text: 'Colour key regrouped, with a live "keeps about 4%" readout and one-click swatches from the slice. Lightning now clearly flashes.' },
      { area: 'Studio', text: 'Time Cube source: 16-bit precision for averaged and median frames.' },
    ],
  },
  {
    id: '2026.10.31',
    date: '2026-10-04',
    title: 'No more march banding',
    highlights: [
      { area: 'Studio', text: 'New March Loops start rays at an even, jittered depth, so volumetric glows lose their contour rings. Animate jitter is optional.' },
      { area: 'Studio', text: 'Volume Glow and SDF Glow have Per distance: Passthrough now changes smoothness, not brightness. Saved scenes are unchanged.' },
      { area: 'Play', text: 'Play, Present, the Output window and web exports now render in high precision with dither, so gradients stop banding.' },
    ],
  },
  {
    id: '2026.10.30',
    date: '2026-10-04',
    title: 'Clearer node sections',
    highlights: [
      { area: 'Studio', text: 'Folded sections now read "4 controls · 1 changed", or Off / On for sections with a switch, counting only what you will see.' },
      { area: 'Studio', text: 'Fixed: switching on Highlights, Frame motion or Frame effects now shows their sliders, and Passthrough shows again on Ray March nodes.' },
    ],
  },
  {
    id: '2026.10.29',
    date: '2026-10-04',
    title: 'Softer time cubes',
    highlights: [
      { area: 'Studio', text: 'Time Cube View: rounded soft edges, rim glow, side tints and shadow; outline off by default. Isometric camera and depth of field.', link: { kind: 'doc', path: 'docs/time-cube.md' } },
      { area: 'Studio', text: 'Highlighted frames that loop with the scan, frames that lift and scale as it passes, and Flow mode where the clip streams through the box.' },
      { area: 'Play', text: 'Animate the key colour, pulse it through the cube in bands, or flash it like lightning, all mappable on the Play page.' },
      { area: 'Studio', text: 'Time Cube source: long exposure, brightest, darkest, motion and median frames; reorder by shuffle, brightness, hue or motion.' },
    ],
  },
  {
    id: '2026.10.28',
    date: '2026-10-04',
    title: 'Frame Stack',
    highlights: [
      { area: 'Studio', text: 'Frame Stack turns a Time Cube\'s frames into cards: stack, fan, ring, torus, helix or grid, and morph between them.', link: { kind: 'doc', path: 'docs/frame-stack.md' } },
      { area: 'Studio', text: 'Scatter and drift cards apart and back, pop out the scan card, loop highlighted frames, shuffle, and add depth of field.' },
    ],
  },
  {
    id: '2026.10.27',
    date: '2026-10-04',
    title: 'Lighter Displacement Map',
    highlights: [
      { area: 'Play', text: 'Displacement Map has a Map quality setting (Full, Half, Quarter); the Ripple example now runs several times faster in the desktop app.' },
      { area: 'Studio', text: 'Octaves on FBM and Domain Warp are live sliders now, so dragging them no longer recompiles.' },
    ],
  },
  {
    id: '2026.10.26',
    date: '2026-10-04',
    title: 'Time cube',
    highlights: [
      { area: 'Studio', text: 'Time Cube stacks a video\'s frames into a box of time; Time Cube View draws it in 3D with a sliding see-through offset.', link: { kind: 'doc', path: 'docs/time-cube.md' } },
      { area: 'Studio', text: 'Key a colour to leave a solid trail through time, or use Time Slice for 2D slit-scan cuts. Three examples included.' },
    ],
  },
  {
    id: '2026.10.25',
    date: '2026-10-04',
    title: 'Bake: render and replace',
    highlights: [
      { area: 'Studio', text: 'Bake… renders a node or the whole picture to a video and puts it back as a Baked node, so heavy 3D and agents play back for almost nothing.', link: { kind: 'doc', path: 'docs/bake.md' } },
      { area: 'Studio', text: 'Unbake brings back the live nodes exactly; Re-bake renders again; baked videos live in the Library and work in Play and on web pages.' },
    ],
  },
  {
    id: '2026.10.24',
    date: '2026-10-04',
    title: 'Switch a node in place',
    highlights: [
      { area: 'Studio', text: 'Switch on a node card (or right-click → Switch to…) turns it into a similar node, keeping its wires: Union to Intersect, Sphere to Cone, sin to cos.' },
      { area: 'Studio', text: 'Settings carry over by name and meaning, and Play controls, keyframes and comments stay with the node; one undo step.' },
    ],
  },
  {
    id: '2026.10.23',
    date: '2026-10-04',
    title: 'Displacement Map, passes in groups',
    highlights: [
      { area: 'Play', text: 'Displacement Map, as in After Effects: any layer pushed by another layer or the picture, by red, green, blue, alpha, luminance, hue, lightness or saturation.', link: { kind: 'doc', path: 'docs/displacement-map.md' } },
      { area: 'Play', text: 'Layers have a Displace button next to Matte and Mask; Look’s Displace gains By channels; Studio gets a Displacement Map node.' },
      { area: 'Studio', text: 'A Pass can live inside a plain group, and texture wires can cross groups: build a blur group once and reuse it.', link: { kind: 'doc', path: 'docs/pass-node-plan.md' } },
      { area: 'Studio', text: 'Repeat on a Pass runs it up to 64 times a frame, for wide blurs, distance fields and faster simulations; a Jump flood node turns a shape into a distance field.' },
      { area: 'Studio', text: 'Texture Input and Video have a Texture output, so Edges, Blur and Particles can read a picture directly, with no copy Pass.' },
    ],
  },
  {
    id: '2026.10.22',
    date: '2026-10-04',
    title: 'Drag nodes in, a Water layer',
    highlights: [
      { area: 'Studio', text: 'Drag nodes from the browser onto the graph. Drop on a wire to insert the node into it; double-click and Enter still work.' },
      { area: 'Play', text: 'A Water layer: a whole-picture or pond-shaped surface that bends only the layers below it, so a boat above it stays sharp in its own wake.', link: { kind: 'doc', path: 'docs/water-layer.md' } },
      { area: 'Play', text: 'Water readings (wave height, energy, area) drive mappings and rules, and a Waves matte shows other layers only where the water moves.' },
      { area: 'Play', text: 'The Water effect’s card has Move to a layer, which keeps its settings, controls and Splash rules.' },
    ],
  },
  {
    id: '2026.10.21',
    date: '2026-10-04',
    title: 'Starter recipes, 3D that just works',
    highlights: [
      { area: 'Studio', text: 'Starter recipes: add a Grid, a noise, an SDF, a Pass and more, and a small card offers one-click setups. Just the node, Esc or Don’t ask again skip it.', link: { kind: 'doc', path: 'docs/starter-recipes.md' } },
      { area: 'Studio', text: 'Every node a recipe adds has a note on what it does and why, and the whole recipe is one undo step.' },
      { area: 'Studio', text: 'Any 3D shape you add lands in your scene, joined and placed beside what is there. A scene, camera and loop are built only when there is none.' },
      { area: 'Studio', text: 'The Volumetric switch builds its glow: Scene Distance, Volume Glow and Glow to Color, wired and explained; off removes them again.' },
    ],
  },
  {
    id: '2026.10.20',
    date: '2026-10-04',
    title: 'Passes you can inspect, sharper desktop zoom',
    highlights: [
      { area: 'Studio', text: 'Passes: probes, scopes and the eye now work on nodes inside a pass, and Performance has a row per pass. Data and Particles nodes work before a Pass.', link: { kind: 'doc', path: 'docs/pass-node-plan.md' } },
      { area: 'Studio', text: 'Particles can be born from a Pass: wire it into Emit from and they appear where the pass is bright, such as along edges.' },
      { area: 'Studio', text: 'New Passes examples: particles born on edges, feedback trails, reaction-diffusion, glow only the bright parts, and slime along edges.' },
      { area: 'Studio', text: 'Desktop zoom: text stays in place and fits its cards when you zoom out, and sliders and wires redraw sharp after you zoom in.' },
    ],
  },
  {
    id: '2026.10.19',
    date: '2026-10-04',
    title: 'Agents with shaders, a friendlier Agents group',
    highlights: [
      { area: 'Studio', text: 'New examples folder, Agents with shaders: eight graphs that plug the Agents group into ordinary nodes and your own shaders, every node explained.', link: { kind: 'example', key: 'agentShaderOutlines' } },
      { area: 'Studio', text: 'A new Agents group asks Particles, Slime or Empty and builds a working starter; Next steps adds Emit, Draw, Trail or Output in one click.' },
      { area: 'Studio', text: 'Inside a group, Agent Inputs shows “This walker” and “From outside the group”, settings use plainer names, and each one has a “?”.' },
      { area: 'Studio', text: 'Agents presets and examples start at 256k walkers with the same trail strength, and land in free space with their cards untangled.' },
      { area: 'Studio', text: 'Recordings and video exports now match the preview when agents read a Pass: traced outlines sit on the picture instead of stretching.' },
    ],
  },
  {
    id: '2026.10.18',
    date: '2026-10-04',
    title: 'Open as nodes, agent readings, galaxies',
    highlights: [
      { area: 'Studio', text: 'Open as nodes on the Particles card builds an editable Agents-group copy of its settings next to it; the original stays as it was.' },
      { area: 'Play', text: 'An Agents group reads like a layer: Alive, Speed, Spread, Centre X / Y and each species’ share, for mappings and rules.' },
      { area: 'Studio', text: 'New presets: Galaxy (spiral arms from orbiting stars), Mycelium (a branching mould colony) and Sand on a plate.' },
      { area: 'Present', text: 'How Agents work now runs the real presets on its slides, with sliders tied to their own settings.' },
    ],
  },
  {
    id: '2026.10.17',
    date: '2026-10-04',
    title: 'Agents and passes on the web',
    highlights: [
      { area: 'Studio', text: 'Exported web pages now run Pass node graphs and Agents groups, matching the app frame for frame. Export no longer warns about them.', link: { kind: 'doc', path: 'docs/agents-group.md' } },
      { area: 'Studio', text: 'On a page, agents hear Level and Beat, the mic after the visitor allows it, and the page’s Granulator tracks; hands follow its tracker or the pointer.' },
      { area: 'Present', text: 'Presentations keep the agents and passes of the examples they show, so they still run after the presentation is reopened.' },
    ],
  },
  {
    id: '2026.10.16',
    date: '2026-10-04',
    title: 'How Agents work',
    highlights: [
      { area: 'Present', text: 'A new sample presentation, How Agents work: the loop, every node, how settings change the result, and what the code does, with live sketches you can tweak.' },
      { area: 'Studio', text: 'Expression Block sliders now really move their value: dragging Crowding’s sat inside the Slime mold changes it live, with no recompile.' },
    ],
  },
  {
    id: '2026.10.15',
    date: '2026-10-04',
    title: 'Agents in Play: hands, sound and motion',
    highlights: [
      { area: 'Studio', text: 'Every slider inside an Agents group is a Play control: map MIDI, LFOs, readers or a null to it, or pin it to the group card. The card shows the walkers live.' },
      { area: 'Studio', text: 'Sound from on the Agents group: the mic, the Audio engine or one of its tracks drives every Sound kick and Chladni inside.' },
      { area: 'Studio', text: 'Walkers follow a hand: set Attract to a hand or null, then Follow a hand in Play. Motion (texture) lets them be born or fed where things move.' },
      { area: 'Play', text: 'Example: Agents in Play, a million particles following your hand and a beat.' },
    ],
  },
  {
    id: '2026.10.14',
    date: '2026-10-04',
    title: 'Agents: species, food and walls',
    highlights: [
      { area: 'Studio', text: 'Walkers can belong to up to four species, each with its own trail, and keep their own memory, deposit and colour.', link: { kind: 'doc', path: 'docs/agents-group.md' } },
      { area: 'Studio', text: 'Trail field gains Add (food) and Block (walls); Move steers around obstacles; Emit can start walkers from a picture or a field.' },
      { area: 'Studio', text: 'New presets: Multi-species slime, Ants (roads from nest to food), Boids, Strands, and slime that grows toward a picture.' },
      { area: 'Studio', text: 'Look inside: the eye preview shows what a walker standing there would see, and Show passes colours each node by the program it runs in.' },
    ],
  },
  {
    id: '2026.10.13',
    date: '2026-10-04',
    title: 'Live Expression sliders',
    highlights: [
      { area: 'Studio', text: 'Dragging an Expression Block’s slider no longer recompiles the shader, and inside an Agents group it no longer restarts the simulation.' },
    ],
  },
  {
    id: '2026.10.12',
    date: '2026-10-04',
    title: 'Agents: particles from nodes',
    highlights: [
      { area: 'Studio', text: 'Force nodes for the Agents group: Gravity, Wind, Curl noise, Attract / Repel, Vortex, Flow, Collide, Sound kick and Chladni. Chain them and they add up.', link: { kind: 'doc', path: 'docs/agents-group.md' } },
      { area: 'Studio', text: 'Integrate (drag, speed, edges) and Age / Life, and Draw agents gains Streaks, Ink and Lights.' },
      { area: 'Studio', text: 'Presets: Particles, Curl smoke and Sound burst, built from nodes you can open and rewire. Every node is explained.' },
    ],
  },
  {
    id: '2026.10.11',
    date: '2026-10-03',
    title: 'Agents: slime mold, built from nodes',
    highlights: [
      { area: 'Studio', text: 'A new Agents group in Simulation: wire the rule one agent follows (Sense, Steer, Move) and it runs for up to a million agents on the GPU.', link: { kind: 'doc', path: 'docs/agents-group.md' } },
      { area: 'Studio', text: 'Emit, Deposit, Trail field and Draw agents go around it. The trail is an ordinary image you can colour, blur or glow.' },
      { area: 'Studio', text: 'A Slime mold preset grows branching veins that keep reorganising, with every node explained.' },
    ],
  },
  {
    id: '2026.10.10',
    date: '2026-10-03',
    title: 'Tidier cards',
    highlights: [
      { area: 'Play', text: 'Rows of options turn into a dropdown when a card is too narrow for them, instead of running off its edge.' },
      { area: 'Play', text: 'Mapping cards fit narrow panels: the source name shortens, Change…, Lock and Follow wrap onto their own lines, and the rest goes in the ⋯ menu.' },
      { area: 'Play', text: 'Layer, control, rule and Look cards wrap their buttons too, so nothing is cut off at any panel width.' },
    ],
  },
  {
    id: '2026.10.9',
    date: '2026-10-03',
    title: 'Water, Chladni sand and your own effects',
    highlights: [
      { area: 'Play', text: 'Water: a real wave surface in Look. Drag a wake with the pointer or any layer, add rain, or splash from a rule; the waves bend the picture and catch the light.', link: { kind: 'example', key: 'finishWater', page: 'play' } },
      { area: 'Play', text: 'Any node that takes a colour and gives one is now a Look effect, with its settings as sliders. Build your own from nodes or GLSL and save it to Your effects.', link: { kind: 'example', key: 'lookBuilt', page: 'play' } },
      { area: 'Studio', text: 'Particles can be sand on a Chladni plate, square or round: the sound picks the figure, and several modes add up to lacy patterns.', link: { kind: 'example', key: 'particleChladniSand' } },
      { area: 'Studio', text: 'New particle examples shaped by fields: a star outline, currents filling a heart, and cymatics in 3D.' },
    ],
  },
  {
    id: '2026.10.8',
    date: '2026-10-03',
    title: 'Motion layer, piano roll window, livelier looks',
    highlights: [
      { area: 'Play', text: 'A Motion layer: how much moves, where and which way, as readings for mappings and rules; a matte that shows a layer only where it moves; particles born there.', link: { kind: 'doc', path: 'docs/motion-layer.md' } },
      { area: 'Play', text: 'Double-click a MIDI clip to edit it in a big piano roll window, with the clip’s key, Highlight scale and Snap to scale in its side panel.', link: { kind: 'doc', path: 'docs/piano-roll.md' } },
      { area: 'Play', text: 'Pixel sort moves on its own: Flow, Drip, Breathe, Wander, Turbulence and Trail, with Melt, Rain and Glitch drift presets.' },
      { area: 'Play', text: 'ASCII takes your own characters, the ASCII layer’s sets, or emoji in their own colours.' },
      { area: 'Play', text: 'Rules can now fire Look effects: Mosh for a few seconds, Reset mosh, or pulse or set any effect’s setting.' },
      { area: 'Files', text: 'Linked folders stay linked, however many and wherever you link them from. A missing folder shows as Not found, with Relocate.', link: { kind: 'doc', path: 'docs/linked-folders.md' } },
    ],
  },
  {
    id: '2026.10.7',
    date: '2026-10-03',
    title: 'The Pass node',
    highlights: [
      { area: 'Studio', text: 'A Pass node renders everything before it into an image, so nodes after it can read that image anywhere: blur it, find its edges, glow it.' },
      { area: 'Studio', text: 'New texture nodes after a Pass: Sample, Edges, Blur, Glow and Displace. A Pass’s Previous output feeds the last frame back in for trails.', link: { kind: 'doc', path: 'docs/pass-node-plan.md' } },
      { area: 'Studio', text: 'Graphs without a Pass node compile and render exactly as before.' },
      { area: 'Studio', text: 'Example: Passes 1 · Edge glow, with every node explained.' },
    ],
  },
  {
    id: '2026.10.6',
    date: '2026-10-03',
    title: 'Smoother sound pages, scattered particles',
    highlights: [
      { area: 'Play', text: 'The Sound rail, Arrangement and Granulator no longer redraw the whole page while controls move: about half the work per frame, and less CPU.' },
      { area: 'Studio', text: 'Particles on a picture spawn at random spots instead of a line sweeping up the image, both at first and after Release.' },
      { area: 'Studio', text: 'Particle glow is gentler by default and in the presets, so bright scenes stop clipping to white.' },
      { area: 'Play', text: 'Datamosh: Refresh now heals at a rate you can see, and Reset mosh snaps back to the live picture (also mappable to a key or a rule’s signal).' },
    ],
  },
  {
    id: '2026.10.5',
    date: '2026-10-03',
    title: 'Particles, piano roll and new looks',
    highlights: [
      { area: 'Studio', text: 'A new Particles node: up to 4 million GPU particles as glowing light or ink in water, in 2D or 3D with depth of field. Presets, and any setting can be wired in.', link: { kind: 'example', key: 'inkInWater' } },
      { area: 'Studio', text: 'Particles can hold a picture and blow away, flow round shapes, stand in a 3D scene, follow your hands and react to sound, an Audio engine track included.', link: { kind: 'example', key: 'particleImageDissolve' } },
      { area: 'Studio', text: 'The old particle nodes (Particle Emitter, the P: chain, Particle System) are gone: their examples use Particles, and old saves say what replaced them.' },
      { area: 'Play', text: 'Piano roll: double-click a MIDI clip on the tape to edit its notes. Snap to scale puts the notes you play into the tape’s scale.', link: { kind: 'example', key: 'pianoRollScale', page: 'play' } },
      { area: 'Play', text: 'The Granulator’s Spectral mode can emit its grains from Position or spread them in time.', link: { kind: 'example', key: 'granulatorSpectral', page: 'play' } },
      { area: 'Play', text: 'New Finish looks: Pixel sort, Halftone, ASCII and Light leaks, and presets on Feedback, Mirror, Edges, Posterize and more.', link: { kind: 'example', key: 'finishPrint', page: 'play' } },
      { area: 'Play', text: 'Datamosh, Motion extract and Echo. Feedback is fixed: no haze left behind, trails stay where things were, and a Source picks what leaves them.', link: { kind: 'example', key: 'finishDatamoshEcho', page: 'play' } },
      { area: 'Studio', text: 'Preview resolution: run the preview at Full, Half, Third or Quarter size to keep heavy graphs smooth; exports stay full size.' },
    ],
  },
  {
    id: '2026.10.4',
    date: '2026-10-03',
    title: 'Effects that know where',
    highlights: [
      { area: 'Play', text: 'Every Finish effect has a Where: everywhere, only where a layer is, on the bright parts, or where the camera sees movement, and Invert.', link: { kind: 'doc', path: 'docs/finish-stack.md' } },
      { area: 'Play', text: 'Nine new Finish effects: Glitch, Ripple, Displace, Mosaic, Mirror, Gradient map, Posterize, Edges and Feedback trails.' },
      { area: 'Play', text: 'Particles can be born where the camera sees movement, or on the bright parts of the picture.' },
      { area: 'Play', text: 'On the Inputs board: drag a source onto a control to drive it, see each mapped slider’s swing as a ring, and find sources grouped by kind with search.' },
      { area: 'Play', text: 'Open a detail window from a layer’s property row, and Keep open to leave it floating while you work.', link: { kind: 'doc', path: 'docs/detail-windows.md' } },
      { area: 'Play', text: 'A Graph view on the Rules page draws sources, controls and rules as one picture; click any node for its details.', link: { kind: 'doc', path: 'docs/graph-view.md' } },
    ],
  },
  {
    id: '2026.10.3',
    date: '2026-10-02',
    title: 'Input names',
    highlights: [
      { area: 'Studio', text: 'Name any node’s inputs in your own words and say what each is for (the pencil on a node card); the code stays the same.' },
      { area: 'Studio', text: 'Publishing a node starts the Node Builder from those names, with each description as the input’s docstring.' },
    ],
  },
  {
    id: '2026.10.2',
    date: '2026-10-02',
    title: 'Sharp zoom',
    highlights: [
      { area: 'Desktop', text: 'Zoomed-in nodes are sharp in the desktop app: cards, text and wires redraw at full resolution once the zoom settles.' },
      { area: 'Studio', text: 'Switch an Expression Block line off without deleting it: the // button, or ⌘/ in the line. It stays, dimmed, as a comment.' },
      { area: 'Studio', text: 'Swipe sideways with two fingers over a long expression to read it; the canvas stays put.' },
    ],
  },
  {
    id: '2026.10.1',
    date: '2026-10-02',
    title: 'Rules and the Inputs board',
    highlights: [
      { area: 'Play', text: 'Signals and actions are Rules: When something happens, Do this. Quick rule: press + Rule, do the thing (a key, a pinch, a note, a sound), pick what happens.', link: { kind: 'doc', path: 'docs/conditions-and-signals.md' } },
      { area: 'Play', text: 'Inputs puts the controls beside the sources that drive them. Map a source onto any number of sliders: Set, or Add around where the slider is.', link: { kind: 'doc', path: 'docs/sources-and-routes.md' } },
      { area: 'Play', text: 'A detail window for any control, source or rule: what drives it, what it drives, the rules on it, with back and forward.', link: { kind: 'doc', path: 'docs/detail-windows.md' } },
      { area: 'Play', text: 'Behaviours: ready-made rules (Pinch to burst, Pulse to the beat, Bass shakes it…), and Save as behaviour for your own.' },
      { area: 'Play', text: 'Play notes: a rule plays a chord, a strum, an arpeggio or a random note on a rack, snapped to a scale.' },
      { area: 'Play', text: 'A Text layer can show a live value; new Bell and Biased random sources; rules show where they sit in a chain or loop.' },
      { area: 'Studio', text: 'A group’s Iterations goes to 128, and on the Play panel it turns without recompiling.' },
    ],
  },
  {
    id: '2026.9.22',
    date: '2026-09-30',
    title: 'Signals, simplified',
    highlights: [
      { area: 'Play', text: 'Signals has its own page (⌘5): each signal shows what makes it true, what sends it and what it sets off.', link: { kind: 'doc', path: 'docs/conditions-and-signals.md' } },
      { area: 'Play', text: 'Any slider’s + can create a signal from it; signals can watch a layer’s readings, the picture’s brightness and positions.' },
      { area: 'Play', text: 'New conditions: between, outside, is not, never reached, rising, falling, steady, every Nth, N within T, and % of range.' },
      { area: 'Play', text: 'Signals combine (All of, Any of, None of) and follow a key or condition while it holds: hover AND click.' },
      { area: 'Play', text: 'A signal can capture a value or a position; Set and Move a layer here make shapes jump to it (a pinch point, a click, a particle collision).' },
      { area: 'Play', text: 'Hold for, Linger, Delay and Chance on signals; Delay on mappings; Shake, Wander, Hop and Chaos in the + menu.' },
      { area: 'Play', text: 'Link signals into chains and loops, with Run/Stop, Speed and Laps.' },
      { area: 'Studio', text: 'The Performance panel shows what Play costs each frame, per stage and per layer.' },
    ],
  },
  {
    id: '2026.9.21',
    date: '2026-09-29',
    title: 'Tabs on every layer editor',
    highlights: [
      { area: 'Play', text: 'Edit notes on the tape: drag to move, drag the end to lengthen, ⌥-drag for velocity, double-click to add, Delete to remove.' },
      { area: 'Play', text: 'Tape clips show their MIDI notes again; a track can show as Audio instead (⋯ → Show the tape as).' },
      { area: 'Play', text: 'Layer editors work in tabs: one section at a time, remembered per layer, with Show all to stack them again.', link: { kind: 'doc', path: 'docs/editor-layout.md' } },
    ],
  },
  {
    id: '2026.9.20',
    date: '2026-09-28',
    title: 'Halation, measured',
    highlights: [
      { area: 'Studio', text: 'The Layers node builds its distance field on the GPU: SDF Glow on layers is as smooth as on a shape.', link: { kind: 'example', key: 'particleGlow' } },
      { area: 'Play', text: 'Halation is bounded: a clipped white or a bright paper bleeds no more than a glint, so the rim stays thin and red-orange.' },
      { area: 'Play', text: 'Granulator grains draw as straight pills along the sample (length = grain size, each at its own height), and nulls from grains follow the same layout.' },
      { area: 'Desktop', text: 'Audio Unit effects after a Granulator are heard and open their windows: its sound is sent into the engine like Sound in.', link: { kind: 'doc', path: 'docs/granulator.md' } },
      { area: 'Play', text: 'The Granulator and the Sample player pick sounds from linked folders too.' },
      { area: 'Play', text: 'Empty Layers and Mappings pages offer Add layer, Layer sets, Add control and Add mapping right there.' },
      { area: 'Play', text: 'Halation now matches a real film-emulation grade: a thin red bleed hugging bright edges and glints, landing on the darker picture beside them.', link: { kind: 'example', key: 'finishHalation', page: 'play' } },
      { area: 'Play', text: 'Halation has a Conserve slider (the bright part gives up what it bleeds), and its presets and defaults follow the measurement.', link: { kind: 'doc', path: 'docs/finish-stack.md' } },
    ],
  },
  {
    id: '2026.9.19',
    date: '2026-09-28',
    title: 'Spread, sample index, Remap ranges',
    highlights: [
      { area: 'Play', text: 'Spread: put sliders in an order and one Amount offsets them along a curve; Shift rotates it, Reset starts from each minimum.', link: { kind: 'doc', path: 'docs/spread-control.md' } },
      { area: 'Play', text: 'Drum pads have a Sample index: step it from a beat or a signal and the same pad walks through every sound, or picks at random.' },
      { area: 'Play', text: 'The Audio engine’s Sample player has a Sample index too: shift which zone each note plays (pitched zones keep their pitch), mappable, and recorded in takes.', link: { kind: 'doc', path: 'docs/audio-engine.md' } },
      { area: 'Studio', text: 'Remap has a Clamp output toggle and shows its ranges as two range rows.' },
    ],
  },
  {
    id: '2026.9.18',
    date: '2026-09-28',
    title: 'Granulator: Emit and Spectral',
    highlights: [
      { area: 'Play', text: 'Trackers say what they are doing (downloading, loading, tracking), keep their models on this device, and can warm up when the app opens.' },
      { area: 'Play', text: 'Track hands in an uploaded video: analyse the clip once and nulls, sources and gestures follow it exactly, in takes and on websites too.', link: { kind: 'doc', path: 'docs/tracking.md' } },
      { area: 'Play', text: 'Face and body tracking join Hands: mouth, smile, blinks, brows and head turns, plus 33 body points, on the camera or a video.' },
      { area: 'Play', text: 'Racks get 8 macro knobs, as in Ableton: each turns many parameters through its own range and curve, and is what you map MIDI or an LFO onto.', link: { kind: 'doc', path: 'docs/audio-engine.md' } },
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
      { area: 'Play', text: 'The + beside any slider opens a mini mapper: pick MIDI, hands, audio, a layer, a generator or another control, and it is wired on the spot.' },
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
