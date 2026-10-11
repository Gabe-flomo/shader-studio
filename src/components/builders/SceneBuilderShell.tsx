/**
 * SceneBuilderShell — the one Scene builder's own pages (docs/scene-builder.md), on the shared
 * builder shell (StudioShell):
 *
 *  - "What kind of scene?": 2D scene, Agent scene, Grid scene, Grid simulation, 3D scene, Splat scene, each with a picture and a
 *    line. With nodes in the graph it asks first: Clear and start over (the default when no builder
 *    made the graph: everything but the Output goes, as an undo step of its own) or Keep my graph.
 *    Picking a kind turns the window into that kind's builder (builders/open.ts startSceneKind).
 *  - On a graph a builder made: that scene, reopened as it was built (Edit this one, the default),
 *    Start over (it goes, then the kinds) or Add another (the kinds, keeping the graph). With
 *    several, pick which; a selected one is picked first.
 */
import { useMemo, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { radius } from '../../theme/tokens';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { StudioShell } from './studio/StudioShell';
import { useNarrowWindow } from '../code/SidePanels';
import { usePhoneDialog } from '../ui/phoneDialog';
import { ScenePicture } from './scenePictures';
import { SCENE_KINDS, builtScenes, builderMade, clearForScene, removeBuiltScene, sceneKindInfo, selectedBuiltScene, type BuiltScene, type SceneKind, type SceneKindInfo } from '../../builders/sceneKinds';
import { editBuiltScene, startSceneKind } from '../../builders/open';
import { clearableCount } from '../../agentBuilder/actions';
import { finishBuilder } from '../../builders/finish';
import { closeSceneShell, openSceneShell, type SceneShellPage } from '../../builders/windows';

/** Close (or Done): the shared builder finish (builders/finish.ts). Nothing is made on these pages, so there is nothing to frame. */
const closeShell = () => finishBuilder(closeSceneShell);

export function SceneBuilderShell({ page }: { page: SceneShellPage }) {
  return page.page === 'existing' ? <ExistingScenes /> : <KindPage note={page.note} keep={page.keep} />;
}

// ── What kind of scene? ──────────────────────────────────────────────────────

function KindPage({ note, keep }: { note?: string; keep?: boolean }) {
  const tk = useTokens();
  const clearable = useNodeGraphStore(s => clearableCount(s.nodes));
  const made = useNodeGraphStore(s => builderMade(s.nodes));
  const [choice, setChoice] = useState<'clear' | 'keep' | null>(null);
  // Three across (two rows of three), two on a narrow window, one on a phone.
  const phone = usePhoneDialog();
  const narrow = useNarrowWindow();
  // Clear by default, unless a builder made what is here (or Add another / Back said keep it).
  const clearFirst = choice ?? (keep || made ? 'keep' : 'clear');
  const pick = (k: SceneKind) => {
    if (clearFirst === 'clear' && clearable > 0) clearForScene();
    startSceneKind(k, { fromShell: true });
  };
  return (
    <StudioShell prefsKey="scene-shell" icon="presets" title="Scene builder" kind="What kind of scene?" onClose={closeShell}>
      <div data-scene-kinds style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'safe center', padding: '40px 24px 64px', gap: 22 }}>
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textAlign: 'center' }}>
          <b style={{ fontSize: 20, fontWeight: 650, letterSpacing: '-0.01em' }}>What kind of scene?</b>
          <span style={{ fontSize: 12.5, color: tk.text.muted }}>Pick one: the window becomes its builder. “Scene builder” at the top brings you back here.</span>
          {note && <span data-scene-note style={{ fontSize: 12, color: tk.text.secondary }}>{note}</span>}
        </span>
        {clearable > 0 && (
          <span data-scene-clear={clearFirst} style={{ display: 'inline-flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 10, fontSize: 12.5, color: tk.text.muted }}
            title="Clear: everything but the Output goes first, as an undo step of its own (undo brings it all back). Keep: the new scene is added beside what is there.">
            Your graph has {clearable} {clearable === 1 ? 'node' : 'nodes'}:
            <Segmented ariaLabel="Clear the current graph first?" value={clearFirst} onChange={setChoice}
              options={[{ value: 'clear' as const, label: 'Clear and start over' }, { value: 'keep' as const, label: 'Keep my graph' }]} />
          </span>
        )}
        {clearFirst === 'clear' && clearable > 0 && (
          <span data-scene-clear-note style={{ fontSize: 12, color: tk.status.warningText, marginTop: -10 }}>Picking a kind clears the graph first (all but the Output). Undo brings it back.</span>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${phone ? 1 : narrow ? 2 : 3}, minmax(0, 1fr))`, gap: 14, width: '100%', maxWidth: narrow ? 640 : 940 }}>
          {SCENE_KINDS.map(k => <KindCard key={k.id} info={k} onPick={() => pick(k.id)} />)}
        </div>
      </div>
    </StudioShell>
  );
}

function KindCard({ info, onPick }: { info: SceneKindInfo; onPick: () => void }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <button type="button" data-scene-kind={info.id} onClick={onPick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      title={`Opens the ${info.builder}`}
      style={{
        display: 'flex', flexDirection: 'column', gap: 10, padding: 10, border: 0, borderRadius: radius.card, cursor: 'pointer', textAlign: 'left',
        background: hover ? tk.bg.hover : tk.bg.panel, boxShadow: hover ? `inset 0 0 0 1.5px ${tk.accent.base}` : `inset 0 0 0 1px ${tk.border.default}`, color: tk.text.primary,
      }}>
      <span style={{ display: 'flex', justifyContent: 'center', width: '100%' }}><ScenePicture kind={info.id} width={272} height={168} /></span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 4px' }}>
        <b style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 650 }}><Icon name={info.icon} size={15} />{info.title}</b>
        <span style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.4 }}>{info.line}</span>
      </span>
    </button>
  );
}

// ── A graph a builder made ───────────────────────────────────────────────────

function ExistingScenes() {
  const tk = useTokens();
  const key = useNodeGraphStore(s => JSON.stringify(builtScenes(s.nodes)));
  const scenes = useMemo(() => JSON.parse(key) as BuiltScene[], [key]);
  const [picked, setPicked] = useState<string | null>(() => {
    const st = useNodeGraphStore.getState();
    const sel = st.selectedNodeIds.length ? st.selectedNodeIds : st.selectedNodeId ? [st.selectedNodeId] : [];
    return selectedBuiltScene(st.nodes, sel)?.id ?? null;
  });
  // Nothing built any more (undone, deleted): the kinds.
  if (!scenes.length) return <KindPage />;
  const sel = scenes.find(b => b.id === picked) ?? scenes[0];
  const many = scenes.length > 1;
  const name = (b: BuiltScene) => (b.label === sceneKindInfo(b.kind).title ? b.label : `${b.label} (${sceneKindInfo(b.kind).title})`);
  const startOver = () => {
    if (removeBuiltScene(sel)) openSceneShell({ page: 'kinds', note: `Started over: ${name(sel)} is gone (undo brings it back).` });
  };
  return (
    <StudioShell prefsKey="scene-shell" icon="presets" title="Scene builder" kind={many ? `${scenes.length} scenes a builder made` : `A ${sceneKindInfo(sel.kind).title} a builder made`} onClose={closeShell}>
      <div data-scene-existing style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'safe center', padding: '48px 24px 72px', gap: 20 }}
        onKeyDown={e => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') editBuiltScene(sel); }}>
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textAlign: 'center' }}>
          <b style={{ fontSize: 20, fontWeight: 650, letterSpacing: '-0.01em' }}>{many ? 'A builder made these scenes' : `A builder made this ${sceneKindInfo(sel.kind).title}`}</b>
          <span style={{ fontSize: 12.5, color: tk.text.muted, maxWidth: 540 }}>
            Edit it as it was built, start over from a new kind, or add another scene beside it. Undo takes back whatever you choose.
          </span>
        </span>
        <div role="radiogroup" aria-label="Which scene" style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', maxWidth: 520 }}>
          {scenes.map(b => {
            const on = b.id === sel.id;
            return (
              <button key={b.id} type="button" role="radio" aria-checked={on} data-existing-scene={b.id} data-existing-kind={b.kind}
                onClick={() => setPicked(b.id)} onDoubleClick={() => editBuiltScene(b)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px 8px 8px', border: 0, borderRadius: radius.card, cursor: 'pointer', textAlign: 'left',
                  background: on ? tk.bg.selected : tk.bg.panel, color: tk.text.primary, boxShadow: on ? `inset 0 0 0 1.5px ${tk.accent.base}` : `inset 0 0 0 1px ${tk.border.default}`,
                }}>
                <span style={{ width: 84, flexShrink: 0 }}><ScenePicture kind={b.kind} width={84} height={48} /></span>
                <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <b style={{ fontSize: 13, fontWeight: 650 }}>{b.label}</b>
                  <span style={{ fontSize: 11.5, color: tk.text.muted }}>{sceneKindInfo(b.kind).title} · {b.detail}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 10 }}>
          <Button variant="primary" icon="edit" onClick={() => editBuiltScene(sel)} data-existing-edit autoFocus>{many ? `Edit ${sel.label}` : 'Edit this one'}</Button>
          <Button icon="rebuild" onClick={startOver} data-existing-over title={`Take ${sel.label} away, then pick a kind (undo brings it back)`}>Start over</Button>
          <Button icon="plus" onClick={() => openSceneShell({ page: 'kinds', keep: true })} data-existing-add title="Keep what is here and add a new scene beside it">Add another</Button>
        </div>
      </div>
    </StudioShell>
  );
}
