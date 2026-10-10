# The clip editor

One video viewer and editor for the whole app. Whenever a video opens in a
bigger window it is this editor: a player, a Photos-style trimmer along a
filmstrip, segments, a speed ramp or playback speed, crop / rotate / flip,
and the resulting frames. Each host shows only the controls that mean
something to it.

- Component: `src/components/media/ClipEditor.tsx` (controlled: `value` +
  `onChange`, plus a `host` that picks its capabilities).
- Window: `src/components/media/ClipEditorModal.tsx`, loaded on demand
  through `src/components/media/lazyClipEditor.ts`. The Time Cube keeps its
  own window (`components/timeCube/TimeCubeClipModal.tsx`) for its frame
  budget, with the same component inside.
- Maths: `src/lib/media/clip.ts` (capabilities, saving, the Time Cube's
  sample plan) and `src/play/kit/clipPlay.js` (the playlist and the crop,
  shared with web exports).

## Hosts and their capabilities

| Host | Opens from | trim | segments | reverse | ramp | frame samples | speed | loop | crop | rotate / flip |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Time Cube | **Edit clip…** on the card, or a double-click on its strip | ✓ | ✓ (By length / Equal) | ✓ | ✓ | ✓ (ticks, frame budget) | | | ✓ | ✓ |
| Video Input node | **⤢** on the card header, a double-click on its thumbnail, or **Edit clip…** in its settings (◉) | ✓ | ✓ | ✓ | | | ✓ | ✓ | ✓ | ✓ |
| Texture node, Image (a still: no transport or timeline) | **Edit…** on the card, or a double-click on its picture | | | | | | | | ✓ | ✓ |
| Video layer (Play) | **Edit clip…** in the layer's Video section | ✓ | ✓ | ✓ | | | ✓ | ✓ | ✓ | ✓ |
| Baked node | **Edit clip…** on the card, or a double-click on its poster | ✓ (one stretch) | | | | | ✓ | ✓ | ✓ | |
| Background video (the header's, or one in a Background layer's queue) | **Edit clip…** beside Loop / Sound / Speed | ✓ | ✓ | ✓ | | | ✓ | ✓ | | |
| Library window → Videos | a click on a video, or **Open** in its menu | viewer | | | | | | | | |
| Files → Backgrounds → Videos | a click on a video | viewer | | | | | | | | |

`CLIP_CAPS` in `lib/media/clip.ts` is the table in code. A viewer plays,
steps and scrubs (the zoomable filmstrip too) and changes nothing; to trim a
video, open it from where it is used.

The Background has no crop or rotate here: its Placement section already
crops, fits and turns it. A Baked node keeps one stretch and no rotation: a
bake is one take of the clock, cropped to what matters.

### Skipped, and why

- **Bake dialog result preview.** There is none: Bake renders and replaces
  the node at once. The result is the Baked node, whose card opens the
  editor.
- **Camera layer, hand / face / pose tracking, Capture.** Live feeds: nothing
  to trim. Baked tracks follow their Video layer's element.
- **Takes and the Performance recordings.** A take keeps no video frames
  (they are re-rendered); a recorded video is downloaded, not kept.
- **Present.** Presentations have no video blocks; a Play shown on a step
  plays its videos as the web page does (clip settings included).

## Source / Result

A toggle beside Play (remembered per host, in this browser):

- **Source** plays the video itself. **Loop selection** plays only the kept
  segments, in order, round and round (forwards, even a reversed one).
- **Result** plays exactly what the host will show:
  - Time Cube: the sampled frames in cube order (segments joined, reversed
    ones backwards, the ramp's spacing, Frame order's shuffle or sort), at
    12, 24 or 30 frames a second or **Match** (the cube's frames over the
    seconds they span), with the crop / rotate / flip. The frame showing is
    lit on the tick row; the readout says "frame 17 / 48 · source 1.43 s".
    Sorting needs the cube's frame numbers: until it is built with this
    clip, Result plays a sorted order in time order.
  - Playback hosts: the playlist as the host runs it (the same
    `cpAt` + `cpFollow` the host uses), at its speed, looping or not, with
    the crop / rotate / flip. The readout gives the clock, the source time
    and the segment ("1.20 s / 3.40 s · source 1.43 s · segment 2 ◀").
  Scrubbing the strip goes back to Source.

