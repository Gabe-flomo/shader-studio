/**
 * FinishPanel — the Play page's Finish tab: an ordered stack of effects over
 * the final picture (the shader and every layer), finished in one pass by
 * play/kit/finish.js. See docs/finish-stack.md.
 *
 * Each effect is a card: on/off, fold, move, reset, remove. Every number is a
 * ruler with a + that makes it a control (`finish:<effect>::<key>`), so the
 * mouse, audio, LFOs or hands can drive it like any slider. The Grade card is
 * laid out like Lumetri: a Look to start from, Basic, Curves, Colour wheels,
 * Split toning, HSL secondary, Tone mapping.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { Button, IconButton } from '../../ui/Button';
import { Toggle, Segmented } from '../../ui/Choice';
import { Select } from '../../ui/Select';
import { RulerSlider } from '../../ui/RulerSlider';
import { Tooltip } from '../../ui/Tooltip';
import { Icon } from '../../ui/Icon';
import { Menu, type MenuItem } from '../../ui/Menu';
import { ColorSwatch } from '../../ui/ColorPicker';
import { GroupedPicker, type PickerSection } from '../../ui/GroupedPicker';
import type { IconName } from '../../ui/iconPaths';
import { askConfirm, askText } from '../../ui/dialogStore';
import { toast } from '../../ui/toastStore';
import { moveItem } from '../../../lib/reorder';
import { playId } from '../../../play/playControls';
import { Section } from '../layers/Section';
import { usePlayUi } from '../playUi';
import { CurveEditor } from './CurveEditor';
import { ColourWheel } from './ColourWheel';
import { deleteLook, loadSavedLooks, saveLook, SAVED_LOOKS_CHANGED, type SavedLook } from './savedLooks';
import {
  applyStackPreset, deleteStackPreset, EFFECT_TEMPLATE, FINISH_LIBRARY_CHANGED, loadSavedEffects, loadStackPresets, renameStackPreset, saveEffect, saveStackPreset,
  type StackPreset,
} from './finishLibrary';
import { GlslEditor } from '../../code/GlslEditor';
import type { PlayControl, PlayRecord } from '../../../types/play';
import {
  FINISH_COMPARE_ID, FINISH_EFFECTS, FINISH_KINDS, FINISH_TIME_QUALITY, GRADE_LOOKS, applyLook, compareHost, emptyFinish, finishCustomCode, finishHostLabel, finishHosts,
  finishParamOf, finishParamsOf, finishTarget, lookFromGrade, newCustomEffect, newFinishEffect, patchFinishEffect, withCustomCode,
  type FinishCompare, type FinishEffect, type FinishHost, type FinishKind, type PlayFinish,
} from '../../../types/playFinish';
import { FN_COMPARE_PARAMS, fnCheckCustom, fnDefaultCompare, fnParseCustom, fnRingSize, type FnParam } from '../../../play/kit/finish.js';

const TONE_OPTIONS = [
  { value: 'none', label: 'None' }, { value: 'aces', label: 'ACES' }, { value: 'agx', label: 'AgX' }, { value: 'hable', label: 'Hable' },
  { value: 'reinhard2', label: 'Reinhard2' }, { value: 'unreal', label: 'Unreal' }, { value: 'lottes', label: 'Lottes' }, { value: 'uchimura', label: 'Uchimura' },
  { value: 'tanh', label: 'Tanh' }, { value: 'oklab', label: 'OkLab (hue-preserving)' },
];
const TIME_MAPS = [
  { value: 'slit', label: 'Slit-scan', title: 'Time runs across the picture in one direction' },
  { value: 'luma', label: 'Brightness', title: 'Bright parts show the past, dark parts now' },
  { value: 'noise', label: 'Noise', title: 'Drifting blotches of the past' },
  { value: 'radial', label: 'Radial', title: 'The past grows outward from a centre' },
  { value: 'layer', label: 'A layer', title: 'Where a layer is (even a hidden one), the past shows' },
];
/** Halation presets: they only set the sliders. */
const HALATION_PRESETS: Array<{ name: string; values: Record<string, number> }> = [
  { name: 'Subtle', values: { amount: 0.4, reach: 0.35, threshold: 1, headroom: 5, warmth: 0.3, growth: 0.2 } },
  { name: 'Classic cine', values: { amount: 0.8, reach: 0.55, threshold: 0.5, headroom: 6, warmth: 0.5, growth: 0.4 } },
  { name: 'Strong', values: { amount: 1.4, reach: 0.8, threshold: 0, headroom: 8, warmth: 0.7, growth: 0.7 } },
];

