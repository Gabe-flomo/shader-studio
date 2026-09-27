/**
 * codePick.ts — what the Add code chooser works out without drawing: the
 * preview a picked piece of GLSL starts with, and a Functions-library preset
 * written out as a function a code block can hold.
 */
import type { CustomFnPreset } from '../types/customFnPreset';
import type { CodePreview } from '../types/presentation';
import { analyzeSnippet, type SnippetContext } from './snippetHarness';

/** The preview a picked piece of GLSL starts with (or none when there's nothing to draw). */
export function initialPreview(code: string, ctx: SnippetContext = {}): CodePreview | undefined {
  try {
    const a = analyzeSnippet(code, ctx);
    if (a.kind === 'empty' || !a.options.length) return undefined;
    return { mode: a.defaultMode, ...(a.defaultShow ? { show: a.defaultShow } : {}) };
  } catch { return undefined; }
}

/** The preview after the code changes: the author's choices while what they show is still there, else the new best guess. */
export function nextPreview(prev: CodePreview | undefined, code: string, ctx: SnippetContext = {}): CodePreview | undefined {
  const next = initialPreview(code, ctx);
  if (!prev || !next || !prev.show) return next;
  try { return analyzeSnippet(code, ctx).options.some(o => o.id === prev.show) ? prev : next; } catch { return next; }
}

const safeName = (label: string) => label.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1') || 'f';

/** A library preset as a function: its helpers, then (unless it's a plain call of one) a function wrapping its body. */
export function presetFunctionCode(p: CustomFnPreset): { code: string; name: string; signature: string } {
  const plainCall = /^\s*(\w+)\s*\(([^()]*)\)\s*;?\s*$/.exec(p.body);
  const helpers = p.glslFunctions.trim();
  if (plainCall && helpers && new RegExp(`\\b${plainCall[1]}\\s*\\(`).test(helpers)) {
    const sig = new RegExp(`(\\w+)\\s+${plainCall[1]}\\s*\\(([^)]*)\\)`).exec(helpers);
    return { code: helpers, name: plainCall[1], signature: sig ? `${sig[1]} ${plainCall[1]}(${sig[2].replace(/\s+/g, ' ').trim()})` : `${p.outputType} ${plainCall[1]}(…)` };
  }
  const name = safeName(p.label);
  const params = p.inputs.map(i => `${i.type} ${i.name}`).join(', ');
  const body = /\breturn\b/.test(p.body) ? p.body.trim().split('\n').map(l => `  ${l}`).join('\n') : `  return ${p.body.trim().replace(/;\s*$/, '')};`;
  const fn = `${p.outputType} ${name}(${params}) {\n${body}\n}`;
  return { code: helpers ? `${helpers}\n\n${fn}` : fn, name, signature: `${p.outputType} ${name}(${params})` };
}
