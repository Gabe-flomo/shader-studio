/**
 * Which params the phone's node page (MobileGraphBrowser) leaves to the node's own editor, as the
 * desktop card does: Grid Rules keeps Speed, Reset and the brush on the card; the rest is in its
 * editor window (GridRulesEditor, a full-screen tabbed window on a phone).
 */
import { GRID_CARD_KEYS } from '../../nodes/definitions/gridRules';

export function mobileHidesParam(nodeType: string, key: string): boolean {
  return nodeType === 'gridRules' && !GRID_CARD_KEYS.has(key);
}
