/**
 * presetKinds.ts — every kind of preset Playfield keeps, registered with the one preset store
 * (presetStore.ts), each described by where its data has always lived. Nothing moves: the keys,
 * the records and the folder scopes are the ones each module wrote before, so presets saved by
 * any earlier version list, rename, delete and export here unchanged.
 *
 * Grouped by what they apply to:
 *   nodes     Groups (+ the built-in effects), Vector transforms, Functions, Expression Blocks, Keyframe curves
 *   builders  each Scene builder's presets (8), the 2D builder's space blocks
 *   play      layer sets, racks, drum kits (+ the built-in kits)
 *   finish    Finish presets (+ the built-in Looks and stacks), Finish effects, saved Looks
 *   colour    Palette node presets, background palettes (+ the built-in palettes)
 *
 * Import this module once (the Library and <PresetMenu> do) before using the store.
 */
import { registerPresetKind, type PresetItem, type PresetKindDef } from './presetStore';
import { useNodeGraphStore, loadGroupPresets } from '../store/useNodeGraphStore';
import { COMPOUND_EFFECTS } from '../store/compoundEffects';
import { builderPresets, presetStorageKey, PRESET_BUILDER_KINDS, type PresetBuilderKind } from '../builders/userPresets';
import { LAYER_SETS_CHANGED, LAYER_SETS_KEY, parseLayerSet } from '../play/layerSets';
import { RACK_PRESETS_CHANGED, RACK_PRESETS_KEY, parseRackPreset } from '../play/rackPresets';
import { BUILTIN_KITS, DRUM_KITS_CHANGED, DRUM_KITS_KEY, parseDrumKit } from '../play/drumKits';
import { FINISH_EFFECTS_KEY, FINISH_LIBRARY_CHANGED, FINISH_PRESETS_KEY, parseSavedEffect, parseStackPreset } from '../play/finishLibrary';
import { BUILTIN_FINISH_PRESETS } from '../play/finishPresets';
import { SAVED_LOOKS_CHANGED } from '../components/play/finish/savedLooks';
import { PALETTE_PRESETS_CHANGED } from '../lib/palette';
import { SAVED_BLOCKS_CHANGED, SAVED_BLOCKS_KEY, parseSavedBlock } from '../sceneBuilder2d/savedBlocks';
import { BACKGROUNDS_CHANGED, PALETTES_KEY as BG_PALETTES_KEY, PALETTE_FOLDER_SCOPE, PALETTE_PRESETS as BG_PALETTE_PRESETS, deletePalette, renamePalette } from '../lib/backgroundLibrary';
import type { FileResult } from '../utils/fileIO';

const ok: FileResult = { ok: true };
const builtIn = (kind: string, id: string, name: string, hint: string | undefined, record: Record<string, unknown>): PresetItem =>
  ({ kind, id, name, savedAt: 0, builtIn: true, ...(hint ? { hint } : {}), record });

/** What each builder is called in the app (docs/glossary.md: "Builder" is only the Scene builders). */
export const BUILDER_LABELS: Record<PresetBuilderKind, string> = {
  '3d': '3D Scene builder', '2d': '2D Scene builder', grid: 'Grid builder', warp: 'Warp builder',
  gridRules: 'Grid Rules builder', splat: 'Splat builder', timecube: 'Time Cube builder', agents: 'Agents builder',
};
export const builderPresetKind = (k: PresetBuilderKind) => `builder:${k}`;

