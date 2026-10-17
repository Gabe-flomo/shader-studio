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
];

export const thirdParty = (id: string): ThirdPartyNotice | undefined => THIRD_PARTY.find(t => t.id === id);

/** The licence file's URL under the app's base (works at / on desktop and /shader-studio/ on the web). */
export const licenseUrl = (t: ThirdPartyNotice): string => `${import.meta.env.BASE_URL}${t.licenseFile}`;
