/**
 * DetailWindow — one window for a control, a source or a signal
 * (implementation guide 7.3), on the Modal shell like the Expression Block's.
 * Back and forward walk what it has shown; every name in it opens that
 * thing's own page here. Edits are live and undoable like the rest of Play.
 *
 *   a control   its live value and trace; Comes from, Signals on this, Do,
 *               Goes to; Show layer, Show in shader graph, Rule from this
 *   a source    its card (settings and routes), its live reading; Signals on this
 *   a signal    its rule card (When, Options, Do); Listened to by; a loop badge
 */
import { useMemo, type ReactNode } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily, radius } from '../../../theme/tokens';
import { parseActionTarget, parsePropTarget, parseReaderTarget, type PlayRecord } from '../../../types/play';
import { playEngine } from '../../../lib/playEngine';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { readControlValue, targetParts } from '../../../play/playControls';
import { comesFrom, doOn, goesTo, listenedBy, listensTo, signalsOn, type DetailLink } from '../../../play/detailModel';
import { asRules } from '../../../play/rules';
import { sourceLabel } from '../../../play/playSources';
import { rtSourcesOf } from '../../../play/kit/routes.js';
import { requestPage } from '../../page';
import { Modal } from '../../ui/Modal';
import { Button, IconButton } from '../../ui/Button';
import { RuleCard } from '../rules/RuleCard';
import { useLamps } from '../rules/useLamps';
import { ShapeBadge } from '../rules/ShapeBadge';
import { signalStructure } from '../signalFlow';
import { usePlayUi } from '../playUi';
import { startRule } from '../playSplit';
import { wireRuleWhen } from '../miniMapperCore';
import { useDetail, type DetailRef } from './detailStore';
import { FloatingPanel } from './FloatingPanel';
import { usePhoneDialog } from '../../ui/phoneDialog';
import { LiveTrace } from './LiveTrace';

type Change = (fn: (p: PlayRecord) => PlayRecord) => void;

export function DetailWindow({ play: raw, onChange, renderSource }: {
  play: PlayRecord;
  onChange: Change;
  /** A source's card (a mapping's row or a record source's card), from the Play page. */
  renderSource: (id: string) => ReactNode;
}) {
  const { stack, at, back, forward, close } = useDetail();
  const ref = at >= 0 ? stack[at] : undefined;
  if (!ref) return null;
  return <Shown key={`${ref.kind}:${ref.id}`} refd={ref} play={raw} onChange={onChange} renderSource={renderSource} canBack={at > 0} canForward={at < stack.length - 1} onBack={back} onForward={forward} onClose={close} />;
}

function Shown({ refd: ref, play: raw, onChange, renderSource, canBack, canForward, onBack, onForward, onClose }: {
  refd: DetailRef; play: PlayRecord; onChange: Change; renderSource: (id: string) => ReactNode;
  canBack: boolean; canForward: boolean; onBack: () => void; onForward: () => void; onClose: () => void;
}) {
  const play = useMemo(() => asRules(raw), [raw]);
  // Keep open: a floating panel beside the work instead of a window over it (not on a phone: no room beside).
  const pinned = useDetail(d => d.pinned);
  const setPinned = useDetail(d => d.setPinned);
  const phone = usePhoneDialog();
  const floating = pinned && !phone;
  const nav = (
    <>
      <IconButton icon="chevL" label="Back" size="sm" disabled={!canBack} onClick={onBack} />
      <IconButton icon="chevR" label="Forward" size="sm" disabled={!canForward} onClick={onForward} />
      {!phone && <IconButton icon="popout" size="sm" active={floating} onClick={() => setPinned(!floating)}
        label={floating ? 'Back to a window over the page' : 'Keep open: a floating panel you can work beside (close it with its X)'} />}
    </>
  );
  let title = '', subtitle = '', body: ReactNode = null, icon: 'sliders' | 'live' | 'bolt' = 'sliders';
  if (ref.kind === 'control') {
    const c = play.controls.find(x => x.id === ref.id);
    title = c?.label ?? 'A missing control';
    subtitle = 'Control';
    body = c ? <ControlBody id={c.id} play={play} onChange={onChange} onClose={onClose} /> : <Missing />;
  } else if (ref.kind === 'source') {
    const s = rtSourcesOf(play).find(x => x.id === ref.id);
    title = s ? (s.label ?? sourceLabel(s.source, play.controls, play.layers)) : 'A missing source';
    subtitle = 'Source';
    icon = 'live';
    body = s ? <SourceBody id={s.id} play={play} renderSource={renderSource} /> : <Missing />;
  } else {
    const s = play.signals?.find(x => x.id === ref.id);
    title = s?.name ?? 'A missing rule';
    subtitle = 'Rule';
    icon = 'bolt';
    body = s ? <SignalBody id={s.id} play={play} onChange={onChange} /> : <Missing />;
  }
  const content = <div data-detail={`${ref.kind}:${ref.id}`} style={{ padding: '12px 16px 16px', overflowY: 'auto', flex: 1, minHeight: 0 }}>{body}</div>;
  return floating
    ? <FloatingPanel title={title} subtitle={subtitle} icon={icon} headerActions={nav} onClose={onClose}>{content}</FloatingPanel>
    : <Modal title={title} subtitle={subtitle} icon={icon} headerActions={nav} onClose={onClose} width={560} height={640}>{content}</Modal>;
}

function Missing() {
  const tk = useTokens();
  return <div style={{ color: tk.text.muted, font: `12px ${fontFamily.ui}` }}>It was deleted. Back goes to what was open before.</div>;
}

