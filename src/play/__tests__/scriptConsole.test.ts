/**
 * The Sketch editor's Console store: lines are captured with copies of their
 * values, repeats fold into one with a count, a run clears (unless Keep old
 * output), the line cap holds, watches keep a short history, and a kit sketch
 * reports into it end to end.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CONSOLE_MAX, WATCH_HISTORY, clearScriptConsole, consoleCopyText, consoleText, consoleValue, lastConsoleLine, logScript, scriptConsole, setKeepOldOutput } from '../scriptConsole';
import { klSketchCompile, klSketchStep } from '../kit/layers.js';
import { kp5Color, kp5Vector } from '../kit/p5.js';

afterEach(() => { setKeepOldOutput(false); });

describe('script console', () => {
  it('captures levels and copies values when they are logged', () => {
    clearScriptConsole('a');
    const o = { n: 1, list: [1, 2] };
    logScript('a', 'log', ['hello', o]);
    o.n = 99;
    logScript('a', 'warn', ['careful']);
    logScript('a', 'table', [[{ x: 1 }]]);
    const c = scriptConsole('a');
    expect(c.lines.map(l => l.level)).toEqual(['log', 'warn', 'table']);
    expect(c.lines[0].text).toBe('hello {n: 1, list: [1, 2]}');
  });
  it('folds a line repeated in a row into one with a count', () => {
    clearScriptConsole('b');
    for (let i = 0; i < 60; i++) logScript('b', 'log', ['tick']);
    logScript('b', 'log', ['tock']);
    logScript('b', 'log', ['tick']);
    const c = scriptConsole('b');
    expect(c.lines.map(l => [l.text, l.count])).toEqual([['tick', 60], ['tock', 1], ['tick', 1]]);
    expect(consoleCopyText(c)).toBe('tick ×60\ntock\ntick');
  });
  it('keeps at most CONSOLE_MAX lines, dropping the oldest', () => {
    clearScriptConsole('c');
    for (let i = 0; i < CONSOLE_MAX + 250; i++) logScript('c', 'log', [i]);
    const c = scriptConsole('c');
    expect(c.lines).toHaveLength(CONSOLE_MAX);
    expect(c.lines[0].text).toBe('250');
    expect(c.dropped).toBe(250);
  });
  it('a run clears the lines, unless Keep old output is on', () => {
    clearScriptConsole('d');
    logScript('d', 'log', ['first run']);
    logScript('d', 'run', []);
    expect(scriptConsole('d').lines).toHaveLength(0);
    logScript('d', 'log', ['second run']);
    setKeepOldOutput(true);
    logScript('d', 'run', []);
    expect(scriptConsole('d').lines.map(l => l.text)).toEqual(['second run']);
    logScript('d', 'clear', []);
    expect(scriptConsole('d').lines).toHaveLength(0);
  });
  it('watch keeps one live line per name with a short history of numbers', () => {
    clearScriptConsole('e');
    for (let i = 0; i < WATCH_HISTORY + 10; i++) logScript('e', 'watch', ['speed', i]);
    logScript('e', 'watch', ['name', 'hello']);
    const c = scriptConsole('e');
    expect(c.lines).toHaveLength(0);
    expect(c.watches.map(w => [w.name, w.text])).toEqual([['speed', String(WATCH_HISTORY + 9)], ['name', 'hello']]);
    expect(c.watches[0].history).toHaveLength(WATCH_HISTORY);
  });
  it('shows p5 vectors compactly and colours as swatches; errors link to their file and line', () => {
    expect(consoleValue(new kp5Vector(1, 2.5))).toEqual({ t: 'vec', x: 1, y: 2.5, z: 0 });
    const col = consoleValue(new kp5Color([255, 0, 0, 255]));
    expect(col).toMatchObject({ t: 'colour', css: 'rgba(255, 0, 0, 1)' });
    expect(consoleText(consoleValue({ a: [1, { b: true }] }))).toBe('{a: [1, {b: true}]}');
    const circ: Record<string, unknown> = { k: 1 }; circ.self = circ;
    expect(consoleText(consoleValue(circ))).toBe('{k: 1, self: "[circular]"}');
    clearScriptConsole('f');
    logScript('f', 'error', ['Runtime (particle.js:12): x is not defined']);
    expect(scriptConsole('f').lines[0].at).toEqual({ file: 'particle.js', line: 12 });
    logScript('f', 'log', ['later']);
    expect(lastConsoleLine(scriptConsole('f'))?.level).toBe('error');
  });
  it('a sketch logs through the kit into the store', () => {
    clearScriptConsole('g');
    const st = klSketchCompile('function draw(s) { print("frame", s.frame); console.log({ w: width }); watch("t", s.time); }', { log: (level, args) => logScript('g', level, args) });
    const ctx = new Proxy({}, { get: () => () => undefined, set: () => true }) as unknown as CanvasRenderingContext2D;
    for (let i = 0; i < 3; i++) klSketchStep(st, { ctx, width: 10, height: 10, dpr: 1, time: i, dt: 1, frame: i, params: {}, state: {}, mouse: { x: 0, y: 0, over: false, down: false }, random: Math.random }, [], true);
    const c = scriptConsole('g');
    expect(c.lines.map(l => [l.text, l.count])).toEqual([['frame 0', 1], ['{w: 10}', 1], ['frame 1', 1], ['{w: 10}', 1], ['frame 2', 1], ['{w: 10}', 1]]);
    expect(c.watches[0].history).toEqual([0, 1, 2]);
  });
});
