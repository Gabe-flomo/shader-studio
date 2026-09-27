/**
 * PlaySplitArea — the Play page's preview area, split between the picture and
 * a big panel (playSplit.ts). App wraps the preview canvas in it on every page
 * so the canvas never remounts; it only splits while `active` (Play, not on a
 * phone) and switched on.
 *
 * The panel's frame is drawn here (its section switcher, where it sits, the
 * sidebar and close buttons); its body is a portal target that PlayPage fills
 * with the chosen section. The divider drags (the picture resizes a few times
 * a second while dragging, not every pointer move) and double-clicks back to
 * half and half.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ThemeOverrideContext, useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useCan } from '../../lib/plan';
import { IconButton } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import type { PlayTab } from './playUi';
import { clampRatio, ratioAt, usePlaySplit, WIDE_PANEL_PX, type SplitSide } from './playSplit';

/** How often the picture follows the divider while it's dragged, in ms. */
const DRAG_APPLY_MS = 60;

export const SPLIT_SHORTCUT = 'cmd+shift+l';

export function PlaySplitArea({ active, children }: { active: boolean; children: ReactNode }) {
  const splitOn = usePlaySplit(s => s.on);
  const side = usePlaySplit(s => s.side);
  const stored = usePlaySplit(s => s.ratio);
  const on = active && splitOn;
  const areaRef = useRef<HTMLDivElement>(null);
  const [total, setTotal] = useState(0);
  // The ratio mid-drag (null: not dragging).
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!active) return;
    usePlaySplit.getState().setAvailable(true);
    return () => usePlaySplit.getState().setAvailable(false);
  }, [active]);

  const horizontal = side === 'left' || side === 'right';
  useEffect(() => {
    const el = areaRef.current;
    if (!on || !el) return;
    const measure = () => setTotal(horizontal ? el.clientWidth : el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [on, horizontal]);

  const ratio = clampRatio(dragRatio ?? stored, total || undefined);
  const panelFirst = side === 'left' || side === 'top';

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const area = areaRef.current;
    if (!area) return;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    setDragging(true);
    let latest = ratio, applied = 0, timer = 0;
    const apply = () => { timer = 0; applied = performance.now(); setDragRatio(latest); };
    const onMove = (ev: PointerEvent) => {
      latest = ratioAt(side, area.getBoundingClientRect(), ev.clientX, ev.clientY);
      // The canvas rebuilds its buffers on every resize: follow the pointer a few times a second.
      const wait = DRAG_APPLY_MS - (performance.now() - applied);
      if (wait <= 0) apply();
      else if (!timer) timer = window.setTimeout(apply, wait);
    };
    const onUp = () => {
      if (timer) window.clearTimeout(timer);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      setDragging(false);
      setDragRatio(null);
      usePlaySplit.getState().setRatio(latest);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  };

  return (
    <div ref={areaRef} style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: horizontal ? 'row' : 'column', position: 'relative' }}>
      {/* The picture: always the first child, so switching the split never remounts the canvas. */}
      <div style={{ flex: '1 1 0', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', order: panelFirst ? 2 : 0 }}>
        {children}
      </div>
      {on && (
        <ThemeOverrideContext.Provider value={null}>
          <SplitDivider horizontal={horizontal} dragging={dragging} onPointerDown={startDrag} onReset={() => usePlaySplit.getState().setRatio(0.5)} />
          <div style={{ flex: `0 0 ${(ratio * 100).toFixed(2)}%`, order: panelFirst ? 0 : 2, minWidth: 0, minHeight: 0, display: 'flex' }}>
            <SplitPanel />
          </div>
        </ThemeOverrideContext.Provider>
      )}
      {/* While dragging, the picture doesn't take the pointer. */}
      {dragging && <div style={{ position: 'absolute', inset: 0, zIndex: 30, cursor: horizontal ? 'col-resize' : 'row-resize' }} />}
    </div>
  );
}

function SplitDivider({ horizontal, dragging, onPointerDown, onReset }: { horizontal: boolean; dragging: boolean; onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void; onReset: () => void }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  const lit = hover || dragging;
  return (
    <div
      role="separator"
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      aria-label="Resize the panel"
      title="Drag to resize · double-click for half and half"
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        order: 1, flexShrink: 0, position: 'relative', zIndex: 31, touchAction: 'none',
        ...(horizontal ? { width: 7, margin: '0 -3px', cursor: 'col-resize' } : { height: 7, margin: '-3px 0', cursor: 'row-resize' }),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <span style={{
        ...(horizontal ? { width: lit ? 3 : 1, height: '100%' } : { height: lit ? 3 : 1, width: '100%' }),
        background: lit ? tk.accent.base : tk.border.default, transition: 'background 0.12s',
      }} />
    </div>
  );
}

const SIDE_OPTIONS: Array<{ value: SplitSide; icon: 'panelLeft' | 'panelRight' | 'panelTop' | 'panelBottom'; title: string }> = [
  { value: 'left', icon: 'panelLeft', title: 'Panel left of the picture' },
  { value: 'right', icon: 'panelRight', title: 'Panel right of the picture' },
  { value: 'top', icon: 'panelTop', title: 'Panel above the picture' },
  { value: 'bottom', icon: 'panelBottom', title: 'Panel below the picture' },
];

/** The big panel: its header (section, side, sidebar, close) and the body PlayPage fills. */
function SplitPanel() {
  const tk = useTokens();
  const tab = usePlaySplit(s => s.tab), setTab = usePlaySplit(s => s.setTab);
  const side = usePlaySplit(s => s.side), setSide = usePlaySplit(s => s.setSide);
  const sidebarHidden = usePlaySplit(s => s.sidebarHidden), setSidebarHidden = usePlaySplit(s => s.setSidebarHidden);
  const setHost = usePlaySplit(s => s.setHost);
  const nControls = useNodeGraphStore(s => s.play.controls.length);
  const nLayers = useNodeGraphStore(s => s.play.layers.length);
  const nMappings = useNodeGraphStore(s => s.play.mappings.length);
  const layersOk = useCan('play.layers');
  const bodyRef = useRef<HTMLDivElement>(null);

  // The body's width decides whether the section lays out wide.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => usePlaySplit.getState().setWide(el.clientWidth >= WIDE_PANEL_PX));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    setHost(bodyRef.current);
    return () => setHost(null);
  }, [setHost]);

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: tk.bg.subtle, color: tk.text.primary, font: `12.5px ${fontFamily.ui}` }}>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px 6px 12px', background: tk.bg.panel, borderBottom: `1px solid ${tk.border.default}`, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 240px', minWidth: 0, maxWidth: 460 }}>
          <Segmented<PlayTab>
            fill
            ariaLabel="Panel section"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'controls', label: `Controls${nControls ? ` · ${nControls}` : ''}` },
              { value: 'layers', label: `Layers${nLayers ? ` · ${nLayers}` : ''}${layersOk ? '' : ' · Pro'}` },
              { value: 'mappings', label: `Mappings${nMappings ? ` · ${nMappings}` : ''}` },
            ]}
          />
        </div>
        <span style={{ flex: 1 }} />
        <Segmented<SplitSide>
          size="sm"
          ariaLabel="Where the panel sits"
          value={side}
          onChange={setSide}
          options={SIDE_OPTIONS.map(o => ({ value: o.value, title: o.title, label: <Icon name={o.icon} size={14} /> }))}
        />
        <span aria-hidden style={{ width: 1, height: 18, background: tk.border.default, margin: '0 2px' }} />
        <IconButton
          icon="sidebar"
          size="sm"
          active={!sidebarHidden}
          label={sidebarHidden ? 'Show the sidebar' : 'Hide the sidebar: more room for the picture and this panel'}
          onClick={() => setSidebarHidden(!sidebarHidden)}
        />
        <IconButton icon="close" size="sm" label="Close the panel: back to the full picture" shortcut={SPLIT_SHORTCUT} onClick={() => usePlaySplit.getState().setOn(false)} />
      </div>
      <div ref={bodyRef} style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative' }} />
    </div>
  );
}

/** The preview toolbar's button that opens and closes the split. */
export function SplitButton() {
  const on = usePlaySplit(s => s.on);
  return (
    <IconButton
      icon="splitPanel"
      size="sm"
      active={on}
      label={on ? 'Close the split: back to the full picture' : 'Split: panel beside the picture'}
      shortcut={SPLIT_SHORTCUT}
      onClick={() => usePlaySplit.getState().toggle()}
    />
  );
}
