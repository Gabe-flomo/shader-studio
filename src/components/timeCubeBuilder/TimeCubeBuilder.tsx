/**
 * TimeCubeBuilder — the Time Cube builder window (docs/timecube-builder.md), the Scene builder's Time Cube kind, on the
 * shared StudioShell like the Splat builder:
 *
 *   ┌ Scene builder › Time Cube ─────────── undo · redo · Open as nodes · Surprise me (seed) · Done ┐
 *   │ Source, Shape, Time,  │   the Time Cube View or Frame Stack, live and big     │ the section's  │
 *   │ Colour, Highlights &  │   (the main preview, at the viewport's own size)      │ settings       │
 *   │ motion, Camera, Look  │                                                        │                │
 *   ├───────────────────────┴────────────────────────────────────────────────────────┴────────────────┤
 *   │ presets, as pictures (the Time Cube and Frame Stack examples)                                     │
 *   └────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Every setting is a param of a real node (Time Cube, Time Cube View, Frame Stack, the LFO), drawn from the node's own
 * definition (label, range, hint, when it shows), so the builder has every control the cards have. Every slider is a
 * BuilderSlider whose right-click offers that node's Play menu. Each change is built into the graph at once
 * (timeCubeBuilder/actions.ts): settings as live uniforms, Cube ⇄ Stack and the LFO by a quiet rewire.
 */
import { useEffect, useMemo } from 'react';
import { useTokens } from '../../theme/themeStore';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { StudioShell, StudioLabel, StudioNavItem, PresetCard } from '../builders/studio/StudioShell';
import { LiveViewport } from '../builders/studio/LiveViewport';
import { SceneCrumb } from '../builders/SceneCrumb';
import { BuilderNote } from '../builders/BuilderWindow';
import { Card, ColourRow, NumRow, Row } from '../sceneBuilder/controls';
import { IconButton } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { Select } from '../ui/Select';
import type { IconName } from '../ui/iconPaths';
import { SurpriseBar } from '../surprise/SurpriseBar';
import { announceSurprise } from '../surprise/announce';
import { newSeed } from '../../lib/surprise';
import { summarizeSection, switchOnPatch } from '../../lib/sectionSummary';
import { backToSceneKinds } from '../../builders/sceneKinds';
import { TimeCubeCardBody } from '../timeCube/TimeCubeCardBody';
import { useTimeCubeBuilder } from '../../timeCubeBuilder/store';
import { adoptFromGraph, closeTimeCubeBuilder, finishTimeCubeBuilder, openTimeCubeAsNodes, syncTimeCubeBuilder } from '../../timeCubeBuilder/actions';
import { findTcBuild } from '../../timeCubeBuilder/apply';
import { TC_PRESETS, presetNow, presetSpec, withPreset } from '../../timeCubeBuilder/presets';
import { timeCubePicture } from '../../timeCubeBuilder/picture';
import {
  DRIVE_TARGETS, TC_SECTIONS, defaultsOf, defsOf, displayRole, groupsFor, sectionSummary, sectionTitle, sourceName, visibleNow,
  type ParamGroup, type TcDisplay, type TcDrive, type TcSection, type TimeCubeSpec,
} from '../../timeCubeBuilder/spec';

export const SECTION_INFO: Record<TcSection, { icon: IconName; line: string }> = {
  source: { icon: 'import', line: 'The video (Ball action, built in, until you choose one), its clip, how many frames and how they are read' },
  shape: { icon: 'cube', line: 'A box of time or a stack of cards: its shape, size and layout' },
  time: { icon: 'clock', line: 'The slice or the scan, flow and playback, and an LFO to move it' },
  colour: { icon: 'sun', line: 'Glow, tint, brightness, a colour key that keeps one colour through time' },
  motion: { icon: 'spark', line: 'Highlighted frames, frames that move, cards that scatter' },
  space: { icon: 'grid', line: 'Repeat the box into a hall of copies, each at its own moment; twist, bend or wave the space it is in' },
  camera: { icon: 'camera', line: 'Where you look from, the lens, a slow orbit, flying through' },
  look: { icon: 'eye', line: 'Outlines, shadow, focus, quality and the background' },
};

const edit = (fn: (d: TimeCubeSpec) => void, key?: string) => useTimeCubeBuilder.getState().edit(fn, key);
const num = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);

/** The node built for `role`, looked up when the Play menu opens. */
function playParam(role: string, key: string): () => { nodeId: string; key: string } | { missing: string } {
  return () => {
    const id = useTimeCubeBuilder.getState().targetId;
    const b = id ? findTcBuild(useNodeGraphStore.getState().nodes, id) : null;
    const node = b?.byRole.get(role);
    return node ? { nodeId: node.id, key } : { missing: 'Not built yet: this part is off.' };
  };
}

