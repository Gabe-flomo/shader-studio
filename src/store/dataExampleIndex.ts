/** The Data folder's entries (graphs in dataExamples.ts, loaded with the other examples). */
export const DATA_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = {
  dataWeatherYear: {
    label: 'Data 1 · A year of weather', play: true,
    description: 'A CSV of monthly climate for five cities, cut down to Rome in the notebook and normalized to 0–1. Time drives the Data node’s Index, so the glow steps (and blends) through the twelve months: its size follows the temperature, its colour too, its softness the rain.',
  },
  dataCityBars: {
    label: 'Data 3 · City temperatures, a month at a time', play: true,
    description: 'A Data layer draws a table as bars: five cities’ temperatures, one month at a time (a window of five rows that steps a whole window). The arrow keys fire Next and Previous row; the bars fade from month to month and the month name is the caption.',
  },
  dataRoutePath: {
    label: 'Data 4 · A route drawn on', play: true,
    description: 'A Data layer in Path view joins 80 x, y rows in order. Its Trim is a control driven by a saw LFO, so the route draws itself on every 8 seconds, coloured through a palette, on centred axes with a grid.',
  },
  dataPoemWords: {
    label: 'Data 5 · A poem, word by word', play: true,
    description: 'A text dataset split into words by a Data layer and shown one at a time with a fade, in a serif text style. A beat at 80 bpm (and Space) fires Next row; ← goes back.',
  },
  dataScriptRings: {
    label: 'Data 6 · A sketch reads s.data()', play: true,
    description: 'A Script layer reads the City climate table with s.data(): every city’s year as a ring of dots, the angle the month and the distance the temperature. A Month slider it declares (walked by an LFO) lights up one month.',
  },
  dataRouteGlow: {
    label: 'Data 2 · Every row a glowing point', play: true,
    description: 'A spiral route of 48 x, y points. An iterated group runs 48 times; inside it a Data node reads row i (Loop Index into Index) and a glowing dot is drawn there, each in its own colour. A second Data node, used as Points in Path mode, draws the route as one faint line.',
  },
};

export const DATA_EXAMPLE_KEYS = Object.keys(DATA_EXAMPLE_INDEX);
