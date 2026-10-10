# Texture node

One node for pictures, videos and the webcam. It's listed as **Texture** in the node browser (under
Sources). Search finds it as Texture Input, Image, Picture, Video, Webcam, Camera or Shadertoy channel.

## Sources

The card's **Image / Video / Webcam** switch picks the source. Switching keeps the node: its id, its place
and every wire. What the other source had is put aside on the node, so switching back finds it again.

| Source | How | Kept |
|---|---|---|
| **Image** | Click to pick a file, drop one on the card, **Library**, or paste a URL and press **Load** (or Enter) | In the image library at full size, plus a copy in the node (see below) |
| **Video** | Click to pick a file, drop one, **Library**, or paste the URL of a video *file* | In the video library, by reference |
| **Webcam** | Choose Webcam | Play's Camera layer (its settings live on this computer) |

Dropping a video on an Image card switches it to Video, and the other way round.

### Image URLs

The picture is downloaded on the CPU (`fetch`), decoded and uploaded as a texture. Then it's kept like an
uploaded file.

- **What works:** sites that let other pages read their files (CORS), such as Wikimedia upload links
  (`upload.wikimedia.org/...`), `picsum.photos`, GitHub raw files and most CDNs and image hosts.
- **What doesn't:** most other sites block it. The card then says the site didn't let the page read it, and
  suggests downloading the file and dropping it instead. A link to a web page rather than a picture says so,
  with the hint to use **Copy Image Address**.
- **Video by URL** works the same way when the site allows it and the link is a video *file* (.mp4,
  .webm). Video pages such as YouTube or Vimeo can't be read: download the video and drop it.

## Editing

- **Image:** **Edit…** opens the app's clip editor on the still, the same editor as the Time Cube and Video
  Input. Use it to crop, rotate and flip. **Result** shows the picture as the node samples it.
  On the card:
  - **Fit:** Stretch, Fit or Fill. Fit and Fill keep the cropped, turned picture's shape.
  - **Tile:** 1× to 16×.
  - **Wrap:** Clamp, Repeat or Mirror.
  - **Filter:** Smooth or Pixels (nearest).
- **Video:** **Edit clip…** (or ⤢) opens the clip editor: trim, segments, reverse, speed, loop, crop,
  rotate, flip (docs/clip-editor.md). ▶ / ⏸ and ◉ (settings) are in the header, as before.

Tiling, wrap and the crop only add shader code when set. Every graph saved before compiles to the same shader.

## Saved graphs keep their pictures

Before this node, a picture lived only in memory, and the node kept a 96 px thumbnail. So a reload, a
saved version or a .playfile opened without it. Now a picture is kept twice:

1. **In the image library** at full size. Its id is in `params.libraryId`, the field Files' *Used by* and
   .playfile dependencies already follow, so exporting the graph brings the picture along.
2. **In the node** as `params._imageSrc`: a JPEG data URL (PNG when it has transparency). It's at most
   **1024 px** on its long side and **400,000 characters** (about 300 KB). If it doesn't fit, it's tried at
   768, 512 and 384 px. This makes the graph complete on its own: in every saved version, in a .playfile,
   and on another computer.

Opening a graph uses the library's full-size copy when this browser has it, and the embedded copy
otherwise. A graph opened over another one drops pictures left under the same node ids. Pictures inside
groups come back too.

**Why these limits:** saved graphs and their versions live in the browser's localStorage. A series keeps
3 MB of history by default (docs/graph-series-plan.md). A 300 KB copy per picture leaves room for several
versions. The full-size picture is in IndexedDB, where size isn't a problem.

**Graphs saved before this change** have only the thumbnail. The card says to load the picture again.

### Videos

Videos are **never embedded**. Even a short clip is several MB, more than a graph's whole history budget.

- A video is kept in the video library, and the node names it in `params.videoId`, as before.
- A .playfile carries the video file itself (playfile/bundle.ts `videoIdsIn`), so an export opens with its
  video elsewhere.
