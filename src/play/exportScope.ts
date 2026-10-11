/**
 * exportScope.ts — what a website export supports, and the rest held still (docs/web-export.md, "What
 * comes along").
 *
 * A web export is for backgrounds and light interactivity: the shader, time, the pointer (moving and
 * clicking), keys, scroll-free page embedding, feedback and passes, images, and Play mappings driven
 * by those. Things that need a camera, a model, MIDI or a microphone are not: hand, face and pose
 * tracking, Camera layers and anything reading the camera, MIDI (sources, note triggers, the pad grid,
 * drum pads and racks played from MIDI), live audio and the mic (live sources, audio triggers, readers
 * on the live input, Audio Input nodes with no song, Audio layers), and the Depth node's model.
 *
 * `webExportScope` takes the page's input (play/webInput.ts) and leaves those out: their mappings,
 * sources and actions go, so the controls they drove keep the value they have now (webInputFrom has
 * already baked the live values into the uniforms and layers); their settings and files go, so the
 * page never loads their code or asks for a device. It says what it left out, in plain words, for the
 * export dialog. Pure.
 */
import type { PlayHtmlInput } from './exportHtml';
import { parseHandAnchor, triggerUsesHands, usesHands, type PlayAction, type PlayMapping, type PlayRecord, type PlaySource, type PlaySourceDef, type TriggerSpec } from '../types/play';
import { usesFace, usesPose } from '../types/playTracking';
import type { PlayLayer } from '../types/playLayers';
import { DEPTH_SOURCE_MARK } from '../nodes/definitions/depth';

/** A kind of thing a web page doesn't run. */
export type ExportOut = 'hands' | 'face' | 'pose' | 'camera' | 'midi' | 'mic' | 'depth';
export const EXPORT_OUTS: readonly ExportOut[] = ['hands', 'face', 'pose', 'camera', 'midi', 'mic', 'depth'];

/** What a web export runs, as the dialog and the docs list it. */
export const EXPORT_SUPPORTED: readonly string[] = [
  'the shader, with its time and resolution',
  'the mouse position and clicks',
  'key presses',
  'previous-frame feedback, echo and Pass nodes',
  'images (and small videos and songs in the full player)',
  'Play mappings driven by the mouse, keys, time and the other controls',
];

/** One kind left out: its name, and the sentence the dialog shows. */
export interface ExportFrozen { kind: ExportOut; what: string; why: string }

const NAMES: Record<ExportOut, string> = {
  hands: 'Hand tracking', face: 'Face tracking', pose: 'Body (pose) tracking', camera: 'The camera', midi: 'MIDI', mic: 'The microphone and live audio', depth: 'The Depth node’s model',
};
const WHY: Record<ExportOut, string> = {
  hands: 'Hand tracking won’t work on a web page; those controls will hold their current value.',
  face: 'Face tracking won’t work on a web page; those controls will hold their current value.',
  pose: 'Body tracking won’t work on a web page; those controls will hold their current value.',
  camera: 'The camera won’t work on a web page; Camera layers and layers drawn from the camera are left out, and what they drive holds its current value.',
  midi: 'MIDI won’t work on a web page; controls MIDI moves will hold their current value, and the pad grid and MIDI-played sounds stay quiet.',
  mic: 'The microphone and live audio won’t work on a web page; controls they move will hold their current value.',
  depth: 'The Depth node’s model won’t run on a web page, so its depth reads 0 there. Bake the depth (a video or an image) to bring it along.',
};

/** The sentence for one kind, for tests and the docs. */
export function exportFrozenText(kind: ExportOut): ExportFrozen { return { kind, what: NAMES[kind], why: WHY[kind] }; }

/** What decides a source's kind: the layers left out, the audio inputs with a song, the readers' input. */
interface Ctx { outLayers: ReadonlyMap<string, ExportOut>; songs: ReadonlySet<string>; readersMic: boolean; trackedNulls: ReadonlyMap<string, ExportOut> }

