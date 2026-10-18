/**
 * recipeGradient.ts — a shape's gradient colour as recipe text (docs/gradients.md, docs/scene-builder-3d.md).
 *
 *   sphere gradient="height: #1a0f40 0, orange 0.5, (1,0.9,0.6) 1"
 *   box gradient="normal linear 1..-1: white 0, black 1"
 *
 * The quoted text is the driver (its key: height, centre, axisX, axisZ, normal, depth, noise…), then
 * the blend when it isn't Smooth, then From..To when they aren't the driver's own range, a `:` and
 * the stops, each a colour (a name, #rrggbb or (r,g,b)) and its place 0–1, split by commas.
 */
import { GRADIENT_DRIVERS, INTERP_OPTIONS, normaliseStops, type ColourGradient, type GradientDriver, type GradientInterp } from '../lib/colourGradient';
import { colourOf, colourText } from '../lang/colours';
import type { GradientStop, RGB } from '../components/ui/gradientStops';

const r4 = (n: number) => { const r = Math.round(n * 10000) / 10000; return Object.is(r, -0) ? '0' : String(r); };

const DRIVER_BY_WORD: Record<string, GradientDriver> = Object.fromEntries(
  (Object.keys(GRADIENT_DRIVERS) as GradientDriver[]).flatMap(k => [[k.toLowerCase(), k]]),
);
Object.assign(DRIVER_BY_WORD, { center: 'centre', x: 'axisX', z: 'axisZ', y: 'height', 'along-x': 'axisX', 'along-z': 'axisZ' });
const INTERPS = new Set<string>(INTERP_OPTIONS.map(o => o.value));

/** The text inside `gradient="…"`. */
export function printGradientText(g: ColourGradient): string {
  const head: string[] = [g.along];
  if (g.interp !== 'smooth') head.push(g.interp);
  const [f, t] = GRADIENT_DRIVERS[g.along].range;
  if (r4(g.from) !== r4(f) || r4(g.to) !== r4(t)) head.push(`${r4(g.from)}..${r4(g.to)}`);
  const stops = normaliseStops(g.stops).map(s => `${colourText(s.color)} ${r4(s.pos)}`);
  return `${head.join(' ')}: ${stops.join(', ')}`;
}

/** Reads `gradient="…"` text back: the gradient, or an error message. */
export function parseGradientText(text: string): { gradient: ColourGradient } | { error: string } {
  const colon = text.indexOf(':');
  if (colon < 0) return { error: 'gradient is "along: colour place, colour place…", like gradient="height: navy 0, orange 1".' };
  const head = text.slice(0, colon).trim().split(/\s+/).filter(Boolean);
  const along = DRIVER_BY_WORD[(head[0] ?? '').toLowerCase()];
  if (!along) return { error: `“${head[0] ?? ''}” isn't something a gradient runs along: ${Object.keys(GRADIENT_DRIVERS).join(', ')}.` };
  let interp: GradientInterp = 'smooth';
  let [from, to] = GRADIENT_DRIVERS[along].range;
  for (const w of head.slice(1)) {
    const lw = w.toLowerCase();
    if (INTERPS.has(lw)) { interp = lw as GradientInterp; continue; }
    const m = /^(-?[\d.]+)\.\.(-?[\d.]+)$/.exec(w);
    if (m && Number.isFinite(+m[1]) && Number.isFinite(+m[2])) { from = +m[1]; to = +m[2]; continue; }
    return { error: `“${w}” in a gradient: write the blend (smooth, linear, constant) or the range (from..to, like -1..1).` };
  }
  const stops: GradientStop[] = [];
  const re = /\s*(\([^)]*\)|#[0-9a-fA-F]{3,6}|[A-Za-z][\w-]*)\s+(-?[\d.]+)\s*(?:,|$)/y;
  const body = text.slice(colon + 1).trim();
  let at = 0;
  while (at < body.length) {
    re.lastIndex = at;
    const m = re.exec(body);
    if (!m) return { error: `A gradient's stops are “colour place”, split by commas: “${body.slice(at).trim()}” isn't one.` };
    at = re.lastIndex;
    let c: RGB | null;
    if (m[1].startsWith('(')) {
      const n = m[1].slice(1, -1).split(',').map(s => Number(s.trim()));
      c = n.length === 3 && n.every(Number.isFinite) ? [n[0], n[1], n[2]] : null;
    } else c = colourOf(m[1]);
    if (!c) return { error: `“${m[1]}” isn't a colour I know: use a name, #rrggbb or (r, g, b).` };
    stops.push({ pos: Number(m[2]), color: c });
  }
  if (stops.length < 2) return { error: 'A gradient needs at least two stops: gradient="height: navy 0, orange 1".' };
  return { gradient: { along, interp, stops: normaliseStops(stops), from, to } };
}
