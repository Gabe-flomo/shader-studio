/**
 * The typed-in table: a small spreadsheet for a dataset whose source is
 * `manual` (docs/data-layer-plan.md, milestone 6).
 *
 *  - Columns: rename (click the name), retype (number, category, text),
 *    insert, move and delete from the column's menu; + adds one at the end.
 *  - Rows: insert, move (also ⌥↑/↓) and delete from the row number's menu;
 *    Enter on the last row adds one.
 *  - Keys: arrows move (Shift extends), Tab / Shift+Tab across, Enter or
 *    typing edits, Esc cancels, Delete clears, ⌘/Ctrl+Z undo, ⇧⌘Z redo.
 *  - Paste a block from Excel or Google Sheets: it lands at the selected
 *    cell and the table grows to fit (new columns typed from what came in);
 *    into an empty table, a first row of names becomes the column names.
 *
 * Every change goes to `onChange` (the dataset's source), which reruns the
 * notebook, so the result feeds everything else as a file's would. The
 * undo here is the sheet's own: dataset edits aren't in the graph's undo.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Menu, type MenuItem } from '../ui/Menu';
import { toast } from '../ui/toastStore';
import {
  addColumn, addRows, cellReads, clearCells, copyBlock, deleteColumn, deleteRows, moveColumn, moveRow, pasteBlock,
  renameColumn, retypeColumn, setCell, type ManualTable,
} from '../../data/manualTable';
import type { ManualColumnType } from '../../data/types';

const TYPE_LABEL: Record<ManualColumnType, string> = { number: 'Number', category: 'Category', text: 'Text' };
const HISTORY = 100;

interface Sel { r: number; c: number }

export function ManualSheet({ table, onChange, narrow = false }: { table: ManualTable; onChange: (t: ManualTable) => void; narrow?: boolean }) {
  const tk = useTokens();
  const ROW_H = narrow ? 36 : 30;
  const COL_W = narrow ? 120 : 136;
  const GUTTER = narrow ? 40 : 44;
  const VIEW_H = narrow ? 320 : 360;

  const gridRef = useRef<HTMLDivElement>(null);
  /** Holds the focus between edits: typing into it (keys, IME, dictation) starts editing the selected cell. */
  const keysRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [sel, setSel] = useState<Sel>({ r: 0, c: 0 });
  const [ext, setExt] = useState<Sel | null>(null);
  const [edit, setEdit] = useState<{ r: number; c: number; draft: string } | null>(null);
  const [rename, setRename] = useState<{ c: number; draft: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [focused, setFocused] = useState(false);

  // ── Undo ────────────────────────────────────────────────────────────────
  const past = useRef<ManualTable[]>([]);
  const future = useRef<ManualTable[]>([]);
  const [, bump] = useState(0);
  const tableRef = useRef(table);
  useEffect(() => { tableRef.current = table; }, [table]);
  const commit = useCallback((next: ManualTable) => {
    const cur = tableRef.current;
    if (next === cur) return;
    past.current = [...past.current.slice(-HISTORY + 1), cur];
    future.current = [];
    tableRef.current = next;
    onChange(next);
    bump(n => n + 1);
  }, [onChange]);
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(tableRef.current);
    tableRef.current = prev;
    onChange(prev);
    bump(n => n + 1);
  }, [onChange]);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(tableRef.current);
    tableRef.current = next;
    onChange(next);
    bump(n => n + 1);
  }, [onChange]);

  const nRows = table.rows.length, nCols = table.columns.length;
  // Keep the selection inside the table as it shrinks.
  const cur: Sel = { r: Math.max(0, Math.min(sel.r, nRows - 1)), c: Math.max(0, Math.min(sel.c, nCols - 1)) };
  const range = useMemo(() => {
    const e = ext ?? cur;
    return { r0: Math.min(cur.r, e.r), r1: Math.max(cur.r, e.r), c0: Math.min(cur.c, e.c), c1: Math.max(cur.c, e.c) };
  }, [cur.r, cur.c, ext]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusGrid = () => requestAnimationFrame(() => keysRef.current?.focus({ preventScroll: true }));

  // Scroll the selected cell into view.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const top = cur.r * ROW_H, bottom = top + ROW_H, head = ROW_H + 4;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom + head > el.scrollTop + el.clientHeight) el.scrollTop = bottom + head - el.clientHeight;
    const left = GUTTER + cur.c * COL_W, right = left + COL_W;
    if (left - GUTTER < el.scrollLeft) el.scrollLeft = left - GUTTER;
    else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth;
  }, [cur.r, cur.c, ROW_H, COL_W, GUTTER]);

  useEffect(() => { if (edit) inputRef.current?.focus(); }, [edit]);

  const move = (r: number, c: number) => {
    setExt(null);
    setSel({ r: Math.max(0, Math.min(nRows - 1, r)), c: Math.max(0, Math.min(nCols - 1, c)) });
  };
  /** Shift+arrow: the selected cell stays the anchor; the range's far corner moves. */
  const moveExtend = (dr: number, dc: number) => {
    const tip = ext ?? cur;
    setExt({ r: Math.max(0, Math.min(nRows - 1, tip.r + dr)), c: Math.max(0, Math.min(nCols - 1, tip.c + dc)) });
  };

  const startEdit = (r: number, c: number, draft?: string) => {
    if (!table.rows[r] || !table.columns[c]) return;
    setExt(null);
    setSel({ r, c });
    setEdit({ r, c, draft: draft ?? table.rows[r][c] });
  };

  /** Save the cell being edited, then go (dr, dc); past the last row a row is added. */
  const finishEdit = (dr: number, dc: number) => {
    if (!edit) return;
    let t = setCell(tableRef.current, edit.r, edit.c, edit.draft.trim() === '' ? '' : edit.draft);
    let r = edit.r + dr, c = edit.c + dc;
    if (c >= nCols) { c = 0; r++; }
    if (c < 0) { c = nCols - 1; r--; }
    if (r >= t.rows.length && (dr > 0 || dc > 0)) t = addRows(t);
    commit(t);
    setEdit(null);
    setSel({ r: Math.max(0, r), c: Math.max(0, c) });
    focusGrid();
  };

  const paste = (text: string) => {
    const res = pasteBlock(tableRef.current, cur.r, cur.c, text);
    if (!res.rows) return;
    commit(res.table);
    setSel({ r: res.header ? 0 : cur.r, c: res.header ? 0 : cur.c });
    setExt({ r: (res.header ? 0 : cur.r) + res.rows - 1, c: (res.header ? 0 : cur.c) + res.columns - 1 });
    toast.success(`Pasted ${res.rows} row${res.rows === 1 ? '' : 's'} × ${res.columns} column${res.columns === 1 ? '' : 's'}`, {
      message: res.header ? 'The first row became the column names; each column’s type was read from its values.' : undefined,
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (edit || rename) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); e.stopPropagation(); redo(); return; }
    if (mod) return; // copy / paste arrive as events
    if (!nRows || !nCols) return;
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        if (e.altKey) { if (cur.r > 0) { commit(moveRow(tableRef.current, cur.r, cur.r - 1)); move(cur.r - 1, cur.c); } return; }
        if (e.shiftKey) moveExtend(-1, 0); else move(cur.r - 1, cur.c);
        return;
      case 'ArrowDown':
        e.preventDefault();
        if (e.altKey) { if (cur.r < nRows - 1) { commit(moveRow(tableRef.current, cur.r, cur.r + 1)); move(cur.r + 1, cur.c); } return; }
        if (e.shiftKey) moveExtend(1, 0); else move(cur.r + 1, cur.c);
        return;
      case 'ArrowLeft': e.preventDefault(); if (e.shiftKey) moveExtend(0, -1); else move(cur.r, cur.c - 1); return;
      case 'ArrowRight': e.preventDefault(); if (e.shiftKey) moveExtend(0, 1); else move(cur.r, cur.c + 1); return;
      case 'Tab': {
        e.preventDefault();
        let r = cur.r, c = cur.c + (e.shiftKey ? -1 : 1);
        if (c >= nCols) { c = 0; r = Math.min(nRows - 1, r + 1); }
        if (c < 0) { c = nCols - 1; r = Math.max(0, r - 1); }
        move(r, c);
        return;
      }
      case 'Enter': case 'F2': e.preventDefault(); startEdit(cur.r, cur.c); return;
      case 'Backspace': case 'Delete': e.preventDefault(); commit(clearCells(tableRef.current, range.r0, range.c0, range.r1, range.c1)); return;
      case 'Escape': if (ext) { e.preventDefault(); e.stopPropagation(); setExt(null); } return;
      case 'Home': e.preventDefault(); move(cur.r, 0); return;
      case 'End': e.preventDefault(); move(cur.r, nCols - 1); return;
      // Other keys type into the focus holder, which starts the edit (onChange below).
    }
  };

  const onEditKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'Enter': e.preventDefault(); finishEdit(e.shiftKey ? -1 : 1, 0); return;
      case 'Tab': e.preventDefault(); finishEdit(0, e.shiftKey ? -1 : 1); return;
      case 'ArrowUp': e.preventDefault(); finishEdit(-1, 0); return;
      case 'ArrowDown': e.preventDefault(); finishEdit(1, 0); return;
      case 'Escape': e.preventDefault(); e.stopPropagation(); setEdit(null); focusGrid(); return;
    }
  };

  // ── Menus ───────────────────────────────────────────────────────────────
  const openAt = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: e.type === 'contextmenu' ? e.clientX : r.left, y: e.type === 'contextmenu' ? e.clientY : r.bottom + 4, items });
  };
  const columnMenu = (c: number): MenuItem[] => [
    { label: 'Rename…', icon: 'edit', onSelect: () => setRename({ c, draft: table.columns[c].name }) },
    { heading: 'Type' },
    ...(['number', 'category', 'text'] as ManualColumnType[]).map(t => ({
      label: TYPE_LABEL[t], icon: table.columns[c].type === t ? 'check' as const : undefined,
      hint: t === 'number' ? 'Read as numbers' : t === 'category' ? 'A few repeated values' : 'Labels and notes',
      onSelect: () => commit(retypeColumn(tableRef.current, c, t)),
    })),
    'separator',
    { label: 'Insert column left', icon: 'plus', onSelect: () => { commit(addColumn(tableRef.current, c)); move(cur.r, c); } },
    { label: 'Insert column right', icon: 'plus', onSelect: () => { commit(addColumn(tableRef.current, c + 1)); move(cur.r, c + 1); } },
    { label: 'Move left', icon: 'chevL', disabled: c === 0, onSelect: () => { commit(moveColumn(tableRef.current, c, c - 1)); move(cur.r, c - 1); } },
    { label: 'Move right', icon: 'chevR', disabled: c === nCols - 1, onSelect: () => { commit(moveColumn(tableRef.current, c, c + 1)); move(cur.r, c + 1); } },
    'separator',
    { label: 'Delete column', icon: 'trash', danger: true, disabled: nCols <= 1, onSelect: () => commit(deleteColumn(tableRef.current, c)) },
  ];
  const rowMenu = (r: number): MenuItem[] => {
    const many = range.r1 > range.r0 && r >= range.r0 && r <= range.r1;
    return [
      { label: 'Insert row above', icon: 'plus', onSelect: () => { commit(addRows(tableRef.current, r)); move(r, cur.c); } },
      { label: 'Insert row below', icon: 'plus', onSelect: () => { commit(addRows(tableRef.current, r + 1)); move(r + 1, cur.c); } },
      { label: 'Move up', icon: 'chevU', hint: '⌥↑', disabled: r === 0, onSelect: () => { commit(moveRow(tableRef.current, r, r - 1)); move(r - 1, cur.c); } },
      { label: 'Move down', icon: 'chevD', hint: '⌥↓', disabled: r === nRows - 1, onSelect: () => { commit(moveRow(tableRef.current, r, r + 1)); move(r + 1, cur.c); } },
      'separator',
      many
        ? { label: `Delete rows ${range.r0 + 1}–${range.r1 + 1}`, icon: 'trash', danger: true, onSelect: () => { commit(deleteRows(tableRef.current, range.r0, range.r1)); move(range.r0, cur.c); } }
        : { label: 'Delete row', icon: 'trash', danger: true, onSelect: () => { commit(deleteRows(tableRef.current, r)); move(r, cur.c); } },
    ];
  };

  const saveRename = () => {
    if (!rename) return;
    commit(renameColumn(tableRef.current, rename.c, rename.draft));
    setRename(null);
    focusGrid();
  };

  const pasteFromClipboard = async () => {
    try { paste(await navigator.clipboard.readText()); } catch {
      toast.info('Paste with the keyboard', { message: 'This browser won’t hand the clipboard to a button. Select a cell and press ⌘V (Ctrl+V).' });
    }
  };

  // ── Rows in view (the table can be thousands of rows long) ─────────────
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 6);
  const last = Math.min(nRows, first + Math.ceil(VIEW_H / ROW_H) + 12);
  const width = GUTTER + nCols * COL_W + 44;

  const invalidCount = useMemo(() => {
    let n = 0;
    table.columns.forEach((col, j) => { if (col.type === 'number') for (const row of table.rows) if (!cellReads('number', row[j] ?? '')) n++; });
    return n;
  }, [table]);

  const headCell = { height: ROW_H + 4, boxSizing: 'border-box' as const, borderBottom: `1px solid ${tk.border.default}`, background: tk.bg.subtle };
  const typeDot = (t: ManualColumnType) => (t === 'number' ? tk.accent.base : t === 'category' ? tk.kind.expr : tk.text.faint);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <IconButton size="sm" icon="undo" label="Undo" shortcut="mod+z" disabled={!past.current.length} onClick={() => { undo(); focusGrid(); }} />
        <IconButton size="sm" icon="redo" label="Redo" shortcut="shift+mod+z" disabled={!future.current.length} onClick={() => { redo(); focusGrid(); }} />
        <span style={{ width: 1, height: 18, background: tk.border.default, margin: '0 2px' }} />
        <Button size="sm" variant="ghost" icon="plus" onClick={() => { commit(addRows(tableRef.current)); move(nRows, cur.c); focusGrid(); }}>Row</Button>
        <Button size="sm" variant="ghost" icon="plus" onClick={() => { commit(addColumn(tableRef.current)); move(cur.r, nCols); focusGrid(); }}>Column</Button>
        {narrow && <Button size="sm" variant="ghost" icon="copy" onClick={() => { void pasteFromClipboard(); }}>Paste</Button>}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: tk.text.faint, whiteSpace: 'nowrap' }}>
          {nRows.toLocaleString()} row{nRows === 1 ? '' : 's'} × {nCols} column{nCols === 1 ? '' : 's'}
        </span>
      </div>

      <div
        ref={gridRef}
        role="grid"
        aria-label="Typed-in table"
        aria-rowcount={nRows + 1}
        aria-colcount={nCols}
        // Esc cancels an edit or a range here instead of closing the window.
        data-captures-escape={edit || rename || ext ? '' : undefined}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}
        onPaste={e => { if (edit || rename) return; const text = e.clipboardData.getData('text/plain'); if (text) { e.preventDefault(); paste(text); } }}
        onCopy={e => { if (edit || rename || !nRows) return; e.preventDefault(); e.clipboardData.setData('text/plain', copyBlock(tableRef.current, range.r0, range.c0, range.r1, range.c1)); }}
        onCut={e => { if (edit || rename || !nRows) return; e.preventDefault(); e.clipboardData.setData('text/plain', copyBlock(tableRef.current, range.r0, range.c0, range.r1, range.c1)); commit(clearCells(tableRef.current, range.r0, range.c0, range.r1, range.c1)); }}
        style={{ position: 'relative', outline: 'none', borderRadius: radius.md, boxShadow: `inset 0 0 0 1px ${focused ? alpha(tk.accent.base, 0.5) : tk.border.default}`, background: tk.bg.panel, overflow: 'hidden' }}
      >
        <input ref={keysRef} aria-label="Typed-in table: type to edit the selected cell, arrows to move" value="" autoComplete="off" spellCheck={false}
          onChange={e => { const v = e.target.value; if (v && !edit && nRows && nCols) startEdit(cur.r, cur.c, v); }}
          style={{ position: 'absolute', width: 1, height: 1, padding: 0, border: 0, opacity: 0, pointerEvents: 'none', left: 0, top: 0 }} />
        <div ref={scrollRef} onScroll={e => setScrollTop(e.currentTarget.scrollTop)} style={{ overflow: 'auto', maxHeight: VIEW_H, position: 'relative' }}>
          <div style={{ width, minWidth: '100%', font: `500 12px ${fontFamily.ui}`, color: tk.text.primary }}>
            {/* Header */}
            <div role="row" style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 2 }}>
              <div style={{ ...headCell, width: GUTTER, flexShrink: 0, position: 'sticky', left: 0, zIndex: 1, borderRight: `1px solid ${tk.border.subtle}` }} />
              {table.columns.map((col, c) => (
                <div key={c} role="columnheader" onContextMenu={e => openAt(e, columnMenu(c))}
                  style={{ ...headCell, width: COL_W, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, padding: '0 4px 0 8px', borderRight: `1px solid ${tk.border.subtle}`, background: range.c0 <= c && c <= range.c1 && focused ? alpha(tk.accent.base, 0.07) : tk.bg.subtle }}>
                  <span title={TYPE_LABEL[col.type]} style={{ width: 7, height: 7, borderRadius: '50%', background: typeDot(col.type), flexShrink: 0 }} />
                  {rename?.c === c ? (
                    <input autoFocus aria-label="Column name" value={rename.draft} onChange={e => setRename({ c, draft: e.target.value })}
                      onBlur={saveRename}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveRename(); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setRename(null); focusGrid(); } }}
                      style={{ flex: 1, minWidth: 0, height: 24, border: 0, outline: 'none', borderRadius: 5, padding: '0 6px', background: tk.bg.panel, boxShadow: `inset 0 0 0 1.5px ${tk.accent.base}`, color: tk.text.primary, font: `600 12px ${fontFamily.mono}` }} />
                  ) : (
                    <button type="button" onClick={() => setRename({ c, draft: col.name })} title="Rename"
                      style={{ flex: 1, minWidth: 0, border: 0, background: 'none', padding: 0, textAlign: 'left', cursor: 'text', color: tk.text.primary, font: `600 12px ${fontFamily.mono}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {col.name}
                    </button>
                  )}
                  <button type="button" aria-label={`${col.name}: type and column actions`} onClick={e => openAt(e, columnMenu(c))}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 2, height: 22, padding: '0 4px 0 6px', border: 0, borderRadius: 5, background: 'transparent', color: tk.text.faint, font: `500 10.5px ${fontFamily.ui}`, cursor: 'pointer', flexShrink: 0 }}>
                    {narrow ? '' : TYPE_LABEL[col.type].toLowerCase()}<Icon name="chevD" size={12} />
                  </button>
                </div>
              ))}
              <div style={{ ...headCell, width: 44, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <IconButton size="sm" icon="plus" label="Add column" onClick={() => { commit(addColumn(tableRef.current)); move(cur.r, nCols); focusGrid(); }} />
              </div>
            </div>

            {/* Body */}
            <div style={{ height: nRows * ROW_H, position: 'relative' }}>
              {Array.from({ length: last - first }, (_, k) => {
                const r = first + k;
                const row = table.rows[r];
                const rowSel = focused && r >= range.r0 && r <= range.r1;
                return (
                  <div key={r} role="row" style={{ display: 'flex', position: 'absolute', top: r * ROW_H, left: 0, right: 0, height: ROW_H }}>
                    <button type="button" aria-label={`Row ${r + 1} actions`} onClick={e => { move(r, cur.c); openAt(e, rowMenu(r)); }} onContextMenu={e => openAt(e, rowMenu(r))}
                      style={{ width: GUTTER, flexShrink: 0, position: 'sticky', left: 0, zIndex: 1, border: 0, borderRight: `1px solid ${tk.border.subtle}`, borderBottom: `1px solid ${tk.border.subtle}`, background: rowSel ? alpha(tk.accent.base, 0.1) : tk.bg.subtle, color: rowSel ? tk.accent.text : tk.text.faint, font: `500 11px ${fontFamily.mono}`, cursor: 'pointer', padding: 0 }}>
                      {r + 1}
                    </button>
                    {table.columns.map((col, c) => {
                      const raw = row[c] ?? '';
                      const isSel = cur.r === r && cur.c === c;
                      const inRange = r >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1 && (range.r1 > range.r0 || range.c1 > range.c0);
                      const bad = col.type === 'number' && !cellReads('number', raw);
                      const editing = edit && edit.r === r && edit.c === c;
                      return (
                        <div key={c} role="gridcell" aria-selected={isSel}
                          onMouseDown={e => {
                            if (editing) return;
                            e.preventDefault();
                            // Phones have no keys to start typing with: a tap on the selected cell edits it.
                            if (narrow && isSel && !e.shiftKey) { startEdit(r, c); return; }
                            if (edit) finishEdit(0, 0);
                            if (e.shiftKey) { setExt({ r, c }); } else move(r, c);
                            keysRef.current?.focus({ preventScroll: true });
                          }}
                          onDoubleClick={() => startEdit(r, c)}
                          title={bad ? `“${raw}” isn’t a number: it reads as empty` : undefined}
                          style={{
                            width: COL_W, flexShrink: 0, boxSizing: 'border-box', height: ROW_H, position: 'relative',
                            borderRight: `1px solid ${tk.border.subtle}`, borderBottom: `1px solid ${tk.border.subtle}`,
                            background: bad ? alpha(tk.status.danger, 0.07) : inRange && focused ? alpha(tk.accent.base, 0.08) : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: col.type === 'number' ? 'flex-end' : 'flex-start',
                            padding: '0 8px', cursor: 'cell',
                            font: col.type === 'number' ? `500 12px ${fontFamily.mono}` : `500 12.5px ${fontFamily.ui}`,
                            color: bad ? tk.status.danger : tk.text.primary,
                          }}>
                          {editing ? (
                            <input ref={inputRef} aria-label={`${col.name}, row ${r + 1}`} value={edit.draft}
                              onChange={e => setEdit({ ...edit, draft: e.target.value })}
                              onKeyDown={onEditKey}
                              onBlur={() => { if (edit) finishEdit(0, 0); }}
                              inputMode={col.type === 'number' && narrow ? 'decimal' : undefined}
                              style={{ position: 'absolute', inset: 0, width: '100%', boxSizing: 'border-box', border: 0, outline: 'none', padding: '0 7px', background: tk.bg.panel, boxShadow: `inset 0 0 0 2px ${tk.accent.base}`, color: tk.text.primary, font: 'inherit', textAlign: col.type === 'number' ? 'right' : 'left', borderRadius: 2 }} />
                          ) : (
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{raw}</span>
                          )}
                          {isSel && !editing && (
                            <span aria-hidden style={{ position: 'absolute', inset: -1, boxShadow: `inset 0 0 0 2px ${focused ? tk.accent.base : tk.border.strong}`, borderRadius: 2, pointerEvents: 'none' }} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <button type="button" onClick={() => { commit(addRows(tableRef.current)); move(nRows, cur.c); focusGrid(); }}
          style={{ width: '100%', height: narrow ? 38 : 32, border: 0, borderTop: `1px solid ${tk.border.subtle}`, background: tk.bg.subtle, color: tk.text.muted, font: `500 12px ${fontFamily.ui}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Icon name="plus" size={13} /> Add row
        </button>
      </div>

      <span style={{ fontSize: 11.5, color: invalidCount ? tk.status.danger : tk.text.faint, lineHeight: 1.45 }}>
        {invalidCount
          ? `${invalidCount} cell${invalidCount === 1 ? '' : 's'} in number columns ${invalidCount === 1 ? 'isn’t a number and reads' : 'aren’t numbers and read'} as empty (shown in red). Fix them, or make the column Text.`
          : narrow
            ? 'Tap a cell to select it, tap it again to type. Paste adds a block copied from a spreadsheet.'
            : 'Click a cell and type; Enter and Tab move on. Paste a block copied from Excel or Google Sheets: the table grows to fit.'}
      </span>
      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
