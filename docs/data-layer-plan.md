# Data layer: a plan

Plan, not built. Written 26 Sep 2026 from a voice note, so a later session can
pick it up. Section 6 lists the decisions to settle first.

## 1. The idea

A **Data layer** brings a data file into a Play and turns it into something to
look at and to perform with:

- **Import** a CSV, JSON or text file.
- **Transform** it in a small notebook (Python with pandas, or JavaScript), for
  example: filter, derive columns, run a quick clustering.
- **Show** it: the layer draws the data by default (scatter, pie, bars, lines
  for a table; words and lines for text).
- **Use** it everywhere else: map columns to visual properties, step through
  rows or words with an offset like the Background queue, read it from Script
  layers, drive controls with it.

The notebook never runs per frame. It runs when you press Run, and its
**result** (a table, a string, a JSON value) is what the layer and the rest of
the app read. Picture it as a recipe that produces a frozen dataset: the live
layers read the dataset, not the kernel.

## 2. What the file becomes

| File | In the notebook | What the layer can do with it |
|---|---|---|
| CSV / TSV | a pandas DataFrame (Python) or an array of row objects (JS) | numeric and categorical columns: scatter, bars, pie, lines, paths; map columns to x/y/z, size, colour (r,g,b or a palette), rotation, label |
| JSON | a dict/list (Python) or a plain object (JS) | if it is an array of flat records it is treated as a table; otherwise it is data for Script layers to read |
| Text | a string | split by lines, a separator, words, letters or fixed-size chunks; count frequencies; sort; show one chunk (or N) at a time |

Columns holding lists or nested objects aren't drawn (the panel says why) but
are still readable from scripts.

## 3. The layer

**Views for a table:**
- **Points** (scatter): X and Y from two columns; optional size, colour, label, a
  third column as depth.
- **Path**: points joined in row order (a route, a signal), with a draw-on Trim
  like drawn shapes.
- **Bars**, **Pie**, **Lines**: for a category column plus a value column.
- **Axes**: *centred* (0,0 in the middle, each axis normalised to −1…1 over its
  min…max, or symmetric around 0) or *corner* (0,0 bottom-left, min…max across
  the picture); fit to the picture or to a region; optional grid and ticks.

**Mapping columns to properties.** Any column can drive a property of each
mark: position, size, colour (three columns as RGB, or one column through a
palette), opacity, rotation. Numbers are normalised by min…max, with a range and
curve like mappings.

**Stepping through (like the Background queue):**
- **Show**: all rows or chunks, a range, or a window of N.
- **Offset**: which row or chunk the window starts at. It's a normal slider, so
  a Play control, a mapping, an LFO or a hand can drive it.
- **Actions**: Next, Previous, Random and Go to N, fired by any trigger; Cut or
  Fade between.
- **For text**, the current chunk is drawn in the layer's own text style: the
  same controls as a Text layer.

**Everywhere else:**
- **Script layers** read `s.data('Sales')` (the table: `rows`, `columns`,
  `col('x')`, min/max) and `s.data('Sales').current` (the row or chunk the
  offset points at).
- **Sources**: "Data · Sales · current · price" becomes a mapping source, so a
  row's value can drive a shader slider as the offset moves.
- **Sensors and proximity**: each drawn point can be an anchor.
- **Takes**: offset changes and actions are recorded like any others.

## 4. The notebook: Python, JavaScript, or both

**Python** runs in the browser through **Pyodide** (CPython compiled to
WebAssembly, with pandas, numpy and scikit-learn available as packages).
- It runs on your machine, in a worker, so the app never freezes.
- It's large: about 10 MB for the core, plus about 20 MB for pandas, and more
  for scikit-learn. It would load only when a Data layer's notebook first runs,
  and be cached after that.
- For the desktop app and offline use it can be bundled like the hand model. Or
  it can be fetched from the Pyodide CDN the first time, which needs a network
  connection once.
- Startup is a few seconds the first time in a session.

**JavaScript** is free and instant. The same notebook cells run as JS, with a
small table helper (filter, map, groupBy, sort, and a k-means for clustering).
It's enough for most transforms.

**Suggested:** ship JavaScript first, as the default and always available, then
add Python as an option on the same layer. Both produce the same frozen result,
so everything downstream is the same.

**Notebook shape:** a few cells run top to bottom. The file arrives as `data`.
Whatever the last cell returns (or assigns to `result`) becomes the layer's
dataset. Output shows as a table preview or text, with errors inline. Cells and
the result are saved with the Play setup.

## 5. Storage, exports, presentations

- **Stored with the Play setup:** the original file (size-capped like
  images/video, with a warning above the cap), the notebook cells, and the
  frozen result.
- **Exports and Present** carry only the frozen result, never the Python
  runtime. Exported pages stay small and need no kernel.
- **Refresh:** re-run the notebook, like Refresh from graph, whenever you want
  the result rebuilt from the file.

## 6. Decisions to settle before building

1. **Python in the first version, or JavaScript first and Python after?**
   Python adds 30 MB+ and a few seconds of startup on first run, but
   pandas and scikit-learn are what you'd reach for.
2. **Bundle Pyodide for offline, or fetch it on first use?** Bundling adds
   30–60 MB to the desktop app.
3. **JSON that isn't a table:** only readable from scripts in v1, or should the
   layer offer a few views (a tree, points from a list of `{x, y}`)?
4. **Many data layers or one?** You said one for the prototype. Scripts can
   still name it (`s.data('Sales')`) so more can come later.
5. **Size caps:** rows (say 100k for points, 5k for labels) and file size
   (say 5 MB stored in the setup).

## 7. Milestones

1. **The layer, CSV in JS.** Import, parse (types sniffed per column), table
   views: points, path, bars, pie, lines; axes modes; column → property
   mapping; offset/window stepping and actions; `s.data()`; data sources.
2. **Text.** Split modes, frequency and sort, show one chunk at a time with the
   text style.
3. **Notebook (JS).** Cells, `data`/`result`, preview, errors, save.
4. **Python.** Pyodide in a worker, pandas DataFrame in, DataFrame / str /
   dict out, the same preview.
5. **JSON views, exports and Present, examples** (a small CSV of city
   temperatures, a route, a poem stepped word by word).
