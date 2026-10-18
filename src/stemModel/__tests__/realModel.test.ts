/**
 * A local check against the real HT-Demucs files (docs/stems.md), skipped unless STEM_MODEL_DIR names a folder with
 * the split 4-stem export (htdemucs_split_manifest.json and htdemucs_p00…p20.onnx), run on ONNX Runtime for Node:
 *
 *   STEM_MODEL_DIR=/tmp/claude-stems/monteslu npx vitest run src/stemModel/__tests__/realModel.test.ts
 *
 * A synthetic mix (a kick loop, a low bass line, a high sine "voice") goes through the same runner and overlap-add
 * the worker uses; the drums stem must hold the kicks and the bass stem the low line.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { SAMPLE_RATE, energy, separateTrack } from '../dsp';
import { splitCacRunner, type ModelBackend } from '../runners';
import { synthMix } from './synth';

const dir = process.env.STEM_MODEL_DIR;

describe.skipIf(!dir)('HT-Demucs on ONNX Runtime (Node, local only)', () => {
  it('splits a synthetic mix: kicks in drums, the low line in bass', async () => {
    const ort = createRequire(import.meta.url)('onnxruntime-node');
    const manifest = JSON.parse(readFileSync(`${dir}/htdemucs_split_manifest.json`, 'utf8')) as { pieces: Array<{ file: string; inputs: string[]; outputs: string[] }>; outputs: { freq: string; time: string } };
    type T = { data: Float32Array };
    const sessions: Array<{ run: (feeds: Record<string, T>) => Promise<Record<string, T>> }> = [];
    for (const p of manifest.pieces) sessions.push(await ort.InferenceSession.create(`${dir}/${p.file}`));
    const be: ModelBackend<T> = {
      tensor: (data, dims) => new ort.Tensor('float32', data, dims),
      run: (i, feeds) => sessions[i].run(feeds),
      read: async t => t.data as Float32Array,
      dispose: () => {},
    };
    const mix = synthMix(12);
    const t0 = performance.now();
    const out = await separateTrack(mix.left, mix.right, splitCacRunner(be, manifest.pieces, manifest.outputs, 4), { stems: 4 });
    const ms = performance.now() - t0;
    const [drums, bass, other, vocals] = out;
    const parts = { drums: energy(drums), bass: energy(bass), other: energy(other), vocals: energy(vocals) };
    // How much of each source ended in each stem: correlation of the stem with the source.
    const corr = (a: [Float32Array, Float32Array], b: Float32Array) => {
      let ab = 0, aa = 0, bb = 0;
      for (let i = 0; i < b.length; i++) { const x = (a[0][i] + a[1][i]) / 2; ab += x * b[i]; aa += x * x; bb += b[i] * b[i]; }
      return ab / Math.sqrt(aa * bb + 1e-12);
    };
    const report = {
      seconds: mix.left.length / SAMPLE_RATE, ms: Math.round(ms), perThreeMinutes: Math.round((ms / (mix.left.length / SAMPLE_RATE)) * 180 / 1000),
      energy: parts,
      drumsVsKick: corr(drums, mix.kick), bassVsBass: corr(bass, mix.bass), vocalsVsVoice: corr(vocals, mix.voice),
      bassVsKick: corr(bass, mix.kick), drumsVsBass: corr(drums, mix.bass),
    };
    if (process.env.STEM_REPORT) writeFileSync(process.env.STEM_REPORT, JSON.stringify(report, null, 1));
    // Sum of stems ≈ the mix (the model is trained so; a loose check that the plumbing is right).
    let err = 0, ref = 0;
    for (let i = 0; i < mix.left.length; i++) { const s = drums[0][i] + bass[0][i] + other[0][i] + vocals[0][i]; err += (s - mix.left[i]) ** 2; ref += mix.left[i] ** 2; }
    expect(err / ref).toBeLessThan(0.05);
    expect(report.drumsVsKick).toBeGreaterThan(0.8);
    expect(report.bassVsBass).toBeGreaterThan(0.8);
    expect(report.drumsVsKick).toBeGreaterThan(report.drumsVsBass);
    expect(report.bassVsBass).toBeGreaterThan(report.bassVsKick);
  }, 600_000);
});
