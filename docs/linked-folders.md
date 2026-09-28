# Linked folders

Folders on disk (a samples folder, an image folder, a video folder, fonts) that every asset picker can browse. A file you pick from one is **used from where it is**, read-only: it is never uploaded or copied into the media library, so it doesn't count toward the storage limit.

Link them on the **Files page → Linked folders** (or from any picker's **Link a folder…**). Code: `src/files/linkedRefs.ts` (references, pure), `src/files/linkedFolders.ts` (the model and backends), `src/files/linkedThumbs.ts` (previews), `src/components/linked/*` (the UI), `src-tauri/src/linked.rs` (desktop).

## Where it works

| Where | How | After a restart |
| --- | --- | --- |
| Desktop app | a folder picked in the system dialog; read through read-only Rust commands (`lf_*`) | works straight away (if the drive is there) |
| Chrome, Edge | a File System Access directory handle (read mode), kept in IndexedDB like the workspace folder's | the browser wants one click: **Allow again** |
| Safari, Firefox | not available: they can't open a folder on your computer | the pickers keep their file inputs (files are copied into the library as before) |

## The model

A linked folder is `{ id, name, kind, backend, path | handle, addedAt }` in IndexedDB (`shader-studio-linked`, store `kv`, key `folders`). `kind` (Anything, Samples, Images, Videos, Fonts) is only a hint: the pickers start in a folder of their kind, and the Files view's filter starts there.

Status per folder: **Connected**, **Needs your OK** (a browser after a restart), **Not found** (drive unplugged, moved, renamed or deleted), or **Checking…**. Folders are checked when the app first needs them, on window focus, and (in a browser, while linked files are in use) every 15 seconds.

Actions: **Link a folder…**, **Rename…**, **Mostly for** (the kind), **Allow again** / **Check again**, **Find it somewhere else…** (point the same linked folder at a new place: its id is kept, so everything using its files finds them again when the paths inside are the same), **Unlink** (nothing on disk is touched; Undo for a few seconds).

## References

A setup names a linked file as

```
linked:<folderId>/<path inside the folder>
```

e.g. `linked:lf_m1x2k_ab12/Kicks/808 kick.wav` (at most 400 characters; paths are `/`-separated, NFC, never `.`, `..` or empty parts). It sits where a library id sits:

| Picker | Field | What happens |
| --- | --- | --- |
| Drum pads: a pad's sound, **Load a folder onto pads…** | `pads[i].sampleId` | decoded from disk (`play/drumPads.ts` `useLinked`) |
| Video layer | `videoId` | opened from disk (`play/videoLayers.ts`) |
| Background layer queue: video | `sources[i].libraryId` (with `src: ''`) | played from disk (`play/background.ts`) |
| Header Background: video | `display.video.libraryId` | played from disk |
| Background layer / header: image, image layers, particle sprites | the picture is embedded (`src`) like a picked file; `libraryId` names the linked file it came from (backgrounds) | a setup with a picture works anywhere |
| Text layer font | `fontUrl` | the kit asks the app for the bytes (`klSetLinkedFontReader`); an exported web page shows the preset font instead |
| Audio layer song | not kept (songs are session-only anyway) | read from disk each time you pick it |
| Backgrounds library (picking an image) | a **Linked folder** tab | as the Background image above |

`lib/backgroundLibrary.ts` knows linked ids: `getVideo`, `hasVideo`, `getImage`, `hasImage` and `imageUrl` read them from their folder (`resolveLinked`), and when the folder isn't on this computer fall back to a **library record with the same id** (see Exports). `hasLibraryVideo` asks the library alone.

### Resolving, caching, changes

`resolveLinked(ref)` stats the file, then returns this session's copy when size and time are unchanged, or reads it again. Decoded forms (a drum pad's AudioBuffer, a video's object URL) stay with their users for the session. When a file changes:

- **Desktop**: a watcher per linked folder (`lf_watch`, the `linked-changed` event) drops that file's copy and tells its users (`onLinkedChange`): the pad decodes again, the video layer reopens.
- **Browser**: on focus and every 15 s the files in use are stat'ed again; changed or gone ones are announced the same way.

### Missing and Relink

A linked file that can't be read shows the existing **missing** state (a pad's red "missing", a Video layer's note, the Background's warning) with words for why: the folder needs your OK, the folder isn't there, or the file isn't in it any more; or the reference names a folder this app doesn't have (another computer). **Relink…** allows the folder again when that's the problem, otherwise opens the picker where the file was so you can pick it (or another) again. A folder coming back (plugged in, allowed again) reloads what was missing by itself.

