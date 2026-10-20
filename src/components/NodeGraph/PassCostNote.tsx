/**
 * PassCostNote — "Uses 1 pass (of 8)" on a library preview, for node types that cost passes
 * (compiler/passBudget.ts nodePassNote: worked out from the same expansion the compile runs).
 */
import { nodePassNote } from '../../compiler/passBudget';
import { useTokens } from '../../theme/themeStore';
import { Icon } from '../ui/Icon';

export function PassCostNote({ type, fontSize = 11.5 }: { type: string; fontSize?: number }) {
  const tk = useTokens();
  const note = nodePassNote(type);
  if (!note) return null;
  return (
    <div data-pass-note={type} title="Each pass renders the whole picture into a texture of its own every frame; a graph has 8. The toolbar shows how many are left." style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize, color: tk.text.muted }}>
      <Icon name="layers" size={12} />
      <span>{note}</span>
    </div>
  );
}
