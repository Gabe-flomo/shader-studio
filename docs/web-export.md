# Web export

Play → **Put it on a website** (`components/play/EmbedDialog.tsx`) turns the open graph into
something you paste into a page. There are three outputs, from the same input
(`play/webInput.ts` `webInputFrom`):

| Output | What it is | Built by |
| --- | --- | --- |
| **Small snippet** (the default when it can run the graph) | One `<div data-playfield>` with a `<canvas>`, the GLSL in a `<script type="x-shader/x-fragment">`, and a ~90-line WebGL2 bootstrap (7.6 KB). No player, no kit, no three.js. | `play/embedLite.ts` `buildLiteSnippet` (`buildLitePage` for Download page) |
| **Full player** | The player runtime (`play/runtime/play-runtime.js`) and the parts of the layer kit (`play/kit/*`) the graph uses, with the controls panel, layers and mappings. | `play/exportHtml.ts` `buildPlaySnippet` / `buildPlayHtml` |
| **Copy GLSL** | The fragment shader alone, with a header listing the uniforms it reads, their current values and controls' names, and the WebGL2 defines. | `play/embedLite.ts` `buildGlslOnly` |

## What comes along (2026-10-10)

A web export is for backgrounds and light interactivity, not every Play feature.
`play/exportScope.ts` `webExportScope` runs on the page's input before anything is built (the
dialog, Download page, the store's `exportPlayHtml` and the Stage's Exact view all go through it).

**Supported:** the shader with its time and resolution; the mouse position and clicks (`u_mouse`,
`u_mousebtn`, Play mouse sources and click triggers); key presses (key sources and key triggers);
previous-frame feedback, echo and Pass nodes; images (and small videos and songs in the full player);
Play mappings driven by those, by time (LFOs, clocks, noise…) and by other controls. There is no
scroll input: Play has no scroll source, so nothing reads one (a follow-up if wanted).

**Left out**, said plainly in the dialog, with what they drove held at its current value:

| Left out | What goes | The dialog says |
| --- | --- | --- |
| Hand, face and pose tracking | hand / face / pose sources, gesture and proximity triggers, pair mappings on hand points, the trackers' settings, baked tracks and hand-model files | "Hand tracking won't work on a web page; those controls will hold their current value." (face, body alike) |
| The camera | Camera layers and Motion layers reading it (removed), particles / glyphs / contours drawn from it (hidden), sensors and zones on those, controls on removed layers | "The camera won't work on a web page; …" |
| MIDI | MIDI and pad sources, note triggers and actions, the pad grid, the MIDI file, drum pads' and racks' MIDI input (their keys and clicks stay) | "MIDI won't work on a web page; …" |
| The microphone and live audio | live sources, audio triggers, readers on the live input, Audio layers (hidden), an Audio Input node with no song (its band mappings too) | "The microphone and live audio won't work on a web page; …" |
| The Depth node's model | nothing to remove: its live texture reads 0 on a page (a baked depth travels) | "The Depth node's model won't run on a web page, …" |
| Splat Scene scans | nothing to remove: the scan's textures read empty on a page (docs/splat-scene.md) | "Splat Scene scans don't go onto web pages yet: the scan reads empty there …" |

"Held at its current value": `webInputFrom` already bakes the values mappings are giving controls
right now into the uniforms and layers; the scope only removes the mappings, so nothing moves them
on the page. The full player never carries the trackers (`hands`, `tracks`, `face`, `pose`) or
`midi.js`: `kitGroupsFor` no longer picks the `trackers` group and `midi` is now a group of its own it
never picks; only a Present canvas (`host: true`) keeps the whole kit. The "Include hand tracking"
option (12 MB of MediaPipe in the page) is gone from the dialog.

## Why it used to be 28,000 lines

Before 2026-10-10 every export was the full player: the runtime (223 KB) plus **every** kit
file (particles, agents, the Finish stack, p5 and 3D scripts, the audio engine and granulator,
hand/face/pose tracking, data, JFA, passes...) concatenated into one script, whatever the graph
used. A plain shader came out at 28,134 lines and about 1.5 MB, all but ~5 KB of it player code.

## The small snippet

`liteBlockers(input)` decides. The small snippet runs a graph whose picture is one fragment
shader reading only:

