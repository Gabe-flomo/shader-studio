import { offerGraphExport } from './components/playfile/exportMenus';
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { lazyWithSuspense, preloadLazyComponents, type PropsOf } from './components/lazyWithSuspense';
import ShaderCanvas, { type OfflineRenderHandle, type HistogramData } from './components/ShaderCanvas';
import { NodeGraph } from './components/NodeGraph/NodeGraph';
import { NodePalette } from './components/NodeGraph/NodePalette';
import { CodeBarRow, CodePanel } from './components/CodePanel';
import { tokenizeLine } from './components/glslSyntax';
import { DesktopTopNav } from './components/shell/DesktopTopNav';
import { MobileTopBar } from './components/shell/MobileTopBar';
import { fontFamily } from './theme/tokens';
import { Icon } from './components/ui/Icon';
import { Sheet } from './components/ui/Sheet';
import { CreditTag } from './components/ui/Credit';
import { Segmented } from './components/ui/Choice';
import { MobilePreviewPill } from './components/shell/MobilePreviewPill';
import { MobileIconSegment } from './components/shell/MobileIconSegment';
import { Button, IconButton } from './components/ui/Button';
import { ThemeOverrideContext, useTokens } from './theme/themeStore';
import { AspectPicker, CanvasFullscreenButton, PreviewFooter, PreviewHeader, PreviewQualityPicker } from './components/shell/PreviewChrome';
import { canvasFrameRef as canvasFrame, exitFullscreen, isFullscreenKey, isTyping, toggleFullscreenTarget, useFullscreen } from './lib/fullscreen';
import { GuidesToggle } from './components/play/GuidesToggle';
import { PANEL_WIDTHS, usePlayUi } from './components/play/playUi';
import { PlaySplitArea, SplitButton } from './components/play/PlaySplitArea';
import { goToMappings, goToRailCategory, usePlaySplit } from './components/play/playSplit';
import { TimeControlsStrip } from './components/TimeControlsStrip';
import { REBUILD_TOOLTIP, rebuildWithToast } from './components/shell/rebuildAction';
import { useFunctionBuilder } from './components/FunctionBuilder/useFunctionBuilder';
import { NAVIGATE_EVENT, type Page } from './components/page';
import { useLinkedPresentationWatcher } from './components/shell/linkedPresentationWatcher';
import { can, openProSheet, requireFeature } from './lib/plan';
import { NodeSearchPalette } from './components/NodeGraph/NodeSearchPalette';
import { useShallow } from 'zustand/react/shallow';
import { useNodeGraphStore, EXAMPLE_INDEX, EXAMPLE_FOLDERS, PLAY_SETUP_TOAST } from './store/useNodeGraphStore';
import { toast, useToastStore } from './components/ui/toastStore';
import { OPEN_WHATS_NEW, openWhatsNew, takeUpdateAnnouncement, useWhatsNewUnread } from './changelog/releaseNotes';
import { audioEngine } from './lib/audioEngine';
import { useBreakpoint, isMobile, isTablet, isDesktop, usePhoneLayout } from './hooks/useBreakpoint';
import { APP_HEIGHT } from './lib/viewport';
import { rotateShowsFullscreen, useRotateFullscreen } from './lib/rotateFullscreen';
import { PhoneFullscreenChrome } from './components/shell/PhoneFullscreen';
import { SplitHandle } from './components/shell/PhoneSplit';
import { PLAY_SPLIT, PLAY_SPLIT_LANDSCAPE, STUDIO_SPLIT, STUDIO_SPLIT_LANDSCAPE, usePhoneSplit } from './components/shell/splitSize';
import { useShortcuts } from './hooks/useShortcuts';
import { useTimeHotkeys } from './hooks/useTimeHotkeys';
import { useCtp, type CtpPalette } from './theme/nodePalette';
import { ctp } from './theme/palette';
// Type-only: erased at build time, so these don't pull the lazy chunks into the main bundle.
// Record loads with the app, not on demand: on a busy Play page (a mapping refreshing the panel
// every frame) React never gets idle time to finish a lazily loaded dialog, and Record would do nothing.
import { ExportModal } from './components/ExportModal';
import type { Stage as StageT } from './components/play/Stage';
import type { ConvertPage as ConvertPageT } from './components/convert/ConvertPage';
import { requestConvert } from './components/convert/convertHandoff';
import { useStage } from './components/play/stageStore';
import { hostsCanvas, usePageCanvas } from './components/shell/pageCanvasStore';
import { usePreviewHost } from './lib/previewHost';
import { OutputButton } from './components/output/OutputButton';
import type { KeyboardShortcutsModal as KeyboardShortcutsModalT } from './components/KeyboardShortcutsModal';
import type { ShortcutsPage as ShortcutsPageT } from './components/ShortcutsPage';
import type { FilesPage as FilesPageT } from './components/files/FilesPage';
import type { GLSLPage as GLSLPageT } from './components/GLSLPage';
import type { PlayPage as PlayPageT } from './components/play/PlayPage';
import type { PresentPage as PresentPageT } from './components/present/PresentPage';
import type { BuilderPage as BuilderPageT } from './components/nodePacks/BuilderShell';
import type { MobileGraphBrowser as MobileGraphBrowserT, MobileNodeGraphOverlay as MobileNodeGraphOverlayT } from './components/NodeGraph/MobileGraphBrowser';
import type { MobileNodeBrowser as MobileNodeBrowserT } from './components/NodeGraph/MobileNodeBrowser';
import type { HistoryPanel as HistoryPanelT } from './components/history/HistoryPanel';
import { useHistoryWindow } from './components/history/historyWindowStore';
import { useCodeExplorer } from './components/codeExplorer/explorerStore';
import { useUnseenActivity } from './components/ui/activityStore';

// ── Code splitting ───────────────────────────────────────────────────────────
// Everything that isn't the studio editor itself loads on first use: the
// secondary pages, the modals, and the mobile editor (desktop never downloads
// it, and vice versa for the desktop-only pieces it doesn't need). Each lazy
// component carries its own Suspense boundary so a chunk loading never blanks
// the rest of the app.

const KeyboardShortcutsModal = lazyWithSuspense<PropsOf<typeof KeyboardShortcutsModalT>>(() => import('./components/KeyboardShortcutsModal').then(m => ({ default: m.KeyboardShortcutsModal })));
const FilesPage              = lazyWithSuspense<PropsOf<typeof FilesPageT>>(() => import('./components/files/FilesPage').then(m => ({ default: m.FilesPage })));
const ShortcutsPage          = lazyWithSuspense<PropsOf<typeof ShortcutsPageT>>(() => import('./components/ShortcutsPage').then(m => ({ default: m.ShortcutsPage })));
const GLSLPage               = lazyWithSuspense<PropsOf<typeof GLSLPageT>>(() => import('./components/GLSLPage').then(m => ({ default: m.GLSLPage })));
const Stage                  = lazyWithSuspense<PropsOf<typeof StageT>>(() => import('./components/play/Stage').then(m => ({ default: m.Stage })));
const ConvertPage            = lazyWithSuspense<PropsOf<typeof ConvertPageT>>(() => import('./components/convert/ConvertPage').then(m => ({ default: m.ConvertPage })));
const PlayPage               = lazyWithSuspense<PropsOf<typeof PlayPageT>>(() => import('./components/play/PlayPage').then(m => ({ default: m.PlayPage })));
const PresentPage            = lazyWithSuspense<PropsOf<typeof PresentPageT>>(() => import('./components/present/PresentPage').then(m => ({ default: m.PresentPage })));
// The Builder page: the Function Builder and the node pack workspace (it can pop out into a floating window).
const BuilderPage            = lazyWithSuspense<PropsOf<typeof BuilderPageT>>(() => import('./components/nodePacks/BuilderShell').then(m => ({ default: m.BuilderPage })));
const MobileGraphBrowser     = lazyWithSuspense<PropsOf<typeof MobileGraphBrowserT>>(() => import('./components/NodeGraph/MobileGraphBrowser').then(m => ({ default: m.MobileGraphBrowser })));
const MobileNodeGraphOverlay = lazyWithSuspense<PropsOf<typeof MobileNodeGraphOverlayT>>(() => import('./components/NodeGraph/MobileGraphBrowser').then(m => ({ default: m.MobileNodeGraphOverlay })));
const MobileNodeBrowser      = lazyWithSuspense<PropsOf<typeof MobileNodeBrowserT>>(() => import('./components/NodeGraph/MobileNodeBrowser').then(m => ({ default: m.MobileNodeBrowser })));
const HistoryPanel           = lazyWithSuspense<PropsOf<typeof HistoryPanelT>>(() => import('./components/history/HistoryPanel').then(m => ({ default: m.HistoryPanel })));
const HistoryWindow          = lazyWithSuspense<Record<string, never>>(() => import('./components/history/HistoryWindow').then(m => ({ default: m.HistoryWindowHost })));
const CodeExplorerDialog     = lazyWithSuspense<Record<string, never>>(() => import('./components/codeExplorer/CodeExplorerDialog').then(m => ({ default: m.CodeExplorerDialog })));

// ── Responsive sizing helpers ─────────────────────────────────────────────────
function getDefaultPreviewWidth(bp: ReturnType<typeof useBreakpoint>) {
  if (bp === 'desktop-lg') return Math.max(Math.floor(window.innerWidth * 0.38), 420);
  if (bp === 'desktop-sm') return Math.max(Math.floor(window.innerWidth * 0.35), 300);
  if (bp === 'tablet')     return Math.max(Math.floor(window.innerWidth * 0.45), 280);
  return window.innerWidth; // mobile: full width (canvas is background)
}

function getPaletteWidth(bp: ReturnType<typeof useBreakpoint>) {
  if (bp === 'desktop-lg') return 320;
  if (bp === 'desktop-sm') return 280;
  return 0; // tablet/mobile: no fixed palette sidebar
}

