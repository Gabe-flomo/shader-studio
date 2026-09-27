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
      { area: 'Present', text: 'An inviting empty Present page with sample cards; long menus open as sheets on phones.', link: { kind: 'page', page: 'present' } },
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
