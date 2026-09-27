# Presentations: a user guide

A presentation is a lesson in steps: text with maths, pictures your graphs
make, sliders to try, and the code behind them. It is its own kind of file,
like a GLSL shader: it doesn't belong to a graph. One graph can be the basis
of many presentations, and each presentation carries **copies** (snapshots)
of the Plays it shows, so it keeps working when a graph changes, is renamed
or is deleted.

## Getting to it

- **Computer**: the **Present** tab in the top bar.
- **Phone**: the **Studio · Play · Present** switch at the top left, the
  same place as Play.

## Make one

- With nothing saved yet, the page offers **Open the sample**, **New
  presentation** and **Import a file**, with **More samples** under them.
- Otherwise click the presentation's title (top left of the page) for the
  file menu: **New presentation…**, **Import a .present.json file…**, the
  samples, and the actions for the one that's open.
- The samples come in two groups. **Learn the app** teaches Playfield
  itself: *Getting started in the Studio*, *From shader to instrument: your
  first Play*, *Field sockets: one shape, many copies*, *Bring your own
  GLSL* (the Convert page) and *Making a lesson with Present*. **Topics**
  teach shaders: *Shaders from zero* (The Book of Shaders through the Learn
  folder), ray marching, matrices, playing a shader and sketching over one.
  Opening a sample builds it fresh from the bundled examples.
- Add blocks to a step (Text, Render, Interactive, Code). The first time a
  block needs a picture it asks you to choose a Play: a saved graph or an
  example with a Play setup. That takes a snapshot into the presentation.

## Saving

There's no Save button to forget: every change saves itself in this browser
about half a second later. Beside the title it says **Saving…**, then
**✓ Saved** (on a phone, a small tick). **Not saved** in red means the
browser's storage is full: see Library (below) for what takes the room.

- **Rename…** (title menu): the name is the title.
- **Save a copy…** (title menu): the same presentation under a new name; the
  copy opens. **Make a copy** in the list does the same without asking for
  a name.

## Opening, finding, tidying

**Open** (a folder button in the page's header; on a phone the folder icon
beside the title) lists every presentation saved here, with a still from its
first Play, how many steps and Plays it has, and when it last changed.

- Search appears once there are a few.
- **Folder** makes a folder; drag presentations into it on a computer, or use
  **⋯ → Move to a folder…** (works on phones too).
- **⋯** on a row: Open, Download, Make a copy, Rename…, Move to a folder…,
  Delete. Delete has **Undo** in the notice that follows.
- The five most recent are also at the top of the title menu.

## Import and download one

- **Download** (title menu or a row's ⋯) saves a `.present.json` file: the
  steps and every Play snapshot, so it opens in Playfield anywhere, with no
  need for the original graphs.
- **Import** it on the Present page (title menu, or **Import…** in the
  list), or with the app's main **Import** button in the top bar (on a
  phone: ⋯ → Import a file): a `.present.json` opens straight on the Present
  page. A graph file imported there opens in the Studio as before.
- If the name is taken, the import is called “Name (2)”, “Name (3)”…
- An imported presentation runs its Script layers in a sandboxed frame,
  since they are someone else's code.

## Export as a web page

**Export** (header, or **Export as a web page…** in the title menu) builds
one HTML file with everything in it: slides or one long page, maths as
MathML or KaTeX. Put it on any website or open it from your computer. The
same window has **Presentation file** for the `.present.json`.

## Moving presentations between machines

- **All of them**: in the list, **Download all** saves one ZIP of
  `.present.json` files in their folders, plus a `library.json`. Or use the
  Library (Studio sidebar → Saved Graphs → Library, or on a phone ⋯ →
  Library…): **Download… → Only presentations** is the same ZIP, and
  **Export everything** puts presentations in the full library ZIP with
  graphs, shaders, presets and settings.
- **Bringing them in**: Library → **Import a library…** takes either ZIP (or
  its `library.json`, or a single `.present.json`). Nothing of yours is
  overwritten: a presentation whose name is taken by a different one comes in
  as “Name (2)”; one you already have is skipped; folders come with them.
- **Backup folder** (Chrome, Edge and the desktop app): presentations are
  copied there with everything else, as `presentations/<folder>/<name>.present.json`
  next to the `library.json`; **Restore from it** brings them back.

## Images, videos and songs

A graph's image, video and song files live with the graph while it's open in
the Studio, not in its saved file. A snapshot takes them when the graph is
open in the Studio, with its files loaded and saved; otherwise the source's
card says which ones it's without, and those inputs show blank. To fix it:
open the graph from the card (**Studio**), load its files, save, and press
**Refresh**. If the graph has since been deleted, the card says so: the
snapshot still has everything the presentation needs, but Refresh and Open
are off.
