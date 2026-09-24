import * as THREE from 'three';

/** How long to wait for `loadeddata` before giving up on a video file. */
const VIDEO_LOAD_TIMEOUT_MS = 20_000;

/** Turn a MediaError into something a user can act on. */
function describeMediaError(err: MediaError | null): string {
  if (!err) return 'unknown decode error';
  switch (err.code) {
    case MediaError.MEDIA_ERR_ABORTED:           return 'loading was aborted';
    case MediaError.MEDIA_ERR_NETWORK:           return 'the file could not be read';
    case MediaError.MEDIA_ERR_DECODE:            return 'the file is corrupt or uses a codec this browser cannot decode';
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED: return 'this format is not supported by the browser';
    default: return err.message || `media error ${err.code}`;
  }
}

class VideoEngine {
  private videos = new Map<string, HTMLVideoElement>();
  private textures = new Map<string, THREE.VideoTexture>();

  /**
   * Decode `file` into a looping, muted <video> and wrap it in a VideoTexture.
   * Rejects — instead of hanging forever — when the browser can't decode the
   * file (unsupported codec/container, corrupt data) or when `loadeddata`
   * never arrives within `timeoutMs`.
   */
  loadVideo(nodeId: string, file: File, timeoutMs = VIDEO_LOAD_TIMEOUT_MS): Promise<void> {
    return new Promise((resolve, reject) => {
      this.disposeNode(nodeId);
      const video = document.createElement('video');
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      const url = URL.createObjectURL(file);
      video.src = url;

      // Exactly one of onloadeddata / onerror / the timer settles the promise;
      // the rest become no-ops.
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        video.onloadeddata = null;
        video.onerror = null;
        fn();
      };
      const fail = (reason: string) => settle(() => {
        // Stop the decoder and drop the blob URL; the element was never
        // registered so disposeNode() won't find it.
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
        const error = new Error(`Could not load video "${file.name}": ${reason}`);
        console.error('[videoEngine]', error.message);
        reject(error);
      });

      const timer = setTimeout(
        () => fail(`no video data after ${Math.round(timeoutMs / 1000)}s (the file may be in a format this browser can't play)`),
        timeoutMs,
      );
      video.onerror = () => fail(describeMediaError(video.error));
      video.onloadeddata = () => settle(() => {
        const tex = new THREE.VideoTexture(video);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.format = THREE.RGBAFormat;
        this.videos.set(nodeId, video);
        this.textures.set(nodeId, tex);
        resolve();
      });
      video.load();
    });
  }

  getTexture(nodeId: string): THREE.VideoTexture | null {
    return this.textures.get(nodeId) ?? null;
  }

  play(nodeId: string) { this.videos.get(nodeId)?.play(); }
  pause(nodeId: string) { this.videos.get(nodeId)?.pause(); }
  isLoaded(nodeId: string) { return this.videos.has(nodeId); }
  isPlaying(nodeId: string) { return !(this.videos.get(nodeId)?.paused ?? true); }

  setLoop(nodeId: string, loop: boolean) {
    const v = this.videos.get(nodeId);
    if (v) v.loop = loop;
  }

  setSpeed(nodeId: string, rate: number) {
    const v = this.videos.get(nodeId);
    if (v) v.playbackRate = rate;
  }

  disposeNode(nodeId: string) {
    const v = this.videos.get(nodeId);
    if (v) { v.pause(); URL.revokeObjectURL(v.src); }
    this.textures.get(nodeId)?.dispose();
    this.videos.delete(nodeId);
    this.textures.delete(nodeId);
  }

  disposeAll() {
    for (const id of [...this.videos.keys()]) this.disposeNode(id);
  }
}

export const videoEngine = new VideoEngine();
