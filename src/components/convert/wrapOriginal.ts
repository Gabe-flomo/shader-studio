/**
 * The pasted shader the way the render pair needs it: read as ours, with our uniforms declared once.
 * `toSourceLine` maps a compile error's line back to the paste. Shared by the Convert page's check and
 * Guided Convert's (docs/guided-convert.md).
 */
import { normaliseHostShader } from '../../glslToGraph';

export function wrapOriginal(source: string): { code: string; toSourceLine: (line: number) => number } {
  const { code: body, toSourceLine } = normaliseHostShader(source);
  const declared = (n: string) => new RegExp(`uniform\\s+\\w+\\s+${n}\\b`).test(body);
  const head = ['precision highp float;', 'varying vec2 vUv;', ...(declared('u_resolution') ? [] : ['uniform vec2 u_resolution;']), ...(declared('u_time') ? [] : ['uniform float u_time;']), ...(declared('u_mouse') ? [] : ['uniform vec2 u_mouse;'])];
  return { code: `${head.join('\n')}\n${body}`, toSourceLine: (line: number) => toSourceLine(Math.max(1, line - head.length)) };
}
