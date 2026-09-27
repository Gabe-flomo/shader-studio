# The workspace folder

A folder — on this computer or on an external drive — where Shader Studio keeps
your graphs, presentations, GLSL shaders, functions, presets, published nodes,
scripts and backgrounds as ordinary files. The desktop app and the browser app
(Chrome or Edge) can both point at the same folder and share them.

Settings are **not** in the folder: theme, camera, learned parameter roles,
keyboard shortcuts, panel sizes, the Kaggle sign-in and so on stay with each
app, in its own storage.

Choose it on the **Files** page → *Workspace folder* (or in the Library panel's
*Workspace folder* section). The code is in `src/workspace/`.

## How it works

The app always works from its own storage (the browser's localStorage and
IndexedDB, as before): opening, saving and browsing never wait for the disk.
The folder is kept the same in the background:

- a moment (1.5 s) after anything is saved,
- when the window comes back into focus,
- every 15 seconds while the window is visible,
- and in the desktop app, whenever the folder changes on disk (a watcher).

When the folder can't be reached — the drive is unplugged, the folder was moved
or renamed, or the browser wants your OK again — the top bar shows **Not
connected** (or **Reconnect**), the Files page shows a banner, changes wait
("3 changes waiting to sync"), and it tries again on focus and every 15 s.
Nothing is ever removed from the app because the folder is missing, and
everything already loaded keeps working. When the folder is back, the waiting
changes are written and the folder's changes come in.

### Desktop app

Any folder (the suggestion is `~/Documents/Shader Studio`). It reads and writes
through a few Rust commands (`src-tauri/src/workspace.rs`) with paths relative
to the chosen folder, so folders on other drives (`/Volumes/…`) work without
widening the file plugin's scope. Writes go to a temp file (`.ss-tmp-…`) that is
synced and then renamed over the real one, so a file is never half-written. The
folder itself is only ever created right after you choose it: when a drive is
unplugged its mount point disappears, and the app then reports "not connected"
instead of quietly making a new, empty folder on the startup disk.

### Chrome and Edge

A folder picked with the File System Access API. The browser keeps the folder
(its handle is stored in IndexedDB) but asks for your OK again after the page is
reloaded: one click on **Reconnect workspace** in the banner or the top bar.
Until then everything works and changes wait.

### Safari, Firefox, phones

They can't keep a folder in sync. Your work stays in the browser as before; use
**Files → Download everything** and **Install** to move it between apps.

## Layout

```
workspace.json                                   format, id, when it was made, by which app version
graphs/<folder>/<Name>.graph.json                a saved graph, with its Play setup, takes, datasets and layer kinds
graphs/.versions/<Name>/v<N>.graph.json          its earlier versions (each is a graph file too)
presentations/<folder>/<Name>.present.json       a presentation (opens on the Present page anywhere);
                                                 step backgrounds point at library images, not copies
glsl/<group>/<Name>.glsl                         a GLSL shader: just the code
glsl/<group>/<Name>.glsl.json                    …its id, name, note and group
functions/<folder>/<Label>.fn.json               a custom function preset
functions/Function Builder/<Name>.builder.json   the Function Builder's saved functions
functions/Function Builder/<Name>.builder-group.json   …and saved groups
presets/group/<folder>/<Label>.json              group presets
presets/expressions/<folder>/<Label>.json        expression presets
presets/transforms/<folder>/<Label>.json         transform presets
presets/keyframes/<Label>.json                   keyframe presets
presets/palettes/<Name>.palette.json             Palette node presets
published-nodes/<Label>.node.json                node types published from the Builder
scripts/sketches/<Name>.sketch.json              saved sketches
scripts/layer-kinds/<folder>/<Name>.kind.json    layer kinds
backgrounds/images/<id>.<ext>                    background images, as the picture files
backgrounds/images.json                          their names, sizes and folders
backgrounds/palettes.json                        background palettes
backgrounds/videos/<id>.<ext>                    the Video layers' videos, as the video files
backgrounds/videos.json                          their names, sizes and lengths
.shader-studio/deleted.json                      what was deleted, and when (see Deletions)
```

- A sub-folder is the item's folder in the app (the Graphs list's folders, the
  Functions library's, and so on). Move a file between sub-folders in Finder
  and it moves in the app; move it in the app and the file moves.
- File names are made safe for every file system (APFS, exFAT/FAT32 drives,
  NTFS): no `/ \ : * ? " < > |`, no leading or trailing dots, no reserved
  Windows names, at most ~150 bytes, Unicode NFC. When the real name can't be a
  file name ("Rings: v2/final" → `Rings- v2-final.graph.json`) it is kept inside
  the file (`workspaceName`, or the label/title the thing already has), so it
  comes back exactly.
