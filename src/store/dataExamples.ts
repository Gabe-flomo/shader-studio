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
import { defaultLayer, type DataLayer, type PlayAction, type PlayControl, type PlayLayer, type PlayMapping, type PlayRecord, type TriggerSpec, type ActionKind } from '../types/play';
import { extractScriptParams } from '../components/play/layers/scriptExamples';
import { ctl, group, n, out, port, time, uv } from './graphBuilder';
import { DATA_EXAMPLE_INDEX } from './dataExampleIndex';
import { retypeDataNode } from '../nodes/definitions/data';
import { computeDataset } from '../data/compute';
import { cityClimateCsv, spiralRouteCsv, tideNotesText } from '../data/samples';
import type { Dataset, DatasetFormat, DatasetsRecord } from '../data/types';

const note = (text: string) => ({ __comment: text });
const playRecord = (controls: PlayControl[], notes: string): PlayRecord => ({ version: 1, controls, mappings: [], layers: [], notes });

/** A dataset from a file's text (CSV unless said) and notebook cells, with its result computed now. */
function dataset(id: string, name: string, filename: string, text: string, cells: string[], normalize = false, format: DatasetFormat = 'csv'): Dataset {
  const cellList = cells.map((code, i) => ({ id: `${id}${i + 1}`, code }));
  const out = computeDataset({ text, format, cells: cellList });
  if (!out.run?.result) throw new Error(`dataExamples: the ${id} notebook failed: ${out.parseError ?? out.run?.error ?? JSON.stringify(out.run?.cells)}`);
  return { id, name, source: { kind: 'file', format, filename, text }, cells: cellList, normalize, result: out.run.result };
}

// ── Play helpers (the Data layer examples) ──────────────────────────────────

/** A Data layer: the defaults with `over` on top. */
const dataLayer = (id: string, label: string, over: Partial<DataLayer>): PlayLayer => ({ ...defaultLayer('data', id, label), ...over } as PlayLayer);
/** A Script layer holding `code`, with the sliders it declares at their declared values. */
function dataScript(id: string, label: string, code: string): PlayLayer {
  const r = extractScriptParams(code);
  if (!r.ok) throw new Error(`dataExamples: script ${id}: ${r.error}`);
  const base = Object.fromEntries(Object.entries(defaultLayer('script', id, label)).filter(([k]) => !k.startsWith('p_')));
  const out: Record<string, unknown> = { ...base, code, paramDefs: r.defs };
  for (const d of r.defs) if (d.kind !== 'button') out[`p_${d.key}`] = d.value;
  return out as unknown as PlayLayer;
}
const act = (id: string, trigger: TriggerSpec, kind: ActionKind, layerId: string, amount = 1): PlayAction => ({ id, trigger, do: kind, layerId, amount, enabled: true });
function dataPlay(p: { layers: PlayLayer[]; controls?: PlayControl[]; mappings?: PlayMapping[]; actions?: PlayAction[]; notes: string }): PlayRecord {
  const out: PlayRecord = { version: 1, controls: p.controls ?? [], mappings: p.mappings ?? [], layers: p.layers };
  if (p.actions?.length) out.actions = p.actions;
  out.notes = p.notes;
  return out;
}
/** A quiet backdrop for a chart: a wide, soft glow of `tint` in the middle of a dark picture. */
function darkBackdrop(tint: [number, number, number]): GraphNode[] {
  return [
    uv(40, 220),
    n('circleSDF', 'disc', 300, 220, { radius: 0.05 }, { position: ['uv', 'uv'] }),
    n('light', 'glow', 560, 220, { mode: 'glow', brightness: 1.6, innerFalloff: 1, tint }, { distance: ['disc', 'distance'] }),
    out(['glow', 'tinted'], 820),
  ];
}

