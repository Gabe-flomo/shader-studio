# The Files page

Files is one place to see, manage, clean up, download and install everything Playfield keeps in this browser. It opens on a **home** that shows what you've been doing and what you use; the **tree** (Browse), **Notes**, **Clean up**, **Workspace folder**, **App settings** and the **Nodes** list sit beside it. Opening a thing shows its **item page**; opening a node type shows its **node page**.

Code: `src/components/files/*` (the views) over `src/files/*` (the models, pure and tested).

## The home

`HomeView.tsx`. Files opens here (a storage-limit refusal or the workspace indicator can open Clean up or Workspace instead). On a desktop the sidebar has Home, Nodes, Clean up, Notes, Workspace and the tree; on a phone the home is the root page and the sections list sits at its end.

- **Greeting card**: this week in one line ("14 saves this week, 3 other things done"). On the first open it says counting starts now: **nothing is seeded**, the log starts empty.
- **Activity**: five stat tiles (saves, renders, takes, imports, presentation saves) over the last 7 or 30 days, each with a sparkline of one point per day (hover a day for its count).
- **Calendar**: the month, a dot on each day with activity (up to three for busier days); earlier months with the arrows; click a day for that day's events, newest first. Days before counting started are greyed.
- **Recent**: a sideways carousel of poster cards for the newest graphs, Plays (graphs with a Play setup), presentations and GLSL shaders. Clicking one opens it where it belongs: a graph in the Studio, a Play on the Play page, a presentation on Present, a shader on the GLSL page.
- **Most used**: chips with counts for node types (into groups), custom functions by name, layer kinds and the sources Play mappings read, counted across every saved graph plus the open graph when it isn't a saved one as it is. A node chip opens its node page.
- **Sections**: tiles for Browse, Nodes, Notes, Clean up, Workspace folder, Linked folders and App settings; then the **Space** meter.
- **Linked folders** (`components/linked/LinkedFoldersView.tsx`, model `files/linkedFolders.ts`; see `docs/linked-folders.md`): folders on disk (samples, images, videos, fonts) every asset picker can browse, used in place. A sidebar entry (with a warning when one needs attention), a group of the folders under the tree, and a view with each folder's state, Link a folder…, rename, what it's for, Allow again / Check again / Find it…, Unlink (with Undo) and the shared browser.

### The activity log

`src/files/activity.ts`, one localStorage key (`playfield:files-activity`), capped at 2,000 events (the oldest go first), about 40 bytes each. An event is `{ at, kind, label? }` with kinds `save | render | take | import | presentation`. `recordActivity(kind, label)` is called from:

