/**
 * PlaySplitArea — the Play page's preview area: the labelled rail and the
 * panel on the left, the picture on the right (playSplit.ts, the one
 * navigation model). App wraps the preview canvas in it on every page so the
 * canvas never remounts; it only shows the rail and the panel while `active`
 * (Play, not on a phone).
 *
 * The panel sits on the left and the picture on the right, always (no
 * setting moves them). The panel's frame is drawn here (the category and its
 * pages, the setup's ⋯, close) with the rail down its left edge; its body is
 * a portal target that PlayPage fills with the page. With the panel closed
 * the rail stays on its own (a category opens the panel again); ⌘⇧B hides the
 * rail too, for the picture alone. The divider drags (the picture resizes a
 * few times a second while dragging, not every pointer move) and
 * double-clicks back to the default share (about a third for the panel).
 *
 * Everything passed as children (the preview's header, the canvas, its footer)
 * stays in the picture's column, so the panel runs the full height on the left.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ThemeOverrideContext, useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { IconButton } from '../ui/Button';
import { Menu } from '../ui/Menu';
import { clampRatio, DEFAULT_RATIO, ratioAt, usePlaySplit, WIDE_PANEL_PX } from './playSplit';
import { PlayRail, RailPageTabs } from './PlayRail';
import { categoryDef, categoryOf, RAIL_PAGES } from './railPages';
import { playSetupItems } from './playSetupMenu';

/** How often the picture follows the divider while it's dragged, in ms. */
const DRAG_APPLY_MS = 60;

export const SPLIT_SHORTCUT = 'cmd+shift+l';
export const RAIL_SHORTCUT = 'cmd+shift+b';

export function PlaySplitArea({ active, children }: { active: boolean; children: ReactNode }) {
  const splitOn = usePlaySplit(s => s.on);
  const railHidden = usePlaySplit(s => s.railHidden);
  const stored = usePlaySplit(s => s.ratio);
  const on = active && splitOn && !railHidden;
  // The panel closed: the rail alone, on the left of the picture.
  const railOnly = active && !splitOn && !railHidden;
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

  useEffect(() => {
    const el = areaRef.current;
    if (!on || !el) return;
    const measure = () => setTotal(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [on]);

  const ratio = clampRatio(dragRatio ?? stored, total || undefined);

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
      latest = ratioAt(area.getBoundingClientRect(), ev.clientX);
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
    <div ref={areaRef} data-play-split-area="" style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'row', position: 'relative' }}>
      {/* The picture: always the first child, so switching the split never remounts the canvas; drawn on the right (order). */}
      <div data-split-picture="" style={{ flex: '1 1 0', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', order: 2 }}>
        {children}
      </div>
      {on && (
        <ThemeOverrideContext.Provider value={null}>
          <SplitDivider dragging={dragging} onPointerDown={startDrag} onReset={() => usePlaySplit.getState().setRatio(DEFAULT_RATIO)} />
          <div style={{ flex: `0 0 ${(ratio * 100).toFixed(2)}%`, order: 0, minWidth: 0, minHeight: 0, display: 'flex' }}>
            <SplitPanel />
          </div>
        </ThemeOverrideContext.Provider>
      )}
      {railOnly && (
        <ThemeOverrideContext.Provider value={null}>
          <div data-rail-only="" style={{ order: 0, flexShrink: 0, display: 'flex', minHeight: 0 }}><PlayRail /></div>
        </ThemeOverrideContext.Provider>
      )}
      {/* While dragging, the picture doesn't take the pointer. */}
      {dragging && <div style={{ position: 'absolute', inset: 0, zIndex: 30, cursor: 'col-resize' }} />}
    </div>
  );
}

function SplitDivider({ dragging, onPointerDown, onReset }: { dragging: boolean; onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void; onReset: () => void }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  const lit = hover || dragging;
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the panel"
      title="Drag to resize · double-click for the default width"
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        order: 1, flexShrink: 0, position: 'relative', zIndex: 31, touchAction: 'none',
        width: 7, margin: '0 -3px', cursor: 'col-resize',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <span style={{
        width: lit ? 3 : 1, height: '100%',
        background: lit ? tk.accent.base : tk.border.default, transition: 'background 0.12s',
      }} />
    </div>
  );
}

/** The panel: its header (the category and its pages, the setup's ⋯, close), the rail, and the body PlayPage fills. */
function SplitPanel() {
  const tk = useTokens();
  const railPage = usePlaySplit(s => s.railPage);
  const setRailPage = usePlaySplit(s => s.setRailPage);
  const setHost = usePlaySplit(s => s.setHost);
  const play = useNodeGraphStore(s => s.play);
  const bodyRef = useRef<HTMLDivElement>(null);

  // The body's width decides whether the page lays out wide.
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

  const page = RAIL_PAGES[railPage];
  const cat = categoryDef(categoryOf(railPage));
  return (
    <div data-split-panel="" style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: tk.bg.subtle, color: tk.text.primary, font: `12.5px ${fontFamily.ui}` }}>
      {/* One row at every width: what doesn't fit scrolls or ellipsizes, and the ⋯ and × stay put. */}
      <div data-split-header="" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px 6px 12px', minHeight: 44, boxSizing: 'border-box', background: tk.bg.panel, borderBottom: `1px solid ${tk.border.default}`, flexWrap: 'nowrap' }}>
        {/* The category, and its pages as a tab strip when it has more than one. */}
        <div data-rail-crumb="" style={{ flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
          <span style={{ flexShrink: 0, font: `650 13px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}>{cat.label}</span>
          {cat.pages.length > 1 ? (
            <RailPageTabs def={cat} current={railPage} play={play} onPick={setRailPage} />
          ) : (
            <span title={page.description} style={{ minWidth: 0, color: tk.text.faint, font: `11.5px ${fontFamily.ui}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{page.description}</span>
          )}
        </div>
        <SetupMenu />
        <IconButton icon="close" size="sm" label="Close the panel: the rail and the picture" shortcut={SPLIT_SHORTCUT} onClick={() => usePlaySplit.getState().setOn(false)} />
      </div>
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex' }}>
        <PlayRail />
        <div ref={bodyRef} style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative' }} />
      </div>
    </div>
  );
}

/** The Play setup's ⋯: Open, Import, Export, Put it on a website, Clear Play setup (playSetupMenu.tsx). */
function SetupMenu() {
  const anchor = useRef<HTMLSpanElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const close = () => setMenu(null);
  return (
    <span ref={anchor} style={{ display: 'inline-flex', flexShrink: 0 }}>
      <IconButton icon="more" size="sm" label="Play setup: open, import, export, put it on a website, clear" active={!!menu} tooltip={!menu}
        aria-haspopup="menu" data-play-setup-menu=""
        onClick={() => { const r = anchor.current?.getBoundingClientRect(); setMenu(menu || !r ? null : { x: r.right - 240, y: r.bottom + 6 }); }} />
      {menu && <Menu x={menu.x} y={menu.y} minWidth={240} title="Play setup" items={playSetupItems({ close, anchor: anchor.current })} onClose={close} />}
    </span>
  );
}

/** The preview toolbar's button that opens and closes the panel (bringing a hidden rail back). */
export function SplitButton() {
  const on = usePlaySplit(s => s.on && !s.railHidden);
  return (
    <IconButton
      icon="splitPanel"
      size="sm"
      active={on}
      label={on ? 'Close the panel: the rail and the picture' : 'Open the panel beside the picture'}
      shortcut={SPLIT_SHORTCUT}
      onClick={() => usePlaySplit.getState().toggle()}
    />
  );
}