- `u_time`, `u_frameDt`, `u_resolution`, `u_mouse` (pixels, y up), `u_mousebtn`;
- its parameter uniforms (the current values, with values mappings are giving baked in);
- `u_prevFrame` (Previous Frame and the blur family): two half-float targets, drawn into in turn;
- image inputs (`u_tex_*`): inline as data URLs within the existing embed limits, otherwise as a
  file next to the page (the snippet's comment and the dialog name the file); an image input
  with no file reads blank, as in the app.

and whose Play has no visible layers, actions, Finish, audio, MIDI, pad grid, tracking, readers,
pair mappings or picture background, and whose mappings are ones the snippet runs (`liteMaps`):

- each enabled mapping (or Source route, Replace) reads the mouse (x, y, a button held), a key held,
  a key or click trigger (envelope, toggle, step or random; fire once), or an LFO or Clock (not the
  random shape);
- it writes a uniform the shader reads, a colour by one channel or as a whole (its brightness);
- one per control (one per channel of a colour), with no increment or delay.

The mapping part of the bootstrap (`LITE_MAPS`, about 3 KB) is in the snippet only when it has
mappings: keys held and pressed from the window, in the capture phase so a host page's own shortcuts don't swallow them (not while typing in a field), clicks on the picture
(a background reads them from the window, since it lets the page's own clicks through), the player's
trigger envelope and its curve and smoothing. Anything else is listed by name ("uses Agents (+94 KB),
Mappings"), and the dialog switches to the full player. A uniform the bootstrap doesn't know is
named too ("its input u_x"), so a new built-in can't silently render black.

What the bootstrap does: compiles the GLSL with the defines three.js puts ahead of GLSL 1 for
WebGL2 (the same prefix as the player's `toGlsl`), sets every active uniform by its GL type,
flips and mipmaps images as the app does, resizes with the box (device pixels capped at 2,
1.5 for a background, 1 with feedback), pauses off-screen and in hidden tabs, and holds a still
frame for reduced motion.

A graph with a chosen **frame rate** (docs/frame-rate.md) carries it as `fps` (and `fpsMode`
unless it is "Both") in the options: the snippet draws only that often and/or steps `u_time` by
1/fps, as the app does, and `renderAt(t)` draws the stepped time. The full player does the same
from the play record's `frameRate`. Auto adds nothing.

From the page:

- `data-u_name="0.5"` (or `"1,0,0"` for a vector) on the div overrides a baked value;
- `el.playfield.set('u_name', v)`, `el.playfield.stop()`, `el.playfield.renderAt(t)` (one frame at time `t`).

The controls panel doesn't come along; choose **Full player** for it.

## The full player, with only what it uses

The kit's files carry a feature group (`exportHtml.ts` `KIT_FILES`). `kitGroupsFor(bundle)` picks
the groups a page needs, conservatively (a JSON scan of the Play record plus the shaders), and
`kitScript(groups)` leaves the rest out:

| Group | Files | In when |
| --- | --- | --- |
| `script` | p5, sketch3d | a Script layer, a saved layer kind, any `code`/`sketch` in the record |
| `agentsCpu` | agents | an Agents layer |
| `trackers` | hands, tracks, face, pose | never in a web export (a Present canvas only) |
| `midi` | midi | never in a web export (a Present canvas only) |
| `data` | data | datasets, a Data layer, or a dataset reference |
| `finish` | finishGlsl, finish, waterLayer | a Finish stack, a Water layer or a look |
| `blur` | blur | with Finish or particles |
| `audioFx`, `drums` | audioFx; drumPads, granulator | audio effects; drum pads or the Audio engine |
| `jfa` | jfa | a shader reads `u_layers` |
| `gpuParticles` | gpuParticles | a shader has a Particles node, or with Agents |
| `passes` | passHost | Pass nodes (passPlan, the frame's order, is always in) |
| `agentsGpu` | agentPlan, agentShaders, agentHost | an Agents family |

The runtime reads every kit API as optional (`SSKit.x ? … : null`), so a group left out is a
feature that stays at rest. A name an included file imports from a left-out file becomes a stub
that throws "[Playfield] Finish effects and Water layers: not in this page" if it is ever called.
Present canvases (`host: true`) keep the whole kit, since their host can swap a Script layer's code.

## Sizes after the scope and the snippet's mappings (2026-10-10, all 432 examples)

| | Before | After |
| --- | --- | --- |
| Small snippet | 201 examples | 220 examples |
| Average export | 440 KB | 398 KB |
| Average small / full player | 18.3 KB / 806 KB | 18.7 KB / 792 KB |
| All 432 exports together | 185.5 MB | 167.9 MB |
| Keys: hold and hit (Play 09) | 789 KB (player) | 14 KB (small, 2 mappings) |
| Triggers: toggle, step, random (Play 10) | 790 KB (player) | 14 KB (small, 3 mappings) |
| LFOs and the clock (Play 04) | 683 KB (player) | 14 KB (small, 3 mappings) |
| Hands: two at once | 737 KB (player) | 11 KB (small, hands left out) |
| Hands: pinch (null and particles layers) | 739 KB | 668 KB (no trackers) |
| Agents Hand Beat | 1,198 KB | 1,099 KB |
| Wave Interference (mappings from another control) | 699 KB | 683 KB (no midi.js) |

19 examples moved to the small snippet: 15 whose mappings read the mouse, keys or an LFO / Clock
(the Play tour's mouse, curves, LFO, expression knob, keys and triggers pages, four Matrix and Grid
tours, two Time cube examples), and 4 whose only blockers were left-out inputs (live audio, MIDI,
camera, two hands). None moved the other way. Every full-player page is about 16 KB lighter
(midi.js); the 13 still on the player that used tracking or MIDI shed 16–71 KB.

## Sizes (2026-10-10, all 431 examples, before the scope)

| | Before | After |
| --- | --- | --- |
| A plain shader (Fractal Rings) | 28,134 lines, 1,511 KB | 182 lines, 11.7 KB (small) |
| Ray-marched spheres | 28,134 lines, 1,515 KB | 274 lines, 15.9 KB (small) |
| Feedback Smear (previous frame) | 28,134 lines, 1,512 KB | 244 lines, 13.0 KB (small) |
| Wave Interference (mappings) | 28,134 lines, 1,510 KB | 12,270 lines, 677 KB (player) |
| Particle Rain (GPU particles) | 28,134 lines, 1,519 KB | 14,965 lines, 818 KB (player) |
| Slime Mold (Agents) | 28,134 lines, 1,527 KB | 16,778 lines, 916 KB (player) |
| Agents Hand Beat (agents, scripts, tracking, audio engine) | 28,134 lines, 1,531 KB | 21,265 lines, 1,164 KB (player) |

201 of 431 examples export as the small snippet; the average export went from 1,520 KB to 435 KB.

## Checking it

`src/play/__tests__/embedLite.test.ts`: the small snippet has no player code and stays under its
budget; it runs against a recording WebGL2 context; data attributes override; feature detection
and the kit groups; every kit subset loads; mappings from the mouse, keys and the clock: which
qualify, the code only when needed, and the bootstrap run with key presses (and typing ignored),
clicks on and off the picture, a key envelope, an LFO with renderAt, a colour's channel and
brightness, and a background's window clicks.

`src/play/__tests__/exportScope.test.ts`: the support classification of every source and trigger;
the sentences; a hand and a MIDI mapping removed with their controls held at the live value (baked by
`webInputFrom`), small afterwards, and a player page with no tracker or MIDI code; the camera, MIDI
and mic cases; a song that travels; the Depth model; an untouched graph unchanged.

In a browser, each example's small page was rendered at t = 1.5 s next to the full player page
(which mirrors the app's canvas) and compared pixel by pixel: all 201 match, a mean difference
of 0.44/255 (the player's dither) and no pixel off by more than 8/255. Fourteen examples (Time
Cube, Frame Stack and one image input) read an image the off-screen snapshot has no file for;
they match once that input is bound blank on both sides. Without a file the player leaves such
a sampler on whatever texture unit 0 holds, while the small snippet (like the app) reads blank.

All 230 trimmed player pages were rendered the same way against the whole-kit page: identical
(0.00), with no errors.

**Download page fix (2026-10-10).** Those comparisons read the canvases' pixels, not what the
page shows, and missed that the downloaded small page was black: it put `background:#000` on
`<body>` while the picture sits behind the page at `z-index:-1`, and a body with its own
background paints over negative z-index content. The page now puts the black on `<html>` only,
and reads the pointer from the window (the background layer ignores pointer events, so `u_mouse`
never moved). `src/play/__tests__/embedPixelHearts.test.ts` exports the 2D Scene Builder's Pixel
hearts both ways and checks the page's CSS, that the bootstrap draws, and the full player page.
A pasted background snippet (`placement: page`) still sits behind the host page's own `<body>`
background, if it has one: give that page a transparent body.
