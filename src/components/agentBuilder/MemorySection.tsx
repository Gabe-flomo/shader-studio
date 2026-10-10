/**
 * The Agent Builder's Memory section (docs/agent-builder.md "Memory"): the walker's named memories,
 * each with its type picture, its slot and its live range; the operation cards that change them
 * (count up when…, start a timer, toggle, set on / off, remember where it was, remember or add up
 * what it smells, decay, reset, or a line you write), each with its "Only when…" as its trigger;
 * and the pieces other sections use: "× a memory" on a slider (TimesChip), Look's "colour by a
 * memory" (MemoryColourRow), and the viewport lens that colours the walkers by the memory being
 * edited (MemoryLens, drawn by the agent runner through the species spotlight's canvas).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { Menu, type MenuItem } from '../ui/Menu';
import { Segmented } from '../ui/Choice';
import { agentSpotRegistry } from '../../lib/agentRunner';
import type { ViewRect } from '../builders/studio/LiveViewport';
import {
  type AgentMemory, type AgentRuleSet, type ChannelRef, type MemoryTimes, type MemoryType, type RuleAction,
} from '../../agentRules/spec';
import { MEMORY_SLOTS, checkMemoryExpr, exprNames, memorySlots, slotsUsed } from '../../agentRules/memory';
import { type CardRead, patchAt, removeAt, setMemWhen, setOnAt, setOnlyWhen } from '../../agentBuilder/behaviours';
import {
  MEMORY_TYPE_ORDER, MEMORY_TYPE_WORDS, OP_CARDS, addMemory, addOpCard, defaultMemRange, memoryLensSlot, opCardOf, opCardsFor, patchMemory, removeMemory, renameMemory, roomFor, timesMemories,
} from '../../agentBuilder/memory';
import { smellChips } from '../../agentBuilder/cards';
import { MAP_STOPS, TRAIL_HEX } from '../../agentBuilder/hood';
import { BehaviourCard, ChipRow, SettingRow, SliderSetting } from './BehaviourCard';
import { OnlyWhenLine } from './OnlyWhenLine';

type MemAct = Extract<RuleAction, { kind: 'mem' }>;
const r2 = (v: number) => String(Math.round(v * 100) / 100).replace('-', '−');
const heatCss = `linear-gradient(90deg, ${MAP_STOPS.heat.map(c => `rgb(${c.map(v => Math.round(v * 255)).join(',')})`).join(', ')})`;

// ── Live ranges (from the lens canvas: the runner's 4096-walker sample) ───────

type Ranges = Array<[number, number]> | null;
let ranges: Ranges = null;
const listeners = new Set<() => void>();
const setRanges = (r: Ranges) => { ranges = r; for (const l of listeners) l(); };
const useRanges = () => useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => ranges);
const parseRanges = (s: string | undefined): Ranges => {
  if (!s) return null;
  const out = s.split(';').map(p => p.split(',').map(Number) as [number, number]);
  return out.length === 6 && out.every(([a, b]) => Number.isFinite(a) && Number.isFinite(b)) ? out : null;
};
/** A memory's live range (min / max over the sampled live walkers), by its slot of E. */
function rangeOf(set: AgentRuleSet, m: AgentMemory, r: Ranges): [number, number] | null {
  const sl = memorySlots(set).get(m.id);
  if (!sl || !r) return null;
  const vals = [...sl].map(c => r[2 + 'xyzw'.indexOf(c)]);
  return [Math.min(...vals.map(v => v[0])), Math.max(...vals.map(v => v[1]))];
}

// ── The type pictures ────────────────────────────────────────────────────────