const DATA_SKETCH = `// A Script layer reading a dataset with s.data(): every city's year as a ring of dots.
// Angle is the month, distance from the middle the temperature. Month picks the ring that lights up.
const params = {
  month: { value: 7, min: 1, max: 12, step: 1, label: 'Month' },
  spin: { value: 0.05, min: 0, max: 0.5, step: 0.01, label: 'Spin' },
};

function draw(s) {
  const d = s.data('City climate');
  if (!d) { fill(255); textSize(16); text('No dataset called City climate', 20, 30); return; }
  const cities = [...new Set(d.col('city'))];
  const lo = d.min('temp_c'), hi = d.max('temp_c');
  const cx = width / 2, cy = height / 2, R = min(width, height) * 0.42;
  const turn = s.time * s.params.spin;
  // Faint rings every 10 °C.
  noFill(); stroke(255, 255, 255, 30); strokeWeight(1 * s.dpr);
  for (let t = Math.ceil(lo / 10) * 10; t <= hi; t += 10) circle(cx, cy, 2 * map(t, lo, hi, R * 0.2, R));
  noStroke();
  for (const r of d.rows) {
    const ci = cities.indexOf(r.city);
    const a = (r.month - 1) / 12 * TWO_PI - HALF_PI + turn;
    const rad = map(r.temp_c, lo, hi, R * 0.2, R);
    const now = r.month === s.params.month;
    fill(hsl(ci * 68 + 12, 80, now ? 66 : 48, now ? 1 : 0.5));
    circle(cx + cos(a) * rad, cy + sin(a) * rad, (now ? 20 : 8) * s.dpr);
  }
  // A legend: the cities in their colours.
  textSize(12 * s.dpr); textAlign('left', 'middle');
  cities.forEach((c, i) => { fill(hsl(i * 68 + 12, 80, 66)); text(c, 16 * s.dpr, (22 + i * 18) * s.dpr); });
}
`;

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

  // ── 3 · City temperatures as bars, a month at a time ─────────────────────
  const temps = dataset('temps', 'City temperatures', 'city-climate.csv', cityClimateCsv(), [
    '// Month by month: the five cities of January, then of February…\ndf = df.sort([\'month\', \'city\'])',
    '// A month name for the caption\ndf.assign({ monthName: r => [\'January\', \'February\', \'March\', \'April\', \'May\', \'June\', \'July\', \'August\', \'September\', \'October\', \'November\', \'December\'][r.month - 1] })',
  ]);
  add('dataCityBars', darkBackdrop([0.1, 0.12, 0.2]), { temps }, dataPlay({
    layers: [dataLayer('bars', 'Temperatures', {
      dataset: 'temps', view: 'bars', categoryCol: 'city', valueCol: 'temp_c', captionCol: 'monthName',
      show: 'window', count: 5, stepBy: 'window', transition: 'fade', duration: 0.6,
      colour: 'palette', colourCol: 'temp_c', palette: 7, axes: 'corner', grid: true, ticks: true, labels: true, labelSize: 12, font: 'sans', weight: 600,
    })],
    actions: [
      act('next', { on: 'key', code: 'ArrowRight' }, 'next', 'bars'),
      act('prev', { on: 'key', code: 'ArrowLeft' }, 'prev', 'bars'),
      act('rand', { on: 'key', code: 'KeyR' }, 'shuffle', 'bars'),
    ],
    notes: `**What it shows.** A table stepped with a key. The dataset is the monthly climate of five cities (60 rows); its notebook sorts it month by month and adds a month name.

**How it is built.** A **Data layer** draws the table as **Bars**: the city names under the bars, **temp_c** as their heights, coloured through a palette by temperature. **Show: Window** of 5 rows with **Steps by: A window** shows one month's five cities at a time; the **Caption** column writes the month above them. The value axis runs over the whole year's range with 0 included, so the bars keep their scale from month to month, and **Fade** crossfades between months.

**Try.** Press **→** and **←** to step through the months (**R** jumps to a random one): the actions below the layers fire **Next row** and **Previous row**. Switch Axes to **Centred** and Centre on **Zero** to see January's frost below the middle line. Make **Offset** a control and map an LFO onto it to let the year play itself.`,
  }));

  // ── 4 · A route drawn on ──────────────────────────────────────────────────
  const route4 = dataset('path', 'Spiral route', 'spiral-route.csv', spiralRouteCsv(80), ['df']);
  add('dataRoutePath', darkBackdrop([0.05, 0.12, 0.14]), { path: route4 }, dataPlay({
    layers: [dataLayer('route', 'Route', {
      dataset: 'path', view: 'path', xCol: 'x', yCol: 'y', colour: 'palette', palette: 1, lineWidth: 3.5, trim: 0,
      axes: 'centred', centre: 'zero', grid: true, ticks: false, axisLine: true, labels: false,
      equal: true, highlight: false,
    })],
    controls: [ctl('trim', 'layer:route::trim', 'Route · Trim', 0, 1, 0.001)],
    mappings: [{ id: 'm1', controlId: 'trim', source: { kind: 'lfo', shape: 'saw', rate: 0.125, phase: 0 }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }],
    notes: `**What it shows.** A route drawn on by time. The dataset is 80 x, y points winding out from the centre.

**How it is built.** A **Data layer** in **Path** view joins the rows in order. Its **Trim** (how much of the path is drawn) is a control, and a **Saw LFO** mapping at 0.125 Hz sweeps it from 0 to 1 every 8 seconds, so the route draws itself on and starts over. A dot rides the head of the line, and it is the layer's anchor: a proximity trigger can fire when a null, a hand or another layer comes near it. The colour runs through a palette along the rows. **Axes: Centred** on **Zero** puts 0,0 in the middle with a faint grid, and **Same scale** keeps the spiral round on any picture shape.

**Try.** Turn the mapping off (its switch in Mappings) and drag Trim yourself. Change the palette in Look, or switch the view to **Points** to see the rows as dots.`,
  }));

  // ── 5 · A poem, word by word ──────────────────────────────────────────────
  const poem = dataset('poem', 'Tide notes', 'tide-notes.txt', tideNotesText(), ['data'], false, 'text');
  add('dataPoemWords', darkBackdrop([0.16, 0.1, 0.14]), { poem }, dataPlay({
    layers: [dataLayer('words', 'Poem', {
      dataset: 'poem', split: 'words', order: 'text', show: 'window', count: 1, transition: 'fade', duration: 0.45,
      textSize: 0.15, font: 'serif', weight: 500, textColor: [1, 0.95, 0.86],
    })],
    actions: [
      act('beat', { on: 'beat', bpm: 80, beats: 1 }, 'next', 'words'),
      act('space', { on: 'key', code: 'Space' }, 'next', 'words'),
      act('back', { on: 'key', code: 'ArrowLeft' }, 'prev', 'words'),
    ],
    notes: `**What it shows.** Text stepped word by word. The dataset is a short poem (a text file); a **Data layer** splits it into **Words** and shows one at a time with a **Fade**, in its text style (the Text layer's font, weight and colour).

**How it is built.** **Show: Window** of 1 word. An action on a **beat at 80 bpm** fires **Next row** once a beat; **Space** does too, and **←** goes back. The Split section lists the most frequent words.

**Try.** Set Window to 4 to show a phrase at a time, or split into **Lines**. Set Order to **Most frequent** and turn on **Counts**: the poem becomes a word count, "the · 6" first. Change the font to a Google font in Text style.`,
  }));

  // ── 6 · A sketch reads s.data() ───────────────────────────────────────────
  const climate6 = dataset('climate6', 'City climate', 'city-climate.csv', cityClimateCsv(), ['df']);
  add('dataScriptRings', darkBackdrop([0.08, 0.08, 0.12]), { climate6 }, dataPlay({
    layers: [dataScript('rings', 'Climate rings', DATA_SKETCH)],
    controls: [ctl('month', 'layer:rings::p_month', 'Month', 1, 12, 1)],
    mappings: [{ id: 'm1', controlId: 'month', source: { kind: 'lfo', shape: 'saw', rate: 0.1, phase: 0 }, outMin: 1, outMax: 12.99, curve: 'linear', smoothMs: 0, enabled: true }],
    notes: `**What it shows.** A Script layer reading a dataset. \`s.data('City climate')\` returns the table: **rows** (each an object like \`{ city: 'Rome', month: 7, temp_c: 24.2 }\`), **columns**, **col(name)**, **min(name)** and **max(name)**, plus **current** and **index** (the row a Data layer on the dataset has stepped to).

**How it is built.** The sketch draws each city's twelve months as a ring of dots: the angle is the month, the distance from the middle the temperature (map() from min to max). The **Month** slider it declares lights up one month; a saw LFO mapped onto it walks through the year.

**Try.** Open the sketch (the code button on the layer) and read the draw function. Open the dataset from a Data layer or Data node and change the notebook, say \`df.where('city != "Cairo"')\`: the rings follow at once. Add a Data layer on the same dataset, step it with Next, and use \`d.current\` in the sketch to follow its row.`,
  }));

  return graphs;
}