const KINDS: PresetKindDef[] = [
  // ── Nodes in the graph ──
  {
    id: 'group', label: 'Groups', appliesTo: 'a group of nodes', group: 'nodes',
    storage: { t: 'prefix', prefix: 'shader-studio:gp:', nameField: 'label' }, folderScope: 'presets:group', events: [], idPrefix: 'gp', hintField: 'description',
    valid: r => !!r.subgraph,
    builtIns: () => COMPOUND_EFFECTS.map(c => builtIn('group', c.id, c.label, c.description, { compound: c.id })),
    afterWrite: () => useNodeGraphStore.setState({ groupPresets: loadGroupPresets() }),
    ops: { remove: id => { useNodeGraphStore.getState().deleteGroupPreset(id); return ok; } },
  },
  {
    id: 'transform', label: 'Vector transforms', appliesTo: 'Transform Vec node', group: 'nodes',
    storage: { t: 'prefix', prefix: 'shader-studio:tp:', nameField: 'label' }, folderScope: 'presets:transform', events: ['transformpreset-changed'], idPrefix: 'tp', hintField: 'comment',
  },
  {
    id: 'customFn', label: 'Functions', appliesTo: 'Custom Function node', group: 'nodes',
    storage: { t: 'prefix', prefix: 'shader-studio:cfp:', nameField: 'label' }, folderScope: 'functions', events: ['customfn-changed'], idPrefix: 'cfp', hintField: 'comment',
    // Its file in the presets folder goes too (desktop).
    ops: { remove: id => { useNodeGraphStore.getState().deleteCustomFn(id); return ok; } },
  },
  {
    id: 'expr', label: 'Expression Blocks', appliesTo: 'Expression Block node', group: 'nodes',
    storage: { t: 'prefix', prefix: 'shader-studio:ep:', nameField: 'label' }, folderScope: 'expressions', events: ['exprpreset-changed'], idPrefix: 'ep', hintField: 'comment',
  },
  {
    id: 'keyframe', label: 'Keyframe curves', appliesTo: 'the keyframe editor', group: 'nodes',
    storage: { t: 'prefix', prefix: 'shader-studio:kfp:', nameField: 'label' }, folderScope: 'keyframes', events: ['keyframepreset-changed'], idPrefix: 'kfp',
    valid: r => Array.isArray(r.keyframes),
  },
  // ── Scene builders ──
  ...PRESET_BUILDER_KINDS.map((k): PresetKindDef => {
    const store = () => builderPresets(k);
    return {
      id: builderPresetKind(k), label: BUILDER_LABELS[k], appliesTo: BUILDER_LABELS[k], group: 'builders',
      storage: { t: 'list', key: presetStorageKey(k), nameField: 'name' }, folderScope: `presets:builder:${k}`, events: [], idPrefix: 'up',
      // No built-ins here: each builder's strip draws its own (at most four, builders/stripPresets.ts).
      thumbField: 'thumb', timeField: 'createdAt', valid: r => typeof r.recipe === 'string',
      afterWrite: () => store().getState().reload(),
      // The builders' strips read the in-memory list (a preset too big for storage stays until reload).
      ops: {
        list: () => store().getState().presets.map(p => ({ kind: builderPresetKind(k), id: p.id, name: p.name, savedAt: p.createdAt, thumb: p.thumb, record: p as unknown as Record<string, unknown> })),
        save: (name, data, extra) => {
          const { preset, stored } = store().getState().add(name, typeof data.recipe === 'string' ? data.recipe : '', extra.thumb ?? null);
          return stored ? { ok: true, id: preset.id } : { ok: false, id: preset.id, error: 'This browser’s storage is full: it is kept until you reload.' };
        },
        rename: (id, name) => { store().getState().rename(id, name); return ok; },
        remove: id => { store().getState().remove(id); return ok; },
      },
    };
  }),
  {
    id: 'spaceBlock', label: 'Space blocks', appliesTo: '2D Scene builder', group: 'builders',
    storage: { t: 'list', key: SAVED_BLOCKS_KEY, nameField: 'name' }, folderScope: 'presets:spaceBlock', events: [SAVED_BLOCKS_CHANGED], idPrefix: 'sblk',
    thumbField: 'thumb', hintField: 'blurb', valid: r => !!parseSavedBlock(r),
  },
  // ── Play ──
  {
    id: 'layerSet', label: 'Layer sets', appliesTo: 'Play’s layers', group: 'play',
    storage: { t: 'list', key: LAYER_SETS_KEY, nameField: 'name' }, folderScope: 'presets:layerSet', events: [LAYER_SETS_CHANGED], idPrefix: 'lset',
    thumbField: 'poster', hintField: 'note', valid: r => !!parseLayerSet(r),
  },
  {
    id: 'rackPreset', label: 'Racks', appliesTo: 'the Audio engine', group: 'play',
    storage: { t: 'list', key: RACK_PRESETS_KEY, nameField: 'name' }, folderScope: 'presets:rackPreset', events: [RACK_PRESETS_CHANGED], idPrefix: 'rpre',
    hintField: 'note', valid: r => !!parseRackPreset(r),
  },
  {
    id: 'drumKit', label: 'Drum kits', appliesTo: 'a Drum pads layer', group: 'play',
    storage: { t: 'list', key: DRUM_KITS_KEY, nameField: 'name' }, folderScope: 'presets:drumKit', events: [DRUM_KITS_CHANGED], idPrefix: 'kit',
    hintField: 'description', valid: r => !!parseDrumKit(r),
    builtIns: () => BUILTIN_KITS.map(k => builtIn('drumKit', k.id, k.name, k.description, k as unknown as Record<string, unknown>)),
  },
  // ── Finish ──
  {
    id: 'finishStack', label: 'Finish presets', appliesTo: 'the Finish (the whole picture)', group: 'finish',
    storage: { t: 'list', key: FINISH_PRESETS_KEY, nameField: 'name' }, folderScope: 'presets:finishStack', events: [FINISH_LIBRARY_CHANGED], idPrefix: 'fstk',
    valid: r => !!parseStackPreset(r),
    // The grade's Looks and a few starting stacks (play/finishPresets.ts).
    builtIns: () => BUILTIN_FINISH_PRESETS.map(p => builtIn('finishStack', p.id, p.name, p.description, p as unknown as Record<string, unknown>)),
  },
  {
    id: 'finishEffect', label: 'Finish effects', appliesTo: 'the Finish stack', group: 'finish',
    storage: { t: 'list', key: FINISH_EFFECTS_KEY, nameField: 'name' }, folderScope: 'presets:finishEffect', events: [FINISH_LIBRARY_CHANGED], idPrefix: 'fx',
    hintField: 'description', valid: r => !!parseSavedEffect(r),
  },
  {
    id: 'finishLook', label: 'Looks', appliesTo: 'a Finish grade', group: 'finish',
    storage: { t: 'list', key: 'shader-studio:finish-looks', nameField: 'name' }, folderScope: 'presets:finishLook', events: [SAVED_LOOKS_CHANGED], idPrefix: 'look',
    valid: r => !!r.values && typeof r.values === 'object',
  },
  // ── Colour ──
  {
    id: 'palette', label: 'Palettes', appliesTo: 'Palette node', group: 'colour',
    storage: { t: 'list', key: 'shader-studio:palette-presets', nameField: 'name' }, folderScope: 'presets:palette', events: [PALETTE_PRESETS_CHANGED], idPrefix: 'pp',
    valid: r => r.kind === 'cosine' || r.kind === 'stops',
  },
  {
    id: 'bgPalette', label: 'Background palettes', appliesTo: 'backgrounds and gradients', group: 'colour',
    storage: { t: 'list', key: BG_PALETTES_KEY, nameField: 'name' }, folderScope: PALETTE_FOLDER_SCOPE, events: [BACKGROUNDS_CHANGED], idPrefix: 'pal',
    // As the backgrounds library reads them (lib/backgroundLibrary.ts readPalettes): stops of [r, g, b].
    timeField: 'createdAt', valid: r => Array.isArray(r.stops) && r.stops.some(s => !!s && typeof s === 'object' && Array.isArray((s as { color?: unknown }).color)),
    builtIns: () => BG_PALETTE_PRESETS.map(p => builtIn('bgPalette', p.id, p.name, undefined, p as unknown as Record<string, unknown>)),
    ops: {
      rename: (id, name) => { renamePalette(id, name); return ok; },
      remove: id => (deletePalette(id) ? ok : { ok: false, error: 'That palette is gone.' }),
    },
  },
];

for (const k of KINDS) registerPresetKind(k);

