# Storage limit

A per-device cap on what Shader Studio keeps here. **Default 10 GB**; presets 1, 5, 10, 20, 50 GB and **No limit**, or any number of GB (**Other…**). Set it on the **Files page** (the Space area at the top of the sidebar, or the first card on a phone) or in **Files → Settings → App settings → Storage**. Both edit the same key, `shader-studio:settings:storageLimit` (bytes; `0` is no limit; absent is the default).

## What counts

The meter adds up everything the Files page knows about (`files/storageLimit.ts`, `storageUsage()`):

| Part | Where | Measured by |
| --- | --- | --- |
| Saved work | localStorage keys Shader Studio owns (graphs, presentations, presets, settings…) | key + value characters (≈ bytes) |
| Images, Videos, Sounds | the media library in IndexedDB (`lib/backgroundLibrary.ts`) | each file's `bytes` |
| Workspace folder | desktop app only: the connected folder's files on disk (`workspace/workspace.ts` `workspaceFolderBytes`) | `ws_list` sizes |

In a browser the workspace folder holds the same files the app already counts, so it is not added again. `navigator.storage.estimate()` is shown beside the meter as a cross-check ("Browser's estimate: 1.2 GB of 120 GB"); it is never what the limit is judged against, because it counts caches and other things the app does not manage.

The media and folder parts are measured at most every few seconds and again after anything changes (`backgrounds-changed`, the library refresh events, `files-changed`); saved work is read live because it is cheap.

## The gate

Only **growth** is checked, and only when it would cross the limit. Removing, replacing with something smaller, renaming: never refused, even when the device is already over the limit (say, after lowering it).

Refusal message, everywhere: **"Storage limit reached: 10.0 GB of 10 GB used. Free space on the Files page or raise the limit in Settings."** — as a toast with an **Open Files → Clean up** button (`storageLimitApp.ts`: it opens the Files page on its Clean up view). Where a save returns a `FileResult`, its `error` carries the same sentence after "Could not save …".

Choke points:

- **localStorage saves** — `safeSetItem` (`utils/fileIO.ts`) compares the new value's length with what the key holds now and asks `roomNow(delta)`. That covers graphs (with their Play setup and takes), presentations, GLSL shaders, scripts and layer kinds (now routed through `safeSetItem`), every preset list, drum kits, and the importers that write through it.
- **Uploads into the media library** — `addImage` and `addVideoFile` (images, videos, sounds and drum-pad samples all go through these) `await ensureRoom(blob.size)` first.
- **Imports** — `runImport` (`.playfile`, node packs) adds up the ticked rows' bytes; `runInstall` (library/profile ZIPs) adds up the snapshot and its files (a *replace* first frees what is here, so only the difference counts).
- **Takes** — `keepTake` (`lib/takes.ts`) checks the take's JSON length (its audio frames included) before it is added to the setup.

`ensureRoom` throws a `StorageLimitError` after showing the toast; callers that would show their own error toast check `isStorageLimitError` and stay quiet.

## The warning

At **90%** of the limit a warning toast shows **once a session** ("Storage nearly full"), from whichever gate or the Files page meter notices it first. The meter turns amber from 90% and says when the limit is reached.

## Desktop and browser

The same code runs in both. The desktop app adds the workspace folder's on-disk size; a browser adds nothing extra. The old readings stay under the meter: localStorage's own ~5 MB for saved work (which stops saving when full, whatever the limit) and the browser's estimate.

## Tests

`src/files/__tests__/storageLimit.test.ts`: the usage sum, labels and the message, the threshold (`roomFor`, `ensureRoom`, `safeSetItem`), shrinking saves never blocked, the 90% warning firing once, and the setting's storage.
