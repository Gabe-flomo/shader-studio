/**
 * CodeCard — the card face of an Expression Block or a Custom Function: a carousel of read-only
 * pages (Code → Preview → Note → Description; empty ones left out), flipped with the dots, the
 * arrows, a sideways swipe or scroll, or ←/→ when the card has focus. The page is remembered per
 * node (cardPageStore). Editing happens in the full editor: double-click the card or press Edit,
 * whose tooltip is the block's signature.
 *
 * The Preview page is the eye preview's own card preview (ValuePreview: Show as, Detail, the output
 * picker, the range key), fed by the same GPU value path and throttled async readback. It is live
 * while the eye is on this block (the eye picks one node at a time) and only while the page shows.
 *
 * Kept off the clock: it re-renders when its node changes, and the highlighted code is memoised
 * per code string.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphNode } from '../../../types/nodeGraph';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { useThemeMode, useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { Icon } from '../../ui/Icon';
import { LinkedText } from '../../ui/Links';
import { CreditLink } from '../../ui/Credit';
import { parseSourceCredit } from '../../../types/credit';
import { ValuePreview } from '../ValuePreview';
import { prefOf, useNodePreviewPrefs } from '../../../lib/nodePreview/showAs';
import { highlightGlsl } from './highlight';
import { useHoverExplain } from '../../explain/useHoverExplain';
import { ExplainText } from '../../explain/ExplainText';
import { useCardPages } from './cardPageStore';
import { useFnCardScope } from '../../explain/functionCard/fnCardStore';
import { customFnEnv, exprBlockEnv } from '../../../lib/glslPatterns/findUses';
import {
  CARD_PAGE_LABEL, cardPages, codeLinesFor, isEmptyCodeNode, noteOf, previewOptionsFor, resolvePage,
  signatureFor, signatureText, stepPage, userDescriptionOf, type CardPageId,
} from './codeCardModel';

interface Props {
  node: GraphNode;
  touch?: boolean;
  /** Open the full editor (Expression Block / Custom Function modal). Without it there is no Edit button. */
  onEdit?: () => void;
  /** Open the node's own comment editor. Without it the card edits the note in place. */
  onEditNote?: () => void;
  /** Shorter code page (the mobile browser, where the editor sits under the card). */
  compact?: boolean;
}