/** Build each change into the graph, once a frame at most; take back what a card changed on a built node. */
function useLiveSync() {
  useEffect(() => {
    let raf = 0, adoptRaf = 0;
    let last = useTimeCubeBuilder.getState().spec;
    const off = useTimeCubeBuilder.subscribe(s => {
      if (!s.open || s.spec === last) return;
      last = s.spec;
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; if (useTimeCubeBuilder.getState().open) syncTimeCubeBuilder(); });
    });
    const offGraph = useNodeGraphStore.subscribe((s, p) => {
      if (s.nodes === p.nodes || adoptRaf) return;
      adoptRaf = requestAnimationFrame(() => { adoptRaf = 0; if (adoptFromGraph()) last = useTimeCubeBuilder.getState().spec; });
    });
    return () => { off(); offGraph(); if (raf) cancelAnimationFrame(raf); if (adoptRaf) cancelAnimationFrame(adoptRaf); };
  }, []);
}

// ── Settings drawn from the nodes' own definitions ───────────────────────────

/** One setting of a node, as its card draws it, in the builder's rows. */
function ParamRow({ role, k, spec }: { role: 'source' | 'view' | 'stack'; k: string; spec: TimeCubeSpec }) {
  const pd = defsOf(role)[k];
  const params = spec[role];
  const def = defaultsOf(role)[k];
  if (!pd || !visibleNow(pd, params, role)) return null;
  const set = (v: unknown) => edit(d => { d[role][k] = v; }, `${role}:${k}`);
  const driven = spec.drive.on && role === displayRole(spec.display) && spec.drive.target === k;
  if (driven) return <Row label={pd.label} hint={pd.hint}><BuilderNote>Moved by the LFO (Time → Animate with an LFO).</BuilderNote></Row>;
  switch (pd.type) {
    case 'float': case 'int':
      return (
        <div data-tc-param={`${role}.${k}`}>
          <NumRow label={pd.label} hint={pd.hint} value={num(params[k], num(def, 0))} min={pd.min ?? 0} max={pd.max ?? 1} step={pd.step ?? 0.01}
            integer={pd.type === 'int' || pd.step === 1} defaultValue={typeof def === 'number' ? def : undefined} rangeKey={`timecube:${role}:${k}`}
            lazyParam={playParam(role, k)} onChange={set} />
        </div>
      );
    case 'select':
      return (
        <div data-tc-param={`${role}.${k}`}>
          <Row label={pd.label} hint={pd.hint}>
            <Select ariaLabel={pd.label} value={String(params[k] ?? def ?? '')} options={pd.options ?? []} onChange={set} />
          </Row>
        </div>
      );
    case 'bool':
      return (
        <div data-tc-param={`${role}.${k}`}>
          <Row label={pd.label} hint={pd.hint}>
            <Toggle checked={params[k] === true || params[k] === 'true'} onChange={on => edit(d => {
              if (on) Object.assign(d[role], switchOnPatch(k, pd, d[role], defaultsOf(role)));
              else d[role][k] = false;
            })} />
          </Row>
        </div>
      );
    case 'vec3color':
      return (
        <div data-tc-param={`${role}.${k}`}>
          <ColourRow label={pd.label} hint={pd.hint} value={(Array.isArray(params[k]) ? params[k] : def) as [number, number, number]} onChange={set} />
        </div>
      );
    default: return null;
  }
}

function Groups({ groups, spec, section }: { groups: ParamGroup[]; spec: TimeCubeSpec; section: TcSection }) {
  return <>{groups.map((g, i) => (
    <Card key={`${spec.display}:${g.role}:${g.title}`} id={`timecube:${section}:${g.role}:${g.title}`} title={g.title} defaultOpen={i === 0}
      summary={summarizeSection(g.keys, defsOf(g.role), spec[g.role], defaultsOf(g.role)).text}>
      {g.keys.map(k => <ParamRow key={k} role={g.role} k={k} spec={spec} />)}
    </Card>
  ))}</>;
}

function SourcePanel({ spec }: { spec: TimeCubeSpec }) {
  const target = useTimeCubeBuilder(s => s.targetId);
  const node = useNodeGraphStore(s => (target ? s.nodes.find(n => n.id === target) : undefined));
  return <>
    {node ? (
      <div data-tc-source-card style={{ margin: '0 -12px' }}><TimeCubeCardBody node={node} /></div>
    ) : <BuilderNote>Building… ({sourceName(spec.source)})</BuilderNote>}
    <BuilderNote>The Time Cube reads a video: the built-in Ball action clip, one from the Library, or a file (Choose video). Edit clip… trims it, keeps several segments, crops and turns it.</BuilderNote>
    <Groups groups={groupsFor('source', spec.display)} spec={spec} section="source" />
  </>;
}

