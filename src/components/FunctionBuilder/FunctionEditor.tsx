import React from 'react';
import type { FnDef } from './useFunctionBuilder';
import { useFunctionBuilder, TYPE_DEFAULTS } from './useFunctionBuilder';
import { CURVE_COLORS } from './glslCompiler';
import { GlslTextarea } from './GlslTextarea';

interface Props {
  fn: FnDef;
  index: number;
  isActive: boolean;
  errors: string[];
  onTextareaFocus: (el: HTMLTextAreaElement) => void;
}

const RETURN_TYPES = ['float', 'vec2', 'vec3'] as const;

export function FunctionEditor({ fn, index, isActive, errors, onTextareaFocus }: Props) {
  const { updateFunction, removeFunction, setActiveId, saveFunctionDef } = useFunctionBuilder();

  const [r, g, b] = CURVE_COLORS[index % CURVE_COLORS.length];
  const dotColor = `rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)})`;

  const hasError = errors.length > 0;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const s = ta.selectionStart, end = ta.selectionEnd;
      const next = fn.body.slice(0, s) + '  ' + fn.body.slice(end);
      updateFunction(fn.id, { body: next });
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 2; });
    }
  };

  return (
    <div
      onClick={() => setActiveId(fn.id)}
      style={{
        border: `1px solid ${isActive ? '#45475a' : '#313244'}`,
        borderLeft: `3px solid ${isActive ? dotColor : '#313244'}`,
        borderRadius: '6px',
        marginBottom: '6px',
        background: isActive ? '#1e1e2e' : '#181825',
        cursor: 'default',
        overflow: 'hidden',
        transition: 'border-color 0.15s',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 8px', borderBottom: '1px solid #313244' }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />

        <input
          value={fn.name}
          onChange={e => updateFunction(fn.id, { name: e.target.value })}
          onClick={e => e.stopPropagation()}
          size={Math.max(2, fn.name.length)}
          style={{
            background: 'none', border: 'none', color: '#cdd6f4',
            fontFamily: 'monospace', fontSize: '13px', fontWeight: 700,
            width: 'auto', outline: 'none', padding: 0,
          }}
        />

        <select
          value={fn.returnType}
          onChange={e => {
            const newType = e.target.value as FnDef['returnType'];
            const patch: Partial<FnDef> = { returnType: newType };
            if (Object.values(TYPE_DEFAULTS).includes(fn.body.trim())) {
              patch.body = TYPE_DEFAULTS[newType];
            }
            updateFunction(fn.id, patch);
          }}
          onClick={e => e.stopPropagation()}
          style={{
            background: '#313244', border: '1px solid #45475a', color: '#a6adc8',
            borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace',
            padding: '1px 4px', cursor: 'pointer', outline: 'none',
          }}
        >
          {RETURN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        <div style={{ flex: 1 }} />

        {hasError && (
          <span title={errors[0]} style={{ fontSize: '10px', color: '#f38ba8', flexShrink: 0 }}>⚠</span>
        )}

        <button
          onClick={e => { e.stopPropagation(); saveFunctionDef(fn); }}
          title="Save to function library"
          style={{
            background: 'none',
            border: '1px solid #a6e3a144',
            color: '#a6e3a1',
            borderRadius: '10px',
            padding: '1px 7px',
            fontSize: '10px',
            fontFamily: 'monospace',
            cursor: 'pointer',
            flexShrink: 0,
            lineHeight: 1.4,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#a6e3a122'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#a6e3a188'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#a6e3a144'; }}
        >↓ lib</button>

        <button
          onClick={e => { e.stopPropagation(); removeFunction(fn.id); }}
          style={{ background: 'none', border: 'none', color: '#45475a', cursor: 'pointer', fontSize: '13px', padding: '0 2px', lineHeight: 1 }}
          title="Remove function"
        >✕</button>
      </div>

      {/* Body — syntax-highlighted textarea */}
      <div onClick={e => e.stopPropagation()}>
        <GlslTextarea
          value={fn.body}
          onChange={val => updateFunction(fn.id, { body: val })}
          onKeyDown={handleKeyDown}
          onFocus={onTextareaFocus}
          hasError={hasError}
        />
      </div>

      {hasError && (
        <div style={{ padding: '3px 10px 5px', fontSize: '10px', color: '#f38ba8', fontFamily: 'monospace', borderTop: '1px solid #2a1a1a' }}>
          {errors[0]}
        </div>
      )}
    </div>
  );
}
