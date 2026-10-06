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
import { recipeRuns, recipeTokens } from '../../sceneBuilder/highlight';
import type { RecipeError } from '../../sceneBuilder/recipe';
import type { Vec3 } from '../../sceneBuilder/spec';
import { css, recipeColour, useRecipePalette } from './recipeColours';

/** A small square of a colour, inline. */
export function Swatch({ rgb }: { rgb: Vec3 }) {
  const tk = useTokens();
  return <span data-recipe-swatch aria-hidden style={{ display: 'inline-block', width: '0.8em', height: '0.8em', borderRadius: 3, margin: '0 3px -0.08em 1px', background: css(rgb), boxShadow: `inset 0 0 0 1px ${tk.border.strong}` }} />;
}

/** Read-only recipe text, coloured, with swatches and mistakes. */
export function RecipeCode({ text, style, errors }: { text: string; style?: CSSProperties; errors?: RecipeError[] }) {
  const pal = useRecipePalette();
  const tk = useTokens();
  const runs = useMemo(() => recipeRuns(text, recipeTokens(text, errors)), [text, errors]);
  return (
    <span data-recipe-code style={style}>
      {runs.map((r, i) => (
        <span key={i} data-recipe-token={r.kind === 'plain' ? undefined : r.kind} title={r.error}
          style={{ color: recipeColour(pal, r.kind), ...(r.error ? { textDecoration: `wavy underline ${tk.status.danger}`, textDecorationSkipInk: 'none' } : {}) }}>
          {r.swatch && <Swatch rgb={r.swatch} />}{r.text}
        </span>
      ))}
    </span>
  );
}
