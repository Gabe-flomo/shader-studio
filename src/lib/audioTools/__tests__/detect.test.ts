/**
 * A band's Detect (play/kit/audioTools.js "Detect"; docs/audio-tools.md): on synthetic sound, live (AnalyserNode's frame
 * every 1/60 s) and ahead (a whole file, every 5 ms).
 *
 * - Hits finds every kick over a held bass line, where Level sits above its line and merges them into one.
 * - Transient reads a click high and a swell low.
 * - Noisy ↔ tonal (flatness) tells hats from a chord, and Only (noisy / tonal) keeps hats, or notes, and not the other.
 * - HPSS (Drums only) takes a sustained tone out and keeps a click; on a bass line that changes note it finds only the kicks.
 * - Brightness follows a filter sweep.
 * - Live and ahead agree; the presets find their drums in a little song; old bands run exactly as before; an exported
 *   page's kit gives the app's numbers frame for frame.
 */
import { describe, expect, it } from 'vitest';
import {
  AT_FLAT_DB, atAnalyseFeatures, atBandCharacter, atBandFlatness, atCharFilter, atGroupPow, atHpssRegion, atNewBandRun, atNewSource,
  atOfflineHop, atPercRow, atPickTriggers, atSpectrumDbAt, atStepBandRun, atStepSource, type AtBand, type AtSource,
} from '../../../play/kit/audioTools.js';
import { kitScript } from '../../../play/exportHtml';
import { BAND_DETECT_PRESETS, bandsOf, newBand, type AudioBandSpec } from '../bands';
import {
  SR, addBurst, addTone, filterSweep, hatsOverChords, kicksOverBass, kicksOverBassLine, littleSong, liveFrames, matchTimes, notesAndBursts,
} from './detectSynth';

const HOP = atOfflineHop(SR), HS = HOP / SR;
/** A live frame ending at t is centred 1024 samples earlier: where it sits on a curve analysed ahead. */
const CENTRE = 1024 / SR;

function band(o: Partial<AudioBandSpec>): AudioBandSpec {
  return { ...newBand([], { lo: 30, hi: 150 }), trigger: true, threshold: 0.5, gate: 0.1, minMs: 10, ...o };
}

/** A band run live over a sound: its hits (onset times), and its signal and level per frame. */
function live(mono: Float32Array, b: AudioBandSpec) {
  const run = atNewBandRun(), hits: number[] = [], vals: number[] = [], lvls: number[] = [], ts: number[] = [];
  liveFrames(mono, (f, t, dt) => {
    atStepBandRun(run, b, f, SR, t, dt);
    vals.push(run.hit.signal); lvls.push(run.hit.level); ts.push(t);
    if (run.hit.trigger) hits.push(run.hit.lastHit);
  });
  return { hits, vals, lvls, ts };
}

/** A band analysed ahead: its curves and its hits (Only applied), as AheadAnalysis picks them. */
function ahead(mono: Float32Array, b: AudioBandSpec) {
  const [c] = atAnalyseFeatures(mono, SR, [b], HOP);
  const picked = atPickTriggers(c.value, HS, { ...b, cooldownMs: b.cooldown }, b.detect === 'level' ? undefined : c.level);
  const ev = atCharFilter(picked, c.aflat, c.arise, HS, atBandCharacter(b), b.charAt);
  return { c, hits: Array.from(ev.times) };
}

const maxIn = (vals: ArrayLike<number>, ts: ArrayLike<number>, a: number, b: number) => {
  let m = 0;
  for (let i = 0; i < vals.length; i++) if (ts[i] >= a && ts[i] <= b) m = Math.max(m, vals[i]);
  return m;
};
const curveTimes = (n: number) => Float64Array.from({ length: n }, (_, i) => i * HS);

