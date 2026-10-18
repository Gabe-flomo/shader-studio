import { offerGraphExport } from '../playfile/exportMenus';
import { useRef, useState } from 'react';
import { rebuildWithToast } from './rebuildAction';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useThemeStore, useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { isCodePage, type Page } from '../page';
import { openAppSettings, openNodesReference } from './appDialogStore';
import { IconButton } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { Menu } from '../ui/Menu';
import { LoadGraphButton, SaveGraphButton } from './DesktopTopNav';
import { reportGlslImport } from './reportFileResult';
import { importAnyFile } from './importAnyFile';
import { isPlayRecordEmpty } from '../../types/play';
import { exportEverything, importEverything } from '../../utils/libraryActions';
import { Modal } from '../ui/Modal';
import { LibraryPanel } from './LibraryPanel';
import { Library } from '../library/Library';
import { HandsLive } from '../play/HandsChip';
import { KeyboardPill } from '../play/engine/KeyboardPill';
import { canOn, usePlan, type Feature } from '../../lib/plan';
import { accountMenuItems } from '../account/accountMenu';
import { rotateFullscreenLabel, useRotateFullscreen } from '../../lib/rotateFullscreen';
import { useLearnUi } from '../learn/learnStore';

/**
 * Phone top bar (Mobile board): the Studio | Play | Present switch (other pages: the logo, back
 * to the Studio, and the page's name), undo/redo and save/load for the graph (not on Present,
 * which has its own file actions), and a ⋯ menu with the rest — Keys, Record, Import, Export and
 * the theme. Grows by the status-bar inset. Fits a 360px phone.
 */