export function MemoryGlyph({ type, size = 32 }: { type: MemoryType; size?: number }) {
  const tk = useTokens();
  const a = tk.accent.base, ink = tk.text.secondary;
  const body = (() => {
    switch (type) {
      case 'counter': return <><rect x={8} y={12} width={24} height={16} rx={4} fill="none" stroke={ink} strokeWidth={1.4} /><text x={20} y={24.5} textAnchor="middle" fontSize={10} fontWeight={700} fill={a} fontFamily={fontFamily.mono}>+1</text></>;
      case 'timer': return <><circle cx={20} cy={21} r={10} fill="none" stroke={ink} strokeWidth={1.5} /><path d="M20 21 V14 M20 21 L25 24" stroke={a} strokeWidth={1.8} strokeLinecap="round" /><path d="M17 9 h6" stroke={ink} strokeWidth={1.5} strokeLinecap="round" /></>;
      case 'flag': return <><rect x={8} y={14} width={24} height={12} rx={6} fill={alpha(a, 0.25)} stroke={a} strokeWidth={1.4} /><circle cx={26} cy={20} r={4.2} fill={a} /></>;
      case 'value': return <><path d="M9 29 V11" stroke={ink} strokeWidth={1.4} /><path d="M9 29 H31" stroke={ink} strokeWidth={1.4} /><circle cx={21} cy={17} r={3.4} fill={a} /><path d="M9 17 H17.6" stroke={a} strokeWidth={1.4} strokeDasharray="2 2" /></>;
      case 'position': return <><path d="M20 31 C 13 23, 11 19, 11 16 a9 9 0 0 1 18 0 c0 3 -2 7 -9 15 z" fill={alpha(a, 0.2)} stroke={a} strokeWidth={1.5} /><circle cx={20} cy={16} r={3} fill={ink} /></>;
      case 'level': return <><rect x={13} y={8} width={14} height={24} rx={3} fill="none" stroke={ink} strokeWidth={1.4} /><rect x={15} y={18} width={10} height={12} rx={1.5} fill={a} /><path d="M30 13 v6 M28 17 l2 2 l2 -2" stroke={a} strokeWidth={1.3} fill="none" strokeLinecap="round" /></>;
    }
  })();
  return (
    <span style={{ width: size, height: size, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: tk.bg.field }}>
      <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>{body}</svg>
    </span>
  );
}

// ── × a memory on a slider ──────────────────────────────────────────────────

/** "× energy" beside a slider: its number times a memory (a timer as a fading strength). */
export function TimesChip({ set, times, onChange, id }: { set: AgentRuleSet; times: MemoryTimes | undefined; onChange: (t: MemoryTimes | undefined) => void; id: string }) {
  const tk = useTokens();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const mems = timesMemories(set);
  const m = times ? set.memories?.find(x => x.id === times.memory) : undefined;
  if (!mems.length && !m) return null;
  const items: MenuItem[] = [
    { heading: 'Multiply by a memory' },
    { label: 'Nothing (plain)', onSelect: () => onChange(undefined) },
    ...mems.flatMap(x => [
      { label: `× ${x.name}`, hint: MEMORY_TYPE_WORDS[x.type].label, onSelect: () => onChange({ memory: x.id }) } as MenuItem,
      ...(x.type === 'timer' || x.type === 'counter' ? [{ label: `× fading with ${x.name}`, hint: 'e^(−0.15 × it): weaker the bigger it is', onSelect: () => onChange({ memory: x.id, fade: 0.15 }) } as MenuItem] : []),
    ]),
  ];
  return (
    <>
      <button type="button" data-times-chip={id} title="Multiply this by one of its memories (speed × energy)"
        onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4 }); }}
        style={{ height: 22, padding: '0 8px', borderRadius: 11, border: 0, cursor: 'pointer', font: `600 11px ${fontFamily.ui}`,
          background: m ? alpha(tk.accent.base, 0.14) : 'none', color: m ? tk.accent.text : tk.text.faint, boxShadow: m ? 'none' : `inset 0 0 0 1px ${tk.border.default}` }}>
        × {m ? (times!.fade ? `fading with ${m.name}` : m.name) : 'memory'}
      </button>
      {menu && <Menu x={menu.x} y={menu.y} title="Multiply by a memory" onClose={() => setMenu(null)} items={items} />}
    </>
  );
}

// ── The viewport lens ────────────────────────────────────────────────────────

/**
 * While the Memory section is open: the runner samples the memories' ranges into this canvas
 * (`dataset.ranges`), and with a memory picked draws every live walker coloured by it on the heat
 * map (its range lo → hi) over the dimmed picture.
 */