describe('Hits: onsets, not loudness', () => {
  it('finds each kick over a held bass line, where Level stays over its line and merges them', () => {
    const { mono, kicks } = kicksOverBass(4);
    // Level: the bass holds the band above Threshold, so it fires once, at the start, and never re-arms.
    expect(live(mono, band({ detect: 'level', cooldown: 150 })).hits.length).toBeLessThanOrEqual(1);
    expect(ahead(mono, band({ detect: 'level', cooldown: 150 })).hits.length).toBeLessThanOrEqual(1);
    for (const r of [live(mono, band({ detect: 'hits', cooldown: 150 })), ahead(mono, band({ detect: 'hits', cooldown: 150 }))]) {
      const m = matchTimes(r.hits, kicks, 0.04);
      expect(m.hit).toBe(kicks.length);
      // At most the bass's own start (an onset from silence).
      expect(m.extra).toBeLessThanOrEqual(1);
    }
    // Between kicks (their tails gone) the held bass stays under the line.
    const { c } = ahead(mono, band({ detect: 'hits' }));
    expect(maxIn(c.value, curveTimes(c.value.length), 0.45, 0.68)).toBeLessThan(0.5);
  });
});

describe('Transient: attack sharpness', () => {
  it('a click reads high, a swell (50 dB a second) low', () => {
    const mono = new Float32Array(Math.round(2.5 * SR));
    // The swell: 440 Hz with harmonics rising 50 dB over the first second, then held to the end.
    for (let i = 0; i < mono.length; i++) {
      const t = i / SR, amp = Math.pow(10, (-60 + 50 * Math.min(1, t)) / 20);
      mono[i] = amp * (Math.sin(2 * Math.PI * 440 * t) + 0.5 * Math.sin(2 * Math.PI * 880 * t));
    }
    addBurst(mono, 2.0, 0.5, 0.01);
    const b = band({ lo: 200, hi: 4000, detect: 'transient', threshold: 0.6 });
    const r = live(mono, b);
    expect(maxIn(r.vals, r.ts, 0.2, 1.5)).toBeLessThan(0.45);
    expect(maxIn(r.vals, r.ts, 2.0, 2.08)).toBeGreaterThan(0.9);
    // The trigger fires on the click, never on the swell (once past the very start).
    expect(r.hits.filter(t => t > 0.2)).toHaveLength(1);
    expect(Math.abs(r.hits.filter(t => t > 0.2)[0] - 2.0)).toBeLessThan(0.05);
  });
});

describe('Noisy ↔ tonal', () => {
  it('flatness reads hats high and a chord low, and Only: noisy fires on the hats alone', () => {
    const { mono, hats } = hatsOverChords(3);
    const b = band({ lo: 5000, hi: 16000, detect: 'flatness' });
    const { c } = ahead(mono, b);
    for (const t of hats) {
      expect(c.value[Math.round((t + 0.01) / HS)]).toBeGreaterThan(0.8);
      expect(c.value[Math.round((t + 0.15) / HS)]).toBeLessThan(0.4);
    }
    // A pure tone reads 0 on its own; white noise near 1 (1 + its flatness in dB / AT_FLAT_DB).
    const tone = new Float32Array(2048), noise = new Float32Array(2048);
    addTone(tone, 1000, 0, 1, 0.5);
    addBurst(noise, 0, 0.5, 10);
    const db = new Float32Array(1024);
    expect(atBandFlatness(atSpectrumDbAt(tone, 0, 2048, db), SR, 200, 4000)).toBeLessThan(0.05);
    expect(atBandFlatness(atSpectrumDbAt(noise, 0, 2048, db), SR, 200, 4000)).toBeGreaterThan(1 - 4.5 / AT_FLAT_DB);
    // Hits on the band with Only: noisy finds every hat, live and ahead.
    const hb = band({ lo: 5000, hi: 16000, detect: 'hits', character: 'noisy', cooldown: 80 });
    for (const hits of [live(mono, hb).hits, ahead(mono, hb).hits]) expect(matchTimes(hits, hats, 0.045)).toEqual({ hit: hats.length, extra: 0 });
  });

  it('Only picks the notes or the noise bursts out of one band', () => {
    const { mono, notes, bursts } = notesAndBursts(4);
    const mk = (character: 'any' | 'noisy' | 'tonal') => band({ lo: 200, hi: 2000, detect: 'hits', character, cooldown: 100 });
    for (const [how, run] of [['live', (b: AudioBandSpec) => live(mono, b).hits], ['ahead', (b: AudioBandSpec) => ahead(mono, b).hits]] as const) {
      const any = run(mk('any')), tonal = run(mk('tonal')), noisy = run(mk('noisy'));
      // Hits alone fires on both.
      expect(matchTimes(any, notes, 0.045).hit, how).toBe(notes.length);
      expect(matchTimes(any, bursts, 0.045).hit, how).toBeGreaterThanOrEqual(bursts.length - 2);
      expect(matchTimes(tonal, notes, 0.045).hit, how).toBe(notes.length);
      expect(matchTimes(tonal, bursts, 0.045).hit, how).toBeLessThanOrEqual(1);
      expect(matchTimes(noisy, notes, 0.045).hit, how).toBe(0);
      expect(matchTimes(noisy, bursts, 0.045).hit, how).toBeGreaterThanOrEqual(bursts.length - 2);
    }
  });
});

