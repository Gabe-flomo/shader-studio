/**
 * playSetupMenu.tsx — the Play setup's own actions, in one ⋯ menu (Play page
 * audit P2/P15): Open Play setup, Import and Export a .play, Put it on a
 * website, and Clear Play setup. They live in the split panel's header ⋯
 * (PlaySplitArea.tsx); where there's no panel (a phone, the split closed)
 * the Controls ⋯ carries them instead (PlayPage.tsx), so each is offered in
 * exactly one place on screen.
 *
 * The dialogs they open (the website dialog, the list of Play setups) are
 * drawn by one host, PlaySetupDialogs, which PlayPage renders, so a menu in
 * the panel and a menu in the page open the same ones.
 */
import { create } from 'zustand';
import { useMemo } from 'react';
import { can, requireFeature } from '../../lib/plan';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { offerPlayExport } from '../playfile/exportMenus';
import { reportFileResult } from '../shell/reportFileResult';
import type { MenuItem } from '../ui/Menu';
import { Popover } from '../ui/Popover';
import { Sheet } from '../ui/Sheet';
import { EmbedDialog } from './EmbedDialog';
import { PlayableList } from './OpenPlayable';
import { startOverMenuItem } from '../../play/startOver';

interface SetupDialogs {
  embed: boolean;
  /** The list of Play setups, open beside this element (the ⋯ that asked), or as a sheet on phones. */
  setups: HTMLElement | null;
  setupsSheet: boolean;
}

export const usePlaySetupDialogs = create<SetupDialogs>(() => ({ embed: false, setups: null, setupsSheet: false }));

/**
 * The setup menu's items. `close` closes the menu first; `anchor` is the ⋯
 * button (where the list of setups and the export choices open); `sheet`
 * opens the list of setups as a sheet (phones).
 */
export function playSetupItems({ close, anchor, sheet = false }: { close: () => void; anchor: HTMLElement | null; sheet?: boolean }): MenuItem[] {
  const st = useNodeGraphStore.getState();
  const hasControls = st.play.controls.length > 0;
  const websiteOk = can('export.website');
  return [
    {
      label: 'Open Play setup…', icon: 'folder', hint: 'A saved graph or example that has a Play setup',
      onSelect: () => { close(); usePlaySetupDialogs.setState({ setups: anchor ?? document.body, setupsSheet: sheet }); },
    },
    {
      label: 'Import .play…', icon: 'import', hint: 'A graph with its Play panel and mappings',
      onSelect: () => { close(); void st.importGraphFromFile().then(r => reportFileResult(r, { failTitle: 'Couldn’t import that file' })); },
    },
    {
      label: 'Export .play…', icon: 'export', disabled: !hasControls, hint: hasControls ? 'The graph, the panel and the mappings, exactly as they are now' : 'Add a control first',
      onSelect: () => { close(); offerPlayExport(anchor); },
    },
    {
      label: `Put it on a website…${websiteOk ? '' : ' (Pro)'}`, icon: 'code', hint: 'A player with controls, or the picture as a background, as a snippet or a page',
      onSelect: () => { close(); if (requireFeature('export.website')) usePlaySetupDialogs.setState({ embed: true }); },
    },
    'separator',
    startOverMenuItem(close),
  ];
}

/** The dialogs the setup menu opens. PlayPage renders it once. */
export function PlaySetupDialogs() {
  const embed = usePlaySetupDialogs(s => s.embed);
  const setups = usePlaySetupDialogs(s => s.setups);
  const sheet = usePlaySetupDialogs(s => s.setupsSheet);
  const anchorRef = useMemo(() => ({ current: setups }), [setups]);
  const closeSetups = () => usePlaySetupDialogs.setState({ setups: null });
  return (
    <>
      {embed && <EmbedDialog onClose={() => usePlaySetupDialogs.setState({ embed: false })} />}
      {setups && (sheet ? (
        <Sheet title="Open a Play setup" onClose={closeSetups} maxHeight="75dvh">
          <PlayableList onDone={closeSetups} />
        </Sheet>
      ) : (
        <Popover anchorRef={anchorRef} onClose={closeSetups} align="end" width={360} padding={0}>
          <div style={{ maxHeight: 'min(70vh, 560px)', display: 'flex', flexDirection: 'column' }}>
            <PlayableList onDone={closeSetups} />
          </div>
        </Popover>
      ))}
    </>
  );
}