## The picker

One component everywhere (`components/linked/LinkedBrowser.tsx`, opened by `openLinkedPicker({ filter, mode })` from `linkedUi.ts`, rendered by `LinkedPickerHost`): the folder (with its status and fix), breadcrumbs, a lazy tree (one folder listed at a time), **search** over the folder and everything under it (at most 400 folders walked, 300 results), the picker's type filter (folders stay visible), thumbnails (images), poster frames (videos), waveforms (sounds, decoded silently, which also gives their length) and "Aa" (fonts), and a preview with **Use it** (or double-click). `mode: 'folder'` picks a folder (the drum pads' **Load a folder onto pads…**: its sounds in Finder order, the first 16 onto pads 1–16; pads past the folder's count are left as they were). On a phone it's a sheet.

Previews are cached in IndexedDB (`shader-studio-linked`, store `thumbs`) keyed by folder, path, size and time, so a file is looked at once until it changes; none are made for files over 60 MB (images), 400 MB (videos), 120 MB (sounds).

**Auditioning (filtered to sounds)**: the same Splice-style auditioning as the Sounds tab (docs/drum-pads.md) — a shared player (`lib/samplePreview.ts`) and hook (`components/audio/useSamplePreview.ts`) drive `SampleRow` here too. With **auto-preview** on (remembered), ↑/↓ move the highlight and play it at once, at a fixed preview volume, separate from the master chain; ← restarts, → skips 3 s, Space toggles, Enter picks, Esc stops and closes (the window's own Escape handling closes it; the preview stops when it unmounts). A click highlights and previews, a double-click picks; on a phone, a tap previews and a second tap (or the Pick button) picks. Only one sound previews at a time — arrowing past one cancels its load if it hasn't finished.

## Desktop security

`src-tauri/src/linked.rs` has **no command that writes, renames or removes**. The page registers the folders the user linked (`lf_set_roots`); every other command refuses a root that isn't one of them, refuses paths with `..`, `.` or empty parts, and refuses anything that resolves (through a symlink) outside its root. Hidden files (`.DS_Store`, `._*`, dotfiles) are not listed. Rust tests cover the root check, the path check, symlinks out and listing.

## Exports and sharing

- **.playfile** (Export as .playfile, a Play setup, a kit, a presentation): the linked files the items use (drum pad samples, Video layers, Background videos) are **bundled** like library videos (`videosFor` → `videoZipFiles(ids)`, with the usual "Include N videos (size)?" ask past 200 MB). Importing keeps them as **library media** under the same id (the `linked:` reference), so the setup finds them without the folder, and they count toward the storage limit there.
- **Library ZIP, Export everything, profile ZIP, backup and workspace folders**: linked files are **left as references** (the folders stay yours and may be large). On another computer those setups show the files as missing with **Relink…**; to take the files along, export a .playfile instead. The Linked folders view says so.
- Embedded pictures (backgrounds, image layers, sprites) travel inside the setup as always.
- Web exports: drum pad samples and videos opened this session go in as before (they're remembered when loaded); a linked font shows the preset font.

## Storage limit

Linked files aren't stored, so they don't count (`docs/storage-limit.md`). Only their small previews are cached. A .playfile import of linked files makes them library media, which does count.

## Not covered (yet)

- The Present page's pictures and fonts, the Studio's Texture / Video / Audio Input nodes, p5 imports and the Granulator keep their own pickers.
- A folder can't be linked twice by path on the desktop; in a browser the same folder picked twice is two linked folders.
