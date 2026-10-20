/**
 * PassCostNote — "Uses 1 pass (of 8)" on a library preview, for node types that cost passes
 * (compiler/passBudget.ts nodePassNote: worked out from the same expansion the compile runs).
 * At 10 passes (the lock, store/passLock.ts) a node that adds one shows "Locked: 10 of 10 passes" instead.
 */
import { HARD_MAX_PASSES, nodePassNote, passBudget, passesLocked } from '../../compiler/passBudget';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { Icon } from '../ui/Icon';

/** Does adding a node of this type add a pass for sure ("Uses N…")? Shared and conditional ones may not. */
export const typeAddsPass = (type: string): boolean => !!nodePassNote(type)?.startsWith('Uses');

/** Adding this type is locked: the graph is at HARD_MAX_PASSES and it would add a pass. */
export function useAddPassLocked(type: string | null | undefined): boolean {
  const locked = useNodeGraphStore(s => passesLocked(passBudget(s.nodes).used));
  return locked && !!type && typeAddsPass(type);
}

export function PassCostNote({ type, fontSize = 11.5 }: { type: string; fontSize?: number }) {
  const tk = useTokens();
  const note = nodePassNote(type);
  const locked = useAddPassLocked(type);
  if (!note) return null;
  if (locked) {
    return (
      <div data-pass-note={type} data-pass-locked="" title="Passes 9 and 10 already run at lower quality. Remove a pass (or bypass a node that adds passes) to add this." style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize, color: tk.status.warningText, fontWeight: 600 }}>
        <Icon name="lock" size={12} />
        <span>Locked: {HARD_MAX_PASSES} of {HARD_MAX_PASSES} passes</span>
      </div>
    );
  }
  return (
    <div data-pass-note={type} title="Each pass renders the whole picture into a texture of its own every frame; a graph has 8 at full quality, and 2 more at lower quality. The toolbar shows how many are left." style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize, color: tk.text.muted }}>
      <Icon name="layers" size={12} />
      <span>{note}</span>
    </div>
  );
}
