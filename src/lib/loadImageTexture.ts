import * as THREE from 'three';

/**
 * Decode an uploaded image file into a WebGL-ready texture, regardless of
 * its source format (JPEG/PNG/WEBP/HEIC — the format iOS's Photos app
 * exports by default). THREE.TextureLoader just points an <img> at the file
 * and hopes the browser's <img> decoder handles it; createImageBitmap goes
 * through the browser's general image-decode pipeline (broader format
 * support, including HEIC on WebKit) and rejects cleanly on failure instead
 * of silently producing a blank texture. Drawing the decoded bitmap onto a
 * canvas and building the texture from that canvas — rather than from the
 * original file — also means the GPU always receives a plain canvas-backed
 * texture, never something format-specific.
 */
const THUMBNAIL_MAX_DIM = 96;

export async function loadImageTextureFromFile(
  file: File,
): Promise<{ texture: THREE.Texture; thumbnailDataUrl: string; imageAspect: number }> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.drawImage(bitmap, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  // Thumbnail: a separate, small canvas — not a data URL of the full-res
  // canvas above, which for a real photo could be several MB and bloat the
  // saved graph JSON every time it's exported or persisted.
  const scale = Math.min(1, THUMBNAIL_MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = Math.max(1, Math.round(bitmap.width * scale));
  thumbCanvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const thumbCtx = thumbCanvas.getContext('2d');
  thumbCtx?.drawImage(bitmap, 0, 0, thumbCanvas.width, thumbCanvas.height);
  const thumbnailDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.7);

  const imageAspect = bitmap.width / bitmap.height;
  bitmap.close();
  return { texture, thumbnailDataUrl, imageAspect };
}
