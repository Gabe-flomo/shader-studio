/**
 * StepsList — the Edit view's list of steps: pick one, drag to reorder,
 * duplicate or delete, add a new one. On phones it's a strip of numbered
 * pills under the header.
 */
import { useState } from 'react';
import type { Step } from '../../types/presentation';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { BLOCK_META } from './blockMeta';
import { usePresentation } from './presentationStore';

function summary(s: Step): string {
  if (!s.blocks.length) return 'Empty';
  const n = new Map<string, number>();
  for (const b of s.blocks) n.set(BLOCK_META[b.type].label, (n.get(BLOCK_META[b.type].label) ?? 0) + 1);
  return [...n].map(([k, v]) => (v > 1 ? `${v} × ${k.toLowerCase()}` : k.toLowerCase())).join(' · ');
}

export function StepsList() {
  const tk = useTokens();
  const steps = usePresentation(s => s.doc?.steps);
  const current = usePresentation(s => s.step);
  const setStep = usePresentation(s => s.setStep);
  const addStep = usePresentation(s => s.addStep);
  const duplicateStep = usePresentation(s => s.duplicateStep);
  const deleteStep = usePresentation(s => s.deleteStep);
  const moveStep = usePresentation(s => s.moveStep);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  if (!steps) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '14px 10px 8px 16px' }}>
        <span style={{ flex: 1, color: tk.text.faint, font: `700 10.5px ${fontFamily.ui}`, letterSpacing: '0.07em', textTransform: 'uppercase' }}>Steps</span>
        <IconButton size="sm" icon="plus" label="Add a step after this one" onClick={() => addStep(current)} />
      </div>
      <div role="listbox" aria-label="Steps" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 10px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {steps.map((s, i) => {
          const on = i === current;
          const dropHere = drag && drag.over === i && drag.from !== i;
          return (
            <div
              key={s.id}
              role="option"
              aria-selected={on}
              draggable
              onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); setDrag({ from: i, over: i }); }}
              onDragOver={e => { if (!drag) return; e.preventDefault(); if (drag.over !== i) setDrag({ ...drag, over: i }); }}
              onDrop={e => { e.preventDefault(); if (drag) moveStep(drag.from, i); setDrag(null); }}
              onDragEnd={() => setDrag(null)}
              onClick={() => setStep(i)}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(h => (h === i ? null : h))}
              style={{
                position: 'relative', display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 8px 9px 10px', borderRadius: radius.md, cursor: 'pointer',
                background: on ? tk.bg.selected : hover === i ? tk.bg.hover : 'transparent',
                boxShadow: dropHere ? `inset 0 ${drag!.from < i ? -2 : 2}px 0 ${tk.accent.base}` : 'none', opacity: drag?.from === i ? 0.5 : 1,
              }}
            >
              <span style={{ width: 22, flexShrink: 0, color: on ? tk.accent.text : tk.text.faint, font: `700 12px ${fontFamily.mono}`, paddingTop: 1 }}>{i + 1}</span>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ color: s.title ? tk.text.primary : tk.text.faint, font: `${on ? 650 : 550} 12.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || 'Untitled step'}</span>
                <span style={{ color: tk.text.muted, font: `500 11px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary(s)}{s.columns === 2 ? ' · 2 columns' : ''}</span>
              </span>
              {(hover === i || on) && (
                <span onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 0, marginTop: -3 }}>
                  <IconButton size="sm" icon="copy" label="Duplicate this step" onClick={() => duplicateStep(i)} />
                  <IconButton size="sm" icon="trash" tone="danger" label="Delete this step" onClick={() => deleteStep(i)} />
                </span>
              )}
            </div>
          );
        })}
        <button
          type="button" onClick={() => addStep(steps.length - 1)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, padding: '9px 10px', borderRadius: radius.md, border: `1.5px dashed ${tk.border.strong}`, background: 'transparent', color: tk.text.muted, font: `600 12.5px ${fontFamily.ui}`, cursor: 'pointer' }}
        >
          <Icon name="plus" size={13} />Add a step
        </button>
        <div style={{ color: tk.text.faint, font: `500 11px/1.45 ${fontFamily.ui}`, padding: '8px 4px 0' }}>Drag a step to move it.</div>
      </div>
    </div>
  );
}

/** Phones: the steps as numbered pills, plus Add. */
export function StepsStrip() {
  const tk = useTokens();
  const steps = usePresentation(s => s.doc?.steps);
  const current = usePresentation(s => s.step);
  const setStep = usePresentation(s => s.setStep);
  const addStep = usePresentation(s => s.addStep);
  if (!steps) return null;
  return (
    <div style={{ flexShrink: 0, display: 'flex', gap: 6, overflowX: 'auto', padding: '8px 12px', borderBottom: `1px solid ${tk.border.default}`, background: tk.bg.subtle }}>
      {steps.map((s, i) => (
        <button key={s.id} type="button" onClick={() => setStep(i)} title={s.title || `Step ${i + 1}`}
          style={{
            flexShrink: 0, minWidth: 34, height: 32, padding: '0 10px', borderRadius: 16, border: 0, cursor: 'pointer',
            background: i === current ? tk.ink.base : tk.bg.field, color: i === current ? tk.ink.text : tk.text.secondary, font: `650 12.5px ${fontFamily.ui}`,
          }}>{i + 1}</button>
      ))}
      <button type="button" onClick={() => addStep(current)} aria-label="Add a step"
        style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 16, border: `1.5px dashed ${tk.border.strong}`, background: 'transparent', color: tk.text.muted, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="plus" size={14} />
      </button>
    </div>
  );
}
