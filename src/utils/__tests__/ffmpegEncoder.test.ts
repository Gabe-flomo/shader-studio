/**
 * The desktop MP4's encoder (the Record dialog's Speed; src-tauri/src/export_codecs.rs): hardware VideoToolbox when the
 * FFmpeg has it (probed once), x264 otherwise; a hardware encode that fails starts over with x264; other codecs never
 * pass an encoder.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  calls: [] as Array<{ cmd: string; args: unknown }>,
  hw: ['h264_videotoolbox', 'hevc_videotoolbox'] as string[],
  probes: 0,
  failHardwareAtFrame: -1, encoder: undefined as string | undefined, sent: 0,
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args?: unknown) => {
    state.calls.push({ cmd, args });
    if (cmd === 'ffmpeg_hw_encoders') { state.probes++; return state.hw; }
    if (cmd === 'start_ffmpeg_encode') { state.encoder = (args as { encoder?: string }).encoder; state.sent = 0; }
    if (cmd === 'send_frame_rgba' && state.failHardwareAtFrame >= 0 && state.encoder === 'hardware' && state.sent++ >= state.failHardwareAtFrame) {
      throw new Error('FFmpeg stdin write error: Broken pipe');
    }
    return undefined;
  },
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: async () => '/tmp/out.mp4' }));

import { hardwareEncoders, resetHardwareProbe, resolveMp4Encoder, runFfmpegEncode, type FfmpegEncodeOptions } from '../ffmpegRecorder';

const base = (o: Partial<FfmpegEncodeOptions> = {}): FfmpegEncodeOptions => ({
  width: 4, height: 2, fps: 10, duration: 0.3, codec: 'h264', outputPath: '/tmp/x.mp4',
  renderFrame: () => {}, readPixels: out => { out.fill(1); }, ...o,
});
const starts = () => state.calls.filter(c => c.cmd === 'start_ffmpeg_encode').map(c => c.args as Record<string, unknown>);

beforeEach(() => {
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  state.calls = []; state.hw = ['h264_videotoolbox', 'hevc_videotoolbox']; state.probes = 0; state.failHardwareAtFrame = -1;
  resetHardwareProbe();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('resolveMp4Encoder', () => {
  it('auto and hardware take VideoToolbox when it is there, else x264', () => {
    const hw = ['h264_videotoolbox', 'hevc_videotoolbox'];
    expect(resolveMp4Encoder('auto', hw)).toBe('hardware');
    expect(resolveMp4Encoder(undefined, hw)).toBe('hardware');
    expect(resolveMp4Encoder('hardware_hevc', hw)).toBe('hardware_hevc');
    expect(resolveMp4Encoder('x264', hw)).toBe('x264');
    expect(resolveMp4Encoder('auto', [])).toBe('x264');
    expect(resolveMp4Encoder('hardware', [])).toBe('x264');
    expect(resolveMp4Encoder('hardware_hevc', ['h264_videotoolbox'])).toBe('hardware');
  });
});

describe('the MP4 encode', () => {
  it('asks the FFmpeg once, and starts with hardware H.264 by default', async () => {
    const used: string[] = [];
    await runFfmpegEncode(base({ onEncoder: e => used.push(e) }));
    await runFfmpegEncode(base());
    expect(state.probes).toBe(1);
    expect(starts().map(a => a.encoder)).toEqual(['hardware', 'hardware']);
    expect(used).toEqual(['hardware']);
    expect(await hardwareEncoders()).toEqual(['h264_videotoolbox', 'hevc_videotoolbox']);
  });

  it('x264 when asked (no probe), or when the FFmpeg has no hardware encoder', async () => {
    await runFfmpegEncode(base({ encoder: 'x264' }));
    expect(state.probes).toBe(0);
    state.hw = [];
    await runFfmpegEncode(base({ encoder: 'hardware' }));
    expect(starts().map(a => a.encoder)).toEqual(['x264', 'x264']);
  });

  it('a hardware encode that fails starts over with x264 from the first frame', async () => {
    state.failHardwareAtFrame = 1;
    const rendered: number[] = [];
    const restarts: string[] = [];
    const path = await runFfmpegEncode(base({ renderFrame: t => { rendered.push(t); }, onRestart: why => restarts.push(why) }));
    expect(path).toBe('/tmp/x.mp4');
    expect(starts().map(a => a.encoder)).toEqual(['hardware', 'x264']);
    expect(restarts).toHaveLength(1);
    expect(restarts[0]).toMatch(/Broken pipe/);
    // Two frames on hardware, then all three again.
    expect(rendered).toEqual([0, 0.1, 0, 0.1, 0.2]);
    expect(state.calls.filter(c => c.cmd === 'stop_ffmpeg_encode')).toHaveLength(2);
  });

  it('Cancel is never retried', async () => {
    await expect(runFfmpegEncode(base({ renderFrame: () => { throw new Error('cancelled'); } }))).rejects.toThrow('cancelled');
    expect(starts()).toHaveLength(1);
  });

  it('other codecs pass no encoder', async () => {
    await runFfmpegEncode(base({ codec: 'ffv1', outputPath: '/tmp/x.mkv' }));
    await runFfmpegEncode(base({ codec: 'prores4444', outputPath: '/tmp/x.mov' }));
    expect(starts().every(a => !('encoder' in a))).toBe(true);
    expect(state.probes).toBe(0);
  });
});
