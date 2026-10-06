/**
 * The Grid Rules editor (docs/grid-rules.md): a window with the rule types down the left, the
 * chosen type's own form in the middle (Count: born / survive switches; Stages: the same and the
 * number of states; Smooth: a template's sliders or your own update), and on the right a live
 * CPU preview with the shared settings (Start and run, Brush, Colours), folded with summaries
 * until opened.
 *
 * Everything writes the node's params (one undoable edit per change). The switches, sliders and
 * colours are live uniforms on the picture (no recompile); a select (type, neighbourhood,
 * template, start, board size, edges, steps) recompiles.
 */
import { useState, type ReactNode } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { BuilderNote, BuilderWindow } from '../builders/BuilderWindow';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { RulerSlider } from '../ui/RulerSlider';
import { Select } from '../ui/Select';
import { ColorSwatch } from '../ui/ColorPicker';
import { useFoldState } from '../NodeGraph/foldState';
import { RulePreview } from './RulePreview';
import { BlocksForm, PatternsForm } from './StencilForms';
import { BLOCK_PRESETS, PATTERN_PRESETS } from '../../gridRules/stencils';
import {
  BOARD_SIZES, COUNT_PRESETS, GRID_DEFAULTS, MAX_RADIUS, MAX_STATES, MAX_STEPS, RULE_TYPES, SMOOTH_NAMES, SMOOTH_PRESETS, STAGES_PRESETS,
  LOOKS, countsOf, customUpdateProblem, gridShape, matchingPreset, maxCount, parseRuleString, presetPatch, ruleString, ruleSummary,
  type GridPreset, type GridRuleType,
} from '../../gridRules/spec';
import { gridAsNodesProblem } from '../../store/gridRulesAsNodes';

/** The rule types this editor offers (Patterns and Blocks have their own forms). */
const EDITOR_RULE_TYPES: GridRuleType[] = ['count', 'stages', 'patterns', 'blocks', 'smooth'];

type P = Record<string, unknown>;
type Setter = (patch: P, immediate?: boolean) => void;

const num = (p: P, k: string) => (typeof p[k] === 'number' ? p[k] as number : GRID_DEFAULTS[k] as number);
const rgb = (p: P, k: string) => (Array.isArray(p[k]) ? p[k] as number[] : GRID_DEFAULTS[k] as number[]) as [number, number, number];

