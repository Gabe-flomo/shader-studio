/**
 * The Grid Rules builder (docs/grid-rules.md, "The builder"), on the Agent Builder's shell
 * (components/builders/studio/StudioShell.tsx):
 *
 *   ┌ Scene builder › Grid scene · name · rule ──── Under the hood · Surprise · Open as nodes · Done ┐
 *   │ What it is (rule type)  │      the try board: draw cells, step through,      │ the section's  │
 *   │ Sections, with summaries│      play, with pictures for the section           │ settings       │
 *   ├─────────────────────────┴────────────────────────────────────────────────────┴────────────────┤
 *   │ presets, as pictures · Surprise me                                                             │
 *   └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * The centre is the try board (TryBoard.tsx): the node's own rule run on the CPU on a small board
 * you draw on and step through, back and forward, before building; Use as the start makes what is
 * drawn the node's start. The sections (builderLayout.ts gridRulesSections): the rule first (Born &
 * Survive with picture switches, Stencils as drawn stencils, Blocks as before/after pictures and
 * then together, Smooth in plain words with a before/after), then Neighbourhood, Start, Speed,
 * Brush, Look and As text. The section is remembered.
 *
 * Everything writes the node's params (one undoable edit per change). The switches, sliders and
 * colours are live uniforms on the picture (no recompile); a select (type, neighbourhood,
 * template, start, board size, edges, steps) and a rule list edit recompile. Done frames the node.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { BuilderFold, HintLabel } from '../builders/BuilderWindow';
import { gridRulesSections, rememberTab, rememberedTab, validTab } from '../builders/builderLayout';
import { LanguageTab, type LanguageRead } from '../builders/LanguageTab';
import { focusRecipeEditor, useBuilderRecipeRequest } from '../../builders/windows';
import { RECIPE_KEYS, parseGrid, printGrid } from '../../lang/dialects/grid';
import { AssistList, useTypeAhead } from '../builders/TypeAhead';
import { wordAssist, type Completion } from '../../lang/complete';
import { GRID_PARAM_DEFS } from '../../nodes/definitions/gridRules';
import { GRID_VIEWS, gridViewMode } from '../../gridRules/glsl';
import { Button, IconButton } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { SurpriseBar } from '../surprise/SurpriseBar';
import { newSeed } from '../../lib/surprise';
import { surpriseGridAction, useSurpriseSeeds } from '../surprise/surpriseActions';
import { Field } from '../ui/Field';
import { SceneCrumb } from '../builders/SceneCrumb';
import { backToGridScene, gridSceneOfSimulation } from '../../gridScene/actions';
import { BuilderSlider } from '../builders/BuilderSlider';
import { Select } from '../ui/Select';
import { ColorSwatch } from '../ui/ColorPicker';
import { PresetCard, StudioLabel, StudioNavItem, StudioShell } from '../builders/studio/StudioShell';
import { DyingStages, NeighbourhoodPictures, PictureSwitches, RuleSentence } from './BornSurvive';
import { BlocksForm, PatternsForm } from './StencilForms';
import { StackForm } from './StackForm';
import { readStack, stackLine } from '../../gridRules/stack';
import { SmoothSection } from './SmoothPictures';
import { TryBoard, type TryFocus } from './TryBoard';
import { useGridThumbs } from './gridThumbs';
import { rangeCounts } from '../../gridRules/explain';
import { SMOOTH_WORDS } from '../../gridRules/smoothWords';
import { drawnCount, type StartCells } from '../../gridRules/startCells';
import { DEFAULT_START_TEXT, MAX_TEXT_CHARS, MAX_TEXT_SIZE, MIN_TEXT_SIZE, cleanStartText, readStartText, type StartText } from '../../gridRules/textCells';
import { DEFAULT_STENCIL, readStencil, stencilMax, stencilSummary, stencilUsesRanges, type NeighbourStencil } from '../../gridRules/neighbourhoods';
import { StencilEditor } from './StencilEditor';
import {
  BOARD_SIZES, COUNT_PRESETS, GRID_DEFAULTS, countsAsRanges, MAX_RADIUS, MAX_STATES, MAX_STEPS, RULE_TYPES, SMOOTH_NAMES, SMOOTH_PRESETS, STAGES_PRESETS,
  SMOOTH_FUNCTIONS, countsOf, customUpdateProblem, gridShape, gridTypeDefaults, matchingPreset, maxCount, parseRuleString, presetPatch, ruleString, ruleSummary,
  stepsPerSecond, type GridPreset, type GridRuleType,
} from '../../gridRules/spec';
import { BLOCK_PRESETS, PATTERN_PRESETS } from '../../gridRules/stencils';
import { gridAsNodesProblem } from '../../store/gridRulesAsNodes';
import type { GraphNode } from '../../types/nodeGraph';
import { finishBuilder } from '../../builders/finish';

type P = Record<string, unknown>;
type Setter = (patch: P, immediate?: boolean) => void;

const num = (p: P, k: string) => (typeof p[k] === 'number' ? p[k] as number : GRID_DEFAULTS[k] as number);
const rgb = (p: P, k: string) => (Array.isArray(p[k]) ? p[k] as number[] : GRID_DEFAULTS[k] as number[]) as [number, number, number];
const r3 = (v: number) => String(Math.round(v * 1000) / 1000);

/** The presets of a rule type, as the strip shows them. */
export const PRESET_TABLES: Record<GridRuleType, Record<string, GridPreset>> = {
  count: COUNT_PRESETS, stages: STAGES_PRESETS, smooth: SMOOTH_PRESETS,
  patterns: PATTERN_PRESETS as Record<string, GridPreset>, blocks: BLOCK_PRESETS as Record<string, GridPreset>,
};

