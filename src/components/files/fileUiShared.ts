/**
 * What the Files page's pieces share that isn't a component: the icon and
 * tint per kind of thing, kind names, "when" text and a few styles.
 */
import type { CSSProperties } from 'react';
import type { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import type { IconName } from '../ui/iconPaths';
import type { FileNode, NodeKind, SectionId } from '../../files/inventory';
import { whenSaved } from '../../store/graphVersions';

export const SECTION_ICONS: Record<SectionId, IconName> = {
  graphs: 'graphs', presentations: 'slides', glsl: 'code', functions: 'fn', presets: 'presets',
  nodes: 'nodes', scripts: 'scroll', backgrounds: 'overlay', settings: 'sliders',
};

const KIND_ICONS: Partial<Record<NodeKind, IconName>> = {
  folder: 'folder', graph: 'graphs', versions: 'history', version: 'history', play: 'play', takes: 'record', take: 'record',
  datasets: 'table', dataset: 'table', media: 'camera', layerKinds: 'cube', layerKind: 'cube', presentation: 'slides', source: 'play',
  shader: 'code', function: 'fn', builderFn: 'curve', preset: 'presets', node: 'nodes', script: 'scroll', palette: 'dice', background: 'overlay', setting: 'sliders',
};

export function iconFor(n: FileNode): IconName {
  if (n.kind === 'section') return SECTION_ICONS[n.section];
  if (n.kind === 'group') {
    if (/media/i.test(n.id.split('/').pop() ?? '')) return 'camera';
    if (n.label === 'Layer kinds') return 'cube';
    if (n.label === 'Palettes') return 'dice';
    return SECTION_ICONS[n.section];
  }
  return KIND_ICONS[n.kind] ?? 'info';
}

/** The tint a kind of thing gets in its icon tile. */
export function tintFor(tk: ReturnType<typeof useTokens>, n: FileNode): string {
  if (n.kind === 'folder') return tk.status.warning;
  if (n.section === 'functions') return tk.kind.fn;
  if (n.section === 'presets' || n.section === 'scripts') return tk.kind.expr;
  if (n.section === 'settings') return tk.text.muted;
  return tk.accent.base;
}

export function when(t?: number): string {
  if (!t || t < 1e11) return ''; // not a real date (old saves, tests)
  return whenSaved(t);
}

export const capsLabel = (tk: ReturnType<typeof useTokens>): CSSProperties => ({
  color: tk.text.faint, font: `700 10px ${fontFamily.ui}`, letterSpacing: '0.07em', textTransform: 'uppercase',
});

export const cardStyle = (tk: ReturnType<typeof useTokens>): CSSProperties => ({
  background: tk.bg.panel, borderRadius: radius.lg, boxShadow: `inset 0 0 0 1px ${tk.border.default}`,
});

export const KIND_LABELS: Record<NodeKind, string> = {
  section: 'Section', group: 'Group', folder: 'Folder', graph: 'Graph', versions: 'Earlier versions', version: 'Earlier version', play: 'Play setup',
  takes: 'Takes', take: 'Take', datasets: 'Datasets', dataset: 'Dataset', media: 'Media file', layerKinds: 'Layer kinds', layerKind: 'Layer kind',
  presentation: 'Presentation', source: 'Play in a presentation', shader: 'GLSL shader', function: 'Custom function preset', builderFn: 'Function Builder',
  preset: 'Preset', node: 'Published node', script: 'Saved sketch', palette: 'Palette', background: 'Background', setting: 'Setting',
};