const MIN_PREVIEW = 200;
const MIN_GRAPH   = 280;

// ── Button style helper ───────────────────────────────────────────────────────
const btnStyle = (tc: CtpPalette, active = false): React.CSSProperties => ({
  background: active ? `${tc.blue}22` : tc.surface0,
  border: `1px solid ${active ? `${tc.blue}55` : tc.surface1}`,
  color: active ? tc.blue : tc.text,
  borderRadius: '6px',
  padding: '4px 10px',
  fontSize: '11px',
  cursor: 'pointer',
  touchAction: 'manipulation' as const,
  whiteSpace: 'nowrap' as const,
});

// ── Audio master volume widget — shown when any audioInput node is in the graph ─
function AudioMasterVolumeWidget() {
  const tc = useCtp();
  const nodes        = useNodeGraphStore(s => s.nodes);
  const masterVolume = useNodeGraphStore(s => s.audioMasterVolume);
  const setVolume    = useNodeGraphStore(s => s.setAudioMasterVolume);
  const hasAudio     = nodes.some(n => n.type === 'audioInput');
  const [paused, setPaused] = useState(false);
  if (!hasAudio) return null;

  const togglePause = () => {
    if (paused) {
      audioEngine.resumeAll();
      setPaused(false);
    } else {
      audioEngine.pauseAll();
      setPaused(true);
    }
  };

  return (
    <div style={{
      position: 'absolute', bottom: 12, right: 12, zIndex: 20,
      background: 'rgba(17,17,27,0.92)', border: `1px solid ${tc.surface1}`,
      borderRadius: '8px', padding: '6px 10px',
      display: 'flex', alignItems: 'center', gap: '8px',
      backdropFilter: 'blur(8px)',
      boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
    }}>
      <span style={{ fontSize: '11px', color: tc.sky }}>♫</span>
      <button
        onClick={togglePause}
        title={paused ? 'Resume all audio' : 'Pause all audio'}
        style={{ background: 'none', border: 'none', color: paused ? tc.red : tc.green, cursor: 'pointer', fontSize: '12px', padding: '0 2px', lineHeight: 1 }}
      >{paused ? '▶' : '⏸'}</button>
      <input
        type="range"
        min={0} max={1} step={0.01}
        value={masterVolume}
        onChange={e => setVolume(parseFloat(e.target.value))}
        style={{ width: 72, accentColor: tc.sky, cursor: 'pointer', opacity: paused ? 0.4 : 1 }}
      />
      <span style={{ fontSize: '10px', color: tc.overlay0, fontFamily: 'monospace', width: '30px', textAlign: 'right' }}>
        {Math.round(masterVolume * 100)}%
      </span>
    </div>
  );
}

// Mobile's own read-only generated-code view — desktop's CodePanel is a
// draggable-height floating panel with mouse-based resize, not a fit for a
// fullscreen mobile pane, so this reuses just its tokenizer/palette for the
// same syntax highlighting rather than the whole component.
function MobileCodeView({ code }: { code: string }) {
  const tc = useCtp();
  const [copied, setCopied] = useState(false);
  const lines = code ? code.split('\n') : ['// No shader compiled yet'];
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* silent */ }
  };
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, background: tc.mantle }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', background: tc.base, borderBottom: `1px solid ${tc.surface0}`, flexShrink: 0,
      }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: tc.blue, letterSpacing: '0.04em' }}>FRAGMENT SHADER</span>
        <button
          onClick={handleCopy}
          style={{ background: 'none', border: `1px solid ${tc.surface1}`, color: copied ? tc.green : tc.subtext0, borderRadius: '5px', padding: '3px 8px', fontSize: '11px', cursor: 'pointer', touchAction: 'manipulation' }}
        >{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 12px', fontFamily: 'monospace', fontSize: '11px', lineHeight: 1.6 }}>
        {lines.map((line, i) => (
          <div key={i} style={{ whiteSpace: 'pre' }}>
            <span style={{ color: tc.surface1, userSelect: 'none', marginRight: '10px' }}>{String(i + 1).padStart(3, ' ')}</span>
            {tokenizeLine(line).map((tok, j) => <span key={j} style={{ color: tok.color }}>{tok.text}</span>)}
          </div>
        ))}
      </div>
    </div>
  );
}

type HistChannel = 'luma' | 'r' | 'g' | 'b';

const HIST_CH_COLORS: Record<HistChannel, string> = {
  luma: ctp.text, r: ctp.red, g: ctp.green, b: ctp.blue,
};
const HIST_CH_LABELS: Record<HistChannel, string> = {
  luma: 'L', r: 'R', g: 'G', b: 'B',
};

