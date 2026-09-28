/**
 * FullPages — the rail's full-width pages that aren't a whole sidebar
 * section already (docs/split-view.md, "Rail and full-width pages"):
 * Actions and Signals as a list with the editor or the connections beside it,
 * the Background, and the frame the single-card pages (MIDI file, Pad grid)
 * sit in. Controls, Layers, Finish, the Engine and Mappings reuse their
 * sections, laid out wide (PlayPage renders them).
 *
 * Every page has the same header (PageHeader: 44 px, title, count, tools on
 * the right) and at most two columns: a list, and what the selected item
 * does beside it. Below WIDE_PANEL_PX the columns stack.
 */
import { useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Toggle } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { ProBadge } from '../account/ProSheet';
import { openProSheet } from '../../lib/plan';
import { triggerLabel } from '../../play/playSources';
import { addSignal, layerSignalListeners, layerSignalSenders } from '../../play/pairs';
import { backgroundLayerOf, SIGNAL_ACTION, type PlayAction, type PlayRecord } from '../../types/play';
import { ActionsSection, addAction } from './layers/ActionsSection';
import { SignalsList } from './ConditionFields';
import { BackgroundRow } from './BackgroundRow';
import { actionLabel } from './layers/help';
import { usePlayUi } from './playUi';

type Change = (fn: (p: PlayRecord) => PlayRecord) => void;

/** The header every full-width page shares. */
export function PageHeader({ title, count, extra }: { title: string; count?: number; extra?: ReactNode }) {
  const tk = useTokens();
  return (
    <div data-page-header="" style={{ minHeight: 44, flexShrink: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 8px', padding: '0 8px 0 16px', borderBottom: `1px solid ${tk.border.default}`, background: tk.bg.panel }}>
      <span style={{ font: `650 13px ${fontFamily.ui}` }}>{title}</span>
      {!!count && <span style={{ color: tk.text.faint, font: `500 11.5px ${fontFamily.mono}` }}>{count}</span>}
      <span style={{ flex: 1 }} />
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', minHeight: 44 }}>{extra}</span>
    </div>
  );
}

/** A list beside what the selected item does (stacked below WIDE_PANEL_PX). */
export function TwoPane({ wide, list, side }: { wide: boolean; list: ReactNode; side: ReactNode }) {
  const tk = useTokens();
  if (!wide) {
    return <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 12px 16px' }}>{list}<div style={{ height: 12 }} />{side}</div>;
  }
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <div data-pane="list" style={{ width: 'clamp(300px, 42%, 480px)', flexShrink: 0, overflowY: 'auto', padding: '10px 12px 16px 16px', borderRight: `1px solid ${tk.border.default}` }}>{list}</div>
      <div data-pane="side" style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '10px 16px 16px' }}>{side}</div>
    </div>
  );
}

