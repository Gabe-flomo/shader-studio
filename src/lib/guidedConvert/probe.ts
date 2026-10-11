/**
 * Guided Convert, the selection's picture (docs/guided-convert.md, step 2): the shader cut off after
 * the selection, showing the last value the selection makes over the whole picture, as the line
 * previews show a line. A float is grey, a vec2 red-green, a vec3 a colour; the colour itself when
 * the selection writes it.
 */
import type { Analysis } from './analyse';

export interface Probe { code: string; name: string; type: string }

const VIS: Record<string, (v: string) => string> = {
  float: v => `vec3(${v})`, int: v => `vec3(float(${v}))`, vec2: v => `vec3(${v}, 0.0)`, vec3: v => v, vec4: v => `${v}.rgb`,
};

/** The probe for a selection of units, or null when it makes nothing to show. */
export function probeShader(a: Analysis, units: readonly number[]): Probe | null {
  if (!units.length) return null;
  const last = Math.max(...units);
  const chosen = units.map(i => a.units[i]);
  // The value: the last name the selection declares, else the last local it writes, else the colour.
  let name: string | null = null;
  for (const u of [...chosen].reverse()) { const d = u.decls[u.decls.length - 1]; if (d && !d.array && VIS[d.type]) { name = d.name; break; } }
  if (!name) for (const u of [...chosen].reverse()) { const w = [...u.writes].reverse().find(n => n !== 'gl_FragColor' && VIS[a.localTypes.get(n) ?? '']); if (w) { name = w; break; } }
  const writesColour = chosen.some(u => u.writes.has('gl_FragColor'));
  if (!name && !writesColour) return null;
  const body = a.units.filter(u => u.index <= last).map(u => `  ${u.text}`).join('\n');
  const show = name ? `  gl_FragColor = vec4(${VIS[a.localTypes.get(name)!](name)}, 1.0);` : '  gl_FragColor.a = 1.0;';
  const code = `${a.norm.slice(0, a.mainStart)}void main() {\n${body}\n${show}\n}${a.norm.slice(a.mainEnd)}`;
  return { code, name: name ?? 'the colour', type: name ? a.localTypes.get(name)! : 'vec4' };
}
