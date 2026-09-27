# The Video layer

A video file of your own over the picture, placed like an image, whose
sound can feed the audio readers. Add it from **Add layer → Text & images →
Video**, or drop a video file on the picture (layers are Pro, like every
other kind). The example **Video with
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

Each kept video also has a poster frame (a small JPEG of a frame a little way
in, made when the file comes in, or the first time a list shows an older
one), its frame size and its length.

## Dropping files on Play

Drop image and video files on the Play preview and each becomes a layer
where it lands: an image an Image layer (a data URL at most 1024 px, as
**Choose image** makes), a video a Video layer (kept in the library, as the
card's picker does). Several files land a little apart, the last one
selected. Dropped on the Layers list instead, they go in the middle, into the
group the list has open. Other files are left out (a note says how many).
While files are over the picture an overlay says what a drop does and marks
where; over the list, a banner. Layers are Pro: on Free the overlay says so
and a drop opens the Pro sheet.

`play/layerDrop.ts` takes drops on the picture (the canvas is shared by every
page, so only while the Play page sets a handler); `components/play/dropLayers.ts`
makes the layers.

## In the Library

The Library's **Backgrounds** window has a **Videos** tab: each video with its
poster, size, frame size, length, and which setups use it (saved graphs,
presentations and the open graph as it is now). Rename, download, delete;
deleting one a Video layer uses says which and asks first (those layers then
ask for their file again; Undo puts it back). **Clean up** deletes the videos
nothing uses. The Library panel counts videos with the backgrounds.

On the Files page they're under **Backgrounds → Videos** (`files/videosSource.ts`):
sizes, posters, "used by" (a layer points at its video rather than keeping a
copy, so removing one is flagged as breaking those setups), unused ones in
Clean up, and in downloads and installs.

## Library ZIPs, folders and profiles

- **Export everything**, **Download → Backgrounds** and a Files page profile
  carry the videos as `backgrounds/videos.json` (ids, names, types, sizes,
  posters) and the files under `backgrounds/videos/`, named after each video.
  **Import a library** and **Install** bring them back with their ids, so the
  layers that name them find them. Past 200 MB of videos, Export everything
  and Download ask whether to include them or leave them out
  (`utils/libraryVideos.ts`).
- The **workspace folder** keeps them as real files, `backgrounds/videos/<id>.<ext>`
  beside `backgrounds/videos.json`, synced both ways like the background
  images (a video dropped into the folder comes into the library; one deleted
  here goes from the folder).
- The old **backup folder** writes each one once, as `backgrounds/videos/<id>.<ext>`
  with the list beside it, and Restore brings them back.

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
seek it frame by frame, so they are exact (`playVideoLayers.seek`).
Captures of a web page's player (`mount.seekVideos(t)` before `renderAt`, as
the Capture window and presentation styles do) bring each video layer and a
video background to its exact frame first. Off, it runs
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
  recordings take it along (the record bus), and frame-by-frame renders (a
  take or an offline export with its sound) mix it in like the Audio layers'
  songs (`lib/recordingAudio.ts`): the file's sound decoded once, starting
  where the picture is at the first frame (`start + t × speed`), at the
  layer's speed, looping with Loop or stopping at the video's end, silent
  while the layer is paused, at the layer's Volume when the render starts.
  Listen layers are analysed, never heard, so never mixed. At a Speed other
  than 1 the mixed sound's pitch moves with it (like tape), where the live
  element keeps its pitch.

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
- `src/lib/backgroundLibrary.ts`: `addVideoFile`, `getVideo`, `listVideos`, `renameVideo`, `removeVideo`, posters (`ensureVideoPoster`), ZIPs (`videoZipFiles`, `importVideoFiles`).
- `src/lib/videoUsage.ts`: which setups use a video (the Library window).
- `src/components/backgrounds/BackgroundsDialog.tsx`: the Videos tab; `src/files/videosSource.ts`: the Files page.
- `src/utils/libraryVideos.ts`: videos in library ZIPs; `src/utils/backupFolder.ts` and `src/workspace/layout.ts`: in folders.
- `src/lib/recordingAudio.ts`: `videoTrackOf`, `videoTrackPlan`, `mixdown` (the offline mix).
- `src/play/layerDrop.ts`, `src/components/play/dropLayers.ts`: dropped files.
- `src/play/kit/kit.js` (`env.layerVideo`), `src/play/kit/layers.js` (`klVideoFit`): drawing, shared with web pages.
- `src/components/play/layers/VideoEditor.tsx`: the card; `SpectrumView` `compact` for the mini spectrum.
- `src/play/runtime/play-runtime.js`: the web page's video layers and their sound.

## Not yet

- A mapping or action that moves a video layer's Volume during a render: the
  mix uses the Volume the render starts with.
- Folders for videos in the Library (images have them).
