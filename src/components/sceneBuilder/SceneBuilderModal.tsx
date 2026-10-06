/**
 * SceneBuilderModal — the 3D Scene Builder window (docs/scene-builder.md).
 *
 * Left: the scene as a tree (drag to reorder and nest). Middle: the sections
 * (Shapes, Combine, Bend space, Look, Camera, Quality, Output) plus the Recipe,
 * Templates and Describe tabs. Right: a live preview of what Build will make.
 * Build puts the graph on the canvas (or rebuilds the scene it was opened
 * from, keeping the user's own edits where it can); Done closes.
 */
import { useEffect, useMemo } from 'react';
import { useSceneBuilder, type BuilderTab } from '../../sceneBuilder/store';
import { buildFromBuilder, describeIntoBuilder } from '../../sceneBuilder/actions';
import { buildSceneGraph } from '../../sceneBuilder/build';
import { allShapes, effectiveStepScale } from '../../sceneBuilder/spec';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { BuilderLabel, BuilderNote, BuilderWindow } from '../builders/BuilderWindow';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { SceneTree } from './SceneTree';
import { ScenePreview } from './ScenePreview';
import { CameraTab, CombineTab, DescribeTab, LookTab, OutputTab, QualityTab, RecipeTab, ShapesTab, TemplatesTab, WarpsTab } from './tabs';

const TABS: Array<{ id: BuilderTab; label: string; icon: IconName }> = [
  { id: 'shapes', label: 'Shapes', icon: 'cube' },
  { id: 'combine', label: 'Combine', icon: 'layers' },
  { id: 'warps', label: 'Bend space', icon: 'wave' },
  { id: 'look', label: 'Look', icon: 'sun' },
  { id: 'camera', label: 'Camera', icon: 'camera' },
  { id: 'quality', label: 'Quality', icon: 'sliders' },
  { id: 'output', label: 'Output', icon: 'eye' },
  { id: 'recipe', label: 'Recipe', icon: 'text' },
  { id: 'templates', label: 'Templates', icon: 'presets' },
  { id: 'describe', label: 'Describe', icon: 'search' },
];

const MODE_LABEL = { surface: 'Surface', volumetric: 'Volumetric glow', glass: 'Glass', gi: 'GI lit' } as const;

function TabBar() {
  const tab = useSceneBuilder(s => s.tab);
  const setTab = useSceneBuilder(s => s.setTab);
  const tk = useTokens();
  return (
    <div role="tablist" aria-label="Scene Builder sections" style={{
      position: 'sticky', top: 0, zIndex: 2, display: 'flex', gap: 2, padding: '8px 14px', flexWrap: 'wrap',
      background: tk.bg.panel, borderBottom: `1px solid ${tk.border.subtle}`,
    }}>
      {TABS.map(t => {
        const on = t.id === tab;
        return (
          <button key={t.id} role="tab" aria-selected={on} type="button" data-sb-tab={t.id} onClick={() => setTab(t.id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 10px', border: 0, borderRadius: radius.md, cursor: 'pointer',
              background: on ? tk.bg.selected : 'none', color: on ? tk.accent.text : tk.text.secondary, font: `${on ? 650 : 500} 12.5px ${fontFamily.ui}`,
              ...(t.id === 'recipe' ? { marginLeft: 10 } : {}),
            }}>
            <Icon name={t.icon} size={14} />{t.label}
          </button>
        );
      })}
    </div>
  );
}

function PreviewPanel() {
  const spec = useSceneBuilder(s => s.spec);
  const tk = useTokens();
  const dry = useMemo(() => {
    try { return buildSceneGraph(spec); } catch { return null; }
  }, [spec]);
  const counts = useMemo(() => {
    const byType = new Map<string, number>();
    const walk = (list: NonNullable<typeof dry>['nodes']) => {
      for (const n of list) {
        byType.set(n.type, (byType.get(n.type) ?? 0) + 1);
        const sg = n.params.subgraph as { nodes?: typeof list } | undefined;
        if (sg?.nodes) walk(sg.nodes);
      }
    };
    if (dry) walk(dry.nodes);
    return byType;
  }, [dry]);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 14px' }}>
      <BuilderLabel meta={MODE_LABEL[spec.look.mode]}>Preview</BuilderLabel>
      <ScenePreview spec={spec} />
      {dry?.warnings.map((w, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, fontSize: 12, color: tk.status.warningText, lineHeight: 1.4 }}><Icon name="warning" size={14} style={{ flexShrink: 0, marginTop: 1 }} />{w}</div>
      ))}
      <BuilderLabel meta={`${total} nodes`}>What Build makes</BuilderLabel>
      <BuilderNote>
        A Scene Group (Scene Pos → {allShapes(spec).length} shape{allShapes(spec).length === 1 ? '' : 's'}, combines and warps → Scene Output), a March Camera,{' '}
        {spec.look.mode === 'glass' ? 'a Glass Scene' : spec.look.mode === 'gi' ? 'a GI Lit March Group' : `a March Loop${spec.look.mode === 'volumetric' ? ' in volumetric mode with Volume Glow inside' : ''}`}
        {spec.look.mode === 'surface' ? ', soft shadows, ambient occlusion and Multi-Light' : ''}{spec.look.tone !== 'none' ? ', Tone Map' : ''} and the Output{spec.output && spec.output.show !== 'picture' ? `, which shows the ${spec.output.show}${spec.output.palette ? ` through the ${spec.output.palette} palette` : ''}` : ''}. Every node gets a note. Step Scale {effectiveStepScale(spec)}.
      </BuilderNote>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => (
          <span key={t} style={{ padding: '1px 7px', borderRadius: 6, background: tk.bg.field, color: tk.text.secondary, font: `500 11px ${fontFamily.mono}` }}>{t}{n > 1 ? ` ×${n}` : ''}</span>
        ))}
      </div>
    </div>
  );
}

