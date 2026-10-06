/**
 * FlowStrip — the thin strip above the canvas (docs/structure-hints.md): the usual order of
 * steps for this kind of graph (2D, 3D, passes, agents), the stages the graph has lit up, and a
 * hint at the stage after the one the Output has reached, with two or three moves from the
 * suggestions. A stage's name opens the node browser on that stage. Gentle order notices sit at
 * its end. A guide only: nothing here blocks or rewrites anything.
 *
 * On a phone it collapses to one chip that opens the same things in a popover. Hidden with its ×
 * (remembered); the canvas toolbar's flow button brings it back.
 */
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { Toggle } from '../ui/Choice';
import { Tooltip } from '../ui/Tooltip';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { suggestionsFor, type RankedMove } from '../../suggestions';
import { FLOWS, STAGES, stageOfType, inFlow, type FlowId, type StageId } from '../../structure/stages';
import type { FlowReading } from '../../structure/flow';
import type { OrderNotice } from '../../structure/notices';
import { useStructureHints } from '../../structure/hintsStore';
import { BROWSE_STAGE_EVENT } from '../../structure/browse';
import { outputFeeder, useStructure } from './useStructure';
import { hideStrip, StageLegend, useStageColour } from './stageUi';

const FLOW_WHY: Record<FlowId, string> = {
  '2d': 'A flat picture: no camera, pass or agents in the graph.',
  '3d': 'It has a camera, 3D shapes or a ray march.',
  pass: 'It keeps a picture from frame to frame (a Pass, Previous Frame, Grid Rules).',
  agents: 'It has agents or particles: walkers that sense, steer and leave trails.',
};

/** An element's width, kept current (0 until measured). */
function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setW(el.clientWidth);
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** Open the node browser on a stage. */
export function browseStage(flow: FlowId, stage: StageId) {
  useStructureHints.getState().setBrowse({ flow, stage });
  window.dispatchEvent(new CustomEvent(BROWSE_STAGE_EVENT, { detail: { flow, stage } }));
}

/** The next-stage moves: the suggestions for what the Output shows, those of the next stage first. */
function useNextMoves(reading: FlowReading | null): { node: string; moves: RankedMove[] } | null {
  const nodes = useNodeGraphStore(s => s.nodes);
  const topLevel = useNodeGraphStore(s => s.activeGroupPath.length === 0);
  const feederId = useMemo(() => outputFeeder(nodes)?.id ?? null, [nodes]);
  const flow = reading?.flow, next = reading?.next;
  // Wiring changes re-rank; a drag (positions only) keeps the feeder and the same answer.
  return useMemo(() => {
    if (!topLevel || !feederId || !flow || !next) return null;
    const st = useNodeGraphStore.getState();
    const feeder = st.nodes.find(n => n.id === feederId);
    if (!feeder) return null;
    let ranked: RankedMove[] = [];
    try { ranked = suggestionsFor(feeder, st.nodes, { limit: 12, stageTarget: { flow, stage: next } }); } catch { return null; }
    const inNext = ranked.filter(m => m.move.anchor && inFlow(stageOfType(m.move.anchor.type), flow)?.stage === next);
    const rest = ranked.filter(m => !inNext.includes(m));
    const moves = [...inNext, ...rest].slice(0, inNext.length >= 2 ? Math.min(3, inNext.length) : 2);
    return moves.length ? { node: feederId, moves } : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topLevel, feederId, flow, next, reading]);
}

export function FlowStrip({ phone = false }: { phone?: boolean }) {
  const on = useStructureHints(s => s.stripOn);
  if (!on) return null;
  return <Strip phone={phone} />;
}