export function GridRulesEditor({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const node = useNodeGraphStore(s => s.nodes.find(nd => nd.id === nodeId));
  if (!node) return null;
  return <GridRulesBuilder node={node} onClose={onClose} />;
}

/** The Grid Rules node the builder is on: its sliders are that node's params (the Play menu on right-click). */
const GridNodeContext = createContext<string | null>(null);

function GridRulesBuilder({ node, onClose }: { node: GraphNode; onClose: () => void }) {
  const tk = useTokens();
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const openAsNodes = useNodeGraphStore(s => s.openGridRulesAsNodes);
  const params: P = { ...GRID_DEFAULTS, ...node.params };
  const shape = gridShape(params);
  const set: Setter = useCallback((patch, immediate = false) => updateNodeParams(node.id, patch, immediate ? { immediate: true } : undefined), [node.id, updateNodeParams]);
  const problem = gridAsNodesProblem(node);
  const label = typeof node.params.label === 'string' && node.params.label.trim() ? node.params.label.trim() : 'Grid Rules';
  const surpriseSeed = useSurpriseSeeds(s => s.grid[node.id] ?? null);
  const [keepType, setKeepType] = useState(true);
  const [hood, setHood] = useState(false);
  // Made by the Grid builder's "Make it a simulation" (docs/grid-builder.md): the way back to the drawing.
  const fromGrid = useNodeGraphStore(s => !!gridSceneOfSimulation(s.nodes, node.id));

  // Sections: the rule first; the one shown is remembered.
  const sections = gridRulesSections(shape.type, shape.type === 'smooth' ? SMOOTH_WORDS[shape.template].title : undefined);
  const [picked, setPicked] = useState(() => rememberedTab('grid-rules', sections.map(x => x.id), 'rule'));
  const section = validTab(picked, sections, 'rule');
  const select = (id: string) => { setPicked(id); rememberTab('grid-rules', id); setFocus({}); };
  // ⌘⇧D: As text (the recipe), its text focused.
  useBuilderRecipeRequest(() => { select('recipe'); focusRecipeEditor('[data-language-tab="grid"] textarea'); });
  const [focus, setFocus] = useState<Omit<TryFocus, 'section'>>({});
  const info = sections.find(x => x.id === section)!;

  const table = PRESET_TABLES[shape.type];
  const thumbs = useGridThumbs(shape.type, table);
  const current = matchingPreset(params);
  const surprise = (seed: number) => surpriseGridAction(node.id, seed, keepType ? shape.type : undefined);

  const useAsStart = (cells: StartCells | null) => {
    if (!cells) return;
    set({ start: 'cells', startCells: cells }, true);
  };

  // ── Nav ──
  const summary = (id: string): string => {
    switch (id) {
      case 'rule': return ruleLine(params);
      case 'neighbourhood': return shape.neighbourhood === 'moore' ? 'the 8 round it' : shape.neighbourhood === 'vonNeumann' ? 'the 4 beside it' : shape.neighbourhood === 'custom' ? `your own · ${stencilSummary(shape.stencil ?? DEFAULT_STENCIL).toLowerCase()}` : `radius ${shape.radius}, ${shape.shape === 'circle' ? 'round' : 'square'}`;
      case 'stack': { const line = stackLine(readStack(params.stack)); return line ? `+ ${line}` : 'none yet: add a card'; }
      case 'start': return startLine(params);
      case 'run': return `${Math.round(stepsPerSecond(params))} steps a second`;
      case 'brush': return `${num(params, 'brushRadius')} cells · ${shape.type === 'smooth' ? `sets ${num(params, 'brushState')}` : num(params, 'brushState') === 0 ? 'erases' : `paints ${num(params, 'brushState')}`}`;
      case 'look': return gridViewMode(params.view) === 'colour' ? (shape.type === 'smooth' ? `contrast ${num(params, 'gain')}` : `afterglow ${num(params, 'afterglow')}`) : `shows ${gridViewMode(params.view)}`;
      case 'recipe': return printGrid(params).split('\n')[0];
      default: return '';
    }
  };
  const nav = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '14px 10px' }}>
      <span data-rule-type-pick title={RULE_TYPES.find(t => t.value === shape.type)?.hint} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <StudioLabel meta="the kind of rule">What it is</StudioLabel>
        <Select ariaLabel="Rule type" value={shape.type} options={RULE_TYPES.map(t => ({ value: t.value, label: RULE_TYPE_NAMES[t.value] }))}
          onChange={v => set(gridTypeDefaults(v as GridRuleType), true)} />
        <span style={{ fontSize: 11.5, color: tk.text.muted, lineHeight: 1.4, padding: '0 2px' }}>{RULE_TYPES.find(t => t.value === shape.type)?.hint}</span>
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <StudioLabel meta="the rule, then the board">Sections</StudioLabel>
        {sections.map(x => (
          <StudioNavItem key={x.id} id={x.id} icon={x.icon ?? 'sliders'} label={x.label} hint={x.how} summary={summary(x.id)} selected={section === x.id} onClick={() => select(x.id)} />
        ))}
      </div>
    </div>
  );

  // ── Inspector ──
  const body = (() => {
    switch (section) {
      case 'rule':
        if (shape.type === 'smooth') return <SmoothSection p={params} set={set} nodeId={node.id} custom={<CustomUpdate p={params} set={set} />} />;
        if (shape.type === 'patterns') return <PatternsForm p={params} set={set} nodeId={node.id} onHoverRule={i => setFocus({ rule: i })} />;
        if (shape.type === 'blocks') return <BlocksForm p={params} set={set} nodeId={node.id} />;
        return <BornSurviveSection p={params} set={set} stages={shape.type === 'stages'} onHoverCount={c => setFocus({ count: c })} />;
      case 'neighbourhood': return <NeighbourhoodSection p={params} set={set} />;
      case 'stack': return <StackForm p={params} set={set} onHoverCard={j => setFocus({ card: j })} />;
      case 'start': return <StartSection p={params} set={set} />;
      case 'run': return <RunSection p={params} set={set} />;
      case 'brush': return <BrushSection p={params} set={set} />;
      case 'look': return <LookSection p={params} set={set} />;
      case 'recipe': return <GridRecipeTab params={params} set={set} />;
      default: return null;
    }
  })();
  const inspector = (
    <GridNodeContext.Provider value={node.id}>
      <div data-inspector={section} data-grid-tab={section} style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 14 }}>
        <SectionIntro title={info.label} line={info.how ?? ''} learn={LEARN[section === 'rule' ? `rule:${shape.type}` : section]} />
        {body}
      </div>
    </GridNodeContext.Provider>
  );

  // ── Presets strip ──
  const presetStrip = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ flex: 1 }}><StudioLabel meta="click to apply · undo takes it back">{`${RULE_TYPE_NAMES[shape.type]} presets`}</StudioLabel></span>
        <Toggle checked={keepType} onChange={setKeepType} label="Keep the kind of rule" />
        <SurpriseBar seed={surpriseSeed} onSurprise={surprise}
          title="A random rule that stays alive (tried on a test board first), with a random start and colours (one undo step)" />
      </span>
      <div style={{ display: 'flex', gap: 12 }}>
        {Object.entries(table).map(([key, pr]) => (
          <PresetCard key={key} id={key} label={pr.label} hint={pr.hint} src={thumbs[key]} active={current === key} onClick={() => set(presetPatch(pr), true)} />
        ))}
      </div>
    </div>
  );

  return (
    <StudioShell prefsKey="grid-rules" icon="grid" title={label} crumb={<SceneCrumb kind="grid" leaf={fromGrid ? 'Simulation' : undefined} />} kind={ruleSummary(params)} onClose={onClose}
      onEscape={() => { if (hood) { setHood(false); return true; } return false; }}
      actions={<>
        {fromGrid && (
          <Button size="sm" icon="chevL" data-grid-back onClick={() => backToGridScene(node.id)}
            title="Back to the Grid builder on the drawing this simulation starts from (the Output shows the drawing again; this node stays)">Pattern grid</Button>
        )}
        <IconButton icon="layers" size="sm" label={hood ? 'Hide Under the hood' : 'Under the hood: every cell\'s numbers, and what the GPU keeps'} active={hood} onClick={() => setHood(!hood)} data-hood-toggle />
        <IconButton icon="dice" size="sm" label="Surprise me: a random rule that stays alive (one undo step)" onClick={() => surprise(newSeed())} data-surprise-top />
        <IconButton icon="fn" size="sm" disabled={!!problem} label={problem ?? 'Open as nodes: the same simulation from ordinary nodes, every node with a note'} onClick={() => { if (openAsNodes(node.id)) onClose(); }} data-open-as-nodes />
      </>}
      primary={{ label: 'Done', onClick: () => finishBuilder(onClose, [node.id]), title: 'Close the builder and show the Grid Rules node (every change is already in the graph)' }}
      nav={nav} inspector={inspector} inspectorWidth={432} navWidth={232} presets={presetStrip}>
      <TryBoard params={params} nodeParams={node.params} focus={{ section, ...focus }} hood={hood} onUseAsStart={useAsStart} />
    </StudioShell>
  );
}

