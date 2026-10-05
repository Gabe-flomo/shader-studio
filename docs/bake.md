# Bake: render and replace

Some graphs are heavy: a raymarched 3D scene, a million Agents, a stack of
Passes. Bake renders a node's output (or the whole picture) once, frame by
exact frame, to a video. A **Baked** node then plays that video in the node's
place, in step with the clock. Everything after it keeps working: more nodes on
top, a texture for Passes, Particles and Agents, the Play page and web page
exports. The original nodes are kept, and Unbake brings them back.

## Baking

- **A node:** right-click it and choose **Bake…**. This works on any card with
  a colour, colour-with-alpha or value output, groups and March Loop groups
  included. It only works on the top level of the graph, not inside a group.
- **The whole picture:** use the record-dot button on the canvas toolbar, or
  right-click the Output node and choose **Bake the picture…**. This bakes the
  node wired into the Output. Play layers stay live on top.

The dialog has these settings:

| Setting | What it does |
|---|---|
| Output | Shown when the node has more than one output that can be baked. Choose which one to bake. |
| Time | Where the bake starts and how long it runs (from 0 s, for 10 s by default). |
| Frame rate | 24, 30 (the default) or 60 fps. |
| Resolution | **Full**: the preview's drawing size, the default. **½**: half that. **720p** or **1080p**: that height, in the preview's shape. |
| At the end | **Loop seamlessly**: the last second, or a quarter of a short bake, crossfades into the first frame. **Hold the last frame**: the video stops on its last frame. |
| Alpha | Shown only when the node has alpha: a vec4, or a colour beside an Alpha output. It keeps the transparency. |

The dialog also shows:

- the number of frames;
- the pixel size;
- a rough file size;
- a rough render time, from the preview's measured GPU time;
- how many nodes the bake freezes;
- the live inputs that will stop moving it (see "Frozen inputs" below);
- any wires that wait unconnected while the node is baked.

The render shows a progress bar and has a **Cancel** button. Cancel leaves the
graph exactly as it was. The render yields to the page every two frames, so the
UI stays as responsive as it is during Record's offline export.

The render uses the preview's own offline renderer, the one Record's FFmpeg
export uses, so the same things stay exact:

- Passes, Previous Frame and Echo get their history.
- Particles and Agents start over and step one frame at a time.
- Baked nodes upstream seek to each frame.

A seamless loop renders its crossfade frames first. These are the frames just
before the start, and they are held in memory, up to 256 MB.

## What replaces what

The bake changes the graph in one undo step:

- The baked node and every node above it that feeds nothing else are taken out
  of the graph. A Time or UV node that something else still reads stays.
  `lib/bake/graphOps.ts` (`tuckSet`) works out this set.
- The taken-out nodes are stored inside the Baked node (`params._bake`), along
  with:
  - their places in the node list;
  - every wire that read the baked node.

  While stored, they are not compiled.
- A **Baked** node sits where the baked node was:
  - Its matching output takes the baked output's wires:
    - **Color** for a colour;
    - **RGBA** for colour with alpha;
    - **Value** for a value or mask;
    - **Alpha** too, when the bake kept a colour's Alpha.
  - Wires from the baked node's other outputs wait unconnected. Unbake puts
    them back.

The Baked card shows the following:

- **Header:** "Baked: *name*".
- **Poster:** a frame from the video.
- **Video details:** length, start, fps, size, loop, file size and codec.
- **Frozen inputs:** what stopped moving it, if anything.
- **A folded list of the stored nodes:** "Baked: *n* live nodes kept, muted".
- **Buttons:**
  - **Unbake** puts the nodes and every wire back exactly: same order, same
    ids, same wires. Undo also works.
  - **Re-bake** renders the stored nodes again with the same settings, as a new
    video under the same node.
  - **Video layer** adds the same video to Play as a Video layer (Pro, as every
    layer is).

The node's comment (`__comment`) says what it is and why it's there. The
comment appears in the generated code as well.

## Frozen inputs

A bake records what the live inputs did while it rendered. After that, they no
longer move the picture. The dialog and the card list the inputs it froze:

- the mouse;
- sound (audio readers);
- MIDI;
- other live inputs;
- live video;
- Play controls or mappings aimed at a stored node.

## Where the file goes

The video goes into the **video library**: IndexedDB `shader-studio-backgrounds`,
store `videos`. That is the same place Video layers and the Library's
**Videos** tab use. It is named after the source and the time, for example
`Baked Gyroid scene 2026-10-04 15.57.01.webm`.

