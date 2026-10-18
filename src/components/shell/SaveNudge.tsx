/**
 * The save nudge (files/saveNudge.ts): after 15 minutes on a never-saved graph, a friendly ask to
 * save it, with a name field. "Thank you" saves it (version 1.0); "Don't say I didn't warn you"
 * stops asking for this graph.
 */
import { useEffect, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { dismissSaveNudge, installSaveNudge, useSaveNudge } from '../../files/saveNudge';
import { reportFileResult } from './reportFileResult';

export function SaveNudge() {
  const tk = useTokens();
  const open = useSaveNudge(s => s.open);
  const [name, setName] = useState('');
  useEffect(() => installSaveNudge(), []);
  if (!open) return null;
  const n = name.trim();
  const save = async () => {
    if (!n) return;
    const ok = reportFileResult(await useNodeGraphStore.getState().saveGraph(n, '', 'new'), { failTitle: `Couldn’t save “${n}”`, success: `Saved “${n}” 1.0` });
    if (ok) { setName(''); useSaveNudge.setState({ open: false }); }
  };
  const btn = (bg: string): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 38, padding: '0 16px', border: 0,
    borderRadius: radius.control, background: bg, color: '#fff', font: `600 13.5px ${fontFamily.ui}`, cursor: 'pointer',
  });
  return (
    <Modal title="Save your work?" icon="save" onClose={dismissSaveNudge} width={440} closeOnScrim={false}>
      <div data-save-nudge style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '16px 20px 20px' }}>
        <p style={{ margin: 0, font: `500 14px/1.5 ${fontFamily.ui}`, color: tk.text.primary }}>
          You've been in this project for awhile without saving, I'd hate for you to lose all this work 🥺
        </p>
        <Field autoFocus placeholder="Name this graph" value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void save(); }} height={34} aria-label="Graph name" />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button type="button" data-save-nudge-dismiss onClick={dismissSaveNudge} style={btn('#dc2626')}>
            <Icon name="close" size={14} />Don't say I didn't warn you
          </button>
          <button type="button" data-save-nudge-save onClick={() => void save()} disabled={!n} title={n ? undefined : 'Type a name first'}
            style={{ ...btn('#16a34a'), opacity: n ? 1 : 0.55, cursor: n ? 'pointer' : 'not-allowed' }}>
            <Icon name="save" size={14} />Thank you
          </button>
        </div>
      </div>
    </Modal>
  );
}