function Strip({ phone }: { phone: boolean }) {
  const tk = useTokens();
  const { reading, notices, graph } = useStructure();
  const next = useNextMoves(reading);
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const nStages = reading ? FLOWS[reading.flow].stages.length : 6;
  // Room for every stage's name and the next moves inline; else the moves fold into a menu, then
  // the stages show their names only for where the Output is and what comes next.
  const inlineNext = width >= nStages * 80 + 380;
  const compact = width > 0 && width < nStages * 80 + 120;
  if (phone) return reading ? <PhoneChip reading={reading} notices={notices} graph={graph} next={next} /> : null;
  // One container from the start, so the width watcher keeps watching it.
  return (
    <div ref={ref} data-flow-strip={reading?.flow ?? ''} role="navigation" aria-label="Flow"
      style={{
        height: 34, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 6px 0 10px', boxSizing: 'border-box',
        background: tk.bg.panel, borderBottom: `1px solid ${tk.border.default}`, font: `12px ${fontFamily.ui}`, color: tk.text.secondary,
        whiteSpace: 'nowrap', minWidth: 0,
      }}>
      {reading && <>
        <FlowLabel flow={reading.flow} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, overflowX: 'auto', scrollbarWidth: 'none', flex: '0 1 auto' }}>
          <Stages reading={reading} compact={compact} />
        </div>
        <span style={{ flex: 1 }} />
        {next && reading.next && (inlineNext
          ? <NextInline reading={reading} next={next} />
          : <NextMenu reading={reading} next={next} />)}
        <NoticesButton notices={notices} graph={graph} />
        <ViewButton flow={reading.flow} />
        <IconButton icon="close" size="sm" label="Hide the flow strip (the flow button in the canvas toolbar brings it back)" onClick={hideStrip} />
      </>}
    </div>
  );
}

function FlowLabel({ flow }: { flow: FlowId }) {
  const tk = useTokens();
  return (
    <Tooltip label={`${FLOWS[flow].label} flow`} description={`Picked from the graph. ${FLOW_WHY[flow]} The order is a guide, not a rule.`}>
      <span style={{ font: `700 10.5px ${fontFamily.ui}`, letterSpacing: '0.06em', color: tk.text.muted, background: tk.bg.field, borderRadius: radius.sm, padding: '2px 7px', textTransform: 'uppercase', cursor: 'default' }}>
        {FLOWS[flow].label}
      </span>
    </Tooltip>
  );
}

/** The flow's stages: lit when the graph has them, the Output's stage in bold, the next one dashed. */
function Stages({ reading, vertical = false, compact = false, onPicked }: { reading: FlowReading; vertical?: boolean; compact?: boolean; onPicked?: () => void }) {
  const tk = useTokens();
  const colour = useStageColour();
  const stages = FLOWS[reading.flow].stages;
  return (
    <>
      {stages.map((s, i) => {
        const lit = reading.present.has(s);
        const current = reading.current === s;
        const isNext = reading.next === s;
        const c = colour(s);
        const named = !compact || current || isNext;
        return (
          <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            {i > 0 && !vertical && !compact && <Icon name="chevR" size={11} style={{ color: tk.text.disabled, flexShrink: 0 }} />}
            <button type="button" data-stage={s} data-lit={lit ? '' : undefined} data-next={isNext ? '' : undefined}
              title={`${STAGES[s].label}: ${STAGES[s].line}${lit ? '' : ' (not in this graph yet)'} Click to browse its nodes.`}
              onClick={() => { browseStage(reading.flow, s); onPicked?.(); }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, height: vertical ? 34 : 24, padding: named ? '0 7px' : '0 4px', borderRadius: radius.md, cursor: 'pointer',
                width: vertical ? '100%' : undefined, textAlign: 'left',
                border: isNext ? `1px dashed ${alpha(tk.accent.base, 0.7)}` : '1px solid transparent',
                background: isNext ? alpha(tk.accent.base, 0.07) : 'none',
                color: lit ? tk.text.primary : tk.text.faint,
                font: `${current ? 650 : lit ? 550 : 450} 12px ${fontFamily.ui}`,
              }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: lit ? c : 'transparent', boxShadow: lit ? 'none' : `inset 0 0 0 1.5px ${alpha(c, 0.55)}` }} />
              {named && STAGES[s].label}
              {isNext && <span style={{ font: `600 10px ${fontFamily.ui}`, color: tk.accent.text }}>next</span>}
              {vertical && <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 400, color: tk.text.muted, fontSize: 11.5 }}>{STAGES[s].line}</span>}
            </button>
          </span>
        );
      })}
    </>
  );
}

function MoveChip({ m, nodeId, onDone }: { m: RankedMove; nodeId: string; onDone?: () => void }) {
  const tk = useTokens();
  return (
    <button type="button" data-next-move={m.move.id} title={m.why}
      onClick={() => { useNodeGraphStore.getState().applySuggestion(nodeId, m.key, m.side, m.move.id, m.args ?? {}); onDone?.(); }}
      style={{ height: 24, padding: '0 9px', border: 0, borderRadius: 999, cursor: 'pointer', background: tk.bg.field, color: tk.text.primary, font: `550 11.5px ${fontFamily.ui}`, flexShrink: 0 }}
      onMouseEnter={e => { e.currentTarget.style.background = tk.bg.hover; }} onMouseLeave={e => { e.currentTarget.style.background = tk.bg.field; }}>
      {m.move.label}
    </button>
  );
}

