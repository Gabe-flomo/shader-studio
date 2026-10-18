# The Library

One place for everything you save. It replaced the sidebar's Saved Graphs, Presets,
Functions, Expression Blocks and Saved Keyframes panels, the list under Publish node → My
nodes, and the top bar's Load menu.

## Where it is

- **Sidebar → Library** (the folder icon). Under it is **Storage**: how much is saved, the
  workspace folder, Export everything and Import a library. This used to be the "Library" card.
- **Top bar → folder button**: the same Library on its Graphs filter, with the bundled
  Examples under it.
- **Files → Library**: the same component at full size. Files keeps its tree (Browse), which
  shows sizes, what uses what, and Clean up.
- **Phone → ⋯ → Library…**. Storage and backups has its own row.

## Filters

All · Graphs · Presets · Functions · Expression Blocks · Keyframes · My nodes · Shaders ·
Media. A filter only shows when its type has something in it. Graphs always shows, and so
does the filter you are on. When nothing at all is saved, the Library shows one short line
saying so. The filter you last used is remembered (`playfield:library:filter`).

**Presets** groups presets by what they apply to: nodes in the graph, Scene builders, Play,
Finish and colour. Inside each group they are split by kind. The built-in effects (Long
exposure, Trails…) are under "Built-in effects".

## What each thing does

Every row has the same actions on hover: export, rename and delete. Delete gives a toast
with **Undo**, which puts back every key the delete touched. Search covers names, notes,
shader groups and preset kinds. Folders work the same in every list.

| Type | Click | Notes |
|---|---|---|
| Graph | opens it | Play tag, linked presentations, versions; rename moves its versions, folder and links |
| Function, Expression Block, Transform Vec, group preset | shows its card; double-click, **Add** or drag places it | |
| Keyframe curve | applies it to the open keyframe editor | |
| My node | places it; drag works too | Edit opens its GLSL or its source graph; delete asks first |
| Shader | opens it on the Code page's Shader tab | groups come from the Code page |
| Layer set, rack | adds it to Play | |
| Builder presets, Finish presets, palettes, drum kits, space blocks | shows where it loads from | they load in their own builder or panel |
| Media | opens the media manager | pictures, videos and sounds |

**Import** (the button next to search) can bring in:

- any file Playfield makes: a `.play` file, a graph, a Library export, or a library ZIP
- several graph files at once, or a folder of graphs
- an older `custom-fns.json`
- node types

It also links to Files for storage and clean up.

## Code

- `src/library/libraryFacade.ts`: listing, rename, delete with undo, and export or import
  for every type. It reads and writes the same keys the old panels did:

  | Type | Where it is stored |
  |---|---|
  | Graphs | `shader-studio:<name>`, with `shader-studio-versions:<name>` |
  | Functions | `shader-studio:cfp:` |
  | Expression Blocks | `shader-studio:ep:` |
  | Keyframes | `shader-studio:kfp:` |
  | My nodes | `shader-studio:un:` |
  | Shaders | `shader-studio:glsl-shaders` |
  | Presets | through the preset store (`docs/presets.md`) |

  Folder scopes are unchanged: `graphs`, `functions`, `expressions`, `keyframes`,
  `presets:usernodes`, `presets:group`, `presets:transform`.
- `src/library/appLibrary.ts`: the app's side. It wires delete to the store (links,
  history, the node registry), keeps the open graph's name when it is renamed, opens shaders,
  and sends `OPEN_LIBRARY` to show the Library on a filter.
- `src/components/library/Library.tsx`: the UI. `ItemRow.tsx` holds the shared row, preview
  card and rename field.
- **Export** writes a `library.json` that holds only the chosen items, with their versions and
  folders. **Import** merges a file like that and never overwrites:
  - A graph whose name is taken comes in as "(imported)".
  - A preset you already have stays as yours.
  - Lists are merged by id.

  A file that holds settings or presentations goes through the full library import
  (Storage → Import a library…).
- Tests: `src/library/__tests__/library.test.tsx`.
