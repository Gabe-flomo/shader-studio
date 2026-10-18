import { useState } from 'react';
import { Button } from './Button';
import { Field } from './Field';
import { Modal } from './Modal';
import { useTokens } from '../../theme/themeStore';
import { closeDialog, useDialogStore, type ChoiceRequest, type ConfirmRequest, type TextRequest } from './dialogStore';

/** Renders the dialog opened by askText / askConfirm / askChoice (dialogStore.ts). Mounted once, next to the Toaster. */
export function DialogHost() {
  const current = useDialogStore(s => s.current);
  if (!current) return null;
  if (current.kind === 'text') return <TextDialog key={current.title} req={current} />;
  return current.kind === 'choice' ? <ChoiceDialog req={current} /> : <ConfirmDialog req={current} />;
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
        onKeyDown={e => { if (e.key === 'Enter' && value.trim()) { e.preventDefault(); done(value); } }}
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

function ChoiceDialog({ req }: { req: ChoiceRequest }) {
  const tk = useTokens();
  const done = (id: string | null) => { closeDialog(); req.resolve(id); };
  // One row: the quieter choices on the left (a destructive one as red text, not a loud red button), the
  // main ones on the right. Cancel only when asked for: the × and Esc already cancel.
  const main = req.options.filter(o => o.variant === 'primary');
  const quiet = req.options.filter(o => o.variant !== 'primary');
  const quietBtn = (o: ChoiceRequest['options'][number]) => (
    <Button key={o.id} variant="ghost" onClick={() => done(o.id)}
      style={o.variant === 'danger' ? { color: tk.status.danger } : undefined}>{o.label}</Button>
  );
  return (
    <Modal
      title={req.title}
      width={460}
      onClose={() => done(null)}
      footer={<>
        {req.cancel !== false && <Button variant="ghost" onClick={() => done(null)}>Cancel</Button>}
        {quiet.map(quietBtn)}
        <span style={{ flex: 1 }} />
        {main.map((o, i) => (
          <Button key={o.id} variant="primary" autoFocus={i === main.length - 1} onClick={() => done(o.id)}>{o.label}</Button>
        ))}
      </>}
    >
      {req.message && <p style={{ margin: 0, padding: '16px 20px 20px', color: tk.text.secondary, lineHeight: 1.5 }}>{req.message}</p>}
      {(req.note || req.links?.length) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '0 20px 18px', marginTop: req.message ? -8 : 16 }}>
          {req.note && <span style={{ fontSize: 12.5, color: tk.text.muted, marginRight: 4 }}>{req.note}</span>}
          {req.links?.map(l => <Button key={l.label} size="sm" variant="ghost" onClick={l.onClick}>{l.label}</Button>)}
        </div>
      )}
    </Modal>
  );
}
