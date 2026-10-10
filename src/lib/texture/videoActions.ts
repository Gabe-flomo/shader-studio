/**
 * videoActions.ts — a video onto a Texture node (docs/texture-node.md): a dropped or picked
 * file, one from the video library, or one fetched by URL. The file is kept in the video
 * library (`params.videoId`), never in the graph itself: videos are too big for a saved
 * graph's storage (a series keeps 3 MB of history). A .playfile carries the file
 * (playfile/bundle.ts videoIdsIn). A graph opened where the library doesn't have it shows
 * the video as missing, with Re-link.
 */
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { videoEngine } from '../videoEngine';
import { addVideoFile, getVideo } from '../backgroundLibrary';

export const VIDEO_FILE = /\.(mp4|webm|mov|ogg|ogv|mkv|m4v)$/i;
export const isVideoFile = (f: { name: string; type: string }) => /^video\//.test(f.type) || VIDEO_FILE.test(f.name);
export const isImageFile = (f: { name: string; type: string }) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|avif|bmp|svg|heic)$/i.test(f.name);

/** Play a video file on the node; resolves with an error message, or null when it plays. */
export async function loadVideoIntoNode(nodeId: string, file: File, o: { videoId?: string; url?: string } = {}): Promise<string | null> {
  if (!isVideoFile(file)) return `"${file.name}" is not a video file this browser plays (mp4, webm, mov).`;
  try {
    await videoEngine.loadVideo(nodeId, file);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  const st = useNodeGraphStore.getState();
  st.setVideoTexture(nodeId, videoEngine.getTexture(nodeId));
  videoEngine.play(nodeId);
  // A new file starts with no clip settings (the old ones were for another video).
  st.updateNodeParams(nodeId, {
    _fileName: file.name, _hasFile: true, _isPlaying: true, _thumbnailUrl: videoEngine.url(nodeId) ?? undefined,
    clip: undefined, _videoUrl: o.url || undefined, ...(o.videoId ? { videoId: o.videoId } : {}),
  }, { immediate: true });
  if (o.videoId) { videoEngine.setLibraryId(nodeId, o.videoId); return null; }
  // Kept in the video library so it opens again after a reload (with its clip settings).
  void addVideoFile(file).then(m => {
    videoEngine.setLibraryId(nodeId, m.id);
    useNodeGraphStore.getState().updateNodeParams(nodeId, { videoId: m.id }, { immediate: true });
  }, () => { /* no IndexedDB: this session only */ });
  return null;
}

/** A video from the library onto the node. */
export async function loadLibraryVideo(nodeId: string, videoId: string): Promise<string | null> {
  const got = await getVideo(videoId).catch(() => null);
  if (!got) return 'That video isn’t in this browser’s library any more.';
  const file = new File([got.blob], got.name, { type: got.type || got.blob.type });
  return loadVideoIntoNode(nodeId, file, { videoId });
}

/** Is the node's kept video missing here (named, not open, and not in the library)? */
export async function videoMissing(videoId: string): Promise<boolean> {
  if (!videoId) return false;
  return !(await getVideo(videoId).catch(() => null));
}
