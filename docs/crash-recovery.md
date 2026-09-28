# Autosave and crash recovery

If Playfield closes unexpectedly (a plug-in crashes it, the Mac restarts, the browser tab dies), the next launch offers the work that wasn't saved:

> **Recover your work?** Playfield closed unexpectedly while loading Kontakt 7, with “Untitled” open (last autosaved 12:41).
> **Recover** · **Show in Files** · **Discard**

- **Recover** puts the project back exactly as it was autosaved: the Studio graph, its Play setup, loose groups and datasets. An untitled project stays untitled; a saved one keeps its name. Either way it's marked as having unsaved changes, so Save is one click away. Undo starts fresh ("Recovered after a crash").
- **Show in Files** opens Files → App settings, where the autosaves are listed (Open on any of them).
- **Discard** does nothing to the files: the old autosaves rotate out as new ones are written.

The plug-in part of the sentence is there when the Audio engine noticed a plug-in was loading at the time (docs/audio-engine.md, "When a plug-in crashes"); that plug-in is switched off in Settings → Plugins too.

## The setting

Files → App settings → **Autosave and recovery** → **Autosave the open project**:

| Choice | When a snapshot is written |
| --- | --- |
| Every 5 minutes (default) | On a 5-minute tick, if anything changed since the last one |
| Every minute | The same, every minute |
| On every change | 2 s after the last change, and never more than 10 s behind a stream of changes (a slider dragged for a minute) |
| Off | Never; no recovery is offered |

Stored per device as `shader-studio:settings:autosave`. Nothing is written when nothing changed (the project and its content are compared with the last snapshot), when the canvas is empty with no Play setup, or while a GLSL conversion's scratch graph is on the canvas. **While a recording or a render runs** (the Record dialog recording or encoding, or a take recording or counting in) a due autosave waits, and is tried again a moment after.

## What a snapshot is

Exactly what Save writes (the graph file, `graphFileJson(false)`: nodes, loose groups, the Play setup, datasets, layout version) wrapped with which project it was:

```json
{ "format": "playfield-autosave", "version": 1, "at": 1727520000000, "session": "1727519000000-4242",
  "project": { "name": null, "version": null, "dirty": true },
  "graph": { "nodes": [ … ], "looseGroups": [], "play": { … }, "layout": 3 } }
```

Files are `autosave-<ms>.json`; the **newest 3** are kept (older ones are removed after each write).

- **Desktop:** `~/Library/Application Support/com.shaderstudio.app/autosave/`, written atomically (a temp file, synced, then renamed over), so a crash mid-write leaves the previous file whole. Not in the workspace folder and not counted as your saved work.
- **Browser:** IndexedDB (`shader-studio-autosave`), each write one transaction.

## The session marker

- **Desktop:** `session.json` next to the autosave folder, kept by Rust (`src-tauri/src/recovery.rs`). At launch the previous one is read and kept for the page, and this launch's is written with `cleanExit: false`; quitting the app (`RunEvent::Exit`) sets it `true`. The page adds which project is open and when it was last saved. Reloading the page doesn't restart the process, so it's neither a crash nor offered twice.
- **Browser:** `shader-studio:session` in localStorage; closing or reloading the tab (`pagehide`) marks it clean. A browser or tab crash doesn't.

**Recover is offered** (`recoverDecision`, pure) only when the previous session didn't end cleanly, the newest snapshot is from that session, it had unsaved changes (an untitled project with something in it, or a saved one changed since), and it's newer than that session's last real save. A plug-in crash with nothing to recover is still reported, as a notice.

## Where things are

| Piece | File |
| --- | --- |
| Cadence, keep-3, snapshot format, the marker, the recover decision (pure) | `src/files/autosave.ts` |
| Wiring: storage (Tauri or IndexedDB), the session, the dialog, restoring, holds | `src/files/recovery.ts` |
| The setting and the list | `src/components/files/AutosaveSettings.tsx` (in App settings) |
| Desktop files: session marker, atomic writes, list/read/remove | `src-tauri/src/recovery.rs` (`session_start`, `session_note`, `autosave_write/list/read/remove/reveal`) |
| Restoring without an "Imported" entry in the activity log | `importGraph(json, { recovered: true })` in `useNodeGraphStore.ts` |

## Tests

- `src/files/__tests__/autosave.test.ts`: the cadence (5 min and 1 min ticks only when changed; on every change 2 s after the last, within 10 s of a stream; off; switching modes; waiting while held; a failed write stays pending), keep-3 rotation, the snapshot round trip, and the recover decision (offered; names the plug-in; not after a clean quit, without a snapshot, for another session, with nothing unsaved, or after a later save).
- `cargo test --lib recovery`: snapshot names only, atomic writes leave no temp file, the page's notes merge into the marker.

## For the owner to try

1. Desktop: open Files → App settings: **Autosave and recovery** shows "Every 5 minutes". Set **On every change**, make a change in the Studio, wait 3 s: a row "Untitled · unsaved changes, Autosaved <time>" appears. Make 5 more changes a few seconds apart: never more than 3 rows.
2. Force-quit the app (⌥⌘Esc → Force Quit, or `kill -9`). Relaunch: "Recover your work?" names “Untitled” and the time. **Recover**: the graph and its Play setup are back, the Save button shows unsaved changes.
3. Save the project as "Test", change it, wait for an autosave, force-quit, relaunch, Recover: it opens as "Test" with unsaved changes.
4. Save, then quit normally (⌘Q) and relaunch: no dialog. Force-quit right after a save with nothing changed: no dialog either.
5. **Show in Files** in the dialog opens App settings; **Show in Finder** there opens the autosave folder.
6. In a browser: the same with the tab (closing the tab normally never offers recovery; a crashed tab or a killed browser does).
