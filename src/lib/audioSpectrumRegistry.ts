/**
 * audioSpectrumRegistry.ts — module-level canvas registry for live FFT spectrum.
 * Pattern mirrors scopeRegistry.ts.
 *
 * AudioInputModal registers its canvas here on mount.
 * ShaderCanvas.animate() calls drawSpectrumCanvas() each frame.
 */

export const audioSpectrumRegistry = new Map<string, HTMLCanvasElement>();

/**
 * Draw a bar-graph FFT spectrum into the registered canvas for the given nodeId.
 * freqData: Uint8Array from analyser.getByteFrequencyData() — values 0–255.
 * freqCenter/freqRange: Hz values for highlighting the selected band.
 */
export function drawSpectrumCanvas(
  nodeId: string,
  freqData: Uint8Array,
  sampleRate: number,
  fftSize: number,
  freqCenter: number,
  freqRange: number,
  mode: string,
): void {
  const canvas = audioSpectrumRegistry.get(nodeId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const W = canvas.width;
  const H = canvas.height;
  const binCount = freqData.length;
  const hzPerBin = sampleRate / fftSize;
  const maxHz = (binCount * hzPerBin);

  // Clear
  ctx.fillStyle = '#11111b';
  ctx.fillRect(0, 0, W, H);

  // Draw frequency bars (log-scaled x axis feels more natural for audio)
  const logMin = Math.log10(20);
  const logMax = Math.log10(Math.min(maxHz, 20000));

  const barWidth = Math.max(1, Math.floor(W / 120));
  const numBars = Math.floor(W / barWidth);

  for (let b = 0; b < numBars; b++) {
    const t = b / numBars;
    const hz = Math.pow(10, logMin + t * (logMax - logMin));
    const binIdx = Math.round(hz / hzPerBin);
    if (binIdx >= binCount) continue;

    const value = freqData[binIdx] / 255;
    const barH = Math.round(value * H);
    const x = b * barWidth;

    // Color based on frequency range
    const hue = 200 + t * 60; // blue → teal → green
    ctx.fillStyle = `hsla(${hue}, 70%, 55%, 0.85)`;
    ctx.fillRect(x, H - barH, barWidth - 1, barH);
  }

  // Highlight the selected frequency band
  const lo = mode === 'full' ? 0 : Math.max(0, freqCenter - freqRange);
  const hi = mode === 'full' ? 20000 : Math.min(20000, freqCenter + freqRange);

  const loT = (Math.log10(Math.max(20, lo)) - logMin) / (logMax - logMin);
  const hiT = (Math.log10(Math.max(20, hi)) - logMin) / (logMax - logMin);
  const loX = Math.round(Math.max(0, loT) * W);
  const hiX = Math.round(Math.min(1, hiT) * W);

  ctx.fillStyle = 'rgba(137, 180, 250, 0.15)';
  ctx.fillRect(loX, 0, hiX - loX, H);
  ctx.strokeStyle = 'rgba(137, 180, 250, 0.6)';
  ctx.lineWidth = 1;
  ctx.strokeRect(loX, 0, hiX - loX, H);

  // Center line for band mode
  if (mode !== 'full') {
    const centerT = (Math.log10(Math.max(20, freqCenter)) - logMin) / (logMax - logMin);
    const cx = Math.round(centerT * W);
    ctx.strokeStyle = '#cdd6f4';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, H);
    ctx.stroke();
  }

  // Frequency axis labels
  ctx.fillStyle = '#585b70';
  ctx.font = '8px monospace';
  const labelHz = [100, 500, 1000, 5000, 10000];
  for (const hz of labelHz) {
    if (hz > maxHz) continue;
    const t2 = (Math.log10(hz) - logMin) / (logMax - logMin);
    const x = Math.round(t2 * W);
    const label = hz >= 1000 ? `${hz / 1000}k` : `${hz}`;
    ctx.fillText(label, Math.max(1, x - 4), H - 2);
  }
}
