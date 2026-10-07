/**
 * RecipeChip — the recipe of a builder-made node, on its card (docs/scene-builder.md, "The Recipe
 * chip"; builders/recipe.ts):
 *
 *  - a Scene Group the 3D Scene Builder built: its recipe, and "edited since build" when its nodes
 *    were changed by hand; Copy and Open in Scene Builder;
 *  - a Grid Rules node: the rule ("Life B3/S23 · 240×135 · wrap"); Copy and Open editor;
 *  - an Agents group in rules mode: "4 rules · 2 states", its rules as sentences; Copy and Open rules.
 *
 * One or two lines, truncated; a click shows it whole with the words coloured. The Do… bar's "show
 * the recipe" opens it (builders/windows.ts). The same chip is on the phone's node page.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius, type Tokens } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { builderRecipeOf, highlightRecipe, type RecipeTokenKind } from '../../builders/recipe';
import { openAgentRulesWindow, openGridRulesEditor, useBuilderWindows } from '../../builders/windows';
import { copyRecipeOf } from '../../builders/open';
import { editSceneInBuilder } from '../../sceneBuilder/actions';
import { RecipeCode } from '../sceneBuilder/RecipeCode';
import { wordKindFor } from '../../lang/highlight';
import type { Dialect } from '../../lang/registry';

const tokenColour = (tk: Tokens, k: RecipeTokenKind): string | undefined => ({
  mode: tk.syntax.keyword, setting: tk.syntax.keyword, op: tk.syntax.fn, shape: tk.syntax.type, warp: tk.syntax.preproc,
  colour: tk.status.success, number: tk.syntax.number, key: tk.text.muted, name: tk.status.success, punct: tk.text.faint, plain: undefined,
} as Record<RecipeTokenKind, string | undefined>)[k];

/** The recipe with its words coloured. */
/** `scene`: a Scene Builder recipe, in the recipe editor's colours with swatches (RecipeCode); else numbers and names only. */
export function RecipeText({ text, scene = true, dialect, style }: { text: string; scene?: boolean; /** Another dialect of the language (grid, agents): coloured by its words. */ dialect?: Dialect; style?: CSSProperties }) {
  const tk = useTokens();
  const runs = useMemo(() => (scene || dialect ? [] : highlightRecipe(text, { words: false })), [text, scene, dialect]);
  if (dialect) return <RecipeCode text={text} errors={[]} style={style} wordKind={wordKindFor(dialect)} />;
  if (scene) return <RecipeCode text={text} errors={[]} style={style} />;
  return (
    <span style={style}>
      {runs.map((r, i) => <span key={i} data-recipe-token={r.kind === 'plain' ? undefined : r.kind} style={{ color: tokenColour(tk, r.kind) }}>{r.text}</span>)}
    </span>
  );
}

export function RecipeChip({ node, touch = false }: { node: GraphNode; touch?: boolean }) {
  const tk = useTokens();
  // Only a built scene needs the whole graph (to tell the user's edits apart).
  const graph = useNodeGraphStore(s => (node.type === 'sceneGroup' ? s.nodes : null));
  const recipe = useMemo(() => builderRecipeOf(node, graph ?? [node]), [node, graph]);
  // Open by a click, or by an ask newer than the last click ("show the recipe" in the Do… bar).
  const ask = useBuilderWindows(s => (s.recipe?.id === node.id ? s.recipe.n : 0));
  const [state, setState] = useState({ open: false, ask: 0 });
  const open = ask > state.ask ? true : state.open;
  const setOpen = (f: (o: boolean) => boolean) => setState({ open: f(open), ask });
  if (!recipe) return null;

  const title = recipe.kind === 'scene' ? 'Recipe' : recipe.kind === 'grid' ? 'Rule' : 'Rules';
  const openLabel = recipe.kind === 'scene' ? 'Open in Scene Builder' : recipe.kind === 'grid' ? 'Open editor' : 'Open rules';
  const openIt = () => {
    if (recipe.kind === 'scene') editSceneInBuilder(node.id);
    else if (recipe.kind === 'grid') openGridRulesEditor(node.id);
    else openAgentRulesWindow(node.id);
  };
  const mono = `${touch ? 12 : 11}px/1.5 ${fontFamily.mono}`;
  return (
    <div data-recipe-chip={recipe.kind} data-open={open || undefined}
      onMouseDown={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
      style={{ margin: '6px 12px 8px', borderRadius: radius.md, background: tk.bg.field, boxShadow: `inset 0 0 0 1px ${open ? alpha(tk.accent.base, 0.5) : tk.border.subtle}`, overflow: 'hidden', cursor: 'default' }}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        title={open ? `Fold the ${title.toLowerCase()}` : `Show the whole ${title.toLowerCase()}`}
        style={{ display: 'flex', gap: 8, alignItems: 'flex-start', width: '100%', padding: touch ? '10px 10px' : '6px 8px', border: 0, background: 'transparent', color: tk.text.primary, cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, font: `650 10px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: tk.accent.base, paddingTop: 2 }}>
          <Icon name={recipe.kind === 'scene' ? 'cube' : recipe.kind === 'grid' ? 'grid' : 'swarm'} size={12} />{title}
        </span>
        {!open ? (
          <RecipeText text={recipe.text} scene={recipe.kind === 'scene'} dialect={recipe.kind === 'grid' ? 'grid' : undefined} style={{
            flex: 1, minWidth: 0, font: mono, color: tk.text.secondary, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflowWrap: 'anywhere',
          }} />
        ) : <span style={{ flex: 1, font: `12px ${fontFamily.ui}`, color: tk.text.muted, paddingTop: 1 }}>{recipe.kind === 'agents' ? recipe.text : recipe.kind === 'scene' ? 'From the 3D Scene Builder' : recipe.summary}</span>}
        <Icon name={open ? 'chevU' : 'chevD'} size={13} style={{ color: tk.text.faint, flexShrink: 0, marginTop: 2 }} />
      </button>
      {recipe.kind === 'scene' && recipe.edited && (
        <div data-recipe-edited title="Nodes of this scene were changed by hand after it was built. Open in Scene Builder keeps what a rebuild can keep, and says what it can't."
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: touch ? '0 10px 8px' : '0 8px 6px', font: `500 10.5px ${fontFamily.ui}`, color: tk.status.warningText }}>
          <Icon name="edit" size={11} />edited since build
        </div>
      )}
      {open && (
        <div style={{ borderTop: `1px solid ${tk.border.subtle}`, padding: touch ? 10 : 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <pre data-recipe-full style={{ margin: 0, maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', font: mono, color: tk.text.primary, userSelect: 'text', cursor: 'text' }}>
            <RecipeText text={recipe.lines} scene={recipe.kind === 'scene'} dialect={recipe.kind === 'grid' ? 'grid' : recipe.kind === 'agents' ? 'agents' : undefined} />
          </pre>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Button size="sm" icon="copy" onClick={() => copyRecipeOf(node.id)} data-recipe-copy>Copy</Button>
            <Button size="sm" variant="primary" icon="popout" onClick={openIt} data-recipe-open>{openLabel}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