export function MemoryLens({ groupId, set, memoryId, image }: { groupId: string; set: AgentRuleSet; memoryId: string | null; image: ViewRect }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRanges();
  const m = memoryId ? set.memories?.find(x => x.id === memoryId) : undefined;
  const slot = m ? memoryLensSlot(set, m.id) : null;
  const range = m ? (rangeOf(set, m, live) ?? defaultMemRange(m)) : null;
  // A flat range (every walker the same) still shows: widen it a little round the value.
  const lo = range ? (range[1] - range[0] < 1e-4 ? range[0] - 0.5 : range[0]) : 0;
  const hi = range ? (range[1] - range[0] < 1e-4 ? range[1] + 0.5 : range[1]) : 1;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.dataset.mem = '';
    agentSpotRegistry.register(groupId, c);
    const t = setInterval(() => setRanges(parseRanges(c.dataset.ranges)), 300);
    return () => { clearInterval(t); agentSpotRegistry.unregister(groupId); setRanges(null); };
  }, [groupId]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.dataset.mem = slot ?? '';
    c.dataset.memRange = `${lo},${hi}`;
  }, [slot, lo, hi]);
  return (
    <div data-memory-lens={m?.name ?? ''} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {m && <div style={{ position: 'absolute', inset: 0, background: 'rgba(8,8,12,0.72)' }} />}
      <canvas ref={ref} width={640} height={360} style={{ position: 'absolute', left: image.x, top: image.y, width: image.w, height: image.h, opacity: m ? 1 : 0, mixBlendMode: 'screen' }} />
      {m && (
        <div data-memory-lens-legend style={{ position: 'absolute', left: 12, top: 12, display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', borderRadius: 10,
          background: 'rgba(13,13,18,0.82)', color: '#fff', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.16)', font: `600 11.5px ${fontFamily.ui}` }}>
          <span>Coloured by {m.name}{m.type === 'position' ? ' (its x)' : ''}</span>
          <span style={{ width: 160, height: 8, borderRadius: 4, background: heatCss }} />
          <span style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 500, opacity: 0.8, fontFamily: fontFamily.mono, fontSize: 10.5 }}><span>{r2(lo)}</span><span>{r2(hi)}</span></span>
        </div>
      )}
    </div>
  );
}

// ── Look's seam: colour by a memory ─────────────────────────────────────────

/** "Colour by a memory": each walker its memory on the heat map (Look; also in the Memory section). */
export function MemoryColourRow({ set, update, onFocus }: { set: AgentRuleSet; update: (s: AgentRuleSet) => void; onFocus?: (s: string | undefined) => void }) {
  const mems = timesMemories(set);
  const live = useRanges();
  if (!mems.length) return null;
  const cb = set.colourBy;
  const options = [{ value: '', label: 'Its kind / state' }, ...mems.map(m => ({ value: m.id, label: m.name }))];
  const pick = (id: string) => {
    if (!id) { const { colourBy: _c, ...rest } = set; update(rest as AgentRuleSet); return; }
    const m = mems.find(x => x.id === id)!;
    const [lo, hi] = rangeOf(set, m, live) ?? defaultMemRange(m);
    update({ ...set, colourBy: { memory: id, lo: Math.min(lo, 0), hi: hi > lo ? hi : lo + 1 } });
  };
  return (
    <div data-memory-colour style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SettingRow id="colourBy" label="Colour by a memory" hint="Each walker in its memory's colour on the heat map (Draw agents colours by its own colour)." onFocus={onFocus}>
        <ChipRow label="Colour by a memory" options={options} value={cb?.memory ?? ''} onChange={pick} />
      </SettingRow>
      {cb && <>
        <SliderSetting id="colourLo" label="Black at" value={cb.lo} min={-2} max={10} step={0.01} onFocus={onFocus} onChange={v => update({ ...set, colourBy: { ...cb, lo: v } })} />
        <SliderSetting id="colourHi" label="White at" value={cb.hi} min={-2} max={10} step={0.01} onFocus={onFocus} onChange={v => update({ ...set, colourBy: { ...cb, hi: v } })} />
      </>}
    </div>
  );
}

// ── The section ──────────────────────────────────────────────────────────────