function NextInline({ reading, next }: { reading: FlowReading; next: { node: string; moves: RankedMove[] } }) {
  const tk = useTokens();
  return (
    <span data-next-hint style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
      <span style={{ color: tk.text.muted }}>Next: <b style={{ color: tk.text.primary, fontWeight: 600 }}>{STAGES[reading.next!].label}</b></span>
      {next.moves.map(m => <MoveChip key={m.move.id} m={m} nodeId={next.node} />)}
    </span>
  );
}

function NextMenu({ reading, next }: { reading: FlowReading; next: { node: string; moves: RankedMove[] } }) {
  const tk = useTokens();
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <span ref={ref} style={{ display: 'inline-flex', flexShrink: 0 }}>
      <button type="button" data-next-hint onClick={() => setOpen(o => !o)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 24, padding: '0 8px', border: 0, borderRadius: radius.md, cursor: 'pointer', background: open ? tk.bg.selected : tk.bg.field, color: tk.text.secondary, font: `550 11.5px ${fontFamily.ui}` }}>
        Next: {STAGES[reading.next!].label}<Icon name="chevD" size={12} />
      </button>
      {open && (
        <Popover anchorRef={ref} onClose={() => setOpen(false)} align="end" width={240} padding={10}>
          <NextBody reading={reading} next={next} onDone={() => setOpen(false)} />
        </Popover>
      )}
    </span>
  );
}

function NextBody({ reading, next, onDone }: { reading: FlowReading; next: { node: string; moves: RankedMove[] }; onDone?: () => void }) {
  const tk = useTokens();
  const s = reading.next!;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, color: tk.text.muted }}><b style={{ color: tk.text.primary }}>Next: {STAGES[s].label}.</b> {STAGES[s].line}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{next.moves.map(m => <MoveChip key={m.move.id} m={m} nodeId={next.node} onDone={onDone} />)}</div>
    </div>
  );
}

function NoticeList({ notices, graph, onShow }: { notices: OrderNotice[]; graph: string; onShow?: () => void }) {
  const tk = useTokens();
  const dismiss = useStructureHints(s => s.dismiss);
  const setNotices = useStructureHints(s => s.setNotices);
  const link = { border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.accent.text, font: `600 11.5px ${fontFamily.ui}` } as const;
  return (
    <div data-notices style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {notices.map(n => (
        <div key={n.id} data-notice={n.rule} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <b style={{ fontSize: 12.5, fontWeight: 600, color: tk.text.primary }}>{n.title}</b>
          <span style={{ fontSize: 12, lineHeight: 1.45, color: tk.text.muted }}>{n.text}</span>
          <span style={{ display: 'flex', gap: 12 }}>
            <button type="button" style={link} onClick={() => { useNodeGraphStore.getState().revealNode(n.path, n.nodeId); onShow?.(); }}>Show</button>
            <button type="button" style={link} data-dismiss-notice onClick={() => dismiss(graph, n.id)}>It’s intended</button>
          </span>
        </div>
      ))}
      <span style={{ borderTop: `1px solid ${tk.border.subtle}`, paddingTop: 8, fontSize: 11.5, color: tk.text.faint }}>
        Notices never change the graph. <button type="button" style={{ ...link, fontWeight: 500 }} onClick={() => setNotices(false)}>Turn order notices off</button>
      </span>
    </div>
  );
}

function NoticesButton({ notices, graph }: { notices: OrderNotice[]; graph: string }) {
  const tk = useTokens();
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  if (!notices.length) return null;
  return (
    <span ref={ref} style={{ display: 'inline-flex', flexShrink: 0 }}>
      <button type="button" data-notices-button onClick={() => setOpen(o => !o)} title="Order notices: steps in an unusual order"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 24, padding: '0 8px', border: 0, borderRadius: 999, cursor: 'pointer', background: alpha(tk.status.warning, 0.16), color: tk.status.warningText, font: `600 11.5px ${fontFamily.ui}` }}>
        <Icon name="info" size={12} />{notices.length === 1 ? '1 note' : `${notices.length} notes`}
      </button>
      {open && (
        <Popover anchorRef={ref} onClose={() => setOpen(false)} align="end" width={320} padding={12}>
          <NoticeList notices={notices} graph={graph} onShow={() => setOpen(false)} />
        </Popover>
      )}
    </span>
  );
}

