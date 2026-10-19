/**
 * A band's Listen (lib/audioTools/listen.ts, docs/audio-tools.md "Listen"): the Band ↔ Clicks mix, a File's hits put
 * on the audio clock (rendered in a real OfflineAudioContext, node-web-audio-api: each click found in the output lands
 * within one render quantum of where playback reaches its hit, round the loop too, and a seek takes back the clicks
 * not played yet), and the window's switch (one band at a time, Play put back, the Mic's default).
 */
import { describe, expect, it, vi } from 'vitest';
import { OfflineAudioContext as NodeOffline } from 'node-web-audio-api';
import {
  CLICK_SECONDS, ClickScheduler, ListenControl, clickSamples, hitClockTimes, listenDefaultMix, listenMix, liveClickTime,
  readListenMix, writeListenMix, type ListenPlay,
} from '../listen';
import { AheadAnalysis } from '../ahead';
import { bandsOf } from '../bands';
import { atDetConfig } from '../../../play/kit/audioTools.js';
import { littleSong, SR } from './detectSynth';

const QUANTUM = 128;

describe('the Band ↔ Clicks mix', () => {
  it('0 is the band only, 1 the clicks only, the middle both at full', () => {
    expect(listenMix(0)).toEqual({ band: 1, clicks: 0 });
    expect(listenMix(0.5)).toEqual({ band: 1, clicks: 1 });
    expect(listenMix(1)).toEqual({ band: 0, clicks: 1 });
    expect(listenMix(0.25)).toEqual({ band: 1, clicks: 0.5 });
    expect(listenMix(0.75)).toEqual({ band: 0.5, clicks: 1 });
    expect(listenMix(-3)).toEqual({ band: 1, clicks: 0 });
    expect(listenMix(NaN)).toEqual({ band: 1, clicks: 1 });
  });

  it('is remembered per band; the Mic starts at clicks only (feedback), kept apart from the other tabs', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } });
    expect(listenDefaultMix('mic')).toBe(1);
    expect(listenDefaultMix('file')).toBe(0.5);
    expect(readListenMix('k', 'file')).toBe(0.5);
    expect(readListenMix('k', 'mic')).toBe(1);
    writeListenMix('k', 'file', 0.2);
    writeListenMix('h', 'mic', 0.4);
    expect(readListenMix('k', 'file')).toBe(0.2);
    expect(readListenMix('k', 'video')).toBe(0.2);
    expect(readListenMix('k', 'mic')).toBe(1);
    expect(readListenMix('h', 'mic')).toBe(0.4);
    vi.unstubAllGlobals();
  });
});

describe('the click', () => {
  it('is short, clean and silent at both ends', () => {
    const s = clickSamples(SR);
    expect(s.length).toBe(Math.round(CLICK_SECONDS * SR));
    expect(Math.abs(s[0])).toBeLessThan(1e-6);
    expect(Math.abs(s[s.length - 1])).toBeLessThan(1e-4);
    const peak = Math.max(...Array.from(s, Math.abs));
    expect(peak).toBeGreaterThan(0.3);
    expect(peak).toBeLessThanOrEqual(0.55 + 1e-9);
  });
});