/** The rule types by what they are. */
const RULE_TYPE_NAMES: Record<GridRuleType, string> = {
  count: 'Count (Life-like)', stages: 'Stages (fading)', patterns: 'Stencils (3×3 pictures)', blocks: 'Blocks (2×2, sand and gas)', smooth: 'Smooth (heat, ripples…)',
};

/** "Learn more" under each section's line. */
const LEARN: Record<string, string> = {
  'rule:count': 'Every cell is alive or empty. Each step, every cell counts the live cells round it at once, and the counts decide the next board: Conway\'s Life is born on 3, survives on 2 or 3. Point at a switch to light the cells it stands for on the board; the rings show what the next step does.',
  'rule:stages': 'Like Count, but a live cell that stops surviving doesn\'t vanish: it fades through dying stages, one a step, and dying cells don\'t count as live neighbours. Brian\'s Brain (born on 2, survives on none, 3 states) makes endless sparks.',
  'rule:patterns': 'Each rule is a picture of the 3×3 cells round a cell. Hatched cells aren\'t looked at; a coloured cell must be that state; a dotted one anything but empty. The first rule that fits says what the cell becomes. Point at a rule to light the cells it fits on the board.',
  'rule:blocks': 'The board is cut into 2×2 blocks, and the cut moves one cell diagonally every step. A block that looks like a before picture becomes its after picture, all four cells at once, so a rule that only moves cells never loses or makes one: sand falls and piles, gas flies.',
  'rule:smooth': 'Instead of a few states, every cell holds a number (two, for ripples and patterns), and every step each cell takes a little from its neighbours.',
  neighbourhood: 'Which cells a cell counts. The 8 round it (Moore) is Life\'s. The 4 beside it (von Neumann) grows diamonds. A radius counts every cell within that many steps: counts run into the dozens, and Born and Survive become ranges. Your own: draw the cells that count on a stencil up to 7×7; with Weights a cell can count two or three times. Born and Survive then count against your stencil, on the try board and on the GPU alike.',
  stack: 'Start from a base (Life, Brian\'s Brain, Wireworld…) and stack rule cards on it: cells that meet explode into copies, crowded cells die or step away, cells drift in a direction, cells in big clusters change. The base steps first, then each card in order, so the order matters. Point at a card to see on the board the cells it changes next step. On the GPU the cards are extra draws of the same board Pass, so each card costs about one more step.',
  start: 'A new board is dealt when the rule\'s kind or the start changes, or when you press Deal a new board. Your drawing is placed in the middle of the board, whatever its size. Text: the words are drawn in the stroke font and every cell the letters cover starts live, so Life (or any rule) starts from the letters.',
  run: 'Speed below 1 steps on some frames only: 0.5 is a step every other frame, 30 a second. Steps a frame above 1 runs the rule that many times a frame.',
  brush: 'Hold the mouse button over the picture to paint: in the Studio preview, on the Play page and on exported pages. Paint on the card\'s Play controls paints without the button.',
  look: 'Afterglow: a cell that just died glows and fades. Age fade: live cells move towards Old cells as they age. Color shows can show a number as grey instead (state, age, neighbours), to see why a rule does what it does.',
  recipe: 'The same words work in the Do… bar: type "grid highlife walls" there to make one.',
};

