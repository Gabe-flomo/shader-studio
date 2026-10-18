/**
 * Third-party code the app ships under a licence that asks for a notice where it is used.
 * Each entry's licence text is served with the app at `licenseFile` (from public/), so the
 * notice links to the exact text. The Record dialog shows the ProRes encoder's (ExportModal).
 */
export interface ThirdPartyNotice {
  id: string;
  name: string;
  version: string;
  author: string;
  licence: string;
  source: string;
  /** Path under the app's base URL (public/licenses/...). */
  licenseFile: string;
  /** What it does here and how it's linked. */
  use: string;
}

export const THIRD_PARTY: readonly ThirdPartyNotice[] = [
  {
    id: 'prores-wasm-encoder',
    name: 'ProRes WASM Encoder',
    version: '1.0.3',
    author: 'Olivier Estevez',
    licence: 'LGPL-2.1-or-later',
    source: 'https://github.com/OlivierEstevez/ProRes-WASM-encoder',
    licenseFile: 'licenses/prores-wasm-encoder.txt',
    use: 'Encodes ProRes .mov files in the browser (Record › ProRes). Unmodified, from npm; loaded on demand as a separate file (prores-wasm chunk), so it can be replaced on its own. A port of FFmpeg’s prores_ks.',
  },
  {
    id: 'demucs',
    name: 'HT-Demucs (Hybrid Transformer Demucs v4)',
    version: 'htdemucs, htdemucs_6s',
    author: 'Meta Platforms, Inc. (Simon Rouard, Francisco Massa, Alexandre Défossez)',
    licence: 'MIT',
    source: 'https://github.com/facebookresearch/demucs',
    licenseFile: 'licenses/demucs.txt',
    use: 'Separates a song into stems on the Audio Source (Separate; docs/stems.md). Its weights are an opt-in download, never bundled: the ONNX exports monteslu/htdemucs-web-onnx (4 stems) and StemSplitio/htdemucs-6s-onnx (6 stems), both MIT, pinned on Hugging Face and run with ONNX Runtime Web on this device.',
  },
];

export const thirdParty = (id: string): ThirdPartyNotice | undefined => THIRD_PARTY.find(t => t.id === id);

/** The licence file's URL under the app's base (works at / on desktop and /shader-studio/ on the web). */
export const licenseUrl = (t: ThirdPartyNotice): string => `${import.meta.env.BASE_URL}${t.licenseFile}`;
