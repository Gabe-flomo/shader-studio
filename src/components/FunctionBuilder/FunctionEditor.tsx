import React, { useRef } from 'react';
import type { FnDef } from './useFunctionBuilder';
import { useFunctionBuilder } from './useFunctionBuilder';
import { CURVE_COLORS } from './glslCompiler';

interface Props {
  fn: FnDef;
  index: number;
  isActive: boolean;
  errors: string[];
  onTextareaFocus: (el: HTMLTextAreaElement) => void;
}

const RETURN_TYPES = ['float', 'vec2', 'vec3'] as const;

export function FunctionEditor({ fn, index, isActive, errors, onTextareaFocus }: Props) {
  const { updateFunction, removeFunction, setActiveId } = useFunctionBuilder();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const sig = fn.returnType === 'float'
    ? `${fn.name}(float x, float t)`
    : `${fn.name}(vec2 uv, float t)`;

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
          style={{
            background: 'none', border: 'none', color: '#cdd6f4',
            fontFamily: 'monospace', fontSize: '13px', fontWeight: 700,
            width: '60px', outline: 'none', padding: 0,
          }}
        />

        <select
          value={fn.returnType}
          onChange={e => updateFunction(fn.id, { returnType: e.target.value as FnDef['returnType'] })}
          onClick={e => e.stopPropagation()}
          style={{
            background: '#313244', border: '1px solid #45475a', color: '#a6adc8',
            borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace',
            padding: '1px 4px', cursor: 'pointer', outline: 'none',
          }}
        >
          {RETURN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        <span style={{ fontSize: '10px', color: '#45475a', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {sig}
        </span>

        {hasError && (
          <span title={errors[0]} style={{ fontSize: '10px', color: '#f38ba8', flexShrink: 0 }}>⚠</span>
        )}

        <button
          onClick={e => { e.stopPropagation(); removeFunction(fn.id); }}
          style={{ background: 'none', border: 'none', color: '#45475a', cursor: 'pointer', fontSize: '13px', padding: '0 2px', lineHeight: 1 }}
          title="Remove function"
        >✕</button>
      </div>

      {/* Body textarea */}
      <textarea
        ref={textareaRef}
        value={fn.body}
        onChange={e => updateFunction(fn.id, { body: e.target.value })}
        onKeyDown={handleKeyDown}
        onFocus={e => onTextareaFocus(e.currentTarget)}
        onClick={e => e.stopPropagation()}
        spellCheck={false}
        rows={Math.max(2, fn.body.split('\n').length)}
        style={{
          width: '100%',
          background: 'none',
          border: 'none',
          color: hasError ? '#f38ba8' : '#cdd6f4',
          fontFamily: 'monospace',
          fontSize: '12px',
          lineHeight: 1.6,
          padding: '6px 10px',
          resize: 'none',
          outline: 'none',
          boxSizing: 'border-box',
          minHeight: '48px',
        }}
      />

      {hasError && (
        <div style={{ padding: '3px 10px 5px', fontSize: '10px', color: '#f38ba8', fontFamily: 'monospace', borderTop: '1px solid #2a1a1a' }}>
          {errors[0]}
        </div>
      )}
    </div>
  );
}
