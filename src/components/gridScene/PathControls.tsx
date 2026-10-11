/**
 * PathControls — the Motion section's Math path editor and path modifier stack
 * (docs/grid-builder.md "Math paths", "Path modifiers").
 *
 *  - Math path: Formula (x = …, y = … in t, checked as you type, with sliders of its own) or Curve
 *    (Curve Trace's library: a preset, its motion and waves, and its numbers as sliders).
 *  - Modifiers: a card each, in order (up / down / remove), with the shared mute; their sliders
 *    are live and have the Play menu.
 *
 * The numbers are live (sliders on the built Shape node); the formula's text, a curve's motion and
 * waves, and the modifiers' kinds and order shape the code.
 */
import { useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Select } from '../ui/Select';
import { Field } from '../ui/Field';
import { Card, NumRow, Row } from '../sceneBuilder/controls';
import { BuilderNote } from '../builders/BuilderWindow';
import { paramNameProblem } from '../../sceneBuilder2d/blocks';
import type { GShape } from '../../gridScene/spec';
import {
  CURVE_MODES, CURVE_MODE_LABELS, CURVE_PRESETS, CURVE_WAVES, FORMULA_PRESETS, MAX_MODS, MOD_DEFS, MOD_KINDS,
  defaultMath, formulaProblems, newMod, type CurveMode, type CurveWave, type MathPath, type ModKind, type PathMod,
} from '../../gridScene/pathMods';
import { gridPlay } from './playParam';

type EditMath = (fn: (m: MathPath) => void, key?: string) => void;

const CURVE_SLIDERS: Array<{ key: 'freqX' | 'freqY' | 'phaseX' | 'phaseY' | 'ampX' | 'ampY' | 'damping' | 'turns'; label: string; min: number; max: number; hint: string; step?: number }> = [
  { key: 'freqX', label: 'X frequency', min: 0, max: 12, hint: 'Cycles of X a turn (rotary: the first circle\'s). Whole-number ratios close the figure.' },
  { key: 'freqY', label: 'Y frequency', min: 0, max: 12, hint: 'Cycles of Y a turn (rotary: the second circle\'s).' },
  { key: 'phaseX', label: 'X phase', min: -6.2832, max: 6.2832, hint: 'Shifts X\'s wave, radians (1.5708 = 90°).' },
  { key: 'phaseY', label: 'Y phase', min: -6.2832, max: 6.2832, hint: 'Shifts Y\'s wave, radians.' },
  { key: 'ampX', label: 'X size', min: 0, max: 1.5, hint: 'How far X swings (rotary: the first circle\'s radius). The reach stretches it into cells.' },
  { key: 'ampY', label: 'Y size', min: 0, max: 1.5, hint: 'How far Y swings (rotary: the second circle\'s radius).' },
  { key: 'damping', label: 'Damping', min: 0, max: 1, hint: 'The waves shrink as the curve runs: a harmonograph spiral (use more Turns).' },
  { key: 'turns', label: 'Turns', min: 0.1, max: 8, hint: 'How much of the curve one cycle runs through, in turns.' },
];
const playName = (k: string) => `curve${k[0].toUpperCase()}${k.slice(1)}`;

