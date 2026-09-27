/**
 * The top bar's Import reads the file's kind: a .playfile opens its
 * preview, a .present.json goes to the Present page as a new presentation, a
 * library merges, anything else is a graph for the Studio.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  file: null as string | Uint8Array | null,
  importGraph: vi.fn(() => ({ ok: true as const })),
  importPresentationText: vi.fn<(text: string) => string | null>(() => 'Intro'),
  importLibraryBytes: vi.fn(),
  openPlayfileBytes: vi.fn(async () => true),
}));
vi.mock('../../../utils/fileIO', () => ({
  openBinaryFile: async () => (h.file === null ? null : { name: 'x', bytes: typeof h.file === 'string' ? new TextEncoder().encode(h.file) : h.file }),
  errorMessage: (e: unknown) => String(e),
}));
vi.mock('../../../playfile/app', () => ({ openPlayfileBytes: h.openPlayfileBytes }));
vi.mock('../../../store/useNodeGraphStore', () => ({ useNodeGraphStore: { getState: () => ({ importGraph: h.importGraph }) } }));
vi.mock('../../present/presentationFiles', () => ({ importPresentationText: h.importPresentationText }));
vi.mock('../../../utils/libraryActions', () => ({ importLibraryBytes: h.importLibraryBytes }));
vi.mock('../../ui/toastStore', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { fileKind, importAnyFile } from '../importAnyFile';

beforeEach(() => { vi.clearAllMocks(); h.file = null; });

describe('top bar Import', () => {
  it('opens a .present.json on the Present page', async () => {
    h.file = JSON.stringify({ kind: 'shader-studio-presentation', title: 'Intro', steps: [], sources: [] });
    const navigate = vi.fn();
    expect(await importAnyFile(navigate)).toBe('presentation');
    expect(h.importPresentationText).toHaveBeenCalledWith(h.file);
    expect(navigate).toHaveBeenCalledWith('present');
    expect(h.importGraph).not.toHaveBeenCalled();
  });

  it('stays put when the presentation file is refused', async () => {
    h.file = JSON.stringify({ kind: 'shader-studio-presentation' });
    h.importPresentationText.mockReturnValueOnce(null);
    const navigate = vi.fn();
    expect(await importAnyFile(navigate)).toBe(null);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('imports a graph file as a graph, without leaving the page', async () => {
    h.file = JSON.stringify({ nodes: [] });
    const navigate = vi.fn();
    expect(await importAnyFile(navigate)).toBe('graph');
    expect(h.importGraph).toHaveBeenCalledWith(h.file);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('merges a library.json into the library', async () => {
    h.file = JSON.stringify({ kind: 'shader-studio-library', version: 1, savedAt: 0, items: {} });
    expect(await importAnyFile(vi.fn())).toBe('library');
    expect(h.importLibraryBytes).toHaveBeenCalled();
  });

  it('does nothing when the picker is cancelled', async () => {
    const navigate = vi.fn();
    expect(await importAnyFile(navigate)).toBe(null);
    expect(h.importGraph).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('opens a .playfile’s preview (and still reads the old formats by their content)', async () => {
    const { writePlayfile } = await import('../../../playfile/writer');
    h.file = (await writePlayfile([{ kind: 'graph', name: 'G', data: '{"nodes":[]}' }])).bytes;
    expect(await importAnyFile(vi.fn())).toBe('playfile');
    expect(h.openPlayfileBytes).toHaveBeenCalled();
    expect(h.importGraph).not.toHaveBeenCalled();
    expect(h.importLibraryBytes).not.toHaveBeenCalled();
  });

  it('reads the kind, not the name', () => {
    expect(fileKind('{"kind":"shader-studio-presentation"}')).toBe('presentation');
    expect(fileKind('{"kind":"shader-studio-play","nodes":[]}')).toBe('graph');
    expect(fileKind('not json')).toBe('graph');
  });
});