| Kind | Where |
|---|---|
| save | `saveGraph` (the store), saving a GLSL shader (GLSLPage), a custom function preset, a Function Builder function |
| render | `saveRecording` (stills, MediaRecorder video, PNG sequences) and the desktop ffmpeg export |
| take | `keepTake` in `lib/takes.ts` (a take kept in the graph's Play setup) |
| import | a `.playfile` import, a profile install, a library ZIP, a graph JSON, a GLSL file |
| presentation | creating/adopting a presentation, and the autosave, once per presentation every five minutes |

`activityTotals(events, now, days)` gives per-kind counts and one bucket per local calendar day; `calendarBuckets(events, year, month)` the month's events by day. The log dispatches `files-activity-changed` on the window after a record so an open home refreshes. Tests: `src/files/__tests__/activity.test.ts`.

### Posters

`src/files/posters.ts` draws a small (384×216) picture of a saved thing offline:

- a **graph** through `snapshotSaved` → `captureInput` (the graph alone, or the Play when it has a picture) → `renderPoster` (the web runtime in a hidden mount, the same path Present's posters use);
- a **GLSL shader** through `translateToStudio` → the snippet renderer's `renderStill`, when it compiles there (no textures or buffers; otherwise the card shows the first lines of code);
- a **presentation** from the poster of the first Play its first step shows (else any Play in it; nothing is rendered);
- an **example** (for node pages) through `snapshotExample`.

Posters are drawn one at a time, only while the tab is visible, and an all-black still is treated as a failure and not kept. They live in IndexedDB (`shader-studio-posters`) through `src/files/posterCache.ts`, keyed by the item's Files id (or `example:<key>`) and stamped with the item's **content hash plus the app version**: a poster is served only when the hash matches, so it's drawn again only when the thing changed (or the renderer did). `useItemPosters(items)` in `components/files/useItemPosters.ts` is the hook; it loads the renderer lazily.

### Most used

`src/files/mostUsed.ts`: `mostUsed(graphs)` over parsed saved graphs, walking into group subgraphs; functions are `customFn` nodes by their label; layer kinds by `kind` (or the installed kind's name for `kindId` layers); sources by `mappings[].source.kind`. Ties go to the one in more graphs. `graphsUsingNode(graphs, type)` backs the node page's "graphs that use it".

## Item pages

`ItemPage.tsx`, for a graph, Play, presentation, GLSL shader, custom function preset, Function Builder function, preset, published node, sketch or palette (`ITEM_KINDS` in `src/files/itemCode.ts`). A panel on a desktop; on a phone it opens in a sheet over where you are. It shows:

- the title and kind (a graph with a Play setup says so), size and when it was saved;
- **actions**: Open (in the Studio / Play / Present / the GLSL page / the Function Builder), Export as .playfile, Export readable (a graph's readable JSON, a shader's `.glsl`, a sketch's `.js`, otherwise JSON), Duplicate (a copy beside it, "… copy", with Undo; `src/files/duplicate.ts`) and Delete (with Undo, through the same path as the tree);
- the **picture**: a graph's, Play's, presentation's or shader's poster; for a function, the live plot or field from the Present code-preview harness (`present/snippetHarness.ts`, loaded lazily) with the function's numbers as sliders that update it;
- the **code**, folded to its first lines with Expand;
- **where it's used** and what it uses (the same cards as the tree view);
- **notes and credits**: a Play's notes and source credit, a function's comment, a shader's note, how many node comments are inside;
- what's **inside** (a graph's earlier versions and Play setup), as rows that open.

Layer sets and rack presets (Presets → Layer sets / Racks, docs/presets.md) open as item pages too: **Add to Play** / **Add as a track** is their Open, a set shows the poster it was saved with, the files its layers use (linked-folder ones as links) and what was left out when it was saved, and **Export as .playfile** takes a set's videos and sounds along.

## Node pages

`NodePage.tsx`, reached from a Most-used chip or the **Nodes** list (`NodesListView.tsx`: every node type with code of its own, by category, with a search). It shows:

- the label, category and type id, and the description;
- **Insert into the current graph**: adds the node to the right of the open graph and selects it (a toast offers the Studio);
- a **live picture** chosen by the node's output (`src/files/nodeVisual.ts`): a float of a number is a **plot over x** like the Function Builder; anything that reads the position (a UV input) is a **field** over the picture (vec2 as a warped grid, with colour and arrows to choose from); a colour output (vec3/vec4, or a colour-named output or category) is a **colour** swatch over the picture. `nodeSnippet(type)` builds the GLSL the harness draws: the node's helpers, its float inputs as top-level numbers (sliders, at the node's defaults) and one function that runs its lines and returns its output. Nodes that need what only a graph gives (a scene, a field, a texture) say so instead;
- **inputs and outputs** with their types and hints, and the settings with their ranges;
- its **GLSL** folded (helpers and the lines it adds to `main()`);
- **examples that use it**, as poster chips (the examples chunk loads on first use; clicking one opens it in the Studio), and **your graphs that use it**.

Tests for the models: `src/files/__tests__/filesHome.test.ts` (most-used counting, poster cache keying and pruning, node visual selection and the Circle SDF snippet, duplicate with undo).
