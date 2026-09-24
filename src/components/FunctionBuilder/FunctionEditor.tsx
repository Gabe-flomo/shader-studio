import React from 'react';
import type { FnDef } from './useFunctionBuilder';
import { useFunctionBuilder, TYPE_DEFAULTS } from './useFunctionBuilder';
import { curveColor } from './glslCompiler';
import { GlslTextarea } from './GlslTextarea';
import { useThemeMode, useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { Tooltip } from '../ui/Tooltip';
import { toast } from '../ui/toastStore';

interface Props {
  fn: FnDef;
  index: number;
  isActive: boolean;
  errors: string[];
  onTextareaFocus: (el: HTMLTextAreaElement) => void;
}

const RETURN_TYPES = [
  { value: 'float', label: 'float' },
  { value: 'vec2', label: 'vec2' },
  { value: 'vec3', label: 'vec3' },
] as const;

/** One function card: colour dot (its curve), name, return type, save-to-library, remove, body. */
export function FunctionEditor({ fn, index, isActive, errors, onTextareaFocus }: Props) {
  const { updateFunction, removeFunction, setActiveId, saveFunctionDef } = useFunctionBuilder();
  const tk = useTokens();
  const dotColor = curveColor(index, useThemeMode());
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

  const setReturnType = (newType: FnDef['returnType']) => {
    const patch: Partial<FnDef> = { returnType: newType };
    if (Object.values(TYPE_DEFAULTS).includes(fn.body.trim())) patch.body = TYPE_DEFAULTS[newType];
    updateFunction(fn.id, patch);
  };

  const ring = hasError ? tk.status.danger : isActive ? tk.accent.base : null;

  return (
    <div
      onClick={() => setActiveId(fn.id)}
      style={{
        borderRadius: radius.lg, overflow: 'hidden', background: tk.bg.panel, flexShrink: 0,
        boxShadow: ring
          ? `0 0 0 1.5px ${ring}, 0 4px 14px ${alpha(ring, 0.1)}`
          : `0 0 0 1px ${tk.border.default}`,
        transition: 'box-shadow 0.15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 6px 8px 12px', borderBottom: `1px solid ${tk.border.subtle}` }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
        <input
          value={fn.name}
          maxLength={20}
          aria-label="Function name"
          spellCheck={false}
          onChange={e => updateFunction(fn.id, { name: e.target.value })}
          onClick={e => e.stopPropagation()}
          style={{
            flex: 1, minWidth: 0, padding: 0, border: 0, outline: 'none', background: 'none',
            color: tk.text.primary, font: `600 13px ${fontFamily.mono}`,
          }}
        />
        <div onClick={e => e.stopPropagation()}>
          <Segmented size="sm" ariaLabel="Return type" options={RETURN_TYPES} value={fn.returnType} onChange={setReturnType} />
        </div>
        <Tooltip label="Save to the function library" description="Library functions can be called from any tab.">
          <Button
            size="sm"
            icon="import"
            style={{ height: 28, padding: '0 8px', gap: 5 }}
            onClick={e => { e.stopPropagation(); saveFunctionDef(fn); toast.success(`Saved ${fn.name} to the library`); }}
          >lib</Button>
        </Tooltip>
        <IconButton icon="close" label="Remove function" size="sm" tone="danger" onClick={e => { e.stopPropagation(); removeFunction(fn.id); }} />
      </div>

      <div onClick={e => e.stopPropagation()} style={{ background: tk.bg.subtle, minHeight: 60 }}>
        <GlslTextarea
          value={fn.body}
          onChange={val => updateFunction(fn.id, { body: val })}
          onKeyDown={handleKeyDown}
          onFocus={el => { onTextareaFocus(el); setActiveId(fn.id); }}
          hasError={hasError}
        />
      </div>

      {hasError && (
        <div style={{
          display: 'flex', gap: 7, padding: '7px 12px', borderTop: `1px solid ${alpha(tk.status.danger, 0.2)}`,
          background: alpha(tk.status.danger, 0.07), color: tk.status.danger, font: `11.5px/1.45 ${fontFamily.mono}`,
        }}>
          <Icon name="alert" size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ wordBreak: 'break-word' }}>{errors[0].replace(/^ERROR:\s*\d+:\d+:\s*/i, '')}</span>
        </div>
      )}
    </div>
  );
}