/** A heading and its links (each opens its own page in the window), or a line saying there are none. */
function Section({ title, links, none }: { title: string; links: DetailLink[]; none: string }) {
  const tk = useTokens();
  const open = useDetail(s => s.open);
  return (
    <div data-detail-section={title} style={{ marginTop: 14 }}>
      <div style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 4 }}>{title}</div>
      {!links.length && <div style={{ color: tk.text.faint, font: `12px ${fontFamily.ui}` }}>{none}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {links.map((l, i) => l.ref
          ? <button key={i} type="button" data-detail-link={`${l.ref.kind}:${l.ref.id}`} onClick={() => open(l.ref!)} style={{ height: 26, padding: '0 10px', border: 0, borderRadius: radius.md, cursor: 'pointer', background: tk.bg.field, color: tk.text.primary, font: `500 12px ${fontFamily.ui}` }}>{l.label}</button>
          : <span key={i} style={{ height: 26, padding: '0 10px', display: 'inline-flex', alignItems: 'center', color: tk.text.secondary, font: `12px ${fontFamily.ui}` }}>{l.label}</span>)}
      </div>
    </div>
  );
}

function ControlBody({ id, play, onChange, onClose }: { id: string; play: PlayRecord; onChange: Change; onClose: () => void }) {
  const c = play.controls.find(x => x.id === id)!;
  const read = () => {
    const live = playEngine.liveValue(id);
    const v = live !== undefined ? live : readControlValue(useNodeGraphStore.getState().nodes, c.target, play);
    return typeof v === 'number' ? v : Array.isArray(v) ? (v[0] + v[1] + v[2]) / 3 : null;
  };
  const prop = parsePropTarget(c.target);
  const graph = !prop && !parseActionTarget(c.target) && !parseReaderTarget(c.target) && !c.target.startsWith('finish:');
  return (
    <>
      <LiveTrace read={read} min={c.kind === 'float' ? c.min : 0} max={c.kind === 'float' ? c.max : 1} />
      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        {prop && <Button size="sm" icon="layers" onClick={() => { onClose(); usePlayUi.getState().reveal(prop.layerId); }}>Show layer</Button>}
        {graph && <Button size="sm" icon="nodes" onClick={() => { onClose(); useNodeGraphStore.getState().revealNode([], targetParts(c.target).nodeId); requestPage('studio'); }}>Show in shader graph</Button>}
        {c.kind !== 'color' && <Button size="sm" icon="bolt" onClick={() => { const r = wireRuleWhen(play, { control: id }); if (!r) return; onChange(() => r.play); onClose(); startRule({ when: r.when }); }}>Rule from this</Button>}
      </div>
      <Section title="Comes from" links={comesFrom(play, id)} none="Nothing drives it: its slider sets it." />
      <Section title="Signals on this" links={signalsOn(play, id)} none="No rule watches it." />
      <Section title="Do" links={doOn(play, id)} none="No rule acts on its layer." />
      <Section title="Goes to" links={goesTo(play, id)} none="It drives no other control." />
    </>
  );
}

function SourceBody({ id, play, renderSource }: { id: string; play: PlayRecord; renderSource: (id: string) => ReactNode }) {
  const watched = (play.signals ?? []).filter(s => [...(s.inputs ?? []).flatMap(x => (x.kind === 'trigger' ? [x.trigger] : [])), ...(s.when?.kind === 'trigger' ? [s.when.trigger] : [])]
    .some(t => t.on === 'value' && (t.value === `src:${id}` || t.value === `map:${id}`)));
  const routes = rtSourcesOf(play).find(x => x.id === id)?.outputs.flatMap(o => o.routes) ?? [];
  return (
    <>
      <LiveTrace read={() => playEngine.sourceValue(id)} min={0} max={1} />
      <div style={{ marginTop: 4 }}>{renderSource(id)}</div>
      <Section title="Goes to" links={routes.flatMap(r => { const c = play.controls.find(x => x.id === r.to); return c ? [{ label: `${c.label}${r.mode === 'add' ? ' · adds' : ''}`, ref: { kind: 'control' as const, id: c.id } }] : []; })} none="It drives nothing yet: Map it onto a control." />
      <Section title="Signals on this" links={watched.map(s => ({ label: s.name, ref: { kind: 'signal' as const, id: s.id } }))} none="No rule watches it." />
    </>
  );
}

function SignalBody({ id, play, onChange }: { id: string; play: PlayRecord; onChange: Change }) {
  const tk = useTokens();
  const s = play.signals!.find(x => x.id === id)!;
  const { on, flash } = useLamps([id]);
  const loop = playEngine.signalInLoop(id);
  const shape = signalStructure(play).get(id);
  return (
    <>
      {shape && shape !== 'isolated' && !loop && <div style={{ marginBottom: 8 }}><ShapeBadge shape={shape} /></div>}
      {loop && <div data-loop-badge="" style={{ marginBottom: 8, padding: '6px 10px', borderRadius: radius.md, background: tk.bg.field, color: tk.accent.text, font: `600 11.5px ${fontFamily.ui}` }}>In a loop: Run, Stop and Speed are on the Rules page.</div>}
      <RuleCard rule={s} play={play} onChange={fn => onChange(p => fn(asRules(p)))} on={!!on[id]} flash={flash[id] ?? 0} />
      <Section title="Listens to" links={listensTo(play, id)} none="Only triggers (keys, notes, gestures…): their settings are in its When." />
      <Section title="Listened to by" links={listenedBy(play, id)} none="Nothing else takes it." />
    </>
  );
}
