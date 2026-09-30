/**
 * FullPages — the rail's full-width pages that aren't a whole sidebar
 * section already (docs/split-view.md, "Rail and full-width pages"):
 * Signals (named signals with what sends them and what they set off, and the
 * reactions beside them: signalFlow.ts),
 * the Background, and the frame the single-card pages (MIDI file, Pad grid)
 * sit in. Controls, Layers, Finish, the Engine and Mappings reuse their
 * sections, laid out wide (PlayPage renders them).
 *
 * Every page has the same header (PageHeader: 44 px, title, count, tools on
 * the right) and at most two columns: a list, and what the selected item
 * does beside it. Below WIDE_PANEL_PX the columns stack.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { Select } from '../ui/Select';
import { RulerSlider } from '../ui/RulerSlider';
import { ProBadge } from '../account/ProSheet';
import { openProSheet } from '../../lib/plan';
import { triggerLabel } from '../../play/playSources';
import { addSignal, deleteSignal, layerSignalListeners, layerSignalSenders, renameSignal, signalUses } from '../../play/pairs';
import { playEngine } from '../../lib/playEngine';
import { addThen, addWhen, signalFlow } from './signalFlow';
import { backgroundLayerOf, SIGNAL_ACTION, type PlayAction, type PlayRecord, type SignalDef, type SignalLogic } from '../../types/play';
import { ActionsSection, addAction } from './layers/ActionsSection';
import { SignalRow } from './ConditionFields';
import { SignalCaptureEditor, SignalDefEditor } from './SignalDefEditor';
import { BackgroundRow } from './BackgroundRow';
import { actionLabel } from './layers/help';
import { usePlayUi } from './playUi';
import { backgroundMatteCandidates, backgroundMatteSummary, patchBackgroundMatte, setBackgroundMatte } from '../../play/mattes';

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
  const layers = play.layers;
  const when = triggerLabel(a.trigger, layers, { layers, controls: play.controls, signals: play.signals });
  if (a.do === SIGNAL_ACTION) return { when, does: `Send ${play.signals?.find(s => s.id === a.signal)?.name ?? 'a signal'}` };
  const layer = play.layers.find(l => l.id === a.layerId);
  return { when, does: `${actionLabel(a.do, layer)} · ${layer?.label ?? 'a deleted layer'}` };
}

// ── Signals ─────────────────────────────────────────────────────────────────

export interface SignalLinks { sentBy: string[]; heardBy: string[] }

/** What sends a signal and what listens for it, in words. */
export function signalLinks(play: PlayRecord, id: string): SignalLinks {
  const sentBy: string[] = [], heardBy: string[] = [];
  const layers = play.layers;
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
  // Its own definition: a trigger it follows, or the signals it combines.
  const self = play.signals?.find(s => s.id === id);
  if (self?.when) sentBy.unshift(signalDefLabel(self.when, play));
  for (const s of layerSignalListeners(play)) if (s.id === id) heardBy.push(s.label);
  return { sentBy, heardBy };
}

const LOGIC_WORDS: Record<SignalLogic, string> = { and: 'All of', or: 'Any of', not: 'None of', xor: 'Exactly one of' };

/** "Key Space (held)", "All of: Hover, Click": what a level signal follows. */
export function signalDefLabel(w: SignalDef, play: PlayRecord): string {
  if (w.kind === 'trigger') return `Its own: ${triggerLabel(w.trigger, play.layers, { layers: play.layers, controls: play.controls, signals: play.signals })}`;
  const names = w.inputs.map(i => play.signals?.find(s => s.id === i)?.name ?? 'Missing signal');
  return `${LOGIC_WORDS[w.op]}: ${names.length ? names.join(', ') : 'nothing yet'}`;
}

