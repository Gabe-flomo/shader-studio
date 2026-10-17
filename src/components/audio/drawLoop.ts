/** One animation-frame loop for every Audio readout (the cards and Audio Source's window): no React render per frame. */
const drawers = new Set<() => void>();
let raf = 0;
function loop() {
  for (const d of drawers) d();
  raf = drawers.size ? requestAnimationFrame(loop) : 0;
}
export function addDrawer(d: () => void): () => void {
  drawers.add(d);
  if (!raf && typeof requestAnimationFrame !== 'undefined') raf = requestAnimationFrame(loop);
  return () => { drawers.delete(d); };
}