export function FinishPanel({ play, onChange, touch, wide = false }: {
  play: PlayRecord;
  onChange: (fn: (p: PlayRecord) => PlayRecord) => void;
  touch: boolean;
  /** The split view's wide panel: cards in columns. */
  wide?: boolean;
}) {
  const tk = useTokens();
  const finish = play.finish ?? emptyFinish();
  const focus = usePlayUi(s => s.finishFocus), focusTick = usePlayUi(s => s.finishTick);
  const exposed = useMemo(() => new Set(play.controls.map(c => c.target)), [play.controls]);
  const [lib, setLib] = useState(() => ({ presets: loadStackPresets(), effects: loadSavedEffects() }));
  useEffect(() => {
    const on = () => setLib({ presets: loadStackPresets(), effects: loadSavedEffects() });
    window.addEventListener(FINISH_LIBRARY_CHANGED, on);
    return () => window.removeEventListener(FINISH_LIBRARY_CHANGED, on);
  }, []);
  const [presetMenu, setPresetMenu] = useState<{ x: number; y: number } | null>(null);

  const setFinish = (fn: (f: PlayFinish) => PlayFinish) => onChange(p => {
    const next = fn(p.finish ?? emptyFinish());
    // Controls on an effect that went go with it (and their mappings). The wipe's stay while the stack does.
    const ids = new Set(finishHosts(next).map(e => e.id));
    const gone = p.controls.filter(c => c.target.startsWith('finish:') && !ids.has(c.target.slice(7, c.target.lastIndexOf('::')))).map(c => c.id);
    const out: PlayRecord = { ...p, finish: next.effects.length || !next.on ? next : undefined };
    if (gone.length) { const g = new Set(gone); out.controls = p.controls.filter(c => !g.has(c.id)); out.mappings = p.mappings.filter(m => !g.has(m.controlId)); }
    return out;
  });
  const patch = (id: string, change: Record<string, unknown>) => setFinish(f => patchFinishEffect(f, id, change)!);
  const expose = (e: FinishHost, p: FnParam) => onChange(r => {
    const target = finishTarget(e.id, p.key);
    if (r.controls.some(c => c.target === target)) return r;
    const control: PlayControl = { id: playId('ctl'), target, kind: 'float', label: `${finishHostLabel(e)} · ${p.label}`, min: p.min, max: p.max, ...(p.step ? { step: p.step } : {}) };
    toast.success(`${control.label} is a control`, { message: 'Map a source onto it in Mappings (audio, an LFO, the mouse…).', action: { label: 'Show', onClick: () => usePlayUi.getState().setTab('controls') } });
    return { ...r, controls: [...r.controls, control] };
  });
  const push = (e: FinishEffect) => {
    setFinish(f => ({ ...f, on: true, effects: [...f.effects, e] }));
    usePlayUi.getState().revealFinish(e.id);
  };
  const add = (value: string) => {
    if (value === NEW_CODE) { push(newCustomEffect({ name: 'Posterize', code: EFFECT_TEMPLATE })); return; }
    if (value.startsWith(SAVED_PREFIX)) {
      const d = lib.effects.find(x => x.id === value.slice(SAVED_PREFIX.length));
      if (d) push(newCustomEffect({ name: d.name, code: d.code, defId: d.id, ...(d.sealed ? { sealed: d.sealed } : {}) }));
      return;
    }
    const kind = value as FinishKind;
    if (!FINISH_EFFECTS[kind] || finish.effects.some(e => e.kind === kind)) return;
    push(newFinishEffect(kind));
  };

  const sections: PickerSection[] = useMemo(() => {
    const groups = new Map<string, PickerSection['items'][number][]>();
    for (const k of FINISH_KINDS) {
      const d = FINISH_EFFECTS[k];
      const inStack = finish.effects.some(e => e.kind === k);
      const list = groups.get(d.group) ?? [];
      list.push({ value: k, label: d.label, description: inStack ? 'Already in the stack' : d.summary, icon: d.icon as IconName, disabled: inStack });
      groups.set(d.group, list);
    }
    const yours: PickerSection['items'][number][] = [
      ...lib.effects.map(d => ({ value: SAVED_PREFIX + d.id, label: d.name, description: d.description || (d.sealed ? `Sealed${d.pack ? ` · ${d.pack}` : ''}` : d.pack ? `From ${d.pack}` : 'Your effect code'), icon: 'code' as IconName })),
      { value: NEW_CODE, label: 'New effect code…', description: 'Write vec3 effect(vec2 uv, vec3 color) in GLSL; uniforms become sliders', icon: 'plus' as IconName },
    ];
    return [...[...groups].map(([heading, items]) => ({ heading, items })), { heading: 'Your effects', items: yours }];
  }, [finish.effects, lib.effects]);

  // Stack presets: save, and load (Replace stack / Add to stack), rename, delete.
  const savePreset = async () => {
    const name = await askText('Save the stack as a preset', { label: 'Name', initial: 'My finish', confirmLabel: 'Save preset' });
    if (!name?.trim()) return;
    const { result } = saveStackPreset(name.trim(), finish);
    if (!result.ok) { toast.error('Couldn’t save the preset', { message: result.error }); return; }
    toast.success(`Saved “${name.trim()}”`, { message: 'Every effect, its order and its settings. Load it from Presets on any Play.' });
  };
  const loadPreset = (pr: StackPreset, mode: 'replace' | 'add') => {
    let skipped: string[] = [];
    setFinish(f => { const r = applyStackPreset(f, pr, mode); skipped = r.skipped; return r.finish; });
    if (skipped.length) toast.info(`Added “${pr.name}”`, { message: `Left out ${skipped.join(', ')}: the stack already has ${skipped.length === 1 ? 'one' : 'them'}.` });
  };
  const renamePreset = async (pr: StackPreset) => {
    const name = await askText('Rename the preset', { label: 'Name', initial: pr.name, confirmLabel: 'Rename' });
    if (name?.trim()) renameStackPreset(pr.id, name);
  };
  const removePreset = async (pr: StackPreset) => {
    if (await askConfirm(`Delete the preset “${pr.name}”?`, { message: 'Plays that loaded it keep their stacks.', confirmLabel: 'Delete', danger: true })) deleteStackPreset(pr.id);
  };
  const presetItems: MenuItem[] = [
    { label: 'Save stack as preset…', icon: 'save', disabled: !finish.effects.length, hint: 'Every effect, its order and settings', onSelect: () => { void savePreset(); } },
    ...lib.presets.flatMap((pr): MenuItem[] => [
      'separator',
      { heading: `${pr.name} · ${pr.finish.effects.map(e => finishHostLabel(e)).join(', ')}`.slice(0, 90) },
      { label: 'Replace stack', icon: 'import', onSelect: () => loadPreset(pr, 'replace') },
      { label: 'Add to stack', icon: 'plus', onSelect: () => loadPreset(pr, 'add') },
      { label: 'Rename…', icon: 'edit', onSelect: () => { void renamePreset(pr); } },
      { label: 'Delete', icon: 'trash', danger: true, onSelect: () => { void removePreset(pr); } },
    ]),
  ];

  const compare = finish.compare;
  const active = finish.on && finish.effects.some(e => e.enabled);
  const toggleWipe = () => setFinish(f => ({ ...f, compare: { ...(f.compare ?? fnDefaultCompare()), on: !f.compare?.on } }));
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 12px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '2px 0 8px' }}>
        <Toggle checked={finish.on} onChange={on => setFinish(f => ({ ...f, on }))} label="Finish" />
        <Tooltip label="Before / after wipe" description="Split the picture: on one side of the divider, the picture before the Finish stack. It is saved with the Play, shows in renders and exports, and its position and angle can be mapped (an LFO makes a moving wipe). Drag the divider on the picture." placement="bottom">
          <span>
            <Button size="sm" variant={compare?.on ? 'primary' : 'secondary'} icon="layoutSplit" disabled={!active} onClick={toggleWipe}>Before / after</Button>
          </span>
        </Tooltip>
        <Button size="sm" icon="presets" onClick={ev => { const r = (ev.currentTarget as HTMLElement).getBoundingClientRect(); setPresetMenu({ x: r.left, y: r.bottom + 4 }); }}>Presets</Button>
        <span style={{ flex: 1 }} />
        <div style={{ minWidth: 170 }}>
          <GroupedPicker value="" placeholder="+ Add effect" ariaLabel="Add an effect" title="Add an effect" sections={sections} onChange={add} width={300} search={false} />
        </div>
      </div>
      {presetMenu && <Menu x={presetMenu.x} y={presetMenu.y} items={presetItems} onClose={() => setPresetMenu(null)} title="Stack presets" minWidth={230} />}
      {compare?.on && active && (
        <WipeCard compare={compare} touch={touch} exposed={exposed} onPatch={change => patch(FINISH_COMPARE_ID, change)} onExpose={p => expose(compareHost(compare), p)} />
      )}
      {finish.effects.length === 0 && (
        <div style={{ padding: '18px 14px', borderRadius: radius.md, background: tk.bg.panel, border: `1px dashed ${tk.border.strong}`, color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}` }}>
          <div style={{ color: tk.text.secondary, font: `650 12.5px ${fontFamily.ui}`, marginBottom: 4 }}>Finish the whole picture</div>
          Effects here work on the final frame, the shader and every layer together, like a colourist’s grade and a lens on the camera. Start with a <b>Grade</b>, or add <b>Bloom</b>, <b>Film grain</b>, a <b>CRT</b> or <b>Time displacement</b>, or write your own under <b>+ Add effect → Your effects</b>. With nothing here the picture costs nothing extra.
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            {(['grade', 'bloom', 'grain', 'vignette'] as FinishKind[]).map(k => <Button key={k} size="sm" icon="plus" onClick={() => add(k)}>{FINISH_EFFECTS[k].label}</Button>)}
          </div>
        </div>
      )}
      <div style={wide ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(380px, 100%), 1fr))', gap: 10, alignItems: 'start' } : { display: 'flex', flexDirection: 'column', gap: 8 }}>
        {finish.effects.map((e, i) => (
          <EffectCard
            key={e.id}
            effect={e}
            index={i}
            count={finish.effects.length}
            dimmed={!finish.on}
            touch={touch}
            focused={focus === e.id}
            focusTick={focusTick}
            layers={play.layers.map(l => ({ id: l.id, label: l.label }))}
            exposed={exposed}
            onPatch={change => patch(e.id, change)}
            onReplace={next => setFinish(f => ({ ...f, effects: f.effects.map(x => (x.id === e.id ? next : x)) }))}
            onExpose={p => expose(e, p)}
            onReorder={(from, to) => setFinish(f => ({ ...f, effects: moveItem(f.effects, from, to) }))}
            onRemove={() => setFinish(f => ({ ...f, effects: f.effects.filter(x => x.id !== e.id) }))}
          />
        ))}
      </div>
      {finish.effects.length > 1 && (
        <div style={{ marginTop: 10, color: tk.text.faint, font: `11px/1.45 ${fontFamily.ui}` }}>
          Colour effects (your own included) run top to bottom. Camera shake, lens distortion and CRT curvature bend the picture before anything reads it; chromatic aberration and time displacement choose what is read.
        </div>
      )}
    </div>
  );
}

const NEW_CODE = '__code';
const SAVED_PREFIX = 'saved:';

// ── The before/after wipe ───────────────────────────────────────────────────

function WipeCard({ compare, touch, exposed, onPatch, onExpose }: {
  compare: FinishCompare;
  touch: boolean;
  exposed: Set<string>;
  onPatch: (change: Record<string, unknown>) => void;
  onExpose: (p: FnParam) => void;
}) {
  const tk = useTokens();
  const host = compareHost(compare);
  return (
    <div style={{ borderRadius: radius.md, background: tk.bg.panel, border: `1px solid ${tk.border.default}`, padding: '6px 10px 10px', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name="layoutSplit" size={14} style={{ color: tk.accent.base, flexShrink: 0 }} />
        <span style={{ flex: 1, color: tk.text.primary, font: `650 12.5px ${fontFamily.ui}` }}>Before / after wipe</span>
        <IconButton icon="close" size="sm" label="Turn the wipe off (its settings are kept)" onClick={() => onPatch({ on: false })} />
      </div>
      {FN_COMPARE_PARAMS.map(p => <NumRow key={p.key} e={host} p={p} touch={touch} exposed={exposed.has(finishTarget(FINISH_COMPARE_ID, p.key))} onSet={v => onPatch({ [p.key]: v })} onExpose={onExpose} />)}
      <Note>Saved with the Play and drawn in renders, takes, stills and websites. Map <b>Position</b> (an LFO, the mouse, audio) for a moving wipe; drag the divider on the picture to place it.</Note>
    </div>
  );
}

// ── One effect ───────────────────────────────────────────────────────────────

function EffectCard({ effect: e, index, count, dimmed, touch, focused, focusTick, layers, exposed, onPatch, onReplace, onExpose, onReorder, onRemove }: {
  effect: FinishEffect;
  index: number;
  count: number;
  dimmed: boolean;
  touch: boolean;
  focused: boolean;
  focusTick: number;
  layers: Array<{ id: string; label: string }>;
  exposed: Set<string>;
  onPatch: (change: Partial<FinishEffect>) => void;
  onReplace: (e: FinishEffect) => void;
  onExpose: (p: FnParam) => void;
  /** Move the card at `from` to `to` (this card's buttons, or another card dropped on this one). */
  onReorder: (from: number, to: number) => void;
  onRemove: () => void;
}) {
  const onMove = (to: number) => onReorder(index, to);
  const tk = useTokens();
  const custom = e.kind === 'custom';
  const title = finishHostLabel(e);
  const icon: IconName = custom ? 'code' : FINISH_EFFECTS[e.kind as FinishKind].icon as IconName;
  const foldKey = `finish:${e.id}`;
  const folded = usePlayUi(s => !!s.folded[foldKey]);
  const toggleFold = usePlayUi(s => s.toggleFold);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  // Opened from a control's "go to" or just added: unfold and scroll to it.
  useEffect(() => {
    if (!focused || !el) return;
    if (usePlayUi.getState().folded[foldKey]) toggleFold(foldKey);
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick, focused, el]);
  const items: MenuItem[] = [
    { label: 'Move up', icon: 'chevU', disabled: index === 0, onSelect: () => onMove(index - 1) },
    { label: 'Move down', icon: 'chevD', disabled: index === count - 1, onSelect: () => onMove(index + 1) },
    'separator',
    ...(custom ? [
      { label: 'Rename…', icon: 'edit', onSelect: () => { void askText('Rename the effect', { label: 'Name', initial: title, confirmLabel: 'Rename' }).then(n => { if (n?.trim()) onPatch({ name: n.trim().slice(0, 60) }); }); } },
      ...(e.sealed ? [] : [{ label: e.defId ? 'Save to Your effects (update)' : 'Save to Your effects', icon: 'save', hint: 'Keep it in + Add effect → Your effects', onSelect: () => {
        const { result, saved } = saveEffect({ name: title, code: e.code ?? '', ...(e.defId && loadSavedEffects().some(x => x.id === e.defId && !x.sealed) ? { id: e.defId } : {}) });
        if (!result.ok || !saved) { toast.error('Couldn’t save the effect', { message: result.ok ? undefined : result.error }); return; }
        onPatch({ defId: saved.id });
        toast.success(`Saved “${saved.name}”`, { message: 'It is under + Add effect → Your effects, in library exports and node packs.' });
      } } as MenuItem]),
    ] as MenuItem[] : []),
    { label: 'Reset to defaults', icon: 'resetParams', onSelect: () => onReplace(custom ? { ...newCustomEffect({ name: title, code: e.code ?? '', ...(e.defId ? { defId: e.defId } : {}), ...(e.sealed ? { sealed: e.sealed } : {}) }, e.id), enabled: e.enabled } : { ...newFinishEffect(e.kind as FinishKind, e.id), enabled: e.enabled }) },
    { label: 'Remove', icon: 'trash', danger: true, onSelect: onRemove },
  ];
  const k = kitFor(e, touch, exposed, onPatch, onExpose);
  return (
    <div ref={setEl} style={{ borderRadius: radius.md, background: tk.bg.panel, border: `1px solid ${focused ? alpha(tk.accent.base, 0.5) : tk.border.default}`, opacity: dimmed ? 0.6 : 1 }}>
      <div
        draggable={!touch}
        onDragStart={ev => { ev.dataTransfer.setData('text/finish-index', String(index)); ev.dataTransfer.effectAllowed = 'move'; }}
        onDragOver={ev => { if (ev.dataTransfer.types.includes('text/finish-index')) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; } }}
        onDrop={ev => { const from = Number(ev.dataTransfer.getData('text/finish-index')); if (Number.isFinite(from) && from >= 0 && from < count && from !== index) { ev.preventDefault(); onReorder(from, index); } }}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 6px 6px 8px', cursor: touch ? 'default' : 'grab' }}
      >
        {!touch && <Icon name="grip" size={12} style={{ color: tk.text.disabled, flexShrink: 0 }} />}
        <Icon name={icon} size={14} style={{ color: e.enabled ? tk.accent.base : tk.text.faint, flexShrink: 0 }} />
        <button type="button" onClick={() => toggleFold(foldKey)} aria-expanded={!folded} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.text.primary, font: `650 12.5px ${fontFamily.ui}`, textAlign: 'left' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
          {e.kind === 'grade' && e.look && <span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lookName(e.look)}</span>}
        </button>
        <Toggle checked={e.enabled} onChange={enabled => onPatch({ enabled })} />
        <IconButton icon={folded ? 'chevR' : 'chevD'} size="sm" label={folded ? 'Show settings' : 'Fold'} onClick={() => toggleFold(foldKey)} />
        <IconButton icon="more" size="sm" label="Move, reset or remove" onClick={ev => { const r = (ev.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: r.right - 190, y: r.bottom + 4 }); }} />
      </div>
      {!folded && (
        <div style={{ padding: '0 10px 10px', opacity: e.enabled ? 1 : 0.55 }}>
          {editorFor(e, k, touch, layers, onPatch, onReplace)}
        </div>
      )}
      {menu && <Menu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} title={title} />}
    </div>
  );
}

// ── Rows ─────────────────────────────────────────────────────────────────────

interface RowKit {
  num: (key: string, label?: string) => ReactNode;
  nums: (...keys: string[]) => ReactNode;
  colour: (label: string, keys: [string, string, string], hint?: string) => ReactNode;
  row: (label: string, body: ReactNode, hint?: string) => ReactNode;
  note: (text: ReactNode) => ReactNode;
}

function kitFor(e: FinishEffect, touch: boolean, exposed: Set<string>, onPatch: (c: Partial<FinishEffect>) => void, onExpose: (p: FnParam) => void): RowKit {
  return {
    num: (key, label) => <NumRow key={key} e={e} p={finishParamOf(e, key)!} label={label} touch={touch} exposed={exposed.has(finishTarget(e.id, key))} onSet={v => onPatch({ [key]: v })} onExpose={onExpose} />,
    nums: (...keys) => keys.map(key => <NumRow key={key} e={e} p={finishParamOf(e, key)!} touch={touch} exposed={exposed.has(finishTarget(e.id, key))} onSet={v => onPatch({ [key]: v })} onExpose={onExpose} />),
    colour: (label, keys, hint) => <Row key={`c:${label}`} label={label} hint={hint}><ColorSwatch label={label} value={[num(e, keys[0]), num(e, keys[1]), num(e, keys[2])]} onChange={([r, g, b]) => onPatch({ [keys[0]]: r, [keys[1]]: g, [keys[2]]: b })} size="sm" /></Row>,
    row: (label, body, hint) => <Row key={`r:${label}`} label={label} hint={hint}>{body}</Row>,
    note: text => <Note>{text}</Note>,
  };
}

const num = (e: FinishHost, key: string): number => { const v = e[key]; return typeof v === 'number' ? v : finishParamOf(e, key)?.value ?? 0; };

function Label({ text, hint }: { text: string; hint?: string }) {
  const tk = useTokens();
  const st: React.CSSProperties = { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', width: 78, flexShrink: 0, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
  return hint ? <Tooltip label={text} description={hint} placement="top"><span style={{ ...st, cursor: 'help' }}>{text}</span></Tooltip> : <span style={st}>{text}</span>;
}
function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}><Label text={label} hint={hint} />{children}</div>;
}
function Note({ children }: { children: ReactNode }) {
  const tk = useTokens();
  return <div style={{ marginTop: 6, color: tk.text.faint, font: `11px/1.45 ${fontFamily.ui}` }}>{children}</div>;
}

function NumRow({ e, p, label, touch, exposed, onSet, onExpose }: { e: FinishHost; p: FnParam; label?: string; touch: boolean; exposed: boolean; onSet: (v: number) => void; onExpose: (p: FnParam) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
      <Label text={label ?? p.label} hint={p.hint || undefined} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <RulerSlider value={num(e, p.key)} min={p.min} max={p.max} step={p.step} defaultValue={p.value} onChange={onSet} ariaLabel={`${finishHostLabel(e)} ${p.label}`} touch={touch} integer={p.step === 1 && p.max - p.min === 1} />
      </div>
      <IconButton icon={exposed ? 'check' : 'plus'} size="sm" active={exposed} disabled={exposed} label={exposed ? 'Already a control' : `Make ${p.label} a control, to map audio, an LFO or the mouse onto it`} onClick={() => onExpose(p)} />
    </div>
  );
}

// ── Editors ──────────────────────────────────────────────────────────────────

function editorFor(e: FinishEffect, k: RowKit, touch: boolean, layers: Array<{ id: string; label: string }>, onPatch: (c: Partial<FinishEffect>) => void, onReplace: (e: FinishEffect) => void): ReactNode {
  switch (e.kind) {
    case 'grade': return <GradeEditor e={e} k={k} touch={touch} onPatch={onPatch} onReplace={onReplace} />;
    case 'vignette': return <>{k.nums('amount', 'size', 'roundness', 'feather')}{k.colour('Colour', ['colorR', 'colorG', 'colorB'], 'Black darkens; any colour tints the edges instead.')}</>;
    case 'bloom': return <>{k.nums('amount', 'threshold', 'radius')}{k.colour('Tint', ['tintR', 'tintG', 'tintB'], 'The glow’s colour: white keeps the colours of what glows.')}</>;
    case 'halation': return (
      <>
        {k.row('Preset', <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{HALATION_PRESETS.map(pr => <Button key={pr.name} size="sm" onClick={() => onPatch(pr.values)}>{pr.name}</Button>)}</div>, 'Starting points: they only set the sliders below.')}
        {k.nums('amount', 'reach', 'threshold', 'headroom', 'warmth', 'growth')}
        {k.note(<>Film’s halo: light bright enough to pass through the film bounces back and exposes the red layer first, so the glow goes red, then orange, then white as the light gets stronger. Only light brighter than white does it: a lamp or the sun, not white paper. A colour with little red in it (teal, blue) makes no red halo. An 8-bit picture stops at white, so <b>Highlight headroom</b> guesses how much brighter the clipped parts really were.</>)}
      </>
    );
    case 'time': return <TimeEditor e={e} k={k} layers={layers} onPatch={onPatch} />;
    case 'custom': return <CustomEditor e={e} k={k} touch={touch} onReplace={onReplace} />;
    default: return <>{finishParamsOf(e).filter(p => !p.hidden).map(p => k.num(p.key))}</>;
  }
}

function TimeEditor({ e, k, layers, onPatch }: { e: FinishEffect; k: RowKit; layers: Array<{ id: string; label: string }>; onPatch: (c: Partial<FinishEffect>) => void }) {
  const map = e.map ?? 'slit';
  const size = fnRingSize(e.quality ?? 'medium', 1440, 900);
  return (
    <>
      {k.row('Map', <Select ariaLabel="Time map" value={map} height={26} options={TIME_MAPS.map(m => ({ value: m.value, label: m.label }))} onChange={v => onPatch({ map: v as FinishEffect['map'] })} />, 'What decides how far back each part of the picture looks.')}
      {map === 'layer' && k.row('Layer', layers.length
        ? <Select ariaLabel="Map layer" value={e.layerId ?? ''} height={26} options={[{ value: '', label: 'Pick a layer' }, ...layers.map(l => ({ value: l.id, label: l.label }))]} onChange={v => onPatch({ layerId: v })} />
        : <span style={{ font: `11px ${fontFamily.ui}`, opacity: 0.7 }}>Add a layer (a shape, text, particles) to use as the map.</span>, 'The layer’s alpha is the map: where it is opaque, the most frames back. It can be hidden and still work.')}
      {k.num('amount')}
      {map === 'slit' && k.num('angle')}
      {map === 'noise' && k.nums('scale', 'speed')}
      {map === 'radial' && k.nums('cx', 'cy')}
      {k.nums('smooth', 'invert')}
      {k.row('Quality', <Segmented size="sm" ariaLabel="Time quality" value={e.quality ?? 'medium'} onChange={v => onPatch({ quality: v as FinishEffect['quality'] })} options={Object.keys(FINISH_TIME_QUALITY).map(q => ({ value: q as 'low' | 'medium' | 'high', label: q[0].toUpperCase() + q.slice(1), title: `${FINISH_TIME_QUALITY[q].frames} frames` }))} />, 'How many frames it keeps and how sharp they are. Higher needs more graphics memory.')}
      {k.note(`Keeps the last ${size.frames} frames at ${size.w} × ${size.h} for a 1440 × 900 picture (${Math.round(size.bytes / 1e6)} MB of graphics memory). Frames back is capped at ${size.frames - 1}.`)}
    </>
  );
}

function lookName(id: string): string {
  return GRADE_LOOKS.find(l => l.id === id)?.name ?? loadSavedLooks().find(l => l.id === id)?.name ?? '';
}

function GradeEditor({ e, k, touch, onPatch, onReplace }: { e: FinishEffect; k: RowKit; touch: boolean; onPatch: (c: Partial<FinishEffect>) => void; onReplace: (e: FinishEffect) => void }) {
  const [saved, setSaved] = useState<SavedLook[]>(() => loadSavedLooks());
  useEffect(() => {
    const on = () => setSaved(loadSavedLooks());
    window.addEventListener(SAVED_LOOKS_CHANGED, on);
    return () => window.removeEventListener(SAVED_LOOKS_CHANGED, on);
  }, []);
  const lookSections: PickerSection[] = [
    { heading: 'Looks', items: [{ value: '__none', label: 'Neutral', description: 'Every control back to its default' }, ...GRADE_LOOKS.map(l => ({ value: l.id, label: l.name, description: l.description }))] },
    ...(saved.length ? [{ heading: 'Saved on this device', items: saved.map(l => ({ value: l.id, label: l.name, description: 'Your look' })) }] : []),
  ];
  const pickLook = (id: string) => {
    if (id === '__none') { onReplace({ ...newFinishEffect('grade', e.id), enabled: e.enabled }); return; }
    const look = GRADE_LOOKS.find(l => l.id === id) ?? saved.find(l => l.id === id);
    if (look) onReplace(applyLook(e, look));
  };
  const save = async () => {
    const name = await askText('Save this grade as a look', { label: 'Name', initial: lookName(e.look ?? '') || 'My look', confirmLabel: 'Save look' });
    if (!name?.trim()) return;
    const { result, id } = saveLook(name.trim(), lookFromGrade(e));
    if (!result.ok) { toast.error('Couldn’t save the look', { message: result.error }); return; }
    onPatch({ look: id });
    toast.success(`Saved “${name.trim()}”`, { message: 'It is in the Looks list on this device.' });
  };
  const savedCurrent = saved.find(l => l.id === e.look);
  const remove = async () => {
    if (!savedCurrent || !(await askConfirm(`Delete the look “${savedCurrent.name}”?`, { message: 'Grades that used it keep their settings.', confirmLabel: 'Delete', danger: true }))) return;
    deleteLook(savedCurrent.id);
    onPatch({ look: undefined });
  };
  const curves = e.curves!;
  const wheels = touch ? { display: 'grid', gridTemplateColumns: '1fr', gap: 14, justifyItems: 'center' } : { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 };
  const hueTrack = (key: string) => (
    <div style={{ position: 'relative' }}>
      {k.num(key)}
      <div aria-hidden style={{ height: 4, margin: '2px 34px 0 84px', borderRadius: 2, background: 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)', opacity: 0.8 }} />
    </div>
  );
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        <Label text="Look" hint="A starting point: it sets the controls below, which you can then change. Your own grades can be saved as looks." />
        <div style={{ flex: 1, minWidth: 140 }}>
          <GroupedPicker value={e.look ?? ''} placeholder="Pick a look" ariaLabel="Look" title="Looks" sections={lookSections} onChange={pickLook} width={300} />
        </div>
        <IconButton icon="save" size="sm" label="Save this grade as a look" onClick={() => { void save(); }} />
        {savedCurrent && <IconButton icon="trash" size="sm" tone="danger" label={`Delete the saved look “${savedCurrent.name}”`} onClick={() => { void remove(); }} />}
      </div>
      <Section kind="finish-grade" title="Basic" hint="Light and white balance, like Lightroom’s Basic panel.">
        {k.nums('exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks')}
        <div style={{ height: 4 }} />
        <div style={{ position: 'relative' }}>
          {k.num('temperature')}
          <div aria-hidden style={{ height: 4, margin: '2px 34px 0 84px', borderRadius: 2, background: 'linear-gradient(90deg,#4a7bff,#e8e8e8,#ffae3a)', opacity: 0.85 }} />
        </div>
        <div style={{ position: 'relative' }}>
          {k.num('tint')}
          <div aria-hidden style={{ height: 4, margin: '2px 34px 0 84px', borderRadius: 2, background: 'linear-gradient(90deg,#3fcf5a,#e8e8e8,#e04fd8)', opacity: 0.85 }} />
        </div>
        {k.nums('vibrance', 'saturation')}
      </Section>
      <Section kind="finish-grade" title="Curves" hint="Tone curves for all channels or one, and hue curves for single colours.">
        <CurveEditor curves={curves} onChange={c => onPatch({ curves: c })} touch={touch} />
      </Section>
      <Section kind="finish-grade" title="Colour wheels" hint="Lift, gamma and gain: push the shadows, mid-tones and highlights toward a colour, and set their level.">
        <div style={{ ...wheels, marginTop: 8 } as React.CSSProperties}>
          <ColourWheel title="Shadows" hint="Lift: the darkest tones. Drag toward a colour; the slider raises or lowers them." x={num(e, 'liftX')} y={num(e, 'liftY')} level={num(e, 'liftL')} onMove={(x, y) => onPatch({ liftX: x, liftY: y })} onLevel={v => onPatch({ liftL: v })} touch={touch} />
          <ColourWheel title="Midtones" hint="Gamma: the middle tones." x={num(e, 'gammaX')} y={num(e, 'gammaY')} level={num(e, 'gammaL')} onMove={(x, y) => onPatch({ gammaX: x, gammaY: y })} onLevel={v => onPatch({ gammaL: v })} touch={touch} />
          <ColourWheel title="Highlights" hint="Gain: the brightest tones." x={num(e, 'gainX')} y={num(e, 'gainY')} level={num(e, 'gainL')} onMove={(x, y) => onPatch({ gainX: x, gainY: y })} onLevel={v => onPatch({ gainL: v })} touch={touch} />
        </div>
        <Note>Drag a puck toward a colour (hold Shift for finer moves); double-click a wheel to centre it. Each wheel’s numbers can be mapped: add them from Controls → Add control → Finish.</Note>
      </Section>
      <Section kind="finish-grade" title="Split toning" hint="One colour for the highlights, another for the shadows.">
        {hueTrack('splitHiHue')}
        {k.num('splitHiSat')}
        {hueTrack('splitShHue')}
        {k.num('splitShSat')}
        {k.num('splitBalance')}
      </Section>
      <Section kind="finish-grade" title="HSL secondary" hint="Pick a range of colours and change only those: a greener grass, a less orange sky.">
        {hueTrack('hslHue')}
        {k.nums('hslRange', 'hslSoft', 'hslShift', 'hslSat', 'hslLum')}
        {num(e, 'hslRange') === 0 && <Note>Raise Range to pick the colours around the hue.</Note>}
      </Section>
      <Section kind="finish-grade" title="Tone and amount" hint="A film-like shoulder for the highlights (the Tone Map node’s modes), and how much of the grade shows.">
        <Row label="Tone map" hint="Applied in linear light after Exposure and white balance: raise Exposure to push more into the shoulder.">
          <Select ariaLabel="Tone map" value={e.tone ?? 'none'} height={26} options={TONE_OPTIONS} onChange={v => onPatch({ tone: v })} />
        </Row>
        {k.num('amount')}
      </Section>
    </>
  );
}

// ── Custom effects (effect code) ────────────────────────────────────────────

/** Errors as the code editor marks them: "Line 3: …" → line 3. */
function errorLinesOf(err: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const l of err.split('\n')) { const m = /^Line (\d+): (.*)$/.exec(l); if (m && !out.has(+m[1])) out.set(+m[1], m[2]); }
  return out;
}

function CustomEditor({ e, k, touch, onReplace }: { e: FinishEffect; k: RowKit; touch: boolean; onReplace: (e: FinishEffect) => void }) {
  const tk = useTokens();
  const sealed = !!e.sealed;
  const code = sealed ? '' : e.code ?? '';
  const [draft, setDraft] = useState(code);
  const [open, setOpen] = useState(!sealed);
  // The record's code changed elsewhere (undo, a preset): show it.
  const committed = useRef(code);
  useEffect(() => { if (code !== committed.current) { committed.current = code; setDraft(code); } }, [code]);
  const [error, setError] = useState('');
  // Check and commit a moment after typing stops. A broken effect is still kept (the renderer leaves it out and says why).
  useEffect(() => {
    if (sealed) { setError(''); return; }
    const t = setTimeout(() => {
      setError(fnCheckCustom(draft));
      if (draft !== committed.current) { committed.current = draft; onReplace(withCustomCode(e, draft)); }
    }, 350);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, sealed]);
  const parsed = useMemo(() => fnParseCustom(finishCustomCode(e)), [e]);
  const sliders = parsed.params.filter(p => !p.colour);
  return (
    <>
      {sealed
        ? <Note>Sealed effect{e.name ? ` “${e.name}”` : ''}: its code isn’t shown. Its settings work like any other.</Note>
        : (
          <div style={{ marginTop: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Button size="sm" variant="ghost" icon={open ? 'chevD' : 'chevR'} onClick={() => setOpen(!open)}>Effect code</Button>
              <span style={{ flex: 1 }} />
              {error
                ? <span style={{ color: tk.status.danger, font: `600 11px ${fontFamily.ui}` }}>Doesn’t compile: skipped</span>
                : <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>{sliders.length ? `${sliders.length} slider${sliders.length === 1 ? '' : 's'}` : 'No settings'}{parsed.colours.length ? ` · ${parsed.colours.length} colour${parsed.colours.length === 1 ? '' : 's'}` : ''}</span>}
            </div>
            {open && (
              <div style={{ display: 'flex', height: touch ? 220 : 260, marginTop: 4, borderRadius: radius.sm, overflow: 'hidden', border: `1px solid ${error ? tk.status.danger : tk.border.default}` }}>
                <GlslEditor value={draft} onChange={setDraft} ariaLabel={`${e.name ?? 'Custom effect'} code`} errorLines={errorLinesOf(error)} />
              </div>
            )}
            {error && <pre style={{ margin: '6px 0 0', padding: '6px 8px', borderRadius: radius.sm, background: alpha(tk.status.danger, 0.1), color: tk.status.danger, font: `11px/1.45 ${fontFamily.mono}`, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 120, overflow: 'auto' }}>{error}</pre>}
            {open && <Note>Write <code>vec3 effect(vec2 uv, vec3 color)</code>. <code>picture(uv)</code> reads the picture as it came in, <code>px</code> is one pixel, <code>time</code> the clock. Each <code>uniform float name; // 0..1 = 0.5</code> is a slider (and a control), <code>uniform vec3 name; // color = #ff8800</code> a colour. A broken effect is skipped; the picture never goes blank.</Note>}
          </div>
        )}
      {sliders.map(p => k.num(p.key))}
      {parsed.colours.map(c => k.colour(c.label, c.keys))}
    </>
  );
}
