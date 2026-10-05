/** Bake's encoders (docs/bake.md): the WebM the browser path writes, and the desktop path's FFmpeg plumbing. */
import { describe, expect, it } from 'vitest';
import { muxWebm, vint } from '../../../utils/webmMuxer';
import { desktopEncoder, rgbaToI420, webBitrate } from '../encode';
import { planBake, DEFAULT_BAKE } from '../plan';

/** A minimal EBML reader: an element's id, its data's start and size. */
function readVint(b: Uint8Array, at: number, keepMarker: boolean): { value: number; len: number } {
  const first = b[at];
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  let value = keepMarker ? first : first & (0xff >> len);
  for (let i = 1; i < len; i++) value = value * 256 + b[at + i];
  return { value, len };
}
function children(b: Uint8Array, start: number, end: number): { id: number; at: number; data: number; size: number }[] {
  const out = [];
  let p = start;
  while (p < end) {
    const id = readVint(b, p, true);
    const size = readVint(b, p + id.len, false);
    const data = p + id.len + size.len;
    out.push({ id: id.value, at: p, data, size: size.value });
    p = data + size.value;
  }
  return out;
}
const uint = (b: Uint8Array, at: number, size: number) => { let v = 0; for (let i = 0; i < size; i++) v = v * 256 + b[at + i]; return v; };

describe('webmMuxer', () => {
  it('sizes as variable-length integers', () => {
    expect([...vint(0)]).toEqual([0x80]);
    expect([...vint(126)]).toEqual([0xfe]);
    expect([...vint(127)]).toEqual([0x40, 0x7f]);
    expect([...vint(300)]).toEqual([0x41, 0x2c]);
  });

  it('writes a WebM whose Cues point at its clusters, one per keyframe, with exact times', () => {
    const fps = 30;
    const frames = Array.from({ length: 45 }, (_, i) => ({ data: new Uint8Array([i, i, i]), timestampUs: Math.round(i * 1e6 / fps), key: i % 15 === 0 }));
    const file = muxWebm(frames, { codec: 'vp9', width: 64, height: 36, fps, duration: 1.5 });
    const top = children(file, 0, file.length);
    expect(top.map(e => e.id)).toEqual([0x1a45dfa3, 0x18538067]);
    const header = children(file, top[0].data, top[0].data + top[0].size);
    const docType = header.find(e => e.id === 0x4282)!;
    expect(new TextDecoder().decode(file.subarray(docType.data, docType.data + docType.size))).toBe('webm');
    const seg = top[1];
    expect(seg.data + seg.size).toBe(file.length);
    const level1 = children(file, seg.data, seg.data + seg.size);
    expect(level1.map(e => e.id)).toEqual([0x114d9b74, 0x1549a966, 0x1654ae6b, 0x1c53bb6b, 0x1f43b675, 0x1f43b675, 0x1f43b675]);
    // SeekHead → Info, Tracks, Cues at their offsets from the segment's data.
    const seeks = children(file, level1[0].data, level1[0].data + level1[0].size).map(s => children(file, s.data, s.data + s.size));
    const positions = seeks.map(s => { const p = s.find(e => e.id === 0x53ac)!; return uint(file, p.data, p.size); });
    expect(positions.map(p => seg.data + p)).toEqual([level1[1].at, level1[2].at, level1[3].at]);
    // Cues → each cluster, at the time of its keyframe.
    const cues = children(file, level1[3].data, level1[3].data + level1[3].size);
    const cueInfo = cues.map(c => {
      const kids = children(file, c.data, c.data + c.size);
      const time = kids.find(e => e.id === 0xb3)!;
      const tp = kids.find(e => e.id === 0xb7)!;
      const pos = children(file, tp.data, tp.data + tp.size).find(e => e.id === 0xf1)!;
      return { time: uint(file, time.data, time.size), at: seg.data + uint(file, pos.data, pos.size) };
    });
    expect(cueInfo.map(c => c.time)).toEqual([0, 500, 1000]);
    expect(cueInfo.map(c => c.at)).toEqual(level1.slice(4).map(c => c.at));
    // 15 SimpleBlocks per cluster, the first a keyframe, relative times in ms.
    const cluster = children(file, level1[5].data, level1[5].data + level1[5].size);
    const blocks = cluster.filter(e => e.id === 0xa3);
    expect(blocks).toHaveLength(15);
    expect(file[blocks[0].data + 3] & 0x80).toBe(0x80);
    expect(file[blocks[1].data + 3] & 0x80).toBe(0);
    const rel = (blk: { data: number }) => (file[blk.data + 1] << 8) | file[blk.data + 2];
    expect(rel(blocks[1])).toBe(33);
    expect(rel(blocks[14])).toBe(467);
  });

  it('refuses to start on a frame that isn’t a keyframe', () => {
    expect(() => muxWebm([{ data: new Uint8Array(1), timestampUs: 0, key: false }], { codec: 'vp8', width: 2, height: 2, fps: 1, duration: 1 })).toThrow();
  });

  it('RGBA to I420: BT.601 limited range (black 16, white 235, neutral chroma 128)', () => {
    // 2×2 pixels: black, white, pure red, mid grey.
    const rgba = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255, 128, 128, 128, 255]);
    const out = new Uint8Array(6);
    rgbaToI420(rgba, 2, 2, out);
    expect([...out.subarray(0, 4)]).toEqual([16, 235, 81, 126]);
    // One chroma sample for the block: the average colour (≈ 159, 96, 96) is reddish.
    expect(out[4]).toBeLessThan(128);
    expect(out[5]).toBeGreaterThan(150);
    const grey = new Uint8Array(16).fill(200);
    rgbaToI420(grey, 2, 2, out);
    expect([out[4], out[5]]).toEqual([128, 128]);
  });

  it('bitrate scales with pixels within limits', () => {
    expect(webBitrate(64, 64, 30)).toBe(2e6);
    expect(webBitrate(1920, 1080, 30)).toBe(Math.round(1920 * 1080 * 30 * 0.25));
    expect(webBitrate(8000, 8000, 60)).toBe(80e6);
  });
});