/** A trigger the page can't fire: what it needs, or null. */
export function triggerOut(t: TriggerSpec, ctx: Ctx = EMPTY_CTX): ExportOut | null {
  if (triggerUsesHands(t)) return 'hands';
  switch (t.on) {
    case 'face': return 'face';
    case 'pose': return 'pose';
    case 'note': return 'midi';
    case 'audio': return 'mic';
    case 'reader': return ctx.readersMic ? 'mic' : null;
    case 'zone': return ctx.outLayers.get(t.layerId) ?? null;
    default: return null;
  }
}

/** A Play source the page can't read: what it needs, or null (the mouse, keys, time, other controls…). */
export function sourceOut(s: PlaySource, ctx: Ctx = EMPTY_CTX): ExportOut | null {
  switch (s.kind) {
    case 'hand': return 'hands';
    case 'face': return 'face';
    case 'pose': return 'pose';
    case 'midi': case 'pad': return 'midi';
    case 'live': return 'mic';
    case 'reader': return ctx.readersMic ? 'mic' : null;
    // An Audio Input node's band: its song travels; with no song it listens to the mic.
    case 'audio': return ctx.songs.has(s.nodeId) ? null : 'mic';
    case 'trigger': return triggerOut(s.trigger, ctx);
    case 'sensor': return ctx.outLayers.get(s.layerId) ?? (s.read === 'distance' && parseHandAnchor(s.otherId) ? 'hands' : null);
    case 'null': return ctx.trackedNulls.get(s.layerId) ?? null;
    default: return null;
  }
}

const EMPTY_CTX: Ctx = { outLayers: new Map(), songs: new Set(), readersMic: false, trackedNulls: new Map() };

/** Layers the page leaves out (Camera, Motion from the camera) or hides (drawn from the camera, Audio layers on the mic). */
function layerOut(l: PlayLayer): { kind: ExportOut; drop: boolean } | null {
  if (l.kind === 'camera') return { kind: 'camera', drop: true };
  if (l.kind === 'motion' && l.readFrom === 'camera') return { kind: 'camera', drop: true };
  if ((l.kind === 'particles' || l.kind === 'glyphs' || l.kind === 'contours') && l.readFrom === 'camera') return { kind: 'camera', drop: false };
  // An Audio layer listens to the mic on a page (its song is never saved).
  if (l.kind === 'audio') return { kind: 'mic', drop: false };
  return null;
}

/**
 * The page's input with what a web page doesn't run left out, and what was left out. Mappings, sources,
 * pair mappings and actions reading those go (their controls keep their baked value); tracking, MIDI,
 * camera and mic settings and files go; layers that need the camera go (or hide).
 */