- When the library doesn't have it (another browser, a cleared library), the card says
  **Missing: name.mp4 isn't in this browser's library** and offers **Re-link…** (pick the file) and
  **Library** (pick one that's there).

## Webcam

Choosing Webcam:

- **Makes the node a camera node.** It becomes a Video Input reading the shared camera (`params.source:
  'webcam'`). The camera's picture is bound into its sampler (lib/texture/webcam.ts).
- **Adds a Camera layer to Play.** It's added when there is none, **hidden** and not drawn into the shader's
  layers, so it doesn't cover the picture. It carries the camera, the mirror and hand tracking, as any
  Camera layer does.
- **Shows a mini Play on the card:**
  - Play's own camera chip: on/off, which camera, 720p / 1080p;
  - **Mirror**: the layer's mirror, and a flip in the node's shader;
  - Play's hand-tracking chip (Enable / Stop);
  - **Hands → Map a hand to…**: pick any slider in the graph. Play's mini mapper opens with its Hands
    section open: fingertip, pinch, openness, palm, roll, nearness. The mapping is an ordinary Play mapping,
    run by Play's engine whether or not Play is open. The card lists the hand mappings, and Play → Mappings
    tunes them.

The camera stays on while a webcam Texture node or a Camera layer uses it (lib/cameraKeeper.ts).

## Generate depth

**Generate depth** on the card adds:

- **2D:** a Depth node with this texture wired into its Texture.
- **3D** (a March Loop in the graph): the Depth node, plus a **Depth Composite**. The Composite takes the
  picture's Color, the Depth node's Depth, and the loop's Color, Distance and Hit. If the Output showed the
  loop's Color, it shows the composite.
- **Video:** the Depth node starts on **Update: Baked**, and the notice offers **Bake depth**. A video's
  depth is baked first (docs/depth-node.md).
- **Webcam:** Update: Every 4th frame. A live feed can't be baked.

New nodes go beside the card, inside the part of the graph on screen: to its right, else its left, else
below it, on no other card.

## Saved graphs and the old nodes

Texture Input and Video Input are this node's two engine types. Saved graphs need no migration:

- an old **Texture Input** is the Texture node showing a picture;
- an old **Video Input** is the Texture node showing a video;
- their shaders are unchanged, and the golden shader snapshots are untouched.

The browser offers Texture (`textureInput`). `videoInput` stays registered, hidden from the browser, and
the Source switch makes it.

**Why not a new type with a migration?** Some 25 places in the compiler, the preview, groups, bake, depth,
export and the examples know these two types and their samplers (`u_tex_` for a picture, `u_vid_` for a
video). Keeping them made the change safe, and saved graphs compile to the same shader.

## Files

| What | Where |
|---|---|
| Sources, switch, names | `src/lib/texture/textureSource.ts` |
| Pictures: embed, URL fetch, restore on open | `src/lib/texture/pictures.ts`, `pictureHost.ts` |
| Videos onto the node | `src/lib/texture/videoActions.ts` |
| Webcam texture and Camera layer | `src/lib/texture/webcam.ts`, `webcamHost.ts` |
| Generate depth, placement | `src/lib/texture/generateDepth.ts` |
| Card | `src/components/NodeGraph/TextureCardBody.tsx`, `TextureImageEditModal.tsx` (header and sockets in `NodeComponent.tsx`) |
| GLSL | `src/nodes/definitions/sources.ts` |
| Tests | `src/lib/texture/__tests__/`, `src/components/NodeGraph/__tests__/textureCard.test.tsx` |

## Limits and next

- **Webcam depth:** Live depth from the webcam runs every 4th frame (the Depth engine tells a webcam from a video
  file, so it no longer asks for a bake).
- **Files → Used by** describes a graph whose Texture node uses a library picture as "Its Play setup (a
  copy)". The wording comes from the backgrounds source.
- **Web exports** carry the picture as before (from the texture). The embedded copy also rides along in the
  graph JSON.
- **Library:** the picker lists the image and video libraries (Files → Backgrounds). Workspace and linked
  folder files show once they're in the library. It doesn't browse folders yet.
