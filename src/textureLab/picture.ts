/**
 * picture.ts — Texture Lab's small pictures, drawn on the CPU (docs/texture-lab.md): the kind page's card and the
 * presets strip show the built-in Room and cat photo through a look close to each preset (Thermal, Ink outline, Motion
 * trails, Relief), so they cost the GPU nothing while the main preview is held. Where a picture can't be decoded (tests)
 * nothing is drawn.
 */
import { builtinImageUrl, ROOM_AND_CAT_ID } from '../lib/builtinImages';

export type PictureLook = 'none' | 'thermal' | 'ink' | 'trails' | 'relief';

let photo: Promise<HTMLImageElement | null> | null = null;

/** The Room and cat photo, loaded once (null where it can't be). */
export function roomPhoto(): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined' || typeof document === 'undefined') return Promise.resolve(null);
  if (!photo) {
    photo = new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => { photo = null; resolve(null); };
      img.src = builtinImageUrl(ROOM_AND_CAT_ID);
    });
  }
  return photo;
}

const THERMAL: ReadonlyArray<[number, number, number]> = [[0.02, 0, 0.1], [0.3, 0.05, 0.7], [0.95, 0.15, 0.35], [1, 0.62, 0.08], [1, 1, 0.82]];

function ramp(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(0.9999, t)) * (THERMAL.length - 1);
  const i = Math.floor(x), f = x - i;
  const a = THERMAL[i], b = THERMAL[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** `src` (RGBA, w × h) through `look`, into `dst`. */
export function lookPixels(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, look: PictureLook): void {
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = (0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2]) / 255;
  const at = (x: number, y: number) => L[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let r = src[i] / 255, g = src[i + 1] / 255, b = src[i + 2] / 255;
      if (look === 'thermal') {
        const s = (at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1) + 2 * at(x, y)) / 6;
        [r, g, b] = ramp(Math.pow(s, 0.8) * 1.15);
      } else if (look === 'ink') {
        const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
        const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
        const v = 1 - Math.min(1, Math.hypot(gx, gy) * 2.2);
        r = g = b = 0.97 * v + 0.03;
      } else if (look === 'relief') {
        const shade = Math.max(0, Math.min(1.6, 0.85 + (at(x - 1, y - 1) - at(x + 1, y + 1)) * 4));
        r *= shade; g *= shade; b *= shade;
      } else if (look === 'trails') {
        // A zoom smear from the middle, cooled: what moves would leave this.
        let sr = 0, sg = 0, sb = 0;
        for (let k = 0; k < 6; k++) {
          const s = 1 - k * 0.025;
          const xx = Math.round(w / 2 + (x - w / 2) * s), yy = Math.round(h / 2 + (y - h / 2) * s);
          const j = (Math.min(h - 1, Math.max(0, yy)) * w + Math.min(w - 1, Math.max(0, xx))) * 4;
          const fade = 1 - k * 0.14;
          sr += src[j] / 255 * fade * 0.6; sg += src[j + 1] / 255 * fade * 0.85; sb += src[j + 2] / 255 * fade;
        }
        r = sr / 3.2; g = sg / 3.2; b = sb / 3.2;
      }
      dst[i] = Math.round(Math.max(0, Math.min(1, r)) * 255);
      dst[i + 1] = Math.round(Math.max(0, Math.min(1, g)) * 255);
      dst[i + 2] = Math.round(Math.max(0, Math.min(1, b)) * 255);
      dst[i + 3] = 255;
    }
  }
}

/** The photo, covering a w × h canvas, through `look`. Null where it can't be drawn. */
export function drawLook(img: HTMLImageElement, w: number, h: number, look: PictureLook): HTMLCanvasElement | null {
  try {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (!g) return null;
    const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    if (look === 'none') return c;
    const data = g.getImageData(0, 0, w, h);
    const out = g.createImageData(w, h);
    lookPixels(data.data, out.data, w, h, look);
    g.putImageData(out, 0, 0);
    return c;
  } catch { return null; }
}

const thumbs = new Map<string, string>();

/** A preset's picture as a data URL (once the photo has loaded; empty until then). */
export async function lookThumb(look: PictureLook, w = 160, h = 96): Promise<string> {
  const key = `${look}:${w}x${h}`;
  const hit = thumbs.get(key);
  if (hit) return hit;
  const img = await roomPhoto();
  const c = img ? drawLook(img, w, h, look) : null;
  const url = c ? c.toDataURL('image/jpeg', 0.85) : '';
  if (url) thumbs.set(key, url);
  return url;
}
