/**
 * A node speaks in its own labels. Its description, brief and setting hints name an input or a
 * setting the way the card shows it (Threshold, Value), never by its code key (edge, x) or a GLSL
 * argument name: Step's card used to read "step(edge, x) — 0 if x < edge", and nothing on the
 * node is called edge or x. A formula is fine when it is written in labels: `step(Threshold, Value)`.
 *
 * What counts as naming a key (each only when the key is not also the label):
 *  - a code-like key anywhere (snake_case, camelCase, a letter and a digit: lens_center, cosTheta, r1);
 *  - a key of one or two letters as a word (t, x, k; `a` only where it is not the article);
 *  - any key inside a call (`mix(a, b, t)`, `exp(input × scale)`) or next to an operator (`v × gain`).
 *
 * The node card's meaning line (glslPatterns' plain meaning of the GLSL built-in the node is) is
 * checked the same way: rewritten into labels, or not shown.
 */
import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { NODE_REGISTRY } from '..';
import type { GraphNode, NodeDefinition } from '../../../types/nodeGraph';
import { functionInfo } from '../../../lib/glslPatterns/functions';
import { nodeCardModel } from '../../../components/explain/functionCard/nodeCard';

/** Words that are GLSL itself, not a key: a node may say `mat2` or `vec3`. */
const GLSL_WORDS = new Set(['vec2', 'vec3', 'vec4', 'mat2', 'mat3', 'mat4', 'ivec2', 'ivec3', 'ivec4', 'float', 'int']);

const textsOf = (def: NodeDefinition): Array<[string, string]> => {
  const out: Array<[string, string]> = [];
  const d = def.description as string | string[] | undefined;
  if (d) out.push(['description', Array.isArray(d) ? d.join(' ') : d]);
  if (def.brief) out.push(['brief', def.brief.summary], ...def.brief.start.map((s, i) => [`brief.start[${i}]`, s] as [string, string]));
  for (const [k, pd] of Object.entries(def.paramDefs ?? {})) {
    if (pd.hint) out.push([`${k}.hint`, pd.hint]);
    if (pd.help) out.push([`${k}.help`, pd.help]);
  }
  return out;
};

/** Each key of the node (inputs, outputs, settings) with the labels it shows as. */
function keysAndLabels(def: NodeDefinition): { keys: Map<string, string>; labelWords: Set<string> } {
  const keys = new Map<string, string>();
  const labels: string[] = [];
  const add = (k: string, label: string | undefined) => { const l = label ?? k; labels.push(l); if (!keys.has(k)) keys.set(k, l); };
  for (const [k, s] of Object.entries(def.inputs ?? {})) add(k, s.label);
  for (const [k, s] of Object.entries(def.outputs ?? {})) add(k, s.label);
  for (const [k, pd] of Object.entries(def.paramDefs ?? {})) add(k, pd.label);
  return { keys, labelWords: new Set(labels.flatMap(l => [l, ...l.split(/[^\w]+/)]).filter(Boolean)) };
}

/** Short keys that are also English words: "up", "in"… are prose unless used in a formula. */
const ENGLISH_SHORT = new Set(['i', 'up', 'in', 'on', 'to', 'at', 'by', 'of', 'or', 'it', 'is', 'no', 'do', 'go', 'so', 'as', 'be', 'if', 'we', 'me', 'my', 'id', 'ok']);

const codeLike = (k: string) => /_/.test(k) || /[a-z][A-Z]/.test(k) || /^[A-Za-z]+\d+$/.test(k);

