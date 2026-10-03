/**
 * SourceDragHandle — the grip on a source card or an old mapping card: drag
 * it onto a control on the board to drive that control (sourceDrag.ts), the
 * same route a Map-mode click makes.
 */
import { useTokens } from '../../../theme/themeStore';
import { Icon } from '../../ui/Icon';
import { SOURCE_DRAG_TYPE } from './sourceDrag';

export function SourceDragHandle({ id, label }: { id: string; label: string }) {
  const tk = useTokens();
  return (
    <span
      draggable
      data-source-drag={id}
      onDragStart={e => {
        e.dataTransfer.setData(SOURCE_DRAG_TYPE, id);
        e.dataTransfer.setData('text/plain', label);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      title={`Drag ${label} onto a control to drive it`}
      style={{ display: 'inline-flex', flexShrink: 0, color: tk.text.faint, cursor: 'grab' }}
    ><Icon name="grip" size={12} /></span>
  );
}
