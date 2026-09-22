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
};
