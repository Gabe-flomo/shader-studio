/**
 * The Grid Rules editor (docs/grid-rules.md): a window of tabs, one section at a time, each with
 * its one-line "How this works" (components/builders/builderLayout.ts gridRulesTabs):
 *
 *   Presets · Neighbourhood · Born & Survive (Stages / Stencils / Blocks / Smooth) · Start · Brush · Colours
 *
 * and on the right a live CPU preview. Born & Survive explains itself: each count switch is a 3×3
 * picture of a cell with that many live neighbours, the rule reads back as one sentence, and a
 * mini-board runs it on a Glider, a Blinker, an R-pentomino or a random blob (BornSurvive.tsx,
 * gridRules/explain.ts). Rarely used settings are folded with summaries. The tab is remembered.
 *
 * Everything writes the node's params (one undoable edit per change). The switches, sliders and
 * colours are live uniforms on the picture (no recompile); a select (type, neighbourhood,
 * template, start, board size, edges, steps) recompiles.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { BuilderFold, BuilderHelp, BuilderNote, BuilderWindow, HintLabel, useRememberedTab } from '../builders/BuilderWindow';
import { gridRulesTabs } from '../builders/builderLayout';
import type { HelpExample } from '../builders/helpContent';
import { AssistList, useTypeAhead } from '../builders/TypeAhead';
import { wordAssist, type Completion } from '../../lang/complete';
import { GRID_PARAM_DEFS } from '../../nodes/definitions/gridRules';
import { GRID_VIEWS, gridViewMode } from '../../gridRules/glsl';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { Field } from '../ui/Field';
import { RulerSlider } from '../ui/RulerSlider';
import { Select } from '../ui/Select';
import { ColorSwatch } from '../ui/ColorPicker';
import { MiniBoard, RulePreview } from './RulePreview';
import { DyingStages, NeighbourhoodPictures, PictureSwitches, RuleSentence } from './BornSurvive';
import { BlocksForm, PatternsForm } from './StencilForms';
import { BLOCK_PRESETS, PATTERN_PRESETS } from '../../gridRules/stencils';
import { rangeCounts } from '../../gridRules/explain';
import {
  BOARD_SIZES, COUNT_PRESETS, GRID_DEFAULTS, MAX_RADIUS, MAX_STATES, MAX_STEPS, RULE_TYPES, SMOOTH_NAMES, SMOOTH_PRESETS, STAGES_PRESETS,
  LOOKS, SMOOTH_FUNCTIONS, countsOf, customUpdateProblem, gridShape, matchingPreset, maxCount, parseRuleString, presetPatch, ruleString, ruleSummary,
  type GridPreset, type GridRuleType,
} from '../../gridRules/spec';
import { gridAsNodesProblem } from '../../store/gridRulesAsNodes';
import type { GraphNode } from '../../types/nodeGraph';

/** The rule types this editor offers (Patterns and Blocks have their own forms). */
const EDITOR_RULE_TYPES: GridRuleType[] = ['count', 'stages', 'patterns', 'blocks', 'smooth'];

type P = Record<string, unknown>;
type Setter = (patch: P, immediate?: boolean) => void;

const num = (p: P, k: string) => (typeof p[k] === 'number' ? p[k] as number : GRID_DEFAULTS[k] as number);
const rgb = (p: P, k: string) => (Array.isArray(p[k]) ? p[k] as number[] : GRID_DEFAULTS[k] as number[]) as [number, number, number];

