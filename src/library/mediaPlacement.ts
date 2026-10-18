/**
 * mediaPlacement.ts — a picture, video or sound from the media library put on the graph
 * (docs/library.md, "Media"): the Library's click, double-click and drag all come here.
 *
 *   picture  a Texture node showing it (the library's copy: nothing is stored twice)
 *   video    a Texture node on its Video source playing it (muted, as every Texture video is)
 *   sound    an Audio Source on its File tab with the sound loaded, paused (press play on the card)
 *
 * Only the node's params are written: each source opens its file from the library by itself, as it
 * does when a saved graph opens (the Texture node's picture restorer, the video engine, the audio
 * engine), so there is one way in and nothing to keep in step.
 *
 * A picture or a video is wired into the Output's Color when the Output has nothing there yet, so
 * a drop on an empty graph shows straight away; otherwise it is left for you to wire.
 */
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { AUDIO_SOURCE_TYPE } from '../nodes/definitions/audioTools';

export type MediaKind = 'image' | 'video' | 'sound';

export interface MediaRef {
  kind: MediaKind;
  /** The library id (an image's, or a video's / sound's in the video library). */
  id: string;
  name: string;
  /** The library's small picture of it (shown on the card until the file is open). */
  thumb?: string;
}

/** Which node a media item becomes, and the params it starts with (pure: tests read it). */
export function mediaNodeFor(m: MediaRef): { type: string; params: Record<string, unknown> } {
  switch (m.kind) {
    case 'image': return { type: 'textureInput', params: { libraryId: m.id, _imageName: m.name, ...(m.thumb ? { _thumbnailUrl: m.thumb } : {}) } };
    case 'video': return { type: 'videoInput', params: { videoId: m.id, _fileName: m.name, _isPlaying: true } };
    case 'sound': return { type: AUDIO_SOURCE_TYPE, params: { source: 'file', sampleId: m.id, _fileName: m.name, playing: false } };
  }
}

/** Put a media item on the graph at `pos`; the new node's id. */
export function placeMedia(m: MediaRef, pos: { x: number; y: number }): string | null {
  const st = useNodeGraphStore.getState();
  const { type, params } = mediaNodeFor(m);
  const id = st.addNode(type, pos, params);
  if (!id) return null;
  if (m.kind !== 'sound') wireToOutput(id);
  return id;
}

/** Into the Output's Color, when the open graph (not a group) has an Output with nothing there. */
function wireToOutput(id: string): void {
  const st = useNodeGraphStore.getState();
  if (st.activeGroupPath?.length) return;
  const out = st.nodes.find(n => n.type === 'output');
  if (!out || out.inputs.color?.connection) return;
  st.connectNodes(id, 'color', out.id, 'color');
}