function SectionIntro({ title, line, learn }: { title: string; line: string; learn?: string }) {
  const tk = useTokens();
  const [open, setOpen] = useState(false);
  return (
    <div data-section-intro={title} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '2px 2px 4px' }}>
      <b style={{ fontSize: 15, fontWeight: 650 }}>{title}</b>
      <span data-builder-how style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.45 }}>{line}</span>
      {learn && <button type="button" data-learn-more={title} aria-expanded={open} onClick={() => setOpen(v => !v)}
        style={{ alignSelf: 'flex-start', padding: 0, border: 0, background: 'none', cursor: 'pointer', color: tk.accent.text, font: `600 11.5px ${fontFamily.ui}` }}>
        {open ? 'Less' : 'Learn more'}
      </button>}
      {open && learn && <p data-learn-text style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: tk.text.secondary }}>{learn}</p>}
    </div>
  );
}

// ── Summaries ───────────────────────────────────────────────────────────────────────────────────

function ruleLine(p: P): string {
  const s = gridShape(p);
  if (s.type === 'smooth') {
    const w = SMOOTH_WORDS[s.template];
    return w.settings.filter(x => !x.more).map(x => `${x.label.toLowerCase()} ${r3(num(p, x.key))}`).join(' · ') || 'your own update';
  }
  if (s.type === 'patterns' || s.type === 'blocks') {
    const rules = s.type === 'patterns' ? s.patterns : s.blocks;
    const on = rules.filter(r => !r.off).length;
    return `${on} rule${on === 1 ? '' : 's'} · ${Math.round(num(p, 'states'))} states`;
  }
  const max = maxCount(s.neighbourhood, s.radius, s.shape, s.stencil);
  const text = countsAsRanges(s) ? `born ${num(p, 'bornLo')}–${num(p, 'bornHi')}, survive ${num(p, 'surviveLo')}–${num(p, 'surviveHi')}` : ruleString(num(p, 'bornMask'), num(p, 'surviveMask'), max);
  return s.type === 'stages' ? `${text} · ${Math.round(num(p, 'states'))} states` : text;
}

const START_NAMES: Record<string, string> = { text: 'Text', cells: 'Your drawing', noise: 'Noise', centre: 'A seed in the middle', empty: 'Empty', image: 'A picture' };

function startLine(p: P): string {
  const s = gridShape(p);
  if (s.start === 'cells') return s.startCells ? `your drawing · ${drawnCount(s.startCells)} cells` : 'your drawing (nothing drawn)';
  if (s.start === 'text') return s.startText?.text ? `text "${s.startText.text}" · ${s.startText.size} cells tall` : 'text (no words yet)';
  if (s.start === 'noise' || s.start === 'centre') return `${START_NAMES[s.start].toLowerCase()} · ${Math.round(num(p, 'density') * 100)}%`;
  return START_NAMES[s.start].toLowerCase();
}

// ── Pieces ──────────────────────────────────────────────────────────────────────────────────────

function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const tk = useTokens();
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '108px 1fr', alignItems: 'center', gap: 10 }}>
      <span style={{ color: tk.text.secondary, fontSize: 12.5, minWidth: 0, display: 'flex' }}><HintLabel hint={hint}>{label}</HintLabel></span>
      <div style={{ minWidth: 0 }}>{children}</div>
    </label>
  );
}

function Slider({ p, set, k, label, min, max, step = 0.01, integer = false, hint }: { p: P; set: Setter; k: string; label: string; min: number; max: number; step?: number; integer?: boolean; hint?: string }) {
  const nodeId = useContext(GridNodeContext);
  return (
    <Row label={label} hint={hint ?? GRID_PARAM_DEFS[k]?.hint}>
      <BuilderSlider ariaLabel={label} value={num(p, k)} min={min} max={max} step={step} integer={integer} defaultValue={GRID_DEFAULTS[k] as number} onChange={v => set({ [k]: v })}
        rangeKey={`grid:${k}`} param={nodeId ? { nodeId, key: k } : undefined} />
    </Row>
  );
}

