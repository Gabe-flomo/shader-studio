import { describe, expect, it } from 'vitest';
import { clearNewTags, clearPluginCrash, crashedPlugins, enabledUnits, markPluginCrashed, parsePluginPrefs, DEFAULT_PLUGIN_PREFS } from '../pluginSettings';
import { crashNote, parseProbeReport } from '../pluginSafety';

describe('plug-ins switched off for crashing', () => {
  it('a crash switches the unit off with its note, which survives a reload and clearing New tags', () => {
    let p = markPluginCrashed({ ...DEFAULT_PLUGIN_PREFS, units: { 'aumu/Ni$D/-NI-': { on: true, new: true } } }, 'aumu/Ni$D/-NI-', 'Crashed Playfield while loading', 1234, 'Kontakt 7');
    expect(enabledUnits([{ code: 'aumu/Ni$D/-NI-' }], p)).toEqual([]);
    p = parsePluginPrefs(JSON.stringify(p));
    p = clearNewTags(p);
    expect(crashedPlugins(p)).toEqual([{ code: 'aumu/Ni$D/-NI-', why: 'Crashed Playfield while loading', at: 1234, name: 'Kontakt 7' }]);
  });

  it('Try again that works clears the note and switches it back on', () => {
    const p = clearPluginCrash(markPluginCrashed(DEFAULT_PLUGIN_PREFS, 'aumu/XfsX/Tfer', 'x', 1), 'aumu/XfsX/Tfer');
    expect(crashedPlugins(p)).toEqual([]);
    expect(enabledUnits([{ code: 'aumu/XfsX/Tfer' }], p)).toHaveLength(1);
  });

  it('reads trial reports and names the stage', () => {
    expect(parseProbeReport({ code: 'a/b/c', name: 'Serum', status: 'crashed', message: 'signal 11' })).toEqual({ code: 'a/b/c', name: 'Serum', status: 'crashed', message: 'signal 11' });
    expect(parseProbeReport({ code: 'a/b/c', status: 'weird' })).toBeNull();
    expect(crashNote('window')).toMatch(/window/);
    expect(crashNote(undefined)).toBe('Crashed Playfield while loading');
  });
});
