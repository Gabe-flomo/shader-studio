/**
 * Crash reports (docs/crash-recovery.md "Crash reports"): their shape, file
 * names (the same as Rust's), writing and keeping the newest 20, and the JS
 * error capture that feeds them.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CRASH_REPORT_KEEP, buildCrashReport, isReportName, pageFromLog, parseCrashReport, planReportRotation, reportFileName, reportFileTime,
  writeCrashReport, type ReportStore,
} from '../crashReports';
import {
  RingLog, crashLog, errorFrom, installCrashCapture, lastCapturedError, logEvent, onCapturedError, previousPageLog, resetCrashCaptureForTests, CRASH_LOG_KEY,
} from '../../lib/crashLog';

function memoryStore(): ReportStore & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    list: async () => [...files.keys()],
    read: async n => files.get(n) ?? '',
    write: async (n, b) => { files.set(n, b); },
    remove: async n => { files.delete(n); },
  };
}

const input = {
  kind: 'web-content-terminated', at: 1_791_774_262_570, appVersion: '2026.10.183', crashedAppVersion: '2026.10.182', os: 'macOS 15.6 (aarch64)',
  gpu: { renderer: 'Apple M2', vendor: 'Apple', webgl: 'WebGL 2.0' }, page: 'studio',
  graph: { name: 'Rings', nodes: 14, groups: 1, dirty: true }, session: { id: 's1', startedAt: 1 },
  error: { message: 'TypeError: x is undefined', stack: 'at f (app.js:1:2)' },
  log: [{ t: 1, level: 'event' as const, msg: 'page: studio' }],
};

describe('crash reports', () => {
  it('records the time, versions, OS, GPU, page, graph size, log and error', () => {
    const r = buildCrashReport(input);
    expect(r).toMatchObject({
      format: 'playfield-crash-report', version: 1, time: '2026-10-12T03:04:22.570Z', kind: 'web-content-terminated',
      appVersion: '2026.10.183', crashedAppVersion: '2026.10.182', os: 'macOS 15.6 (aarch64)', page: 'studio',
      graph: { nodes: 14, groups: 1 }, error: { message: 'TypeError: x is undefined' },
    });
    expect(r.gpu.renderer).toBe('Apple M2');
    expect(r.summary).toMatch(/web content process/);
    expect(r.log).toHaveLength(1);
    expect(parseCrashReport(JSON.stringify(r))).toEqual(r);
    expect(parseCrashReport('{"format":"x"}')).toBeNull();
    // The same version twice isn't repeated.
    expect(buildCrashReport({ ...input, crashedAppVersion: '2026.10.183' }).crashedAppVersion).toBeUndefined();
  });

  it('names files by time, the way Rust does (crash.rs report_name)', () => {
    const n = reportFileName(1_791_774_262_570);
    expect(n).toBe('2026-10-12T03-04-22-570Z.json');
    expect(isReportName(n)).toBe(true);
    expect(reportFileTime(n)).toBe(1_791_774_262_570);
    expect(isReportName('../x.json')).toBe(false);
    expect(isReportName('autosave-1791774262570.json')).toBe(false);
  });

  it('keeps the newest 20', async () => {
    const s = memoryStore();
    s.files.set('notes.txt', 'not a report');
    for (let i = 0; i < 25; i++) await writeCrashReport(buildCrashReport({ ...input, at: 1_700_000_000_000 + i * 60_000 }), s);
    const names = [...s.files.keys()].filter(isReportName).sort();
    expect(names).toHaveLength(CRASH_REPORT_KEEP);
    expect(names[0]).toBe(reportFileName(1_700_000_000_000 + 5 * 60_000));
    expect(s.files.has('notes.txt')).toBe(true);
    expect(planReportRotation(names, 3).remove).toHaveLength(17);
  });

  it('two reports in the same millisecond both stay', async () => {
    const s = memoryStore();
    const a = await writeCrashReport(buildCrashReport(input), s);
    const b = await writeCrashReport(buildCrashReport(input), s);
    expect(a).not.toBe(b);
    expect(s.files.size).toBe(2);
  });

  it('finds the page a log was on', () => {
    expect(pageFromLog([{ t: 1, level: 'event', msg: 'page: play' }, { t: 2, level: 'warn', msg: 'x' }, { t: 3, level: 'event', msg: 'page: files' }])).toBe('files');
    expect(pageFromLog([])).toBe('unknown');
  });
});

describe('the crash log', () => {
  beforeEach(() => { resetCrashCaptureForTests(); localStorage.clear(); });
  afterEach(() => { resetCrashCaptureForTests(); });

  it('is a ring of the last 200 lines, repeats counted', () => {
    const r = new RingLog(200);
    for (let i = 0; i < 250; i++) r.push('warn', `w${i}`, i);
    expect(r.size).toBe(200);
    expect(r.get()[0].msg).toBe('w50');
    r.push('event', 'compile: 3 nodes', 1); r.push('event', 'compile: 3 nodes', 2);
    expect(r.get().at(-1)).toMatchObject({ msg: 'compile: 3 nodes', n: 2, t: 2 });
  });

  it('captures console warnings and errors, uncaught errors and unhandled rejections', () => {
    localStorage.setItem(CRASH_LOG_KEY, JSON.stringify({ at: 1, lines: [{ t: 1, level: 'event', msg: 'page: play' }] }));
    const seen: string[] = [];
    installCrashCapture(window);
    onCapturedError((e, kind) => seen.push(`${kind}:${e.message}`));
    // The previous page's lines were read before this page's replace them.
    expect(previousPageLog().map(l => l.msg)).toEqual(['page: play']);

    console.warn('careful', { a: 1 });
    console.error(new Error('bad'));
    logEvent('page: studio');
    window.dispatchEvent(new ErrorEvent('error', { error: new TypeError('x is undefined'), message: 'x is undefined' }));
    const rej = new Event('unhandledrejection') as Event & { reason?: unknown };
    rej.reason = new Error('nope');
    window.dispatchEvent(rej);

    const lines = crashLog.get().map(l => `${l.level}:${l.msg.split('\n')[0]}`);
    expect(lines).toContain('warn:careful {"a":1}');
    expect(lines).toContain('error:Error: bad');
    expect(lines).toContain('event:page: studio');
    expect(lines).toContain('error:Uncaught: TypeError: x is undefined');
    expect(lines).toContain('error:Unhandled rejection: Error: nope');
    expect(seen).toEqual(['error:TypeError: x is undefined', 'rejection:Error: nope']);
    expect(lastCapturedError()?.message).toBe('Error: nope');
  });

  it('logs WebGL context loss as an event', () => {
    installCrashCapture(window);
    const c = document.createElement('canvas');
    document.body.appendChild(c);
    c.dispatchEvent(new Event('webglcontextlost'));
    expect(crashLog.get().at(-1)?.msg).toMatch(/^WebGL context lost/);
    c.remove();
  });

  it('reads an error from whatever was thrown', () => {
    expect(errorFrom({ reason: 'plain string' })).toEqual({ message: 'plain string' });
    expect(errorFrom({ message: 'Script error.', filename: 'app.js', lineno: 3, colno: 4 })).toEqual({ message: 'Script error.', source: 'app.js:3:4' });
  });
});
