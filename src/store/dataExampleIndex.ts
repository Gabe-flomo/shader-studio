/** The Data folder's entries (graphs in dataExamples.ts, loaded with the other examples). */
export const DATA_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = {
  dataWeatherYear: {
    label: 'Data 1 · A year of weather', play: true,
    description: 'A CSV of monthly climate for five cities, cut down to Rome in the notebook and normalized to 0–1. Time drives the Data node’s Index, so the glow steps (and blends) through the twelve months: its size follows the temperature, its colour too, its softness the rain.',
  },
  dataRouteGlow: {
    label: 'Data 2 · Every row a glowing point', play: true,
    description: 'A spiral route of 48 x, y points. An iterated group runs 48 times; inside it a Data node reads row i (Loop Index into Index) and a glowing dot is drawn there, each in its own colour. A second Data node, used as Points in Path mode, draws the route as one faint line.',
  },
};

export const DATA_EXAMPLE_KEYS = Object.keys(DATA_EXAMPLE_INDEX);