/** A page that is one card (the MIDI file, the pad grid), kept to a readable width. */
export function CardPage({ title, count, extra, intro, children }: { title: string; count?: number; extra?: ReactNode; intro: string; children: ReactNode }) {
  const tk = useTokens();
  return (
    <>
      <PageHeader title={title} count={count} extra={extra} />
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 16px 16px' }}>
        <div style={{ maxWidth: 760 }}>
          <p style={{ margin: '0 0 10px', color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}` }}>{intro}</p>
          {children}
        </div>
      </div>
    </>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  const tk = useTokens();
  return (
    <div style={{ padding: '16px 14px', borderRadius: radius.lg, border: `1px dashed ${tk.border.strong}`, color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}` }}>
      <div style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.secondary, marginBottom: 4 }}>{title}</div>
      {body}
    </div>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  const tk = useTokens();
  return <div style={{ margin: '2px 2px 6px', color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{children}</div>;
}

// ── Actions ──────────────────────────────────────────────────────────────────

/** "Key Space → Burst · Sparks", in the words the editor uses. */
export function actionSummary(a: PlayAction, play: PlayRecord): { when: string; does: string } {
  const layers = play.layers.map(l => ({ id: l.id, label: l.label }));
  const when = triggerLabel(a.trigger, layers, { layers, controls: play.controls, signals: play.signals });
  if (a.do === SIGNAL_ACTION) return { when, does: `Send ${play.signals?.find(s => s.id === a.signal)?.name ?? 'a signal'}` };
  const layer = play.layers.find(l => l.id === a.layerId);
  return { when, does: `${actionLabel(a.do, layer)} · ${layer?.label ?? 'a deleted layer'}` };
}

export function ActionsPage({ play, onChange, wide }: { play: PlayRecord; onChange: Change; wide: boolean }) {
  const tk = useTokens();
  const actions = play.actions ?? [];
  const [picked, setPicked] = useState('');
  const selected = actions.find(a => a.id === picked) ?? actions[0];
  const add = () => { let id = ''; onChange(p => { const r = addAction(p); id = r.id; return r.play; }); if (id) setPicked(id); };
  const list = actions.length === 0
    ? <Empty title="No actions yet" body="When something happens, do something to a layer: a key bursts particles, the kick drum steps a word to the next line, a click on a shape drops the letters again. Or send a signal that other actions and mappings listen for." />
    : (
      <div role="listbox" aria-label="Actions" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {actions.map(a => {
          const s = actionSummary(a, play);
          const on = a.id === selected?.id;
          return (
            <div
              key={a.id}
              role="option"
              aria-selected={on}
              tabIndex={0}
              data-action-row={a.id}
              onClick={() => setPicked(a.id)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPicked(a.id); } }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, minHeight: 40, padding: '4px 8px 4px 10px', borderRadius: radius.md, cursor: 'pointer',
                background: on ? tk.bg.selected : 'transparent', boxShadow: on ? `inset 2px 0 0 ${tk.accent.base}` : undefined, opacity: a.enabled ? 1 : 0.55,
              }}
            >
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ font: `600 12px ${fontFamily.ui}`, color: on ? tk.accent.text : tk.text.primary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.when}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, font: `11.5px ${fontFamily.ui}`, color: tk.text.muted, minWidth: 0 }}>
                  <Icon name="chevR" size={11} style={{ flexShrink: 0, color: tk.text.faint }} />
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.does}</span>
                </span>
              </span>
              <span onClick={e => e.stopPropagation()}><Toggle checked={a.enabled} onChange={enabled => onChange(p => ({ ...p, actions: (p.actions ?? []).map(x => (x.id === a.id ? { ...x, enabled } : x)) }))} /></span>
            </div>
          );
        })}
      </div>
    );
  const side = selected
    ? <><SubHeading>Edit</SubHeading><ActionsSection play={play} onChange={onChange} only={selected.id} bare /></>
    : actions.length ? null : <div style={{ color: tk.text.faint, font: `12px/1.5 ${fontFamily.ui}`, padding: '4px 2px' }}>Add an action, then set what fires it and what it does here.</div>;
  return (
    <>
      <PageHeader title="Actions" count={actions.length} extra={<Button size="sm" icon="plus" onClick={add}>Add action</Button>} />
      <TwoPane wide={wide} list={list} side={side} />
    </>
  );
}

// ── Signals ─────────────────────────────────────────────────────────────────

export interface SignalLinks { sentBy: string[]; heardBy: string[] }

/** What sends a signal and what listens for it, in words. */
export function signalLinks(play: PlayRecord, id: string): SignalLinks {
  const sentBy: string[] = [], heardBy: string[] = [];
  const layers = play.layers.map(l => ({ id: l.id, label: l.label }));
  const ctx = { layers, controls: play.controls, signals: play.signals };
  for (const a of play.actions ?? []) {
    if (a.do === SIGNAL_ACTION && a.signal === id) sentBy.push(`Action: ${triggerLabel(a.trigger, layers, ctx)}`);
    if (a.trigger.on === 'signal' && a.trigger.signal === id) heardBy.push(`Action: ${actionSummary(a, play).does}`);
  }
  for (const m of play.mappings) {
    if (m.source.kind === 'trigger' && m.source.trigger.on === 'signal' && m.source.trigger.signal === id) {
      heardBy.push(`Mapping onto ${play.controls.find(c => c.id === m.controlId)?.label ?? 'a missing control'}`);
    }
  }
  for (const m of play.pairMappings ?? []) {
    const pair = play.pairs?.find(p => p.id === m.pairId)?.label ?? 'a pair';
    if (m.swap?.signal === id) heardBy.push(`Swap on ${pair}`);
    if (m.swap?.backSignal === id) heardBy.push(`Swap back on ${pair}`);
  }
  for (const s of layerSignalSenders(play)) if (s.id === id) sentBy.push(s.label);
  for (const s of layerSignalListeners(play)) if (s.id === id) heardBy.push(s.label);
  return { sentBy, heardBy };
}

