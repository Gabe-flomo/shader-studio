import { describe, it, expect } from 'vitest';
import { recordingBaseName, recordingsSettings } from '../recordingsFolder';

describe('recordings', () => {
  it('are named after the graph, or "shader graph" when it has no name yet', () => {
    expect(recordingBaseName('Sunset')).toBe('Sunset');
    expect(recordingBaseName('  ')).toBe('shader graph');
    expect(recordingBaseName(null)).toBe('shader graph');
    expect(recordingBaseName('a/b: c?')).toBe('a-b- c-');
  });

  it('go to Downloads by default on the web', () => {
    expect(recordingsSettings().mode).toBe('downloads');
  });
});
