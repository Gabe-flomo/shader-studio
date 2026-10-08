/**
 * config.ts — which image+text model Playfield runs on this device (docs/image-model.md).
 *
 * MobileCLIP-S0 (Apple), in the ONNX export Transformers.js reads (Xenova/mobileclip_s0, pinned to a
 * revision). The vision tower runs in fp16: its int8 export ranks colours wrongly (a red picture scored
 * closer to "blue" than "red" in our check), while fp16 matches fp32 to three places. The text tower is int8
 * (it matches fp32 just as well, at half the size of fp16).
 *
 * tools/fetch-image-model.mjs reads this file's list to fetch the same files for the desktop bundle.
 */

export interface ModelFile { path: string; bytes: number }

export const IMAGE_MODEL = {
  /** A short id for this model. */
  id: 'mobileclip-s0',
  name: 'MobileCLIP-S0',
  repo: 'Xenova/mobileclip_s0',
  revision: '757d59c9c6870a76a4b0306f05f5061bca15c39f',
  /** The embedding's size (image and text share the space). */
  dims: 512,
  /** The input picture's side (the processor resizes and centre-crops to this). */
  side: 256,
  dtype: { vision: 'fp16', text: 'q8' } as const,
  files: [
    { path: 'config.json', bytes: 344 },
    { path: 'preprocessor_config.json', bytes: 382 },
    { path: 'tokenizer.json', bytes: 2224081 },
    { path: 'tokenizer_config.json', bytes: 763 },
    { path: 'onnx/vision_model_fp16.onnx', bytes: 22876479 },
    { path: 'onnx/text_model_quantized.onnx', bytes: 42799238 },
  ] as ModelFile[],
  licence: 'Apple sample-code licence as shipped with the ONNX export (see docs/image-model.md)',
} as const;

/** Shipped with the desktop bundle beside the model (the licence notice its redistribution needs); never fetched by the app. */
export const NOTICE_FILES: ModelFile[] = [{ path: 'LICENSE', bytes: 2671 }];

/** The download, in bytes. */
export const MODEL_BYTES = IMAGE_MODEL.files.reduce((s, f) => s + f.bytes, 0);

/** Where the desktop app (and a local check in dev) serves the bundled files: `<base>models/<repo>/…`. */
export const LOCAL_MODEL_DIR = 'models/';
