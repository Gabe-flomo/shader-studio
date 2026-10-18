/**
 * config.ts — the stem separation models (docs/stems.md): HT-Demucs (Meta's Hybrid Transformer Demucs v4) as ONNX,
 * each an opt-in download pinned to one Hugging Face revision, every file with its size and SHA-256 (checked after
 * download, before it runs). Checked through the HF API on 2026-10-17.
 *
 *   htdemucs     4 stems (drums, bass, other, vocals). monteslu/htdemucs-web-onnx: the official `htdemucs` weights in
 *                mixed precision (fp16, convolutions fp32) cut into 21 chained pieces of ~10–30 ms of GPU work each,
 *                made for onnxruntime-web on WebGPU next to a live picture. The STFT / iSTFT run in JS (dsp.ts).
 *                MIT (the export and Demucs). 126 MB.
 *   htdemucs_6s  6 stems (+ guitar, piano), the optional "More instruments" download. StemSplitio/htdemucs-6s-onnx,
 *                the fp16-weights file: one graph with the STFT inside (`mix` → `stems`). MIT. 136 MB. Its piano
 *                bleeds a lot and its "other" is thinner (Demucs' own README): the UI says so.
 *
 * Not here (docs/stems-research.md): htdemucs_ft (4 × 84 MB, ~4× slower), Open-Unmix umxl and the RoFormers (non-commercial
 * weights), Spleeter (about 3 dB worse, no smaller).
 */

export type StemName = 'drums' | 'bass' | 'other' | 'vocals' | 'guitar' | 'piano';

export const STEM_LABELS: Record<StemName, string> = {
  drums: 'Drums', bass: 'Bass', vocals: 'Vocals', other: 'Other', guitar: 'Guitar', piano: 'Piano',
};
/** The order the picker lists stems in. */
export const STEM_ORDER: readonly StemName[] = ['drums', 'bass', 'vocals', 'other', 'guitar', 'piano'];

export interface StemFile { path: string; bytes: number; sha256: string }

export type StemLayout = 'split-cac' | 'waveform';
export type StemBackend = 'webgpu' | 'wasm';

export interface StemModelSpec {
  id: string;
  name: string;
  short: string;
  repo: string;
  revision: string;
  licence: string;
  /** May ship in a paid release. */
  commercial: boolean;
  /** One line for the offer. */
  note: string;
  /** Said beside the offer and the picker (6 stems: piano bleeds). */
  warning?: string;
  /** The model's stems, in its output order. */
  stems: StemName[];
  layout: StemLayout;
  /** split-cac: the pieces' manifest (inputs / outputs per piece, in run order). */
  manifest?: StemFile;
  /** Every model file, in run order. */
  files: StemFile[];
  /** split-cac on WebGPU: piece 0's input normalisation overflows in fp16 there, so these nodes run on the CPU. */
  cpuNodes?: string[];
  /** The second, optional download ("More instruments"). */
  optional?: boolean;
}

const MONTESLU_PIECES: Array<[number, string]> = [
  [28110, 'dc981b294afd05180890334d7a1994bd01af049c828634f5e9589c996baf9342'],
  [16551977, 'a3dbe16bfa14cc438bc9906e7949658794d4df8a23260815d4ebc7bbaa0e2cba'],
  [293808, '2dd65ec05b6d1b3eba32394b7c39c3081d7086542373a5011e01a414b4f8504e'],
  [6207085, 'e306ad650ef8f41c34f5c68b0f25fbc2d9944ebecc810dddfd00e96f9370bf82'],
  [21052, 'b67b06ddbacdce6d25f3c2390018b1c3cac81124e85e99abeaab223b7a5ea4bd'],
  [36401, '72800f59b4897a8d4768ae89a60712c24c3b35528348b6d3298a53cceed1df2a'],
  [293435, '3a13a16ba15a5a6b1afb99597ab4dc72333d002d634964017244b46fec14be7d'],
  [6205601, '745602c473ea3887e483fd2ced4ed191356294c9591d0cf595c9cf048c81ebf1'],
  [16789948, '9885a20cd42090b0033c2dc9be4f236b15e930896d0040caf684f0600402e0a0'],
  [12663168, 'c477f4ce84e2a936effab2a2c6260dba42a4062e02fddeb5f18afe1d2c757615'],
  [12656234, '56cc39a9bb812a5cd4daefe0a0d903dc7b752866d88694b4e7063dcf764a6060'],
  [12663251, '6bbb50b8afe31ea1dce6c9c2a5025d5dd35a05331841eeeade983ac443b21e09'],
  [12655956, '857583f4618a255f675cb146aef3276cf3aca682a0df34c05c2913ef6197ed50'],
  [22007636, 'a72774f04ee131596066c9768f430f8671e85635a44b56972310e368a3a5f71b'],
  [5149584, '90542229d4662c01e428282838d1b39b840dfce7f2081a4ac5157e7b6fd3b6e3'],
  [884773, 'e46d3a24d84627ed85b13328a07e2717a9ddfdfb7fe8e318739d08db022b97c3'],
  [441716, '1f4acdec85a277613cc7929d4f51601ce0a58bee5f77034f437192b7a8db0d66'],
  [184145, '396a306a69ab388eb4b6773106c10862bb3249808109144c2d8e9b49c1d28988'],
  [43437, '488d9cb2672cb1211a719a9170c76eef1cf1d278d832f8a756ce4cfa85836346'],
  [73203, '331d197571f917b752416592b3cc776ede027a87258adf461d65bfd5753db327'],
  [30725, 'b7acdfcda80ca8d1f23768af12ec8b93d5b46d5f3918629859380ee5d864777e'],
];

