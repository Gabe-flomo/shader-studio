/**
 * textFit.ts — how text fits its box, one rule for the app: a name that runs long wraps to a second line and is
 * clamped there (with its full text in a `title`) rather than being cut off after a few letters, and a live number
 * keeps its width as its digits change so the row around it doesn't reflow.
 */
import type { CSSProperties } from 'react';

/** Wrap, then cut with an ellipsis after `lines` lines. */
export function clampLines(lines = 2): CSSProperties {
  return {
    display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden',
    whiteSpace: 'normal', overflowWrap: 'break-word', minWidth: 0,
  };
}

/** A tile's name under its picture: up to two lines, centred. */
export const tileName: CSSProperties = { ...clampLines(2), textAlign: 'center', lineHeight: 1.2 };

/** A live number: every digit the same width, and at least `minWidth` wide (in ch by default) so it never jitters. */
export function liveNumber(minWidth: number | string, align: 'left' | 'right' = 'left'): CSSProperties {
  return {
    fontVariantNumeric: 'tabular-nums', minWidth: typeof minWidth === 'number' ? `${minWidth}ch` : minWidth,
    display: 'inline-block', textAlign: align, whiteSpace: 'nowrap',
  };
}
