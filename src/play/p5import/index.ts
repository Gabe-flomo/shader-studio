/**
 * p5import — bringing a p5.js sketch or project in as a Script layer.
 *
 * The steps, in order: gather the project (project.ts), see what it uses
 * (analyze.ts), turn its DOM controls into declared controls and offer its
 * values as controls (controls.ts), then build the layer (build.ts).
 */

export {
  P5_MAIN_FILE, P5_IMAGE_CAP, P5_OTHER_CAP,
  projectFromEntries, projectFromText, readP5Inputs, saveImagesToLibrary, assetToRecord,
  bytesToBase64, bytesToText, normalisePath, htmlScripts, definesSketch,
} from './project';
export type { P5File, P5SourceFile, P5Asset, P5AssetKind, P5AssetRecord, P5Skipped, P5Project, P5ProjectOptions } from './project';

export { analyzeProject, groupItems } from './analyze';
export type { P5Analysis, P5Item, P5ItemStatus, P5Ref, P5Warning } from './analyze';
export type { SyntaxProblem } from './ast';

export {
  mapDomControls, findControlCandidates, suggestControls, applyControls, candidateAt, unmakeControl,
  paramKeys, rangeFor, parseColourString, packColour,
} from './controls';
export type { P5Candidate, P5CandidateOptions, P5ChosenControl, P5ControlKind, P5DomControl, P5ParamEntry, P5Range, P5RewriteResult } from './controls';

export { buildP5Layer, combineRewrites } from './build';
export type { P5ImportReport, P5LayerBuild, P5LayerPatch } from './build';