export const CodeCard = React.memo(function CodeCard({ node, touch = false, onEdit, onEditNote, compact = false }: Props) {
  const tk = useTokens();
  const dark = useThemeMode() === 'dark';
  const isFn = node.type === 'customFn';

  // The signature lives in the Edit button's tooltip (and the empty state), not on a page
  const sig = useMemo(() => signatureText(signatureFor(node)), [node]);

  const pages = useMemo(() => cardPages(node), [node]);
  // Function cards: a click on a function name in the Code page explains it, with this block's types and helpers
  const fnScope = useFnCardScope(useMemo(() => ({
    types: isFn ? customFnEnv(node) : exprBlockEnv(node),
    source: typeof node.params.glslFunctions === 'string' ? node.params.glslFunctions : undefined,
  }), [node, isFn]));
  const remembered = useCardPages(s => s.pages[node.id]);
  const setPage = useCardPages(s => s.setPage);
  const page = resolvePage(pages, remembered);
  const go = (p: CardPageId) => setPage(node.id, p);
  const flip = (step: number) => { if (pages.length > 1) go(stepPage(pages, page, step)); };

  // Turning the eye on for this block brings its Preview page up: the eye's controls live there.
  const previewActive = useNodeGraphStore(s => s.previewNodeId === node.id);
  const wasActive = useRef(previewActive);
  useEffect(() => {
    if (previewActive && !wasActive.current) setPage(node.id, 'preview');
    wasActive.current = previewActive;
  }, [previewActive, node.id, setPage]);

  // Without a comment editor of the host's own, the note is written right here
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const editNote = onEditNote ?? (() => { setDescDraft(null); setNoteDraft(noteOf(node)); });
  const saveNote = () => {
    if (noteDraft === null) return;
    useNodeGraphStore.getState().updateNodeParams(node.id, { __comment: noteDraft.trim() ? noteDraft : undefined });
    if (noteDraft.trim()) go('note');
    setNoteDraft(null);
  };

  // The description is only ever the block's own, written here
  const [descDraft, setDescDraft] = useState<string | null>(null);
  const editDescription = () => { setNoteDraft(null); setDescDraft(userDescriptionOf(node)); };
  const saveDescription = () => {
    if (descDraft === null) return;
    const v = descDraft.trim();
    useNodeGraphStore.getState().updateNodeParams(node.id, { __description: v || undefined });
    if (v) go('description');
    setDescDraft(null);
  };

  const code = useMemo(() => codeLinesFor(node).join('\n'), [node]);
  // Hover-explain: pointing at a line of the Code page shows it in plain words (not on touch)
  const [hoverRow, setHoverRow] = useState<number | null>(null);
  const hoverText = useHoverExplain(node, !touch && page === 'code' && hoverRow !== null ? (code.split('\n')[hoverRow] ?? null) : null);
  const empty = useMemo(() => isEmptyCodeNode(node), [node]);

  // ── Gestures ───────────────────────────────────────────────────────────────
  const codeRef = useRef<HTMLDivElement>(null);
  const wheelAcc = useRef({ x: 0, at: 0 });
  const touchStart = useRef<{ x: number; y: number; top: number } | null>(null);

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey) return; // pinch-zoom stays with the canvas
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      // Sideways: flip pages (one flip per gesture), never pan the canvas
      e.stopPropagation();
      const now = performance.now();
      if (now - wheelAcc.current.at > 350) wheelAcc.current.x = 0;
      wheelAcc.current.at = now;
      wheelAcc.current.x += e.deltaX;
      if (Math.abs(wheelAcc.current.x) > 60) {
        flip(wheelAcc.current.x > 0 ? 1 : -1);
        wheelAcc.current.x = e.deltaX > 0 ? -1e6 : 1e6; // swallow the rest of this swipe
      }
      return;
    }
    // Up/down over code that can still scroll that way scrolls it, not the canvas
    const el = codeRef.current;
    if (el && el.contains(e.target as Node)) {
      const canDown = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      const canUp = el.scrollTop > 0;
      if ((e.deltaY > 0 && canDown) || (e.deltaY < 0 && canUp)) e.stopPropagation();
    }
  };
  // The canvas cancels touch scrolling, so the code scrolls by hand; a sideways swipe flips the page.
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) { touchStart.current = null; return; }
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY, top: codeRef.current?.scrollTop ?? 0 };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = touchStart.current;
    const el = codeRef.current;
    if (!s || !el || !el.contains(e.target as Node) || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dy = t.clientY - s.y;
    if (Math.abs(dy) > Math.abs(t.clientX - s.x)) el.scrollTop = s.top - dy;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touchStart.current;
    touchStart.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) flip(dx < 0 ? 1 : -1);
  };

  // ── Pages ──────────────────────────────────────────────────────────────────
  const mono = `${touch ? 12.5 : 11.5}px/1.65 ${fontFamily.mono}`;
  const pill = (props: { label: string; icon: React.ComponentProps<typeof Icon>['name']; onClick: () => void; title: string; data?: string }) => (
    <button type="button" title={props.title} aria-label={props.title} data-card-action={props.data}
      onMouseDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); props.onClick(); }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, height: touch ? 30 : 22, padding: '0 7px', border: 0, borderRadius: radius.sm,
        background: 'none', color: tk.text.muted, cursor: 'pointer', font: `500 11px ${fontFamily.ui}`, flexShrink: 0,
      }}>
      <Icon name={props.icon} size={12} />{props.label}
    </button>
  );

  const body = (() => {
    if (page === 'code') {
      const rows = highlightGlsl(code, dark);
      const width = String(rows.length).length;
      return (
        <div style={{ position: 'relative' }} onMouseLeave={() => setHoverRow(null)}>
        <div {...fnScope} ref={el => { codeRef.current = el; fnScope.ref(el); }} data-card-code="" aria-label={isFn ? 'Function body (read-only)' : 'Lines (read-only)'}
          style={{ maxHeight: compact ? 160 : touch ? 250 : 224, overflowY: 'auto', overflowX: 'hidden', padding: '7px 0', font: mono, background: tk.bg.subtle, borderRadius: radius.md, userSelect: 'text', cursor: 'text', display: 'flex', flexDirection: 'column', gap: 3 }}>
          {rows.map((toks, i) => (
            <div key={i} data-code-row={i + 1} onMouseEnter={() => setHoverRow(i)}
              style={{ display: 'flex', background: hoverText && hoverRow === i ? alpha(tk.accent.base, 0.07) : undefined }}>
              <span style={{ width: width * 7 + 16, flexShrink: 0, textAlign: 'right', paddingRight: 9, color: tk.text.disabled, userSelect: 'none' }}>{i + 1}</span>
              {/* Hanging indent: a wrapped line's continuation sits further in, so it never reads as a new line */}
              <span data-fn-code="" style={{ minWidth: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', paddingRight: 10, paddingLeft: '2ch', textIndent: '-2ch' }}>
                {toks.length ? toks.map((t, j) => <span key={j} style={{ color: t.color }}>{t.text}</span>) : ' '}
              </span>
            </div>
          ))}
        </div>
        {hoverText && (
          <div data-card-explain="" role="status"
            style={{ position: 'absolute', left: 4, right: 4, bottom: 4, padding: '5px 8px', borderRadius: radius.sm, pointerEvents: 'none',
              background: tk.bg.panel, boxShadow: `0 0 0 1px ${tk.border.default}, 0 4px 14px rgba(0,0,0,0.18)`,
              font: `500 11.5px/1.4 ${fontFamily.ui}`, color: tk.text.secondary }}>
            <ExplainText segs={hoverText} />
          </div>
        )}
        </div>
      );
    }
    if (page === 'preview') return <PreviewPage node={node} empty={empty} isFn={isFn} sig={sig} touch={touch} />;
    if (page === 'note') {
      const credit = parseSourceCredit(node.params.__credit);
      const note = noteOf(node);
      return (
        <div data-card-note="" style={{ font: `500 12.5px/1.5 ${fontFamily.ui}`, color: tk.text.secondary, padding: '6px 10px', background: alpha(tk.status.success, 0.07), borderRadius: radius.md, userSelect: 'text' }}>
          <div style={{ maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
            {note && <LinkedText text={note} linkStyle={{ color: tk.accent.text }} />}
            {credit && <CreditLink source={credit} style={{ marginTop: note ? 6 : 0, whiteSpace: 'normal' }} />}
          </div>
          <button type="button" data-card-action="edit-note"
            onMouseDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); editNote(); }}
            style={{ marginTop: 4, padding: 0, border: 0, background: 'none', color: tk.accent.text, cursor: 'pointer', font: `500 11px ${fontFamily.ui}` }}>
            {note ? 'Edit note' : 'Add a note'}
          </button>
        </div>
      );
    }
    return <DescriptionPage node={node} onEdit={editDescription} />;
  })();

  return (
    <div
      data-code-card={node.type}
      tabIndex={0}
      aria-label={`${isFn ? 'Custom Function' : 'Expression Block'}: ${CARD_PAGE_LABEL[page]} page. Double-click to edit.`}
      onMouseDown={e => e.stopPropagation()}
      onDoubleClick={e => { if ((e.target as HTMLElement).tagName === 'TEXTAREA') return; e.stopPropagation(); onEdit?.(); }}
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onKeyDown={e => {
        if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); flip(e.key === 'ArrowRight' ? 1 : -1); }
        else if (e.key === 'Enter' && onEdit && e.target === e.currentTarget) { e.preventDefault(); e.stopPropagation(); onEdit(); }
      }}
      style={{ padding: '6px 10px 8px 12px', display: 'flex', flexDirection: 'column', gap: 5, outline: 'none' }}
    >
      {/* Bar: page name · pager · note · edit */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, minHeight: touch ? 30 : 22 }}>
        <span style={{ font: `650 10px ${fontFamily.ui}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint, marginRight: 'auto', whiteSpace: 'nowrap' }}>
          {CARD_PAGE_LABEL[page]}
        </span>
        {pages.length > 1 && (
          <div role="tablist" aria-label="Card pages" style={{ display: 'flex', alignItems: 'center' }}>
            <PagerArrow dir={-1} touch={touch} onClick={() => flip(-1)} />
            {pages.map(p => (
              <button key={p} type="button" role="tab" aria-selected={p === page} aria-label={`Show ${CARD_PAGE_LABEL[p]}`} title={CARD_PAGE_LABEL[p]}
                data-card-page-dot={p}
                onMouseDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); go(p); }}
                style={{ width: touch ? 22 : 14, height: touch ? 30 : 22, padding: 0, border: 0, background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ width: p === page ? 14 : 6, height: 6, borderRadius: 3, background: p === page ? tk.accent.base : tk.border.default, transition: 'width 0.15s' }} />
              </button>
            ))}
            <PagerArrow dir={1} touch={touch} onClick={() => flip(1)} />
          </div>
        )}
        {!noteOf(node) && pill({ label: 'Note', icon: 'plus', title: 'Add a note to this block', onClick: editNote, data: 'add-note' })}
        {!userDescriptionOf(node) && pill({ label: 'Description', icon: 'plus', title: 'Add a description of this block', onClick: editDescription, data: 'add-description' })}
        {onEdit && pill({ label: 'Edit', icon: isFn ? 'fn' : 'expr', title: `${sig}\n${isFn ? 'Open the Custom Function editor' : 'Open the Expression Block editor: lines, on/off, order, inputs'} (or double-click the card)`, onClick: onEdit, data: 'edit' })}
      </div>
      {noteDraft !== null ? (
        <TextDraft label="Note" value={noteDraft} placeholder="What this block does, why, where it comes from" onChange={setNoteDraft} onSave={saveNote} onCancel={() => setNoteDraft(null)} />
      ) : descDraft !== null ? (
        <TextDraft label="Description" value={descDraft} placeholder="What this block does, in a sentence or two" onChange={setDescDraft} onSave={saveDescription} onCancel={() => setDescDraft(null)} />
      ) : body}
    </div>
  );
});

function PagerArrow({ dir, touch, onClick }: { dir: 1 | -1; touch: boolean; onClick: () => void }) {
  const tk = useTokens();
  return (
    <button type="button" aria-label={dir > 0 ? 'Next page' : 'Previous page'} title={dir > 0 ? 'Next page' : 'Previous page'}
      onMouseDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); onClick(); }}
      style={{ width: touch ? 28 : 18, height: touch ? 30 : 22, padding: 0, border: 0, background: 'none', color: tk.text.faint, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={dir > 0 ? 'chevR' : 'chevL'} size={12} />
    </button>
  );
}

/**
 * The block's output, live: the eye preview's card preview (ValuePreview) while the eye is on it,
 * else a button that turns the eye on. Show as follows the output type (float: Range / Slice /
 * Contours / Raw; vec2: Grid / Arrows / Wheel / Raw + Detail; colours with their range key), the
 * output picker shows for several outputs, and every choice is remembered per node by showAs.
 */
function PreviewPage({ node, empty, isFn, sig, touch }: { node: GraphNode; empty: boolean; isFn: boolean; sig: string; touch: boolean }) {
  const tk = useTokens();
  const active = useNodeGraphStore(s => s.previewNodeId === node.id);
  const pickedOutput = useNodePreviewPrefs(s => prefOf(node, s.prefs).output);
  const opts = useMemo(() => previewOptionsFor(node, pickedOutput), [node, pickedOutput]);
  const head = empty && (
    <div style={{ padding: '2px 2px 4px' }}>
      <div style={{ font: `650 14px ${fontFamily.ui}`, color: tk.text.primary }}>{isFn ? 'Custom function' : 'Expression'}</div>
      <div style={{ font: `500 11.5px/1.4 ${fontFamily.ui}`, color: tk.text.muted }}>
        {isFn ? 'No body yet' : 'No lines yet'}{touch ? '' : `: double-click to write ${isFn ? 'it' : 'some'}`}.
      </div>
      <div data-card-signature="" title={sig} style={{ font: `500 11px/1.5 ${fontFamily.mono}`, color: tk.text.secondary, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sig}</div>
    </div>
  );
  if (active) {
    return (
      <div data-card-preview="live">
        {head}
        <div style={{ borderRadius: radius.md, overflow: 'hidden', background: tk.bg.subtle }}><ValuePreview node={node} /></div>
      </div>
    );
  }
  const shows = !opts ? 'Nothing to show yet.'
    : opts.modes ? `${opts.type}: ${opts.modes.join(' · ')}${opts.detail ? ', with Detail' : ''}`
    : `${opts.type}: its colour, with its range`;
  return (
    <div data-card-preview="off">
      {head}
      <button type="button" data-card-action="preview"
        onMouseDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); useNodeGraphStore.getState().setPreviewNodeId(node.id); }}
        title="Preview this block: the picture shows it on its own, and its live preview shows here"
        style={{
          width: '100%', minHeight: touch ? 96 : 84, border: 0, borderRadius: radius.md, cursor: 'pointer', padding: '10px 12px',
          background: '#111217', color: '#e6e7ee', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5,
        }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: `600 12.5px ${fontFamily.ui}` }}><Icon name="eye" size={14} />Preview the output</span>
        <span style={{ font: `500 11px/1.35 ${fontFamily.ui}`, color: '#9a9cab' }}>{shows}</span>
      </button>
    </div>
  );
}

/** The description: the block's own (the page only exists when one is written). */
function DescriptionPage({ node, onEdit }: { node: GraphNode; onEdit: () => void }) {
  const tk = useTokens();
  return (
    <div data-card-description="" style={{ font: `500 12.5px/1.5 ${fontFamily.ui}`, color: tk.text.secondary, padding: '6px 10px', background: tk.bg.subtle, borderRadius: radius.md, userSelect: 'text' }}>
      <div style={{ whiteSpace: 'pre-wrap', maxHeight: 180, overflowY: 'auto' }}>{userDescriptionOf(node)}</div>
      <button type="button" data-card-action="edit-description"
        onMouseDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onEdit(); }}
        style={{ marginTop: 4, padding: 0, border: 0, background: 'none', color: tk.accent.text, cursor: 'pointer', font: `500 11px ${fontFamily.ui}` }}>
        Edit description
      </button>
    </div>
  );
}

/** A small in-card text editor: ⌘↵ saves, Esc cancels. */
function TextDraft({ label, value, placeholder, onChange, onSave, onCancel }: {
  label: string; value: string; placeholder: string; onChange: (v: string) => void; onSave: () => void; onCancel: () => void;
}) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} onDoubleClick={e => e.stopPropagation()}>
      <textarea autoFocus aria-label={label} value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') onCancel(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSave(); } }}
        style={{ width: '100%', minHeight: 54, boxSizing: 'border-box', resize: 'vertical', border: 0, outline: 'none', borderRadius: radius.md, padding: '7px 9px', background: tk.bg.field, color: tk.text.primary, font: `12.5px/1.45 ${fontFamily.ui}` }} />
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={{ border: 0, background: 'none', color: tk.text.muted, cursor: 'pointer', font: `500 11.5px ${fontFamily.ui}` }}>Cancel</button>
        <button type="button" onClick={onSave} title="Save (⌘↵)" style={{ border: 0, borderRadius: radius.sm, background: tk.accent.base, color: '#fff', cursor: 'pointer', padding: '3px 10px', font: `600 11.5px ${fontFamily.ui}` }}>Save</button>
      </div>
    </div>
  );
}
