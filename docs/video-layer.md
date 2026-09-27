# The Video layer

A video file of your own over the picture, placed like an image, whose
sound can feed the audio readers. Add it from **Add layer → Text & images →
Video** (layers are Pro, like every other kind). The example **Video with
sound** (Play folder, Layers) opens with its layer asking you to pick a
video; its readers and mappings come alive as soon as the video has sound.

## The file

Pick an MP4, WebM or MOV on the layer card. The file goes into the
backgrounds library in IndexedDB (`shader-studio-backgrounds`, store
`videos`, added as version 2 of that database next to `images`), never into
localStorage or the setup. The layer keeps only its library id, name and size
(`videoId`, `fileName`, `bytes`). Picking the same file again (same name and
size) reuses its record.

Where the library doesn't have the file (another browser, a cleared library,
a play file from someone else), the card says so and offers **Pick it again**.
If the library can't take a file (storage full or blocked), it plays for the
session only and the card asks for it after a reload.

## Placing and look

Like an Image layer: X, Y, Scale, Rotation, Opacity, the Over / Reveal / Luma
picture matte, blend modes, track mattes and masks, handles on the picture.
**Fit** sets the size at Scale 1: *Fit inside* (the whole frame inside the
picture), *Fill* (covers it, cropped) or *Height* (as tall as the picture).
The kit's `klVideoFit` works that height out, so the app, renders and web
pages agree.

## Playback

Play / Pause, Loop, Speed and **Start at** (seconds into the video). With
**Clock → Follow the clock** on (the default), frame *t* of the graph clock
shows `start + t × speed` (`videoLayerTimeAt`), looped or held before the end:
pausing the preview pauses it, ↺ starts it over, and takes and offline renders
seek it frame by frame, so they are exact (`playVideoLayers.seek`). Off, it runs
on its own; an offline render still follows the clock (the only way a render
comes out the same every time). Paused while following the clock, it holds
its start frame.

A hidden video layer keeps running while its sound is on or it is another
layer's matte; otherwise it waits, paused.

## Sound

Muted by default. **Sound** on the card:

- **Off**: muted.
- **Listen**: analysed, not heard. The element goes through one
  `MediaElementSource` (browsers allow one per element, ever; a WeakMap keeps
  it) into an analyser in the shared audio context, and on through a gain at 0.
- **Play**: the same, with the gain at the layer's **Volume** (a layer number,
  so a control or mapping can drive it), through the master volume. Real-time
  recordings take it along (the record bus).

The browser holds sound until a click or a key; the card says so, and any
click on the page resumes it (the Sound and Play buttons do too).

With Sound on, the card shows a **mini spectrum** of the video's sound (the
Audio readers' spectrum in compact mode). When the readers listen to this
video, their dots are on it: drag one to retune it, click to add one.
**Readers listen here** points the setup's readers at the video; **Audio
readers…** opens the full panel on it.

In the Audio readers panel, **Listen to** lists every Video layer as
`Video · <layer>` (input `video:<layerId>`). Readers on a video are sources and
triggers like any others, in mappings, actions, takes and on websites. The
panel says why they hear nothing: the layer was deleted, its Sound is Off, it
has no video in this browser yet, it is opening, or it is paused. The live
audio bands (bass, treble…) stay on the live input, as with songs.

## On a website

The web export carries the file in the layer as a data URL (`src`) when it is
at most 4 MB and open in the app this session (lib/mediaSources.ts, key
`vlayer:<id>`), and lists it with what it adds to the page. A bigger file, or
one the app hasn't opened, stays out and "Left out" says so; that layer then
draws nothing on the page (its readers hear nothing), as with Video Input
nodes. On the page the video follows the page's clock as in the app, and its
sound joins the readers (and is heard, with Play) after the visitor's first
click or key.

## Where it lives

- `src/types/playLayers.ts`: `VideoLayer`, defaults, schema, `videoLayerTimeAt`, `videoReaderInput`.
- `src/play/videoLayers.ts`: the app's host (files, clock, sound, export copies).
- `src/lib/videoSound.ts`: how the readers (`lib/audioReaderBank.ts`) find a video's analyser.
- `src/lib/backgroundLibrary.ts`: `addVideoFile`, `getVideo`, `listVideos`, `deleteVideo`.
- `src/play/kit/kit.js` (`env.layerVideo`), `src/play/kit/layers.js` (`klVideoFit`): drawing, shared with web pages.
- `src/components/play/layers/VideoEditor.tsx`: the card; `SpectrumView` `compact` for the mini spectrum.
- `src/play/runtime/play-runtime.js`: the web page's video layers and their sound.

## Not yet

- The Library window doesn't list videos, and library ZIPs / the backup folder don't carry them.
- An offline render's audio track (a take rendered to a file) doesn't mix in a video layer's sound; real-time recordings do.
- No drag-and-drop of video files onto the Layers panel (images have none either).
- A web page's `renderAt` (captures) doesn't seek video layers to the frame.
