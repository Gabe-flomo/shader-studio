/**
 * dataExamples.ts — the Data folder: graphs that read a bundled dataset
 * through the Data node (src/nodes/definitions/data.ts, src/data/).
 *
 *   1  Index driven by Time steps a glow through a year of weather
 *   2  an iterated group draws every row of a route as a glowing point
 *   3  a typed-in table (a constellation) drawn star by star, joined by a line
 *   4  a live stream (the built-in demo feed) drawn as a moving trail
 *
 * Each dataset carries its CSV, its notebook and the notebook's result,
 * worked out here when the examples load (the same code the editor runs).
 */
import type { ExampleGraph } from './exampleIndex';
import type { GraphNode } from '../types/nodeGraph';
import type { PlayControl, PlayRecord } from '../types/play';
import { ctl, group, n, out, port, time, uv } from './graphBuilder';
import { DATA_EXAMPLE_INDEX } from './dataExampleIndex';
import { retypeDataNode } from '../nodes/definitions/data';
import { computeDataset } from '../data/compute';
import { manualToTable } from '../data/manualTable';
import { cityClimateCsv, spiralRouteCsv } from '../data/samples';
import { demoRow } from '../data/streams/backoff';
import { applyRows, emptyTable, tableToCsv } from '../data/streams/window';
import type { Dataset, DatasetsRecord, ManualColumn } from '../data/types';

const note = (text: string) => ({ __comment: text });
const playRecord = (controls: PlayControl[], notes: string): PlayRecord => ({ version: 1, controls, mappings: [], layers: [], notes });

/** A dataset from CSV text and notebook cells, with its result computed now. */
function dataset(id: string, name: string, filename: string, text: string, cells: string[], normalize = false): Dataset {
  const cellList = cells.map((code, i) => ({ id: `${id}${i + 1}`, code }));
  const out = computeDataset({ text, format: 'csv', cells: cellList });
  if (!out.run?.result) throw new Error(`dataExamples: the ${id} notebook failed: ${out.parseError ?? out.run?.error ?? JSON.stringify(out.run?.cells)}`);
  return { id, name, source: { kind: 'file', format: 'csv', filename, text }, cells: cellList, normalize, result: out.run.result };
}

/** A typed-in dataset (the spreadsheet), with its result computed now. */
function manualDataset(id: string, name: string, columns: ManualColumn[], rows: string[][], cells: string[]): Dataset {
  const cellList = cells.map((code, i) => ({ id: `${id}${i + 1}`, code }));
  const source = { kind: 'manual' as const, columns, rows };
  const table = manualToTable(source);
  const out = computeDataset({ text: '', format: 'csv', table, cells: cellList });
  if (!out.run?.result) throw new Error(`dataExamples: the ${id} notebook failed: ${out.run?.error ?? JSON.stringify(out.run?.cells)}`);
  return { id, name, source, cells: cellList, normalize: false, result: out.run.result };
}

/** A live dataset on the built-in demo feed: its first `rows` rows are kept, so the graph shows something before it connects. */
function demoStreamDataset(id: string, name: string, rate: number, window: number, cells: string[]): Dataset {
  const cellList = cells.map((code, i) => ({ id: `${id}${i + 1}`, code }));
  const first = applyRows(emptyTable(), Array.from({ length: window }, (_, i) => demoRow(i, rate)), 'append', window);
  const out = computeDataset({ text: '', format: 'csv', table: first, cells: cellList });
  if (!out.run?.result) throw new Error(`dataExamples: the ${id} notebook failed: ${out.run?.error ?? JSON.stringify(out.run?.cells)}`);
  return {
    id, name, cells: cellList, normalize: false, result: out.run.result,
    source: { kind: 'stream', transport: 'demo', address: 'demo', window, mode: 'append', interval: rate, autoConnect: true, onExport: 'freeze', text: tableToCsv(first) },
  };
}

/** A Data node with its sockets in step with its settings, as the card keeps them. */
function dataNode(id: string, x: number, y: number, params: Record<string, unknown>, wires: Record<string, [string, string]> = {}): GraphNode {
  const base = retypeDataNode(n('data', id, x, y, params));
  const inputs = { ...base.inputs };
  for (const [k, w] of Object.entries(wires)) inputs[k] = { ...inputs[k], connection: { nodeId: w[0], outputKey: w[1] } };
  return { ...base, inputs };
}