export function MobileTopBar({ page, onPageChange, onRecord, onClear }: {
  page: Page;
  onPageChange: (page: Page) => void;
  onRecord: () => void;
  /** Studio only: a new graph, from the Scene builder or empty (asks first: NewGraphSheet). */
  onClear?: () => void;
}) {
  const tk = useTokens();
  const mode = useThemeStore(s => s.mode);
  const toggleTheme = useThemeStore(s => s.toggle);
  const undo = useNodeGraphStore(s => s.undo);
  const redo = useNodeGraphStore(s => s.redo);
  const importGlslFromFile = useNodeGraphStore(s => s.importGlslFromFile);
  const hasPlay = useNodeGraphStore(s => !isPlayRecordEmpty(s.play));
  const moreRef = useRef<HTMLSpanElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [library, setLibrary] = useState(false);
  const [storage, setStorage] = useState(false);
  const session = usePlan(s => s.session);
  const rotate = useRotateFullscreen();
  const account = accountMenuItems(session);
  // Menu rows are plain text: locked ones say so in their label.
  const pro = (f: Feature) => (canOn(session.status === 'signed-in' ? session.plan : null, f) ? '' : ' · Pro');
  const mainPage = page === 'studio' || page === 'play' || page === 'present';

  return (
    <div style={{
      flexShrink: 0, boxSizing: 'border-box', height: 'calc(56px + env(safe-area-inset-top, 0px))',
      paddingTop: 'env(safe-area-inset-top, 0px)', paddingLeft: 'max(14px, env(safe-area-inset-left, 0px))',
      paddingRight: 'max(10px, env(safe-area-inset-right, 0px))',
      display: 'flex', alignItems: 'center', gap: 2, background: tk.bg.panel, borderBottom: `1px solid ${tk.border.default}`,
      color: tk.text.primary, font: `13px ${fontFamily.ui}`, userSelect: 'none', position: 'relative', zIndex: 30,
    }}>
      {/* On Studio, Play and Present the switch's Studio does this, and a 360px phone needs the room. */}
      {!mainPage && <button
        type="button"
        aria-label="Back to the Studio"
        onClick={() => onPageChange('studio')}
        style={{
          width: 36, height: 36, flexShrink: 0, padding: 0, border: 0, borderRadius: radius.md, cursor: 'pointer',
          background: tk.ink.base, color: tk.ink.text, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {/* A back arrow, not the logo: it reads as the way back to the Studio */}
        <Icon name="chevL" size={17} />
      </button>}
      {mainPage ? (
        // Studio, Play and Present are the app's main pages: the switch between them is always in sight.
        <span style={{ flexShrink: 0 }}>
          <Segmented
            size="sm"
            ariaLabel="Page"
            value={page}
            onChange={v => onPageChange(v)}
            options={[
              { value: 'studio', label: 'Studio' },
              { value: 'play', label: hasPlay ? 'Play •' : 'Play', title: hasPlay ? 'This graph has a Play setup' : 'Perform this graph: controls, sources, layers' },
              { value: 'present', label: 'Present', title: 'Teach with your Plays: steps of text, pictures, sliders and code' },
            ]}
          />
        </span>
      ) : (
        <span style={{ marginLeft: 10, fontWeight: 650, fontSize: 15 }}>{page === 'shortcuts' ? 'Keys' : isCodePage(page) ? 'Code' : 'Files'}</span>
      )}
      <span style={{ flex: 1 }} />
      {/* The graph's own actions; Present has its own file actions in its header. */}
      {page !== 'present' && page !== 'files' && <>
        <KeyboardPill compact />
        <HandsLive compact />
        <IconButton icon="undo" label="Undo" tooltip={false} onClick={undo} style={{ width: 34, height: 40 }} />
        <IconButton icon="redo" label="Redo" tooltip={false} onClick={redo} style={{ width: 34, height: 40 }} />
        <span style={{ width: 1, height: 20, flexShrink: 0, background: tk.border.default, margin: '0 1px' }} />
        <SaveGraphButton compact listen />
        <LoadGraphButton />
      </>}
      <span ref={moreRef} style={{ display: 'inline-flex' }}>
        <IconButton
          icon="more"
          label="More"
          tooltip={false}
          active={!!menu}
          style={{ width: 34, height: 40 }}
          onClick={() => {
            const r = moreRef.current?.getBoundingClientRect();
            setMenu(r ? { x: r.right - 220, y: r.bottom + 6 } : null);
          }}
        />
      </span>
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          minWidth={220}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Record', icon: 'record', onSelect: onRecord },
            { label: 'Rebuild the preview', icon: 'rebuild', hint: 'Recompile the shader and reset the GPU. The graph, time and Play setup stay.', onSelect: () => { void rebuildWithToast(); } },
            page === 'play'
              ? { label: 'Back to the Studio', icon: 'nodes', onSelect: () => onPageChange('studio') }
              : { label: hasPlay ? 'Play this graph · set up' : 'Play this graph', icon: 'play', onSelect: () => onPageChange('play') },
            'separator',
            page === 'present'
              ? { label: 'Back to the Studio', icon: 'nodes', onSelect: () => onPageChange('studio') }
              : { label: 'Present', icon: 'slides', hint: 'Teach with your Plays: steps of text, pictures, sliders and code', onSelect: () => onPageChange('present') },
            { label: 'Learn the app', icon: 'book', hint: 'Lessons on the Studio, Play, Convert and more', onSelect: () => useLearnUi.getState().openLearn() },
            { label: 'Import a file', icon: 'import', hint: 'A .play file, a graph, or a .present.json (opens on Present)', onSelect: () => { void importAnyFile(onPageChange); } },
            isCodePage(page)
              ? { label: 'Back to the Studio', icon: 'nodes', onSelect: () => onPageChange('studio') }
              : { label: 'Code', icon: 'code', hint: 'Write a shader, convert GLSL to nodes, plot functions, make node packs', onSelect: () => onPageChange('code') },
            { label: 'Import shader', icon: 'code', hint: 'A GLSL fragment shader file, as a node', onSelect: async () => { reportGlslImport(await importGlslFromFile()); } },
            { label: 'Export this graph', icon: 'export', hint: 'As a .play file, with what it uses', onSelect: () => offerGraphExport(null) },
            page === 'files'
              ? { label: 'Back to the Studio', icon: 'nodes', onSelect: () => onPageChange('studio') }
              : { label: 'Files', icon: 'folder', hint: 'Everything saved: sizes, clean up, download and install', onSelect: () => onPageChange('files') },
            { label: 'Library…', icon: 'folder', hint: 'Everything you saved: graphs, presets, functions, your nodes, shaders', onSelect: () => setLibrary(true) },
            { label: 'Storage and backups…', icon: 'folder', hint: 'Backup folder, export and import, recordings', onSelect: () => setStorage(true) },
            { label: `Export everything${pro('files.everything')}`, icon: 'export', hint: 'Every graph, presentation, preset and setting as one ZIP', onSelect: () => { void exportEverything(); } },
            { label: `Import a library${pro('files.install')}`, icon: 'import', hint: 'A library ZIP: adds to what you have', onSelect: () => { void importEverything(); } },
            'separator',
            page === 'shortcuts'
              ? { label: 'Back to the Studio', icon: 'nodes', onSelect: () => onPageChange('studio') }
              : { label: 'Keyboard shortcuts', icon: 'hash', onSelect: () => onPageChange('shortcuts') },
            { label: 'Nodes reference', icon: 'nodes', hint: 'Every node type: what it does, its sockets, a live picture, its GLSL', onSelect: () => openNodesReference() },
            { label: 'App settings', icon: 'sliders', hint: 'Theme, shortcuts, panel sizes: reset any of them to its default', onSelect: openAppSettings },
            { label: mode === 'light' ? 'Dark theme' : 'Light theme', icon: mode === 'light' ? 'moon' : 'sun', onSelect: toggleTheme },
            { label: `Rotate to full screen · ${rotateFullscreenLabel(rotate.setting)}`, icon: 'phone', hint: 'Turned sideways, the picture alone fills the screen. Tap to change: Off, Play only, Always (Play and Studio)', onSelect: rotate.cycle },
            ...(onClear ? ['separator' as const, { label: 'New graph…', icon: 'plus' as const, hint: 'Start from a Scene builder, or from an empty graph', onSelect: onClear }] : []),
            ...(account.length ? ['separator' as const, ...account] : []),
          ]}
        />
      )}
      {library && (
        <Modal title="Library" subtitle="Everything you saved" icon="folder" onClose={() => setLibrary(false)} width={440}>
          <div style={{ padding: '14px 16px 18px' }}><Library size="full" onOpened={() => setLibrary(false)} /></div>
        </Modal>
      )}
      {storage && (
        <Modal title="Storage and backups" subtitle="Everything saved in this browser" icon="folder" onClose={() => setStorage(false)} width={440}>
          <div style={{ padding: '14px 16px 18px' }}><LibraryPanel inCard /></div>
        </Modal>
      )}
    </div>
  );
}