- **Desktop app:**
  1. FFmpeg (the export's sidecar) encodes H.264 with a keyframe every half
     second and no B-frames, so seeking is fast. The colour is BT.709,
     limited range, tagged.
  2. FFmpeg writes the file to a temporary path (`bake_temp_path`).
  3. The app reads it into the library once (`bake_take_file`), which also
     removes the temporary file.
  4. The workspace folder, when one is set, mirrors the video as
     `backgrounds/videos/<id>.mp4` like any other.
- **Browser:**
  1. WebCodecs encodes VP8, falling back to VP9, from I420 frames the app
     converts itself (BT.601, limited range).
  2. The app writes the WebM itself (`utils/webmMuxer.ts`). Each frame is
     stamped at exactly i / fps, with Cues for seeking.
  3. MediaRecorder isn't used: it stamps frames with the wall clock.
  4. VP9 comes second because, in testing, Chrome's player failed to decode a
     VP9 WebM with delta frames after a few seeks.

**Alpha** is stored inside the picture: the colour on top and the alpha as grey
beneath it, in one frame twice as tall. Every player decodes that, and the
Baked node's shader puts the two halves back together. Web pages need nothing
extra.

The Library and the Files page count a Baked node as a use of its video, so
**Clean up** doesn't delete it. Baked nodes stored inside another Baked node
count too. `.playfile` bundles carry the video like a Video layer's, because
both use the `videoId` key.

## Time sync

Frame = (t − start) × fps. A seamless loop wraps; otherwise the video holds its
first frame before the start and its last frame after the end
(`plan.ts bakeFrameAt`). Each seek lands in the middle of a frame.

- **Live preview:** the video plays.
  - Its speed is nudged by up to ±20 % to stay on the clock.
  - If it drifts more than a quarter second, it jumps.
  - While the clock is paused, it sits on the exact frame.
- **Offline renders** (Record's FFmpeg and PNG exports, snapshots, bakes of
  bakes): every Baked node seeks to its frame before the shader draws.
- **Web pages:** the page's player follows its own clock the same way, with the
  same formula. Captures (`seekVideos`) seek too.

A test checks that the page's copy of the formula matches the app's.

## Downstream

- **Color, Alpha, RGBA and Value** behave like any other source.
  - The UV input reads the video wherever it is wired. Unwired, it covers the
    picture exactly as the baked nodes did.
  - A different preview shape stretches the video, the same way Texture
    Input's Stretch does.
- **Texture** (left out of alpha bakes) can feed:
  - Sample, Edges, Blur, Glow and Displace (texture);
  - Particles' **Emit from**;
  - the Agents family.

  Its texel size is the `u_vid_<slug>_px` uniform.
- **Play:**
  - Baking the whole picture makes the baked video the graph's picture.
  - **Video layer** puts the same video on the Play page as a layer.
- **Web page export:** the video travels like a Video Input's (up to 4 MB),
  with its clock. A bigger video stays out of the page, and the export dialog
  says so. The Bake dialog warns about this before baking.

## Performance

Measured in Chrome 154 (Metal) on an M3 Pro. The preview was 570 × 719 and the
bake was 4 s at 30 fps at Full size:

| Graph | Live GPU per frame, before | After | Offline frame at 1080p, before | After |
|---|---|---|---|---|
| 3D: Gyroid + Domain Warp (raymarch) | 5.4 ms | 0.32 ms | 45.6 ms | 0.84 ms |
| Slime mold, 1M agents | 9.1 ms (main 2.0, step 1.0, deposit 3.7, trail 2.4); CPU 1.4 ms | 0.42 ms; CPU 0.32 ms | 34.4 ms | 0.78 ms |

- **Live GPU** comes from the app's GPU timers, summed over every pass.
- **Offline frame** comes from timer queries around `renderAtTime`, with a new
  video frame uploaded each frame for the baked graph.
- Both graphs held 60 fps here before baking as well. The point of baking is
  the headroom: the fan, the battery, and everything you add on top.

The bake itself took 2.1 s for the gyroid and 6.5 s for the slime (120 frames).

## Limits

- A bake is a recording. Live inputs, Play controls and mappings stop moving the
  baked part. Unbake to make it live again.
- **Values are 8-bit:**
  - A baked value or colour above 1 clips.
  - vec2 outputs (UVs, directions) can't be baked.
  - Alpha bakes have no Texture output.
- **Shape:** the video has the shape it was baked at. A preview, Play stage or
  web page of a different shape stretches it.
- **Inside groups:** Bake works only at the top level. A Baked node that you
  group afterwards still plays.
- **Agents start:** Agents and Particles start at the bake's first rendered
  frame, which for a seamless loop is the crossfade's pre-roll. A growth
  simulation baked as a seamless loop crossfades its grown end into its
  beginning; use **Hold the last frame** for those.
- **Old files stay:** Re-bake leaves the old video in the Library, so Undo still
  finds it. **Clean up** removes it once nothing uses it.
- **Desktop app not tested:** the FFmpeg path was not run in the desktop app
  for this change. Its arguments and plumbing are unit tested, but whether
  WKWebView plays the tagged H.264 back is not tested yet.

## Code

| Part | Where |
|---|---|
| Planning: frames, crossfade, alpha packing, clock | `src/lib/bake/plan.ts` |
| Graph surgery: tuck, replace, unbake, render graph, frozen inputs | `src/lib/bake/graphOps.ts` |
| Encoders: FFmpeg (desktop), WebCodecs + WebM (browser) | `src/lib/bake/encode.ts`, `src/utils/webmMuxer.ts`, `src-tauri/src/bake.rs` |
| Render, keep, replace; Re-bake; Unbake; Video layer | `src/lib/bake/runner.ts` |
| Playback on the clock (live, offline) | `src/lib/bakedVideos.ts` |
| The node | `src/nodes/definitions/baked.ts` |
| Dialog and card | `src/components/bake/` |
| Store: `bakeGraph` compiles the bake's graph while it renders | `src/store/useNodeGraphStore.ts` |
| Web page player | `src/play/runtime/play-runtime.js` (`followBaked`, `seekVideos`) |
| Example | `src/store/bakeExamples.ts` (**Bake: a heavy 3D scene, effects on top**, 3D SDF folder) |

The tests are in `src/lib/bake/__tests__`. They cover:

- planning;
- the crossfade;
- time sync;
- alpha packing;
- the WebM structure;
- the FFmpeg plumbing;
- Bake then Unbake on every bundled example, which must restore the exact
  graph;
- Library use counts;
- the web page's clock.

The golden shaders are unchanged for graphs without Baked nodes.
