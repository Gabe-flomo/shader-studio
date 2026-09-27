/**
 * handExport.ts — hand tracking for a web page export, when the author asks
 * for it ("Include hand tracking" in Put it on a website). The page then
 * carries MediaPipe's ES module, its WebAssembly loader and binary, and the
 * hand model, each gzipped and base64'd, so the page works offline like the
 * app does; the runtime (runtime/play-runtime.js) unpacks them with the
 * browser's DecompressionStream the first time a visitor enables hands.
 *
 * The files come from the app itself (public/mediapipe/, and mediapipe/wasm/
 * that vite.config.ts serves from the npm package). Loaded once, on demand:
 * about 20 MB to fetch and gzip, so never in the main bundle.
 */
import { gzip } from 'fflate';

export interface HandAssets {
  /** vision_bundle.mjs (MediaPipe Tasks Vision, ES module). */
  bundle: string;
  /** vision_wasm_module_internal.js, the WebAssembly loader. */
  loader: string;
  /** vision_wasm_module_internal.wasm. */
  wasm: string;
  /** hand_landmarker.task (float16). */
  model: string;
}

/** Characters the assets add to the page. */
export function handAssetsBytes(a: HandAssets): number {
  return a.bundle.length + a.loader.length + a.wasm.length + a.model.length;
}

let cached: Promise<HandAssets> | null = null;

/** Fetch, gzip and encode the four files (once per session). */
export function loadHandAssets(): Promise<HandAssets> {
  if (!cached) {
    cached = build().catch(e => { cached = null; throw e; });
  }
  return cached;
}

async function build(): Promise<HandAssets> {
  const base = `${import.meta.env.BASE_URL}mediapipe/`;
  const get = async (path: string) => {
    const r = await fetch(base + path);
    if (!r.ok) throw new Error(`Couldn’t load ${path} (${r.status})`);
    return new Uint8Array(await r.arrayBuffer());
  };
  const [bundle, loader, wasm, model] = await Promise.all([
    get('wasm/vision_bundle.mjs'), get('wasm/vision_wasm_module_internal.js'), get('wasm/vision_wasm_module_internal.wasm'), get('hand_landmarker.task'),
  ]);
  const [b, l, w, m] = await Promise.all([bundle, loader, wasm, model].map(packed));
  return { bundle: b, loader: l, wasm: w, model: m };
}

/** gzip (off the main thread, fflate's workers) then base64. */
function packed(bytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    gzip(bytes, { level: 9 }, (err, out) => (err ? reject(err) : resolve(toBase64(out))));
  });
}

function toBase64(u8: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) s += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + CHUNK)));
  return btoa(s);
}