function ShapePanel({ spec }: { spec: TimeCubeSpec }) {
  return <>
    <Row label="Show the frames as" hint="Time Cube View: one box of time you look into. Frame Stack: each frame its own card, laid out and animated. Each keeps its own settings.">
      <span data-tc-display={spec.display}>
        <Segmented size="sm" ariaLabel="Cube or stack" value={spec.display} options={[{ value: 'cube' as const, label: 'A box of time' }, { value: 'stack' as const, label: 'A stack of cards' }]}
          onChange={(v: TcDisplay) => edit(d => {
            if (d.display === v) return;
            d.display = v;
            // The LFO moves to the same idea on the other display (the slice ⇄ the scan).
            const ok = DRIVE_TARGETS[v].some(t => t.value === d.drive.target);
            if (!ok) d.drive.target = v === 'cube' ? 'slice' : 'scan';
          })} />
      </span>
    </Row>
    <Groups groups={groupsFor('shape', spec.display)} spec={spec} section="shape" />
  </>;
}

function DriveCard({ spec }: { spec: TimeCubeSpec }) {
  const d = spec.drive;
  const setDrive = (p: Partial<TcDrive>, key?: string) => edit(x => { Object.assign(x.drive, p); }, key);
  return (
    <Card id="timecube:time:drive" title="Animate with an LFO" defaultOpen summary={d.on ? `${d.waveform}, ${Math.round(100 / Math.max(0.001, d.freq)) / 100} s a round` : 'Off'}>
      <Row label="LFO" hint="An LFO node wired into one of the display's sockets: it moves the setting by itself, round and round.">
        <span data-tc-drive-on><Toggle checked={d.on} onChange={on => setDrive({ on })} /></span>
      </Row>
      {d.on && <>
        <Row label="Moves" hint="Which socket the LFO drives.">
          <Select ariaLabel="What the LFO moves" value={d.target} options={DRIVE_TARGETS[spec.display].map(t => ({ value: t.value, label: t.label }))} onChange={v => setDrive({ target: v })} />
        </Row>
        <Row label="Wave" hint="Triangle sweeps there and back evenly; sawtooth runs one way and jumps back; sine eases at the ends.">
          <Select ariaLabel="Wave" value={d.waveform} options={[{ value: 'triangle', label: 'Triangle (there and back)' }, { value: 'sawtooth', label: 'Sawtooth (one way, then jump)' }, { value: 'sine', label: 'Sine (eases at the ends)' }, { value: 'square', label: 'Square (jumps)' }]}
            onChange={v => setDrive({ waveform: v as TcDrive['waveform'] })} />
        </Row>
        <div data-tc-param="drive.freq"><NumRow label="Speed" unit="rounds/s" hint="Rounds a second: 0.05 is one every 20 s." value={d.freq} min={0.005} max={1} step={0.005} defaultValue={0.07} rangeKey="timecube:drive:freq" lazyParam={playParam('drive', 'freq')} onChange={v => setDrive({ freq: v }, 'drive:freq')} /></div>
        <div data-tc-param="drive.offset"><NumRow label="Middle" hint="The middle of the swing." value={d.offset} min={0} max={1} step={0.01} defaultValue={0.5} rangeKey="timecube:drive:offset" lazyParam={playParam('drive', 'offset')} onChange={v => setDrive({ offset: v }, 'drive:offset')} /></div>
        <div data-tc-param="drive.amplitude"><NumRow label="Reach" hint="How far either side of the middle it goes." value={d.amplitude} min={0} max={0.5} step={0.01} defaultValue={0.47} rangeKey="timecube:drive:amplitude" lazyParam={playParam('drive', 'amplitude')} onChange={v => setDrive({ amplitude: v }, 'drive:amp')} /></div>
      </>}
    </Card>
  );
}

function Panel({ section, spec }: { section: TcSection; spec: TimeCubeSpec }) {
  if (section === 'source') return <SourcePanel spec={spec} />;
  if (section === 'shape') return <ShapePanel spec={spec} />;
  if (section === 'time') return <><DriveCard spec={spec} /><Groups groups={groupsFor('time', spec.display)} spec={spec} section="time" /></>;
  if (section === 'space' && spec.display !== 'cube') return <BuilderNote>Space repeats and warps the box of time: choose “A box of time” in Shape to use it.</BuilderNote>;
  return <Groups groups={groupsFor(section, spec.display)} spec={spec} section={section} />;
}

