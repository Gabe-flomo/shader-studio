/**
 * LinkedPickerWindow — the "From a linked folder" picker as a window (a sheet
 * on a phone) around the shared LinkedBrowser. Opened by openLinkedPicker
 * (linkedUi.ts); LinkedPickerHost renders it.
 */
import { Modal } from '../ui/Modal';
import { Sheet } from '../ui/Sheet';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { LinkedBrowser } from './LinkedBrowser';
import { FILTER_WORDS, type LinkedPick, type LinkedPickerRequest } from './linkedUi';

const narrow = () => typeof window !== 'undefined' && window.innerWidth < 640;

export function LinkedPickerWindow({ req, onDone }: { req: Omit<LinkedPickerRequest, 'resolve' | 'key'>; onDone: (p: LinkedPick | null) => void }) {
  const tk = useTokens();
  const compact = narrow();
  const words = FILTER_WORDS[req.filter];
  const title = req.title ?? (req.mode === 'folder' ? `Choose a folder of ${words.many}` : `Choose a ${words.one} from a linked folder`);
  const note = <span style={{ color: tk.text.faint, font: `500 11.5px/1.5 ${fontFamily.ui}` }}>Used from where it is, read-only: nothing is copied into the library, and it doesn’t count toward the storage limit. A .playfile export takes a copy along.</span>;
  const body = <LinkedBrowser filter={req.filter} mode={req.mode} compact={compact} folderId={req.folderId} dir={req.dir} onPick={onDone} listHeight={compact ? '46dvh' : 'min(52vh, 460px)'} />;
  if (compact) return <Sheet title={title} onClose={() => onDone(null)} maxHeight="92dvh" zIndex={80}>{body}<div style={{ padding: '10px 2px 4px' }}>{note}</div></Sheet>;
  return (
    <Modal title={title} icon="link" onClose={() => onDone(null)} width={760} footer={note}>
      <div style={{ padding: '14px 18px 16px' }}>{body}</div>
    </Modal>
  );
}
