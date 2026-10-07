/**
 * recipeColours.ts — the recipe language's colours, in the code editor's palette (glslSyntax C /
 * C_LIGHT), and the recipe as highlighted HTML for an editable overlay (CodeField `highlight`):
 * same characters, coloured; a colour's swatch as a bar under it, mistakes wavy-underlined.
 */
import { useThemeMode } from '../../theme/themeStore';
import { C, C_LIGHT } from '../glslSyntax';
import { recipeTokens, type RecipeKind, type WordKind } from '../../sceneBuilder/highlight';
import type { RecipeError } from '../../sceneBuilder/recipe';
import type { Vec3 } from '../../sceneBuilder/spec';

type Pal = typeof C;

/** A colour per kind, in the code editor's palette. */
export function recipeColour(pal: Pal, kind: RecipeKind): string {
  switch (kind) {
    case 'mode': return pal.keyword;
    case 'op': return pal.builtin;
    case 'shape': return pal.typeMat;
    case 'warp': return pal.preproc;
    case 'setting': return pal.typeVec2;
    case 'key': return pal.operator;
    case 'number': return pal.number;
    case 'vector': return pal.punct;
    case 'name': return pal.typeVec3;
    case 'colour': return pal.typeVec4;
    case 'punct': return pal.punct;
    case 'comment': return pal.comment;
    default: return pal.ident;
  }
}

export const useRecipePalette = (): Pal => (useThemeMode() === 'dark' ? C : C_LIGHT);

export const css = (rgb: Vec3) => `rgb(${rgb.map(v => Math.round(v * 255)).join(',')})`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The recipe as HTML for an editable overlay: same characters, coloured; swatches as a bar under the colour, mistakes wavy-underlined. */
export function recipeHtml(src: string, pal: Pal, danger: string, errors?: RecipeError[], wordKind?: WordKind): string {
  const toks = recipeTokens(src, errors, wordKind);
  // A vector's swatch spans its whole bracket.
  const spans: Array<{ from: number; to: number; rgb: Vec3 }> = [];
  toks.forEach((t, i) => {
    if (!t.swatch) return;
    if (t.kind === 'vector') { let j = i; while (j < toks.length && !(toks[j].kind === 'vector' && src[toks[j].from] === ')')) j++; spans.push({ from: t.from, to: toks[Math.min(j, toks.length - 1)].to, rgb: t.swatch }); }
    else spans.push({ from: t.from, to: t.to, rgb: t.swatch });
  });
  let at = 0;
  let html = '';
  for (const t of toks) {
    if (t.from > at) html += esc(src.slice(at, t.from));
    const sw = spans.find(s => t.from >= s.from && t.to <= s.to);
    const style = [`color:${recipeColour(pal, t.kind)}`, sw ? `box-shadow:inset 0 -3px 0 ${css(sw.rgb)}` : '', t.error ? `text-decoration:wavy underline ${danger};text-decoration-skip-ink:none` : ''].filter(Boolean).join(';');
    html += `<span style="${style}">${esc(src.slice(t.from, t.to))}</span>`;
    at = t.to;
  }
  return html + esc(src.slice(at));
}

