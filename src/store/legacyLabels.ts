import type { GraphNode } from '../types/nodeGraph';

/**
 * Load-time upgrades for nodes saved by older builds (run on every loaded node, including those
 * inside groups, before migrateNodeParams backfills any new sockets).
 *
 * Socket labels are saved with each node, so renaming one in a node definition doesn't reach
 * existing graphs. These are the renamed sockets as [old label, new label] by node type and key;
 * `upgradeLegacyNode` swaps a saved label only while it still reads the old name, so a
 * label the user changed (group ports, custom functions) is left alone.
 */
const RENAMED_SOCKETS: Record<string, Record<string, readonly [string, string]>> = {
  palette: { value: ['Value', 'Angle'], anim: ['Time', 'Angle offset'] },
  accumulateLoop: { time_scale: ['Time Scale', 'Speed'] },
  blend: { factor: ['Factor', 'Blend'] },
  boxSDF: { position: ['Position', 'UV'], offset: ['Offset', 'Center'] },
  circleSDF: { position: ['Position', 'UV'], offset: ['Offset', 'Center'] },
  domainWarp: { time_scale: ['Anim Speed', 'Speed'] },
  fbm: { scale: ['Scale', 'Frequency'], time_scale: ['Time Scale', 'Speed'] },
  fract: { scale: ['Scale', 'Tile count'] },
  fractalLoop: { time_scale: ['Anim Speed', 'Speed'] },
  loopColorRingStep: { timeScale: ['Time Scale', 'Speed'] },
  loopRingStep: { timeScale: ['Time Scale', 'Speed'] },
  makeLight: { brightness: ['Brightness', 'Falloff'] },
  mix: { t: ['T', 'Blend'] },
  mixVec3: { fac: ['Fac', 'Blend'] },
  opRepeat: { p: ['P', 'UV'], result: ['Tiled P', 'Tiled UV'] },
  opRepeatPolar: { p: ['P', 'UV'], result: ['Tiled P', 'Tiled UV'] },
  raymarch3d: { blend_k: ['Blend K', 'Blend radius'] },
  ringSDF: { position: ['Position', 'UV'], offset: ['Offset', 'Center'] },
  rotate2d: { angle: ['Angle', 'Angle (rad)'] },
  sdBox: { p: ['P', 'UV'] },
  sdEllipse: { p: ['P', 'UV'] },
  sdSegment: { p: ['P', 'UV'] },
  sdf2dSmoothUnion: { blend: ['Blend', 'Blend radius'] },
  sdfSmoothIntersect: { k: ['Blend', 'Blend radius'] },
  sdfSmoothSubtract: { k: ['Blend', 'Blend radius'] },
  sdfSmoothUnion: { k: ['Blend', 'Blend radius'] },
  smoothMax: { smoothness: ['Smoothness', 'Blend radius'] },
  smoothMin: { smoothness: ['Smoothness', 'Blend radius'] },
  smoothSubtract: { smoothness: ['Smoothness', 'Blend radius'] },
  step: { edge: ['Edge', 'Threshold'], x: ['X', 'Value'] },
  voronoi: { scale: ['Scale', 'Cell density'], jitter: ['Jitter', 'Randomness'], time_scale: ['Anim Speed', 'Speed'] },
};

/** Palette's per-channel sockets, replaced by one vec3 socket per group (offset, amplitude, freq, phase) */
const PALETTE_CHANNEL_SOCKET = /^(offset|amplitude|freq|phase)_[rgb]$/;

export function upgradeLegacyNode(node: GraphNode): GraphNode {
  // Palette: drop the per-channel sockets nobody wired. A wired one stays and keeps driving its
  // channel (see PaletteNode.generateGLSL), so an old graph renders exactly as before.
  if (node.type === 'palette' && Object.keys(node.inputs ?? {}).some(k => PALETTE_CHANNEL_SOCKET.test(k))) {
    node = { ...node, inputs: Object.fromEntries(Object.entries(node.inputs).filter(([k, inp]) => !PALETTE_CHANNEL_SOCKET.test(k) || inp.connection)) };
  }
  // Custom functions that were never renamed carried the old default title
  if (node.type === 'customFn' && node.params?.label === 'Custom Fn') node = { ...node, params: { ...node.params, label: 'Custom Function' } };
  const renames = RENAMED_SOCKETS[node.type];
  if (!renames) return node;
  let inputs = node.inputs;
  let outputs = node.outputs;
  for (const [key, [from, to]] of Object.entries(renames)) {
    if (inputs?.[key]?.label === from) inputs = { ...inputs, [key]: { ...inputs[key], label: to } };
    if (outputs?.[key]?.label === from) outputs = { ...outputs, [key]: { ...outputs[key], label: to } };
  }
  return inputs === node.inputs && outputs === node.outputs ? node : { ...node, inputs, outputs };
}