/** The Math path's editor. */
export function MathPathControls({ shape, onEdit }: { shape: GShape; onEdit: EditMath }) {
  const tk = useTokens();
  const m = shape.motion.math ?? defaultMath();
  const problems = m.kind === 'formula' ? formulaProblems(m) : [];
  const [newName, setNewName] = useState('');
  const nameWhy = newName ? paramNameProblem(newName, m.params.map(p => p.name)) : null;
  return (
    <>
      <Row label="Kind" hint="Formula: x and y of t, typed. Curve: Curve Trace's curves, by their numbers.">
        <Select ariaLabel="Math path kind" value={m.kind} options={[{ value: 'curve', label: 'Curve (library)' }, { value: 'formula', label: 'Formula' }]}
          onChange={v => onEdit(d => { d.kind = v === 'formula' ? 'formula' : 'curve'; })} />
      </Row>
      {m.kind === 'curve' ? (
        <>
          <Row label="Preset" hint="A starting point: its numbers stay sliders.">
            <Select ariaLabel="Curve preset" value="" options={[{ value: '', label: 'Pick a curve…' }, ...CURVE_PRESETS.map(p => ({ value: p.key, label: p.label }))]}
              onChange={v => { const p = CURVE_PRESETS.find(x => x.key === v); if (p) onEdit(d => { d.curve = { ...p.curve }; }); }} />
          </Row>
          <Row label="Motion" hint="Lateral: X and Y each swing on their own wave (Lissajous). Rotary: two circles at once, the same way (loops) or opposite ways (stars, flowers).">
            <Select ariaLabel="Curve motion" value={m.curve.mode} options={CURVE_MODES.map(k => ({ value: k, label: CURVE_MODE_LABELS[k] }))} onChange={v => onEdit(d => { d.curve.mode = v as CurveMode; })} />
          </Row>
          {m.curve.mode === 'lateral' && (['X', 'Y'] as const).map(a => (
            <Row key={a} label={`${a} wave`}>
              <Select ariaLabel={`${a} wave`} value={m.curve[`wave${a}`]} options={CURVE_WAVES.map(w => ({ value: w, label: w[0].toUpperCase() + w.slice(1) }))}
                onChange={v => onEdit(d => { d.curve[`wave${a}`] = v as CurveWave; })} />
            </Row>
          ))}
          {CURVE_SLIDERS.map(c => (
            <NumRow key={c.key} label={c.label} hint={c.hint} value={m.curve[c.key]} min={c.min} max={c.max} lazyParam={gridPlay(shape.id, playName(c.key))}
              onChange={v => onEdit(d => { d.curve[c.key] = v; }, `curve${c.key}${shape.id}`)} />
          ))}
        </>
      ) : (
        <>
          <Row label="Preset" hint="A starting point: edit the lines and sliders as you like.">
            <Select ariaLabel="Formula preset" value="" options={[{ value: '', label: 'Pick a formula…' }, ...FORMULA_PRESETS.map(p => ({ value: p.key, label: p.label }))]}
              onChange={v => { const p = FORMULA_PRESETS.find(x => x.key === v); if (p) onEdit(d => { d.x = p.x; d.y = p.y; d.params = p.params.map(q => ({ ...q })); }); }} />
          </Row>
          <BuilderNote>t runs 0 → 1 round the cycle; PI and TAU, the sliders below by name, and x in the y line (the x just worked out). The point is in pad units: X and Y stretch it into cells.</BuilderNote>
          <Row label="x =">
            <Field mono aria-label="x of t" data-math-x value={m.x} invalid={problems.some(p => p.startsWith('x'))} onChange={e => onEdit(d => { d.x = e.target.value; }, `mathx${shape.id}`)} />
          </Row>
          <Row label="y =">
            <Field mono aria-label="y of t" data-math-y value={m.y} invalid={problems.some(p => p.startsWith('y'))} onChange={e => onEdit(d => { d.y = e.target.value; }, `mathy${shape.id}`)} />
          </Row>
          {problems.length > 0 && (
            <span data-math-problem style={{ fontSize: 11.5, color: tk.status.warningText, lineHeight: 1.4 }}>{problems[0]} (it moves round a circle until this is fixed)</span>
          )}
          {m.params.map((p, i) => (
            <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <NumRow label={<span style={{ fontFamily: fontFamily.mono }}>{p.name}</span>} value={p.value} min={p.min} max={p.max} lazyParam={gridPlay(shape.id, `f_${p.name}`)}
                  onChange={v => onEdit(d => { d.params[i].value = v; }, `mathp${shape.id}${p.name}`)} />
              </div>
              <IconButton icon="trash" size="sm" label={`Remove slider ${p.name}`} onClick={() => onEdit(d => { d.params.splice(i, 1); })} />
            </div>
          ))}
          <Row label="Add a slider" hint="A number the formula can use by name: a slider here, live on the built node.">
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <Field mono aria-label="New slider name" height={28} value={newName} invalid={!!nameWhy} placeholder="name" onChange={e => setNewName(e.target.value.trim())} />
              <Button size="sm" variant="ghost" icon="plus" disabled={!newName || !!nameWhy}
                onClick={() => { onEdit(d => { d.params.push({ name: newName, value: 1, min: 0, max: 2 }); }); setNewName(''); }}>Add</Button>
            </div>
          </Row>
          {nameWhy && <span style={{ fontSize: 11.5, color: tk.status.warningText }}>{nameWhy}</span>}
        </>
      )}
    </>
  );
}

