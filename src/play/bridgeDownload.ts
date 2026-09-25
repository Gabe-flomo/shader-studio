/**
 * bridgeDownload.ts — the OSC bridge as one self-contained file a browser user
 * can download and run with Node, no repo needed: tools/osc-bridge.mjs with
 * the decoder (src/lib/osc/decode.js) inlined in place of its import.
 */
import bridgeSource from '../../tools/osc-bridge.mjs?raw';
import decoderSource from '../lib/osc/decode.js?raw';

export const BRIDGE_FILE_NAME = 'shader-studio-osc-bridge.mjs';

export function buildStandaloneBridge(): string {
  const decoder = decoderSource.replace(/^export function /gm, 'function ');
  const body = bridgeSource.replace(/^import \{ decodeOsc, encodeOsc \} from '[^']+';\n/m, `// ── OSC decoder (inlined from src/lib/osc/decode.js) ──\n${decoder}\n`);
  return body
    .replace('npm run osc-bridge                         # UDP 9000 in, ws://127.0.0.1:9001 out', `node ${BRIDGE_FILE_NAME}               # UDP 9000 in, ws://127.0.0.1:9001 out`)
    .replace(/node tools\/osc-bridge\.mjs/g, `node ${BRIDGE_FILE_NAME}`);
}
