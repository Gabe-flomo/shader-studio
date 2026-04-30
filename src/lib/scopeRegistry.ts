/**
 * Global registry for scope node canvases.
 *
 * ShaderCanvas writes probe values directly here every animation frame,
 * bypassing React state so there's no setState → re-render → useEffect overhead.
 * NodeComponent registers its canvas element on mount and removes it on unmount.
 */

export const scopeCanvasRegistry = new Map<string, HTMLCanvasElement>();

// Rolling 200-sample buffer per scope node (stores raw normalised 0-1 probe values)
export const scopeBufferRegistry = new Map<string, number[]>();

// Latest raw normalised value per key — updated even without a canvas registered.
// Used by inline vizzes (e.g. ShaperCurveViz) to read live probe values via rAF.
export const scopeValueRegistry = new Map<string, number>();

// Multi-channel probe values per key — stores decoded [-1, 1] components for vec2/vec3 inputs.
// Keyed as `__preview__${nodeId}` same as scopeValueRegistry.
export const vectorValueRegistry = new Map<string, number[]>();

// Decoded actual float values — not normalized, not clamped to any display range.
// Updated by drawScopeCanvas. Use this instead of rawNorm * 2 - 1 in inline vizzes.
export const floatValueRegistry = new Map<string, number>();

/**
 * Called from the animation loop once per frame per scope node.
 * rawNorm is the probe value already normalised to [0, 1] by the probe shader.
 * min/max are the node's display range for decoding the label.
 */
export function drawScopeCanvas(
  nodeId: string,
  rawNorm: number,
  min: number,
  max: number,
): void {
  // Always store the live value so inline vizzes can read it without a canvas.
  scopeValueRegistry.set(nodeId, rawNorm);
  // Store decoded actual value for vizzes that need true range (not clamped to ±1).
  floatValueRegistry.set(nodeId, rawNorm * (max - min) + min);

  const canvas = scopeCanvasRegistry.get(nodeId);
  if (!canvas) return;

  // Maintain rolling buffer
  let buf = scopeBufferRegistry.get(nodeId);
  if (!buf) {
    buf = new Array(200).fill(0.5);
    scopeBufferRegistry.set(nodeId, buf);
  }
  buf.push(rawNorm);
  if (buf.length > 200) buf.shift();

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const W = canvas.width;
  const H = canvas.height;
  const mg = 3; // vertical margin so stroke isn't clipped at canvas edges

  // Background
  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = '#1e1e2e';
  ctx.lineWidth = 1;
  for (let g = 1; g < 4; g++) {
    const y = mg + (g / 4) * (H - 2 * mg);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // Zero line
  const range = (max - min) || 1;
  const zeroNorm = (0 - min) / range;
  const zeroY = mg + (1 - Math.max(0, Math.min(1, zeroNorm))) * (H - 2 * mg);
  ctx.strokeStyle = '#313244';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, zeroY);
  ctx.lineTo(W, zeroY);
  ctx.stroke();

  // Clipping detection — signal saturating at the range limits
  const isClipping = rawNorm <= 0.01 || rawNorm >= 0.99;

  // Signal line
  ctx.strokeStyle = isClipping ? '#f38ba8' : '#89b4fa';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < buf.length; i++) {
    const x = (i / (buf.length - 1)) * W;
    const y = mg + (1 - buf[i]) * (H - 2 * mg);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Live value label (decoded from raw normalised)
  const currentVal = rawNorm * range + min;
  ctx.font = '9px monospace';
  ctx.textAlign = 'right';
  ctx.fillStyle = isClipping ? '#f38ba8' : '#6c7086';
  ctx.fillText(currentVal.toFixed(3), W - 4, H - 4);

  // CLIP warning
  if (isClipping) {
    ctx.fillStyle = '#f38ba844';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('CLIP', 4, H - 4);
  }
}
