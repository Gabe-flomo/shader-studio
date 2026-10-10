# Web export

Play → **Put it on a website** (`components/play/EmbedDialog.tsx`) turns the open graph into
something you paste into a page. There are three outputs, from the same input
(`play/webInput.ts` `webInputFrom`):

| Output | What it is | Built by |
| --- | --- | --- |
| **Small snippet** (the default when it can run the graph) | One `<div data-playfield>` with a `<canvas>`, the GLSL in a `<script type="x-shader/x-fragment">`, and a ~90-line WebGL2 bootstrap (7.6 KB). No player, no kit, no three.js. | `play/embedLite.ts` `buildLiteSnippet` (`buildLitePage` for Download page) |
| **Full player** | The player runtime (`play/runtime/play-runtime.js`) and the parts of the layer kit (`play/kit/*`) the graph uses, with the controls panel, layers and mappings. | `play/exportHtml.ts` `buildPlaySnippet` / `buildPlayHtml` |
| **Copy GLSL** | The fragment shader alone, with a header listing the uniforms it reads, their current values and controls' names, and the WebGL2 defines. | `play/embedLite.ts` `buildGlslOnly` |

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

and whose Play has no visible layers, enabled mappings, actions, Finish, audio, MIDI, pad grid,
tracking, readers, or picture background. Anything else is listed by name ("uses Agents (+94 KB),
Mappings"), and the dialog switches to the full player. A uniform the bootstrap doesn't know is
named too ("its input u_x"), so a new built-in can't silently render black.

What the bootstrap does: compiles the GLSL with the defines three.js puts ahead of GLSL 1 for
WebGL2 (the same prefix as the player's `toGlsl`), sets every active uniform by its GL type,
flips and mipmaps images as the app does, resizes with the box (device pixels capped at 2,
1.5 for a background, 1 with feedback), pauses off-screen and in hidden tabs, and holds a still
frame for reduced motion.

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
| `trackers` | hands, tracks, face, pose | hands/face/pose settings, baked tracks, or any mention of them |
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

## Sizes (2026-10-10, all 431 examples)

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
and the kit groups; every kit subset loads.

In a browser, each example's small page was rendered at t = 1.5 s next to the full player page
(which mirrors the app's canvas) and compared pixel by pixel: all 201 match, a mean difference
of 0.44/255 (the player's dither) and no pixel off by more than 8/255. Fourteen examples (Time
Cube, Frame Stack and one image input) read an image the off-screen snapshot has no file for;
they match once that input is bound blank on both sides. Without a file the player leaves such
a sampler on whatever texture unit 0 holds, while the small snippet (like the app) reads blank.

All 230 trimmed player pages were rendered the same way against the whole-kit page: identical
(0.00), with no errors.