export function MemorySection({ set, sp, update, cards, picked, onPick, onFocusSetting, intro, d3 = false }: {
  set: AgentRuleSet; sp: number; update: (s: AgentRuleSet) => void;
  /** Every card of the kind (reading order): the memory ones are this section's. */
  cards: readonly CardRead[];
  /** The memory being edited (the viewport colours the walkers by it). */
  picked: string | null; onPick: (id: string | null) => void;
  onFocusSetting: (s: string | undefined) => void;
  intro?: ReactNode;
  d3?: boolean;
}) {
  const tk = useTokens();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const live = useRanges();
  const mems = set.memories ?? [];
  const slots = memorySlots(set);
  const used = slotsUsed(set);
  const ops = cards.filter(c => c.card === 'memory');
  const add = (t: MemoryType) => { const r = addMemory(set, t); if (r) { update(r.set); onPick(r.id); } };
  return (
    <div data-memory-section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {intro}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ fontSize: 12, fontWeight: 650, color: tk.text.secondary, flex: 1 }}>Its memories</b>
        <span data-memory-slots style={{ fontSize: 11, color: tk.text.faint }} title="Each walker keeps four more numbers (More memory, a fifth state texture). A place takes two.">{used} of {MEMORY_SLOTS} numbers</span>
      </div>
      {mems.length === 0 && <span style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.45 }}>No memories yet. Add one: each walker then keeps it from step to step, and the cards below change it.</span>}
      {mems.map(m => {
        const sl = slots.get(m.id);
        const rg = rangeOf(set, m, live);
        const isPicked = picked === m.id;
        const mine = ops.filter(c => (c.action as MemAct).memory === m.id);
        return (
          <section key={m.id} data-memory={m.name} data-memory-picked={isPicked || undefined}
            style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 12, borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 ${isPicked ? 1.5 : 1}px ${isPicked ? alpha(tk.accent.base, 0.6) : tk.border.default}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button type="button" data-memory-pick={m.name} onClick={() => onPick(isPicked ? null : m.id)} title={isPicked ? 'Stop colouring the walkers by it' : 'Colour the walkers by it in the picture'}
                style={{ padding: 0, border: 0, background: 'none', cursor: 'pointer' }}>
                <MemoryGlyph type={m.type} />
              </button>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                <NameInput value={m.name} onCommit={v => update(renameMemory(set, m.id, v))} />
                <span style={{ fontSize: 11, color: tk.text.muted, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span>{MEMORY_TYPE_WORDS[m.type].label}</span>
                  <span style={{ fontFamily: fontFamily.mono, color: tk.text.faint }}>{sl ? `E.${sl}` : 'no room'}</span>
                  <span data-memory-range={m.name} style={{ fontFamily: fontFamily.mono }}>{rg ? `${r2(rg[0])} … ${r2(rg[1])}` : '— live range'}</span>
                </span>
              </span>
              <button type="button" data-memory-colour-toggle={m.name} aria-pressed={isPicked} onClick={() => onPick(isPicked ? null : m.id)} title="Colour the walkers by it in the picture"
                style={{ width: 26, height: 26, padding: 0, border: 0, borderRadius: 7, cursor: 'pointer', background: isPicked ? alpha(tk.accent.base, 0.16) : 'none', color: isPicked ? tk.accent.text : tk.text.faint, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="eye" size={14} />
              </button>
              <button type="button" data-memory-remove={m.name} aria-label={`Take ${m.name} away`} title={`Take ${m.name} away (and the cards that change it)`} onClick={() => { if (isPicked) onPick(null); update(removeMemory(set, m.id)); }}
                style={{ width: 24, height: 24, padding: 0, border: 0, borderRadius: 7, background: 'none', color: tk.text.faint, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={13} />
              </button>
            </div>
            {(isPicked || m.type === 'level') && m.type !== 'position' && (
              <SliderSetting id={`start:${m.name}`} label="Starts at" hint="Its value on a walker's first step (0 unless you set it)." value={m.start ?? 0} min={m.type === 'flag' ? 0 : -1} max={m.type === 'flag' ? 1 : m.type === 'timer' ? 10 : 2} step={m.type === 'flag' ? 1 : 0.01}
                onFocus={onFocusSetting} onChange={v => update(patchMemory(set, m.id, { start: v || undefined }))} />
            )}
            {m.type === 'level' && (
              <SliderSetting id={`fade:${m.name}`} label="Fades (a second)" hint="The share of itself it loses each second, by itself." value={m.fade ?? 0} min={0} max={3} step={0.01}
                onFocus={onFocusSetting} onChange={v => update(patchMemory(set, m.id, { fade: v }))} />
            )}
            {mine.map(c => <OpCard key={c.key} c={c} set={set} sp={sp} update={update} onFocus={onFocusSetting} d3={d3} />)}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {opCardsFor(m).map(o => (
                <button key={o.id} type="button" data-op-add={`${m.name}:${o.id}`} title={o.hint} onClick={() => { const r = addOpCard(set, sp, o.id, m.id); if (r) update(r.set); }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 26, padding: '0 9px 0 7px', border: `1px dashed ${tk.border.default}`, borderRadius: 999, background: 'none', cursor: 'pointer', color: tk.text.secondary, font: `500 11.5px ${fontFamily.ui}` }}>
                  <Icon name="plus" size={11} />{o.label.replace(' when …', '').replace(' on …', '')}
                </button>
              ))}
            </div>
          </section>
        );
      })}
      <div>
        <button type="button" data-memory-add onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4 }); }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px 0 10px', border: `1px dashed ${tk.border.default}`, borderRadius: 999, background: 'none', cursor: 'pointer', color: tk.text.secondary, font: `600 12px ${fontFamily.ui}` }}>
          <Icon name="plus" size={12} />Add a memory
        </button>
        {menu && <Menu x={menu.x} y={menu.y} title="Add a memory" onClose={() => setMenu(null)}
          items={[{ heading: 'What it remembers' }, ...MEMORY_TYPE_ORDER.map(t => ({ label: MEMORY_TYPE_WORDS[t].label, hint: roomFor(set, t) ? MEMORY_TYPE_WORDS[t].hint : 'No room: four numbers between them.', disabled: !roomFor(set, t), onSelect: () => add(t) }))]} />}
      </div>
      {mems.length > 0 && <MemoryColourRow set={set} update={update} onFocus={onFocusSetting} />}
    </div>
  );
}

function NameInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const tk = useTokens();
  const [text, setText] = useState<string | null>(null);
  return (
    <input data-memory-name value={text ?? value} spellCheck={false} aria-label="Memory name" onFocus={() => setText(value)}
      onChange={e => setText(e.target.value)} onBlur={() => { if (text !== null && text.trim() && text !== value) onCommit(text); setText(null); }}
      onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); if (e.key === 'Escape') { setText(null); (e.currentTarget as HTMLInputElement).blur(); } }}
      style={{ minWidth: 0, height: 22, padding: '0 4px', marginLeft: -4, border: 0, borderRadius: 5, outline: 'none', background: 'transparent', color: tk.text.primary, font: `650 13.5px ${fontFamily.ui}` }} />
  );
}

/** One operation card: its words, its switch, its settings and its "Only when…" trigger. */
function OpCard({ c, set, sp, update, onFocus, d3 }: { c: CardRead; set: AgentRuleSet; sp: number; update: (s: AgentRuleSet) => void; onFocus: (s: string | undefined) => void; d3: boolean }) {
  const a = c.action as MemAct;
  const m = set.memories?.find(x => x.id === a.memory);
  const op = opCardOf(a, m);
  const def = OP_CARDS.find(o => o.id === op)!;
  const patch = (p: Partial<MemAct>) => update(patchAt<MemAct>(set, sp, c.at, p));
  const chips = smellChips(set).map(x => ({ ...x, dot: x.value === 'own' ? undefined : TRAIL_HEX[x.value as number] }));
  const v = a.value ?? 0;
  const body = (() => {
    switch (op) {
      case 'countUp': case 'countDown': return (
        <SliderSetting id="by" label={op === 'countUp' ? 'Up by' : 'Down by'} value={Math.abs(v)} min={0} max={10} step={0.01} onFocus={onFocus} onChange={x => patch({ value: op === 'countUp' ? x : -x })}
          right={<Segmented size="sm" ariaLabel="Each step or a second" value={a.perSecond ? 's' : 'step'} onChange={x => patch({ perSecond: x === 's' || undefined })} options={[{ value: 'step' as const, label: 'Each step' }, { value: 's' as const, label: 'A second' }]} />} />
      );
      case 'setTo': return <SliderSetting id="to" label="To" value={v} min={-2} max={10} step={0.01} onFocus={onFocus} onChange={x => patch({ value: x })} />;
      case 'decay': return <SliderSetting id="decay" label="Loses (a second)" hint="The share of itself it loses each second." value={v} min={0} max={4} step={0.01} onFocus={onFocus} onChange={x => patch({ value: x })} />;
      case 'smell': case 'sum': return <>
        <SettingRow id="smells" label="What it smells" onFocus={onFocus}>
          <ChipRow label="What it smells" options={chips} value={a.channel ?? 'own'} onChange={x => patch({ channel: x as ChannelRef })} />
        </SettingRow>
        {op === 'sum' && <SliderSetting id="gain" label="Times" value={v || 1} min={0} max={5} step={0.01} onFocus={onFocus} onChange={x => patch({ value: x })} />}
      </>;
      case 'expr': return <ExprLine set={set} memory={m} text={a.expr ?? ''} d3={d3} onCommit={expr => patch({ expr })} />;
      default: return null;
    }
  })();
  return (
    <BehaviourCard id={c.key} picture="advanced" title={def.label.replace(' …', '').replace(' when', '')} hint={def.hint} summary={m ? `${m.name}` : 'a memory that is gone'}
      on={c.on} onToggle={on => update(setOnAt(set, sp, c.at, on))} onRemove={() => update(removeAt(set, sp, c.at))}
      onlyWhen={<OnlyWhenLine id={c.key} set={set} sp={sp} when={c.when} memWhen={c.memWhen ?? null} onFocus={onFocus}
        onChange={w => update(setOnlyWhen(set, sp, c.at, w))} onMemChange={w => update(setMemWhen(set, sp, c.at, w))} />}>
      {body}
    </BehaviourCard>
  );
}

