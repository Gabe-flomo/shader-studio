/**
 * SceneBuilderModal — the 3D Scene Builder (docs/scene-builder-3d.md), on the Agent Builder's
 * studio shell (components/builders/studio/StudioShell.tsx):
 *
 *   ┌ Scene builder › 3D scene · name ──── undo · redo · Under the hood · Describe · Surprise · Open as nodes · Done ┐
 *   │ Sections, with a  │        the scene, live and big: drag to orbit, scroll to     │ the section's    │
 *   │ one-line summary  │        zoom, click a shape, drag its gizmo                   │ settings         │
 *   ├───────────────────┴───────────────────────────────────────────────────────────────┴──────────────────┤
 *   │ presets, as pictures · Surprise me                                                                   │
 *   └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * The sections say what you can build (sections.ts): Mode, Shapes, Combine, Warps, Light & colour,
 * Camera, Output. Under the hood shows the recipe (with hover help) in place of the settings;
 * Describe reads the 3D graph on the canvas. Done builds the scene (or rebuilds the one it was
 * opened on, keeping edits made on its nodes), closes and frames it; Open as nodes does the same
 * and opens its Scene Group, to see the shapes as nodes.
 */
import { useEffect, useState } from 'react';
import { useSceneBuilder } from '../../sceneBuilder/store';
import { buildFromBuilder, describeIntoBuilder } from '../../sceneBuilder/actions';
import { allShapes } from '../../sceneBuilder/spec';
import { parseRecipe, printRecipe } from '../../sceneBuilder/recipe';
import { SCENE_TEMPLATES } from '../../sceneBuilder/templates';
import { SCENE_SECTIONS, sectionOfTab, sectionSummary, type SceneSection } from '../../sceneBuilder/sections';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { IconButton } from '../ui/Button';
import { Menu } from '../ui/Menu';
import type { IconName } from '../ui/iconPaths';
import { useTokens } from '../../theme/themeStore';
import { SurpriseBar } from '../surprise/SurpriseBar';
import { newSeed } from '../../lib/surprise';
import { surpriseSceneAction, useSceneSurprise } from './surpriseActions';
import { SceneCrumb } from '../builders/SceneCrumb';
import { BuilderHelpContext } from '../builders/BuilderHelp';
import { PresetCard, StripRow, StudioLabel, StudioNavItem, StudioShell } from '../builders/studio/StudioShell';
import { PresetsSummary, UserPresets } from '../builders/UserPresets';
import { SCENE_STRIP_KEYS } from '../../builders/stripPresets';
import { DescribeTab, RecipeTab, preferRecipeAsText } from './tabs';
import { SectionHead, SectionPanel } from './sectionPanels';
import { SceneViewport } from './SceneViewport';
import { snapshotSpec, useSpecThumbs } from './specThumbs';
import { closeBuilding, doneBuilding, type BuildingBuilder } from '../../builders/finish';
import { clearDraft, hasUnbuiltEdits } from '../../builders/drafts';
import { focusRecipeEditor, useBuilderRecipeRequest } from '../../builders/windows';
import { scene3dBuildIds } from '../../builders/finishScenes';

const MODE_LABEL = { surface: 'Surface', volumetric: 'Volumetric glow', glass: 'Glass', gi: 'GI lit' } as const;

/** Sections a shape picked in the viewport can be edited in; from any other, a pick goes to Shapes. */
const SHAPE_SECTIONS: Array<SceneSection | 'describe'> = ['shapes', 'combine', 'warps', 'light'];

/** Whether the form has to be built: not built yet (or its build is gone), or changed since. Nothing to build without shapes. */
function needsBuild(): boolean {
  const sb = useSceneBuilder.getState();
  if (!allShapes(sb.spec).length) return false;
  const built = !!sb.targetSceneId && useNodeGraphStore.getState().nodes.some(n => n.id === sb.targetSceneId);
  return !built || sb.dirty;
}

/** The 3D builder as builders/finish.ts drives it: Done builds first, ✕ and Esc ask about unbuilt edits. */
export const scene3dBuilder: BuildingBuilder = {
  label: '3D scene',
  needsBuild,
  unbuiltEdits: () => hasUnbuiltEdits(useSceneBuilder.getState()) && needsBuild(),
  build: () => buildFromBuilder(false),
  close: () => useSceneBuilder.getState().close(),
  ids: () => scene3dBuildIds(useSceneBuilder.getState().targetSceneId),
  discard: () => clearDraft('3d', useSceneBuilder.getState().targetSceneId),
};

