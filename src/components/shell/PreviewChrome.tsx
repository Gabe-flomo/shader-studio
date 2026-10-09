import { useMemo, useRef, useState, type ReactNode } from 'react';
import { toggleFullscreenTarget, useFullscreen } from '../../lib/fullscreen';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Popover } from '../ui/Popover';
import { Tooltip } from '../ui/Tooltip';
import { PREVIEW_ASPECTS } from '../../utils/graphImportPlan';
import { timeReadoutRef } from '../../lib/timeTick';
import { loadShortcutMap } from '../../hooks/useShortcuts';
import { REBUILD_TOOLTIP, rebuildWithToast } from './rebuildAction';
import { PREVIEW_QUALITIES, usePreviewQuality } from '../../lib/previewQuality';

// Header and footer bars for the shader preview. The picture itself is a render surface and
// stays dark in both themes (callers wrap it in ThemeOverrideContext 'dark'), but these bars
// are ordinary chrome: callers wrap them back in ThemeOverrideContext value={null} so they
// follow the app's real theme like any other panel header.

export function PreviewHeader({ children }: { children?: ReactNode }) {
  const tk = useTokens();
  return (
    <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 2, padding: '0 8px 0 18px', background: tk.bg.panel, borderBottom: `1px solid ${tk.border.default}` }}>
      <span style={{ flex: 1, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint }}>PREVIEW</span>
      {children}
    </div>
  );
}

/**
 * The picture's shape, as a row of little frames drawn in each proportion
 * (Free is a dashed one). The same setting as the export dialog's.
 */
export function AspectPicker({ onPanel = false }: { onPanel?: boolean } = {}) {
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
              style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: radius.md, cursor: 'pointer', background: on ? (onPanel ? tk.bg.field : alpha('#ffffff', 0.12)) : 'transparent' }}
            >
              <span style={{ width: Math.round(w), height: Math.round(h), borderRadius: 2, boxSizing: 'border-box', border: `1.5px ${a.ratio ? 'solid' : 'dashed'} ${on ? tk.accent.base : onPanel ? tk.text.faint : alpha('#ffffff', 0.45)}` }} />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

/**
 * The preview's resolution (After Effects style): Full, Half, Third or
 * Quarter. Lower renders fewer pixels, so a heavy scene keeps running; exports
 * are always full resolution.
 */