/** The key names a text uses that the node doesn't show. */
export function keyMentions(def: NodeDefinition, text: string): string[] {
  const { keys, labelWords } = keysAndLabels(def);
  const found = new Set<string>();
  // Contractions (it's) and markdown bold (**slot mask**) are not words or operators
  const t = text.replace(/[’'][a-z]+\b/g, '').replace(/\*\*/g, '');
  for (const [key] of keys) {
    if (labelWords.has(key) || GLSL_WORDS.has(key)) continue;
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const word = new RegExp(`(?<![\\w.@])${esc}(?![\\w])`, 'g');
    for (const m of t.matchAll(word)) {
      const at = m.index!;
      const before = t.slice(Math.max(0, at - 3), at);
      const after = t.slice(at + key.length, at + key.length + 4);
      if (key === 'a' && !/^\s*(?:is\b|=|[),.;:+×*/]|$)/.test(after)) continue;
      if (after.startsWith('(')) continue; // a function's name (rotate(p, …)), not the key
      const inCall = (() => {
        // inside the parentheses of a call: an identifier then ( before, ) after, at depth 0
        let depth = 0;
        for (let i = at - 1; i >= 0; i--) {
          const c = t[i];
          if (c === ')') depth++;
          else if (c === '(') { if (depth === 0) return /[A-Za-z_]\w*$/.test(t.slice(0, i)); depth--; }
        }
        return false;
      })();
      const byOperator = /[×*/^·=<>]\s*$/.test(before) || /^\s*[×*/^·=<>²]/.test(after) || /\s[+\-−]\s$/.test(before) || /^\s[+\-−]\s/.test(after);
      const label = keys.get(key)!;
      // An axis named by its letter (along w, at w = 0) when the setting is that axis (W, W (slice))
      const axis = /^[xyzw]$/.test(key) && label[0] === key.toUpperCase();
      if (inCall || (byOperator && !axis)) { found.add(key); continue; }
      // In prose, a key that is its label in lower case (value / Value) or an axis reads fine
      if (key.toLowerCase() === label.toLowerCase() || axis) continue;
      if (codeLike(key) || (key.length <= 2 && !ENGLISH_SHORT.has(key))) found.add(key);
    }
  }
  return [...found];
}

const node = (type: string): GraphNode => ({ id: 'n1', type, position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: {} } as unknown as GraphNode);

describe('node wording', () => {
  it('descriptions and hints name inputs and settings by their labels', () => {
    const bad: string[] = [];
    for (const [type, def] of Object.entries(NODE_REGISTRY)) {
      for (const [where, text] of textsOf(def)) {
        const keys = keyMentions(def, text);
        if (keys.length) bad.push(`${type} ${where}: ${keys.map(k => `${k} (${keysAndLabels(def).keys.get(k)})`).join(', ')} in "${text}"`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the card’s meaning of a node’s GLSL function uses the node’s labels, or is left out', () => {
    const bad: string[] = [];
    for (const [type, def] of Object.entries(NODE_REGISTRY)) {
      const info = functionInfo(type);
      if (!info || info.kind !== 'builtin') continue;
      const m = nodeCardModel(node(type), def);
      if (!m.meaning) continue;
      const { labelWords } = keysAndLabels(def);
      const argNames = new Set(info.overloads.flatMap(o => o.params.map(p => p.name)));
      for (const name of argNames) {
        if (labelWords.has(name)) continue;
        const re = name === 'a' ? /(?<![\w.])a(?=\s*(?:is\b|=|[),.;:]|$))/ : new RegExp(`(?<![\\w.])${name}(?!\\w)`);
        if (re.test(m.meaning)) bad.push(`${type}: "${m.meaning}" names ${name}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('Step reads in its own labels', () => {
    const def = NODE_REGISTRY.step;
    const m = nodeCardModel(node('step'), def);
    expect(m.meaning).toBe('Gives a hard switch: 0 while Value is below Threshold, 1 from Threshold on.');
    expect(m.meaningOf).toBe('step(Threshold, Value)');
    expect(m.description).not.toMatch(/\bedge\b|\bx\b/);
  });

  it('a node that is more than its function shows no meaning line (Sin is Amp × sin(Input × Freq))', () => {
    expect(nodeCardModel(node('sin'), NODE_REGISTRY.sin).meaning).toBeUndefined();
    expect(nodeCardModel(node('sin'), NODE_REGISTRY.sin).fnName).toBe('sin');
  });

  it('the check catches the old wording', () => {
    const step = NODE_REGISTRY.step;
    expect(keyMentions(step, 'step(edge, x) — 0 if x < edge, else 1').sort()).toEqual(['edge', 'x']);
    expect(keyMentions(NODE_REGISTRY.mix, 'Linear interpolation: mix(a, b, t). A straight blend.').sort()).toEqual(['a', 'b', 't']);
    expect(keyMentions(NODE_REGISTRY.mix, 'A straight blend from A to B by Blend: mix(A, B, Blend).')).toEqual([]);
  });
});
