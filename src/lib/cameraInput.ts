/**
 * cameraInput.ts — the webcam for camera layers (and what particles, glyphs
 * and contours can read instead of the picture). One shared <video>; it
 * starts from a click (the browser asks for permission the first time) and
 * stops when asked or when nothing uses it (lib/cameraKeeper.ts).
 *
 * Any video input the system sees can be the source: the built-in camera, an
 * iPhone through Continuity Camera, an HDMI capture card, a DSLR's webcam
 * utility or a virtual camera (OBS). The choice and the resolution are
 * remembered on this machine (devices differ between computers); if the chosen
 * one is missing the default camera opens instead, and says so.
 */

export type CameraStatus = 'off' | 'requesting' | 'on' | 'denied' | 'unsupported';
export type CameraResolution = '720p' | '1080p';

const DEVICE_KEY = 'shader-studio:cameraDevice';
const RES_KEY = 'shader-studio:cameraResolution';
const RES: Record<CameraResolution, { width: number; height: number }> = { '720p': { width: 1280, height: 720 }, '1080p': { width: 1920, height: 1080 } };

function load(key: string): string {
  try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
}
function save(key: string, value: string): void {
  try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch { /* not remembered */ }
}

class CameraInput {
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private status: CameraStatus = typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function' ? 'off' : 'unsupported';
  private listeners = new Set<(s: CameraStatus) => void>();
  private deviceId = load(DEVICE_KEY);
  private resolution: CameraResolution = load(RES_KEY) === '1080p' ? '1080p' : '720p';
  private label = '';
  /** Set when the chosen camera wasn't there and the default opened instead. */
  private fellBack = false;
  private deviceListeners = new Set<() => void>();
  private watchingDevices = false;

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

  /** The chosen camera ('' = the system default), its label while on, and the resolution. */
  getDeviceId(): string { return this.deviceId; }
  getLabel(): string { return this.label; }
  getResolution(): CameraResolution { return this.resolution; }
  /** True when the chosen camera was missing and the default opened instead. */
  usedFallback(): boolean { return this.fellBack; }

  /** Every video input the system sees (labels appear once camera access is allowed). */
  async devices(): Promise<Array<{ id: string; label: string }>> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter(d => d.kind === 'videoinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  }

  /** Told when cameras are plugged in or out. */
  onDevices(cb: () => void): () => void {
    this.deviceListeners.add(cb);
    if (!this.watchingDevices && typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
      this.watchingDevices = true;
      navigator.mediaDevices.addEventListener('devicechange', () => { for (const l of this.deviceListeners) l(); });
    }
    return () => { this.deviceListeners.delete(cb); };
  }

  /** Pick a camera (or '' for the default). If the camera is on, it switches now. */
  async setDevice(id: string): Promise<CameraStatus> {
    this.deviceId = id;
    save(DEVICE_KEY, id);
    return this.status === 'on' ? this.restart() : this.status;
  }

  /** 720p (lighter, better for hand tracking) or 1080p. If the camera is on, it reopens. */
  async setResolution(r: CameraResolution): Promise<CameraStatus> {
    this.resolution = r;
    save(RES_KEY, r);
    return this.status === 'on' ? this.restart() : this.status;
  }

  private async restart(): Promise<CameraStatus> {
    this.release();
    this.status = 'off';
    return this.start();
  }

  /** Call from a click. */
  async start(): Promise<CameraStatus> {
    if (this.status === 'unsupported' || this.status === 'on') return this.status;
    this.setStatus('requesting');
    const size = RES[this.resolution];
    const video = (deviceId?: string): MediaTrackConstraints => ({ width: { ideal: size.width }, height: { ideal: size.height }, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) });
    try {
      let stream: MediaStream;
      this.fellBack = false;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: video(this.deviceId || undefined), audio: false });
      } catch (e) {
        // The chosen camera is unplugged or gone: open the default instead, and say so.
        if (!this.deviceId || (e as DOMException)?.name === 'NotAllowedError') throw e;
        stream = await navigator.mediaDevices.getUserMedia({ video: video(), audio: false });
        this.fellBack = true;
      }
      const el = this.video ?? document.createElement('video');
      el.muted = true; el.playsInline = true; el.autoplay = true;
      el.srcObject = stream;
      await el.play().catch(() => {});
      this.video = el; this.stream = stream;
      this.label = stream.getVideoTracks()[0]?.label ?? '';
      this.setStatus('on');
    } catch (e) {
      console.warn('[camera] could not open the camera', e);
      this.setStatus('denied');
    }
    return this.status;
  }

  private release(): void {
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    this.label = '';
    if (this.video) this.video.srcObject = null;
  }

  stop(): void {
    this.release();
    if (this.status !== 'unsupported') this.setStatus('off');
  }
}

export const cameraInput = new CameraInput();