- Names that would collide (also "Foo" and "foo", which macOS and Windows see as
  one file) get " (2)", " (3)"….
- The files are pretty-printed JSON; a graph file is the same JSON the app
  stores, so it can be imported anywhere.
- A new file added in Finder comes into the app (a `.graph.json`, a `.glsl` with
  no `.glsl.json` beside it, a picture in `backgrounds/images/`…). A file renamed
  in Finder renames the thing (a graph keeps its earlier versions when only its
  name changed; files starting with a dot are ignored).
- Anything else in the folder is left alone, including the old backup folder's
  `library.json`, `history/` and `README.txt`.
- The order of list-like things (GLSL shaders, sketches…) isn't in the folder:
  each app keeps its own order, and things new to it go at the end.

## Sync rules

For every file, each app remembers the content hash (and size and time) that
the app and the folder had when they last matched — the *base*. A sync pass
compares the app's things (as files) and the folder with it:

| This app | The folder | Result |
|---|---|---|
| changed | unchanged | written to the folder |
| unchanged | changed | brought into the app |
| deleted | unchanged | removed from the folder (and noted in `deleted.json`) |
| unchanged | deleted | removed from the app |
| changed | deleted | the edit wins: written back to the folder |
| deleted | changed | the edit wins: brought back into the app |
| changed | changed, the same | nothing to do |
| changed | changed, differently | **conflict**: both are kept (below) |

**Conflicts.** The version changed last keeps the name; the other is kept beside
it as "Name (conflict, 2026-09-27 14.05)" — in the app and in the folder. The
Files page lists conflicts with **Keep this** (remove the copy), **Keep other**
(the copy's content takes the name, then the copy goes) and **Keep both**.
`images.json` and `palettes.json` merge instead (everything from both, the newer
side's where both have the same item); a shader's `.glsl.json` and an earlier
version take the newer.

**First connection.** With no base yet, nothing is deleted on either side:
things only in the app are written, things only in the folder come in, and
things on both sides that differ are kept as conflicts. The same happens when a
folder with another workspace's `workspace.json` is connected.

**Deletions.** Files removed by an app are listed with their hash in
`.shader-studio/deleted.json` for 90 days. An app that had synced this
workspace before but lost its record of it doesn't put back something another
app deleted (when its copy is identical). A first connection never deletes.

**Safety stops.**

- A file that can't be read as what its name says (half-written, or hand-edited
  into invalid JSON) is skipped and listed under *Files skipped*; it is never
  taken as a deletion and never overwritten. It is tried again when it changes.
- If more than half the tracked things (and more than 10) vanish from the folder
  at once, nothing is removed from the app until you say so ("the wrong folder
  or drive?").
- If more than half vanish from the app's storage at once (the browser cleared
  it?), nothing is removed from the folder: **Bring them back** re-imports them
  from the folder, or **Remove them from the folder too**.
- If the folder has no `workspace.json` although this app synced with it before
  (an empty folder where the drive used to be mounted, say), syncing stops and
  says so; **Use this folder anyway** merges as on a first connection.

**Waiting changes** are simply what differs from the base, so they survive
closing the app. A pass that stops midway (drive pulled out) keeps what it
finished; the rest is still different next time. Writes happen before
removals, so a moved file is never lost in between.

The open graph: when it changes in the folder, a notice offers to open the new
version (unsaved changes in the editor would be replaced, so it asks).

## The old backup folder

The backup folder (a copy of everything, `library.json` plus readable files)
is replaced by the workspace. Until a workspace is chosen it keeps being
updated as before, and the Workspace view offers it as the workspace ("Use it
as the workspace"); its old files are left untouched. Once a workspace is
connected, the backup copy stops.

## What each app keeps for itself

In IndexedDB (`shader-studio-workspace`): which folder (a path, or the browser's
folder handle), and per workspace the base hashes, the conflicts to decide and
the files skipped. None of it is user content, and clearing it is harmless: the
next connection is a first connection (a merge; nothing deleted).

## Development

In a dev build (`npm run dev`), `window.__workspaceDev` in the console:
`useOpfs()` connects a folder in the browser's private file system (OPFS) as
the workspace, `setGone(true/false)` pretends the drive is unplugged or back,
`files()`, `read(path)` and `put(path, text)` look at and change the test
folder as another app would, `needPermission()` shows the reconnect state.
The engine and layout are tested against an in-memory folder in
`src/workspace/__tests__/workspace.test.ts`.