/** Done: build (or rebuild) if needed, close, and frame the scene on the graph. A failed build stays open. */
export async function doneAction(): Promise<void> {
  await doneBuilding(scene3dBuilder);
}

/** Open as nodes: build if needed, close, and open the Scene Group (its shapes, combines and warps as nodes). */
export async function openAsNodesAction(): Promise<void> {
  if (!(await doneBuilding({ ...scene3dBuilder, ids: () => [] }))) return;
  const id = useSceneBuilder.getState().targetSceneId;
  if (id && useNodeGraphStore.getState().nodes.some(n => n.id === id)) {
    const st = useNodeGraphStore.getState();
    if (st.activeGroupPath.length) st.exitToRoot();
    st.enterGroup(id);
  }
}

/** The built-in presets the strip keeps (builders/stripPresets.ts; the rest of its room is for yours). */
export const STRIP_TEMPLATE_KEYS = SCENE_STRIP_KEYS;

function PresetsStrip() {
  const replace = useSceneBuilder(s => s.replace);
  const select = useSceneBuilder(s => s.select);
  const seed = useSceneSurprise(s => s.seed);
  const busy = useSceneSurprise(s => s.busy);
  const builtIns = STRIP_TEMPLATE_KEYS.map(k => SCENE_TEMPLATES.find(t => t.key === k)).filter((t): t is (typeof SCENE_TEMPLATES)[number] => !!t && !t.hidden);
  const thumbs = useSpecThumbs(builtIns.map(t => ({ key: `template:${t.key}`, spec: () => parseRecipe(t.recipe).spec })));
  const load = (recipe: string) => { const s = parseRecipe(recipe).spec; replace(s); select(s.root.children[0]?.id ?? null); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ flex: 1 }}><StudioLabel meta="click to start from one · undo takes it back · yours are saved here, not as graphs">Presets</StudioLabel></span>
        <SurpriseBar seed={seed} busy={busy} onSurprise={s => void surpriseSceneAction(s)}
          title="A whole random scene: 2–6 shapes, combines, sometimes modifiers, a look, colours and a camera (one undo step). The same seed makes the same scene." />
      </span>
      <StripRow attrs={{ 'data-scene-presets': '' }}>
        {builtIns.map(t => (
          <PresetCard key={t.key} id={t.key} label={t.label} hint={t.blurb} src={thumbs[`template:${t.key}`]} onClick={() => load(t.recipe)} />
        ))}
        <UserPresets kind="3d" getRecipe={() => printRecipe(useSceneBuilder.getState().spec)} onLoad={load}
          fallbackThumb={() => snapshotSpec(useSceneBuilder.getState().spec)} />
      </StripRow>
    </div>
  );
}

