// Node-category accent colours for the redesign. Dark keeps today's Catppuccin Mocha accents;
// light uses the same-named Catppuccin Latte accents (tuned for white backgrounds), and a
// darker partner for the few one-off hexes.
import type { ThemeMode } from './tokens';

const MOCHA = {
  blue: '#89b4fa', green: '#a6e3a1', lavender: '#b4befe', peach: '#fab387', sapphire: '#74c7ec', red: '#f38ba8',
  sky: '#89dceb', yellow: '#f9e2af', pink: '#f5c2e7', mauve: '#cba6f7', flamingo: '#f2cdcd', teal: '#94e2d5', overlay0: '#6c7086',
};
const LATTE: typeof MOCHA = {
  blue: '#1e66f5', green: '#40a02b', lavender: '#7287fd', peach: '#fe640b', sapphire: '#209fb5', red: '#d20f39',
  sky: '#04a5e5', yellow: '#df8e1d', pink: '#ea76cb', mauve: '#8839ef', flamingo: '#dd7878', teal: '#179299', overlay0: '#8c8fa1',
};
type Accent = keyof typeof MOCHA;

// One-off colours that aren't Catppuccin accents: [dark (current), light].
const CUSTOM: Record<string, [string, string]> = {
  'Color Grading': ['#f9a86b', '#e0701f'],
  '3D Scene': ['#cc88aa', '#a8527d'],
  '3D Lighting': ['#f9c468', '#c98a0a'],
  Matrix: ['#f5c842', '#b8900a'],
  Halftone: ['#a6e3d5', '#1f9a82'],
};

const BY_ACCENT: Record<string, Accent> = {
  Sources: 'blue', Transforms: 'green', Math: 'lavender', Color: 'peach', Noise: 'sapphire', Effects: 'red',
  'Post Processing': 'red', Loops: 'sky', '2D Primitives': 'yellow', Combiners: 'mauve', Spaces: 'flamingo', Grid: 'sky',
  Field: 'sapphire', Shapers: 'yellow', Science: 'teal', Fractals: 'mauve', Output: 'overlay0', '3D Primitives': 'pink',
  '3D Transforms': 'pink', '3D Boolean Ops': 'sky', '3D Fractals': 'pink', Animation: 'lavender', Conditionals: 'flamingo',
  Utility: 'overlay0', Particles: 'yellow', 'Particles & Fields': 'yellow', SDF: 'pink', 'Group Presets': 'yellow',
  Functions: 'sky',
};

export function categoryColor(category: string, mode: ThemeMode): string {
  const custom = CUSTOM[category];
  if (custom) return mode === 'dark' ? custom[0] : custom[1];
  const accent = BY_ACCENT[category];
  if (!accent) return mode === 'dark' ? MOCHA.overlay0 : LATTE.overlay0;
  return (mode === 'dark' ? MOCHA : LATTE)[accent];
}