function ViewToggles() {
  const s = useStructureHints();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Toggle checked={s.stripOn} onChange={s.setStrip} label="Flow strip" />
      <Toggle checked={s.tagsOn} onChange={s.setTags} label="Stage tags on cards" />
      <Toggle checked={s.noticesOn} onChange={s.setNotices} label="Order notices" />
    </div>
  );
}

function ViewBody({ flow }: { flow: FlowId }) {
  const tk = useTokens();
  const caps = { fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint, textTransform: 'uppercase' as const };
  return (
    <div data-structure-view style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={caps}>View</span>
      <ViewToggles />
      <span style={caps}>Stages · {FLOWS[flow].label}</span>
      <StageLegend flow={flow} />
      <span style={{ fontSize: 11.5, color: tk.text.faint, lineHeight: 1.45 }}>The usual order, read from the examples. A guide only: feedback, colour-to-space and other deliberate orders are fine.</span>
    </div>
  );
}

function ViewButton({ flow }: { flow: FlowId }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <span ref={ref} style={{ display: 'inline-flex' }}>
      <IconButton icon="sliders" size="sm" label="View: flow strip, stage tags, order notices, legend" active={open} onClick={() => setOpen(o => !o)} />
      {open && (
        <Popover anchorRef={ref} onClose={() => setOpen(false)} align="end" width={300} padding={14}>
          <ViewBody flow={flow} />
        </Popover>
      )}
    </span>
  );
}

/** The phone's chip: the flow, where the Output is, what's next, and the notices count. */
function PhoneChip({ reading, notices, graph, next }: { reading: FlowReading; notices: OrderNotice[]; graph: string; next: { node: string; moves: RankedMove[] } | null }) {
  const tk = useTokens();
  const colour = useStageColour();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const cur = reading.current;
  const section = (title: string, body: ReactNode) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 10, borderTop: `1px solid ${tk.border.subtle}` }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint, textTransform: 'uppercase' }}>{title}</span>
      {body}
    </div>
  );
  return (
    <div data-flow-chip={reading.flow} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: tk.bg.panel, borderBottom: `1px solid ${tk.border.default}` }}>
      <button ref={ref} type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 10px', border: 0, borderRadius: 999, cursor: 'pointer', touchAction: 'manipulation',
          background: tk.bg.field, color: tk.text.secondary, font: `550 12.5px ${fontFamily.ui}`, maxWidth: '100%', minWidth: 0,
        }}>
        <span style={{ font: `700 10px ${fontFamily.ui}`, letterSpacing: '0.06em', color: tk.text.muted }}>{FLOWS[reading.flow].label.toUpperCase()}</span>
        {cur && <><span style={{ width: 7, height: 7, borderRadius: '50%', background: colour(cur) }} /><span style={{ color: tk.text.primary }}>{STAGES[cur].label}</span></>}
        {reading.next && <><Icon name="chevR" size={11} style={{ color: tk.text.faint }} /><span style={{ color: tk.accent.text }}>next {STAGES[reading.next].label}</span></>}
        {notices.length > 0 && <span style={{ marginLeft: 2, padding: '0 6px', borderRadius: 999, background: alpha(tk.status.warning, 0.18), color: tk.status.warningText, fontSize: 11 }}>{notices.length}</span>}
        <Icon name="chevD" size={12} style={{ color: tk.text.faint }} />
      </button>
      {open && (
        <Popover anchorRef={ref} onClose={() => setOpen(false)} align="start" width={340} padding={12}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Stages reading={reading} vertical onPicked={() => setOpen(false)} />
            </div>
            {next && reading.next && section('What usually comes next', <NextBody reading={reading} next={next} onDone={() => setOpen(false)} />)}
            {notices.length > 0 && section('Notes', <NoticeList notices={notices} graph={graph} onShow={() => setOpen(false)} />)}
            {section('View', <><ViewToggles /><StageLegend flow={reading.flow} /></>)}
          </div>
        </Popover>
      )}
    </div>
  );
}