/** The path modifier stack. */
export function PathModifiers({ shape, mods, onEdit }: { shape: GShape; mods: PathMod[]; onEdit: (fn: (mods: PathMod[]) => void, key?: string) => void }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 11.5, color: tk.text.muted, lineHeight: 1.4 }}>Path modifiers change the path, top to bottom: Ease and Repeat the progress along it, the rest its shape. All live.</span>
      {mods.map((md, i) => {
        const def = MOD_DEFS[md.kind];
        return (
          <Card key={md.id} id={`gs-mod-${shape.id}-${md.id}`} defaultOpen title={def.label} summary={def.blurb}
            mute={{ muted: !!md.muted, what: def.label.toLowerCase(), onToggle: () => onEdit(d => { d[i].muted = !d[i].muted; }) }}
            actions={(
              <>
                <IconButton icon="chevU" size="sm" label="Move up" disabled={i === 0} onClick={() => onEdit(d => { [d[i - 1], d[i]] = [d[i], d[i - 1]]; })} />
                <IconButton icon="chevD" size="sm" label="Move down" disabled={i === mods.length - 1} onClick={() => onEdit(d => { [d[i + 1], d[i]] = [d[i], d[i + 1]]; })} />
              </>
            )}
            onRemove={() => onEdit(d => { d.splice(i, 1); })} removeLabel={`Remove ${def.label}`}>
            {def.params.map((p, j) => (md.kind === 'mirror'
              ? (
                <Row key={p.key} label="Axis" hint={p.hint}>
                  <Select ariaLabel="Mirror axis" value={String(Math.round(md.v[j] ?? 0))} options={[{ value: '0', label: 'Across (X)' }, { value: '1', label: 'Up and down (Y)' }, { value: '2', label: 'Both' }]}
                    onChange={v => onEdit(d => { d[i].v[j] = Number(v); })} />
                </Row>
              )
              : (
                <NumRow key={p.key} label={p.label} hint={p.hint} value={md.v[j] ?? p.def} min={p.min} max={p.max} integer={p.integer} defaultValue={p.def}
                  lazyParam={gridPlay(shape.id, `${md.id}${p.key}`)} onChange={v => onEdit(d => { d[i].v[j] = v; }, `mod${shape.id}${md.id}${p.key}`)} />
              )))}
          </Card>
        );
      })}
      <Row label="Add" hint={MOD_KINDS.map(k => `${MOD_DEFS[k].label}: ${MOD_DEFS[k].blurb}`).join('\n')}>
        <Select ariaLabel="Add a path modifier" value="" options={[{ value: '', label: mods.length >= MAX_MODS ? `At most ${MAX_MODS}` : 'Add a modifier…' }, ...(mods.length >= MAX_MODS ? [] : MOD_KINDS.map(k => ({ value: k, label: MOD_DEFS[k].label })))]}
          onChange={v => { if (v) onEdit(d => { d.push(newMod(v as ModKind, d)); }); }} />
      </Row>
    </div>
  );
}
