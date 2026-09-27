/**
 * imageFiles.ts — image files as data URLs for layers (pickers.tsx and drops,
 * dropMakers.ts): downscaled so play files stay small.
 */
/** An image file as an Image layer's `src`: a data URL at most 1024 px on its long side (null when the browser can't read it). */
export function imageFileToSrc(file: File, maxSide = 1024): Promise<string | null> {
  return new Promise(resolve => loadImage(file, maxSide, false, false, resolve, () => resolve(null)));
}

export function loadImage(file: File, maxSide: number, upscaleSvg: boolean, png: boolean, onDone: (src: string) => void, onFail?: () => void): void {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    // SVGs without a size report 0 (or 150): draw them at the target size.
    const w0 = img.naturalWidth || maxSide, h0 = img.naturalHeight || maxSide;
    const isSvg = file.type === 'image/svg+xml';
    const k = isSvg && upscaleSvg ? maxSide / Math.max(w0, h0) : Math.min(1, maxSide / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    onDone(png || file.type === 'image/png' || file.type === 'image/webp' || isSvg ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9));
    URL.revokeObjectURL(url);
  };
  img.onerror = () => { URL.revokeObjectURL(url); onFail?.(); };
  img.src = url;
}