export function SceneBuilderModal() {
  const tk = useTokens();
  const tab = useSceneBuilder(s => s.tab);
  const setTab = useSceneBuilder(s => s.setTab);
  const spec = useSceneBuilder(s => s.spec);
  const undo = useSceneBuilder(s => s.undo);
  const redo = useSceneBuilder(s => s.redo);
  const canUndo = useSceneBuilder(s => s.past.length > 0);
  const canRedo = useSceneBuilder(s => s.future.length > 0);
  const dirty = useSceneBuilder(s => s.dirty);
  const targetSceneId = useSceneBuilder(s => s.targetSceneId);
  const targetExists = useNodeGraphStore(s => !!targetSceneId && s.nodes.some(n => n.id === targetSceneId));
  const editing = !!targetSceneId && targetExists;
  const [hood, setHood] = useState(() => tab === 'recipe');
  const [more, setMore] = useState<{ x: number; y: number } | null>(null);
  const section = sectionOfTab(tab);
  const shapes = allShapes(spec).length;
  // ⌘⇧D: Under the hood (the recipe), its text focused.
  useBuilderRecipeRequest(() => { preferRecipeAsText(); setHood(true); focusRecipeEditor('[data-inspector="recipe"] textarea'); });

  // ⌘Z / ⌘⇧Z undo the form, not the graph, while the builder is open (text fields keep their own).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text'))) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) useSceneBuilder.getState().redo(); else useSceneBuilder.getState().undo();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const pick = (id: SceneSection | 'describe') => { setHood(false); setTab(id); };

  const nav = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '14px 10px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <StudioLabel meta="what you can build">Sections</StudioLabel>
        {SCENE_SECTIONS.map(x => (
          <StudioNavItem key={x.id} id={x.id} icon={x.icon as IconName} label={x.label} hint={x.line} summary={sectionSummary(spec, x.id)}
            selected={!hood && section === x.id} onClick={() => pick(x.id)} />
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <StudioLabel>From the graph</StudioLabel>
        <StudioNavItem id="describe" icon="search" label="Describe" hint="Read the 3D graph on the canvas back into the builder" summary="read a 3D graph into words"
          selected={!hood && section === 'describe'} onClick={() => pick('describe')} />
      </div>
    </div>
  );

  const inspector = (
    <BuilderHelpContext.Provider value="scene-builder">
      <div data-inspector={hood ? 'recipe' : section} data-scene-section={hood ? 'recipe' : section} style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: hood || section === 'describe' ? 0 : 14 }}>
        {hood
          ? <><div style={{ padding: '14px 14px 0' }}><SectionHead id="recipe" title="Under the hood" line="The whole scene as a recipe: one line per part. Rest the pointer on a word for its help; edit it and the scene follows." /></div><RecipeTab /></>
          : section === 'describe' ? <DescribeTab /> : <SectionPanel id={section} />}
      </div>
    </BuilderHelpContext.Provider>
  );

  return (
    <StudioShell prefsKey="scene-builder-3d" icon="cube" iconColor={tk.kind.fn}
      title={editing ? 'Your 3D scene' : 'A new 3D scene'} crumb={<SceneCrumb kind="3d" />}
      kind={`${shapes} shape${shapes === 1 ? '' : 's'} · ${MODE_LABEL[spec.look.mode]} · ${!editing ? 'not built yet: Done builds it' : dirty ? 'changed: Done rebuilds it' : 'built'}`}
      onClose={() => void closeBuilding(scene3dBuilder)}
      onEscape={() => { if (hood) { setHood(false); return true; } return false; }}
      actions={<>
        <IconButton icon="undo" size="sm" label="Undo" shortcut="cmd+z" disabled={!canUndo} onClick={undo} />
        <IconButton icon="redo" size="sm" label="Redo" shortcut="cmd+shift+z" disabled={!canRedo} onClick={redo} />
        <IconButton icon="code" size="sm" active={hood} data-hood-toggle label={hood ? 'Hide Under the hood' : 'Under the hood: the scene as a recipe, with help on every word'} onClick={() => setHood(!hood)} />
        <IconButton icon="search" size="sm" data-describe label="Describe the 3D graph on the canvas" onClick={() => { setHood(false); describeIntoBuilder(); }} />
        <IconButton icon="dice" size="sm" data-surprise-top label="Surprise me: a whole random scene (one undo step)" onClick={() => void surpriseSceneAction(newSeed())} />
        <IconButton icon="fn" size="sm" data-open-as-nodes disabled={!shapes} label="Open as nodes: build it and open its Scene Group (every node with a note)" onClick={() => void openAsNodesAction()} />
        <IconButton icon="more" size="sm" data-build-menu label="More: build now, or build a new copy" onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMore({ x: Math.max(8, r.right - 260), y: r.bottom + 4 }); }} />
        {more && <Menu x={more.x} y={more.y} onClose={() => setMore(null)} items={[
          { label: editing ? 'Rebuild now' : 'Build now', icon: 'rebuild', hint: editing ? 'Replaces the scene it was built as, keeping settings you changed on its nodes; the builder stays open' : 'Adds the graph to the canvas and shows it on the Output; the builder stays open', disabled: !shapes, onSelect: () => void buildFromBuilder(false) },
          ...(editing ? [{ label: 'Build as a new copy', icon: 'copy' as IconName, hint: 'Leave the built scene as it is and build this one beside it', onSelect: () => void buildFromBuilder(true) }] : []),
        ]} />}
      </>}
      primary={{ label: 'Done', onClick: () => void doneAction(), title: editing ? 'Done: rebuild the scene with your edits, then close and show it on the graph' : 'Done: build the scene into the graph, then close and show it' }}
      nav={nav} phoneSettingsTitle={hood ? 'Under the hood' : undefined} inspector={inspector} inspectorWidth={hood ? 480 : 400} navWidth={236} presets={<PresetsStrip />}
      presetsSummary={<PresetsSummary kind="3d" builtIns={STRIP_TEMPLATE_KEYS.map(k => SCENE_TEMPLATES.find(t => t.key === k)?.label ?? k)} />}>
      <SceneViewport onPicked={() => { if (!SHAPE_SECTIONS.includes(section)) pick('shapes'); }} />
    </StudioShell>
  );
}

/** Mounted once beside the canvas: the builder window while it is open. */
export function SceneBuilderHost() {
  const open = useSceneBuilder(s => s.open);
  return open ? <SceneBuilderModal /> : null;
}
