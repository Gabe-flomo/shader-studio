/** announce.ts — the toast every surprise shows (docs/surprise.md). */
import { toast } from '../ui/toastStore';

/**
 * The toast after a surprise: what it made and its seed, with Reroll (undo it and make another)
 * and Undo. Both do nothing once something else changed (`stillCurrent` false).
 */
export function announceSurprise(o: { title: string; seed: number; message?: string; links?: { lead: string; items: Array<{ label: string; onClick: () => void }> }; reroll: () => void; undo: () => void; stillCurrent: () => boolean }): void {
  const guard = (f: () => void) => () => {
    if (!o.stillCurrent()) { toast.info('Changed since', { message: 'Something changed after this surprise: use Undo (⌘Z) to step back.' }); return; }
    f();
  };
  toast.success(`${o.title} · seed ${o.seed}`, {
    message: o.message,
    links: o.links,
    action: { label: 'Reroll', onClick: guard(o.reroll), stillValid: o.stillCurrent },
    secondary: { label: 'Undo', onClick: guard(o.undo) },
  });
}