function Nav() {
  const spec = useTimeCubeBuilder(s => s.spec);
  const section = useTimeCubeBuilder(s => s.section);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '14px 10px' }}>
      <StudioLabel meta="what you can do" sections>Sections</StudioLabel>
      {TC_SECTIONS.map(id => (
        <StudioNavItem key={id} id={id} icon={SECTION_INFO[id].icon} label={sectionTitle(id)} hint={SECTION_INFO[id].line}
          summary={sectionSummary(spec, id)} selected={section === id} onClick={() => useTimeCubeBuilder.getState().setSection(id)} />
      ))}
    </div>
  );
}

function Inspector() {
  const tk = useTokens();
  const section = useTimeCubeBuilder(s => s.section);
  const spec = useTimeCubeBuilder(s => s.spec);
  return (
    <div data-inspector={section} data-tc-section={section} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 14px 24px' }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <b style={{ fontSize: 15, fontWeight: 650 }}>{sectionTitle(section)}</b>
        <span style={{ fontSize: 12, color: tk.text.muted }}>{SECTION_INFO[section].line}</span>
      </span>
      <Panel section={section} spec={spec} />
    </div>
  );
}

function Presets() {
  const spec = useTimeCubeBuilder(s => s.spec);
  const pics = useMemo(() => Object.fromEntries(TC_PRESETS.map(p => [p.key, timeCubePicture(presetSpec(p.key))])), []);
  const now = useMemo(() => presetNow(spec), [spec]);
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      {TC_PRESETS.map(p => (
        <PresetCard key={p.key} id={p.key} label={p.label} hint={`${p.blurb} Your video stays.`} src={pics[p.key]} active={now === p.key}
          onClick={() => useTimeCubeBuilder.getState().replace(withPreset(useTimeCubeBuilder.getState().spec, p.key))} />
      ))}
    </div>
  );
}

export function TimeCubeBuilder() {
  const undo = useTimeCubeBuilder(s => s.undo);
  const redo = useTimeCubeBuilder(s => s.redo);
  const canUndo = useTimeCubeBuilder(s => s.past.length > 0);
  const canRedo = useTimeCubeBuilder(s => s.future.length > 0);
  const seed = useTimeCubeBuilder(s => s.surpriseSeed);
  const display = useTimeCubeBuilder(s => s.spec.display);
  const name = useTimeCubeBuilder(s => sourceName(s.spec.source));
  const target = useTimeCubeBuilder(s => s.targetId);
  const built = useNodeGraphStore(s => !!target && s.nodes.some(n => n.id === target));
  useLiveSync();

  // ⌘Z / ⌘⇧Z undo the builder (the graph follows), not the graph's own history.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text'))) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) useTimeCubeBuilder.getState().redo(); else useTimeCubeBuilder.getState().undo();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <StudioShell prefsKey="timecube-builder" icon="layers" title={built ? 'Your time cube' : 'A new time cube'} crumb={<SceneCrumb kind="timecube" onBack={backToSceneKinds} />}
      kind={`${name} · ${display === 'cube' ? 'a box of time' : 'a stack of cards'} · ${built ? 'live in the graph' : 'building…'}`}
      onClose={closeTimeCubeBuilder}
      actions={<>
        <IconButton icon="undo" size="sm" label="Undo" shortcut="cmd+z" disabled={!canUndo} onClick={undo} />
        <IconButton icon="redo" size="sm" label="Redo" shortcut="cmd+shift+z" disabled={!canRedo} onClick={redo} />
        <IconButton icon="fn" size="sm" data-open-as-nodes label="Open as nodes: close and show the Time Cube, its View or Frame Stack and the LFO, every one with a note" onClick={openTimeCubeAsNodes} />
      </>}
      surprise={
        <SurpriseBar seed={seed} title="A random look from a new seed: box or cards, shape, colours, camera, an LFO (your video stays; one undo step)" onSurprise={s => {
          useTimeCubeBuilder.getState().surprise(s);
          const made = useTimeCubeBuilder.getState().spec;
          announceSurprise({
            title: 'Time Cube surprise', seed: s,
            message: `${made.display === 'cube' ? 'A box of time' : `Cards: ${String(made.stack.layout)}`}${made.drive.on ? `, its ${made.drive.target} on an LFO` : ''}.`,
            reroll: () => { undo(); useTimeCubeBuilder.getState().surprise(newSeed()); },
            undo: () => undo(),
            stillCurrent: () => useTimeCubeBuilder.getState().spec === made,
          });
        }} />}
      primary={{ label: 'Done', onClick: finishTimeCubeBuilder, title: 'Close and show the time cube on the graph (it is built as you go)' }}
      nav={<Nav />} navWidth={248}
      inspector={<Inspector />} inspectorWidth={380}
      presets={<Presets />}>
      <LiveViewport ownSize emptyNote="The preview is hidden: show it to see the time cube here." />
    </StudioShell>
  );
}