/**
 * The expression line: `name = …`, the names it may use offered as you type (Tab takes the first),
 * checked as the GPU will (glslPatterns' parse and typecheck); only a line that checks is kept.
 */
function ExprLine({ set, memory, text, d3, onCommit }: { set: AgentRuleSet; memory: AgentMemory | undefined; text: string; d3: boolean; onCommit: (t: string) => void }) {
  const tk = useTokens();
  const [draft, setDraft] = useState(text);
  const [caret, setCaret] = useState(text.length);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(text), [text]);
  const check = memory ? checkMemoryExpr(set, memory.id, draft, d3) : { ok: false, error: 'That memory is gone.' };
  const names = useMemo(() => exprNames(set, d3), [set, d3]);
  const word = /([A-Za-z_][\w.]*)$/.exec(draft.slice(0, caret))?.[1] ?? '';
  const offers = word ? names.filter(n => n.name.startsWith(word) && n.name !== word).slice(0, 8) : [];
  const take = (name: string) => {
    const next = draft.slice(0, caret - word.length) + name + draft.slice(caret);
    setDraft(next); setCaret(caret - word.length + name.length);
    const c = memory && checkMemoryExpr(set, memory.id, next, d3);
    if (c?.ok) onCommit(next);
    requestAnimationFrame(() => ref.current?.focus());
  };
  return (
    <div data-expr-line={memory?.name} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ font: `600 12px ${fontFamily.mono}`, color: tk.text.secondary, flexShrink: 0 }}>{memory?.name ?? '?'} =</span>
        <input ref={ref} data-expr-input value={draft} spellCheck={false} aria-label={`${memory?.name ?? 'memory'} =`} aria-invalid={!check.ok}
          onChange={e => { setDraft(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); const c = memory && checkMemoryExpr(set, memory.id, e.target.value, d3); if (c?.ok) onCommit(e.target.value); }}
          onSelect={e => setCaret((e.target as HTMLInputElement).selectionStart ?? draft.length)}
          onKeyDown={e => { if (e.key === 'Tab' && offers.length) { e.preventDefault(); take(offers[0].name); } }}
          style={{ flex: 1, minWidth: 0, height: 28, padding: '0 8px', borderRadius: radius.control, border: 0, outline: 'none', background: tk.bg.field, color: tk.text.primary, font: `500 12px ${fontFamily.mono}`,
            boxShadow: `inset 0 0 0 1px ${check.ok ? tk.border.default : tk.status.danger}` }} />
      </span>
      {offers.length > 0 && (
        <span data-expr-offers style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {offers.map(n => (
            <button key={n.name} type="button" data-expr-offer={n.name} title={n.hint} onMouseDown={e => e.preventDefault()} onClick={() => take(n.name)}
              style={{ height: 22, padding: '0 8px', borderRadius: 11, border: 0, cursor: 'pointer', background: tk.bg.field, color: tk.text.secondary, font: `500 11px ${fontFamily.mono}`, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }}>
              {n.name}
            </button>
          ))}
        </span>
      )}
      {!check.ok && <span data-expr-error role="alert" style={{ fontSize: 11.5, color: tk.status.danger, lineHeight: 1.4 }}>{check.error}</span>}
      <span style={{ fontSize: 11, color: tk.text.faint, lineHeight: 1.4 }}>Names: {names.map(n => n.name).join(', ')}.</span>
    </div>
  );
}