export function SceneBuilderModal() {
  const tk = useTokens();
  const tab = useSceneBuilder(s => s.tab);
  const spec = useSceneBuilder(s => s.spec);
  const close = useSceneBuilder(s => s.close);
  const undo = useSceneBuilder(s => s.undo);
  const redo = useSceneBuilder(s => s.redo);
  const canUndo = useSceneBuilder(s => s.past.length > 0);
  const canRedo = useSceneBuilder(s => s.future.length > 0);
  const dirty = useSceneBuilder(s => s.dirty);
  const targetSceneId = useSceneBuilder(s => s.targetSceneId);
  const targetExists = useNodeGraphStore(s => !!targetSceneId && s.nodes.some(n => n.id === targetSceneId));
  const editing = !!targetSceneId && targetExists;

  // ⌘Z / ⌘⇧Z undo the form, not the graph, while the builder is open (text fields keep their own).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text'))) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) redo(); else undo();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [undo, redo]);

  const shapes = allShapes(spec).length;
  const body = {
    shapes: <ShapesTab />, combine: <CombineTab />, warps: <WarpsTab />, look: <LookTab />, camera: <CameraTab />, quality: <QualityTab />, output: <OutputTab />,
    recipe: <RecipeTab />, templates: <TemplatesTab />, describe: <DescribeTab />,
  }[tab];

  return (
    <BuilderWindow
      prefsKey="scene-builder"
      title="3D Scene Builder"
      subtitle={`${editing ? 'Editing a built scene' : 'A new scene'} · ${shapes} shape${shapes === 1 ? '' : 's'} · ${MODE_LABEL[spec.look.mode]}`}
      icon="cube"
      iconColor={tk.kind.fn}
      onClose={close}
      left={{ label: 'Scene', icon: 'layers', width: 290, content: <SceneTree />, rail: expand => (
        <button type="button" onClick={expand} title="Show the scene tree" aria-label="Show the scene tree"
          style={{ width: 44, flexShrink: 0, border: 0, borderRight: `1px solid ${tk.border.subtle}`, background: tk.bg.subtle, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingTop: 14, color: tk.text.faint }}>
          <Icon name="chevR" size={14} /><Icon name="layers" size={15} />
          <span style={{ font: `650 10px ${fontFamily.ui}`, writingMode: 'vertical-rl', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Scene · {shapes}</span>
        </button>
      ) }}
      right={{ label: 'Preview', icon: 'eye', width: 360, content: <PreviewPanel /> }}
      headerActions={<>
        <Button size="sm" variant="ghost" icon="search" style={{ marginRight: 4 }} title="Read the 3D graph on the canvas back into the builder" onClick={() => describeIntoBuilder()}>Describe graph</Button>
        <IconButton icon="undo" label="Undo" shortcut="cmd+z" disabled={!canUndo} onClick={undo} />
        <IconButton icon="redo" label="Redo" shortcut="cmd+shift+z" disabled={!canRedo} onClick={redo} />
      </>}
      footer={<>
        {editing && <Button icon="copy" onClick={() => void buildFromBuilder(true)} title="Leave the built scene as it is and build this one beside it">Build as a new copy</Button>}
        <BuilderNote>{editing ? 'Rebuild replaces the scene it was built as, keeping settings you changed on its nodes.' : 'Build adds the graph to the canvas and shows it on the Output.'}</BuilderNote>
        <span style={{ flex: 1 }} />
        {dirty && <BuilderNote style={{ color: tk.text.faint }}>Not built yet</BuilderNote>}
        <Button onClick={close}>Done</Button>
        <Button variant="primary" icon="rebuild" disabled={!shapes} onClick={() => void buildFromBuilder(false)}>{editing ? 'Rebuild' : 'Build'}</Button>
      </>}
    >
      <TabBar />
      {body}
    </BuilderWindow>
  );
}

/** Mounted once beside the canvas: the builder window while it is open. */
export function SceneBuilderHost() {
  const open = useSceneBuilder(s => s.open);
  return open ? <SceneBuilderModal /> : null;
}
