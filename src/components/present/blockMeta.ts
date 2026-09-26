/** The four kinds of block: their names, icons and one-line hints, for menus and the settings panel. */
import type { Block } from '../../types/presentation';

export const BLOCK_META: Record<Block['type'], { label: string; icon: 'text' | 'layoutCanvas' | 'sliders' | 'code'; hint: string }> = {
  text: { label: 'Text', icon: 'text', hint: 'Markdown with $maths$' },
  render: { label: 'Render', icon: 'layoutCanvas', hint: 'A Play’s picture, no controls' },
  interactive: { label: 'Interactive', icon: 'sliders', hint: 'Text, a picture and some of its controls' },
  code: { label: 'Code', icon: 'code', hint: 'GLSL or JavaScript, typed or from a Play' },
};
