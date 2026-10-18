/**
 * SplatBuilder — the Splat builder window (docs/splat-builder.md), the Scene builder's Splat scene kind, on the
 * shared StudioShell like the 3D Scene Builder:
 *
 *   ┌ Scene builder › Splat scene ── undo · redo · Under the hood · Surprise me · Open as nodes · Done ┐
 *   │ Sections with a one-line   │      the scan, live and big (the main preview,   │ the section's │
 *   │ summary each               │      mirrored): drag to orbit, the Place gizmo   │ settings      │
 *   ├────────────────────────────┴──────────────────────────────────────────────────┴───────────────┤
 *   │ templates, as pictures                                                                          │
 *   └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Every change is built into the graph at once (splatBuilder/actions.ts): settings as live uniforms, wiring by a
 * quiet rebuild; closing makes the session one undo step.
 */
import { useEffect, useMemo } from 'react';
import { useTokens } from '../../theme/themeStore';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { StripRow, StudioShell, StudioLabel, StudioNavItem, PresetCard } from '../builders/studio/StudioShell';
import { SceneCrumb } from '../builders/SceneCrumb';
import { IconButton } from '../ui/Button';
import type { IconName } from '../ui/iconPaths';
import { SurpriseBar } from '../surprise/SurpriseBar';
import { announceSurprise } from '../surprise/announce';
import { newSeed } from '../../lib/surprise';
import { backToSceneKinds } from '../../builders/sceneKinds';
import { focusRecipeEditor, useBuilderRecipeRequest } from '../../builders/windows';
import { SPLAT_SECTIONS, useSplatBuilder } from '../../splatBuilder/store';
import { closeSplatBuilder, finishSplatBuilder, openSplatAsNodes, syncSplatBuilder } from '../../splatBuilder/actions';
import { SPLAT_TEMPLATES, withTemplate } from '../../splatBuilder/templates';
import { EFFECT_INFO, normalizeSpec, scanName, sectionSummary, type SplatBuilderSpec, type SplatSection } from '../../splatBuilder/spec';
import { SECTION_PANELS, RecipeSection } from './panels';
import { PresetsSummary, UserPresets } from '../builders/UserPresets';
import { SPLAT_STRIP_KEYS, stripOf } from '../../builders/stripPresets';
import { presetTextToSpec, specToPresetText } from '../../builders/userPresets';
import { SplatViewport, scanBoxNow, useScanBox } from './SplatViewport';
import { fitPlace } from '../../splatBuilder/place';
import { cloudPicture } from './MiniCloud';

export const SECTION_INFO: Record<SplatSection, { label: string; icon: IconName; line: string }> = {
  scan: { label: 'Scan', icon: 'import', line: 'Load a scan (or drop one), see what it is, pick a quality' },
  place: { label: 'Place', icon: 'target', line: 'Move, turn and size it; fit it to the view; which way is up' },
  effects: { label: 'Effects', icon: 'spark', line: 'Dissolve, explode, wave, grade, crop: stacked, in order' },
  scene: { label: 'Scene', icon: 'cube', line: 'A floor, shapes and light round it, and the background' },
  camera: { label: 'Camera', icon: 'camera', line: 'Where you look from, the lens, a slow turntable' },
  look: { label: 'Look', icon: 'sun', line: 'Tone and bloom' },
};

/** Build each change into the graph, once a frame at most. */
function useLiveSync() {
  useEffect(() => {
    let raf = 0;
    let last = useSplatBuilder.getState().spec;
    const off = useSplatBuilder.subscribe(s => {
      if (!s.open || s.spec === last) return;
      last = s.spec;
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; if (useSplatBuilder.getState().open) syncSplatBuilder(); });
    });
    return () => { off(); if (raf) cancelAnimationFrame(raf); };
  }, []);
}

function Nav() {
  const spec = useSplatBuilder(s => s.spec);
  const section = useSplatBuilder(s => s.section);
  const hood = useSplatBuilder(s => s.hood);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '14px 10px' }}>
      <StudioLabel meta="what you can do">Sections</StudioLabel>
      {SPLAT_SECTIONS.map(id => (
        <StudioNavItem key={id} id={id} icon={SECTION_INFO[id].icon} label={SECTION_INFO[id].label} hint={SECTION_INFO[id].line}
          summary={sectionSummary(spec, id)} selected={!hood && section === id} onClick={() => useSplatBuilder.getState().setSection(id)} />
      ))}
    </div>
  );
}

function Inspector() {
  const tk = useTokens();
  const section = useSplatBuilder(s => s.section);
  const hood = useSplatBuilder(s => s.hood);
  const Panel = SECTION_PANELS[section];
  const info = hood ? { label: 'Under the hood', line: 'The scene as a recipe' } : SECTION_INFO[section];
  return (
    <div data-inspector={hood ? 'recipe' : section} data-splat-section={hood ? 'recipe' : section} style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 14px 24px' }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <b style={{ fontSize: 15, fontWeight: 650 }}>{info.label}</b>
        <span style={{ fontSize: 12, color: tk.text.muted }}>{info.line}</span>
      </span>
      {hood ? <RecipeSection /> : <Panel />}
    </div>
  );
}

