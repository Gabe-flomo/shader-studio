/**
 * RecordingsSetting — where recordings and stills are saved (utils/
 * recordingsFolder.ts): a folder with no asking, a save dialog each time, or
 * the browser's Downloads. In the Record dialog and in the Library.
 */
import { useEffect, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { toast } from '../ui/toastStore';
import {
  allowRecordingsFolder, chooseRecordingsFolder, onRecordingsSettings, recordingsCan, recordingsLabel, recordingsNeedPermission,
  recordingsSettings, resetRecordings, setRecordingsMode, type RecordingsMode,
} from '../../utils/recordingsFolder';

export function RecordingsSetting() {
  const tk = useTokens();
  const can = recordingsCan();
  const [mode, setMode] = useState(() => recordingsSettings().mode);
  const [label, setLabel] = useState('');
  const [needs, setNeeds] = useState(false);
  const [rev, setRev] = useState(0);
  useEffect(() => onRecordingsSettings(() => { setMode(recordingsSettings().mode); setRev(r => r + 1); }), []);
  useEffect(() => { void recordingsLabel().then(setLabel); void recordingsNeedPermission().then(setNeeds); }, [mode, rev]);
  const fail = (e: unknown) => toast.error('That didn’t work', { message: e instanceof Error ? e.message : String(e) });
  const options = [
    ...(can.folder ? [{ value: 'folder', label: 'Folder', title: 'Straight into a folder, no asking' }] : []),
    ...(can.ask ? [{ value: 'ask', label: 'Ask', title: 'Ask where to save, each time' }] : []),
    { value: 'downloads', label: 'Downloads', title: 'The browser’s usual download' },
  ];
  const pickFolder = () => { chooseRecordingsFolder().catch(fail); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Segmented fill size="sm" ariaLabel="Save recordings" value={mode} options={options}
        onChange={v => { if (v === 'folder' && label === 'No folder picked') pickFolder(); else setRecordingsMode(v as RecordingsMode); }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span title={label} style={{ flex: 1, minWidth: 0, color: tk.text.muted, font: `11.5px ${fontFamily.mono}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {mode === 'folder' && needs && <Button size="sm" variant="primary" onClick={() => { allowRecordingsFolder().then(ok => { if (ok) setNeeds(false); }).catch(fail); }}>Allow again</Button>}
        {mode === 'folder' && <Button size="sm" variant="ghost" icon="folder" onClick={pickFolder}>Choose…</Button>}
        <Button size="sm" variant="ghost" icon="reset" title="Back to the default: Videos/Shader Studio in the desktop app, Downloads in a browser" onClick={() => { resetRecordings().catch(fail); }}>Default</Button>
      </div>
      {!can.folder && !can.ask && <span style={{ color: tk.text.faint, fontSize: 11 }}>This browser saves to Downloads only; Chrome, Edge or the desktop app can use a folder.</span>}
    </div>
  );
}
