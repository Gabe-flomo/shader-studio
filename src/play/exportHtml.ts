/**
 * exportHtml.ts — package a play file as one self-contained web page.
 *
 * The page holds the compiled fragment shader, the uniform values, the Play
 * record (controls, mappings, layers) and the standalone runtime
 * (runtime/play-runtime.js), so it runs anywhere HTML runs: a website, a
 * CodePen, a kiosk. No app code, no framework.
 *
 * What travels: the shader as compiled, every live float and colour uniform,
 * the panel, every mapping source except audio bands, all four layer kinds.
 * What doesn't: image and video inputs, audio nodes, feedback (previous
 * frame), echo, GPU particles and MIDI Input node outputs — those need the
 * studio's engines. `unsupportedFeatures` lists what a graph uses so the
 * export can say so.
 */
import runtimeSource from './runtime/play-runtime.js?raw';
import type { PlayRecord } from '../types/play';
import { PREVIEW_ASPECTS, type PreviewAspect } from '../utils/graphImportPlan';

export interface PlayHtmlInput {
  title: string;
  fragmentShader: string;
  /** Uniform name → current value (floats and [r, g, b]). */
  uniforms: Record<string, number | number[]>;
  /** `nodeId::paramKey` → uniform name, from the compile. */
  paramBindings: Record<string, string>;
  play: PlayRecord;
  aspect: PreviewAspect;
}

export interface GraphFeatures {
  textureUniforms: Record<string, string>;
  videoUniforms: Record<string, string>;
  audioUniforms: Record<string, string>;
  liveUniforms: Record<string, string>;
  isStateful: boolean;
  particleSystems: unknown[];
  usesEcho: boolean;
  play: PlayRecord;
}

/** Human-readable list of things in this graph the standalone page can't run. */
export function unsupportedFeatures(f: GraphFeatures): string[] {
  const out: string[] = [];
  if (Object.keys(f.textureUniforms).length) out.push('image inputs');
  if (Object.keys(f.videoUniforms).length) out.push('video inputs');
  if (Object.keys(f.audioUniforms).length) out.push('audio inputs');
  if (Object.keys(f.liveUniforms).length) out.push('MIDI Input node outputs');
  if (f.isStateful) out.push('the previous-frame feedback');
  if (f.usesEcho) out.push('echo snapshots');
  if (f.particleSystems.length) out.push('GPU particle systems');
  if (f.play.mappings.some(m => m.source.kind === 'audio')) out.push('audio-band mappings');
  return out;
}

/** JSON that is safe inside a <script> element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--').replace(/[\u2028\u2029]/g, c => c === '\u2028' ? '\\u2028' : '\\u2029');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

const CSS = `
html,body{margin:0;height:100%;background:#0d0d12;color:#e6e7ec;font:13px/1.4 system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
.ssp{display:flex;width:100%;height:100%;min-height:320px}
.ssp-stage{flex:1;min-width:0;position:relative;display:flex;align-items:center;justify-content:center;background:#000;overflow:hidden;touch-action:none}
.ssp-fit{position:relative;width:100%;height:100%}
.ssp-gl,.ssp-overlay{position:absolute;inset:0;width:100%;height:100%;display:block}
.ssp-overlay{pointer-events:none}
.ssp-panel{width:300px;flex-shrink:0;overflow:auto;background:#15161c;border-left:1px solid #26272f;padding:10px 12px 16px;box-sizing:border-box}
.ssp-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:2px 0 10px}
.ssp-head b{font-size:14px}
.ssp-tools{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.ssp-btn{border:1px solid #33353f;background:#1e2028;color:#e6e7ec;border-radius:7px;padding:5px 10px;font:12px system-ui,sans-serif;cursor:pointer}
.ssp-btn:hover{background:#262833}
.ssp-control{padding:9px 10px;margin-top:8px;border-radius:10px;background:#1b1c23;box-shadow:inset 0 0 0 1px #2a2c36}
.ssp-control.ssp-driven{box-shadow:inset 0 0 0 1px #4d7cff}
.ssp-row{display:flex;justify-content:space-between;gap:8px;margin-bottom:6px}
.ssp-label{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ssp-value{font-family:ui-monospace,Menlo,Consolas,monospace;color:#9a9da8;font-size:12px}
.ssp-range{width:100%;accent-color:#4d7cff}
.ssp-range:disabled{opacity:.7}
.ssp-colour{width:100%;height:30px;border:0;padding:0;background:none;border-radius:6px;cursor:pointer}
.ssp-empty{color:#9a9da8;margin-top:10px}
.ssp-error{position:absolute;inset:auto 12px 12px 12px;padding:10px 12px;border-radius:8px;background:#3a1216;color:#ffb4b4;font-size:12px}
@media (max-width:720px){.ssp{flex-direction:column}.ssp-stage{flex:0 0 56vh}.ssp-panel{width:auto;flex:1;border-left:0;border-top:1px solid #26272f}}
`;

/** The complete page. Pure: same input, same string. */
export function buildPlayHtml(input: PlayHtmlInput): string {
  const aspect = PREVIEW_ASPECTS.find(a => a.id === input.aspect);
  const bundle = {
    title: input.title,
    fragmentShader: input.fragmentShader,
    uniforms: input.uniforms,
    paramBindings: input.paramBindings,
    play: input.play,
    aspect: aspect ? { id: aspect.id, ratio: aspect.ratio } : { id: 'free', ratio: null },
    generatedBy: 'Shader Studio',
  };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(input.title)}</title>
<style>${CSS}</style>
</head>
<body>
<div id="play"></div>
<script>window.PLAY_BUNDLE = ${scriptJson(bundle)};</script>
<script>${runtimeSource.replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>
`;
}