/** A folded group of rarely used settings, with a summary while folded (remembered for the session). */
const Fold = ({ id, ...rest }: { id: string; title: string; summary: string; children: ReactNode }) => <BuilderFold foldKey={`gridRules:open:${id}`} {...rest} />;

/** The Born and Survive counts (switch masks, or a radius rule's ranges) and the largest count. */
function countSets(p: P): { born: number[]; survive: number[]; max: number } {
  const s = gridShape(p);
  const max = maxCount(s.neighbourhood, s.radius, s.shape, s.stencil);
  if (countsAsRanges(s)) return { born: rangeCounts(num(p, 'bornLo'), num(p, 'bornHi')), survive: rangeCounts(num(p, 'surviveLo'), num(p, 'surviveHi')), max };
  return { born: countsOf(num(p, 'bornMask'), max), survive: countsOf(num(p, 'surviveMask'), max), max };
}

// ── Born & Survive (Count, Stages) ──────────────────────────────────────────────────────────────

function BornSurviveSection({ p, set, stages, onHoverCount }: { p: P; set: Setter; stages: boolean; onHoverCount: (c: TryFocus['count']) => void }) {
  const tk = useTokens();
  const s = gridShape(p);
  const radiusMode = countsAsRanges(s);
  const { born, survive, max } = countSets(p);
  const plain = s.neighbourhood === 'custom';
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? ruleString(num(p, 'bornMask'), num(p, 'surviveMask'), max);
  const bad = text !== null && !parseRuleString(text);
  const bornColour = '#2f9e6a', surviveColour = tk.accent.base;
  const nb = s.neighbourhood === 'vonNeumann' ? 'vonNeumann' : 'moore';
  return (
    <>
      <RuleSentence born={born} survive={survive} max={max} stages={stages} states={num(p, 'states')} />
      {radiusMode ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: 12, color: tk.text.muted }}>{s.neighbourhood === 'custom' ? `Your neighbourhood counts up to ${max}` : `A radius counts up to ${max} cells`}, so Born and Survive are ranges.</span>
          <Slider p={p} set={set} k="bornLo" label="Born from" min={0} max={max} step={1} integer />
          <Slider p={p} set={set} k="bornHi" label="Born to" min={0} max={max} step={1} integer />
          <Slider p={p} set={set} k="surviveLo" label="Survive from" min={0} max={max} step={1} integer />
          <Slider p={p} set={set} k="surviveHi" label="Survive to" min={0} max={max} step={1} integer />
        </div>
      ) : (
        <>
          <PictureSwitches compact plain={plain} row="born" mask={num(p, 'bornMask')} max={max} nb={nb} colour={bornColour} born={born} survive={survive} stages={stages}
            onChange={m => set({ bornMask: m }, true)} onHoverCount={k => onHoverCount(k === null ? null : { row: 'born', k })} />
          <PictureSwitches compact plain={plain} row="survive" mask={num(p, 'surviveMask')} max={max} nb={nb} colour={surviveColour} born={born} survive={survive} stages={stages}
            onChange={m => set({ surviveMask: m }, true)} onHoverCount={k => onHoverCount(k === null ? null : { row: 'survive', k })} />
          <span style={{ fontSize: 11.5, color: tk.text.faint, lineHeight: 1.4 }}>Point at a switch: the board lights the cells with that count.</span>
        </>
      )}
      {stages && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <b style={{ fontSize: 13 }}>Fading</b>
          <span style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.4 }}>A live cell that stops surviving fades one stage a step; fading cells don't count as live.</span>
          <DyingStages states={num(p, 'states')} on={rgb(p, 'color1')} first={rgb(p, 'color2')} last={rgb(p, 'color3')} empty={rgb(p, 'color0')} />
          <Slider p={p} set={set} k="states" label="States" min={2} max={MAX_STATES} step={1} integer hint="Empty (0), on (1), then the dying stages. 3 is one dying stage (Brian's Brain)." />
        </div>
      )}
      {!radiusMode && max <= 8 && (
        <Fold id="as-text" title="As B/S text" summary={stages ? `${shown} · S${countsOf(num(p, 'surviveMask'), max).join('')}/B${countsOf(num(p, 'bornMask'), max).join('')}/C${Math.round(num(p, 'states'))}` : shown}>
          <Row label="B/S notation" hint="B3/S23 is Life (born on 3, survive on 2 or 3). Type a rule or a preset's name; press Enter to use it.">
            <RuleTextField shown={shown} text={text} bad={bad} setText={setText} onUse={r => set({ bornMask: r.born, surviveMask: r.survive }, true)} />
          </Row>
        </Fold>
      )}
    </>
  );
}

// ── Neighbourhood ───────────────────────────────────────────────────────────────────────────────

/** Born and Survive that suit a stencil: Life's counts with switches, Bosco's proportions as ranges. */
function countsFor(st: NeighbourStencil): P {
  const max = stencilMax(st);
  if (!stencilUsesRanges(st)) return {};
  return { bornLo: Math.round(max * 0.34), bornHi: Math.round(max * 0.45), surviveLo: Math.round(max * 0.33), surviveHi: Math.round(max * 0.57) };
}