describe('Drums only: harmonic / percussive separation', () => {
  it('takes a sustained tone out and keeps a click', () => {
    const mono = new Float32Array(SR);
    addTone(mono, 110, 0, 1, 0.4, 3);
    // A click (one sample) at 0.8 s.
    mono[Math.round(0.8 * SR)] += 0.9;
    const db = new Float32Array(1024);
    const R = atHpssRegion(1024, SR, 60, 1000);
    const frameAt = (end: number) => atGroupPow(atSpectrumDbAt(mono, Math.round(end * SR) - 2048, 2048, db), R, new Float64Array(R.groups));
    // The harmonic estimate: the median of the last 0.2 s of frames (all tone).
    const ring = Array.from({ length: 12 }, (_, k) => frameAt(0.55 + k / 60));
    const harm = new Float64Array(R.groups);
    for (let k = 0; k < R.groups; k++) harm[k] = ring.map(f => f[k]).sort((a, b) => a - b)[6];
    const share = (cur: Float64Array) => {
      const perc = atPercRow(cur, harm, R);
      let p = 0, all = 0;
      for (let kb = 0; kb < R.nBand; kb++) { p += perc[kb]; all += cur[kb + R.m]; }
      return p / all;
    };
    // A tone-only frame: almost nothing percussive. The frame with the click: most of what is new is.
    expect(share(frameAt(0.75))).toBeLessThan(0.1);
    const click = frameAt(0.8 + 1000 / SR), perc = atPercRow(click, harm, R);
    let newP = 0, newAll = 0;
    for (let kb = 0; kb < R.nBand; kb++) { const k = kb + R.m; if (click[k] > 4 * harm[k]) { newP += perc[kb]; newAll += click[k]; } }
    expect(newAll).toBeGreaterThan(0);
    expect(newP / newAll).toBeGreaterThan(0.7);
  });

  it('on a bass line that changes note, finds the kicks alone, where Hits fires on every note too', () => {
    const { mono, kicks, notes } = kicksOverBassLine(4, 0.5, 0.03);
    const newNotes = notes.filter(t => t > 0.1);
    for (const run of [(b: AudioBandSpec) => live(mono, b).hits, (b: AudioBandSpec) => ahead(mono, b).hits]) {
      // (Past the first moment: the bass starting from silence is an onset of its own.)
      const drums = run(band({ detect: 'drums', cooldown: 150, minMs: 0 })).filter(t => t > 0.1);
      expect(matchTimes(drums, kicks, 0.045)).toEqual({ hit: kicks.length, extra: 0 });
      const hits = run(band({ detect: 'hits', cooldown: 150 }));
      // Hits takes most of the new notes for hits too (each is an onset); Drums only took none of them (no extras above).
      expect(matchTimes(hits, newNotes, 0.045).hit).toBeGreaterThanOrEqual(Math.ceil(newNotes.length / 2));
    }
  });
});