export const STEM_MODELS: readonly StemModelSpec[] = [
  {
    id: 'htdemucs',
    name: 'HT-Demucs (4 stems)',
    short: '4 stems',
    repo: 'monteslu/htdemucs-web-onnx',
    revision: 'a4a57cc0cf707e5b9a3e6ad3c2c4b21fcbe608c1',
    licence: 'MIT',
    commercial: true,
    note: 'Drums, bass, vocals and the rest. Meta\'s Demucs v4, on this device.',
    stems: ['drums', 'bass', 'other', 'vocals'],
    layout: 'split-cac',
    manifest: { path: 'htdemucs_split_manifest.json', bytes: 5318, sha256: '3b8f5089fa43b9483b816c837d69a955aeb8d0fb88bc8a0b57b778c1e9005768' },
    files: MONTESLU_PIECES.map(([bytes, sha256], i) => ({ path: `htdemucs_p${String(i).padStart(2, '0')}.onnx`, bytes, sha256 })),
    cpuNodes: ['/ReduceMean', '/Sub', '/Pow', '/ReduceMean_1', '/Clip', '/Sqrt', '/Add', '/Div', '/ReduceMean_2', '/Sub_1', '/Pow_1', '/ReduceMean_3', '/Clip_1', '/Sqrt_1', '/Add_1', '/Div_1'],
  },
  {
    id: 'htdemucs_6s',
    name: 'HT-Demucs (6 stems)',
    short: '6 stems',
    repo: 'StemSplitio/htdemucs-6s-onnx',
    revision: '49df9b6989cf2150840ea65b0bef77a2e471b678',
    licence: 'MIT',
    commercial: true,
    note: 'Adds guitar and piano. A second download.',
    warning: 'Guitar is usable; piano bleeds a lot (other instruments leak into it), and Other gets thinner.',
    stems: ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'],
    layout: 'waveform',
    files: [{ path: 'htdemucs_6s_fp16weights.onnx', bytes: 136428532, sha256: '7ce55792e2231c93fbf92de95f5fd5b3a5e6c89f7db690dfd693e8f1dce56869' }],
    optional: true,
  },
];

export const DEFAULT_STEM_MODEL_ID = STEM_MODELS[0].id;

export const stemModelById = (id: unknown): StemModelSpec => STEM_MODELS.find(m => m.id === id) ?? STEM_MODELS[0];

/** Every file a model fetches (the manifest first). */
export const stemModelFiles = (m: StemModelSpec): StemFile[] => [...(m.manifest ? [m.manifest] : []), ...m.files];

/** The whole download, in bytes. */
export const stemDownloadBytes = (m: StemModelSpec): number => stemModelFiles(m).reduce((s, f) => s + f.bytes, 0);

/** A file's pinned URL on Hugging Face. */
export const stemFileUrl = (m: StemModelSpec, f: StemFile): string => `https://huggingface.co/${m.repo}/resolve/${m.revision}/${f.path}`;

/** Where a local check (`?stemModel=local`) serves the files: `<base>stem-models/<repo>/<path>`. */
export const LOCAL_STEM_DIR = 'stem-models/';

/**
 * The Cache Storage the files are kept in: the same one Transformers.js keeps the depth and image models in, so they
 * live and go together.
 */
export const STEM_CACHE = 'transformers-cache';

/** "126 MB". */
export function formatStemBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

/** 7.8 s segments at 44.1 kHz with 25 % overlap: how many a song of `seconds` takes. */
export const segmentsFor = (seconds: number): number => Math.max(1, Math.ceil((seconds * 44100) / Math.floor(0.75 * 343980)));
