/**
 * The Files home's "Explore code" card: ask about a function or some words
 * and the Code Explorer opens on it. Light on purpose: the index only starts
 * when the Explorer opens.
 */
import { useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Button';
import { openCodeExplorer } from './explorerStore';

const STARTERS = ['smoothstep', 'mix', 'fract', 'length', 'step', 'sin', 'soft circle edge', 'random'];

export function ExploreCodeHome({ compact = false }: { compact?: boolean }) {
  const tk = useTokens();
  const [text, setText] = useState('');
  return (
    <div style={{ background: tk.bg.panel, border: `1px solid ${tk.border.default}`, borderRadius: radius.card, padding: compact ? '12px 14px' : '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <Field
          leading={<Icon name="search" size={15} style={{ color: tk.text.faint }} />}
          placeholder="A function (smoothstep) or plain words (soft circle edge)"
          aria-label="Explore code"
          value={text}
          mono
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') openCodeExplorer(text.trim()); }}
          style={{ flex: 1 }}
        />
        <Button onClick={() => openCodeExplorer(text.trim())}>Explore</Button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 11.5, color: tk.text.faint }}>Try</span>
        {STARTERS.map(s => (
          <button key={s} type="button" onClick={() => openCodeExplorer(s)}
            style={{ height: 24, padding: '0 8px', border: 0, borderRadius: radius.md - 1, cursor: 'pointer', background: tk.bg.field, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, color: tk.text.primary, font: `500 11.5px ${fontFamily.mono}` }}>{s}</button>
        ))}
      </div>
    </div>
  );
}
