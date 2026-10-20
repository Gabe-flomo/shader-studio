/**
 * AddToThisButton — "Add to this…" beside a builder's Done (docs/combine.md, docs/combine-plan.md §3.1): Done as usual,
 * then Combine opens with this build as its first layer and "+ Add a layer" open. Only in a Scene builder session,
 * one kind's window open, not on a phone ([D9]). StudioShell draws it beside its primary; builders with a footer of
 * their own (the 2D builder, Agent Rules) put it there.
 */
import { Button } from '../ui/Button';
import { usePhoneDialog } from '../ui/phoneDialog';
import { useSceneDraftActive } from '../../builders/sceneDraftFlag';
import { addToThis, addToThisOffered } from '../../combine/actions';

export function AddToThisButton({ done, size = 'sm' }: { done: () => void | Promise<void>; size?: 'sm' | 'md' }) {
  const draft = useSceneDraftActive();
  const phone = usePhoneDialog();
  if (!draft || phone || !addToThisOffered()) return null;
  return (
    <Button size={size} data-add-to-this title="Done, then put something with it: Combine opens with this as its first layer (a photo in it, people replaced by it…)"
      onClick={() => addToThis(done)}>Add to this…</Button>
  );
}
