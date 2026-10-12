# Autosave and crash recovery

If Playfield closes unexpectedly (a plug-in crashes it, WebKit's web content process dies and the window goes blank, the app is force-quit or killed, its bundle is replaced while it runs, a fatal error stops the page, the Mac restarts, the browser tab dies), the next launch (or the reload) offers the work that wasn't saved:

> **Recover your work?** Playfield closed unexpectedly while loading Kontakt 7, with “Untitled” open (last autosaved 12:41).
> **Recover** · **Show in Files** · **Discard**

- **Recover** puts the project back exactly as it was autosaved: the Studio graph, its Play setup, loose groups and datasets. An untitled project stays untitled; a saved one keeps its name. Either way it's marked as having unsaved changes, so Save is one click away. Undo starts fresh ("Recovered after a crash").
- **Show in Files** opens Files → App settings, where the autosaves are listed (Open on any of them).
- **Discard** does nothing to the files: the old autosaves rotate out as new ones are written.

When a crash report was written for it, the dialog also says **A crash report was saved** with **Show report** · **Copy report** · **Reveal in Finder** (Download report in a browser), which act without closing it. When the newest autosave is a blank canvas (an Output node alone, like a 346-byte one written just after a new project) the latest autosave *with work in it* is offered instead, and the others from that session are listed by time.

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

Exactly what Save writes (the graph file, `graphFileJson(false)`: nodes, loose groups, the Play setup, datasets, layout version) with which project it was.

**Desktop: `autosave-<ms>.playfile`** (since 2026.10.183). A real .playfile (src/playfile/writer.ts, the encrypted v2 envelope) holding one `graph` item named "<project> (autosave)"; the snapshot's own fields (`format`, `at`, `session`, `project`) ride in that item's manifest `meta.autosave`. **Show in Finder** → double-click opens it in Playfield like any .playfile (Import shows what's inside). It's a **light** playfile: Video layers' files are referenced by their id in this device's videos library and are not bundled, so an autosave every minute stays a few KB. Older `autosave-<ms>.json` files still list and recover (`readAnySnapshot` reads both).

**Browser: JSON** in IndexedDB, the envelope below; **Download** on an autosave's row in App settings gives it as a .playfile (`snapshotAsPlayfile`).

```json
{ "format": "playfield-autosave", "version": 1, "at": 1727520000000, "session": "1727519000000-4242",
  "project": { "name": null, "version": null, "dirty": true },
  "graph": { "nodes": [ … ], "looseGroups": [], "play": { … }, "layout": 3 } }
```

The **newest 3** are kept, .playfile and .json together (older ones are removed after each write).

- **Desktop:** `~/Library/Application Support/com.shaderstudio.app/autosave/`, written atomically (a temp file, synced, then renamed over), so a crash mid-write leaves the previous file whole. Not in the workspace folder and not counted as your saved work.
- **Browser:** IndexedDB (`shader-studio-autosave`), each write one transaction.

## The session marker

A marker is written when a session starts and marked clean **only** on a clean quit. Anything else (a force quit, `kill -9`, the bundle replaced under a running app, a power loss, an update relaunch that didn't quit cleanly) leaves it unclean, and the next launch offers recovery. **Nothing compares app versions**: a marker written by an older build is checked the same way, and a marker from before `reason`/`appVersion` existed still counts.

- **Desktop:** `session.json` next to the autosave folder, kept by Rust (`src-tauri/src/recovery.rs`): `{ id, startedAt, cleanExit, project, lastSaveAt, reason, appVersion }`. At launch, an unclean previous marker becomes **`pending-recovery.json`** (with `reason: "unknown"` when nothing saw it go); this launch's is written `cleanExit: false`; quitting the app (`RunEvent::Exit`) sets it `true`. The pending one is handed to every page load (`session_start`) until the page calls `session_recovery_done` after the offer, so a launch that quits or dies before the dialog is answered asks again next time.
- **The page dying inside a running app** (the process lives on): WebKit's web content process terminating (`webViewWebContentProcessDidTerminate`, hooked in `src-tauri/src/crash.rs`), or a fatal JS error (`session_page_crashed`), makes this session pending at once (`reason: "web-content-terminated"` / `"js-fatal"`) and the page reloads into the Recover dialog. Because it's pending on disk, quitting the blank or reloaded app cleanly afterwards doesn't lose it. A page load after one that went without a clean `pagehide` (`session_page_hide`) counts as `"page-reloaded"`.
- **Browser:** `shader-studio:session` in localStorage; closing or reloading the tab (`pagehide`) marks it clean unless the page is going down on a fatal error. An unclean one waits in `shader-studio:session:pending` until answered, the same way. A browser or tab crash isn't clean.

**Recover is offered** (`recoverDecision`, pure) only when the pending session didn't end cleanly and that session's **newest autosave with work in it** (`graphWork` > 0: nodes besides the Output node, loose groups, a Play setup) had unsaved changes (an untitled project with something in it, or a saved one changed since) and is newer than that session's last real save. A plug-in crash with nothing to recover is still reported, as a notice; any other crash with nothing to recover gets a notice that a report was saved.

### Why recovery didn't trigger on 2026-10-11

The autosaves were all from one session (`1791771261107-77675`, 19:14 → 20:04), dirty and untitled, so the decision itself would have offered them. What failed was detection, most likely like this (a kill or a force quit would have been offered by the old code, so the session must have been marked clean): the marker only covered the *process*. When WebKit's web content process died, the window went blank (wry has a handler for it, but Tauri leaves it unset), the Rust process kept running, and the previous-session marker had already been handed out at launch and dropped (`previous.take()`). Quitting the blank app then ran `RunEvent::Exit`, which marked the session **clean**, so the relaunch at 20:10 saw a clean exit and offered nothing. No macOS crash report was written because the app process never crashed. Now the content process's death is caught (reload into Recover), and a session that lost its page stays pending on disk even through a clean quit.

## Crash reports

Kept on this device only; nothing is ever sent anywhere.

- **Where:** desktop `~/Library/Application Support/com.shaderstudio.app/crash-reports/<timestamp>.json` (e.g. `2026-10-12T03-04-22-570Z.json`), the **newest 20** kept; browser IndexedDB `shader-studio-crash-reports`, the same JSON and the same 20.
- **What:** `{ format: "playfield-crash-report", version: 1, at, time, kind, summary, appVersion, crashedAppVersion?, os, gpu: { renderer, vendor, webgl }, page, graph: { name, nodes, groups, dirty }, session?, error?: { message, stack }, log: [{ t, level, msg, n? }], context? }`.
- **When:** a launch or reload after a session went down (`web-content-terminated`, `unknown`, `page-reloaded`: written from the log lines the dead page left in localStorage); a fatal JS error (`js-fatal`: the outermost error boundary, or an uncaught error that leaves the page empty); a **Rust panic** (`rust-panic`: the panic hook writes it itself, with a backtrace); a **WebGL context loss** (`webgl-context-lost`, at most one per 10 minutes).
- **The log** (`src/lib/crashLog.ts`): a ring buffer of the last 200 console warnings/errors, uncaught errors, unhandled rejections and app events (page changes, compiles, builders opened, WebGL context lost/restored), repeats counted rather than stored again, copied to localStorage a moment after each line.
- **Files → App settings → Crash reports** lists them (Show · Copy · Reveal), with **Report a problem…**.
- **Report a problem…** (Help menu on the desktop, the top bar's ··· menu when it's folded, and App settings) bundles the latest crash report and this page's log, version, macOS and GPU into one JSON, saved where you choose or copied to the clipboard, to send yourself.

### Simulating crashes (development)

`playfieldSimulateCrash(kind)` from the console, or **Developer: simulate a crash** in Crash reports when `localStorage['shader-studio:dev'] = '1'` (always in a dev build). Kinds: `js-fatal` (a render error: the boundary's page, Reload → Recover), `js-error`, `rejection`, `webgl-lost` (every canvas loses its context for 2 s), and desktop-only `web-process` (WebKit's private `_killWebContentProcess` → the page reloads into Recover), `sigkill` (`kill -9` the app → relaunch → Recover) and `rust-panic` (a panic on the main thread: a report, and the app goes down).

## Where things are

| Piece | File |
| --- | --- |
| Cadence, keep-3, snapshot format, the marker, pending sessions, the recover decision (pure) | `src/files/autosave.ts` |
| Snapshots as .playfile (write, read, download) | `src/files/autosavePlayfile.ts` |
| Crash reports: shape, names, keep-20, storage, Show/Copy/Reveal, Report a problem | `src/files/crashReports.ts` |
| The log ring buffer and error capture | `src/lib/crashLog.ts` |
| The outermost error boundary; the report viewer and list | `src/components/crash/` |
| Rust: reports, the panic hook, WebKit's content-process hook, the simulator | `src-tauri/src/crash.rs` |
| The dev helper | `src/dev/simulateCrash.ts` |
| Wiring: storage (Tauri or IndexedDB), the session, the dialog, restoring, holds | `src/files/recovery.ts` |
| The setting and the list | `src/components/files/AutosaveSettings.tsx` (in App settings) |
| Desktop files: session marker, pending session, atomic writes, list/read/remove | `src-tauri/src/recovery.rs` (`session_start`, `session_note`, `session_recovery_done`, `session_page_hide`, `session_page_crashed`, `autosave_write/list/read/remove/reveal`) |
| Restoring without an "Imported" entry in the activity log | `importGraph(json, { recovered: true })` in `useNodeGraphStore.ts` |

## Tests

- `src/files/__tests__/autosave.test.ts`: the cadence (5 min and 1 min ticks only when changed; on every change 2 s after the last, within 10 s of a stream; off; switching modes; waiting while held; a failed write stays pending), keep-3 rotation, the snapshot round trip, and the recover decision (offered; names the plug-in; not after a clean quit, without a snapshot, for another session, with nothing unsaved, or after a later save).
- `src/files/__tests__/autosave.test.ts` also: the newest autosave with work is offered when the newest is a blank canvas (others listed); markers clean vs unclean across versions; a page that died is pending; the 2026-10-11 case (page died, then a clean quit) is offered.
- `src/files/__tests__/autosavePlayfile.test.ts`: an autosave is a valid .playfile that re-opens identically (as a snapshot and through the ordinary reader), carries no media, old JSON autosaves still recover, a JSON one downloads as a .playfile, keep-3 across both kinds.
- `src/files/__tests__/crashReports.test.ts`: the report's shape, names matching Rust's, keep-20 rotation, the ring buffer, console/error/rejection capture, WebGL context loss.
- `cargo test --lib recovery crash`: snapshot names (.playfile and .json), atomic writes, notes merge; pending at launch whatever the version, a leftover kept through a clean launch, a page load after an unclean page, a page crash surviving a clean quit; report names and keep-20.

## For the owner to try

1. Desktop: open Files → App settings: **Autosave and recovery** shows "Every 5 minutes". Set **On every change**, make a change in the Studio, wait 3 s: a row "Untitled · unsaved changes, Autosaved <time>" appears. Make 5 more changes a few seconds apart: never more than 3 rows.
2. Force-quit the app (⌥⌘Esc → Force Quit, or `kill -9`). Relaunch: "Recover your work?" names “Untitled” and the time. **Recover**: the graph and its Play setup are back, the Save button shows unsaved changes.
3. Save the project as "Test", change it, wait for an autosave, force-quit, relaunch, Recover: it opens as "Test" with unsaved changes.
4. Save, then quit normally (⌘Q) and relaunch: no dialog. Force-quit right after a save with nothing changed: no dialog either.
5. **Show in Files** in the dialog opens App settings; **Show in Finder** there opens the autosave folder. Double-click the newest `autosave-….playfile`: Playfield opens it like any .playfile.
7. With `localStorage['shader-studio:dev'] = '1'`, App settings → Crash reports → Developer: **Web process killed**: the window reloads (not blank) and offers Recover, with "A crash report was saved" and Show / Copy / Reveal. Then **Force quit (SIGKILL)** and relaunch: the same. Quit with ⌘Q right after a Web process kill, before answering: the next launch still offers it.
8. **JS fatal**: the plain "Playfield hit an error" page; Reload offers Recover. Help → **Report a problem…** saves or copies the bundle.
6. In a browser: the same with the tab (closing the tab normally never offers recovery; a crashed tab or a killed browser does).