function NeighbourhoodSection({ p, set }: { p: P; set: Setter }) {
  const tk = useTokens();
  const s = gridShape(p);
  const max = maxCount(s.neighbourhood, s.radius, s.shape, s.stencil);
  const stencil = readStencil(p.stencil);
  const setStencil = (st: NeighbourStencil) => {
    // Crossing into ranges (or back to switches) brings counts that work there.
    const was = stencilUsesRanges(stencil), now = stencilUsesRanges(st);
    set({ stencil: st, ...(now && !was ? countsFor(st) : {}), ...(!now && was ? { bornMask: 8, surviveMask: 12 } : {}) }, true);
  };
  return (
    <>
      <NeighbourhoodPictures value={s.neighbourhood} radius={s.radius} shape={s.shape} stencil={p.stencil ? stencil : null}
        onChange={v => set(v === 'radius' ? { neighbourhood: v, bornLo: 34, bornHi: 45, surviveLo: 33, surviveHi: 57, radius: 5 }
          : v === 'custom' ? { neighbourhood: v, stencil, ...countsFor(stencil) } : { neighbourhood: v }, true)} />
      {s.neighbourhood === 'custom' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <b style={{ fontSize: 13 }}>Your neighbourhood</b>
          <span style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.45 }}>Click the cells that count round this cell (the ringed middle). Point at the board to see them; Born and Survive count against them.</span>
          <StencilEditor stencil={stencil} onChange={setStencil} />
        </div>
      )}
      {s.neighbourhood === 'radius' && (
        <>
          <Slider p={p} set={v => set(v, true)} k="radius" label="Radius" min={1} max={MAX_RADIUS} step={1} integer hint="How far the neighbourhood reaches, in cells." />
          <Row label="Shape" hint="A square block of cells round each cell, or a round one.">
            <Segmented<string> ariaLabel="Shape" size="sm" value={s.shape} onChange={v => set({ shape: v }, true)} options={[{ value: 'box', label: 'Square' }, { value: 'circle', label: 'Round' }]} />
          </Row>
        </>
      )}
      <span style={{ color: tk.text.muted, fontSize: 12 }}>{s.neighbourhood === 'custom' ? `Counts up to ${max} (weights included; the cell itself is never counted)` : `Counts up to ${max} cells (the cell itself is not counted)`}. Point at the board to see the cells one counts.</span>
    </>
  );
}

// ── Start, Speed, Brush, Look ───────────────────────────────────────────────────────────────────

const START_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: 'cells', label: 'Your drawing', hint: 'The cells you drew on the board (Use as the start), in the middle.' },
  { value: 'text', label: 'Text', hint: 'Words: the cells the letters cover start live.' },
  { value: 'noise', label: 'Noise', hint: 'Cells scattered at random.' },
  { value: 'centre', label: 'A seed in the middle', hint: 'A round patch of noise in the middle.' },
  { value: 'empty', label: 'Empty', hint: 'Nothing: paint with the brush.' },
  { value: 'image', label: 'A picture', hint: 'Wire a picture into Start image: its bright parts start on.' },
];

function StartSection({ p, set }: { p: P; set: Setter }) {
  const tk = useTokens();
  const s = gridShape(p);
  const deal = () => { set({ reset: 1 }, true); window.setTimeout(() => set({ reset: 0 }, true), 120); };
  return (
    <>
      <div role="radiogroup" aria-label="Start" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {START_OPTIONS.map(o => {
          const on = o.value === s.start;
          return (
            <button key={o.value} type="button" role="radio" aria-checked={on} data-start={o.value} title={o.hint} onClick={() => !on && set({ start: o.value }, true)}
              style={{
                textAlign: 'left', border: 0, borderRadius: radius.md, padding: '8px 10px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2,
                background: on ? tk.bg.selected : tk.bg.field, boxShadow: on ? `inset 0 0 0 1.5px ${tk.accent.base}` : `inset 0 0 0 1px ${tk.border.subtle}`, color: tk.text.primary,
              }}>
              <b style={{ font: `600 12.5px ${fontFamily.ui}`, color: on ? tk.accent.text : tk.text.primary }}>{o.label}</b>
              <span style={{ fontSize: 11, color: tk.text.muted, lineHeight: 1.35 }}>{o.hint}</span>
            </button>
          );
        })}
      </div>
      {s.start === 'cells' && (
        <span data-start-drawing style={{ fontSize: 12, color: s.startCells ? tk.text.secondary : tk.status.warningText, lineHeight: 1.45 }}>
          {s.startCells ? `${drawnCount(s.startCells)} cells drawn (${s.startCells.w} × ${s.startCells.h}). Draw on the board and press Use as the start to change it.` : 'Nothing drawn yet: draw on the board, then press Use as the start.'}
        </span>
      )}
      {s.start === 'text' && <TextStartFields p={p} set={set} />}
      {(s.start === 'noise' || s.start === 'centre') && <Slider p={p} set={set} k="density" label="How full" min={0} max={1} hint="The share of cells that start on." />}
      <Row label=""><Button size="sm" icon="dice" onClick={deal}>Deal a new board</Button></Row>
      <Row label="Board size" hint="How many cells: each cell is a block of the picture's pixels.">
        <Select ariaLabel="Board size" style={{ maxWidth: '100%' }} value={String(p.board ?? '0.125')} onChange={v => set({ board: v }, true)} options={BOARD_SIZES.map(b => ({ value: b.value, label: b.label.replace(' at 1080p', '') }))} />
      </Row>
      <Row label="Edges" hint="Wrap: what leaves one side comes back on the other. Walls: the edge is empty.">
        <Segmented<string> ariaLabel="Edges" size="sm" value={s.wrap ? 'wrap' : 'walls'} onChange={v => set({ edges: v }, true)} options={[{ value: 'wrap', label: 'Wrap round' }, { value: 'walls', label: 'Walls' }]} />
      </Row>
    </>
  );
}

