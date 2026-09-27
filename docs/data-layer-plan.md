# Data layer: a plan

Plan, not built. Written 26 Sep 2026 from a voice note, so a later session can
pick it up. Section 6 records the decisions (settled the same day).

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

## 4. The notebook: JavaScript that reads like pandas

JavaScript only; no Python runtime. The notebook's cells are JavaScript with a
small **table helper** shaped after pandas, so transforms read the way you'd
write them in a notebook:

```js
df = data                                // the imported table
df = df.where(r => r.temp > 20)          // or df.where('temp > 20')
df = df.assign({ f: r => r.temp * 9 / 5 + 32 })
by = df.groupby('city').mean('temp')
df.sort('price', { descending: true }).head(10)
df['x']                                   // a column as an array
df.describe()                             // count, mean, min, max per column
df.kmeans(['x', 'y'], 4)                  // adds a cluster column
```

- **Inputs:** a CSV arrives as a table (`df`), JSON as a plain value, text as a
  string.
- **Output:** the last value (or `result`) becomes the dataset.
- **When it runs:** instantly, in a worker. It's saved with the dataset and never
  runs per frame.

## 4b. The Data node (Studio)

The same datasets are available to the node graph. A **Data** node picks a
dataset and passes numbers into the shader:

- **Editor.** It opens as a window, like expressions, functions and keyframes:
  import, the notebook, a table preview, and the choice of outputs.
- **Card.** It stays small: the dataset name, the row count and the outputs.
- **Outputs.** Each chosen numeric column as a float, or grouped columns as a
  vec2/vec3/vec4 (x,y → vec2; r,g,b → vec3; four columns → vec4).
- **Index.** A shader works per pixel, so an **Index** input picks the row. With
  **Blend** on, a fractional index fades between neighbouring rows, for smooth
  motion.
- **Count** output: the number of rows.
- **Data texture** output: the whole table as a float texture (one row per
  texel, up to four columns per texture). Loops sample it with the row index, so
  an iterated group can draw every row, for example a circle at each (x, y).
  Uniform arrays would cap out at a few hundred values.
- **Normalize 0–1:** an option on the dataset, off by default. It maps each
  numeric column from its min…max to 0…1; columns already in 0…1 are left as
  they are.
- **Datasets belong to the graph file.** One import is shared by the Data node
  and the Data layer, so editing the notebook updates both.

## 5. Storage, exports, presentations

- **Stored with the Play setup:** the original file (size-capped like
  images/video, with a warning above the cap), the notebook cells, and the
  frozen result.
- **Exports and Present** carry only the frozen result, never the Python
  runtime. Exported pages stay small and need no kernel.
- **Refresh:** re-run the notebook, like Refresh from graph, whenever you want
  the result rebuilt from the file.

## 6. Decisions (settled 26 Sep 2026)

1. **JavaScript only.** No Python. The notebook uses a pandas-style table
   helper instead.
2. **So nothing to bundle:** no runtime download, and everything works offline.
3. **Also a Data node** in the graph, sharing datasets with the layer, with
   Normalize 0–1 as an option (off by default). Its editor opens as a window;
   its card and the Play viewer stay simple.
4. **Still open:** JSON that isn't a table (scripts only in v1 unless asked);
   size caps (100k rows for points, 5k for labels, 5 MB stored per file).

## 7. Milestones

0. **Datasets and the Data node.** Import and parse (column types sniffed),
   the dataset store in the graph file, Normalize, the JS notebook with the
   table helper, and the Data node (column outputs, Index/Blend, Count, data
   texture) with its editor window.
1. **The layer, CSV.** Import, parse (types sniffed per column), table
   views: points, path, bars, pie, lines; axes modes; column → property
   mapping; offset/window stepping and actions; `s.data()`; data sources.
2. **Text.** Split modes, frequency and sort, show one chunk at a time with the
   text style.
3. **JSON views, exports and Present, examples** (a small CSV of city
   temperatures, a route, a poem stepped word by word).
