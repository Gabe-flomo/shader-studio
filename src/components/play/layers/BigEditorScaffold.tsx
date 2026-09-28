/**
 * BigEditorScaffold — the shared layout for an editor with many settings,
 * as it appears in the split view's big Layers panel (and the phone sheet):
 * an optional jump strip when the editor has 4 or more Section cards, so a
 * long editor (Relationship, Particles, Video, Finish → Grade) doesn't make
 * you scroll past everything to reach a later section. Layout only — every
 * Section keeps its own fold state and body; this just gives the panel a
 * sticky strip of anchors that scroll to each one.
 *
 * docs/editor-layout.md describes the pattern for new big editors (the
 * Granulator, when it lands).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily } from '../../../theme/tokens';
import { usePlayUi } from '../playUi';

export interface BigEditorSection {
  /** Matches the `id` given to the Section it jumps to. */
  id: string;
  label: string;
}

/** From this width, two short numeric rows sit side by side instead of stacking. */
export const TWO_COL_PX = 360;

type Tokens = ReturnType<typeof useTokens>;
const FOLD_ALL_BTN = (tk: Tokens): React.CSSProperties => ({
  border: 0, background: 'none', padding: '4px 6px', cursor: 'pointer', color: tk.text.faint, font: `600 10.5px ${fontFamily.ui}`, whiteSpace: 'nowrap',
});

export function BigEditorScaffold({ sections, kind, children }: {
  sections: BigEditorSection[];
  /** The Section cards' `kind`: lets the strip's Expand all / Collapse all reach every one of them. */
  kind?: string;
  children: ReactNode;
}) {
  const tk = useTokens();
  const showStrip = sections.length >= 4;
  const [active, setActive] = useState(sections[0]?.id ?? '');
  const rootRef = useRef<HTMLDivElement>(null);
  const expandAll = usePlayUi(s => s.expandAllSections);
  const collapseAll = usePlayUi(s => s.collapseAllSections);

  // Highlight whichever section is nearest the top of the scroll area, so the strip tracks scrolling too.
  useEffect(() => {
    if (!showStrip) return;
    const root = rootRef.current;
    if (!root) return;
    const scroller = root.closest('[data-scaffold-scroll]') ?? root.parentElement;
    if (!scroller) return;
    const onScroll = () => {
      let best = sections[0]?.id ?? '';
      let bestTop = -Infinity;
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top <= 80 && top > bestTop) { bestTop = top; best = s.id; }
      }
      setActive(best);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [showStrip, sections]);

  const jump = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setActive(id);
  };

  const foldAll = kind && (
    <>
      <button type="button" onClick={() => expandAll(kind)} style={FOLD_ALL_BTN(tk)}>Expand all</button>
      <button type="button" onClick={() => collapseAll(kind)} style={FOLD_ALL_BTN(tk)}>Collapse all</button>
    </>
  );

  return (
    <div ref={rootRef} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {showStrip && (
        <div
          role="tablist"
          aria-label="Jump to section"
          style={{
            position: 'sticky', top: 0, zIndex: 2, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap',
            padding: '2px 0 8px', marginBottom: 4, background: tk.bg.subtle, borderBottom: `1px solid ${tk.border.default}`,
          }}
        >
          {sections.map(s => {
            const on = s.id === active;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => jump(s.id)}
                style={{
                  border: 0, borderRadius: 999, padding: '4px 10px', cursor: 'pointer',
                  background: on ? tk.bg.selected : tk.bg.field, color: on ? tk.accent.base : tk.text.secondary,
                  font: `600 10.5px ${fontFamily.ui}`, whiteSpace: 'nowrap',
                }}
              >
                {s.label}
              </button>
            );
          })}
          <span style={{ flex: 1 }} />
          {foldAll}
        </div>
      )}
      {!showStrip && kind && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, padding: '2px 0 4px' }}>{foldAll}</div>
      )}
      {children}
    </div>
  );
}

/** A short numeric row that pairs with the next one on a wide panel instead of always stacking full width. */
export function TwoCol({ wide, children }: { wide: boolean; children: ReactNode }) {
  return (
    <div style={{ display: wide ? 'grid' : 'block', gridTemplateColumns: wide ? '1fr 1fr' : undefined, columnGap: wide ? 16 : 0 }}>
      {children}
    </div>
  );
}
