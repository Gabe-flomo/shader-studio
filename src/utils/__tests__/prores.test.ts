/**
 * ProRes export (docs/prores-export.md): the profiles on both paths, the desktop's FFmpeg
 * arguments kept in step with export_codecs.rs, the dialog's notes, alpha kept end to end,
 * and the browser's LGPL encoder loaded lazily and listed with its licence.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  PRORES_PROFILES, effectiveProResProfile, forceOpaque, formatBytes, proresEstimateBytes, proresNotes, proresProfile,
  type ProResNotesInput,
} from '../prores';
import { codecExt } from '../ffmpegRecorder';
import { THIRD_PARTY, thirdParty } from '../../lib/thirdParty';

const ROOT = join(__dirname, '../../..');

describe('ProRes profiles', () => {
  it('maps each profile to its prores_ks number, pixel format, fourcc and desktop codec', () => {
    const rows = PRORES_PROFILES.map(p => [p.id, p.profileNumber, p.pixFmt, p.fourcc, p.ffmpegCodec, p.alpha]);
    expect(rows).toEqual([
      ['4444', 4, 'yuva444p10le', 'ap4h', 'prores4444', true],
      ['4444xq', 5, 'yuva444p10le', 'ap4x', 'prores4444xq', true],
      ['hq', 3, 'yuv422p10le', 'apch', 'prores', false],
      ['422', 2, 'yuv422p10le', 'apcn', 'prores_422', false],
      ['lt', 1, 'yuv422p10le', 'apcs', 'prores_lt', false],
      ['proxy', 0, 'yuv422p10le', 'apco', 'prores_proxy', false],
    ]);
    for (const p of PRORES_PROFILES) expect(codecExt(p.ffmpegCodec)).toBe('mov');
    expect(codecExt('h264')).toBe('mp4');
    expect(codecExt('ffv1')).toBe('mkv');
  });

  it('the desktop FFmpeg arguments (export_codecs.rs) match the table: codec, profile id, pix_fmt, alpha bits', () => {
    const rs = readFileSync(join(ROOT, 'src-tauri/src/export_codecs.rs'), 'utf8');
    expect(rs).toContain('"-c:v", "prores_ks", "-profile:v", profile');
    for (const p of PRORES_PROFILES) {
      const arm = new RegExp(`"${p.ffmpegCodec}" => prores\\("(\\d)", "(\\w+)", (true|false)\\)`).exec(rs);
      expect(arm, p.ffmpegCodec).not.toBeNull();
      expect(Number(arm![1])).toBe(p.profileNumber);
      expect(arm![2]).toBe(p.pixFmt);
      expect(arm![3] === 'true').toBe(p.alpha);
    }
    // The command reads frames as RGBA (alpha included) for every codec.
    const lib = readFileSync(join(ROOT, 'src-tauri/src/lib.rs'), 'utf8');
    expect(lib).toMatch(/"-pix_fmt", "rgba"/);
    expect(lib).toContain('export_codecs::video_codec_args(&codec)');
  });

  it('a transparent export always keeps alpha: 4444 unless 4444 XQ was picked', () => {
    expect(effectiveProResProfile('hq', true).id).toBe('4444');
    expect(effectiveProResProfile('proxy', true).id).toBe('4444');
    expect(effectiveProResProfile('4444xq', true).id).toBe('4444xq');
    expect(effectiveProResProfile('lt', false).id).toBe('lt');
    expect(proresProfile('nope' as never).id).toBe('4444');
  });

  it('estimates the size from Apple’s 1080p rates, scaled by pixels and frame rate', () => {
    // 422 HQ, 1080p at 29.97 fps for 10 s: 220 Mbit/s → 275 MB.
    expect(proresEstimateBytes('hq', 1920, 1080, 29.97, 10)).toBeCloseTo(275e6, -5);
    // 4K is 4× the pixels, 60 fps about 2× the frames.
    const k4 = proresEstimateBytes('4444', 3840, 2160, 60, 1);
    expect(k4 / proresEstimateBytes('4444', 1920, 1080, 30, 1)).toBeCloseTo(8, 5);
    // The alpha plane, which Apple's 4444 rate leaves out: half again.
    expect(proresEstimateBytes('4444', 1920, 1080, 29.97, 1)).toBeCloseTo(330e6 * 1.5 / 8, -3);
    expect(formatBytes(275e6)).toBe('≈ 275 MB');
    expect(formatBytes(2.64e9)).toBe('≈ 2.6 GB');
    expect(formatBytes(800)).toBe('≈ 1 KB');
  });
});

describe('the Record dialog’s ProRes notes', () => {
  const base: ProResNotesInput = { profile: '4444', transparent: true, ownAlpha: true, picture: 'own', wasm: false, hasSound: false, estimateBytes: 1e8 };

  it('says 4444 keeps transparency, with nothing to warn about, when the graph has its own alpha', () => {
    const n = proresNotes(base);
    expect(n.keepsAlpha).toBe(true);
    expect(n.warnings).toEqual([]);
    expect(n.audioAllowed).toBe(true);
  });

  it('warns that an alpha profile with Transparent off makes an opaque file', () => {
    const n = proresNotes({ ...base, transparent: false });
    expect(n.keepsAlpha).toBe(false);
    expect(n.warnings.map(w => w.title)).toEqual(['This file will be opaque']);
  });

  it('warns when the graph has no alpha of its own (opaque output, alpha from brightness)', () => {
    const n = proresNotes({ ...base, ownAlpha: false, picture: 'luma' });
    expect(n.keepsAlpha).toBe(true);
    expect(n.warnings.map(w => w.title)).toEqual(['The graph has no alpha']);
    // Layers only: the alpha is the layers', nothing to warn about.
    expect(proresNotes({ ...base, ownAlpha: false, picture: 'drop' }).warnings).toEqual([]);
  });

  it('no alpha for 422 profiles; transparent ones are lifted to 4444', () => {
    expect(proresNotes({ ...base, profile: 'hq', transparent: false }).keepsAlpha).toBe(false);
    expect(proresNotes({ ...base, profile: 'hq', transparent: false }).warnings).toEqual([]);
    expect(proresNotes({ ...base, profile: 'lt' }).profile.id).toBe('4444');
  });

  it('the browser’s encoder has no audio: sound is off with a note; big files get a memory warning', () => {
    const n = proresNotes({ ...base, wasm: true, hasSound: true, estimateBytes: 3e9 });
    expect(n.audioAllowed).toBe(false);
    expect(n.audioNote).toMatch(/no sound/);
    expect(n.warnings.map(w => w.title)).toEqual(['A big file for a browser']);
    expect(proresNotes({ ...base, wasm: true, hasSound: false }).audioNote).toBeNull();
    // The desktop holds nothing in memory: no warning there.
    expect(proresNotes({ ...base, estimateBytes: 3e9 }).warnings).toEqual([]);
  });

  it('forceOpaque sets every alpha to 255 and leaves colour alone', () => {
    const px = new Uint8Array([10, 20, 30, 0, 40, 50, 60, 128]);
    forceOpaque(px);
    expect([...px]).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });
});

describe('alpha end to end', () => {
  it('the desktop recorder sends the RGBA frames, alpha included, untouched', async () => {
    vi.resetModules();
    const sent: Uint8Array[] = [];
    let started: Record<string, unknown> | null = null;
    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: async (cmd: string, args?: unknown) => {
        if (cmd === 'start_ffmpeg_encode') started = args as Record<string, unknown>;
        if (cmd === 'send_frame_rgba') sent.push(new Uint8Array(args as Uint8Array));
      },
    }));
    vi.doMock('@tauri-apps/plugin-dialog', () => ({ save: async () => '/tmp/out.mov' }));
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    try {
      const { runFfmpegEncode } = await import('../ffmpegRecorder');
      await runFfmpegEncode({
        width: 2, height: 1, fps: 10, duration: 0.2, codec: 'prores4444xq', outputPath: '/tmp/a.mov',
        renderFrame: () => {},
        // A half-transparent red pixel and a clear one.
        readPixels: out => { out.set([255, 0, 0, 128, 0, 0, 0, 0]); },
      });
      expect(started!.codec).toBe('prores4444xq');
      expect(sent).toHaveLength(2);
      for (const f of sent) expect([...f]).toEqual([255, 0, 0, 128, 0, 0, 0, 0]);
    } finally {
      vi.unstubAllGlobals();
      vi.doUnmock('@tauri-apps/api/core');
      vi.doUnmock('@tauri-apps/plugin-dialog');
    }
  });

  it('the browser encoder gets straight RGBA with its alpha, the profile’s number, and falls back to one thread', async () => {
    vi.resetModules();
    const frames: number[][] = [];
    let settings: Record<string, unknown> | null = null;
    const encoder = {
      initialize: (o: Record<string, unknown>) => { settings = o; },
      addFrameRgba: (px: Uint8Array) => { frames.push([...px]); },
      finalizeToBlob: () => new Blob([new Uint8Array([1, 2, 3])], { type: 'video/quicktime' }),
      destroy: vi.fn(),
    };
    vi.doMock('prores-wasm-encoder/parallel', () => ({ createProResEncoderPool: async () => { throw new Error('no workers'); } }));
    vi.doMock('prores-wasm-encoder', () => ({ createProResEncoder: async () => encoder }));
    try {
      const { encodeProResWasm } = await import('../proresWasm');
      const progress: number[] = [];
      const blob = await encodeProResWasm({
        width: 1, height: 1, fps: 24, totalFrames: 3, profile: proresProfile('4444'),
        frame: async (i, out) => { out.set([200, 100, 50, i * 40]); },
        onProgress: d => progress.push(d),
      });
      expect(settings).toEqual({ width: 1, height: 1, frameRate: 24, profile: 4 });
      expect(frames).toEqual([[200, 100, 50, 0], [200, 100, 50, 40], [200, 100, 50, 80]]);
      expect(progress).toEqual([1, 2, 3]);
      expect(blob.size).toBe(3);
      expect(encoder.destroy).toHaveBeenCalledOnce();
    } finally {
      vi.doUnmock('prores-wasm-encoder/parallel');
      vi.doUnmock('prores-wasm-encoder');
    }
  });

  it('a cancelled frame stops the encode and still frees the encoder', async () => {
    vi.resetModules();
    const destroy = vi.fn();
    vi.doMock('prores-wasm-encoder/parallel', () => ({
      createProResEncoderPool: async () => ({ addFrameRgba: async () => {}, finalizeToBlob: async () => new Blob(), destroy }),
    }));
    try {
      const { encodeProResWasm } = await import('../proresWasm');
      await expect(encodeProResWasm({
        width: 2, height: 2, fps: 30, totalFrames: 5, profile: proresProfile('hq'),
        frame: async i => { if (i === 2) throw new Error('cancelled'); },
      })).rejects.toThrow('cancelled');
      expect(destroy).toHaveBeenCalledOnce();
    } finally {
      vi.doUnmock('prores-wasm-encoder/parallel');
    }
  });
});

describe('the LGPL encoder stays apart and is credited', () => {
  const sources = (dir: string): string[] => readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === '__tests__' ? [] : sources(p)) : /\.(ts|tsx|js|mjs)$/.test(n) ? [p] : [];
  });

  it('is only ever imported with import(), from utils/proresWasm.ts, and has a chunk of its own', () => {
    const importers = sources(join(ROOT, 'src')).filter(f => readFileSync(f, 'utf8').includes('prores-wasm-encoder'));
    // thirdParty.ts names it in its notice; only proresWasm.ts loads it.
    for (const f of importers) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/^\s*import\s[^(]*['"]prores-wasm-encoder/m);
      expect(text, f).not.toMatch(/require\(['"]prores-wasm-encoder/);
    }
    const loaders = importers.filter(f => /import\(['"]prores-wasm-encoder/.test(readFileSync(f, 'utf8')));
    expect(loaders.map(f => f.slice(ROOT.length + 1))).toEqual(['src/utils/proresWasm.ts']);
    const vite = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
    expect(vite).toContain("if (id.includes('node_modules/prores-wasm-encoder/')) return 'prores-wasm';");
  });

  it('is listed with its licence, version and source, and the licence text ships with the app', () => {
    const t = thirdParty('prores-wasm-encoder')!;
    expect(THIRD_PARTY).toContain(t);
    expect(t.licence).toBe('LGPL-2.1-or-later');
    expect(t.source).toBe('https://github.com/OlivierEstevez/ProRes-WASM-encoder');
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['prores-wasm-encoder']).toBe(t.version);
    const file = join(ROOT, 'public', t.licenseFile);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('GNU LESSER GENERAL PUBLIC LICENSE');
  });
});
