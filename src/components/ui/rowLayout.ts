import type { CSSProperties } from 'react';

/**
 * Label/field rows in cards (a layer's settings, a mapping, an effect): nothing runs past the
 * card's edge. The label keeps its width; the field side takes the rest of the row and may
 * shrink (min-width 0); whatever follows the field (a unit, a button, a toggle) wraps onto the
 * next line inside that column instead of being clipped. Segmented controls inside fold into a
 * dropdown when even a line of their own is too narrow (components/ui/Choice.tsx).
 *
 *   <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
 *     <span style={labelStyle}>Smooth</span>
 *     <div style={rowField}>…</div>
 *   </div>
 */
export const rowField: CSSProperties = { flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' };

/** A group inside a wrapping row that stays together on one line (a number and its unit). */
export const rowGroup: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, maxWidth: '100%' };

/**
 * The indent that lines a note or a row of buttons up under the fields (past a 62px label). It
 * gives way when the card is narrow, so a button there keeps at least 180px instead of clipping.
 */
export const ROW_INDENT = 'clamp(0px, calc(100% - 180px), 68px)';