export function SignalsPage({ play, onChange, wide }: { play: PlayRecord; onChange: Change; wide: boolean }) {
  const tk = useTokens();
  const signals = play.signals ?? [];
  const list = signals.length === 0
    ? <Empty title="No signals yet" body="A signal is a named event: an action sends it (Do: Send a signal), and other actions and mappings fire on it (When: a signal fires). Chain them: the dot reaches the box, that sends Hit, Hit bursts the sparks and steps the text." />
    : <SignalsList play={play} onChange={onChange} bare />;
  const side = signals.length === 0 ? null : (
    <>
      <SubHeading>Connections</SubHeading>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {signals.map(s => {
          const links = signalLinks(play, s.id);
          return (
            <div key={s.id} data-signal-links={s.id} style={{ padding: '10px 12px', borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }}>
              <div style={{ font: `650 12.5px ${fontFamily.ui}`, marginBottom: 6 }}>{s.name}</div>
              <LinkRow label="Sent by" items={links.sentBy} none="Nothing sends it yet (an action with Do: Send a signal)" />
              <LinkRow label="Heard by" items={links.heardBy} none="Nothing listens yet (When: a signal fires)" />
            </div>
          );
        })}
      </div>
    </>
  );
  return (
    <>
      <PageHeader title="Signals" count={signals.length} extra={<Button size="sm" icon="plus" onClick={() => onChange(p => addSignal(p).play)}>Add signal</Button>} />
      <TwoPane wide={wide} list={list} side={side} />
    </>
  );
}

function LinkRow({ label, items, none }: { label: string; items: string[]; none: string }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 8, padding: '3px 0', font: `12px/1.45 ${fontFamily.ui}` }}>
      <span style={{ color: tk.text.faint, font: `600 10px/1.9 ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</span>
      {items.length === 0
        ? <span style={{ color: tk.text.faint }}>{none}</span>
        : <span style={{ display: 'flex', flexDirection: 'column', color: tk.text.secondary }}>{items.map((t, i) => <span key={i}>{t}</span>)}</span>}
    </div>
  );
}

// ── Background ──────────────────────────────────────────────────────────────

export function BackgroundPage({ play, onChange, locked }: { play: PlayRecord; onChange: Change; locked: boolean }) {
  const tk = useTokens();
  const layer = backgroundLayerOf(play);
  return (
    <CardPage
      title="Background"
      intro="What the picture is under the layers: the shader, a flat colour or gradient, or a graph, an image or a video. Choosing a graph, an image or a video adds a Background layer with it as the first source, so more can queue behind it."
    >
      {locked ? (
        <button type="button" onClick={() => openProSheet('play.backgrounds')} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '12px 14px', border: 0, borderRadius: radius.card, cursor: 'pointer', background: alpha(tk.accent.base, 0.08), color: tk.text.secondary, font: `12px/1.5 ${fontFamily.ui}`, textAlign: 'left' }}>
          <ProBadge />
          <span style={{ flex: 1 }}>The picture is the shader on Free. Images, video, gradients and other graphs as the background are part of Pro.</span>
        </button>
      ) : (
        <div style={{ borderRadius: radius.card, overflow: 'hidden', boxShadow: `inset 0 0 0 1px ${tk.border.default}`, background: tk.bg.panel }}>
          <BackgroundRow play={play} onChange={onChange} />
        </div>
      )}
      {layer && (
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }}>
          <Icon name="layers" size={16} style={{ color: tk.text.faint }} />
          <span style={{ flex: 1, minWidth: 0, color: tk.text.secondary, font: `12px/1.45 ${fontFamily.ui}` }}>
            <b style={{ color: tk.text.primary }}>{layer.label}</b> · {layer.sources.length} source{layer.sources.length === 1 ? '' : 's'} in its queue. Its sources, timing and transitions are in its editor.
          </span>
          <Button size="sm" variant="ghost" onClick={() => usePlayUi.getState().reveal(layer.id)}>Edit the layer</Button>
        </div>
      )}
    </CardPage>
  );
}