export function webExportScope(input: PlayHtmlInput): { input: PlayHtmlInput; frozen: ExportFrozen[] } {
  const play = input.play;
  const kinds = new Set<ExportOut>();
  // Layers first: what reads from them goes too.
  const outLayers = new Map<string, ExportOut>();
  const dropped = new Set<string>();
  const trackedNulls = new Map<string, ExportOut>();
  for (const l of play.layers) {
    const o = layerOut(l);
    if (o) { outLayers.set(l.id, o.kind); if (o.drop) dropped.add(l.id); if (l.visible !== false || l.kind === 'motion') kinds.add(o.kind); }
    if (l.kind === 'null' && (l.follow === 'hand' || l.follow === 'face' || l.follow === 'pose')) trackedNulls.set(l.id, l.follow === 'hand' ? 'hands' : l.follow);
  }
  const songs = new Set((input.media?.audio ?? []).filter(a => a.src).map(a => a.id));
  const readers = play.audioReaders;
  const readerInput = readers?.input ?? '';
  const readersMic = !!readers?.readers.length && (!readerInput || (!readerInput.includes(':') && !songs.has(readerInput)));
  const ctx: Ctx = { outLayers, songs, readersMic, trackedNulls };

  // What was in use, by the app's own tests (any mention counts).
  if (usesHands(play) || trackedNulls.size && [...trackedNulls.values()].includes('hands')) kinds.add('hands');
  if (usesFace(play)) kinds.add('face');
  if (usesPose(play)) kinds.add('pose');
  if (play.padGrid || play.midiFile) kinds.add('midi');
  if (readersMic) kinds.add('mic');

  const keepMapping = (m: PlayMapping) => {
    const o = sourceOut(m.source, ctx) ?? (m.increment?.on === 'trigger' ? triggerOut(m.increment.trigger, ctx) : null);
    if (o) kinds.add(o);
    return !o;
  };
  const keepSource = (s: PlaySourceDef) => {
    const o = sourceOut(s.source, ctx) ?? s.outputs.reduce<ExportOut | null>((a, out) => a ?? (out.kind === 'step' && out.step.on === 'trigger' ? triggerOut(out.step.trigger, ctx) : null), null);
    if (o) kinds.add(o);
    return !o;
  };
  const keepAction = (a: PlayAction) => { const o = triggerOut(a.trigger, ctx); if (o) kinds.add(o); return !o; };

  // Controls on a layer that is left out go with it (their slider would move nothing).
  const onDropped = (target: string) => { const m = /^layer:(.+)::[^:]+$/.exec(target); return !!m && dropped.has(m[1]); };
  const controls = play.controls.filter(c => !onDropped(c.target));
  const controlIds = new Set(controls.map(c => c.id));

  const out: PlayRecord = {
    ...play,
    controls,
    mappings: play.mappings.filter(m => controlIds.has(m.controlId) && keepMapping(m)),
    layers: play.layers.filter(l => !dropped.has(l.id)).map(l => {
      let x = l;
      if (outLayers.has(l.id) && x.visible !== false) x = { ...x, visible: false } as PlayLayer;
      if (x.trackMatte && dropped.has(x.trackMatte.id)) { x = { ...x }; delete (x as { trackMatte?: unknown }).trackMatte; }
      // Drum pads keep their keys and clicks, not MIDI.
      if (x.kind === 'drumpad' && x.midi) { kinds.add('midi'); x = { ...x, midi: false }; }
      return x;
    }),
  };
  if (play.sources) out.sources = play.sources.filter(keepSource);
  if (play.pairMappings) out.pairMappings = play.pairMappings.filter(m => {
    const o = m.source.kind === 'position' ? (parseHandAnchor(m.source.anchor) ? 'hands' : null) : sourceOut(m.source.source, ctx);
    if (o) kinds.add(o);
    return !o;
  });
  if (play.actions) out.actions = play.actions.filter(keepAction);
  delete out.hands; delete out.face; delete out.pose;
  delete out.padGrid; delete out.midiFile;
  if (readersMic) delete out.audioReaders;
  // Racks keep the keyboard; MIDI doesn't reach them.
  if (out.audioEngine?.racks.some(r => r.midi !== 'off')) {
    if (out.audioEngine.racks.some(r => r.instrument)) kinds.add('midi');
    out.audioEngine = { ...out.audioEngine, racks: out.audioEngine.racks.map(r => (r.midi === 'off' ? r : { ...r, midi: 'off' })) };
  }

  const next: PlayHtmlInput = { ...input, play: out };
  delete next.handAssets;
  if (input.media) {
    const media = { ...input.media };
    delete media.tracks;
    // An Audio Input node with no song listens to the mic on a page: it stays at rest instead.
    if (media.audio?.some(a => !a.src)) { kinds.add('mic'); media.audio = media.audio.filter(a => a.src); }
    next.media = media;
  }
  // A Depth node's live model: its texture reads blank on a page (a baked depth plays as a video or travels as an image).
  const shaders = [input.fragmentShader, ...(input.graphPasses ?? []).map(p => p.fragmentShader)].join('\n');
  for (const m of shaders.matchAll(new RegExp(`${DEPTH_SOURCE_MARK}(u_tex_\\w+)`, 'g'))) {
    const t = input.media?.textures?.[m[1]];
    if (!t?.src && !(t && t.bytes > 0)) kinds.add('depth');
  }
  return { input: next, frozen: EXPORT_OUTS.filter(k => kinds.has(k)).map(exportFrozenText) };
}
