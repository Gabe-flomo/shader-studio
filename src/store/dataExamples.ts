/**
 * dataExamples.ts — the Data folder: graphs that read a bundled dataset
 * through the Data node (src/nodes/definitions/data.ts, src/data/).
 *
 *   1  Index driven by Time steps a glow through a year of weather
 *   2  an iterated group draws every row of a route as a glowing point
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
import { cityClimateCsv, spiralRouteCsv } from '../data/samples';
import type { Dataset, DatasetsRecord } from '../data/types';

const note = (text: string) => ({ __comment: text });
const playRecord = (controls: PlayControl[], notes: string): PlayRecord => ({ version: 1, controls, mappings: [], layers: [], notes });

/** A dataset from CSV text and notebook cells, with its result computed now. */
function dataset(id: string, name: string, filename: string, text: string, cells: string[], normalize = false): Dataset {
  const cellList = cells.map((code, i) => ({ id: `${id}${i + 1}`, code }));
  const out = computeDataset({ text, format: 'csv', cells: cellList });
  if (!out.run?.result) throw new Error(`dataExamples: the ${id} notebook failed: ${out.parseError ?? out.run?.error ?? JSON.stringify(out.run?.cells)}`);
  return { id, name, source: { kind: 'file', format: 'csv', filename, text }, cells: cellList, normalize, result: out.run.result };
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

  return graphs;
}