export function PreviewQualityPicker({ onPanel = false }: { onPanel?: boolean } = {}) {
  const tk = useTokens();
  const scale = usePreviewQuality(s => s.scale);
  const setScale = usePreviewQuality(s => s.setScale);
  const auto = usePreviewQuality(s => s.auto);
  const autoScale = usePreviewQuality(s => s.autoScale);
  const setAuto = usePreviewQuality(s => s.setAuto);
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const cur = PREVIEW_QUALITIES.find(q => Math.abs(q.value - scale) < 1e-6) ?? PREVIEW_QUALITIES[0];
  const autoCur = PREVIEW_QUALITIES.find(q => Math.abs(q.value - autoScale) < 1e-6) ?? PREVIEW_QUALITIES[0];
  // Auto: "Auto" at Full, "Auto ½" once it has stepped down (tinted, like a fixed lower setting)
  const shown = auto ? { label: `Auto (${autoCur.label})`, short: autoCur.value < 1 ? `Auto ${autoCur.short}` : 'Auto', value: autoCur.value } : cur;
  return (
    <>
      <Tooltip label="Preview resolution" description="Auto drops the resolution when a scene is heavy enough to slow the app, and goes back up when it fits. Or fix it at Full, Half, Third or Quarter. Exports are always full resolution." placement="bottom">
        <button ref={ref} type="button" aria-label={`Preview resolution: ${shown.label}`} aria-expanded={open} onClick={() => setOpen(o => !o)} data-preview-quality={shown.label}
          style={{ height: 26, minWidth: 34, padding: '0 7px', marginRight: 4, border: 0, borderRadius: radius.md, cursor: 'pointer', font: `600 11px ${fontFamily.ui}`,
            background: shown.value < 1 ? alpha(tk.accent.base, 0.16) : 'transparent', color: shown.value < 1 ? tk.accent.text : onPanel ? tk.text.muted : alpha('#ffffff', 0.7) }}>
          {shown.short}
        </button>
      </Tooltip>
      {open && (
        <Popover anchorRef={ref} onClose={() => setOpen(false)} width={180} padding={6}>
          <div role="radiogroup" aria-label="Preview resolution" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <button type="button" role="radio" aria-checked={auto} onClick={() => { setAuto(); setOpen(false); }}
              title="Starts at Full; drops a level when the picture's GPU work would slow the app, and goes back up when it fits"
              style={{ display: 'flex', alignItems: 'center', gap: 8, height: 30, padding: '0 10px', border: 0, borderRadius: radius.md, cursor: 'pointer', textAlign: 'left',
                background: auto ? tk.bg.selected : 'transparent', color: auto ? tk.accent.text : tk.text.primary, font: `${auto ? 600 : 500} 12.5px ${fontFamily.ui}` }}>
              <span style={{ flex: 1 }}>Auto</span>
              <span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.mono}` }}>{auto ? (autoCur.value === 1 ? '1×' : autoCur.short) : ''}</span>
            </button>
            {PREVIEW_QUALITIES.map(q => {
              const on = !auto && q.value === cur.value;
              return (
                <button key={q.label} type="button" role="radio" aria-checked={on} onClick={() => { setScale(q.value); setOpen(false); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, height: 30, padding: '0 10px', border: 0, borderRadius: radius.md, cursor: 'pointer', textAlign: 'left',
                    background: on ? tk.bg.selected : 'transparent', color: on ? tk.accent.text : tk.text.primary, font: `${on ? 600 : 500} 12.5px ${fontFamily.ui}` }}>
                  <span style={{ flex: 1 }}>{q.label}</span>
                  <span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.mono}` }}>{q.value === 1 ? '1×' : q.short}</span>
                </button>
              );
            })}
          </div>
        </Popover>
      )}
    </>
  );
}

/**
 * Full screen for the picture alone (the preview's frame registers itself
 * as the 'canvas' target). F on Play, ⌘⇧F anywhere; Esc leaves.
 */
export function CanvasFullscreenButton({ onPanel = false, plainF = false }: { onPanel?: boolean; plainF?: boolean }) {
  const on = useFullscreen(s => s.target === 'canvas');
  const [combo] = useState(() => loadShortcutMap().fullscreen);
  return (
    <IconButton
      icon="fit" size="sm" active={on}
      label={on ? 'Leave full screen' : 'Full screen: the picture on its own'}
      shortcut={on ? 'escape' : plainF ? 'f' : combo}
      style={onPanel ? undefined : { marginRight: 4 }}
      onClick={() => { void toggleFullscreenTarget('canvas'); }}
    />
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
  // Follows the user's rebinding on the Keys page.
  const [rebuildShortcut] = useState(() => loadShortcutMap().rebuild);
  const mono = `11px ${fontFamily.mono}`;
  const num = { color: tk.text.primary, fontVariantNumeric: 'tabular-nums' as const };

  return (
    <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 2, padding: '0 10px 0 8px', background: tk.bg.panel, borderTop: `1px solid ${tk.border.default}`, font: mono, color: tk.text.faint }}>
      <IconButton icon={timePlaying ? 'pause' : 'play'} label={timePlaying ? 'Pause' : 'Play'} shortcut="space" size="sm" onClick={() => setTimePlaying(!timePlaying)} />
      <IconButton icon="reset" label="Reset time to 0" size="sm" onClick={() => window.dispatchEvent(new CustomEvent('reset-time'))} />
      <IconButton icon="rebuild" label={REBUILD_TOOLTIP} shortcut={rebuildShortcut} size="sm" onClick={() => { void rebuildWithToast(); }} />
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
            <Tooltip label={REBUILD_TOOLTIP}>
              <Button size="sm" variant="ghost" icon="rebuild" style={{ height: 28 }} onClick={() => { void rebuildWithToast(); }}>Rebuild</Button>
            </Tooltip>
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
