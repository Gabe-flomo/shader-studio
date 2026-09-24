/**
 * midiOutputs.ts — the one place that knows which float outputs a MIDI Input
 * node has. Shared by the node definition (sockets + GLSL), the assembler
 * (uniform declarations), the node card (rebuilding sockets when CCs change)
 * and the MIDI engine (which channels it writes each frame).
 *
 * Pure: no React, no store, no DOM.
 */

/** Outputs every MIDI Input node has, in socket order. */
export const MIDI_FIXED_OUTPUTS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'note',     label: 'Note' },
  { key: 'velocity', label: 'Velocity' },
  { key: 'gate',     label: 'Gate' },
  { key: 'bend',     label: 'Pitch Bend' },
];

/** The CC numbers a node listens to, read from its params (`_ccs`). */
export function midiCcList(params: Record<string, unknown> | undefined): number[] {
  const raw = params?._ccs;
  if (!Array.isArray(raw)) return [1];
  const out: number[] = [];
  for (const v of raw) {
    const n = typeof v === 'number' ? Math.round(v) : NaN;
    if (Number.isFinite(n) && n >= 0 && n <= 127 && !out.includes(n)) out.push(n);
  }
  return out.length ? out : [1];
}

/** Socket key for a CC output. */
export function midiCcKey(cc: number): string {
  return `cc_${cc}`;
}

/** Every output key of a node with these params: the fixed ones, then one per CC. */
export function midiOutputKeys(params: Record<string, unknown> | undefined): string[] {
  return [...MIDI_FIXED_OUTPUTS.map(o => o.key), ...midiCcList(params).map(midiCcKey)];
}

/** Output sockets for the node card / store (`updateNodeOutputs`). */
export function midiOutputSockets(params: Record<string, unknown> | undefined): Record<string, { type: 'float'; label: string }> {
  const out: Record<string, { type: 'float'; label: string }> = {};
  for (const o of MIDI_FIXED_OUTPUTS) out[o.key] = { type: 'float', label: o.label };
  for (const cc of midiCcList(params)) out[midiCcKey(cc)] = { type: 'float', label: `CC ${cc}` };
  return out;
}

/**
 * Uniform name for one output. `id` is whatever the assembler hands
 * generateGLSL as `node.id` (the slug), so both sides agree by construction.
 */
export function midiUniformName(id: string, outputKey: string): string {
  return `u_midi_${id}_${outputKey}`;
}

/** Key the input bus uses to route a value: `${nodeId}::${outputKey}`. */
export function liveChannelKey(nodeId: string, outputKey: string): string {
  return `${nodeId}::${outputKey}`;
}
