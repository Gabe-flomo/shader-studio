// Semantic design tokens for the redesign (see the Spec page of the design canvas).
//
// Values are plain hex, like palette.ts: call sites append alpha suffixes and canvas 2D
// contexts consume them directly, neither of which works with CSS variables. Components
// read the active set through useTokens() (themeStore.ts) so a theme switch re-renders them.
//
// Render surfaces (preview, node thumbnails, inline viz) stay dark in both themes, and the
// data-type colours in NodeGraph/typeColors.ts are shared by both.

export type ThemeMode = 'light' | 'dark';

const LIGHT = {
  bg: {
    app: '#eef0f4',       // app backdrop, graph canvas
    panel: '#ffffff',     // nav, sidebar, cards, modals
    subtle: '#fbfbfc',    // icon rail, inspectors, editor headers
    field: '#f4f5f8',     // inputs, value boxes, ruler track, chips
    hover: '#f2f3f6',
    selected: '#eef3ff',
    render: '#0d0d12',
    scrim: 'rgba(26,27,35,0.30)',
  },
  border: {
    default: '#e7e8ee',
    subtle: '#eef0f3',    // dividers inside cards and panels
    strong: '#d7d9e2',    // dashed "add" buttons, canvas dots
  },
  text: {
    primary: '#1a1b23',
    secondary: '#3a3d47',
    muted: '#6b6f7a',
    faint: '#9a9da8',     // caps labels, placeholders, resting icons
    disabled: '#c3c5cf',
  },
  accent: {
    base: '#3a6ff7',      // selection, needle, focus ring
    text: '#2f5fe0',      // accent text on bg.selected
  },
  status: {
    success: '#177a45',   // previewing node, saved graphs (5.4:1 on white)
    warning: '#d99a1e',   // bypass, keyframes, favourites
    warningText: '#8a5d05',
    danger: '#ef4444',    // record, playhead, errors
  },
  kind: {
    fn: '#0891b2',        // custom functions
    expr: '#8b5cf6',      // expression blocks, ease handles
  },
  ink: {
    base: '#1a1b23',      // primary buttons
    text: '#ffffff',
  },
  tooltip: {
    bg: '#1a1b23',
    text: '#d6d8e0',
    strong: '#ffffff',
    muted: '#8a8d9b',
  },
  syntax: {
    keyword: '#8b3fd9', type: '#0f7fa6', number: '#b45309', fn: '#2f5fe0', comment: '#a0a3ad', preproc: '#be185d',
  },
  shadow: {
    card: '0 1px 2px rgba(20,20,30,0.05), 0 8px 22px rgba(20,20,30,0.07)',
    float: '0 2px 12px rgba(20,20,30,0.10)',
    popover: '0 12px 32px rgba(20,20,30,0.16), 0 1px 3px rgba(20,20,30,0.08)',
    modal: '0 30px 80px rgba(20,20,30,0.28), 0 2px 8px rgba(20,20,30,0.08)',
  },
};

export type Tokens = typeof LIGHT;

const DARK: Tokens = {
  bg: {
    app: '#11111b', panel: '#1e1e2e', subtle: '#181825', field: '#2a2b3d', hover: '#262738',
    selected: '#273150', render: '#0d0d12', scrim: 'rgba(0,0,0,0.55)',
  },
  border: { default: '#313244', subtle: '#28293b', strong: '#45475a' },
  text: { primary: '#cdd6f4', secondary: '#bac2de', muted: '#a6adc8', faint: '#7f849c', disabled: '#585b70' },
  accent: { base: '#89b4fa', text: '#89b4fa' },
  status: { success: '#a6e3a1', warning: '#f9e2af', warningText: '#f9e2af', danger: '#f38ba8' },
  kind: { fn: '#74c7ec', expr: '#cba6f7' },
  ink: { base: '#cdd6f4', text: '#11111b' },
  tooltip: { bg: '#313244', text: '#cdd6f4', strong: '#ffffff', muted: '#9399b2' },
  syntax: { keyword: '#cba6f7', type: '#89dceb', number: '#fab387', fn: '#89b4fa', comment: '#6c7086', preproc: '#f5c2e7' },
  shadow: {
    card: '0 1px 2px rgba(0,0,0,0.11), 0 8px 22px rgba(0,0,0,0.15)',
    float: '0 2px 12px rgba(0,0,0,0.22)',
    popover: '0 12px 32px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.18)',
    modal: '0 30px 80px rgba(0,0,0,0.60), 0 2px 8px rgba(0,0,0,0.18)',
  },
};

export const THEMES: Readonly<Record<ThemeMode, Tokens>> = Object.freeze({ light: LIGHT, dark: DARK });

/** `#rrggbb` + opacity (0–1) → `#rrggbbaa`. */
export function alpha(hex: string, a: number): string {
  const byte = Math.round(Math.min(1, Math.max(0, a)) * 255);
  return `${hex.slice(0, 7)}${byte.toString(16).padStart(2, '0')}`;
}

// Theme-independent scales.
export const radius = { xs: 4, sm: 6, md: 8, control: 9, lg: 12, card: 14, modal: 16 } as const;
export const fontFamily = {
  ui: 'system-ui, -apple-system, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;
