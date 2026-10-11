/**
 * RecipeCode — the Scene Builder's recipe language drawn in the code editor's colours (light and
 * dark: glslSyntax C / C_LIGHT), from sceneBuilder/highlight.ts:
 *
 *  - `RecipeCode`: read-only, with a small swatch before a colour (`color=(r,g,b)`, a hex, a
 *    colour name) and mistakes underlined (the message, with its "did you mean", on hover). The
 *    Recipe tab's rows, the Scene Group card's Recipe chip, "Show the words" and the Do… bar use it.
 *  - `recipeHtml`: the same for the editable text (CodeField's overlay): the swatch is a bar under
 *    the colour instead, so the overlay keeps the textarea's character widths.
 */
import { useMemo, type CSSProperties } from 'react';
import { useTokens } from '../../theme/themeStore';
import { recipeRuns, recipeTokens, type WordKind } from '../../sceneBuilder/highlight';
import type { RecipeError } from '../../sceneBuilder/recipe';
import type { Vec3 } from '../../sceneBuilder/spec';
import { css, recipeColour, useRecipePalette } from './recipeColours';
import { useWordHelp } from '../builders/WordHelp';
import type { Dialect } from '../../lang/registry';

/** A small square of a colour, inline. */
export function Swatch({ rgb }: { rgb: Vec3 }) {
  const tk = useTokens();
  return <span data-recipe-swatch aria-hidden style={{ display: 'inline-block', width: '0.8em', height: '0.8em', borderRadius: 3, margin: '0 3px -0.08em 1px', background: css(rgb), boxShadow: `inset 0 0 0 1px ${tk.border.strong}` }} />;
}

/** Word help on a read-only recipe (WordHelp.tsx): which dialect, the text round it, and how to put a picked word in. */
export interface RecipeCodeHelp {
  dialect: Dialect;
  /** Text before this piece (a row's earlier lines), so a setting finds its head. */
  before?: string;
  /** Put `next` in place of text[from, to) (offsets into this piece). */
  onReplace?: (from: number, to: number, next: string) => void;
}

/** The character under the pointer inside a piece of RecipeCode (its runs carry their start). */
function offsetAtPoint(x: number, y: number, fallback: number): number {
  const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null; caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  const pos = doc.caretPositionFromPoint?.(x, y);
  const node = pos ? pos.offsetNode : doc.caretRangeFromPoint?.(x, y)?.startContainer;
  const off = pos ? pos.offset : doc.caretRangeFromPoint?.(x, y)?.startOffset ?? 0;
  const run = (node?.nodeType === 3 ? node.parentElement : node as HTMLElement | null)?.closest?.('[data-run-start]') as HTMLElement | null;
  if (!run || node?.nodeType !== 3) return fallback;
  return Number(run.dataset.runStart) + off;
}

/** Read-only recipe text, coloured, with swatches and mistakes; with `help`, a word's help opens when the pointer rests on it. */
export function RecipeCode({ text, style, errors, wordKind, help }: { text: string; style?: CSSProperties; errors?: RecipeError[]; /** Another dialect's words (lang/highlight.ts wordKindFor). */ wordKind?: WordKind; help?: RecipeCodeHelp }) {
  const pal = useRecipePalette();
  const tk = useTokens();
  const runs = useMemo(() => recipeRuns(text, recipeTokens(text, errors, wordKind)), [text, errors, wordKind]);
  const before = help?.before ? `${help.before}\n` : '';
  const wh = useWordHelp({
    dialect: help?.dialect ?? 'scene',
    onReplace: help?.onReplace ? (from, to, next) => help.onReplace!(from - before.length, to - before.length, next) : undefined,
  });
  const starts = useMemo(() => runs.reduce<number[]>((acc, _r, i) => [...acc, i ? acc[i - 1] + runs[i - 1].text.length : 0], []), [runs]);
  return (
    <span data-recipe-code style={style} onMouseLeave={help ? () => wh.leave() : undefined}>
      {runs.map((r, i) => (
        <span key={i} data-recipe-token={r.kind === 'plain' ? undefined : r.kind} title={help ? undefined : r.error} data-run-start={starts[i]}
          onMouseMove={help ? e => {
            const span = e.currentTarget;
            const off = offsetAtPoint(e.clientX, e.clientY, starts[i]);
            wh.hover(before + text, before.length + off, () => { const b = span.getBoundingClientRect(); return { left: b.left, top: b.top, bottom: b.bottom }; });
          } : undefined}
          style={{ color: recipeColour(pal, r.kind), ...(r.error ? { textDecoration: `wavy underline ${tk.status.danger}`, textDecorationSkipInk: 'none' } : {}) }}>
          {r.swatch && <Swatch rgb={r.swatch} />}{r.text}
        </span>
      ))}
      {help && wh.popover}
    </span>
  );
}