/** Start → Text: the words, their size, weight and place, and (several states) the state they start in. */
function TextStartFields({ p, set }: { p: P; set: Setter }) {
  const tk = useTokens();
  const s = gridShape(p);
  const st = readStartText(p.startText);
  const [draft, setDraft] = useState<string | null>(null);
  const put = (patch: Partial<StartText>, immediate = false) => set({ startText: { ...st, ...patch } }, immediate);
  const top = s.type === 'count' || s.type === 'smooth' ? 1 : Math.max(2, Math.round(num(p, 'states'))) - 1;
  const row = (label: string, hint: string, key: 'size' | 'weight' | 'x' | 'y' | 'state', min: number, max: number, o: { integer?: boolean; step?: number } = {}) => (
    <Row label={label} hint={hint}>
      <BuilderSlider ariaLabel={`Text ${label.toLowerCase()}`} value={st[key]} min={min} max={max} step={o.step ?? (o.integer ? 1 : 0.01)} integer={o.integer}
        defaultValue={DEFAULT_START_TEXT[key]} rangeKey={`grid:text:${key}`} onChange={v => put({ [key]: v })} />
    </Row>
  );
  const cells = s.startCells ? drawnCount(s.startCells) : 0;
  return (
    <div data-text-start style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Row label="Words" hint={`A–Z, 0–9 and ! ? . , : ' - + * / = #, up to ${MAX_TEXT_CHARS}. Drawn in the stroke font (the Agent Builder's).`}>
        <Field aria-label="Text start words" value={draft ?? st.text} maxLength={MAX_TEXT_CHARS * 2} data-text-start-words
          onChange={e => { setDraft(e.target.value); const t = cleanStartText(e.target.value); if (t) put({ text: t }); }}
          onBlur={() => setDraft(null)} />
      </Row>
      {row('Size', 'How many cells tall the letters are.', 'size', MIN_TEXT_SIZE, MAX_TEXT_SIZE, { integer: true })}
      {row('Weight', 'How thick the strokes are (half their width, in the letters\' units: they are 2 tall). Thin strokes stay one cell wide.', 'weight', 0.02, 0.8)}
      {row('Across', 'Where the words\' middle is, in cells right of the board\'s middle.', 'x', -120, 120, { integer: true })}
      {row('Up', 'Where the words\' middle is, in cells above the board\'s middle.', 'y', -70, 70, { integer: true })}
      {top > 1 && row('State', 'The state the letters\' cells start in.', 'state', 1, top, { integer: true })}
      <span data-text-start-cells style={{ fontSize: 12, color: cells ? tk.text.secondary : tk.status.warningText, lineHeight: 1.45 }}>
        {cells ? `${cells} cells start live (${s.startCells!.w} × ${s.startCells!.h}). The try board shows them; Life eats into the letters from the first step.` : 'No letters the font knows: type A–Z or 0–9.'}
      </span>
    </div>
  );
}

function RunSection({ p, set }: { p: P; set: Setter }) {
  const tk = useTokens();
  const s = gridShape(p);
  return (
    <>
      <span data-steps-a-second style={{ fontSize: 13, fontWeight: 600 }}>{Math.round(stepsPerSecond(p))} steps a second</span>
      {s.steps === 1 && <Slider p={p} set={set} k="rate" label="Speed" min={0} max={1} hint="Below 1, the board steps on some frames only: 0.5 is every other frame (30 steps a second)." />}
      <Slider p={p} set={v => set(v, true)} k="steps" label="Steps a frame" min={1} max={MAX_STEPS} step={1} integer hint="The rule runs this many times each frame (the board Pass's Repeat): faster, for slow rules like growing patterns." />
      <Slider p={p} set={set} k="seed" label="Seed" min={0} max={100} step={1} integer hint="The dice the start (and Blocks' chances) roll from: the same seed deals the same board." />
      <span style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.45 }}>The try board plays Slow, Medium or As built (this speed): pick under the board.</span>
    </>
  );
}

function BrushSection({ p, set }: { p: P; set: Setter }) {
  const s = gridShape(p);
  const discrete = s.type !== 'smooth';
  const top = s.type === 'count' ? 1 : s.type === 'smooth' ? 1 : Math.round(num(p, 'states')) - 1;
  return (
    <>
      <Slider p={p} set={set} k="brushRadius" label="Size (cells)" min={0.5} max={40} step={0.5} />
      {discrete
        ? <Slider p={p} set={set} k="brushState" label="Paints state" min={0} max={top} step={1} integer hint="0 erases." />
        : <Slider p={p} set={set} k="brushState" label="Sets value" min={-1} max={1} />}
      {discrete && <Slider p={p} set={set} k="brushFill" label="Fill" min={0} max={1} hint="The share of cells under the brush it paints each frame (a solid block of Life just dies)." />}
    </>
  );
}

