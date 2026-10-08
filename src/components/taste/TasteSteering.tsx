/**
 * TasteSteering — "Your steering" on the Taste page (docs/taste.md "Steering"): the context box, read
 * locally into chips you can flip or remove; pins (boost / avoid / ban) on features from the learned list
 * or the patterns catalogue; and the dials (exploration, how strongly taste leans Surprise / Deep /
 * Evolve, the Do bar's nudge). Steering sits on top of what was learned and never changes it.
 */
import { useMemo, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { Select } from '../ui/Select';
import { Toggle } from '../ui/Choice';
import { RulerSlider } from '../ui/RulerSlider';
import { useTaste, updateSteering } from '../../taste/store';
import { withContext } from '../../taste/context';
import { chipSign, chipWanted, type Chip } from '../../taste/steering';
import { featureName } from '../../taste/summary';
import { FAMILIES, TECHNIQUES } from '../../patterns/catalogue';
import { Card, Pill } from './tasteUi';
import { PinButtons } from './TasteFeatureRow';
import { togglePin } from './tasteWords';
import { imageModelUsable, useImageModel } from '../../imageModel/client';

const EXAMPLE = 'I like dark minimal pieces with lots of motion, no fBm, more code';

export function TasteSteering() {
  const tk = useTokens();
  const steering = useTaste(s => s.steering);
  const model = useTaste(s => s.model);
  const [text, setText] = useState(steering.context);
  const [pick, setPick] = useState('');
  const byLook = useImageModel(imageModelUsable);
  const setContext = (t: string) => { setText(t); updateSteering(s => withContext(s, t, { byLook })); };
  const editChip = (c: Chip, edit: 'flip' | 'remove') => updateSteering(s => ({
    ...s, chips: s.chips.map(x => (x.id === c.id && x.sign === c.sign ? (edit === 'flip' ? { ...x, flipped: !x.flipped, off: false } : { ...x, off: !x.off }) : x)),
  }));
  const options = useMemo(() => [
    { value: '', label: 'Pin a technique or family…' },
    ...FAMILIES.map(f => ({ value: `fam:${f.id}`, label: f.name, group: 'Families' })),
    ...TECHNIQUES.map(t => ({ value: `tech:${t.id}`, label: t.name, group: 'Techniques' })),
    ...['pal:dark', 'pal:light', 'pal:vivid', 'pal:muted', 'code:yes', 'code:no', 'look:dark', 'look:bright', 'img:motion', 'img:detail', 'img:contrast', 'img:colourful'].map(k => ({ value: k, label: featureName(null, k), group: 'Look & palette' })),
  ], []);
  const pins = Object.entries(steering.pins);
  const label = { font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary } as const;
  const hint = { fontSize: 11.5, color: tk.text.muted, lineHeight: 1.45 } as const;
  return (
    <Card pad={14} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={label}>Tell it what you like</span>
        <textarea value={text} onChange={e => setContext(e.target.value)} rows={2} placeholder={EXAMPLE} aria-label="Your taste in your own words" data-taste-context
          style={{ resize: 'vertical', minHeight: 48, padding: '8px 10px', borderRadius: radius.md, border: `1px solid ${tk.border.default}`, background: tk.bg.subtle, color: tk.text.primary, font: `13px/1.45 ${fontFamily.ui}` }} />
        <span style={hint}>Read on this device with Playfield’s own words (techniques, families, Do bar words, settings, look words like dark / minimal / moving / vivid). “no”, “less”, “without” flip the next phrase.{byLook ? ' Other words (“underwater”, “stained glass”) go to the image model: chips marked by look score candidates by how much their picture matches the words.' : ''} It understood:</span>
        <div data-taste-chips style={{ display: 'flex', gap: 6, flexWrap: 'wrap', minHeight: 24 }}>
          {!steering.chips.length && <span style={{ ...hint, color: tk.text.faint }}>nothing yet</span>}
          {steering.chips.map(c => {
            // Green when you want what the label says, red when you want less of it (grey when removed).
            const sg = c.off ? 0 : chipWanted(c) ? 1 : -1;
            return (
              <span key={`${c.id}:${c.sign}`} data-chip={c.id} data-chip-sign={chipSign(c)} {...(c.look ? { 'data-chip-look': c.look } : {})} title={c.look ? `“${c.phrase}” → by look: the image model scores how much a candidate’s picture matches “${c.look}”` : `“${c.phrase}” → ${c.features.join(', ')}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 4px 2px 9px', borderRadius: 999, font: `500 11.5px ${fontFamily.ui}`,
                  background: sg > 0 ? `color-mix(in srgb, ${tk.status.success} 13%, transparent)` : sg < 0 ? `color-mix(in srgb, ${tk.status.danger} 13%, transparent)` : tk.bg.field,
                  color: sg > 0 ? tk.status.success : sg < 0 ? tk.status.danger : tk.text.faint, textDecoration: c.off ? 'line-through' : 'none' }}>
                {sg >= 0 ? (c.off ? '' : '+ ') : '− '}{c.label}
                {c.look
                  ? <span style={{ font: `600 9.5px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '0 5px', borderRadius: 999, background: tk.bg.field, color: tk.accent.base }}>by look</span>
                  : <span style={{ color: tk.text.faint, fontWeight: 400 }}>“{c.phrase}”</span>}
                <button type="button" title="Flip: like ↔ avoid" aria-label={`Flip ${c.label}`} onClick={() => editChip(c, 'flip')} style={chipBtn(tk)}><Icon name="bidir" size={11} /></button>
                <button type="button" title={c.off ? 'Use it again' : 'Remove it'} aria-label={`${c.off ? 'Restore' : 'Remove'} ${c.label}`} onClick={() => editChip(c, 'remove')} style={chipBtn(tk)}><Icon name={c.off ? 'undo' : 'close'} size={11} /></button>
              </span>
            );
          })}
        </div>
        {steering.unknown.length > 0 && (
          <span data-taste-unknown style={hint}>Didn’t understand: {steering.unknown.map(w => <Pill key={w}>{w}</Pill>)}</span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={label}>Pins</span>
        <span style={hint}>Boost or avoid a feature, or ban it: Surprise, Deep and Evolve never pick a banned technique, family, stage choice or source. Pin from a learned row above, or here.</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Select value={pick} options={options} onChange={setPick} ariaLabel="Feature to pin" style={{ minWidth: 220 }} />
          {pick && <PinButtons k={pick} />}
        </div>
        {pins.length > 0 && (
          <div data-taste-pins style={{ display: 'flex', flexDirection: 'column' }}>
            {pins.map(([k, p]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: `1px solid ${tk.border.subtle}` }}>
                <Pill tone={p === 'boost' ? 'good' : p === 'avoid' ? 'warn' : 'bad'}>{p}</Pill>
                <span style={{ flex: 1, fontSize: 12.5 }}>{featureName(model, k)}</span>
                <span style={{ font: `11px ${fontFamily.mono}`, color: tk.text.faint }}>{k}</span>
                <button type="button" aria-label={`Unpin ${k}`} onClick={() => togglePin(k, p)} style={chipBtn(tk)}><Icon name="close" size={12} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 220px) 1fr', gap: '10px 14px', alignItems: 'center' }}>
        <span style={label}>Exploration <span style={{ fontWeight: 400, color: tk.text.muted }}>{Math.round(steering.explore * 100)}%</span></span>
        <RulerSlider value={steering.explore} min={0} max={1} step={0.05} defaultValue={0.25} hard ariaLabel="Exploration" onChange={v => updateSteering(s => ({ ...s, explore: Math.max(0, Math.min(1, v)) }))} />
        <span style={label}>Taste leans Surprise, Deep, Evolve <span style={{ fontWeight: 400, color: tk.text.muted }}>{Math.round(steering.lean * 100)}%</span></span>
        <RulerSlider value={steering.lean} min={0} max={2} step={0.05} defaultValue={1} hard ariaLabel="How strongly taste leans the generators" onChange={v => updateSteering(s => ({ ...s, lean: Math.max(0, Math.min(2, v)) }))} />
        <span style={label}>Do bar suggestions</span>
        <Toggle checked={steering.nudge} onChange={on => updateSteering(s => ({ ...s, nudge: on }))} label="Nudge type-ahead and node search towards what you like" />
      </div>
    </Card>
  );
}

const chipBtn = (tk: ReturnType<typeof useTokens>) => ({ width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, border: 0, borderRadius: 9, background: 'transparent', color: tk.text.faint, cursor: 'pointer' }) as const;