describe('a File\'s hits on the audio clock', () => {
  const play = (o: Partial<ListenPlay> = {}): ListenPlay => ({ token: 1, startedAt: 0.1, startOff: 0, win: { start: 0, end: 2 }, loop: true, ...o });

  it('each hit where playback reaches it: the first pass from where it started, then every loop of the window', () => {
    const times = [0.25, 0.9, 1.5, 2.4];
    // Started at ctx 0.1 from the song's start, looping 0–2 s: hits at 0.35, 1.0, 1.6, then 2.35, 3.0, 3.6 …
    expect(hitClockTimes(times, play(), 0, 4).map(h => +h.t.toFixed(6))).toEqual([0.35, 1, 1.6, 2.35, 3, 3.6]);
    // Started mid-song (cued at 1.0 s: startedAt = when − 1.0): 0.25 and 0.9 wait for the next pass.
    expect(hitClockTimes(times, play({ startedAt: -0.9, startOff: 1 }), 0, 3).map(h => +h.t.toFixed(6))).toEqual([0.6, 1.35, 2, 2.6]);
    // A trim of 0.5–1.6 s: only the hits inside it, round it every 1.1 s.
    expect(hitClockTimes(times, play({ startedAt: -0.5, startOff: 0.5, win: { start: 0.5, end: 1.6 } }), 0, 2.5).map(h => +h.t.toFixed(6))).toEqual([0.4, 1, 1.5, 2.1]);
    // No loop: once.
    expect(hitClockTimes(times, play({ loop: false }), 0, 10)).toHaveLength(3);
    // Sync offset moves every click.
    expect(hitClockTimes(times, play(), 0, 1.2, 0.03).map(h => +h.t.toFixed(6))).toEqual([0.38, 1.03]);
  });

  it('a live hit clicks so it is heard when its trigger fires, never before now', () => {
    expect(liveClickTime(10.2, 10, 5, 0.05)).toBeCloseTo(5.15, 9);
    expect(liveClickTime(9.9, 10, 5, 0.05)).toBe(5);
  });

  it('clicks rendered offline land within one render quantum of each hit picked ahead, round the loop', async () => {
    // The hits: the File analysed ahead (the same analysis the engine runs), a Kick band on a little song.
    const song = littleSong(2);
    const buf = { numberOfChannels: 1, length: song.mono.length, sampleRate: SR, duration: song.mono.length / SR, getChannelData: () => song.mono };
    const ahead = new AheadAnalysis(buf);
    const cfg = atDetConfig(bandsOf({ bands: [{ id: 'k', name: 'Kick', preset: 'kick', lo: 40, hi: 130, trigger: true }] })[0]);
    ahead.curves(cfg);
    let ev = ahead.events(cfg);
    for (let i = 0; i < 100 && !ev; i++) { await new Promise(r => setTimeout(r, 20)); ev = ahead.events(cfg); }
    expect(ev).not.toBeNull();
    const times = ev!.times;
    expect(times.length).toBeGreaterThanOrEqual(song.kicks.length - 1);

    const secs = 5;
    const ctx = new NodeOffline(1, secs * SR, SR) as unknown as OfflineAudioContext;
    const sched = new ClickScheduler(ctx, ctx.destination);
    // Playing from 0.137 s on the render clock, a trim of 0.1–1.9 s looping.
    const p = play({ startedAt: 0.137 - 0.1, startOff: 0.1, win: { start: 0.1, end: 1.9 } });
    // Pumped every 25 ms as the engine does (here all before rendering: the offline clock waits).
    for (let now = 0; now < secs - 0.3; now += 0.025) sched.pump(now, p, times);
    const want = hitClockTimes(times, p, 0, secs - 0.3 + 0.25).map(h => Math.round(h.t * SR));
    const out = (await ctx.startRendering()).getChannelData(0);
    const found = onsets(out);
    expect(found.length).toBe(want.length);
    found.forEach((s, i) => expect(Math.abs(s - want[i])).toBeLessThan(QUANTUM));
    expect(want.length).toBeGreaterThan(times.length);
    ahead.dispose();
  });

  it('a seek takes back the clicks not played yet and schedules the new run\'s', async () => {
    const times = [0.2, 0.6, 1.0, 1.4];
    const secs = 2.5;
    const ctx = new NodeOffline(1, secs * SR, SR) as unknown as OfflineAudioContext;
    const sched = new ClickScheduler(ctx, ctx.destination);
    const a = play({ token: 1, startedAt: 0, win: { start: 0, end: 1.6 } });
    // A long look ahead, so run A has clicks on the clock past the seek.
    sched.pump(0, a, times, 0, 1.2);
    // At 0.7 s: seek back to 0.1 s (a new run).
    const b = play({ token: 2, startedAt: 0.7 - 0.1, startOff: 0.1, win: { start: 0, end: 1.6 } });
    for (let now = 0.7; now < secs - 0.3; now += 0.025) sched.pump(now, b, times);
    // A's before the seek (1.0 s was on the clock: taken back), then B's: 0.8, 1.2, 1.6, 2.0, and round again at 2.4.
    const want = [0.2, 0.6, 0.8, 1.2, 1.6, 2.0, 2.4].map(t => Math.round(t * SR));
    expect(hitClockTimes(times, b, 0.7, secs).map(h => +h.t.toFixed(6))).toEqual([0.8, 1.2, 1.6, 2, 2.4]);
    const found = onsets((await ctx.startRendering()).getChannelData(0));
    expect(found.length).toBe(want.length);
    found.forEach((s, i) => expect(Math.abs(s - want[i])).toBeLessThan(QUANTUM));
  });

  it('no playback, or no hits: nothing more goes on the clock', () => {
    const calls: number[] = [];
    const fake = { currentTime: 0, sampleRate: SR, createBuffer: (_c: number, n: number) => ({ getChannelData: () => new Float32Array(n) }),
      createBufferSource: () => ({ connect() {}, disconnect() {}, start: (t: number) => calls.push(t), stop() {}, onended: null as unknown }) };
    const sched = new ClickScheduler(fake as unknown as BaseAudioContext, {} as AudioNode);
    expect(sched.pump(0, null, [0.1])).toBe(0);
    expect(sched.pump(0, play(), null)).toBe(0);
    const hits = [0.1, 0.12], p = play();
    expect(sched.pump(0, p, hits)).toBe(2);
    // Pumping again over the same stretch adds nothing twice.
    expect(sched.pump(0.01, p, hits)).toBe(0);
    expect(calls).toEqual([0.2, 0.22].map(t => expect.closeTo(t, 9) as unknown as number));
  });
});