function HistogramOverlay({ data }: { data: HistogramData }) {
  const [active, setActive] = React.useState<Set<HistChannel>>(new Set(['luma']));
  const [hoverInfo, setHoverInfo] = React.useState<{ x: number; binIdx: number } | null>(null);

  const toggle = (ch: HistChannel) => {
    setActive(prev => {
      const next = new Set(prev);
      if (next.has(ch)) { if (next.size > 1) next.delete(ch); }
      else next.add(ch);
      return next;
    });
  };

  const channels = (['luma', 'r', 'g', 'b'] as HistChannel[]).filter(ch => active.has(ch));
  const allBins = channels.map(ch => data[ch]);
  const globalMax = Math.max(...allBins.flatMap(b => Array.from(b)), 0.001);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const binIdx = Math.min(data.luma.length - 1, Math.floor(t * data.luma.length));
    setHoverInfo({ x: t, binIdx });
  };

  const btnStyle = (ch: HistChannel): React.CSSProperties => ({
    padding: '1px 6px', fontSize: '9px', borderRadius: '3px', cursor: 'pointer',
    fontFamily: 'monospace', letterSpacing: '0.04em',
    background: active.has(ch) ? `${HIST_CH_COLORS[ch]}22` : 'transparent',
    border: `1px solid ${active.has(ch) ? HIST_CH_COLORS[ch] : ctp.surface1}`,
    color: active.has(ch) ? HIST_CH_COLORS[ch] : ctp.surface2,
  });

  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0, height: '84px',
      background: 'rgba(17,17,27,0.92)', backdropFilter: 'blur(4px)',
      borderTop: `1px solid ${ctp.surface0}66`,
      display: 'flex', flexDirection: 'column',
      padding: '5px 8px 3px',
      zIndex: 5,
    }}>
      {/* Header row: channel toggles + fps + hover readout */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
        {(['luma', 'r', 'g', 'b'] as HistChannel[]).map(ch => (
          <button key={ch} style={btnStyle(ch)} onClick={() => toggle(ch)}>
            {HIST_CH_LABELS[ch]}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {hoverInfo !== null && (
          <span style={{ fontSize: '9px', color: ctp.text, fontFamily: 'monospace' }}>
            {(hoverInfo.binIdx / (data.luma.length - 1)).toFixed(3)}
            {channels.map(ch => (
              <span key={ch} style={{ color: HIST_CH_COLORS[ch], marginLeft: '5px' }}>
                {(data[ch][hoverInfo.binIdx] * 100).toFixed(1)}%
              </span>
            ))}
          </span>
        )}
        {data.fps > 0 && (
          <span style={{ fontSize: '9px', color: ctp.surface2, fontFamily: 'monospace', marginLeft: '6px' }}>
            {data.fps}<span style={{ color: ctp.surface1 }}>fps</span>
          </span>
        )}
      </div>

      {/* Histogram bars — overlapping, one layer per active channel */}
      <div
        style={{ flex: 1, position: 'relative', cursor: 'crosshair' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverInfo(null)}
      >
        {channels.map(ch => (
          <div key={ch} style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'flex-end', gap: '1px',
            pointerEvents: 'none',
          }}>
            {Array.from(data[ch]).map((v, i) => (
              <div key={i} style={{
                flex: 1,
                height: `${Math.round((v / globalMax) * 100)}%`,
                minHeight: v > 0 ? '1px' : '0',
                background: HIST_CH_COLORS[ch],
                opacity: hoverInfo?.binIdx === i ? 0.95 : 0.45,
              }} />
            ))}
          </div>
        ))}
        {/* Hover cursor line */}
        {hoverInfo !== null && (
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${hoverInfo.x * 100}%`,
            width: '1px', background: 'rgba(255,255,255,0.3)',
            pointerEvents: 'none',
          }} />
        )}
      </div>

      {/* Scale labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px', color: ctp.surface1, marginTop: '2px' }}>
        <span>0</span><span>0.5</span><span>1.0</span>
      </div>
    </div>
  );
}

// ── Per-frame readouts ────────────────────────────────────────────────────────
// ShaderCanvas writes pixelSample / nodeProbeValues / hoveredParamHint into the
// store up to ~10× a second while the mouse is over the canvas or a node is
// selected. These leaves are the only components that subscribe to those
// keys, so App — and the entire graph under it — no longer re-renders on
// every sample.

type PixelSample = NonNullable<ReturnType<typeof useNodeGraphStore.getState>['pixelSample']>;

function PixelSwatch({ sample, size, digits, title }: { sample: PixelSample; size: number; digits: number; title?: string }) {
  return (
    <div title={title} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <div style={{ width: `${size}px`, height: `${size}px`, borderRadius: '2px', flexShrink: 0, background: `rgb(${sample[0]},${sample[1]},${sample[2]})`, border: `1px solid ${ctp.surface1}` }} />
      <span style={{ color: ctp.red }}>r</span><span style={{ color: ctp.text }}>{(sample[0]/255).toFixed(digits)}</span>
      <span style={{ color: ctp.green }}>g</span><span style={{ color: ctp.text }}>{(sample[1]/255).toFixed(digits)}</span>
      <span style={{ color: ctp.blue }}>b</span><span style={{ color: ctp.text }}>{(sample[2]/255).toFixed(digits)}</span>
    </div>
  );
}

/** Mobile: param hint or pixel colour, pinned to the top-right of the canvas pane. */
function CanvasHintOverlay() {
  const pixelSample      = useNodeGraphStore(s => s.pixelSample);
  const hoveredParamHint = useNodeGraphStore(s => s.hoveredParamHint);
  if (!hoveredParamHint && !pixelSample) return null;
  return (
    <div style={{
      position: 'absolute', top: 8, right: 8, zIndex: 22,
      background: 'rgba(24,24,37,0.80)', backdropFilter: 'blur(8px)',
      borderRadius: '6px', padding: '4px 8px',
      display: 'flex', alignItems: 'center', gap: '6px',
      fontSize: '10px', fontFamily: 'monospace', color: ctp.surface2,
      border: `1px solid ${ctp.surface0}`,
      maxWidth: '320px',
    }}>
      {hoveredParamHint ? (
        <>
          <span style={{ color: ctp.mauve, fontSize: '11px', flexShrink: 0 }}>?</span>
          <span style={{ color: ctp.text, whiteSpace: 'normal', lineHeight: '1.4', fontFamily: 'system-ui, sans-serif' }}>{hoveredParamHint}</span>
        </>
      ) : pixelSample ? (
        <PixelSwatch sample={pixelSample} size={10} digits={2} />
      ) : null}
    </div>
  );
}

const PROBE_COLOR_MAP: Record<string, string> = { float: '#f0a', vec2: '#0af', vec3: '#0fa', vec4: '#fa0' };

/** Status-bar readout: pixel colour under the cursor, else the selected node's probe values. */
function StatusReadout({ swatchSize, probeGap, emptyText, swatchTitle }: { swatchSize: number; probeGap: number; emptyText: string; swatchTitle?: string }) {
  const pixelSample     = useNodeGraphStore(s => s.pixelSample);
  const selectedNodeId  = useNodeGraphStore(s => s.selectedNodeId);
  const selectedNode    = useNodeGraphStore(s => s.selectedNodeId ? s.nodes.find(n => n.id === s.selectedNodeId) ?? null : null);
  const nodeProbeValues = useNodeGraphStore(s => s.nodeProbeValues);
  if (pixelSample) return <PixelSwatch sample={pixelSample} size={swatchSize} digits={3} title={swatchTitle} />;
  if (selectedNode && nodeProbeValues) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: `${probeGap}px`, overflow: 'hidden' }}>
        {Object.entries(nodeProbeValues).map(([outKey, vals]) => {
          const outSocket = selectedNode.outputs[outKey];
          const label = outSocket?.label ?? outKey;
          const col = PROBE_COLOR_MAP[outSocket?.type ?? 'float'] || ctp.text;
          return (
            <span key={label} style={{ display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
              <span style={{ color: col, fontWeight: 700 }}>{label}</span>
              <span style={{ color: ctp.text }}>{vals.map(v => v.toFixed(3)).join(', ')}</span>
            </span>
          );
        })}
      </div>
    );
  }
  return <span style={{ opacity: 0.4 }}>{selectedNodeId ? 'computing…' : emptyText}</span>;
}

// While the Convert page has a scratch graph on the canvas, nothing may edit, save or load it.
import { importAnyFile } from './components/shell/importAnyFile';

const unlessScratch = (fn: () => void) => () => { if (!useNodeGraphStore.getState().scratch) fn(); };

function App() {
  const tc = useCtp();
  const tk = useTokens();
  // Pick only what App itself renders with. A bare `useNodeGraphStore()`
  // subscribes to the whole store, so every per-frame write (pixel sample,
  // probe values, current time) re-rendered App and everything under it.
  // Actions are stable references, so selecting them is free; the per-frame
  // readouts live in StatusReadout / CanvasHintOverlay above.
  const {
    loadExampleGraph, compilationErrors, glslErrors, fragmentShader,
    exportGraph,
    addNode, setNodeHighlightFilter, _fitViewCallback, undo,
    selectedNodeId,
    groupNodes, deselectAll,
    searchPaletteOpen, setSearchPaletteOpen,
    nodeSlugMap,
    mobileKeyframeEditor, mobileKeyframeTool, setMobileKeyframeTool,
    mobileNodeOverlayOpen, setMobileNodeOverlayOpen,
  } = useNodeGraphStore(useShallow(s => ({
    loadExampleGraph: s.loadExampleGraph, compilationErrors: s.compilationErrors, glslErrors: s.glslErrors, fragmentShader: s.fragmentShader,
    exportGraph: s.exportGraph,
    addNode: s.addNode, setNodeHighlightFilter: s.setNodeHighlightFilter, _fitViewCallback: s._fitViewCallback, undo: s.undo,
    selectedNodeId: s.selectedNodeId,
    groupNodes: s.groupNodes, deselectAll: s.deselectAll,
    searchPaletteOpen: s.searchPaletteOpen, setSearchPaletteOpen: s.setSearchPaletteOpen,
    nodeSlugMap: s.nodeSlugMap,
    mobileKeyframeEditor: s.mobileKeyframeEditor, mobileKeyframeTool: s.mobileKeyframeTool, setMobileKeyframeTool: s.setMobileKeyframeTool,
    mobileNodeOverlayOpen: s.mobileNodeOverlayOpen, setMobileNodeOverlayOpen: s.setMobileNodeOverlayOpen,
  })));

  const bp = useBreakpoint();
  const mobile = isMobile(bp);
  const tablet = isTablet(bp);
  // Phones: which way it's held. Sideways, the picture sits beside its panel (and on Play can
  // take the whole screen: lib/rotateFullscreen.ts); the desktop layout never appears.
  const { landscape } = usePhoneLayout();
  const breakpointRef = useRef(bp);
  breakpointRef.current = bp;
  void isDesktop; // used implicitly via breakpoint branching

  const [showErrors, setShowErrors]     = useState(false);
  const [previewWidth, setPreviewWidth] = useState(() => getDefaultPreviewWidth(bp));
  const [isDragging, setIsDragging]     = useState(false);
  const [showCode, setShowCode]         = useState(false);
  const [page, setPageRaw]              = useState<Page>('studio');
  // Every page switch goes through the plan: Convert is Pro, and on Free asking for it opens the Pro sheet instead.
  const setPage = useCallback((next: Page | ((p: Page) => Page)) => {
    setPageRaw(prev => {
      const p = typeof next === 'function' ? next(prev) : next;
      if (p === 'convert' && !can('convert')) { queueMicrotask(() => openProSheet('convert')); return prev; }
      return p;
    });
  }, []);
  // Once the app is idle, fetch the on-demand pages and dialogs (twice: loaded chunks can
  // declare more), so opening one later never waits on React's lowest-priority work.
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    const run = () => { void preloadLazyComponents().then(() => preloadLazyComponents()); };
    if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 4000 }); else window.setTimeout(run, 2000);
  }, []);
  const playWidth = PANEL_WIDTHS[usePlayUi(s => s.panel)];
  // Play's split view can fold the sidebar (the panel column) into the panel's rail or hide it, leaving the picture and the big panel.
  const playSidebarHidden = usePlaySplit(s => s.on && s.available && s.sidebar !== 'full');
  // "This graph has a Play setup · Open Play" means nothing while Play is already open.
  useEffect(() => {
    if (page !== 'play') return;
    const clear = () => { const t = useToastStore.getState(); for (const x of t.toasts) if (x.title === PLAY_SETUP_TOAST) t.dismiss(x.id); };
    clear();
    return useToastStore.subscribe(clear);
  }, [page]);

  // Opening a .playfile shows what came in on its page (src/playfile/app.ts).
  useEffect(() => {
    const go = (e: Event) => { const p = (e as CustomEvent<Page>).detail; if (p) setPage(p); };
    window.addEventListener('playfile-open-page', go);
    return () => window.removeEventListener('playfile-open-page', go);
  }, [setPage]);

  // The Library's "Manage in Files" opens the Files page.
  useEffect(() => {
    const go = () => setPage('files');
    window.addEventListener('open-files-page', go);
    return () => window.removeEventListener('open-files-page', go);
  }, [setPage]);
  // Anything else that needs a page shown (a linked presentation's "Open", say).
  useEffect(() => {
    const go = (e: Event) => { const p = (e as CustomEvent<Page>).detail; if (p) setPage(p); };
    window.addEventListener(NAVIGATE_EVENT, go);
    return () => window.removeEventListener(NAVIGATE_EVENT, go);
  }, [setPage]);
  // A graph with a linked presentation: offer it, open it too, or nothing (the setting in the Library).
  useLinkedPresentationWatcher();

  // Navigate to Function Builder when an ExprBlock requests it
  useEffect(() => {
    return useFunctionBuilder.subscribe((s) => {
      if (s.requestNavToBuilder) {
        // Popped out: the window shows it over this page instead.
        void import('./components/nodePacks/builderWindow').then(({ useBuilderWindow, popOutBuilder }) => {
          if (useBuilderWindow.getState().popped) popOutBuilder('functions');
          else { useBuilderWindow.setState({ tab: 'functions' }); setPage('fn'); }
        });
        useFunctionBuilder.getState().clearNavRequest();
      }
    });
  }, [setPage]);
  // "Go to source" on a Play control opens the Studio (NodeGraph centres on the node).
  useEffect(() => {
    let last = useNodeGraphStore.getState().focusNodeRequest?.n ?? 0;
    return useNodeGraphStore.subscribe(s => {
      const n = s.focusNodeRequest?.n ?? 0;
      if (n !== last) { last = n; setPage('studio'); }
    });
  }, [setPage]);
  // An imported play file opens on the Play page.
  useEffect(() => {
    let last = useNodeGraphStore.getState().playOpenRequest;
    return useNodeGraphStore.subscribe(s => {
      if (s.playOpenRequest !== last) { last = s.playOpenRequest; setPage('play'); }
    });
  }, [setPage]);
  const [previewFloated, setPreviewFloated] = useState(false);
  const [floatPos, setFloatPos]   = useState({ x: 40, y: 60 });
  const [floatSize, setFloatSize] = useState({ w: 480, h: 360 });
  const floatDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const floatContainerRef = useRef<HTMLDivElement>(null);

  // Mobile: canvas-only / split / graph-only layout mode
  const [mobileLayout, setMobileLayout] = useState<'canvas' | 'split' | 'graph' | 'code'>('split');
  // Phones: how much of the screen (in vh) the picture gets above the graph (Studio) or the
  // panels (Play), set by dragging the seam between them and remembered per page on this
  // device. The Studio's canvas stays square by capping its width to the same vh value.
  const studioSplitPortrait = usePhoneSplit(STUDIO_SPLIT);
  const playSplitPortrait = usePhoneSplit(PLAY_SPLIT);
  // Sideways: the picture's width in vw, remembered separately.
  const studioSplitLandscape = usePhoneSplit(STUDIO_SPLIT_LANDSCAPE);
  const playSplitLandscape = usePhoneSplit(PLAY_SPLIT_LANDSCAPE);
  const studioSplit = landscape ? studioSplitLandscape : studioSplitPortrait;
  const playSplit = landscape ? playSplitLandscape : playSplitPortrait;
  const mobileCanvasVh = studioSplit.vh;
  // Tablet: palette sidebar expanded or icon-only
  const [paletteExpanded, setPaletteExpanded] = useState(false);

  // Export animation modal
  const [showExport, setShowExport]           = useState(false);
  // Render… on a take, or Record a performance on the Play page (lib/takes.ts).
  useEffect(() => {
    const open = () => setShowExport(true);
    window.addEventListener('open-record', open);
    return () => window.removeEventListener('open-record', open);
  }, []);
  // After Materialize on the Convert page: the Studio, with the new graph in view.
  const openStudioFitted = useCallback(() => { setPage('studio'); setTimeout(() => useNodeGraphStore.getState()._fitViewCallback?.(), 80); }, [setPage]);
  const openConvertWith = useCallback((code: string) => { if (!requireFeature('convert')) return; requestConvert(code); setPage('convert'); }, [setPage]);
  // Stage › Exact records the website player's canvas instead of the app's.
  const [recordSource, setRecordSource]       = useState<HTMLCanvasElement | null>(null);
  const stageMode = useStage(s => s.mode);
  // Rotate to full screen (phones): turned sideways on Play (or the Studio, with "always"), the
  // picture alone fills the screen; turned back, the layout returns. Leaving it by hand while
  // still sideways keeps it off until the next turn.
  const rotateSetting = useRotateFullscreen(s => s.setting);
  const [rotateDismissed, setRotateDismissed] = useState(false);
  useEffect(() => { if (!landscape) setRotateDismissed(false); }, [landscape]);
  const rotateFull = rotateShowsFullscreen({ setting: rotateSetting, page, phone: mobile, landscape, dismissed: rotateDismissed }) && !stageMode;
  const canvasFull = useFullscreen(s => s.target === 'canvas');
  const rotateEntered = useRef(false);
  useEffect(() => {
    if (rotateFull) {
      if (canvasFull) return;
      if (rotateEntered.current) { rotateEntered.current = false; setRotateDismissed(true); return; }
      rotateEntered.current = true;
      void toggleFullscreenTarget('canvas');
    } else if (rotateEntered.current) {
      rotateEntered.current = false;
      if (canvasFull) void exitFullscreen();
    }
  }, [rotateFull, canvasFull]);
  // Mobile: the record button opens a menu (Record / Reset / Import / Export)
  // instead of jumping straight into the export modal, and a separate
  // Examples button opens a browsable gallery of starter graphs.
  const [showMobileExamples, setShowMobileExamples]     = useState(false);
  // Examples sheet has two tabs: starter graphs (existing folder accordion)
  // and an exploratory Nodes browser (MobileNodeBrowser) — category
  // accordion, open a node to read its description/preview, then decide to
  // add it. Deliberately not the same flow as the graph FAB's quick-search
  // NodeSearchPalette; that already exists, this is for browsing/reference.
  const [mobileExamplesTab, setMobileExamplesTab] = useState<'examples' | 'nodes' | 'history'>('examples');
  const unseenActivity = useUnseenActivity();
  // Release notes this device hasn't seen: a dot on History (the Browse button on phones).
  const unreadRelease = useWhatsNewUnread();
  // Tablets have no History tab: "What's new" on the Updated notice opens History in a sheet.
  const [showTabletHistory, setShowTabletHistory] = useState(false);
  // A What's new link asks for a page (and, on a phone, the Browse sheet gets out of the way).
  useEffect(() => {
    const go = (e: Event) => {
      const p = (e as CustomEvent<Page>).detail;
      if (!p) return;
      setShowMobileExamples(false);
      setShowTabletHistory(false);
      setPage(p);
    };
    window.addEventListener('open-page', go);
    return () => window.removeEventListener('open-page', go);
  }, [setPage]);
  // "What's new" on the Updated notice: History's What's new view, wherever History lives.
  useEffect(() => {
    const open = () => {
      const b = breakpointRef.current;
      if (isMobile(b)) { setMobileExamplesTab('history'); setShowMobileExamples(true); return; }
      if (isTablet(b)) { setShowTabletHistory(true); return; }
      setPage('studio');
      setPaletteCollapsed(false);
    };
    window.addEventListener(OPEN_WHATS_NEW, open);
    return () => window.removeEventListener(OPEN_WHATS_NEW, open);
  }, [setPage]);
  // After an update: once, a small notice pointing at What's new.
  useEffect(() => {
    const id = window.setTimeout(() => {
      const r = takeUpdateAnnouncement();
      if (r) toast.info('Updated · What’s new', { message: r.title, action: { label: 'What’s new', onClick: openWhatsNew } });
    }, 1500);
    return () => window.clearTimeout(id);
  }, []);
  // Reset's own confirm step, in-app rather than window.confirm() — a native
  // confirm dialog is unreliable (sometimes silently a no-op) inside a Tauri
  // webview, which would make Reset look broken with no error or feedback.
  const [showMobileResetConfirm, setShowMobileResetConfirm] = useState(false);
  // Examples browser: which category folders are expanded — starts empty
  // (all collapsed) since the full list is long enough to need scrolling
  // past just the first one or two categories otherwise.
  const [expandedExampleFolders, setExpandedExampleFolders] = useState<Set<string>>(new Set());
  // Keyboard shortcuts modal
  const [showShortcuts, setShowShortcuts]     = useState(false);
  const historyPopped = useHistoryWindow(s => s.open);
  const codeExplorerOpen = useCodeExplorer(s => s.open);
  // Node search palette
  // showSearchPalette is now in the store (searchPaletteOpen / setSearchPaletteOpen)
  // The preview's canvas and offline renderer register with lib/previewHost: Record and Snapshot take the
  // picture from whichever ShaderCanvas is mounted (this file's, or a page hosting the canvas itself).
  const handleCanvasReady = useCallback((c: HTMLCanvasElement) => { usePreviewHost.getState().setCanvas(c); }, []);
  const handleRegisterOfflineRender = useCallback((handle: OfflineRenderHandle) => {
    usePreviewHost.getState().setOffline(handle);
    // Dev-only, like window.__shaderStudio: scripted checks render offline frames through it.
    if (import.meta.env.DEV) (window as unknown as { __shaderStudioOffline?: OfflineRenderHandle }).__shaderStudioOffline = handle;
  }, []);

  // A page hosting the main canvas itself (Convert, GLSL: shell/PageCanvas.tsx): the preview column steps aside.
  const pageLayouts = usePageCanvas(s => s.layout);
  const hosted = hostsCanvas(page, pageLayouts);

  const [showHistogram, setShowHistogram] = useState(false);
  const [histData, setHistData]           = useState<HistogramData | null>(null);
  const handleHistogram = useCallback((data: HistogramData) => { setHistData(data); }, []);
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [paletteUserW, setPaletteUserW] = useState<number | null>(null);
  const paletteResizeRef = useRef<{ startX: number; startW: number } | null>(null);

  // Update preview width when breakpoint changes
  useEffect(() => {
    setPreviewWidth(getDefaultPreviewWidth(bp));
  }, [bp]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  const addRandomNode = useCallback((type: string) => {
    addNode(type, { x: 200 + Math.random() * 160, y: 120 + Math.random() * 200 });
  }, [addNode]);

  const shortcutHandlers = useMemo(() => ({
    undo:           unlessScratch(() => undo()),
    redo:           unlessScratch(() => useNodeGraphStore.getState().redo()),
    export:         unlessScratch(() => offerGraphExport(null)),
    import:         unlessScratch(() => { void importAnyFile(setPage); }),
    fitView:        () => _fitViewCallback?.(),
    fullscreen:     () => { if (page === 'present') void toggleFullscreenTarget('present'); else if (page === 'studio' || page === 'play' || hosted) void toggleFullscreenTarget('canvas'); },
    toggleCode:     () => setShowCode(v => !v),
    toggleRecord:   () => setShowExport(v => !v),
    rebuild:        () => { void rebuildWithToast(); },
    addNode:        unlessScratch(() => setSearchPaletteOpen(true)),
    groupSelected:  unlessScratch(() => {
      const ids = useNodeGraphStore.getState().selectedNodeIds;
      if (ids.length >= 2) { groupNodes(ids); deselectAll(); }
    }),
    duplicateSelected: unlessScratch(() => {
      const st = useNodeGraphStore.getState();
      const ids = st.selectedNodeIds.length > 0 ? st.selectedNodeIds : st.selectedNodeId ? [st.selectedNodeId] : [];
      if (ids.length > 0) st.duplicateNodes(ids);
    }),
    deleteSelected: unlessScratch(() => {
      const st = useNodeGraphStore.getState();
      const ids = st.selectedNodeIds.length > 0 ? st.selectedNodeIds : st.selectedNodeId ? [st.selectedNodeId] : [];
      if (ids.length === 0) return;
      st.removeNodes(ids);
      st.deselectAll();
      st.setSelectedNodeId(null);
    }),
    exitGroup: () => {
      const st = useNodeGraphStore.getState();
      // Esc belongs to whatever dialog, menu or popover is open first
      if (st.activeGroupPath.length === 0 || document.querySelector('[role="dialog"], [role="menu"], [data-popover]')) return;
      st.exitGroup();
    },
    addUV:          unlessScratch(() => addRandomNode('uv')),
    addTime:        unlessScratch(() => addRandomNode('time')),
    addFloat:       unlessScratch(() => addRandomNode('float')),
    addOutput:      unlessScratch(() => addRandomNode('output')),
    addMix:         unlessScratch(() => addRandomNode('mix')),
    addColor:       unlessScratch(() => addRandomNode('color')),
    selectAll:      () => setNodeHighlightFilter(null),
    filterFloat:    () => setNodeHighlightFilter('float'),
    filterVec2:     () => setNodeHighlightFilter('vec2'),
    filterVec3:     () => setNodeHighlightFilter('vec3'),
    filterUVInputs: () => setNodeHighlightFilter('uv-in'),
    filterUVOutputs:() => setNodeHighlightFilter('uv-out'),
    shortcuts:      () => setPage(p => p === 'shortcuts' ? 'studio' : 'shortcuts'),
    playSplit:      () => { const sp = usePlaySplit.getState(); if (sp.available) sp.toggle(); },
    playRail:       () => { const sp = usePlaySplit.getState(); if (sp.available) sp.toggleRail(); },
    gotoMappings:   () => goToMappings(),
    railControls:   () => goToRailCategory('controls'),
    railLayers:     () => goToRailCategory('layers'),
    railFinish:     () => goToRailCategory('finish'),
    railEngine:     () => goToRailCategory('engine'),
    railSignals:    () => goToRailCategory('signals'),
  }), [undo, addRandomNode, exportGraph, _fitViewCallback, setNodeHighlightFilter, groupNodes, deselectAll, setPage, page, hosted]);

  const HOLD_FILTER_IDS = useMemo(() => new Set(['filterFloat', 'filterVec2', 'filterVec3', 'filterUVInputs', 'filterUVOutputs']), []);
  const holdHandlers = useMemo(() => ({
    ids: HOLD_FILTER_IDS,
    onRelease: () => setNodeHighlightFilter(null),
  }), [HOLD_FILTER_IDS, setNodeHighlightFilter]);

  useShortcuts(shortcutHandlers, holdHandlers);
  // Full screen: F alone on Play (the Studio's F fits the graph; Present handles its own); ⌘⇧F is the shortcut above.
  // On the document, in the capture phase: after the Play's own key mappings and the MIDI keyboard (on window, which
  // stop the key when they use it), before the app's shortcuts (window, bubbling).
  useEffect(() => {
    if (page !== 'play') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || !isFullscreenKey(e, { typing: isTyping(e.target), plainF: true })) return;
      if (document.querySelector('[role="dialog"]')) return;
      // The piano roll's F is Fold (docs/piano-roll.md).
      if ((e.target as Element | null)?.closest?.('[data-piano-roll]')) return;
      e.preventDefault();
      e.stopPropagation();
      void toggleFullscreenTarget('canvas');
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [page]);
  // ⌃1–4 do what ⌘1–4 (railControls/Layers/Finish/Engine, useShortcuts.ts) do: a plain browser tab
  // claims ⌘1–4 for switching its own tabs before the page ever sees the keydown, so this fixed,
  // unremappable fallback is the only way those four reach the rail there (App.tsx, not useShortcuts's
  // customizable map — the same four ids fire either way).
  useEffect(() => {
    if (page !== 'play') return;
    const CTRL_RAIL_CATS = { '1': 'controls', '2': 'layers', '3': 'finish', '4': 'engine', '5': 'signals' } as const;
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || isTyping(e.target)) return;
      const cat = CTRL_RAIL_CATS[e.key as keyof typeof CTRL_RAIL_CATS];
      if (!cat) return;
      e.preventDefault();
      goToRailCategory(cat);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page]);
  useTimeHotkeys();



  useEffect(() => {
    loadExampleGraph('blank');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Desktop divider drag (mouse + touch) ──────────────────────────────────
  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const onMove = (ev: MouseEvent) => {
      const newWidth = window.innerWidth - ev.clientX;
      setPreviewWidth(Math.max(MIN_PREVIEW, Math.min(newWidth, window.innerWidth - MIN_GRAPH)));
    };
    const onUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const handleDividerTouchStart = useCallback((_e: React.TouchEvent) => {
    setIsDragging(true);
    const onMove = (ev: TouchEvent) => {
      const touch = ev.touches[0];
      const newWidth = window.innerWidth - touch.clientX;
      setPreviewWidth(Math.max(MIN_PREVIEW, Math.min(newWidth, window.innerWidth - MIN_GRAPH)));
    };
    const onEnd = () => {
      setIsDragging(false);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
  }, []);


  // ── Float preview drag ────────────────────────────────────────────────────
  const handleFloatHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    floatDragRef.current = { startX: e.clientX, startY: e.clientY, origX: floatPos.x, origY: floatPos.y };
    const onMove = (ev: MouseEvent) => {
      if (!floatDragRef.current) return;
      const dx = ev.clientX - floatDragRef.current.startX;
      const dy = ev.clientY - floatDragRef.current.startY;
      setFloatPos({ x: floatDragRef.current.origX + dx, y: floatDragRef.current.origY + dy });
    };
    const onUp = () => {
      floatDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floatPos.x, floatPos.y]);

  // Track float window size via ResizeObserver so canvas always knows its container dims.
  // Must use borderBoxSize (includes borders) not contentRect (excludes borders) — contentRect
  // creates a feedback loop: we read N-2, write N-2 as width, read N-4, write N-4... collapses to minWidth.
  useEffect(() => {
    const el = floatContainerRef.current;
    if (!el || !previewFloated) return;
    const ro = new ResizeObserver(entries => {
      const box = entries[0].borderBoxSize?.[0];
      const width  = box ? box.inlineSize : entries[0].contentRect.width;
      const height = box ? box.blockSize  : entries[0].contentRect.height;
      if (width > 0 && height > 0) setFloatSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [previewFloated]);

  // Hoisted before any early returns to keep hook call count stable across all breakpoints
  const _paletteBaseWForHook = paletteUserW ?? getPaletteWidth(bp);
  const handlePaletteResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    paletteResizeRef.current = { startX: e.clientX, startW: _paletteBaseWForHook };
    const onMove = (ev: MouseEvent) => {
      if (!paletteResizeRef.current) return;
      const delta = ev.clientX - paletteResizeRef.current.startX;
      setPaletteUserW(Math.max(160, Math.min(480, paletteResizeRef.current.startW + delta)));
    };
    const onUp = () => {
      paletteResizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [_paletteBaseWForHook]);

  // ── Error badge ───────────────────────────────────────────────────────────
  const errorCount = compilationErrors.length + glslErrors.length;
  const errorBadge = errorCount > 0 ? (
    <button
      onClick={() => setShowErrors(v => !v)}
      style={{
        height: 32, padding: '0 10px', border: 0, borderRadius: 9, cursor: 'pointer', flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 6, touchAction: 'manipulation',
        background: `${tk.status.danger}${showErrors ? '42' : '29'}`, color: tk.status.danger, font: `600 12px ${fontFamily.ui}`,
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: tk.status.danger }} />
      {errorCount} {errorCount === 1 ? 'error' : 'errors'}
    </button>
  ) : null;

  // ── Error popup ───────────────────────────────────────────────────────────
  const errorPopup = showErrors && errorCount > 0 ? (
    <div style={{
      background: tc.base, border: `1px solid ${tc.red}`, borderBottom: 'none',
      padding: '8px 12px', fontSize: '11px', color: tc.red,
      maxHeight: '160px', overflowY: 'auto', fontFamily: 'monospace', flexShrink: 0,
    }}>
      {compilationErrors.length > 0 && (
        <div style={{ marginBottom: glslErrors.length > 0 ? '6px' : 0 }}>
          <span style={{ color: `${tc.red}88`, fontSize: '10px', letterSpacing: '0.05em' }}>GRAPH</span>
          {compilationErrors.map((err, i) => <div key={i} style={{ paddingLeft: '6px' }}>{err}</div>)}
        </div>
      )}
      {glslErrors.length > 0 && (
        <div>
          <span style={{ color: `${tc.red}88`, fontSize: '10px', letterSpacing: '0.05em' }}>GLSL</span>
          {glslErrors.map((err, i) => <div key={i} style={{ paddingLeft: '6px' }}>{err}</div>)}
        </div>
      )}
      <Button size="sm" variant="ghost" icon="rebuild" title={REBUILD_TOOLTIP} onClick={() => { void rebuildWithToast(); }} style={{ marginTop: 6 }}>Rebuild</Button>
    </div>
  ) : null;

  // ══════════════════════════════════════════════════════════════════════════
  // STAGE — the Play setup on its own, as people will play with it
  // ══════════════════════════════════════════════════════════════════════════
  if (stageMode) {
    return (
      <ThemeOverrideContext.Provider value="dark">
        <Stage
          canvas={<ShaderCanvas onCanvasReady={handleCanvasReady} onRegisterOfflineRender={handleRegisterOfflineRender} />}
          onRecord={src => { setRecordSource(src); setShowExport(true); }}
        />
        {showExport && (
          <ExportModal
            canvas={recordSource ?? usePreviewHost.getState().canvas}
            offlineRender={recordSource ? null : usePreviewHost.getState().offline}
            external={!!recordSource}
            onClose={() => { setShowExport(false); setRecordSource(null); }}
          />
        )}
      </ThemeOverrideContext.Provider>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MOBILE LAYOUT (< 768px)
  // Preview fills entire screen, floating nav + bottom action bar
  // ══════════════════════════════════════════════════════════════════════════
  if (mobile && page === 'studio') {
    const showCanvasPane = mobileLayout !== 'graph' && mobileLayout !== 'code';
    const showGraphPane  = mobileLayout !== 'canvas' && mobileLayout !== 'code';
    const showCodePane   = mobileLayout === 'code';
    return (
      <div style={{ width: '100vw', height: APP_HEIGHT, position: 'relative', overflow: 'hidden', background: tc.crust, touchAction: 'none', display: 'flex', flexDirection: 'column' }}>

        <MobileTopBar page={page} onPageChange={setPage} onRecord={() => setShowExport(true)} onClear={() => setShowMobileResetConfirm(true)} />

        {/* Split content: canvas pane + drill-down graph browser — stacked upright, side by side sideways */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: landscape ? 'row' : 'column' }}>
          {showCanvasPane && (
            <div style={{
              position: 'relative',
              flex: mobileLayout === 'canvas' ? 1 : '0 0 auto',
              ...(mobileLayout === 'canvas' ? {} : landscape ? { width: `${mobileCanvasVh}vw` } : { height: `${mobileCanvasVh}vh` }),
              minHeight: 0, minWidth: 0,
              background: tk.bg.render,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden',
            }}>
              <div style={{
                position: 'relative',
                ...(mobileLayout === 'canvas' ? { width: '100%', height: '100%' }
                  : landscape ? { height: '100%', aspectRatio: '1 / 1', maxWidth: '100%' }
                  : { width: `min(100%, ${mobileCanvasVh}vh)`, height: `min(100%, ${mobileCanvasVh}vh)` }),
              }} ref={canvasFrame}>
                <ShaderCanvas onCanvasReady={handleCanvasReady} onRegisterOfflineRender={handleRegisterOfflineRender} />
                <AudioMasterVolumeWidget />
                <PhoneFullscreenChrome showEnter={landscape} />
              </div>

              {/* Pixel color info / param hint, pinned to the canvas pane */}
              <CanvasHintOverlay />

              {/* Time controls and the graph-overlay toggle float on the preview */}
              <MobilePreviewPill overlayOpen={mobileNodeOverlayOpen} onToggleOverlay={() => setMobileNodeOverlayOpen(!mobileNodeOverlayOpen)} />

              <MobileNodeGraphOverlay />
            </div>
          )}

          {/* Drag to resize the canvas/graph split — used to be a fixed
              42vh with no way to change it. The canvas pane itself stays
              square (width capped to the same vh value above), so dragging
              this only ever changes how much of the screen it gets, not its
              aspect ratio. Only shown in split mode — canvas-only/graph-only
              already give one pane the full remaining space. */}
          {showCanvasPane && showGraphPane && (
            <SplitHandle split={studioSplit} label="Resize the preview" vertical={landscape} />
          )}

          {showGraphPane && (
            <div style={{ flex: 1, minHeight: 0, minWidth: 0, [landscape ? 'borderLeft' : 'borderTop']: showCanvasPane ? `1px solid ${tc.surface0}` : undefined }}>
              <MobileGraphBrowser />
            </div>
          )}

          {showCodePane && (
            <div style={{ flex: 1, minHeight: 0 }}>
              <MobileCodeView code={fragmentShader} />
            </div>
          )}
        </div>

        {/* Error popup — sits above bottom bar (whose own height now grows
            with the home-indicator inset, so this has to match). */}
        {showErrors && errorCount > 0 && (
          <div style={{ position: 'absolute', bottom: 'calc(56px + env(safe-area-inset-bottom, 0px))', left: 0, right: 0, zIndex: 24 }}>
            {errorPopup}
          </div>
        )}

        {/* Bottom bar — layout switch, errors, keyframe tools, Browse. Padding grows with the
            home-indicator/notch insets (0 in a browser tab, real in an installed app). */}
        <div style={{
          flexShrink: 0, zIndex: 25, boxSizing: 'border-box', minHeight: 64,
          background: tk.bg.panel, borderTop: `1px solid ${tk.border.default}`,
          padding: '10px calc(14px + env(safe-area-inset-right, 0px)) calc(10px + env(safe-area-inset-bottom, 0px)) calc(14px + env(safe-area-inset-left, 0px))',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <MobileIconSegment
            ariaLabel="Layout"
            value={mobileLayout}
            onChange={setMobileLayout}
            options={[
              { value: 'canvas', icon: 'layoutCanvas', label: 'Preview only' },
              { value: 'split', icon: 'layoutSplit', label: 'Preview and graph' },
              { value: 'graph', icon: 'layoutGraph', label: 'Graph only' },
              { value: 'code', icon: 'code', label: 'Generated code' },
            ]}
          />
          {errorBadge}
          {/* Keyframe tools while the keyframe editor is open — no keyboard for V/C/X/D here */}
          {mobileKeyframeEditor && (
            <MobileIconSegment
              ariaLabel="Keyframe tool"
              value={mobileKeyframeTool}
              onChange={setMobileKeyframeTool}
              options={[
                { value: 'select', icon: 'nodes', label: 'Select' },
                { value: 'add', icon: 'plus', label: 'Add' },
                { value: 'delete', icon: 'close', label: 'Delete' },
                { value: 'draw', icon: 'wave', label: 'Draw' },
              ]}
            />
          )}
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => { setMobileExamplesTab('nodes'); setShowMobileExamples(true); }}
            style={{
              height: 40, padding: '0 14px', border: 0, borderRadius: 12, cursor: 'pointer', flexShrink: 0, touchAction: 'manipulation',
              display: 'flex', alignItems: 'center', gap: 7, background: tk.ink.base, color: tk.ink.text, font: `600 13px ${fontFamily.ui}`,
            }}
          >
            <Icon name="spark" size={15} />Browse
            {(unseenActivity.count > 0 || unreadRelease) && (
              <span aria-label={unseenActivity.count > 0 ? `${unseenActivity.count} new ${unseenActivity.count === 1 ? 'notice' : 'notices'} in History` : 'New release notes in History'}
                style={{ width: 8, height: 8, borderRadius: '50%', marginLeft: -2, background: unseenActivity.count > 0 && unseenActivity.error ? tk.status.danger : tk.accent.base, boxShadow: `0 0 0 2px ${tk.ink.base}` }} />
            )}
          </button>
        </div>

        {/* Browse sheet — starter graphs, or every node by category */}
        {showMobileExamples && (
          <Sheet title="Browse" onClose={() => setShowMobileExamples(false)}>
            <div style={{ marginBottom: 12 }}>
              <Segmented
                fill
                ariaLabel="Browse"
                value={mobileExamplesTab}
                onChange={setMobileExamplesTab}
                options={[
                  { value: 'examples', label: 'Examples' },
                  { value: 'nodes', label: 'Nodes' },
                  { value: 'history', label: unseenActivity.count > 0 || unreadRelease ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>History<span style={{ width: 7, height: 7, borderRadius: '50%', background: unseenActivity.count > 0 && unseenActivity.error ? tk.status.danger : tk.accent.base }} /></span> : 'History' },
                ]}
              />
            </div>
            {mobileExamplesTab === 'history' ? (
              <HistoryPanel compact onShowOnCanvas={() => setShowMobileExamples(false)} />
            ) : mobileExamplesTab === 'examples' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {EXAMPLE_FOLDERS.filter(f => f.keys.some(k => EXAMPLE_INDEX[k])).map(folder => {
                  const isOpen = expandedExampleFolders.has(folder.label);
                  const keys = folder.keys.filter(k => EXAMPLE_INDEX[k]);
                  return (
                    <div key={folder.label}>
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => setExpandedExampleFolders(prev => {
                          const next = new Set(prev);
                          if (next.has(folder.label)) next.delete(folder.label); else next.add(folder.label);
                          return next;
                        })}
                        style={{
                          width: '100%', height: 46, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', border: 0,
                          borderRadius: 12, cursor: 'pointer', touchAction: 'manipulation', textAlign: 'left',
                          background: isOpen ? tk.bg.subtle : 'none', color: tk.text.primary, font: `600 13.5px ${fontFamily.ui}`,
                        }}
                      >
                        <Icon name={isOpen ? 'chevD' : 'chevR'} size={14} style={{ color: tk.text.faint }} />
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: folder.color }} />
                        <span style={{ flex: 1 }}>{folder.label}</span>
                        <span style={{ fontSize: 12, fontWeight: 500, color: tk.text.faint, background: tk.bg.hover, borderRadius: 7, padding: '2px 7px' }}>{keys.length}</span>
                      </button>
                      {isOpen && keys.map(k => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => { loadExampleGraph(k); setShowMobileExamples(false); }}
                          style={{
                            width: '100%', minHeight: 42, display: 'flex', alignItems: 'center', padding: '6px 12px 6px 43px', border: 0,
                            borderRadius: 10, cursor: 'pointer', touchAction: 'manipulation', textAlign: 'left',
                            background: 'none', color: tk.text.secondary, font: `500 13.5px ${fontFamily.ui}`,
                          }}
                        >
                          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
                            <span>{EXAMPLE_INDEX[k].label}</span>
                            {EXAMPLE_INDEX[k].description && (
                              <span style={{ fontSize: 11.5, fontWeight: 400, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{EXAMPLE_INDEX[k].description}</span>
                            )}
                            {EXAMPLE_INDEX[k].source && <CreditTag source={EXAMPLE_INDEX[k].source} style={{ marginTop: 2 }} />}
                          </span>
                          <Icon name="chevR" size={14} style={{ color: tk.text.disabled }} />
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            ) : (
              <MobileNodeBrowser onClose={() => setShowMobileExamples(false)} />
            )}
          </Sheet>
        )}

        {/* Clear confirm — our own sheet instead of window.confirm(), which is unreliable in a Tauri webview */}
        {showMobileResetConfirm && (
          <Sheet title="Clear the graph?" onClose={() => setShowMobileResetConfirm(false)}>
            <p style={{ margin: '0 0 16px', fontSize: 13.5, lineHeight: 1.5, color: tk.text.muted }}>
              This starts over from a blank graph, and can’t be undone.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Button variant="danger" style={{ height: 44 }} onClick={() => { setShowMobileResetConfirm(false); loadExampleGraph('blank'); }}>Clear graph</Button>
              <Button style={{ height: 44 }} onClick={() => setShowMobileResetConfirm(false)}>Cancel</Button>
            </div>
          </Sheet>
        )}

        {/* Export modal */}
        {showExport && (
          <ExportModal canvas={usePreviewHost.getState().canvas} offlineRender={usePreviewHost.getState().offline} onClose={() => setShowExport(false)} />
        )}
        {showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}
        <NodeSearchPalette open={searchPaletteOpen} onClose={() => setSearchPaletteOpen(false)} onNodePlaced={id => useNodeGraphStore.getState().requestSmartConnect(id)} />
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MOBILE PLAY PAGE — the picture on top, the control panel under it
  // ══════════════════════════════════════════════════════════════════════════

  // Upright: the picture on top, the panel under it. Sideways: the picture on the left, the panel
  // on the right (one tree either way, so turning the phone keeps the canvas, sheets and tabs).
  if (mobile && page === 'play') {
    return (
      <div style={{ width: '100vw', height: APP_HEIGHT, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: tc.crust }}>
        <MobileTopBar page={page} onPageChange={setPage} onRecord={() => setShowExport(true)} />
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: landscape ? 'row' : 'column' }}>
          <ThemeOverrideContext.Provider value="dark">
            <div style={{
              position: 'relative', flexShrink: 0, background: tk.bg.render, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
              ...(landscape ? { width: `${playSplit.vh}vw`, minWidth: 0 } : { height: `${playSplit.vh}vh` }),
            }}>
              <div ref={canvasFrame} style={{ position: 'relative', width: landscape ? '100%' : `min(100vw, ${playSplit.vh}vh)`, height: '100%' }}>
                <ShaderCanvas onCanvasReady={handleCanvasReady} onRegisterOfflineRender={handleRegisterOfflineRender} />
                <PhoneFullscreenChrome showEnter={landscape} />
              </div>
            </div>
          </ThemeOverrideContext.Provider>
          <SplitHandle split={playSplit} label="Resize the picture" vertical={landscape} />
          <div style={{ flex: 1, minHeight: 0, minWidth: 0, position: 'relative' }}>
            <PlayPage compact />
          </div>
        </div>
        {showExport && <ExportModal canvas={usePreviewHost.getState().canvas} offlineRender={usePreviewHost.getState().offline} onClose={() => setShowExport(false)} />}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MOBILE LEARN PAGE
  // ══════════════════════════════════════════════════════════════════════════

  if (mobile && page === 'shortcuts') {
    return (
      <div style={{ width: '100vw', height: APP_HEIGHT, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: tc.crust }}>
        <MobileTopBar page={page} onPageChange={setPage} onRecord={() => setShowExport(true)} />
        <ShortcutsPage />
      </div>
    );
  }

  if (mobile && page === 'files') {
    return (
      <div style={{ width: '100vw', height: APP_HEIGHT, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: tc.crust }}>
        <MobileTopBar page={page} onPageChange={setPage} onRecord={() => setShowExport(true)} />
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}><FilesPage compact onNavigate={setPage} /></div>
      </div>
    );
  }

  if (mobile && page === 'present') {
    return (
      <div style={{ width: '100vw', height: APP_HEIGHT, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: tc.crust }}>
        <MobileTopBar page={page} onPageChange={setPage} onRecord={() => setShowExport(true)} />
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}><PresentPage compact onNavigate={setPage} /></div>
      </div>
    );
  }

  if (mobile && page === 'convert') {
    return (
      <div style={{ width: '100vw', height: APP_HEIGHT, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: tc.crust }}>
        <MobileTopBar page={page} onPageChange={setPage} onRecord={() => setShowExport(true)} />
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}><ConvertPage compact onMaterialized={openStudioFitted} /></div>
      </div>
    );
  }

  if (mobile && page === 'glsl') {
    return (
      <div style={{ width: '100vw', height: APP_HEIGHT, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: tc.crust }}>
        <MobileTopBar page={page} onPageChange={setPage} onRecord={() => setShowExport(true)} />
        {/* Bounded, so the page's own panes scroll instead of the whole screen growing */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}><GLSLPage onConvert={openConvertWith} /></div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TABLET LAYOUT (768–1024px)
  // 2-panel: collapsible palette strip | graph + preview side by side
  // ══════════════════════════════════════════════════════════════════════════
  if (tablet) {
    return (
      <div style={{ width: '100vw', height: APP_HEIGHT, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: tc.crust }}>
        <DesktopTopNav compact page={page} onPageChange={setPage} onRecord={() => setShowExport(true)} />

        {page === 'shortcuts' && <ShortcutsPage />}
        {page === 'files' && <div style={{ flex: 1, minHeight: 0, display: 'flex' }}><FilesPage onNavigate={setPage} /></div>}
        {page === 'glsl' && <GLSLPage onConvert={openConvertWith} />}
        {page === 'convert' && <div style={{ flex: 1, position: 'relative', minWidth: 0 }}><ConvertPage onMaterialized={openStudioFitted} /></div>}
        {page === 'present' && <div style={{ flex: 1, minHeight: 0, display: 'flex' }}><PresentPage onNavigate={setPage} /></div>}

        <div style={{ display: (page === 'studio' || page === 'play') ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>

          {/* Collapsible palette — icon strip when collapsed, 200px when expanded. Not on Play. */}
          {page === 'studio' && <div style={{
            width: paletteExpanded ? '200px' : '36px',
            flexShrink: 0,
            background: tc.base,
            borderRight: `1px solid ${tc.surface0}`,
            transition: 'width 0.2s ease',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {/* Toggle button */}
            <button
              onClick={() => setPaletteExpanded(v => !v)}
              title={paletteExpanded ? 'Collapse palette' : 'Expand palette'}
              style={{
                background: 'none', border: 'none',
                color: tc.blue, cursor: 'pointer',
                padding: '10px 0', fontSize: '16px',
                width: '100%', flexShrink: 0,
                touchAction: 'manipulation',
              }}
            >
              {paletteExpanded ? '◀' : '⬡'}
            </button>
            {/* Full palette only when expanded */}
            {paletteExpanded && (
              <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <NodePalette mode="drawer" onNodeAdded={() => setPaletteExpanded(false)} />
              </div>
            )}
          </div>}

          {/* Play: the control panel takes the graph's place, the picture gets the rest */}
          {page === 'play' && (
            <div data-play-sidebar="" style={playSidebarHidden ? { width: 0, flexShrink: 0, position: 'relative', overflow: 'hidden' } : { width: `min(${playWidth}px, 50vw)`, flexShrink: 0, position: 'relative', borderRight: `1px solid ${tk.border.default}` }}>
              <PlayPage canvasRow />
            </div>
          )}

          {/* Center: Node Graph */}
          {page === 'studio' && <div style={{ flex: 1, position: 'relative', minWidth: 0, userSelect: isDragging ? 'none' : undefined }}>

            {/* Code toggle */}
            <button onClick={() => setShowCode(v => !v)} style={{ position: 'absolute', bottom: showCode ? 248 : 8, right: 8, zIndex: 15, ...btnStyle(tc, showCode) }}>
              {'{ } Code'}
            </button>

            <NodeGraph redesignToolbar />
            {showCode && <CodePanel code={fragmentShader} onClose={() => setShowCode(false)} highlightNodeId={selectedNodeId} nodeSlugMap={nodeSlugMap} />}
            {/* Time controls: floating dock on the node-graph side of the
                divider, vertically centered — never overlapping the render
                canvas on the other side of it. */}
            <div style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', zIndex: 10 }}>
              <TimeControlsStrip direction="column" />
            </div>
          </div>}

          {/* Divider — wider touch target for tablet */}
          {page === 'studio' && <div
            onMouseDown={handleDividerMouseDown}
            onTouchStart={handleDividerTouchStart}
            style={{ width: '8px', flexShrink: 0, background: isDragging ? tc.surface1 : tc.surface0, cursor: 'col-resize', transition: 'background 0.15s' }}
          />}

          {/* Right: Preview */}
          <div style={{ ...(page === 'play' ? { flexGrow: 1, flexBasis: 0, minWidth: 0 } : { width: previewWidth }), flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            <PlaySplitArea active={page === 'play'}>
              <div ref={canvasFrame} style={{ flex: 1, position: 'relative', minHeight: 0 }}><ShaderCanvas onCanvasReady={handleCanvasReady} onRegisterOfflineRender={handleRegisterOfflineRender} /><AudioMasterVolumeWidget /></div>
            </PlaySplitArea>
            <div style={{ background: tc.mantle, borderTop: `1px solid ${tc.surface0}`, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '10px', fontFamily: 'monospace', color: tc.surface2, minHeight: '28px', flexShrink: 0 }}>
              <StatusReadout swatchSize={12} probeGap={10} emptyText="hover for color · click node to probe" />
              <div style={{ flex: 1 }} />
              {errorBadge}
            </div>
            {errorPopup}
          </div>
        </div>
        {showExport && <ExportModal canvas={usePreviewHost.getState().canvas} offlineRender={usePreviewHost.getState().offline} onClose={() => setShowExport(false)} />}
        {showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}
        <NodeSearchPalette open={searchPaletteOpen} onClose={() => setSearchPaletteOpen(false)} onNodePlaced={id => useNodeGraphStore.getState().requestSmartConnect(id)} />
        {showTabletHistory && (
          <Sheet title="History" onClose={() => setShowTabletHistory(false)}>
            <HistoryPanel compact onShowOnCanvas={() => setShowTabletHistory(false)} />
          </Sheet>
        )}
      </div>
  );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DESKTOP LAYOUT (1024px+) — original 3-panel layout, responsively sized
  // ══════════════════════════════════════════════════════════════════════════
  const paletteW = getPaletteWidth(bp);
  const paletteBaseW = paletteUserW ?? paletteW;
  const effectivePaletteW = paletteBaseW === 0 ? 0 : paletteCollapsed ? 28 : paletteBaseW;

  return (
    <div style={{ width: '100vw', height: APP_HEIGHT, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: tc.crust }}>
      <DesktopTopNav page={page} onPageChange={setPage} onRecord={() => setShowExport(true)} />

      {page === 'shortcuts' && <ShortcutsPage />}
      {page === 'files' && <div style={{ flex: 1, minHeight: 0, display: 'flex' }}><FilesPage onNavigate={setPage} /></div>}
      {page === 'present' && <div style={{ flex: 1, minHeight: 0, display: 'flex' }}><PresentPage onNavigate={setPage} /></div>}
      {page === 'fn' && (
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <BuilderPage onNavigateToStudio={() => setPage('studio')} />
        </div>
      )}

      <div style={{ display: (page === 'studio' || page === 'glsl' || page === 'play' || page === 'convert') ? 'flex' : 'none', flex: 1, overflow: 'hidden', userSelect: isDragging ? 'none' : undefined as undefined }}>

        {/* Left: Node Palette — hidden on GLSL page */}
        {page === 'studio' && paletteBaseW > 0 && (
          <div style={{ width: effectivePaletteW, minWidth: effectivePaletteW, flexShrink: 0, overflow: 'hidden', height: '100%', position: 'relative', background: tk.bg.subtle, borderRight: `1px solid ${tk.border.default}` }}>
            {/* Collapsed state: show only an expand button */}
            {paletteCollapsed ? (
              <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10 }}>
                <IconButton icon="chevR" label="Expand sidebar" size="sm" onClick={() => setPaletteCollapsed(false)} />
              </div>
            ) : (
              <>
                <NodePalette onCollapse={() => setPaletteCollapsed(true)} />
                {/* Resize handle */}
                <div
                  onMouseDown={handlePaletteResizeStart}
                  title="Drag to resize"
                  style={{
                    position: 'absolute', right: 0, top: 0, bottom: 0, width: '4px',
                    cursor: 'col-resize', zIndex: 20, background: 'transparent',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => ((e.currentTarget as HTMLDivElement).style.background = tk.border.strong)}
                  onMouseLeave={e => ((e.currentTarget as HTMLDivElement).style.background = 'transparent')}
                />
              </>
            )}
          </div>
        )}

        {/* Center content. On Play the panel is a fixed column and the picture takes the rest. */}
        <div data-play-sidebar={page === 'play' ? '' : undefined} style={page === 'play'
          ? (playSidebarHidden ? { width: 0, flexShrink: 0, position: 'relative', overflow: 'hidden' } : { width: playWidth, flexShrink: 0, position: 'relative', borderRight: `1px solid ${tk.border.default}` })
          : { flex: 1, position: 'relative', minWidth: 0 }}>
          {page === 'play' && <PlayPage />}
          {page === 'studio' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                <NodeGraph redesignToolbar />
              </div>
              {/* Generated code docks under the canvas: a bar when closed, a resizable panel when open. */}
              {showCode
                ? <CodePanel docked code={fragmentShader} onClose={() => setShowCode(false)} highlightNodeId={selectedNodeId} nodeSlugMap={nodeSlugMap} />
                : (
                  <div style={{ borderTop: `1px solid ${tk.border.default}` }}>
                    <CodeBarRow slug={selectedNodeId ? (nodeSlugMap.get(selectedNodeId) ?? null) : null} onClick={() => setShowCode(true)}>
                      <IconButton icon="chevU" label="Show generated code" size="sm" onClick={e => { e.stopPropagation(); setShowCode(true); }} />
                    </CodeBarRow>
                  </div>
                )}
            </div>
          )}
          {page === 'glsl' && <GLSLPage onConvert={openConvertWith} />}
          {page === 'convert' && <ConvertPage onMaterialized={openStudioFitted} />}
        </div>

        {/* Resize Divider — hidden when preview is floated, and on Play (the picture fills the space) */}
        {!previewFloated && page !== 'play' && !hosted && (
          <div
            onMouseDown={handleDividerMouseDown}
            onTouchStart={handleDividerTouchStart}
            style={{ width: 5, flexShrink: 0, marginLeft: -2, marginRight: -2, zIndex: 5, position: 'relative', cursor: 'col-resize', display: 'flex', justifyContent: 'center' }}
          >
            <span style={{ width: 1, height: '100%', background: isDragging ? tk.accent.base : tk.border.default }} />
          </div>
        )}

        {/* Right: Shader Preview — hidden when floated or when the page hosts the canvas itself. A render surface, so it's dark in both themes. */}
        {!previewFloated && !hosted && (
          <div style={{ ...(page === 'play' ? { flexGrow: 1, flexBasis: 0, minWidth: 0 } : { width: previewWidth }), flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#0d0d12' }}>
            {/* Chrome around the picture follows the app's real theme; the picture itself stays dark (below). */}
            <ThemeOverrideContext.Provider value={null}>
              <PreviewHeader>
                <AspectPicker onPanel />
                <PreviewQualityPicker onPanel />
                <CanvasFullscreenButton plainF={page === 'play'} />
                {page === 'play' && <GuidesToggle />}
                {page === 'play' && <SplitButton />}
                {page === 'play' && <Button size="sm" variant="ghost" icon="play" onClick={() => useStage.getState().open('full')} title="Stage: the picture and its controls on their own, as people will play with it (Full or Exact, phone or screen, fullscreen, Record)">Stage</Button>}
                {page === 'play' && <OutputButton />}
                <IconButton icon="wave" label="Brightness histogram" size="sm" active={showHistogram} onClick={() => setShowHistogram(v => !v)} />
                <IconButton icon="popout" label="Float the preview" size="sm" onClick={() => { setPreviewFloated(true); setFloatPos({ x: window.innerWidth - floatSize.w - 20, y: 60 }); }} />
              </PreviewHeader>
            </ThemeOverrideContext.Provider>
            <ThemeOverrideContext.Provider value="dark">
              <PlaySplitArea active={page === 'play'}>
                <div ref={canvasFrame} style={{ flex: 1, position: 'relative', minHeight: 0 }}>
                  <ShaderCanvas onCanvasReady={handleCanvasReady} onRegisterOfflineRender={handleRegisterOfflineRender} onHistogram={showHistogram ? handleHistogram : undefined} />
                  {showHistogram && histData && <HistogramOverlay data={histData} />}
                </div>
              </PlaySplitArea>
            </ThemeOverrideContext.Provider>
            <ThemeOverrideContext.Provider value={null}>
              <PreviewFooter idleHint="Hover for colour · select a node to probe" />
            </ThemeOverrideContext.Provider>
          </div>
        )}
      </div>

      {/* Floating preview window */}
      {previewFloated && (
        <div
          ref={floatContainerRef}
          style={{
            position: 'fixed', left: floatPos.x, top: floatPos.y, width: floatSize.w, height: floatSize.h, zIndex: 500,
            display: 'flex', flexDirection: 'column', background: '#0d0d12', borderRadius: 12, overflow: 'hidden',
            boxShadow: '0 20px 60px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.08)',
            resize: 'both', minWidth: 240, minHeight: 180,
          }}
        >
          {/* Drag handle / title bar — follows the app's real theme; the picture below stays dark. */}
          <ThemeOverrideContext.Provider value={null}>
            <div onMouseDown={handleFloatHeaderMouseDown} style={{ cursor: 'grab', userSelect: 'none' }}>
              <PreviewHeader>
                <span onMouseDown={e => e.stopPropagation()} style={{ display: 'flex', gap: 2 }}>
                  <IconButton icon="wave" label="Brightness histogram" size="sm" active={showHistogram} onClick={() => setShowHistogram(v => !v)} />
                  <IconButton icon="popout" label="Dock the preview" size="sm" active onClick={() => setPreviewFloated(false)} />
                </span>
              </PreviewHeader>
            </div>
          </ThemeOverrideContext.Provider>
          <ThemeOverrideContext.Provider value="dark">
            <div ref={canvasFrame} style={{ flex: 1, position: 'relative', minHeight: 0 }}>
              <ShaderCanvas onCanvasReady={handleCanvasReady} onRegisterOfflineRender={handleRegisterOfflineRender} onHistogram={showHistogram ? handleHistogram : undefined} />
              {showHistogram && histData && <HistogramOverlay data={histData} />}
            </div>
          </ThemeOverrideContext.Provider>
          <ThemeOverrideContext.Provider value={null}>
            <PreviewFooter idleHint="Hover to probe" />
          </ThemeOverrideContext.Provider>
        </div>
      )}

      {showExport && (
        <ExportModal canvas={usePreviewHost.getState().canvas} offlineRender={usePreviewHost.getState().offline} onClose={() => setShowExport(false)} />
      )}
      {showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}
      {historyPopped && <HistoryWindow />}
      {codeExplorerOpen && <CodeExplorerDialog />}
      <NodeSearchPalette open={searchPaletteOpen} onClose={() => setSearchPaletteOpen(false)} onNodePlaced={id => useNodeGraphStore.getState().requestSmartConnect(id)} />
    </div>
  );
}

export default App;