export function GridRulesEditor({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const tk = useTokens();
  const node = useNodeGraphStore(s => s.nodes.find(nd => nd.id === nodeId));
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const openAsNodes = useNodeGraphStore(s => s.openGridRulesAsNodes);
  if (!node) return null;
  const params: P = { ...GRID_DEFAULTS, ...node.params };
  const shape = gridShape(params);
  const set: Setter = (patch, immediate = false) => updateNodeParams(node.id, patch, immediate ? { immediate: true } : undefined);
  const problem = gridAsNodesProblem(node);
  const label = typeof node.params.label === 'string' && node.params.label.trim() ? node.params.label.trim() : 'Grid Rules';
  const typeLabel = RULE_TYPES.find(t => t.value === shape.type)?.label ?? 'Rule';
  return (
    <BuilderWindow
      prefsKey="grid-rules"
      title="Grid Rules" subtitle={`${label} · ${ruleSummary(params)}`} icon="grid" width={1180} height={760} onClose={onClose}
      left={{ label: 'Rule type', icon: 'grid', width: 230, content: <TypeRail value={shape.type} onChange={t => set(typeDefaults(t), true)} />, rail: expand => (
        <button type="button" onClick={expand} title="Show the rule types" aria-label="Show the rule types"
          style={{ width: 44, flexShrink: 0, border: 0, borderRight: `1px solid ${tk.border.subtle}`, background: tk.bg.subtle, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingTop: 14, color: tk.text.faint }}>
          <Icon name="chevR" size={14} /><Icon name="grid" size={15} />
          <span style={{ font: `650 10px ${fontFamily.ui}`, writingMode: 'vertical-rl', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{typeLabel}</span>
        </button>
      ) }}
      right={{ label: 'Preview', icon: 'eye', width: 340, content: (
        <div style={{ padding: '16px 16px 24px', display: 'flex', flexDirection: 'column', gap: 12, font: `12.5px ${fontFamily.ui}`, color: tk.text.primary }}>
          <RulePreview params={params} />
          <SharedSettings p={params} set={set} />
        </div>
      ) }}
      footer={<>
        <Button icon="nodes" disabled={!!problem} title={problem ?? 'Build the same simulation from ordinary nodes below this one, wired where it was, every node with a note.'}
          onClick={() => { if (openAsNodes(node.id)) onClose(); }}>
          Open as nodes
        </Button>
        <BuilderNote>{problem ?? 'Every change applies as you make it; switches and sliders never recompile.'}</BuilderNote>
        <span style={{ flex: 1 }} />
        <Button variant="primary" onClick={onClose}>Done</Button>
      </>}
    >
      <div style={{ flex: 1, padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 18, font: `12.5px ${fontFamily.ui}`, color: tk.text.primary }} data-testid="grid-rule-form">
        {shape.type === 'smooth' ? <SmoothForm p={params} set={set} />
          : shape.type === 'patterns' ? <PatternsForm p={params} set={set} />
          : shape.type === 'blocks' ? <BlocksForm p={params} set={set} />
          : <CountForm p={params} set={set} stages={shape.type === 'stages'} />}
      </div>
    </BuilderWindow>
  );
}

/** Switching type: the type's first preset, with its look (a working rule straight away). */
function typeDefaults(t: GridRuleType): P {
  if (t === 'stages') return { ruleType: t, ...presetPatch(STAGES_PRESETS.briansBrain) };
  if (t === 'smooth') return { ruleType: t, ...presetPatch(SMOOTH_PRESETS.heat) };
  if (t === 'patterns') return { ruleType: t, ...presetPatch(PATTERN_PRESETS.wireworld) };
  if (t === 'blocks') return { ruleType: t, ...presetPatch(BLOCK_PRESETS.sand) };
  return { ruleType: t, ...presetPatch(COUNT_PRESETS.life), ...LOOKS.count, brushState: 1 };
}

/** A template's look, when the template is picked without a preset. */
const SMOOTH_LOOKS: Record<string, P> = { diffusion: LOOKS.heat, waves: LOOKS.ripples, reaction: LOOKS.reaction, custom: LOOKS.heat };

// ── Pieces ──────────────────────────────────────────────────────────────────────────────────────

function TypeRail({ value, onChange }: { value: GridRuleType; onChange: (t: GridRuleType) => void }) {
  const tk = useTokens();
  return (
    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 4 }} role="radiogroup" aria-label="Rule type">
      <Caps>Rule type</Caps>
      {RULE_TYPES.filter(t => EDITOR_RULE_TYPES.includes(t.value)).map(t => {
        const on = t.value === value;
        return (
          <button key={t.value} type="button" role="radio" aria-checked={on} onClick={() => !on && onChange(t.value)}
            style={{
              textAlign: 'left', border: 0, borderRadius: radius.md, padding: '9px 10px', cursor: 'pointer',
              background: on ? tk.bg.selected : 'transparent', boxShadow: on ? `inset 0 0 0 1.5px ${tk.accent.base}` : 'none',
              color: tk.text.primary, display: 'flex', flexDirection: 'column', gap: 3,
            }}>
            <b style={{ font: `600 13px ${fontFamily.ui}`, color: on ? tk.accent.text : tk.text.primary }}>{t.label}</b>
            <span style={{ font: `11.5px ${fontFamily.ui}`, color: tk.text.muted, lineHeight: 1.35 }}>{t.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

function Caps({ children }: { children: ReactNode }) {
  const tk = useTokens();
  return <span style={{ font: `600 10.5px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: tk.text.faint, padding: '2px 2px 4px' }}>{children}</span>;
}

function Block({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const tk = useTokens();
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <b style={{ font: `600 13px ${fontFamily.ui}` }}>{title}</b>
        {hint && <span style={{ color: tk.text.muted, fontSize: 12, lineHeight: 1.4 }}>{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Presets({ table, p, set }: { table: Record<string, GridPreset>; p: P; set: Setter }) {
  const tk = useTokens();
  const current = matchingPreset(p);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {Object.entries(table).map(([key, pr]) => {
        const on = key === current;
        return (
          <button key={key} type="button" title={pr.hint} aria-pressed={on} onClick={() => set(presetPatch(pr), true)}
            style={{
              border: 0, cursor: 'pointer', padding: '5px 10px', borderRadius: radius.md, font: `500 12px ${fontFamily.ui}`,
              background: on ? tk.bg.selected : tk.bg.field, color: on ? tk.accent.text : tk.text.primary,
              boxShadow: `inset 0 0 0 ${on ? 1.5 : 1}px ${on ? tk.accent.base : tk.border.subtle}`,
            }}>
            {pr.label}
          </button>
        );
      })}
    </div>
  );
}

function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const tk = useTokens();
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '118px 1fr', alignItems: 'center', gap: 10 }} title={hint}>
      <span style={{ color: tk.text.secondary, fontSize: 12.5 }}>{label}</span>
      <div style={{ minWidth: 0 }}>{children}</div>
    </label>
  );
}

function Slider({ p, set, k, label, min, max, step = 0.01, integer = false, hint }: { p: P; set: Setter; k: string; label: string; min: number; max: number; step?: number; integer?: boolean; hint?: string }) {
  return (
    <Row label={label} hint={hint}>
      <RulerSlider ariaLabel={label} value={num(p, k)} min={min} max={max} step={step} integer={integer} defaultValue={GRID_DEFAULTS[k] as number} onChange={v => set({ [k]: v })} />
    </Row>
  );
}

/** A row of switches 0…max: on = the count is in the set. */
function CountSwitches({ label, mask, max, onChange, colour }: { label: string; mask: number; max: number; onChange: (mask: number) => void; colour: string }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ width: 92, color: tk.text.secondary, fontSize: 12.5, flexShrink: 0 }}>{label}</span>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }} role="group" aria-label={label}>
        {Array.from({ length: max + 1 }, (_, k) => {
          const on = ((Math.round(mask) >> k) & 1) === 1;
          return (
            <button key={k} type="button" role="checkbox" aria-checked={on} aria-label={`${label} with ${k}`} title={`${label} with ${k} live neighbour${k === 1 ? '' : 's'}`}
              onClick={() => onChange(Math.round(mask) ^ (1 << k))}
              style={{
                width: 32, height: 32, border: 0, borderRadius: radius.md, cursor: 'pointer', font: `600 13px ${fontFamily.mono}`,
                background: on ? colour : tk.bg.field, color: on ? '#fff' : tk.text.muted,
                boxShadow: on ? 'none' : `inset 0 0 0 1px ${tk.border.default}`,
              }}>
              {k}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Count and Stages ────────────────────────────────────────────────────────────────────────────

function CountForm({ p, set, stages }: { p: P; set: Setter; stages: boolean }) {
  const tk = useTokens();
  const s = gridShape(p);
  const max = maxCount(s.neighbourhood, s.radius, s.shape);
  const radiusMode = s.neighbourhood === 'radius';
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? ruleString(num(p, 'bornMask'), num(p, 'surviveMask'), max);
  const bad = text !== null && !parseRuleString(text);
  const bornColour = '#2f9e6a', surviveColour = tk.accent.base;
  return (
    <>
      <Block title="Presets" hint={stages ? 'Generations rules: a cell that stops surviving fades through dying stages before it is empty.' : 'Life-like rules: born on some neighbour counts, survive on others.'}>
        <Presets table={stages ? STAGES_PRESETS : COUNT_PRESETS} p={p} set={set} />
      </Block>
      <Block title="Neighbourhood" hint="Which cells round a cell are counted.">
        <Segmented<string> ariaLabel="Neighbourhood" value={s.neighbourhood} onChange={v => set(v === 'radius' ? { neighbourhood: v, bornLo: 34, bornHi: 45, surviveLo: 33, surviveHi: 57, radius: 5 } : { neighbourhood: v }, true)}
          options={[{ value: 'moore', label: 'Moore · 8' }, { value: 'vonNeumann', label: 'von Neumann · 4' }, { value: 'radius', label: 'Radius N' }]} />
        {radiusMode && (
          <>
            <Slider p={p} set={v => set(v, true)} k="radius" label="Radius" min={1} max={MAX_RADIUS} step={1} integer hint="How far the neighbourhood reaches, in cells." />
            <Row label="Shape">
              <Segmented<string> ariaLabel="Shape" size="sm" value={s.shape} onChange={v => set({ shape: v }, true)} options={[{ value: 'box', label: 'Box' }, { value: 'circle', label: 'Circle' }]} />
            </Row>
            <span style={{ color: tk.text.muted, fontSize: 12 }}>Counts up to {max} cells (itself not counted).</span>
          </>
        )}
      </Block>
      <Block title={stages ? 'Born and survive (state 1 counts)' : 'Born and survive'} hint={radiusMode ? 'Larger than Life: ranges of live-neighbour counts.' : 'Click a number to switch it: an empty cell with that many live neighbours is born; a live one survives.'}>
        {radiusMode ? (
          <>
            <Slider p={p} set={set} k="bornLo" label="Born from" min={0} max={max} step={1} integer />
            <Slider p={p} set={set} k="bornHi" label="Born to" min={0} max={max} step={1} integer />
            <Slider p={p} set={set} k="surviveLo" label="Survive from" min={0} max={max} step={1} integer />
            <Slider p={p} set={set} k="surviveHi" label="Survive to" min={0} max={max} step={1} integer />
          </>
        ) : (
          <>
            <CountSwitches label="Born on" mask={num(p, 'bornMask')} max={max} colour={bornColour} onChange={m => set({ bornMask: m }, true)} />
            <CountSwitches label="Survive on" mask={num(p, 'surviveMask')} max={max} colour={surviveColour} onChange={m => set({ surviveMask: m }, true)} />
            <Row label="As text" hint="B/S notation: B3/S23 is Life. Press Enter to use it.">
              <Field mono value={shown} invalid={bad} aria-label="Rule as text"
                onChange={e => setText(e.target.value)}
                onBlur={() => setText(null)}
                onKeyDown={e => {
                  if (e.key !== 'Enter') return;
                  const r = text ? parseRuleString(text) : null;
                  if (r) { set({ bornMask: r.born, surviveMask: r.survive }, true); setText(null); }
                }} />
            </Row>
          </>
        )}
      </Block>
      {stages && (
        <Block title="States" hint="Empty (0), on (1), then the dying stages. 3 is one dying stage (Brian's Brain).">
          <Slider p={p} set={set} k="states" label="States" min={2} max={MAX_STATES} step={1} integer />
          {!radiusMode && <span style={{ color: tk.text.muted, fontSize: 12 }}>
            {`S${countsOf(num(p, 'surviveMask'), max).join('')}/B${countsOf(num(p, 'bornMask'), max).join('')}/C${Math.round(num(p, 'states'))}`} in Golly's notation.
          </span>}
        </Block>
      )}
      <Explainer stages={stages} p={p} />
    </>
  );
}

function Explainer({ stages, p }: { stages: boolean; p: P }) {
  const tk = useTokens();
  const s = gridShape(p);
  const max = maxCount(s.neighbourhood, s.radius, s.shape);
  const born = s.neighbourhood === 'radius' ? `${num(p, 'bornLo')} to ${num(p, 'bornHi')}` : countsOf(num(p, 'bornMask'), max).join(', ') || 'no count';
  const surv = s.neighbourhood === 'radius' ? `${num(p, 'surviveLo')} to ${num(p, 'surviveHi')}` : countsOf(num(p, 'surviveMask'), max).join(', ') || 'no count';
  return (
    <div style={{ padding: '10px 12px', borderRadius: radius.md, background: alpha(tk.accent.base, 0.06), color: tk.text.secondary, lineHeight: 1.5, fontSize: 12.5 }}>
      <Icon name="info" size={13} style={{ verticalAlign: '-2px', marginRight: 6, color: tk.accent.base }} />
      Each step, every cell counts its live neighbours. An empty cell with {born} comes alive; a live cell with {surv} stays alive
      {stages ? `, any other starts dying and takes ${Math.max(0, Math.round(num(p, 'states')) - 2)} more step(s) to clear.` : '; every other cell is empty next step.'}
    </div>
  );
}

// ── Smooth ──────────────────────────────────────────────────────────────────────────────────────

function SmoothForm({ p, set }: { p: P; set: Setter }) {
  const tk = useTokens();
  const s = gridShape(p);
  const uProblem = s.template === 'custom' ? customUpdateProblem(String(p.customU ?? '')) : null;
  const vProblem = s.template === 'custom' ? customUpdateProblem(String(p.customV ?? '')) : null;
  const [draftU, setDraftU] = useState<string | null>(null);
  const [draftV, setDraftV] = useState<string | null>(null);
  return (
    <>
      <Block title="Template" hint="Continuous values instead of states: every cell runs the same small update.">
        <Segmented<string> ariaLabel="Template" value={s.template} onChange={v => set({ template: v, ...SMOOTH_LOOKS[v] }, true)}
          options={[{ value: 'diffusion', label: 'Diffusion' }, { value: 'waves', label: 'Waves' }, { value: 'reaction', label: 'Reaction–diffusion' }, { value: 'custom', label: 'Custom' }]} />
      </Block>
      <Block title="Presets">
        <Presets table={SMOOTH_PRESETS} p={p} set={set} />
      </Block>
      {s.template === 'diffusion' && (
        <Block title="Diffusion" hint="Every cell moves towards the average of its four neighbours, and cools a little.">
          <Slider p={p} set={set} k="spread" label="Spread" min={0} max={1} />
          <Slider p={p} set={set} k="decay" label="Cooling" min={0} max={0.1} step={0.001} />
        </Block>
      )}
      {s.template === 'waves' && (
        <Block title="Waves" hint="Two values per cell: the height now (u) and a step ago (v). Ripples spread and fade.">
          <Slider p={p} set={set} k="waveSpeed" label="Wave speed" min={0} max={1} />
          <Slider p={p} set={set} k="damping" label="Damping" min={0.9} max={1} step={0.001} />
        </Block>
      )}
      {s.template === 'reaction' && (
        <Block title="Reaction–diffusion" hint="Gray–Scott: chemical B eats A to make more B; A is fed in, B is taken away. Feed and Kill choose the pattern. Runs best at 8 steps a frame.">
          <Slider p={p} set={set} k="feed" label="Feed" min={0} max={0.1} step={0.0005} />
          <Slider p={p} set={set} k="kill" label="Kill" min={0} max={0.1} step={0.0005} />
          <Slider p={p} set={set} k="diffA" label="Spread A" min={0} max={1} />
          <Slider p={p} set={set} k="diffB" label="Spread B" min={0} max={1} />
        </Block>
      )}
      {s.template === 'custom' && (
        <Block title="Your update" hint="One expression each for the new u and v: the escape hatch. Whole numbers are fine (2 becomes 2.0).">
          <Row label="New u">
            <Field mono value={draftU ?? String(p.customU ?? '')} invalid={!!uProblem} aria-label="New u"
              onChange={e => { setDraftU(e.target.value); if (!customUpdateProblem(e.target.value)) set({ customU: e.target.value }); }} onBlur={() => setDraftU(null)} />
          </Row>
          {(draftU !== null ? customUpdateProblem(draftU) : uProblem) && <span style={{ color: tk.status.danger, fontSize: 12 }}>{draftU !== null ? customUpdateProblem(draftU) : uProblem}</span>}
          <Row label="New v">
            <Field mono value={draftV ?? String(p.customV ?? '')} invalid={!!vProblem} aria-label="New v"
              onChange={e => { setDraftV(e.target.value); if (!customUpdateProblem(e.target.value)) set({ customV: e.target.value }); }} onBlur={() => setDraftV(null)} />
          </Row>
          {(draftV !== null ? customUpdateProblem(draftV) : vProblem) && <span style={{ color: tk.status.danger, fontSize: 12 }}>{draftV !== null ? customUpdateProblem(draftV) : vProblem}</span>}
          <Slider p={p} set={set} k="knobA" label="a" min={0} max={1} step={0.001} />
          <Slider p={p} set={set} k="knobB" label="b" min={0} max={1} step={0.001} />
          <Slider p={p} set={set} k="knobC" label="c" min={0} max={1} step={0.001} />
          <Slider p={p} set={set} k="knobD" label="d" min={0} max={1} step={0.001} />
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 12px', fontSize: 12, color: tk.text.secondary }}>
            {SMOOTH_NAMES.map(x => (
              <span key={x.name} style={{ display: 'contents' }}>
                <code style={{ font: `600 12px ${fontFamily.mono}`, color: tk.text.primary }}>{x.name}</code>
                <span>{x.doc}</span>
              </span>
            ))}
          </div>
        </Block>
      )}
    </>
  );
}

// ── The shared settings: start and run, brush, colours ──────────────────────────────────────────

function Section({ id, title, summary, children }: { id: string; title: string; summary: string; children: ReactNode }) {
  const tk = useTokens();
  // Folded by default (remembered per section for the session): the fold store holds the ones opened.
  const key = `gridRules:open:${id}`;
  const open = useFoldState(s => !!s.folded[key]);
  const toggle = useFoldState(s => s.toggle);
  return (
    <section style={{ borderTop: `1px solid ${tk.border.subtle}`, paddingTop: 8 }}>
      <button type="button" aria-expanded={open} onClick={() => toggle(key)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, border: 0, background: 'transparent', padding: '4px 0', cursor: 'pointer', color: tk.text.primary, textAlign: 'left' }}>
        <Icon name={open ? 'chevD' : 'chevR'} size={14} style={{ color: tk.text.faint }} />
        <b style={{ font: `600 13px ${fontFamily.ui}` }}>{title}</b>
        {!open && <span style={{ marginLeft: 'auto', color: tk.text.muted, fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 190 }}>{summary}</span>}
      </button>
      {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0 4px' }}>{children}</div>}
    </section>
  );
}

const START_WORD: Record<string, string> = { noise: 'Noise', empty: 'Empty', image: 'Image', centre: 'Centre seed' };

function SharedSettings({ p, set }: { p: P; set: Setter }) {
  const s = gridShape(p);
  const discrete = s.type !== 'smooth';
  const top = s.type === 'stages' ? Math.round(num(p, 'states')) - 1 : 1;
  const boardLabel = BOARD_SIZES.find(b => b.scale === s.scale)?.label.split(' (')[0] ?? 'Coarse';
  const speed = s.steps > 1 ? `${s.steps} steps a frame` : `speed ${num(p, 'rate')}`;
  const deal = () => { set({ reset: 1 }, true); window.setTimeout(() => set({ reset: 0 }, true), 120); };
  return (
    <>
      <Section id="run" title="Start and run" summary={`${START_WORD[s.start]} · ${boardLabel} · ${speed} · ${s.wrap ? 'wrap' : 'walls'}`}>
        <Row label="Start">
          <Select ariaLabel="Start" value={s.start} onChange={v => set({ start: v }, true)}
            options={[{ value: 'noise', label: 'Noise' }, { value: 'empty', label: 'Empty' }, { value: 'image', label: 'Image (wire Start image)' }, { value: 'centre', label: 'Centre seed' }]} />
        </Row>
        {(s.start === 'noise' || s.start === 'centre') && <Slider p={p} set={set} k="density" label="Density" min={0} max={1} />}
        <Slider p={p} set={set} k="seed" label="Seed" min={0} max={100} step={1} integer />
        <Row label=""><Button size="sm" icon="dice" onClick={deal}>Deal a new board</Button></Row>
        <Row label="Board size">
          <Select ariaLabel="Board size" style={{ maxWidth: '100%' }} value={String(p.board ?? '0.125')} onChange={v => set({ board: v }, true)} options={BOARD_SIZES.map(b => ({ value: b.value, label: b.label.replace(' at 1080p', '') }))} />
        </Row>
        <Row label="Edges">
          <Segmented<string> ariaLabel="Edges" size="sm" value={s.wrap ? 'wrap' : 'walls'} onChange={v => set({ edges: v }, true)} options={[{ value: 'wrap', label: 'Wrap' }, { value: 'walls', label: 'Walls' }]} />
        </Row>
        <Slider p={p} set={v => set(v, true)} k="steps" label="Steps a frame" min={1} max={MAX_STEPS} step={1} integer hint="The rule runs this many times each frame (the board Pass's Repeat)." />
        {s.steps === 1 && <Slider p={p} set={set} k="rate" label="Speed" min={0} max={1} hint="Below 1, the board steps on some frames only: 0.25 is every fourth." />}
      </Section>
      <Section id="brush" title="Brush" summary={`${discrete ? `paints ${Math.round(num(p, 'brushState'))}` : `sets ${num(p, 'brushState')}`} · ${num(p, 'brushRadius')} cells`}>
        <Slider p={p} set={set} k="brushRadius" label="Size (cells)" min={0.5} max={40} step={0.5} />
        {discrete
          ? <Slider p={p} set={set} k="brushState" label="Paints state" min={0} max={top} step={1} integer hint="0 erases." />
          : <Slider p={p} set={set} k="brushState" label="Sets value" min={-1} max={1} />}
        {discrete && <Slider p={p} set={set} k="brushFill" label="Fill" min={0} max={1} hint="The share of cells under the brush it paints each frame." />}
        <span style={{ fontSize: 12, lineHeight: 1.4, opacity: 0.75 }}>Hold the mouse button over the picture to paint: in the Studio preview, on the Play page and on exported pages. Paint (on the card's Play controls) paints without the button.</span>
      </Section>
      <Section id="colours" title="Colours" summary={discrete ? `afterglow ${num(p, 'afterglow')}` : `contrast ${num(p, 'gain')}`}>
        <ColourRows p={p} set={set} />
        {discrete ? (
          <>
            <Slider p={p} set={set} k="afterglow" label="Afterglow" min={0} max={0.99} />
            <Slider p={p} set={set} k="ageRate" label="Ageing" min={0} max={0.2} step={0.001} />
            <Slider p={p} set={set} k="ageFade" label="Age fade" min={0} max={1} />
          </>
        ) : <Slider p={p} set={set} k="gain" label="Contrast" min={0} max={8} />}
      </Section>
    </>
  );
}

function ColourRows({ p, set }: { p: P; set: Setter }) {
  const s = gridShape(p);
  const rows: Array<[string, string]> = s.type === 'smooth'
    ? [['color0', 'Low'], ['color1', 'Second'], ['color2', 'Third'], ['color3', 'High']]
    : s.type === 'patterns' || s.type === 'blocks'
      ? [...Array.from({ length: Math.max(2, Math.min(8, Math.round(Number(p.states)))) }, (_, k) => [`color${k}`, k === 0 ? 'State 0 (empty)' : `State ${k}`] as [string, string]), ['glowColor', 'Afterglow'], ['oldColor', 'Old cells']]
    : [['color0', 'Empty'], ['color1', 'On'], ...(s.type === 'stages' ? [['color2', 'First dying'], ['color3', 'Last dying']] as Array<[string, string]> : []), ['glowColor', 'Afterglow'], ['oldColor', 'Old cells']];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      {rows.map(([k, label]) => <ColorSwatch key={k} label={label} value={rgb(p, k)} onChange={v => set({ [k]: v })} size="sm" />)}
    </div>
  );
}