export function GridRulesEditor({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const node = useNodeGraphStore(s => s.nodes.find(nd => nd.id === nodeId));
  const type = node ? gridShape({ ...GRID_DEFAULTS, ...node.params }).type : 'count';
  const tabs = gridRulesTabs(type);
  // The first time: Presets. A tab the rule type doesn't have (Neighbourhood on Smooth): the rule's own tab.
  const [tab, setTab] = useRememberedTab('grid-rules', tabs, 'presets', 'rule');
  if (!node) return null;
  return <GridRulesWindow node={node} tab={tab} setTab={setTab} tabs={tabs} onClose={onClose} />;
}

function GridRulesWindow({ node, tab, setTab, tabs, onClose }: {
  node: GraphNode; tab: string; setTab: (t: string) => void; tabs: ReturnType<typeof gridRulesTabs>; onClose: () => void;
}) {
  const tk = useTokens();
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const openAsNodes = useNodeGraphStore(s => s.openGridRulesAsNodes);
  const params: P = { ...GRID_DEFAULTS, ...node.params };
  const shape = gridShape(params);
  const set: Setter = (patch, immediate = false) => updateNodeParams(node.id, patch, immediate ? { immediate: true } : undefined);
  const problem = gridAsNodesProblem(node);
  const label = typeof node.params.label === 'string' && node.params.label.trim() ? node.params.label.trim() : 'Grid Rules';
  const onExample = (ex: HelpExample) => { if ('patch' in ex.insert) set(ex.insert.patch, true); };
  return (
    <BuilderWindow
      prefsKey="grid-rules"
      title="Grid Rules" subtitle={`${label} · ${ruleSummary(params)}`} icon="grid" width={1180} height={780} onClose={onClose}
      tabs={{ items: tabs, value: tab, onChange: setTab, ariaLabel: 'Grid Rules sections' }}
      right={{ label: 'Preview', icon: 'eye', width: 320, content: (
        <div style={{ padding: '16px 16px 24px', display: 'flex', flexDirection: 'column', gap: 12, font: `12.5px ${fontFamily.ui}`, color: tk.text.primary }}>
          <RulePreview params={params} />
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
      <div style={{ flex: 1, padding: '16px 22px 22px', display: 'flex', flexDirection: 'column', gap: 18, font: `12.5px ${fontFamily.ui}`, color: tk.text.primary }} data-testid="grid-rule-form" data-grid-tab={tab}>
        {tab === 'presets' && <PresetsTab p={params} set={set} onExample={onExample} />}
        {tab === 'neighbourhood' && <NeighbourhoodTab p={params} set={set} />}
        {tab === 'rule' && (
          shape.type === 'smooth' ? <SmoothForm p={params} set={set} part="rules" />
            : shape.type === 'patterns' ? <><BuilderHelp id="stencils" /><PatternsForm p={params} set={set} part="rules" /></>
            : shape.type === 'blocks' ? <><BuilderHelp id="block-rules" /><BlocksForm p={params} set={set} part="rules" /></>
            : <BornSurviveTab p={params} set={set} stages={shape.type === 'stages'} onExample={onExample} />
        )}
        {tab === 'start' && <StartTab p={params} set={set} />}
        {tab === 'brush' && <BrushTab p={params} set={set} />}
        {tab === 'colours' && <ColoursTab p={params} set={set} onExample={onExample} />}
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

function TypePicker({ value, onChange }: { value: GridRuleType; onChange: (t: GridRuleType) => void }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 6 }} role="radiogroup" aria-label="Rule type">
      {RULE_TYPES.filter(t => EDITOR_RULE_TYPES.includes(t.value)).map(t => {
        const on = t.value === value;
        return (
          <button key={t.value} type="button" role="radio" aria-checked={on} data-rule-type={t.value} onClick={() => !on && onChange(t.value)}
            style={{
              textAlign: 'left', border: 0, borderRadius: radius.md, padding: '9px 10px', cursor: 'pointer',
              background: on ? tk.bg.selected : tk.bg.field, boxShadow: on ? `inset 0 0 0 1.5px ${tk.accent.base}` : `inset 0 0 0 1px ${tk.border.subtle}`,
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

function Block({ title, hint, help, onExample, children }: { title: string; hint?: string; help?: string; onExample?: (ex: HelpExample) => void; children: ReactNode }) {
  const tk = useTokens();
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <b style={{ font: `600 13px ${fontFamily.ui}` }}>{title}</b>
        {hint && <span style={{ color: tk.text.muted, fontSize: 12, lineHeight: 1.4 }}>{hint}</span>}
      </div>
      {help && <BuilderHelp id={help} onExample={onExample} />}
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
    <label style={{ display: 'grid', gridTemplateColumns: '118px 1fr', alignItems: 'center', gap: 10 }}>
      <span style={{ color: tk.text.secondary, fontSize: 12.5, minWidth: 0, display: 'flex' }}><HintLabel hint={hint}>{label}</HintLabel></span>
      <div style={{ minWidth: 0 }}>{children}</div>
    </label>
  );
}

function Slider({ p, set, k, label, min, max, step = 0.01, integer = false, hint }: { p: P; set: Setter; k: string; label: string; min: number; max: number; step?: number; integer?: boolean; hint?: string }) {
  return (
    <Row label={label} hint={hint ?? GRID_PARAM_DEFS[k]?.hint}>
      <RulerSlider ariaLabel={label} value={num(p, k)} min={min} max={max} step={step} integer={integer} defaultValue={GRID_DEFAULTS[k] as number} onChange={v => set({ [k]: v })} />
    </Row>
  );
}


// ── Presets ─────────────────────────────────────────────────────────────────────────────────────

function PresetsTab({ p, set, onExample }: { p: P; set: Setter; onExample: (ex: HelpExample) => void }) {
  const s = gridShape(p);
  const stages = s.type === 'stages';
  return (
    <>
      <Block title="Rule type" hint="The kind of rule: switching starts the new kind from its first preset.">
        <TypePicker value={s.type} onChange={t => set(typeDefaults(t), true)} />
      </Block>
      {s.type === 'smooth' ? <SmoothForm p={p} set={set} part="presets" />
        : s.type === 'patterns' ? <PatternsForm p={p} set={set} part="presets" />
        : s.type === 'blocks' ? <BlocksForm p={p} set={set} part="presets" />
        : (
          <Block title="Presets" hint={stages ? 'Generations rules: a cell that stops surviving fades through dying stages before it is empty.' : 'Life-like rules: born on some neighbour counts, survive on others. A preset lights up while the switches match it.'}>
            <Presets table={stages ? STAGES_PRESETS : COUNT_PRESETS} p={p} set={set} />
            <RuleSentence {...countSets(p)} stages={stages} states={num(p, 'states')} />
          </Block>
        )}
      <BuilderHelp id={s.type} onExample={onExample} />
    </>
  );
}

/** The Born and Survive counts (switch masks, or a radius rule's ranges) and the largest count. */
function countSets(p: P): { born: number[]; survive: number[]; max: number } {
  const s = gridShape(p);
  const max = maxCount(s.neighbourhood, s.radius, s.shape);
  if (s.neighbourhood === 'radius') return { born: rangeCounts(num(p, 'bornLo'), num(p, 'bornHi')), survive: rangeCounts(num(p, 'surviveLo'), num(p, 'surviveHi')), max };
  return { born: countsOf(num(p, 'bornMask'), max), survive: countsOf(num(p, 'surviveMask'), max), max };
}

// ── Neighbourhood ───────────────────────────────────────────────────────────────────────────────

function NeighbourhoodTab({ p, set }: { p: P; set: Setter }) {
  const tk = useTokens();
  const s = gridShape(p);
  const max = maxCount(s.neighbourhood, s.radius, s.shape);
  return (
    <Block title="Neighbourhood" help="neighbourhood" hint="The highlighted cells are the ones counted round the ringed cell.">
      <NeighbourhoodPictures value={s.neighbourhood} radius={s.radius} shape={s.shape}
        onChange={v => set(v === 'radius' ? { neighbourhood: v, bornLo: 34, bornHi: 45, surviveLo: 33, surviveHi: 57, radius: 5 } : { neighbourhood: v }, true)} />
      {s.neighbourhood === 'radius' && (
        <>
          <Slider p={p} set={v => set(v, true)} k="radius" label="Radius" min={1} max={MAX_RADIUS} step={1} integer hint="How far the neighbourhood reaches, in cells." />
          <Row label="Shape" hint="A square block of cells round each cell, or a round one.">
            <Segmented<string> ariaLabel="Shape" size="sm" value={s.shape} onChange={v => set({ shape: v }, true)} options={[{ value: 'box', label: 'Box' }, { value: 'circle', label: 'Circle' }]} />
          </Row>
        </>
      )}
      <span style={{ color: tk.text.muted, fontSize: 12 }}>Counts up to {max} cells (the cell itself is not counted).</span>
    </Block>
  );
}

// ── Born & Survive, Stages ──────────────────────────────────────────────────────────────────────

function BornSurviveTab({ p, set, stages, onExample }: { p: P; set: Setter; stages: boolean; onExample: (ex: HelpExample) => void }) {
  const tk = useTokens();
  const s = gridShape(p);
  const radiusMode = s.neighbourhood === 'radius';
  const { born, survive, max } = countSets(p);
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? ruleString(num(p, 'bornMask'), num(p, 'surviveMask'), max);
  const bad = text !== null && !parseRuleString(text);
  const bornColour = '#2f9e6a', surviveColour = tk.accent.base;
  const nb = s.neighbourhood === 'vonNeumann' ? 'vonNeumann' : 'moore';
  return (
    <>
      <BuilderHelp id="born-survive" onExample={onExample} />
      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <RuleSentence born={born} survive={survive} max={max} stages={stages} states={num(p, 'states')} />
          {radiusMode ? (
            <Block title={stages ? 'Born and survive (state 1 counts)' : 'Born and survive'} hint="Larger than Life: ranges of live-neighbour counts.">
              <Slider p={p} set={set} k="bornLo" label="Born from" min={0} max={max} step={1} integer />
              <Slider p={p} set={set} k="bornHi" label="Born to" min={0} max={max} step={1} integer />
              <Slider p={p} set={set} k="surviveLo" label="Survive from" min={0} max={max} step={1} integer />
              <Slider p={p} set={set} k="surviveHi" label="Survive to" min={0} max={max} step={1} integer />
            </Block>
          ) : (
            <>
              <PictureSwitches row="born" mask={num(p, 'bornMask')} max={max} nb={nb} colour={bornColour} born={born} survive={survive} stages={stages} onChange={m => set({ bornMask: m }, true)} />
              <PictureSwitches row="survive" mask={num(p, 'surviveMask')} max={max} nb={nb} colour={surviveColour} born={born} survive={survive} stages={stages} onChange={m => set({ surviveMask: m }, true)} />
            </>
          )}
        </div>
        <MiniBoard params={p} />
      </div>
      {stages && (
        <Block title="Dying stages" help="states" hint="A live cell that stops surviving doesn't vanish: it fades one stage a step, and dying cells don't count as live neighbours.">
          <DyingStages states={num(p, 'states')} on={rgb(p, 'color1')} first={rgb(p, 'color2')} last={rgb(p, 'color3')} empty={rgb(p, 'color0')} />
          <Slider p={p} set={set} k="states" label="States" min={2} max={MAX_STATES} step={1} integer hint="Empty (0), on (1), then the dying stages. 3 is one dying stage (Brian's Brain)." />
        </Block>
      )}
      {!radiusMode && (
        <Fold id="as-text" title="As text" summary={stages ? `${shown} · S${countsOf(num(p, 'surviveMask'), max).join('')}/B${countsOf(num(p, 'bornMask'), max).join('')}/C${Math.round(num(p, 'states'))}` : shown}>
          <Row label="B/S notation" hint="B3/S23 is Life (born on 3, survive on 2 or 3). Type a rule or a preset's name; press Enter to use it.">
            <RuleTextField shown={shown} text={text} bad={bad} setText={setText} onUse={r => set({ bornMask: r.born, surviveMask: r.survive }, true)} />
          </Row>
          {stages && <span style={{ color: tk.text.muted, fontSize: 12 }}>
            {`S${countsOf(num(p, 'surviveMask'), max).join('')}/B${countsOf(num(p, 'bornMask'), max).join('')}/C${Math.round(num(p, 'states'))}`} in Golly's notation.
          </span>}
        </Fold>
      )}
    </>
  );
}

// ── Smooth ──────────────────────────────────────────────────────────────────────────────────────

/** Presets: the template and its presets. Rules: the chosen template's sliders (or your update). */
function SmoothForm({ p, set, part }: { p: P; set: Setter; part: 'presets' | 'rules' }) {
  const tk = useTokens();
  const s = gridShape(p);
  const uProblem = s.template === 'custom' ? customUpdateProblem(String(p.customU ?? '')) : null;
  const vProblem = s.template === 'custom' ? customUpdateProblem(String(p.customV ?? '')) : null;
  const [draftU, setDraftU] = useState<string | null>(null);
  const [draftV, setDraftV] = useState<string | null>(null);
  if (part === 'presets') return (
    <>
      <Block title="Template" hint="Continuous values instead of states: every cell runs the same small update.">
        <Segmented<string> ariaLabel="Template" value={s.template} onChange={v => set({ template: v, ...SMOOTH_LOOKS[v] }, true)}
          options={[{ value: 'diffusion', label: 'Diffusion' }, { value: 'waves', label: 'Waves' }, { value: 'reaction', label: 'Reaction–diffusion' }, { value: 'custom', label: 'Custom' }]} />
      </Block>
      <Block title="Presets">
        <Presets table={SMOOTH_PRESETS} p={p} set={set} />
      </Block>
    </>
  );
  return (
    <>
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
          <Fold id="smooth-spread" title="Spread of A and B" summary={`A ${num(p, 'diffA')} · B ${num(p, 'diffB')}`}>
            <Slider p={p} set={set} k="diffA" label="Spread A" min={0} max={1} />
            <Slider p={p} set={set} k="diffB" label="Spread B" min={0} max={1} />
          </Fold>
        </Block>
      )}
      {s.template === 'custom' && (
        <Block title="Your update" hint="One expression each for the new u and v: the escape hatch. Whole numbers are fine (2 becomes 2.0).">
          <UpdateField label="New u" value={draftU ?? String(p.customU ?? '')} saved={uProblem} onDraft={setDraftU} onUse={v => set({ customU: v })} />
          <UpdateField label="New v" value={draftV ?? String(p.customV ?? '')} saved={vProblem} onDraft={setDraftV} onUse={v => set({ customV: v })} />
          <Slider p={p} set={set} k="knobA" label="a" min={0} max={1} step={0.001} />
          <Slider p={p} set={set} k="knobB" label="b" min={0} max={1} step={0.001} />
          <Slider p={p} set={set} k="knobC" label="c" min={0} max={1} step={0.001} />
          <Slider p={p} set={set} k="knobD" label="d" min={0} max={1} step={0.001} />
          <Fold id="smooth-names" title="Names you can use" summary={`${SMOOTH_NAMES.length} names`}>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 12px', fontSize: 12, color: tk.text.secondary }}>
              {SMOOTH_NAMES.map(x => (
                <span key={x.name} style={{ display: 'contents' }}>
                  <code style={{ font: `600 12px ${fontFamily.mono}`, color: tk.text.primary }}>{x.name}</code>
                  <span>{x.doc}</span>
                </span>
              ))}
            </div>
          </Fold>
        </Block>
      )}
    </>
  );
}

// ── Start, Brush, Colours ───────────────────────────────────────────────────────────────────────

/** A folded group of rarely used settings, with a summary while folded (remembered for the session). */
const Fold = ({ id, ...rest }: { id: string; title: string; summary: string; children: ReactNode }) => <BuilderFold foldKey={`gridRules:open:${id}`} {...rest} />;

/** Settings rows at a readable width (the tab is wide on a desktop). */
const Narrow = ({ children }: { children: ReactNode }) => <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 560 }}>{children}</div>;

function StartTab({ p, set }: { p: P; set: Setter }) {
  const s = gridShape(p);
  const speed = s.steps > 1 ? `${s.steps} steps a frame` : `speed ${num(p, 'rate')}`;
  const deal = () => { set({ reset: 1 }, true); window.setTimeout(() => set({ reset: 0 }, true), 120); };
  return (
    <Narrow>
      <BuilderHelp id="run" />
      <Row label="Start" hint="What a new board starts as: noise, empty, a picture's bright parts, or one seed in the centre.">
        <Select ariaLabel="Start" value={s.start} onChange={v => set({ start: v }, true)}
          options={[{ value: 'noise', label: 'Noise' }, { value: 'empty', label: 'Empty' }, { value: 'image', label: 'Image (wire Start image)' }, { value: 'centre', label: 'Centre seed' }]} />
      </Row>
      {(s.start === 'noise' || s.start === 'centre') && <Slider p={p} set={set} k="density" label="Density" min={0} max={1} />}
      <Row label=""><Button size="sm" icon="dice" onClick={deal}>Deal a new board</Button></Row>
      <Row label="Board size" hint="How many cells: each cell is a block of the picture's pixels.">
        <Select ariaLabel="Board size" style={{ maxWidth: '100%' }} value={String(p.board ?? '0.125')} onChange={v => set({ board: v }, true)} options={BOARD_SIZES.map(b => ({ value: b.value, label: b.label.replace(' at 1080p', '') }))} />
      </Row>
      <Row label="Edges" hint="Wrap: what leaves one side comes back on the other. Walls: the edge is empty.">
        <Segmented<string> ariaLabel="Edges" size="sm" value={s.wrap ? 'wrap' : 'walls'} onChange={v => set({ edges: v }, true)} options={[{ value: 'wrap', label: 'Wrap' }, { value: 'walls', label: 'Walls' }]} />
      </Row>
      <Fold id="run-more" title="Seed and speed" summary={`seed ${num(p, 'seed')} · ${speed}`}>
        <Slider p={p} set={set} k="seed" label="Seed" min={0} max={100} step={1} integer />
        <Slider p={p} set={v => set(v, true)} k="steps" label="Steps a frame" min={1} max={MAX_STEPS} step={1} integer hint="The rule runs this many times each frame (the board Pass's Repeat)." />
        {s.steps === 1 && <Slider p={p} set={set} k="rate" label="Speed" min={0} max={1} hint="Below 1, the board steps on some frames only: 0.25 is every fourth." />}
      </Fold>
    </Narrow>
  );
}

function BrushTab({ p, set }: { p: P; set: Setter }) {
  const tk = useTokens();
  const s = gridShape(p);
  const discrete = s.type !== 'smooth';
  const top = s.type === 'stages' ? Math.round(num(p, 'states')) - 1 : 1;
  return (
    <Narrow>
      <BuilderHelp id="brush" />
      <Slider p={p} set={set} k="brushRadius" label="Size (cells)" min={0.5} max={40} step={0.5} />
      {discrete
        ? <Slider p={p} set={set} k="brushState" label="Paints state" min={0} max={top} step={1} integer hint="0 erases." />
        : <Slider p={p} set={set} k="brushState" label="Sets value" min={-1} max={1} />}
      {discrete && <Fold id="brush-fill" title="Fill" summary={`${Math.round(num(p, 'brushFill') * 100)}% of the cells under it`}>
        <Slider p={p} set={set} k="brushFill" label="Fill" min={0} max={1} hint="The share of cells under the brush it paints each frame." />
      </Fold>}
      <span style={{ fontSize: 12, lineHeight: 1.4, color: tk.text.muted }}>Hold the mouse button over the picture to paint: in the Studio preview, on the Play page and on exported pages. Paint (on the card's Play controls) paints without the button.</span>
    </Narrow>
  );
}

function ColoursTab({ p, set, onExample }: { p: P; set: Setter; onExample: (ex: HelpExample) => void }) {
  const tk = useTokens();
  const s = gridShape(p);
  const discrete = s.type !== 'smooth';
  return (
    <Narrow>
      <BuilderHelp id="output" onExample={onExample} />
      <Row label="Color shows" hint="What the node's Color output shows. The State, On, Age, Shade and Neighbours sockets always carry these numbers too.">
        <Select ariaLabel="Color shows" value={gridViewMode(p.view)} onChange={v => set({ view: v }, true)} options={GRID_VIEWS.map(v => ({ value: v.value, label: v.label }))} />
      </Row>
      <span style={{ fontSize: 12, lineHeight: 1.4, color: tk.text.muted }}>{GRID_VIEWS.find(v => v.value === gridViewMode(p.view))?.hint}</span>
      <BuilderHelp id="colours" />
      <ColourRows p={p} set={set} />
      {discrete ? (
        <Fold id="colours-age" title="Afterglow and ageing" summary={`afterglow ${num(p, 'afterglow')} · ageing ${num(p, 'ageRate')}`}>
          <Slider p={p} set={set} k="afterglow" label="Afterglow" min={0} max={0.99} />
          <Slider p={p} set={set} k="ageRate" label="Ageing" min={0} max={0.2} step={0.001} />
          <Slider p={p} set={set} k="ageFade" label="Age fade" min={0} max={1} />
        </Fold>
      ) : <Slider p={p} set={set} k="gain" label="Contrast" min={0} max={8} />}
    </Narrow>
  );
}

// ── Colours and typed fields ────────────────────────────────────────────────────────────────────

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

// ── Typed fields with type-ahead ────────────────────────────────────────────────────────────────

const RULE_WORDS: Completion[] = [...Object.values(COUNT_PRESETS)].filter(pr => typeof pr.params.bornMask === 'number').map(pr => ({
  label: `${ruleString(Number(pr.params.bornMask), Number(pr.params.surviveMask), pr.params.neighbourhood === 'vonNeumann' ? 4 : 8)} ${pr.label}`,
  insert: ruleString(Number(pr.params.bornMask), Number(pr.params.surviveMask), pr.params.neighbourhood === 'vonNeumann' ? 4 : 8),
  kind: 'value' as const, detail: pr.hint, words: [pr.label],
}));

/** The B/S text, completed from the presets as you type ("high" → B36/S23 HighLife). */
function RuleTextField({ shown, text, bad, setText, onUse }: { shown: string; text: string | null; bad: boolean; setText: (t: string | null) => void; onUse: (r: { born: number; survive: number }) => void }) {
  const [caret, setCaret] = useState<number | null>(null);
  const ta = useTypeAhead(text ?? '', text === null ? null : caret, (t, c) => wordAssist(t, c, RULE_WORDS, true), next => { setText(next); const r = parseRuleString(next); if (r) { onUse(r); setText(null); } });
  return (
    <div style={{ position: 'relative' }}>
      <Field mono value={shown} invalid={bad} aria-label="Rule as text"
        onChange={e => { setText(e.target.value); setCaret(e.target.selectionStart); }}
        onBlur={() => { setText(null); setCaret(null); }}
        onKeyDown={e => {
          if (ta.onKeyDown(e)) return;
          if (e.key !== 'Enter') return;
          const r = text ? parseRuleString(text) : null;
          if (r) { onUse(r); setText(null); }
        }} />
      {ta.items.length > 0 && <div style={{ position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 4, zIndex: 10 }}><AssistList items={ta.items} active={ta.active} onPick={ta.pick} onHover={ta.setActive} /></div>}
    </div>
  );
}

const UPDATE_WORDS: Completion[] = [
  ...SMOOTH_NAMES.map(x => ({ label: x.name, insert: x.name, kind: 'value' as const, detail: x.doc })),
  ...[...SMOOTH_FUNCTIONS].map(fn => ({ label: fn, insert: `${fn}(`, kind: 'param' as const, detail: 'a GLSL function' })),
];

/** One custom Smooth update: names and functions completed as you type; refused when it isn't one number. */
function UpdateField({ label, value, saved, onDraft, onUse }: { label: string; value: string; saved: string | null; onDraft: (v: string | null) => void; onUse: (v: string) => void }) {
  const tk = useTokens();
  const [caret, setCaret] = useState<number | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const problemOf = (v: string) => customUpdateProblem(v);
  const change = (v: string) => { setDraft(v); onDraft(v); if (!problemOf(v)) onUse(v); };
  const ta = useTypeAhead(value, caret, (t, c) => wordAssist(t, c, UPDATE_WORDS), (next, at) => { change(next); setCaret(at); });
  const problem = useMemo(() => (draft !== null ? problemOf(draft) : saved), [draft, saved]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <Row label={label} hint="One expression for the new value: a number (float). Names: u, v, lap_u, avg_u, n, s, e, w, x, y, t, rnd, a…d.">
        <div style={{ position: 'relative' }}>
          <Field mono value={value} invalid={!!problem} aria-label={label}
            onChange={e => { change(e.target.value); setCaret(e.target.selectionStart); }}
            onKeyDown={e => { ta.onKeyDown(e); }} onKeyUp={e => setCaret((e.target as HTMLInputElement).selectionStart)}
            onBlur={() => { setDraft(null); onDraft(null); setCaret(null); }} />
          {ta.items.length > 0 && <div style={{ position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 4, zIndex: 10 }}><AssistList items={ta.items} active={ta.active} onPick={ta.pick} onHover={ta.setActive} /></div>}
        </div>
      </Row>
      {problem && <span data-type-error style={{ color: tk.status.danger, fontSize: 12 }}>{problem}</span>}
    </>
  );
}
