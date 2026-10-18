/**
 * LearnDialog — "Learn the app": the lessons on using Playfield itself (Getting started in the
 * Studio, your first Play, …), each with its picture. Opening one builds it (the first time) and
 * shows it on the Present page to read (Scroll), where it can be edited like any presentation.
 * learnStore.ts says where it's opened from.
 */
import { useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { usePhoneDialog } from '../ui/phoneDialog';
import { requestPage } from '../page';
import { LEARN_LESSONS, type SamplePresentation } from '../../present/samples';
import { useSampleStills } from '../present/useSampleStills';
import { openSampleByTitle } from '../present/linkActions';
import { usePresentation } from '../present/presentationStore';
import { useLearnUi } from './learnStore';

/** Open a lesson to read: built (or reopened), in Scroll, on the Present page. */
export async function openLesson(title: string): Promise<boolean> {
  if (!(await openSampleByTitle(title))) return false;
  usePresentation.getState().setMode('scroll');
  requestPage('present');
  return true;
}

export function LearnDialog() {
  const close = useLearnUi(s => s.closeLearn);
  const phone = usePhoneDialog();
  const stills = useSampleStills(LEARN_LESSONS);
  const [busy, setBusy] = useState<string | null>(null);
  const open = async (s: SamplePresentation) => {
    setBusy(s.title);
    const ok = await openLesson(s.title);
    setBusy(null);
    if (ok) close();
  };
  return (
    <Modal title="Learn the app" subtitle="How Playfield works, taught with its own pictures" icon="book" onClose={close} width={760}>
      <div data-learn-lessons="" style={{ display: 'grid', gridTemplateColumns: `repeat(${phone ? 2 : 3}, minmax(0, 1fr))`, gap: phone ? 10 : 14 }}>
        {LEARN_LESSONS.map(s => (
          <LessonCard key={s.title} lesson={s} still={stills[s.title]} busy={busy === s.title} disabled={!!busy} onOpen={() => void open(s)} />
        ))}
      </div>
    </Modal>
  );
}

export function LessonCard({ lesson, still, busy, disabled, onOpen, compact = false }: {
  lesson: SamplePresentation; still: string | null | undefined; busy: boolean; disabled: boolean; onOpen: () => void; compact?: boolean;
}) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  const lift = hover && !disabled;
  return (
    <button
      type="button" disabled={disabled} onClick={onOpen} data-lesson={lesson.title}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', flexDirection: 'column', minWidth: 0, padding: 0, textAlign: 'left', cursor: disabled ? 'default' : 'pointer',
        border: `1px solid ${lift ? tk.border.strong : tk.border.default}`, borderRadius: radius.card, overflow: 'hidden',
        background: tk.bg.panel, color: tk.text.primary, font: 'inherit', boxShadow: lift ? tk.shadow.popover : 'none',
        transition: 'box-shadow 120ms ease, border-color 120ms ease', opacity: disabled && !busy ? 0.6 : 1,
      }}
    >
      <span style={{ position: 'relative', display: 'block', aspectRatio: compact ? '2 / 1' : '16 / 9', background: `linear-gradient(135deg, ${tk.bg.render}, ${alpha(tk.accent.base, 0.35)})`, overflow: 'hidden' }}>
        {still
          ? <img src={still} alt="" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          : <Icon name="book" size={20} style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', color: alpha('#ffffff', 0.4) }} />}
        {busy && <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)', color: '#fff', font: `600 12.5px ${fontFamily.ui}` }}>Opening…</span>}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '10px 12px 12px' }}>
        <span style={{ font: `640 13px/1.3 ${fontFamily.ui}` }}>{lesson.title}</span>
        <span style={{ color: tk.text.muted, font: `500 11.5px/1.4 ${fontFamily.ui}`, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{lesson.hint}</span>
      </span>
    </button>
  );
}