/** One action as a row: "Key Space" over "→ Burst · Sparks". */
function ActionRow({ a, play, on, onPick, onChange, indent = false }: { a: PlayAction; play: PlayRecord; on: boolean; onPick: () => void; onChange: Change; indent?: boolean }) {
  const tk = useTokens();
  const s = actionSummary(a, play);
  return (
    <div
      role="option"
      aria-selected={on}
      tabIndex={0}
      data-action-row={a.id}
      onClick={onPick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } }}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, minHeight: 38, padding: `4px 8px 4px ${indent ? 12 : 10}px`, borderRadius: radius.md, cursor: 'pointer',
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
}

/**
 * Signals: the conditions that report what is happening and what they set
 * off, as one flow (signalFlow.ts). Each named signal is a card with what
 * sends it (When) and what it sets off (Then); reactions with no signal
 * between (a key bursts particles) sit below. The selected reaction's editor
 * is beside the list; a selected signal shows everything it reaches.
 */
export function SignalsPage({ play, onChange, wide }: { play: PlayRecord; onChange: Change; wide: boolean }) {
  const tk = useTokens();
  const flow = signalFlow(play);
  const actions = play.actions ?? [];
  const signals = play.signals ?? [];
  // What's selected: a pick made here, or what something else asked to show since (a signal just made from a slider's +).
  const focus = usePlayUi(s => s.signalFocus);
  const [local, setLocal] = useState({ id: '', at: 0 });
  const picked = focus.tick > local.at ? focus.id : local.id;
  const setPicked = (id: string) => setLocal({ id, at: focus.tick });
  const [lit, setLit] = useState<Record<string, number>>({});
  useEffect(() => playEngine.onSignal(id => setLit(l => ({ ...l, [id]: (l[id] ?? 0) + 1 }))), []);
  const pickedAction = actions.find(a => a.id === picked);
  const pickedSignal = pickedAction ? undefined : signals.find(x => x.id === picked);
  const selectedAction = pickedAction ?? (pickedSignal ? undefined : actions[0]);
  const addAndPick = (fn: (p: PlayRecord) => { play: PlayRecord; id: string }) => { let id = ''; onChange(p => { const r = fn(p); id = r.id; return r.play; }); if (id) setPicked(id); };
  const row = (a: PlayAction, indent = false) => <ActionRow key={a.id} a={a} play={play} on={a.id === selectedAction?.id} onPick={() => setPicked(a.id)} onChange={onChange} indent={indent} />;
  // `also`: what sends or hears it besides actions (a layer's Born, a mapping's trigger), shown as plain lines.
  const part = (label: string, items: PlayAction[], also: string[], none: string, add: () => void, addLabel: string) => (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 2px' }}>
        <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</span>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="ghost" icon="plus" onClick={add}>{addLabel}</Button>
      </div>
      {items.map(a => row(a, true))}
      {also.map(t => <div key={t} style={{ padding: '2px 12px 4px', color: tk.text.secondary, font: `11.5px/1.45 ${fontFamily.ui}` }}>{t}</div>)}
      {!items.length && !also.length && <div style={{ padding: '2px 12px 4px', color: tk.text.faint, font: `11.5px/1.45 ${fontFamily.ui}` }}>{none}</div>}
    </div>
  );
  const empty = signals.length === 0 && actions.length === 0;
  const list = empty
    ? <Empty title="Nothing happens yet" body="A signal reports that something happened: a key, a value crossing a line, a hand closing, particles colliding. Give it a When (what sends it) and a Then (what it sets off: burst the sparks, step the text). Or add a reaction straight away: When a key is pressed, do something to a layer. The + beside any slider can create a signal from it." />
    : (
      <div role="listbox" aria-label="Signals" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {flow.groups.map(g => {
          const on = pickedSignal?.id === g.signal.id;
          return (
            <div key={g.signal.id} data-signal-card={g.signal.id} style={{ borderRadius: radius.card, padding: '0 4px 6px', background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${on ? tk.accent.base : tk.border.default}` }}>
              <div onClick={() => setPicked(g.signal.id)} style={{ cursor: 'pointer' }}>
                <SignalRow
                  name={g.signal.name} uses={signalUses(play, g.signal.id)} flash={lit[g.signal.id] ?? 0}
                  onRename={name => onChange(p => renameSignal(p, g.signal.id, name))}
                  onFire={() => playEngine.fireSignal(g.signal.id)}
                  onRemove={() => onChange(p => deleteSignal(p, g.signal.id))}
                />
              </div>
              <SignalDefEditor signal={g.signal} play={play} onChange={onChange} />
              <SignalCaptureEditor signal={g.signal} play={play} onChange={onChange} />
              {(() => {
                const links = signalLinks(play, g.signal.id);
                // Actions are rows; its own definition is edited just above.
                const def = g.signal.when ? signalDefLabel(g.signal.when, play) : '';
                const notActions = (xs: string[]) => xs.filter(x => !x.startsWith('Action:') && x !== def);
                return <>
                  {part('When', g.when, notActions(links.sentBy), g.signal.when ? 'Only what it is true from, above. Actions can send it too.' : 'Nothing sends it yet.', () => addAndPick(p => addWhen(p, g.signal.id)), 'When')}
                  {part('Then', g.then, notActions(links.heardBy), 'It sets nothing off yet.', () => addAndPick(p => addThen(p, g.signal.id)), 'Then')}
                </>;
              })()}
            </div>
          );
        })}
        {flow.others.length > 0 && (
          <div>
            <SubHeading>Reactions without a signal</SubHeading>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{flow.others.map(a => row(a))}</div>
          </div>
        )}
      </div>
    );
  const side = selectedAction
    ? <><SubHeading>Edit</SubHeading><ActionsSection play={play} onChange={onChange} only={selectedAction.id} bare /></>
    : pickedSignal ? (() => {
      const links = signalLinks(play, pickedSignal.id);
      return (
        <>
          <SubHeading>{pickedSignal.name}</SubHeading>
          <div data-signal-links={pickedSignal.id} style={{ padding: '10px 12px', borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }}>
            <LinkRow label="Sent by" items={links.sentBy} none="Nothing sends it yet: add a When" />
            <LinkRow label="Heard by" items={links.heardBy} none="Nothing listens yet: add a Then, or pick it as a mapping's trigger" />
          </div>
        </>
      );
    })()
    : empty ? null : <div style={{ color: tk.text.faint, font: `12px/1.5 ${fontFamily.ui}`, padding: '4px 2px' }}>Pick a reaction to edit it.</div>;
  return (
    <>
      <PageHeader title="Signals" count={signals.length + actions.length} extra={<>
        <Button size="sm" icon="plus" onClick={() => addAndPick(p => addSignal(p))}>Add signal</Button>
        <Button size="sm" icon="plus" variant="ghost" onClick={() => addAndPick(addAction)}>Add reaction</Button>
      </>} />
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
        <>
          <div style={{ borderRadius: radius.card, overflow: 'hidden', boxShadow: `inset 0 0 0 1px ${tk.border.default}`, background: tk.bg.panel }}>
            <BackgroundRow play={play} onChange={onChange} />
          </div>
          <BackgroundMatteRow play={play} onChange={onChange} />
        </>
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

/** The Matte button and its summary, under the Background row: another layer cuts the picture. */
function BackgroundMatteRow({ play, onChange }: { play: PlayRecord; onChange: Change }) {
  const tk = useTokens();
  const matteRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const t = play.backgroundMatte;
  const matte = t ? play.layers.find(l => l.id === t.id) : undefined;
  const summary = backgroundMatteSummary(play);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
      <span ref={matteRef} style={{ display: 'inline-flex' }}>
        <Button
          size="sm"
          icon="link"
          aria-expanded={open}
          title={matte ? `Matte: ${summary}` : 'Show the picture only where another layer is'}
          onClick={() => setOpen(o => !o)}
          style={matte ? { background: tk.bg.selected, color: tk.accent.text, borderColor: 'transparent' } : undefined}
        >
          {matte ? `Matte · ${matte.label}` : 'Matte'}
        </Button>
      </span>
      {summary && <span style={{ color: tk.text.faint, font: `11.5px ${fontFamily.ui}` }}>{summary}</span>}
      {open && (
        <Popover anchorRef={matteRef} onClose={() => setOpen(false)} width={300} padding={12}>
          <BackgroundMattePanel play={play} onChange={onChange} onClose={() => setOpen(false)} />
        </Popover>
      )}
    </div>
  );
}

/** Pick the Background's matte, how it is read, its soft edge and what shows outside it. */
function BackgroundMattePanel({ play, onChange, onClose }: { play: PlayRecord; onChange: Change; onClose: () => void }) {
  const tk = useTokens();
  const t = play.backgroundMatte;
  const matte = t ? play.layers.find(l => l.id === t.id) : undefined;
  const candidates = backgroundMatteCandidates(play.layers);
  const label: React.CSSProperties = { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', width: 62, flexShrink: 0 };
  const row = (name: string, children: ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}><span style={label}>{name}</span>{children}</div>
  );
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name="link" size={14} style={{ color: tk.text.faint }} />
        <span style={{ font: `650 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>Matte</span>
      </div>
      <div style={{ marginTop: 4, color: tk.text.muted, font: `11.5px/1.45 ${fontFamily.ui}` }}>
        Show the picture only where another layer is: its solid parts (Alpha) or its bright parts (Luma).
      </div>
      {row('Layer', (
        <Select
          ariaLabel="Background matte layer"
          height={28}
          style={{ flex: 1 }}
          value={t?.id ?? ''}
          onChange={id => onChange(p => setBackgroundMatte(p, id))}
          options={[
            { value: '', label: 'None' },
            ...candidates.map(x => ({ value: x.id, label: `${x.label}${x.visible ? '' : ' (hidden)'}` })),
          ]}
        />
      ))}
      {t && matte && (
        <>
          {row('By', <Segmented size="sm" ariaLabel="Matte by" value={t.mode} options={[{ value: 'alpha', label: 'Alpha', title: 'Where the matte is solid' }, { value: 'luma', label: 'Luma', title: 'Where the matte is bright' }]} onChange={mode => onChange(p => patchBackgroundMatte(p, { mode }))} />)}
          {row('Invert', <Toggle checked={!!t.invert} onChange={invert => onChange(p => patchBackgroundMatte(p, { invert }))} label={t.invert ? 'Where the matte isn’t' : 'Where the matte is'} />)}
          {row('Soft edge', <RulerSlider ariaLabel="Soft edge" value={t.feather ?? 0} min={0} max={100} step={1} hard onChange={feather => onChange(p => patchBackgroundMatte(p, { feather }))} />)}
          {row('Outside', <RulerSlider ariaLabel="Opacity outside" value={t.opacityOutside ?? 0} min={0} max={1} step={0.01} hard onChange={opacityOutside => onChange(p => patchBackgroundMatte(p, { opacityOutside }))} />)}
          {matte.kind !== 'background' && row('Matte', <Toggle checked={matte.visible !== false} onChange={visible => onChange(p => ({ ...p, layers: p.layers.map(x => (x.id === matte.id ? { ...x, visible } : x)) }))} label="Show it on the picture too" />)}
          <div style={{ display: 'flex', gap: 6, marginTop: 12, alignItems: 'center' }}>
            <Button size="sm" onClick={() => { onClose(); usePlayUi.getState().reveal(matte.id); }}>Go to {matte.label}</Button>
            <span style={{ flex: 1 }} />
            <Button size="sm" variant="ghost" onClick={() => onChange(p => setBackgroundMatte(p, ''))}>Remove</Button>
          </div>
          <div style={{ marginTop: 8, color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>{matte.visible !== false ? 'shown on its own too' : 'hidden, working as the matte'}</div>
        </>
      )}
    </div>
  );
}
