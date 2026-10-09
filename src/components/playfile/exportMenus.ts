/**
 * Every download the app offers. Graphs and Play setups export as `.playfile` only (a readable JSON
 * file still opens); other things keep `.playfile` first and their readable format as the other
 * (docs/playfile-format.md, "Where the app writes one"). Each `offer…` opens the small format menu at
 * the button that asked; the plan's gates stay as they were for each export.
 */
import { requireFeature } from '../../lib/plan';
import { PLAYFILE_EXT } from '../../playfile/format';
import { currentGraphLinks, exportCurrentGraph, exportPlayfile, exportPresentationPlayfile, openNodePackDialog } from '../../playfile/app';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { reportFileResult } from '../shell/reportFileResult';
import { chooseExportFormat } from './formatMenu';
import type { DownloadSetId } from '../../utils/library';

type Anchor = Element | { x: number; y: number } | null;
const report = (failTitle: string) => (r: Parameters<typeof reportFileResult>[0]) => reportFileResult(r, { failTitle });

/** ".playfile", and when the open graph is linked to presentations, ".playfile without them" too. */
function playfileChoices(asPlay: boolean, hint: string) {
  const links = currentGraphLinks(useNodeGraphStore.getState().currentGraph?.name);
  const fail = asPlay ? 'Couldn’t export the play file' : 'Couldn’t export the graph';
  if (!links.length) return [{ label: `As ${PLAYFILE_EXT}`, icon: 'export' as const, hint, run: async () => report(fail)(await exportCurrentGraph(asPlay)) }];
  return [
    { label: `As ${PLAYFILE_EXT}, with ${links.length === 1 ? 'its linked presentation' : `its ${links.length} linked presentations`}`, icon: 'export' as const, hint, run: async () => report(fail)(await exportCurrentGraph(asPlay, { linked: true })) },
    { label: `As ${PLAYFILE_EXT}, without linked presentations`, icon: 'export' as const, hint: 'Just this and what it uses', run: async () => report(fail)(await exportCurrentGraph(asPlay, { linked: false })) },
  ];
}

/** The Studio's Export (top bar, phone menu, the shortcut). */
export function offerGraphExport(anchor: Anchor): void {
  // Graphs export as .playfile only (a JSON graph still opens; saving it again writes a .playfile).
  offerOrRun(anchor, playfileChoices(false, 'The graph and what it uses (published nodes, functions, images), in one file that opens anywhere'), 'Export this graph');
}

/** One way to save: just do it. Several (linked presentations): ask. */
function offerOrRun(anchor: Anchor, choices: ReturnType<typeof playfileChoices>, title: string): void {
  if (choices.length === 1) { void choices[0].run(); return; }
  chooseExportFormat(anchor, choices, title);
}

/** The Play page's export. */
export function offerPlayExport(anchor: Anchor): void {
  offerOrRun(anchor, playfileChoices(true, 'The graph, the panel and the mappings as they are now, with what they use'), 'Export the Play setup');
}

/** A presentation (the open one when `name` is its name, or a saved one). */
export function offerPresentationExport(anchor: Anchor, name?: string): void {
  chooseExportFormat(anchor, [
    { label: `As ${PLAYFILE_EXT}`, icon: 'export', hint: 'The presentation with its Plays, pictures and fonts, and the graphs it was made from', run: async () => {
      const { usePresentation } = await import('../present/presentationStore');
      const st = usePresentation.getState();
      const n = name ?? st.name;
      if (!n) return;
      report('Couldn’t export the presentation')(await exportPresentationPlayfile(n, n === st.name ? st.doc : undefined));
    } },
    { label: 'As .present.json', icon: 'code', hint: 'A readable presentation file with every Play in it', run: async () => {
      const { exportPresentationFile } = await import('../present/presentationFiles');
      await exportPresentationFile(name);
    } },
  ], 'Download the presentation');
}

const SET_SECTIONS: Record<Exclude<DownloadSetId, 'everything'>, string[]> = {
  graphs: ['section:graphs'], presentations: ['section:presentations'], backgrounds: ['section:backgrounds'], glsl: ['section:glsl'],
  functions: ['section:functions'], nodes: ['section:nodes'], presets: ['section:presets'],
};
const SET_NAMES: Record<DownloadSetId, string> = {
  everything: 'Everything', graphs: 'Graphs', presentations: 'Presentations', backgrounds: 'Backgrounds', glsl: 'GLSL shaders', functions: 'Custom functions', nodes: 'My nodes', presets: 'Presets',
};

/**
 * One kind of thing (a Library "Download…" set, the GLSL page's download-all,
 * the Present page's download-all, custom functions): the same gates as the
 * ZIP. Published nodes only ever leave as a node pack.
 */
export function offerSetExport(anchor: Anchor, set: DownloadSetId): void {
  if (set === 'nodes') { openNodePackDialog(); return; }
  const playfile = async () => {
    if (set === 'everything') { await exportEverythingPlayfile(); return; }
    report('Couldn’t export that')(await exportPlayfile(SET_SECTIONS[set], { fileName: SET_NAMES[set], dependencies: set === 'graphs' || set === 'presentations', success: `Exported ${SET_NAMES[set].toLowerCase()}` }));
  };
  const zip = async () => { const { exportSet } = await import('../../utils/libraryActions'); await exportSet(set); };
  chooseExportFormat(anchor, [
    { label: `As ${PLAYFILE_EXT}`, icon: 'export', hint: 'One file: open it in Playfield to see what’s inside and pick what to bring in', run: playfile },
    { label: 'As a ZIP of readable files', icon: 'folder', hint: set === 'glsl' ? 'Plain .glsl files in folders, plus a library.json' : 'The files in folders, plus a library.json that imports them back', run: zip },
  ], `Download ${SET_NAMES[set].toLowerCase()}`);
}

/** Everything saved (Pro, like Download everything): one .playfile. Settings stay with the app. */
export async function exportEverythingPlayfile(): Promise<void> {
  if (!requireFeature('files.everything')) return;
  report('Couldn’t export everything')(await exportPlayfile(['section:graphs', 'section:presentations', 'section:glsl', 'section:functions', 'section:nodes', 'section:presets', 'section:scripts', 'section:backgrounds'], { fileName: `Playfield library ${new Date().toISOString().slice(0, 10)}`, success: 'Exported everything' }));
}

/** The Studio's custom function presets (the Functions list's Export). */
export function offerCustomFunctionsExport(anchor: Anchor): void {
  chooseExportFormat(anchor, [
    { label: `As ${PLAYFILE_EXT}`, icon: 'export', hint: 'The Functions library (custom function presets and the Builder’s functions), in one file', run: async () => report('Couldn’t export the functions')(await exportPlayfile(['section:functions'], { fileName: 'Custom functions', dependencies: false, success: 'Exported the custom functions' })) },
    { label: 'As readable JSON', icon: 'code', hint: 'custom-fns.json, as before', run: async () => { await useNodeGraphStore.getState().exportCustomFns(); } },
  ], 'Export custom functions');
}