describe('Brightness', () => {
  it('follows a filter sweep (300 Hz → 6 kHz) up, live and ahead', () => {
    const mono = filterSweep(2);
    const b = band({ lo: 100, hi: 10000, detect: 'brightness', trigger: false, value: true });
    const { c } = ahead(mono, b);
    const r = live(mono, b);
    const off = Array.from({ length: 8 }, (_, k) => c.value[Math.round((0.125 + k * 0.25) / HS)]);
    const on = Array.from({ length: 8 }, (_, k) => r.vals[Math.round((0.125 + k * 0.25) * 60) - 1]);
    for (const xs of [off, on]) {
      for (let k = 1; k < xs.length; k++) expect(xs[k]).toBeGreaterThan(xs[k - 1] - 0.02);
      expect(xs[7] - xs[0]).toBeGreaterThan(0.35);
    }
  });
});

describe('live and ahead agree', () => {
  it('Flatness, Brightness and Transient read the same on the same moment; Hits fire at the same kicks', () => {
    const song = littleSong(4);
    for (const [detect, lo, hi, tol] of [['flatness', 5000, 16000, 0.03], ['brightness', 200, 8000, 0.03], ['transient', 200, 2000, 0.06]] as const) {
      const b = band({ lo, hi, detect, trigger: false, value: true });
      const { c } = ahead(song.mono, b);
      const r = live(song.mono, b);
      let diff = 0, ldiff = 0, n = 0;
      for (let i = 30; i < r.ts.length; i++) {
        const k = Math.round((r.ts[i] - CENTRE) / HS);
        if (k < 0 || k >= c.value.length) continue;
        diff += Math.abs(c.value[k] - r.vals[i]);
        // The level too: the Gate reads the same.
        ldiff += Math.abs(c.level[k] - r.lvls[i]);
        n++;
      }
      expect(diff / n, detect).toBeLessThan(tol);
      expect(ldiff / n, `${detect} level`).toBeLessThan(0.01);
    }
    const kb = band({ detect: 'hits', cooldown: 150 });
    const a = ahead(song.mono, kb).hits.filter(t => t > 0.1), l = live(song.mono, kb).hits.filter(t => t > 0.1);
    // Live hits come up to a frame or two later (the analyser's frame ends at its time); each pairs with one ahead.
    expect(matchTimes(l.map(t => t - CENTRE), a, 0.035).extra).toBeLessThanOrEqual(1);
    expect(Math.abs(l.length - a.length)).toBeLessThanOrEqual(1);
  });
});

describe('presets', () => {
  it('Kick, Snare, Hats and Melody notes each find their own sound in a little song, live and ahead', () => {
    const song = littleSong(4);
    const want: Record<string, number[]> = { kickDrums: song.kicks, snareNoisy: song.snares, hatsNoisy: song.hats, melody: song.notes };
    expect(BAND_DETECT_PRESETS.map(p => p.name)).toEqual(['Kick', 'Snare', 'Hats', 'Melody notes']);
    for (const p of BAND_DETECT_PRESETS) {
      const b = newBand([], p.key);
      expect(b.detect).toBe(p.detect);
      expect(b.trigger).toBe(true);
      for (const [how, hits] of [['live', live(song.mono, b).hits], ['ahead', ahead(song.mono, b).hits]] as const) {
        const m = matchTimes(hits.filter(t => t > 0.1), want[p.key], 0.045);
        const label = `${p.name} ${how}`;
        if (p.key === 'hatsNoisy') {
          // Three hats sit in a snare's ring; the snares' own sizzle counts as hats too (it is noise up there).
          expect(m.hit, label).toBeGreaterThanOrEqual(want[p.key].length - 3);
          expect(m.extra, label).toBeLessThanOrEqual(song.snares.length);
        } else if (p.key === 'kickDrums') {
          // Every kick; the snares' low end is a drum too, so it may fire Kick (the bass line's notes never do).
          expect(m.hit, label).toBe(want[p.key].length);
          expect(m.extra, label).toBeLessThanOrEqual(song.snares.length + 1);
          expect(matchTimes(hits, [1, 2, 3].map(t => t + 0.015), 0.03).hit, `${label}: bass notes`).toBeLessThanOrEqual(1);
        } else {
          expect(m.hit, label).toBeGreaterThanOrEqual(want[p.key].length - 1);
          expect(m.extra, label).toBeLessThanOrEqual(1);
        }
      }
    }
    // Level on the same ranges finds none of it (the bass and the chords hold the bands up).
    const lv = ahead(song.mono, { ...newBand([], 'kickDrums'), detect: 'level', character: 'any' }).hits;
    expect(matchTimes(lv, song.kicks, 0.045).hit).toBeLessThanOrEqual(1);
  });
});

