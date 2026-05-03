import * as THREE from 'three';

class VideoEngine {
  private videos = new Map<string, HTMLVideoElement>();
  private textures = new Map<string, THREE.VideoTexture>();

  loadVideo(nodeId: string, file: File): Promise<void> {
    return new Promise((resolve) => {
      this.disposeNode(nodeId);
      const video = document.createElement('video');
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.src = URL.createObjectURL(file);
      video.onloadeddata = () => {
        const tex = new THREE.VideoTexture(video);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.format = THREE.RGBAFormat;
        this.videos.set(nodeId, video);
        this.textures.set(nodeId, tex);
        resolve();
      };
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