function Presets() {
  const current = useSplatBuilder(s => s.spec);
  const offered = useMemo(() => stripOf(SPLAT_TEMPLATES, SPLAT_STRIP_KEYS), []);
  const pics = useMemo(() => Object.fromEntries(offered.map(t => { const s = t.make(); return [t.key, cloudPicture(s.effects, s.background.color)]; })), []);
  const effects = current.effects.map(e => e.kind).join(',');
  return (
    <StripRow>
      {offered.map(t => (
        <PresetCard key={t.key} id={t.key} label={t.label} hint={`${t.blurb}${current.scan.source.kind === 'file' ? ' Your scan stays.' : ''}`} src={pics[t.key]}
          active={effects === t.make().effects.map(e => e.kind).join(',') && effects !== ''}
          onClick={() => useSplatBuilder.getState().replace(withTemplate(useSplatBuilder.getState().spec, t))} />
      ))}
      <UserPresets kind="splat" getRecipe={() => specToPresetText(useSplatBuilder.getState().spec)}
        onLoad={text => { const s = presetTextToSpec<SplatBuilderSpec>(text); if (s) useSplatBuilder.getState().replace(normalizeSpec(s)); }}
        fallbackThumb={() => { const s = useSplatBuilder.getState().spec; return cloudPicture(s.effects, s.background.color); }} />
    </StripRow>
  );
}

export function SplatBuilder() {
  const undo = useSplatBuilder(s => s.undo);
  const redo = useSplatBuilder(s => s.redo);
  const canUndo = useSplatBuilder(s => s.past.length > 0);
  const canRedo = useSplatBuilder(s => s.future.length > 0);
  const hood = useSplatBuilder(s => s.hood);
  const seed = useSplatBuilder(s => s.surpriseSeed);
  const name = useSplatBuilder(s => scanName(s.spec.scan.source));
  const fx = useSplatBuilder(s => s.spec.effects.filter(e => e.on).length);
  const target = useSplatBuilder(s => s.targetId);
  const built = useNodeGraphStore(s => !!target && s.nodes.some(n => n.id === target));
  useLiveSync();
  // A new file: fitted to the view once the engine has read it (ScanSection sets fitPending).
  const box = useScanBox(target);
  const fitPending = useSplatBuilder(s => s.fitPending);
  useEffect(() => {
    if (!fitPending || !box || JSON.stringify(box) === fitPending.was) return;
    useSplatBuilder.getState().setFitPending(null);
    useSplatBuilder.getState().edit(d => { d.place = fitPlace(d.place, box); }, 'scan:fit');
  }, [box, fitPending]);
  // ⌘⇧D: Under the hood, the recipe's text focused.
  useBuilderRecipeRequest(() => { useSplatBuilder.getState().setHood(true); focusRecipeEditor('[data-splat-recipe]'); });

  // ⌘Z / ⌘⇧Z undo the builder (the graph follows), not the graph's own history.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text'))) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) useSplatBuilder.getState().redo(); else useSplatBuilder.getState().undo();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <StudioShell prefsKey="splat-builder" icon="spark" title={built ? 'Your splat scene' : 'A new splat scene'} crumb={<SceneCrumb kind="splat" onBack={backToSceneKinds} />}
      kind={`${name} · ${fx ? `${fx} effect${fx === 1 ? '' : 's'}` : 'no effects'} · ${built ? 'live in the graph' : 'building…'}`}
      onClose={closeSplatBuilder}
      onEscape={() => { if (useSplatBuilder.getState().hood) { useSplatBuilder.getState().setHood(false); return true; } return false; }}
      actions={<>
        <IconButton icon="undo" size="sm" label="Undo" shortcut="cmd+z" disabled={!canUndo} onClick={undo} />
        <IconButton icon="redo" size="sm" label="Redo" shortcut="cmd+shift+z" disabled={!canRedo} onClick={redo} />
        <IconButton icon="fn" size="sm" data-open-as-nodes label="Open as nodes: close and show the Splat Scene and its effect nodes, every one with a note" onClick={openSplatAsNodes} />
        <IconButton icon="code" size="sm" active={hood} data-hood-toggle label={hood ? 'Hide Under the hood' : 'Under the hood: the scene as a recipe (⌘⇧D)'} onClick={() => useSplatBuilder.getState().setHood(!hood)} />
      </>}
      surprise={
        <SurpriseBar seed={seed} title="A random look from a new seed: an effect stack, a background, the camera (your scan stays; one undo step)" onSurprise={s => {
          useSplatBuilder.getState().surprise(s, scanBoxNow(useSplatBuilder.getState().targetId));
          const made = useSplatBuilder.getState().spec;
          announceSurprise({
            title: 'Splat surprise', seed: s,
            message: `${made.effects.map(e => EFFECT_INFO[e.kind].label).join(' → ') || 'no effects'}${made.world.on ? ' · in a world' : ''}${made.camera.turntable ? ' · turning' : ''}.`,
            reroll: () => { undo(); useSplatBuilder.getState().surprise(newSeed(), scanBoxNow(useSplatBuilder.getState().targetId)); },
            undo: () => undo(),
            stillCurrent: () => useSplatBuilder.getState().spec === made,
          });
        }} />}
      primary={{ label: 'Done', onClick: finishSplatBuilder, title: 'Close and show the scene on the graph (it is built as you go)' }}
      nav={<Nav />} navWidth={248} phoneSettingsTitle={hood ? 'Under the hood' : undefined}
      inspector={<Inspector />} inspectorWidth={hood ? 480 : 380}
      presets={<Presets />} presetsSummary={<PresetsSummary kind="splat" builtIns={stripOf(SPLAT_TEMPLATES, SPLAT_STRIP_KEYS).map(t => t.label)} />}>
      <SplatViewport />
    </StudioShell>
  );
}

/** Mounted by BuilderWindowsHost: the window while it is open. */
export function SplatBuilderHost() {
  const open = useSplatBuilder(s => s.open);
  return open ? <SplatBuilder /> : null;
}