`cubeSequence(times, order)` and `playbackFrames(value, duration, fps)` in
`lib/media/clip.ts` are the frame lists Result steps through; tests check
them against the Time Cube's plan and the playlist.

## How playback hosts play a clip

A saved clip is

```
clip: { segments: [{ in, out, reverse? }], crop: { x, y, w, h }, rotate, flipX, flipY, speed?, loop? }
```

seconds into the video (an out at or before its in runs to the end). The
segments play one after another as a playlist, a reversed one backwards, at
the speed, round and round when it loops. Clock time t shows
`cpAt(segments, t, speed, loop).time`; `cpFollow` keeps a `<video>` there:
forward stretches play at the speed (seeked only on a jump between segments
or a drift), reversed ones are paused and seeked a frame at a time (browsers
only play forwards), and a clip that does not loop holds its last frame.

- **Video Input**: speed and loop stay the node's own (`_speed`, `_loop`).
  With a clip the video follows the graph clock (pause the preview and it
  pauses; ↺ starts it over) rather than running free; ▶ / ⏸ on the card
  holds it. Offline renders (Record, Bake) seek it frame by frame
  (`videoEngine.seek`). The crop / rotate / flip is in the node's GLSL.
- **Video layer**: speed and loop stay the layer's; `start` is not used
  while it has a clip, and a clipped layer always follows the clock. The kit
  draws the crop / rotate / flip (`kit.js` videoOf), so the app, takes,
  renders and web pages draw the same.
- **Baked node**: speed and loop are in the clip (loop defaults to the
  bake's own). The playlist runs from the bake's start; the crop is in the
  node's GLSL. Unbake and Re-bake work as before; Re-bake keeps the clip,
  and **Video layer** on the card passes it on.
- **Background**: rate and loop stay the background's own; the playlist is
  in `play/background.ts` and the web runtime's `followVideo`.

The same functions run in web exports (`exportHtml.ts` inlines `clipPlay.js`
into the kit; the runtime reads it as `SSKit.clip`), so a page shows the same
frames as the app at the same clock time.

## Migration

Graphs, layers and backgrounds without a `clip` play exactly as before:
nothing in the playlist code runs, and the GLSL is unchanged (the crop code
is only emitted when a clip crops or turns, so the golden shader snapshots
stay as they are). A clip that changes nothing (the whole video, forwards,
uncropped, at its own speed) is not saved at all.

The Video Input node now keeps its file in the video library (`videoId`),
so it opens again after a reload with its clip settings, as a Video layer's
does. Graphs saved before have no `videoId`: drop the file on the card again,
as before.

## Thumbnails

The filmstrip's thumbnails are read once per video and kept for the session
(`stripFor`, by the file), the ones in view first (`thumbOrder`), behind the
player and the result frames. The editor opens at once on a long video and
instantly the second time; zooming in fills the strip around the view first.

## Keys and accessibility

As before: space plays, ← → step a frame (shift: ten; in Result, a sampled
frame or a playlist frame), I / O set the active segment's In / Out (hosts
that trim). The Source / Result and rate switches are radio groups; the
reverse and flip buttons say whether they are pressed.

## Limits

- A clipped Video layer's sound is left out of rendered videos' sound (the
  offline mix has no plan for jumps and reversed stretches yet); live, the
  sound follows the element (silent while a segment plays backwards).
- Reversed stretches seek a frame at a time: on long-GOP files (H.264 from a
  phone) they can stutter live; renders are exact.
- The crop applies where the picture is drawn: a Video Input's or Baked
  node's **Texture** output (read by Blur, Sample, Particles…) is the whole
  frame, and hand / face / pose tracking of a Video layer reads the whole
  frame too.
- In the Time Cube's Result, Frame order **Sort** needs the built cube's
  frame numbers (see above).