/** An arithmetic node switched to vec3 (the type pill on the card). */
function vec3Op(node: GraphNode): GraphNode {
  const inputs = Object.fromEntries(Object.entries(node.inputs).map(([k, s]) => [k, k === 'a' || k === 'b' ? { ...s, type: 'vec3' as const } : s]));
  return { ...node, inputs, outputs: { result: { ...node.outputs.result, type: 'vec3' } }, params: { ...node.params, outputType: 'vec3' } };
}

export function buildDataExamples(): Record<string, ExampleGraph> {
  const graphs: Record<string, ExampleGraph> = {};
  const add = (key: string, nodes: GraphNode[], datasets: DatasetsRecord, play: PlayRecord) => {
    graphs[key] = { ...DATA_EXAMPLE_INDEX[key], counter: 60, nodes, play, datasets };
  };

  // ── 1 · A year of weather ─────────────────────────────────────────────────
  const climate = dataset('climate', 'City climate', 'city-climate.csv', cityClimateCsv(), [
    '// One city, month by month (12 rows)\ndf = df.where(\'city == "Rome"\')',
    '// Rain as a share of the wettest month, and where the month sits on a clock face (0–1)\ndf.assign({\n  wet: r => r.rain_mm / df.max(\'rain_mm\'),\n  hx: r => 0.5 + 0.5 * Math.sin((r.month - 1) / 12 * 2 * Math.PI),\n  hy: r => 0.5 + 0.5 * Math.cos((r.month - 1) / 12 * 2 * Math.PI),\n})',
  ], true);
  add('dataWeatherYear', [
    uv(40, 120),
    time(40, 420),
    n('multiply', 'speed', 260, 420, { b: 1.5, ...note('Months per second: Time × 1.5 walks through the 12 rows in 8 seconds, then wraps back to January.') }, { a: ['time', 'time'] }),
    dataNode('data', 500, 360, {
      dataset: 'climate', outputs: [{ key: 'o1', columns: ['temp_c'] }, { key: 'o2', columns: ['wet'] }, { key: 'o3', columns: ['hx', 'hy'] }], blend: true, edge: 'wrap',
      ...note('Index picks the row. With Blend on, a fractional index fades between two months, so the glow moves smoothly instead of jumping. The dataset is normalized, so temp_c and rain_mm arrive as 0–1 (wet, hx and hy already were, so they stay as they are). Open the editor (the grid button) to see the notebook and the table.'),
    }, { index: ['speed', 'result'] }),
    n('remap', 'size', 780, 180, { inMin: 0, inMax: 1, outMin: 0.12, outMax: 0.5, ...note('Temperature (0–1) → radius: a cold month is small, a hot one big.') }, { value: ['data', 'o1'] }),
    n('circleSDF', 'disc', 1020, 120, { radius: 0.3 }, { position: ['uv', 'uv'], radius: ['size', 'result'] }),
    n('remap', 'soft', 780, 440, { inMin: 0, inMax: 1, outMin: 30, outMax: 5, ...note('Rain → falloff: wetter months glow softer and wider.') }, { value: ['data', 'o2'] }),
    n('palette', 'pal', 1020, 420, { offset: [0.55, 0.45, 0.5], amplitude: [0.45, 0.35, 0.5], freq: [0.5, 0.5, 0.5], phase: [0.5, 0.4, 0.0], ...note('Temperature → colour: blue in winter, gold in summer.') }, { value: ['data', 'o1'] }),
    n('light', 'glow', 1260, 260, { mode: 'glow', innerFalloff: 6 }, { distance: ['disc', 'distance'], brightness: ['soft', 'result'], tint: ['pal', 'color'] }),
    n('transformVec', 'hand', 780, 700, { outputType: 'vec2', exprX: 'x * 1.24 - 0.62', exprY: 'y * 1.24 - 0.62', ...note('hx, hy (0–1) → a point on a circle of radius 0.62: the month as a clock hand.') }, { uv: ['data', 'o3'] }),
    n('circleSDF', 'dot', 1020, 700, { radius: 0.025 }, { position: ['uv', 'uv'], offset: ['hand', 'result'] }),
    n('light', 'dotGlow', 1260, 620, { mode: 'glow', brightness: 60, tint: [0.9, 0.9, 1] }, { distance: ['dot', 'distance'] }),
    vec3Op(n('add', 'sum', 1500, 400, {}, { a: ['glow', 'tinted'], b: ['dotGlow', 'tinted'] })),
    out(['sum', 'result'], 1740, 400),
  ], { climate }, playRecord([
    ctl('spd', 'speed::b', 'Months per second', 0, 6, 0.01),
  ], `**What it shows.** A table read in the shader. The file is a CSV of monthly temperature and rain for five cities. The Data node's notebook keeps Rome's twelve rows and adds a **wet** column (rain as a share of the wettest month); **Normalize 0–1** is on, so every number column reaches the shader as 0–1.

**How it is built.** Time × 1.5 → the Data node's **Index**: which row (month) to read. **Blend** fades between neighbouring months, so a fractional index moves smoothly; **Wrap** starts over after December. The node's outputs are columns: **temp_c** sets the glow's size (Remap → Circle radius) and colour (Palette), **wet** its softness (Remap → falloff), **hx, hy** (worked out in the notebook) place the small dot on a clock face.

**Try.** Open the Data node's editor (the grid button on the card) and change the city in the first cell to "Oslo" or "Cairo": the glow follows the new table at once, without rebuilding the shader. Turn Normalize off in the Table tab to see the raw values (the glow gets huge). Set Months per second to 0 and drag Index on the card instead.`));

  // ── 2 · Every row a glowing point ─────────────────────────────────────────
  const route = dataset('route', 'Spiral route', 'spiral-route.csv', spiralRouteCsv(48), [
    '// Later points glow brighter\ndf.assign({ glow: r => 0.35 + 0.65 * r.step / (df.length - 1) })',
  ]);
  const rows = 48;
  const inner: GraphNode[] = [
    n('loopIndex', 'li', 40, 160, note('The pass number: 0, 1, 2… 47. Wired into Index, each pass reads the next row.')),
    dataNode('row', 280, 160, { dataset: 'route', blend: false, edge: 'clamp', outputs: [{ key: 'o1', columns: ['x', 'y'] }, { key: 'o2', columns: ['glow'] }],
      ...note('The same dataset, read one row per pass: x, y as a vec2 (the dot’s centre) and glow (its size). Blend is off: the index is always a whole row.') }, { index: ['li', 'i'] }),
    n('multiply', 'size', 540, 360, { b: 0.016, ...note('glow × 0.016: the dot’s radius, so later rows are bigger.') }, { a: ['row', 'o2'] }),
    n('circleSDF', 'dot', 780, 100, { radius: 0.012 }, { position: port('p'), offset: ['row', 'o1'], radius: ['size', 'result'] }),
    n('multiply', 'hue', 540, 560, { b: 1 / rows }, { a: ['li', 'i'] }),
    n('palette', 'pal', 780, 520, { offset: [0.5, 0.5, 0.5], amplitude: [0.5, 0.5, 0.5], freq: [1, 1, 1], phase: [0.0, 0.33, 0.67] }, { value: ['hue', 'result'] }),
    { ...n('light', 'lamp', 1020, 160, { mode: 'glow', brightness: 90, ...note('+= : every pass adds its dot’s glow to the total.') }, { distance: ['dot', 'distance'], tint: ['pal', 'color'] }), assignOp: '+=' as const },
  ];
  add('dataRouteGlow', [
    uv(40, 220),
    group('dots', 320, 160, {
      label: 'Every row', iterations: rows,
      inputs: [{ key: 'p', type: 'vec2', label: 'UV', from: ['uv', 'uv'] }],
      outputs: [{ key: 'col', type: 'vec3', label: 'Glow', from: ['lamp', 'tinted'] }],
      nodes: inner,
    }),
    dataNode('line', 320, 480, { dataset: 'route', mode: 'points', shape: 'path', pointColumns: ['x', 'y'], radius: 0.0, maxPoints: 64,
      ...note('Used as Points in Path mode: the rows joined in order, and the distance to that line. It loops over the rows itself (up to Max points).') }, {}),
    n('light', 'trail', 620, 480, { mode: 'glow', brightness: 260, tint: [0.25, 0.32, 0.55] }, { distance: ['line', 'distance'] }),
    vec3Op(n('add', 'sum', 880, 300, {}, { a: ['dots', 'col'], b: ['trail', 'tinted'] })),
    out(['sum', 'result'], 1120, 300),
  ], { route }, playRecord([], `**What it shows.** Every row of a table drawn at once. The dataset is a spiral route of 48 points (step, x, y); its notebook adds a **glow** column that grows along the route.

**How it is built.** The group **Every row** is iterated 48 times. Inside it, Loop Index → the Data node's **Index**, so pass *i* reads row *i*: its x, y (a vec2 output) is the centre of a small circle and its glow sets its size. The SDF Glow is set to **+=**, so each pass adds its dot to the total. Each dot's colour comes from its row number through a Palette.

Outside the group, a second Data node on the same dataset is **used as Points** in **Path** mode: it joins the rows in order and gives the distance to that line, drawn as a faint trail.

The columns reach the shader as a float texture (one row per texel, four columns per texture), read with texelFetch. Editing the data only re-uploads the texture.

**Try.** Open a Data node's editor and change the notebook, for example \`df.where(r => r.step % 2 == 0)\`: half the dots go, and the trail follows. The group still runs 48 times: passes past the last row clamp to it. Set the group's iterations to the new row count.`));

  // ── 3 · A constellation, typed in ─────────────────────────────────────────
  const stars = manualDataset('stars', 'Big Dipper', [
    { name: 'star', type: 'text' }, { name: 'x', type: 'number' }, { name: 'y', type: 'number' }, { name: 'mag', type: 'number' },
  ], [
    ['Alkaid', '-0.53', '0.15', '1.86'],
    ['Mizar', '-0.31', '0.22', '2.23'],
    ['Alioth', '-0.09', '0.18', '1.77'],
    ['Megrez', '0.12', '0.09', '3.31'],
    ['Phecda', '0.17', '-0.15', '2.44'],
    ['Merak', '0.49', '-0.21', '2.37'],
    ['Dubhe', '0.54', '0.07', '1.79'],
  ], [
    '// A lower magnitude is a brighter star: turn it into a glow size\ndf.assign({ glow: r => 1.6 - r.mag * 0.35 })',
  ]);
  const starCount = 7;
  add('dataTypedStars', [
    uv(40, 220),
    group('dots', 320, 160, {
      label: 'Every star', iterations: starCount,
      inputs: [{ key: 'p', type: 'vec2', label: 'UV', from: ['uv', 'uv'] }],
      outputs: [{ key: 'col', type: 'vec3', label: 'Glow', from: ['lamp', 'tinted'] }],
      nodes: [
        n('loopIndex', 'li', 40, 160, note('The pass number: 0, 1… 6, one per typed-in row.')),
        dataNode('row', 280, 160, { dataset: 'stars', blend: false, edge: 'clamp', outputs: [{ key: 'o1', columns: ['x', 'y'] }, { key: 'o2', columns: ['glow'] }],
          ...note('Row i of the typed-in table: x, y as the star’s place and glow (worked out in the notebook from mag) as its size.') }, { index: ['li', 'i'] }),
        n('multiply', 'size', 540, 360, { b: 0.012 }, { a: ['row', 'o2'] }),
        n('circleSDF', 'dot', 780, 100, { radius: 0.01 }, { position: port('p'), offset: ['row', 'o1'], radius: ['size', 'result'] }),
        { ...n('light', 'lamp', 1020, 160, { mode: 'glow', brightness: 70, tint: [0.95, 0.92, 0.8], ...note('+= : each pass adds its star.') }, { distance: ['dot', 'distance'] }), assignOp: '+=' as const },
      ],
    }),
    dataNode('line', 320, 480, { dataset: 'stars', mode: 'points', shape: 'path', pointColumns: ['x', 'y'], radius: 0.0, maxPoints: 16,
      ...note('The same rows used as Points in Path mode: the stars joined in the order they’re typed. Reorder the rows in the table and the line follows.') }, {}),
    n('light', 'lines', 620, 480, { mode: 'glow', brightness: 140, tint: [0.3, 0.4, 0.7] }, { distance: ['line', 'distance'] }),
    vec3Op(n('add', 'sum', 880, 300, {}, { a: ['dots', 'col'], b: ['lines', 'tinted'] })),
    out(['sum', 'result'], 1120, 300),
  ], { stars }, playRecord([], `**What it shows.** Data you type in yourself. The dataset isn't a file: it's a small table made in the Data editor (**New dataset › Type it in**) with four columns, star (text), x, y and mag (numbers), and a row per star of the Big Dipper.

**How it is built.** The group **Every star** runs once per row: Loop Index → the Data node's **Index**, so pass *i* draws row *i* as a glowing dot at its x, y. The notebook adds a **glow** column from the magnitude (brighter stars have lower magnitudes), which sets each dot's size. A second Data node **used as Points** in **Path** mode joins the rows in order: the line of the constellation.

**Try.** Open a Data node's editor (the grid button). Click a cell and type a new value, or press Tab and Enter to move on; the picture follows at once. Add a row (Enter on the last row, or the row menu), then raise the group's iterations to draw it. Copy a block of cells from a spreadsheet and paste it into the table: it grows to fit. ⌘Z undoes.`));

  // ── 4 · A live feed ───────────────────────────────────────────────────────
  const feedWindow = 160;
  const feed = demoStreamDataset('feed', 'Demo feed', 20, feedWindow, [
    '// x, y arrive as 0–1: put them around the middle of the picture\ndf.assign({ px: r => (r.x - 0.5) * 1.5, py: r => (r.y - 0.5) * 1.5 })',
  ]);
  add('dataLiveFeed', [
    uv(40, 240),
    dataNode('trail', 320, 80, { dataset: 'feed', mode: 'points', shape: 'path', pointColumns: ['px', 'py'], radius: 0.0, maxPoints: 256,
      ...note(`The stream's window (its last ${feedWindow} rows) joined in order: a trail behind the moving point. Every new row re-uploads the data texture; the shader is never rebuilt.`) }, {}),
    n('light', 'trailGlow', 620, 80, { mode: 'glow', brightness: 120, tint: [0.25, 0.55, 0.9] }, { distance: ['trail', 'distance'] }),
    dataNode('head', 320, 400, { dataset: 'feed', index: 100000, edge: 'clamp', blend: false, outputs: [{ key: 'o1', columns: ['px', 'py'] }, { key: 'o2', columns: ['level'] }],
      ...note('Index past the end, with the ends clamped: always the newest row. px, py place the dot; level (0–1) sets its size.') }, {}),
    n('remap', 'size', 620, 520, { inMin: 0, inMax: 1, outMin: 0.01, outMax: 0.06 }, { value: ['head', 'o2'] }),
    n('circleSDF', 'dot', 860, 400, { radius: 0.03 }, { position: ['uv', 'uv'], offset: ['head', 'o1'], radius: ['size', 'result'] }),
    n('light', 'dotGlow', 1100, 400, { mode: 'glow', brightness: 90, tint: [1, 0.75, 0.4] }, { distance: ['dot', 'distance'] }),
    vec3Op(n('add', 'sum', 1340, 240, {}, { a: ['trailGlow', 'tinted'], b: ['dotGlow', 'tinted'] })),
    out(['sum', 'result'], 1580, 240),
  ], { feed }, playRecord([], `**What it shows.** A live dataset. Rows arrive while you watch, and the picture follows them without the shader being rebuilt.

**Where the rows come from.** This one uses the **Demo stream**, a feed made up inside the app so the example works offline: 20 rows a second of a point wandering on a curve (x, y), a rising and falling **level**, and a **kind** (calm, busy, peak). It connects when the graph opens; the status chip in the Data editor shows it live, with rows per second and the last row. **Pause** holds the picture; **Disconnect** stops it and keeps the last rows with the graph.

**How it is built.** The stream keeps a rolling window of its last ${feedWindow} rows. The notebook moves x, y to the middle of the picture (it runs on the window a few times a second). One Data node, **used as Points** in **Path** mode, draws the window as a trail; another reads the **newest row** (Index past the end, clamped) for the bright dot, sized by level.

**Point it at a real feed.** Open a Data node's editor, open **Settings** under the status chip and change **Transport**:
- **WebSocket**: a ws:// or wss:// address that sends JSON objects such as {"x": 0.4, "y": 0.7, "level": 0.2} (or arrays of them, or CSV lines).
- **Poll a URL**: a link to JSON or CSV fetched every few seconds; choose **Replace the table** when it sends its whole latest state.
- **Server-Sent Events**: an event stream whose messages are JSON or CSV.
- **OSC**: TouchOSC, Max or Ableton through the OSC listener; each message is a row (address, value, value2…).

Keep the column names (x, y, level), or change the notebook to make them from the feed's own fields: nothing else in the graph needs to change. In a browser, some feeds refuse to be read from another site; the desktop app can poll any public link.

**Takes.** Record a performance while it streams: the take keeps the rows with their times, and playing it back or rendering it feeds those rows instead of the live feed, so a render comes out the same every time.`));

  return graphs;
}
