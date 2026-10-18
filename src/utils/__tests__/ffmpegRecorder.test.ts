/**
 * The desktop export's frames reach FFmpeg as raw bytes: each frame is the whole payload of
 * send_frame_rgba, never `{ data: frame }`, which Tauri sends as a JSON array of numbers
 * (about half a second a 1080p frame: most of a 25 s export's ~700 s).
 */
import { describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as Array<{ cmd: string; args: unknown }>);
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args?: unknown) => { calls.push({ cmd, args }); },
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: async () => '/tmp/out.mp4' }));

import { runFfmpegEncode } from '../ffmpegRecorder';

describe('runFfmpegEncode', () => {
  it('sends each frame as the request body (binary), one per frame, then stops', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    try {
      const rendered: number[] = [];
      const path = await runFfmpegEncode({
        width: 4, height: 2, fps: 10, duration: 0.3, codec: 'h264', outputPath: '/tmp/x.mp4',
        renderFrame: t => { rendered.push(t); },
        readPixels: (out) => { out.fill(7); },
      });
      expect(path).toBe('/tmp/x.mp4');
      expect(rendered).toHaveLength(3);
      const frames = calls.filter(c => c.cmd === 'send_frame_rgba');
      expect(frames).toHaveLength(3);
      for (const f of frames) {
        expect(f.args).toBeInstanceOf(Uint8Array);
        expect((f.args as Uint8Array).length).toBe(4 * 2 * 4);
      }
      expect(calls.map(c => c.cmd).filter(c => c !== 'ffmpeg_hw_encoders')).toEqual(['start_ffmpeg_encode', 'send_frame_rgba', 'send_frame_rgba', 'send_frame_rgba', 'stop_ffmpeg_encode']);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