/** Where each click starts in a render: the first sample over a small level after 20 ms of quiet. */
function onsets(x: Float32Array): number[] {
  const out: number[] = [];
  let quiet = Infinity;
  for (let i = 0; i < x.length; i++) {
    if (Math.abs(x[i]) > 0.02) {
      if (quiet > 0.02 * SR) out.push(i);
      quiet = 0;
    } else quiet++;
  }
  return out;
}

describe('the window\'s switch (ListenControl)', () => {
  const setup = (playing: Record<string, boolean>) => {
    const log: string[] = [];
    const deps = {
      start: vi.fn((id: string, band: string) => { log.push(`start ${id}/${band}`); return true; }),
      stop: vi.fn(() => { log.push('stop'); }),
      setMix: vi.fn(),
      isPlaying: (id: string) => playing[id] !== false,
      setPlaying: vi.fn((id: string, on: boolean) => { playing[id] = on; log.push(`play ${id} ${on}`); }),
    };
    return { L: new ListenControl(deps), deps, log, playing };
  };

  it('one band at a time: another switches, pressing again stops', () => {
    const { L, log } = setup({ src: true });
    expect(L.toggle('src', 'k', 0.5)).toBe(true);
    expect(L.current()).toEqual({ nodeId: 'src', bandId: 'k' });
    L.toggle('src', 's', 0.5);
    expect(L.current()).toEqual({ nodeId: 'src', bandId: 's' });
    expect(L.isListening('k')).toBe(false);
    L.toggle('src', 's', 0.5);
    expect(L.current()).toBeNull();
    expect(log).toEqual(['start src/k', 'stop', 'start src/s', 'stop']);
  });

  it('a paused source plays while it listens and is paused again after (switching bands on it keeps that)', () => {
    const { L, log, playing } = setup({ src: false });
    L.toggle('src', 'k', 0.5);
    expect(playing.src).toBe(true);
    L.toggle('src', 's', 0.5);
    expect(playing.src).toBe(true);
    // Closing the window (or Esc) stops it.
    L.stop();
    expect(playing.src).toBe(false);
    expect(log).toEqual(['play src true', 'start src/k', 'stop', 'start src/s', 'stop', 'play src false']);
    // A source that was playing keeps playing.
    const p2 = setup({ src: true });
    p2.L.toggle('src', 'k', 0.5);
    p2.L.stop();
    expect(p2.deps.setPlaying).not.toHaveBeenCalled();
  });

  it('switching to another source puts the first one\'s Play back; the mix goes to the engine only while listening', () => {
    const { L, deps, playing } = setup({ a: false, b: true });
    L.setMix(0.3);
    expect(deps.setMix).not.toHaveBeenCalled();
    L.toggle('a', 'k', 0.5);
    L.setMix(0.3);
    expect(deps.setMix).toHaveBeenCalledWith(0.3);
    L.toggle('b', 'k', 0.5);
    expect(playing).toEqual({ a: false, b: true });
    // The engine let go (Solo took the sound): forgotten, Play put back.
    L.lost();
    expect(L.current()).toBeNull();
  });
});
