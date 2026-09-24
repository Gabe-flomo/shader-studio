import { useRef, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useThemeStore, useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { loadShortcutMap } from '../../hooks/useShortcuts';
import type { Page } from '../TopNav';
import { Button, IconButton } from '../ui/Button';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { Tooltip } from '../ui/Tooltip';
import { reportFileResult } from './reportFileResult';

const TABS: { page: Page; label: string }[] = [
  { page: 'studio', label: 'Studio' },
  { page: 'fn', label: 'Builder' },
  { page: 'glsl', label: 'GLSL' },
  { page: 'shortcuts', label: 'Keys' },
];

/**
 * Desktop top bar (redesign): brand, page tabs, and the graph-level actions that used to hide
 * in the canvas "···" menu — undo/redo, save/load by name, theme, import/export, record.
 * Mobile and tablet keep TopNav until their own phase.
 */
export function DesktopTopNav({ page, onPageChange, onRecord }: {
  page: Page;
  onPageChange: (page: Page) => void;
  onRecord: () => void;
}) {
  const tk = useTokens();
  const mode = useThemeStore(s => s.mode);
  const toggleTheme = useThemeStore(s => s.toggle);
  const undo = useNodeGraphStore(s => s.undo);
  const redo = useNodeGraphStore(s => s.redo);
  const exportGraph = useNodeGraphStore(s => s.exportGraph);
  const importGraphFromFile = useNodeGraphStore(s => s.importGraphFromFile);
  // Shortcut labels follow the user's rebinding on the Keys page.
  const [shortcuts] = useState(loadShortcutMap);

  return (
    <div
      style={{
        height: 56, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px 0 18px',
        background: tk.bg.panel, borderBottom: `1px solid ${tk.border.default}`, color: tk.text.primary,
        font: `12.5px ${fontFamily.ui}`, userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: 250, flexShrink: 0 }}>
        <span style={{ width: 26, height: 26, borderRadius: radius.md, background: tk.ink.base, color: tk.ink.text, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="presets" size={13} />
        </span>
        <span style={{ fontWeight: 700, fontSize: 14.5, letterSpacing: '-0.01em' }}>Shader Studio</span>
      </div>

      <div role="tablist" style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 10, background: tk.bg.hover }}>
        {TABS.map(t => {
          const on = page === t.page;
          return (
            <button
              key={t.page}
              role="tab"
              aria-selected={on}
              onClick={() => onPageChange(t.page)}
              style={{
                padding: '6px 14px', borderRadius: 7, border: 0, cursor: 'pointer',
                background: on ? tk.bg.panel : 'transparent', boxShadow: on ? '0 1px 2px rgba(20,20,30,0.1)' : 'none',
                color: on ? tk.text.primary : tk.text.faint, font: `${on ? 600 : 500} 13px ${fontFamily.ui}`,
              }}
            >{t.label}</button>
          );
        })}
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
        <IconButton icon="undo" label="Undo" shortcut={shortcuts.undo} onClick={undo} />
        <IconButton icon="redo" label="Redo" onClick={redo} />
        <Divider />
        <SaveGraphButton />
        <LoadGraphButton />
        <Divider />
        <IconButton
          icon={mode === 'light' ? 'moon' : 'sun'}
          label={mode === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
          onClick={toggleTheme}
        />
        <Divider />
        <Tooltip label="Import a graph file" shortcut={shortcuts.import}>
          <Button size="sm" icon="import" onClick={async () => { reportFileResult(await importGraphFromFile(), { failTitle: 'Couldn’t import that file' }); }}>Import</Button>
        </Tooltip>
        <Tooltip label="Export this graph to a file" shortcut={shortcuts.export}>
          <Button size="sm" icon="export" onClick={async () => { reportFileResult(await exportGraph(), { failTitle: 'Couldn’t export the graph', success: 'Graph exported' }); }}>Export</Button>
        </Tooltip>
        <Tooltip label="Record the preview as video or a still" shortcut={shortcuts.toggleRecord}>
          <button
            type="button"
            onClick={onRecord}
            style={{
              height: 32, marginLeft: 4, padding: '0 13px 0 11px', border: 0, borderRadius: radius.control, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 7, background: tk.ink.base, color: tk.ink.text,
              font: `600 12.5px ${fontFamily.ui}`,
            }}
          >
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: tk.status.danger, boxShadow: `0 0 0 3px ${alpha(tk.status.danger, 0.25)}` }} />
            Record
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function Divider() {
  const tk = useTokens();
  return <span style={{ width: 1, height: 20, background: tk.border.default, margin: '0 6px', flexShrink: 0 }} />;
}

function SaveGraphButton() {
  const saveGraph = useNodeGraphStore(s => s.saveGraph);
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const save = async () => {
    const n = name.trim();
    if (!n) return;
    // On failure the popover stays open so the name isn't lost.
    if (!reportFileResult(await saveGraph(n), { failTitle: `Couldn’t save “${n}”`, success: `Saved “${n}”` })) return;
    setName('');
    setOpen(false);
  };
  return (
    <span ref={anchor} style={{ display: 'inline-flex' }}>
      <IconButton icon="save" label="Save graph" active={open} tooltip={!open} onClick={() => setOpen(o => !o)} />
      {open && (
        <Popover anchorRef={anchor} onClose={() => setOpen(false)} align="end" width={280} padding={10}>
          <div style={{ display: 'flex', gap: 6 }}>
            <Field
              autoFocus
              placeholder="Graph name"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save(); }}
              height={32}
              style={{ flex: 1 }}
            />
            <Button size="sm" variant="primary" disabled={!name.trim()} onClick={save}>Save</Button>
          </div>
        </Popover>
      )}
    </span>
  );
}

function LoadGraphButton() {
  const tk = useTokens();
  const getSavedGraphNames = useNodeGraphStore(s => s.getSavedGraphNames);
  const loadSavedGraph = useNodeGraphStore(s => s.loadSavedGraph);
  const deleteSavedGraph = useNodeGraphStore(s => s.deleteSavedGraph);
  const anchor = useRef<HTMLSpanElement>(null);
  const [names, setNames] = useState<string[] | null>(null);
  const toggle = () => setNames(n => (n ? null : getSavedGraphNames()));
  return (
    <span ref={anchor} style={{ display: 'inline-flex' }}>
      <IconButton icon="folder" label="Load a saved graph" active={!!names} tooltip={!names} onClick={toggle} />
      {names && (
        <Popover anchorRef={anchor} onClose={() => setNames(null)} align="end" width={260}>
          {names.length === 0 ? (
            <div style={{ padding: '10px 10px', color: tk.text.faint }}>No saved graphs yet.</div>
          ) : names.map(n => (
            <LoadRow
              key={n}
              name={n}
              onLoad={() => { reportFileResult(loadSavedGraph(n), { failTitle: `Couldn’t open “${n}”` }); setNames(null); }}
              onDelete={() => { deleteSavedGraph(n); setNames(getSavedGraphNames()); }}
            />
          ))}
        </Popover>
      )}
    </span>
  );
}

function LoadRow({ name, onLoad, onDelete }: { name: string; onLoad: () => void; onDelete: () => void }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 4, height: 32, padding: '0 2px 0 8px', borderRadius: radius.md, background: hover ? tk.bg.field : 'transparent' }}
    >
      <button
        type="button"
        onClick={onLoad}
        style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.text.primary, font: `12.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >{name}</button>
      {hover && <IconButton icon="trash" label={`Delete “${name}”`} size="sm" tone="danger" tooltip={false} onClick={onDelete} />}
    </div>
  );
}
