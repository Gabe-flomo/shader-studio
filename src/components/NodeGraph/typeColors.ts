// Socket/wire color per data type — shared between the spatial node canvas
// (NodeComponent) and the mobile drill-down browser (MobileGraphBrowser) so
// both stay visually consistent.
export const TYPE_COLORS: Record<string, string> = {
  float: '#f0a',
  vec2: '#0af',
  vec3: '#0fa',
  vec4: '#fa0',
  mat2:        '#f5c842',  // golden yellow for 2×2 matrix wires
  mat3:        '#e8a020',  // amber for 3×3 matrix wires
  scene3d:     '#cc88aa',  // pastel pink for 3D scene wires
  spacewarp3d: '#aa88cc',  // pastel purple for space warp wires
  texture:     '#ff5c5c',  // coral for a Pass's texture (dashed: see ConnectionLine)
  agents:      '#9be564',  // the Agents family (docs/agents-plan.md): a group's walkers
  emitter:     '#ffd166',  //   an Emit's births
  deposit:     '#c792ea',  //   Deposits on their way into a Trail
  volume:      '#f5a97f',  // A Time Cube's stacked frames (docs/time-cube.md)
};
