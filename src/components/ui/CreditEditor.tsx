/**
 * CreditEditor — "Add source / credit…": the form behind a Play setup's
 * credit line (PlayRecord.source) and a node comment's (params.__credit).
 * A live preview shows the line exactly as the Notes card will.
 */
import { useMemo, useState } from 'react';
import { creditFromForm, creditToForm, type CreditForm, type SourceCredit } from '../../types/credit';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { Modal } from './Modal';
import { Field } from './Field';
import { Button } from './Button';
import { CreditLink } from './Credit';

export function CreditEditor({ initial, onSave, onRemove, onClose, what = 'this setup' }: {
  initial?: SourceCredit;
  onSave: (credit: SourceCredit) => void;
  /** Offered when there is a credit to remove. */
  onRemove?: () => void;
  onClose: () => void;
  /** "this setup", "this node": for the subtitle. */
  what?: string;
}) {
  const tk = useTokens();
  const [form, setForm] = useState<CreditForm>(() => creditToForm(initial));
  const [tried, setTried] = useState(false);
  const result = useMemo(() => creditFromForm(form, initial), [form, initial]);
  const set = (k: keyof CreditForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  const save = () => {
    setTried(true);
    if ('credit' in result) { onSave(result.credit); onClose(); }
  };
  const label = (text: string, hint?: string) => (
    <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, font: `600 11.5px ${fontFamily.ui}`, color: tk.text.secondary }}>
      {text}{hint && <span style={{ fontWeight: 500, color: tk.text.faint }}>{hint}</span>}
    </span>
  );
  const row = { display: 'flex', flexDirection: 'column', gap: 5 } as const;
  const onKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); save(); } };
  return (
    <Modal
      title={initial ? 'Edit source / credit' : 'Add source / credit'}
      subtitle={`Where ${what} comes from`}
      icon="book"
      width={460}
      onClose={onClose}
      footer={(
        <>
          {initial && onRemove && <Button variant="ghost" icon="trash" style={{ color: tk.status.danger }} onClick={() => { onRemove(); onClose(); }}>Remove</Button>}
          <span style={{ flex: 1 }} />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>{initial ? 'Save' : 'Add credit'}</Button>
        </>
      )}
    >
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }} onKeyDown={onKeyDown}>
        <label style={row}>{label('Title', 'the book, article or shader')}<Field autoFocus value={form.title} onChange={set('title')} placeholder="The Book of Shaders" invalid={tried && !form.title.trim()} /></label>
        <label style={row}>{label('Author(s)', 'optional')}<Field value={form.author} onChange={set('author')} placeholder="Patricio Gonzalez Vivo and Jen Lowe" /></label>
        <label style={row}>{label('Link')}<Field value={form.url} onChange={set('url')} placeholder="https://thebookofshaders.com/09/" mono invalid={tried && 'error' in result && !!form.title.trim()} /></label>
        <label style={row}>{label('Chapter or section', 'optional')}<Field value={form.detail} onChange={set('detail')} placeholder="Ch. 9 · Patterns" /></label>
        <label style={row}>{label('Licence', 'optional')}<Field value={form.licence} onChange={set('licence')} placeholder="CC BY-NC-SA 4.0" /></label>
        {tried && 'error' in result && <div role="alert" style={{ color: tk.status.danger, fontSize: 12 }}>{result.error}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {label('Preview')}
          {'credit' in result
            ? <CreditLink source={result.credit} />
            : <div style={{ fontSize: 12, color: tk.text.faint, padding: '6px 0' }}>Fill in a title and a link to see the credit line.</div>}
        </div>
      </div>
    </Modal>
  );
}
