# The Library

What you saved that goes on the graph, and your media. It looks and works like the sidebar's
**Nodes** list: a search field, categories under small caps headings, each a row with its count
that opens into its items as pills.

## Where it is

- **Sidebar → Library** (the folder icon).
- **Files → Library**: the same list at full width.
- **Phone → ⋯ → Library…**.

Not in the Library, on purpose:

| What | Where it is |
|---|---|
| Saved graphs | the top bar's **Load** button (graphs only, with the bundled Examples under them) |
| GLSL shaders | **Code → Shader** |
| Builder presets | their builder's presets strip (`docs/scene-builder.md`, "Your presets") |
| Layer sets, racks, drum kits | Play |
| Finish presets, Looks | the Finish panel |
| Keyframe curves | the keyframe editor's Presets menu |
| Background palettes | Backgrounds |
| **Storage** (how much is saved, the workspace folder, Export everything, Import a library) | the **Files** page's home, and only there |

## Categories

Group presets come first.

| Section | Category | Comes in as |
|---|---|---|
| Presets | Group presets | the group you saved, wired inside |
| | Built-in groups | the built-in effect, as a group you can open |
| | My nodes | the node type you published |
| | Functions | a Custom Function node |
| | Expression Blocks | an Expression Block node |
| | Vector transforms | a Transform Vec node |
| | Palettes | a Palette node (a cosine palette) or a Stops Palette |
| Media | Pictures | a Texture node showing the picture |
| | Videos | a Texture node on its Video source, playing it (muted) |
| | Sounds | an Audio Source on its File tab with the sound loaded, paused |

A category with nothing in it isn't listed (Built-in groups always is). When nothing of yours is
saved, one short line says so.

## Adding things

As in the Nodes list:

- **click** a pill to preview it (what it is, its signature or sockets, its note, **Add to graph**,
  and for your own things Export, Rename and Delete with Undo; My nodes also have Edit);
- **double-click** it to add it where the view is;
- **drag** it onto the graph to drop it there.

A picture or a video dropped on the graph is wired into the Output's Color when the Output has
nothing there yet. Every media node opens its file from the library by itself, as it does when a
saved graph opens: nothing is stored twice (`src/library/mediaPlacement.ts`).

**Import…** (under the categories) brings in a Library export, a `.play` file or a library ZIP,
an older `custom-fns.json`, or node types. **Manage media…** opens the media manager (import,
folders, rename, clean up).

## Load

The top bar's folder button lists **saved graphs only**, newest worked-on first and in your
folders, with one search, then the bundled Examples. Each row keeps its graph actions: versions,
linked presentations, export, rename and delete (with Undo). Its import button takes graph files
or a folder of graphs (`src/components/library/GraphsList.tsx`).

## Code

- `src/library/libraryCategories.ts`: the categories and what each lists (`listAddable`,
  `mediaItems`).
- `src/library/mediaPlacement.ts`: the node a media item becomes (`mediaNodeFor`) and placing it.
- `src/library/libraryFacade.ts`: listing, rename, delete with undo, export and import for every
  saved type (graphs and shaders included: Files, Load and the exports use it). It reads and
  writes the same keys the old panels did:

  | Type | Where it is stored |
  |---|---|
  | Graphs | `shader-studio:<name>`, with `shader-studio-versions:<name>` |
  | Functions | `shader-studio:cfp:` |
  | Expression Blocks | `shader-studio:ep:` |
  | Keyframes | `shader-studio:kfp:` |
  | My nodes | `shader-studio:un:` |
  | Shaders | `shader-studio:glsl-shaders` |
  | Presets | through the preset store (`docs/presets.md`) |

- `src/library/appLibrary.ts`: the app's side (deletes through the store, the open graph's name on
  rename) and `openLibrary(category)`, which shows the Library opened on a category.
- `src/components/library/Library.tsx`: the UI, drawn with the Nodes list's own pieces
  (`src/components/NodeGraph/browserParts.tsx`: CapsLabel, CategoryRow, Crumb, Pill, AddHint).
- Tests: `src/library/__tests__/library.test.tsx`.