function LookSection({ p, set }: { p: P; set: Setter }) {
  const tk = useTokens();
  const s = gridShape(p);
  const discrete = s.type !== 'smooth';
  return (
    <>
      <ColourRows p={p} set={set} />
      {discrete ? (
        <>
          <Slider p={p} set={set} k="afterglow" label="Afterglow" min={0} max={0.99} hint="A cell that just died glows and fades: how much of the glow is kept each step." />
          <Fold id="colours-age" title="Ageing" summary={`ageing ${num(p, 'ageRate')} · age fade ${num(p, 'ageFade')}`}>
            <Slider p={p} set={set} k="ageRate" label="Ageing" min={0} max={0.2} step={0.001} />
            <Slider p={p} set={set} k="ageFade" label="Age fade" min={0} max={1} />
          </Fold>
        </>
      ) : <Slider p={p} set={set} k="gain" label="Contrast" min={0} max={8} hint="How strongly the values are spread over the colours." />}
      <Row label="Picture shows" hint="What the node's Color output shows. The State, On, Age, Shade and Neighbours sockets always carry these numbers too.">
        <Select ariaLabel="Color shows" value={gridViewMode(p.view)} onChange={v => set({ view: v }, true)} options={GRID_VIEWS.map(v => ({ value: v.value, label: v.label }))} />
      </Row>
      <span style={{ fontSize: 12, lineHeight: 1.4, color: tk.text.muted }}>{GRID_VIEWS.find(v => v.value === gridViewMode(p.view))?.hint}</span>
    </>
  );
}

function ColourRows({ p, set }: { p: P; set: Setter }) {
  const s = gridShape(p);
  const rows: Array<[string, string]> = s.type === 'smooth'
    ? [['color0', 'Low'], ['color1', 'Second'], ['color2', 'Third'], ['color3', 'High']]
    : s.type === 'patterns' || s.type === 'blocks'
      ? [...Array.from({ length: Math.max(2, Math.min(8, Math.round(Number(p.states)))) }, (_, k) => [`color${k}`, k === 0 ? 'State 0 (empty)' : `State ${k}`] as [string, string]), ['glowColor', 'Afterglow'], ['oldColor', 'Old cells']]
    : [['color0', 'Empty'], ['color1', 'On'], ...(s.type === 'stages' ? [['color2', 'First fading'], ['color3', 'Last fading']] as Array<[string, string]> : []), ['glowColor', 'Afterglow'], ['oldColor', 'Old cells']];
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

/** Smooth's own update: one line each for the new u and v, the knobs, and the names it can use. */
function CustomUpdate({ p, set }: { p: P; set: Setter }) {
  const tk = useTokens();
  const uProblem = customUpdateProblem(String(p.customU ?? ''));
  const vProblem = customUpdateProblem(String(p.customV ?? ''));
  const [draftU, setDraftU] = useState<string | null>(null);
  const [draftV, setDraftV] = useState<string | null>(null);
  return (
    <>
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
      <span style={{ fontSize: 11.5, color: tk.text.faint, display: 'flex', gap: 6, alignItems: 'center' }}><Icon name="info" size={12} />The try board shows your update as plain spreading; the node runs it.</span>
    </>
  );
}

/** One custom Smooth update: names and functions completed as you type; refused when it isn't one number. */
function UpdateField({ label, value, saved, onDraft, onUse }: { label: string; value: string; saved: string | null; onDraft: (v: string | null) => void; onUse: (v: string) => void }) {
  const tk = useTokens();
  const [caret, setCaret] = useState<number | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const change = (v: string) => { setDraft(v); onDraft(v); if (!customUpdateProblem(v)) onUse(v); };
  const ta = useTypeAhead(value, caret, (t, c) => wordAssist(t, c, UPDATE_WORDS), (next, at) => { change(next); setCaret(at); });
  const problem = useMemo(() => (draft !== null ? customUpdateProblem(draft) : saved), [draft, saved]);
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

/** The rule as text in the Playfield language (lang/dialects/grid.ts): the form, both ways. */
function GridRecipeTab({ params, set }: { params: P; set: Setter }) {
  const printed = useMemo(() => printGrid(params, { pretty: true }), [params]);
  const read = useCallback((text: string, seed: number): LanguageRead => {
    const r = parseGrid(text, { base: params, seed });
    return {
      errors: r.errors, hints: r.hints, resolved: r.resolved,
      apply: () => {
        const patch: P = {};
        for (const k of [...RECIPE_KEYS, 'startText']) if (r.params[k] !== undefined && JSON.stringify(r.params[k]) !== JSON.stringify(params[k])) patch[k] = r.params[k];
        if (r.params.ruleType !== params.ruleType) patch.ruleType = r.params.ruleType;
        // Stacked rules (the `then` lines): not a default param, so compared on their own.
        if (JSON.stringify(readStack(r.params.stack)) !== JSON.stringify(readStack(params.stack))) patch.stack = readStack(r.params.stack);
        if (Object.keys(patch).length) set(patch, true);
      },
      kept: printGrid(r.params, { pretty: true }),
    };
  }, [params, set]);
  return (
    <LanguageTab dialect="grid" printed={printed} read={read}
      note="A preset (life, seeds, brians-brain, mitosis, falling-sand…) or a rule type, then what differs: born=3,6 survive=2,3 neighbours=von-neumann board=480 walls speed=0.3. Patterns are stencil lines, Blocks are block lines, stacked rules are then lines (then explode copies=8). In the Do… bar the same line starts with grid when its name is also another word (grid swirl)."
      examples={[
        { label: 'HighLife on walls', text: 'highlife walls board=480' },
        { label: 'Bosco', text: 'count neighbours=radius radius=5 born=34..45 survive=33..57' },
        { label: 'Wireworld', text: 'patterns states=4\n  stencil .../.1./... → 2\n  stencil .../.2./... → 3\n  stencil .../.3./... → 1 count=1:1..2' },
        { label: 'Random coral', text: 'smooth reaction feed=random kill=random' },
      ]} />
  );
}
