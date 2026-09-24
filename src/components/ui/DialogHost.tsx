import { useState } from 'react';
import { Button } from './Button';
import { Field } from './Field';
import { Modal } from './Modal';
import { useTokens } from '../../theme/themeStore';
import { closeDialog, useDialogStore, type ConfirmRequest, type TextRequest } from './dialogStore';

/** Renders the dialog opened by askText / askConfirm (dialogStore.ts). Mounted once, next to the Toaster. */
export function DialogHost() {
  const current = useDialogStore(s => s.current);
  if (!current) return null;
  return current.kind === 'text' ? <TextDialog key={current.title} req={current} /> : <ConfirmDialog req={current} />;
}

function TextDialog({ req }: { req: TextRequest }) {
  const [value, setValue] = useState(req.initial);
  const done = (v: string | null) => { closeDialog(); req.resolve(v && v.trim() ? v.trim() : null); };
  return (
    <Modal
      title={req.title}
      width={400}
      onClose={() => done(null)}
      footer={<>
        <span style={{ flex: 1 }} />
        <Button variant="ghost" onClick={() => done(null)}>Cancel</Button>
        <Button variant="primary" disabled={!value.trim()} onClick={() => done(value)}>{req.confirmLabel}</Button>
      </>}
    >
      <div style={{ padding: '16px 20px 20px' }}>
      <Field
        autoFocus
        aria-label={req.label ?? req.title}
        value={value}
        onChange={e => setValue(e.target.value)}
        onFocus={e => e.currentTarget.select()}
        onKeyDown={e => { if (e.key === 'Enter' && value.trim()) done(value); }}
      />
      </div>
    </Modal>
  );
}

function ConfirmDialog({ req }: { req: ConfirmRequest }) {
  const tk = useTokens();
  const done = (ok: boolean) => { closeDialog(); req.resolve(ok); };
  return (
    <Modal
      title={req.title}
      width={400}
      onClose={() => done(false)}
      footer={<>
        <span style={{ flex: 1 }} />
        <Button variant="ghost" onClick={() => done(false)}>Cancel</Button>
        <Button variant={req.danger ? 'danger' : 'primary'} autoFocus onClick={() => done(true)}>{req.confirmLabel}</Button>
      </>}
    >
      {req.message && <p style={{ margin: 0, padding: '16px 20px 20px', color: tk.text.secondary, lineHeight: 1.5 }}>{req.message}</p>}
    </Modal>
  );
}