describe('desktop encoder (FFmpeg plumbing)', () => {
  it('starts FFmpeg with the bake codec at the frame size, sends raw frames, takes the file back', async () => {
    const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
    const invoke = async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
      calls.push({ cmd, args });
      if (cmd === 'bake_temp_path') return '/tmp/playfield-bake-1-2.mp4' as T;
      if (cmd === 'bake_take_file') return new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]).buffer as T;
      return undefined as T;
    };
    const plan = planBake({ ...DEFAULT_BAKE, duration: 0.1, fps: 30, alpha: true }, 64, 36);
    const enc = await desktopEncoder(plan, invoke);
    expect(enc.ext).toBe('mp4');
    const frame = new Uint8Array(plan.frameWidth * plan.frameHeight * 4);
    for (let i = 0; i < plan.frames; i++) await enc.addFrame(frame, i);
    const blob = await enc.finish();
    expect(blob.type).toBe('video/mp4');
    expect(blob.size).toBe(8);
    expect(calls[0]).toEqual({ cmd: 'bake_temp_path', args: { ext: 'mp4' } });
    // An alpha bake's frame is twice as tall (colour above alpha).
    expect(calls[1]).toEqual({ cmd: 'start_ffmpeg_encode', args: { outputPath: '/tmp/playfield-bake-1-2.mp4', width: 64, height: 72, fps: 30, codec: 'bake', audioWav: null } });
    expect(calls.filter(c => c.cmd === 'send_frame_rgba')).toHaveLength(plan.frames);
    expect(calls.slice(-2).map(c => c.cmd)).toEqual(['stop_ffmpeg_encode', 'bake_take_file']);
  });

  it('cancel stops FFmpeg and removes the half-written file', async () => {
    const calls: string[] = [];
    const invoke = async <T,>(cmd: string): Promise<T> => { calls.push(cmd); return (cmd === 'bake_temp_path' ? '/tmp/playfield-bake-x.mp4' : undefined) as T; };
    const enc = await desktopEncoder(planBake(DEFAULT_BAKE, 32, 32), invoke);
    await enc.cancel();
    expect(calls).toEqual(['bake_temp_path', 'start_ffmpeg_encode', 'stop_ffmpeg_encode', 'bake_discard_file']);
  });
});