describe('old bands', () => {
  it('open as Level with every hit counting, and run exactly as before', () => {
    const [old] = bandsOf({ bands: [{ id: 'k', name: 'Kick', lo: 30, hi: 150, value: true, trigger: true, threshold: 0.5, gate: 0.1, cooldown: 120 }] });
    expect([old.detect, old.character]).toEqual(['level', 'any']);
    expect(bandsOf({ bands: [{ id: 'x', detect: 'bogus', character: 'loud', charAt: 7 }] })[0]).toMatchObject({ detect: 'level', character: 'any', charAt: 1 });
    // A band object without the new fields at all (an exported page from before) and the cleaned one step the same.
    const bare = { ...old } as Partial<AudioBandSpec>;
    delete bare.detect; delete bare.character; delete bare.charAt;
    const { mono } = kicksOverBass(2);
    const a = atNewBandRun(), b = atNewBandRun();
    liveFrames(mono, (f, t, dt) => {
      atStepBandRun(a, old, f, SR, t, dt);
      atStepBandRun(b, bare as AtBand, f, SR, t, dt);
      expect([a.hit.trigger, a.band.level, a.hit.signal]).toEqual([b.hit.trigger, b.band.level, b.hit.signal]);
      // On Level the trigger measures the level, and the scope's two traces are one.
      expect(a.hit.signal).toBe(a.hit.level);
    });
  });
});

describe('an exported page', () => {
  it('runs every Detect with the app\'s numbers, frame for frame', () => {
    const song = littleSong(3);
    const bands: AudioBandSpec[] = [
      ...BAND_DETECT_PRESETS.map((p, i) => ({ ...newBand([], p.key), id: `p${i}`, value: true })),
      band({ id: 't', lo: 200, hi: 4000, detect: 'transient', value: true }),
      band({ id: 'f', lo: 2000, hi: 12000, detect: 'flatness', value: true }),
      band({ id: 'br', lo: 100, hi: 8000, detect: 'brightness', value: true, trigger: false }),
      band({ id: 'lv', detect: 'level', value: true }),
    ];
    const SSKit = new Function(`${kitScript(new Set(['audioTools']))}\nreturn SSKit;`)() as {
      audioTools: { newSource(): AtSource; stepSource(...a: unknown[]): void };
    };
    const page = SSKit.audioTools.newSource(), app = atNewSource();
    let frames = 0, fired = 0;
    liveFrames(song.mono, (f, t, dt) => {
      const A = new Map<string, number>(), P = new Map<string, number>();
      atStepSource(app, bands, [], new Float32Array(f), SR, t, dt, (ch, v) => A.set(ch, v));
      SSKit.audioTools.stepSource(page, bands, [], new Float32Array(f), SR, t, dt, (ch: string, v: number) => P.set(ch, v));
      expect([...P]).toEqual([...A]);
      for (const [k, v] of A) if (k.endsWith('_t') && v) fired++;
      frames++;
    });
    expect(frames).toBeGreaterThan(150);
    expect(fired).toBeGreaterThan(20);
  });
});
