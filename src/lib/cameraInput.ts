/**
 * cameraInput.ts — the webcam for camera layers (and what particles, glyphs
 * and contours can read instead of the picture). One shared <video>; it
 * starts from a click (the browser asks for permission the first time) and
 * stops when asked or when no camera layer is left.
 */

export type CameraStatus = 'off' | 'requesting' | 'on' | 'denied' | 'unsupported';

class CameraInput {
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private status: CameraStatus = typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function' ? 'off' : 'unsupported';
  private listeners = new Set<(s: CameraStatus) => void>();

  getStatus(): CameraStatus { return this.status; }

  onStatus(cb: (s: CameraStatus) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private setStatus(s: CameraStatus): void {
    this.status = s;
    for (const l of this.listeners) l(s);
  }

  /** The playing video, or null while the camera is off. */
  element(): HTMLVideoElement | null {
    return this.status === 'on' ? this.video : null;
  }

  /** Call from a click. */
  async start(): Promise<CameraStatus> {
    if (this.status === 'unsupported' || this.status === 'on') return this.status;
    this.setStatus('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      const video = this.video ?? document.createElement('video');
      video.muted = true; video.playsInline = true; video.autoplay = true;
      video.srcObject = stream;
      await video.play().catch(() => {});
      this.video = video; this.stream = stream;
      this.setStatus('on');
    } catch (e) {
      console.warn('[camera] could not open the camera', e);
      this.setStatus('denied');
    }
    return this.status;
  }

  stop(): void {
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    if (this.status !== 'unsupported') this.setStatus('off');
  }
}

export const cameraInput = new CameraInput();
