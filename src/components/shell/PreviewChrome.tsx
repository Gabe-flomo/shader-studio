import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Popover } from '../ui/Popover';
import { Tooltip } from '../ui/Tooltip';
import { PREVIEW_ASPECTS } from '../../utils/graphImportPlan';
import { timeReadoutRef } from '../../lib/timeTick';

// Header and footer bars for the shader preview. The preview is a render surface, so callers
// render these under ThemeOverrideContext 'dark' — they look the same in both app themes.

const RULE = alpha('#ffffff', 0.06);

export function PreviewHeader({ children }: { children?: ReactNode }) {
  const tk = useTokens();
  return (
    <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 2, padding: '0 8px 0 18px', background: tk.bg.render, borderBottom: `1px solid ${RULE}` }}>
      <span style={{ flex: 1, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint }}>PREVIEW</span>
      {children}
    </div>
  );
}

/**
 * The picture's shape, as a row of little frames drawn in each proportion
 * (Free is a dashed one). The same setting as the export dialog's.
 */
export function AspectPicker() {
  const tk = useTokens();
  const value = useNodeGraphStore(s => s.previewAspect);
  const set = useNodeGraphStore(s => s.setPreviewAspect);
  return (
    <div role="radiogroup" aria-label="Canvas shape" style={{ display: 'flex', alignItems: 'center', gap: 1, marginRight: 6 }}>
      {PREVIEW_ASPECTS.map(a => {
        const on = a.id === value;
        const r = a.ratio ?? 1.5, w = r >= 1 ? 16 : 16 * r, h = r >= 1 ? 16 / r : 16;
        return (
          <Tooltip key={a.id} label={a.id === 'free' ? 'Free' : a.label} description={a.hint} placement="bottom">
            <button
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${a.label}: ${a.hint}`}
              onClick={() => set(a.id)}
              style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: radius.md, cursor: 'pointer', background: on ? alpha('#ffffff', 0.12) : 'transparent' }}
            >
              <span style={{ width: Math.round(w), height: Math.round(h), borderRadius: 2, boxSizing: 'border-box', border: `1.5px ${a.ratio ? 'solid' : 'dashed'} ${on ? tk.accent.base : alpha('#ffffff', 0.45)}` }} />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

export interface ProbeValue { label: string; col: string; formatted: string }

/**
 * Time controls on the left; on the right, the pixel under the cursor (or the selected node's
 * output values) and the compile-error pill.
 */
const PROBE_COLORS: Record<string, string> = { float: '#f0a', vec2: '#0af', vec3: '#0fa', vec4: '#fa0' };

/**
 * Subscribes to the per-frame readouts itself (pixel sample, probe values) so those writes
 * re-render only this bar, not App.
 */
export function PreviewFooter({ idleHint }: { idleHint: string }) {
  const tk = useTokens();
  const pixelSample = useNodeGraphStore(s => s.pixelSample);
  const nodeProbeValues = useNodeGraphStore(s => s.nodeProbeValues);
  const selectedNode = useNodeGraphStore(s => s.selectedNodeId ? s.nodes.find(n => n.id === s.selectedNodeId) ?? null : null);
  const hasSelection = useNodeGraphStore(s => !!s.selectedNodeId);
  const probe = useMemo<ProbeValue[] | null>(() => selectedNode && nodeProbeValues
    ? Object.entries(nodeProbeValues).map(([outKey, vals]) => {
        const outSocket = selectedNode.outputs[outKey];
        return { label: outSocket?.label ?? outKey, col: PROBE_COLORS[outSocket?.type ?? 'float'] ?? tk.text.primary, formatted: vals.map(v => v.toFixed(3)).join(', ') };
      })
    : null, [selectedNode, nodeProbeValues, tk]);
  if (hasSelection && !probe && !pixelSample) idleHint = 'computing…';
  const timePlaying = useNodeGraphStore(s => s.timePlaying);
  const setTimePlaying = useNodeGraphStore(s => s.setTimePlaying);
  const mono = `11px ${fontFamily.mono}`;
  const num = { color: tk.text.primary, fontVariantNumeric: 'tabular-nums' as const };

  return (
    <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 2, padding: '0 10px 0 8px', background: tk.bg.render, borderTop: `1px solid ${RULE}`, font: mono, color: tk.text.faint }}>
      <IconButton icon={timePlaying ? 'pause' : 'play'} label={timePlaying ? 'Pause' : 'Play'} shortcut="space" size="sm" onClick={() => setTimePlaying(!timePlaying)} />
      <IconButton icon="reset" label="Reset time to 0" size="sm" onClick={() => window.dispatchEvent(new CustomEvent('reset-time'))} />
      <TimeReadout />
      <span style={{ flex: 1, minWidth: 8 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', whiteSpace: 'nowrap' }} title={pixelSample ? 'Pixel colour under the cursor (0–1)' : undefined}>
        {pixelSample ? (
          <>
            <span style={{ width: 12, height: 12, borderRadius: 3, flexShrink: 0, background: `rgb(${pixelSample[0]},${pixelSample[1]},${pixelSample[2]})`, boxShadow: `0 0 0 1px ${alpha('#ffffff', 0.2)}` }} />
            {(['r', 'g', 'b'] as const).map((c, i) => (
              <span key={c}><span style={{ color: ['#f38ba8', '#a6e3a1', '#89b4fa'][i] }}>{c}</span> <span style={num}>{(pixelSample[i] / 255).toFixed(3)}</span></span>
            ))}
          </>
        ) : probe ? (
          probe.map(p => (
            <span key={p.label}><span style={{ color: p.col, fontWeight: 700 }}>{p.label}</span> <span style={num}>{p.formatted}</span></span>
          ))
        ) : <span style={{ opacity: 0.7 }}>{idleHint}</span>}
      </div>
      <ErrorPill />
    </div>
  );
}

function TimeReadout() {
  const tk = useTokens();
  return <span ref={timeReadoutRef} style={{ margin: '0 4px 0 6px', color: tk.text.primary, fontVariantNumeric: 'tabular-nums' }}>0.00s</span>;
}

/** "● N errors" — opens the graph and GLSL compile errors. Hidden when there are none. */
function ErrorPill() {
  const tk = useTokens();
  const graph = useNodeGraphStore(s => s.compilationErrors);
  const glsl = useNodeGraphStore(s => s.glslErrors);
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const count = graph.length + glsl.length;
  if (count === 0) return null;

  const section = (title: string, lines: string[]) => lines.length > 0 && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint }}>{title}</div>
      {lines.map((l, i) => <div key={i} style={{ font: `11.5px/1.5 ${fontFamily.mono}`, color: tk.text.secondary, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{l}</div>)}
    </div>
  );

  return (
    <span ref={anchor} style={{ display: 'inline-flex', marginLeft: 8 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          height: 26, display: 'flex', alignItems: 'center', gap: 6, padding: '0 9px', border: 0, borderRadius: radius.md, cursor: 'pointer',
          background: alpha(tk.status.danger, open ? 0.26 : 0.16), color: tk.status.danger, font: `600 11.5px ${fontFamily.ui}`,
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: tk.status.danger }} />
        {count} {count === 1 ? 'error' : 'errors'}
      </button>
      {open && (
        <Popover anchorRef={anchor} onClose={() => setOpen(false)} align="end" width={420} padding={0}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 8px 10px 14px', borderBottom: `1px solid ${tk.border.subtle}` }}>
            <b style={{ flex: 1, fontSize: 13 }}>Shader didn’t compile</b>
            <Button size="sm" variant="ghost" icon="copy" style={{ height: 28 }}
              onClick={() => { void navigator.clipboard?.writeText([...graph, ...glsl].join('\n')).catch(() => {}); }}>Copy</Button>
            <IconButton icon="close" label="Close" size="sm" tooltip={false} onClick={() => setOpen(false)} />
          </div>
          <div style={{ padding: '10px 14px 12px', display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 260, overflow: 'auto' }}>
            {section('GRAPH', graph)}
            {section('GLSL', glsl)}
          </div>
        </Popover>
      )}
    </span>
  );
}
