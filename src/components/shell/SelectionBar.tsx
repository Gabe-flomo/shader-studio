import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { displayCombo, loadShortcutMap } from '../../hooks/useShortcuts';
import { IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';

/**
 * Floating bar over the canvas while several nodes are selected: Group, Duplicate and Delete,
 * with their shortcuts (these used to live only in the right-click menu).
 */
export function SelectionBar({ top }: { top: number }) {
  const tk = useTokens();
  const ids = useNodeGraphStore(s => s.selectedNodeIds);
  const groupNodes = useNodeGraphStore(s => s.groupNodes);
  const duplicateNodes = useNodeGraphStore(s => s.duplicateNodes);
  const removeNodes = useNodeGraphStore(s => s.removeNodes);
  const deselectAll = useNodeGraphStore(s => s.deselectAll);
  const setPendingPublishGroupId = useNodeGraphStore(s => s.setPendingPublishGroupId);
  if (ids.length < 2) return null;
  const keys = loadShortcutMap();

  const action = (icon: IconName, label: string, combo: string, onClick: () => void, danger = false) => (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 32, display: 'flex', alignItems: 'center', gap: 7, padding: '0 10px', border: 0, borderRadius: radius.md,
        background: 'none', cursor: 'pointer', color: danger ? tk.status.danger : tk.text.secondary, font: `500 12.5px ${fontFamily.ui}`,
      }}
      onMouseEnter={e => { e.currentTarget.style.background = tk.bg.hover; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
    >
      <Icon name={icon} size={15} />
      {label}
      {combo && (
        <span style={{ font: `600 10.5px ${fontFamily.mono}`, color: tk.text.faint, background: tk.bg.field, borderRadius: 4, padding: '1px 5px' }}>
          {displayCombo(combo)}
        </span>
      )}
    </button>
  );

  return (
    <div
      role="toolbar"
      aria-label="Selection"
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'absolute', top, left: '50%', transform: 'translateX(-50%)', zIndex: 21,
        display: 'flex', alignItems: 'center', gap: 2, padding: '4px 4px 4px 12px', borderRadius: 12,
        background: tk.bg.panel, boxShadow: tk.shadow.float, whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontWeight: 600, fontSize: 12.5, color: tk.text.primary, marginRight: 6 }}>{ids.length} selected</span>
      <span style={{ width: 1, height: 18, background: tk.border.default, margin: '0 4px' }} />
      {action('presets', 'Group', keys.groupSelected, () => { groupNodes(ids); deselectAll(); })}
      {action('spark', 'Publish as node', '', () => {
        // Group the selection, then open the publish dialog on the new group's
        // card once it mounts — the selected nodes are the node's insides, the
        // wires crossing the selection boundary become its inputs and outputs.
        const gid = groupNodes(ids, 'New node');
        deselectAll();
        if (gid) setPendingPublishGroupId(gid);
      })}
      {action('copy', 'Duplicate', keys.duplicateSelected, () => duplicateNodes(ids))}
      {action('trash', 'Delete', keys.deleteSelected, () => { removeNodes(ids); deselectAll(); }, true)}
      <IconButton icon="close" label="Clear the selection" size="sm" tooltip={false} onClick={deselectAll} />
    </div>
  );
}
