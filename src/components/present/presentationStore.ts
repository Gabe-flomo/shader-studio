/**
 * presentationStore — the presentation open on the Present page, and the
 * page's view state (Edit, Slides or Scroll; the current step; the selected
 * block). Every change saves itself a moment later: a presentation is always
 * stored under its name, so there's no Save button to forget.
 */
import { create } from 'zustand';
import { cloneBlock, cloneStep, emptyPresentation, newStep, type Block, type Presentation, type PresentSource, type Step } from '../../types/presentation';
import { deletePresentation, freeName, loadPresentation, rememberLast, renamePresentation, savePresentation, type DeletedPresentation } from '../../present/storage';
import { toast } from '../ui/toastStore';
import { internPresentation } from '../../present/presentAssets';

export type PresentMode = 'edit' | 'slides' | 'scroll';

interface PresentationState {
  name: string | null;
  doc: Presentation | null;
  mode: PresentMode;
  step: number;
  selected: string | null;
  status: 'saved' | 'pending' | 'failed';
  /** When the open presentation was last written to storage. */
  savedAt: number;

  open(name: string): boolean;
  /** Save `doc` under a free name based on its title and open it. */
  adopt(doc: Presentation): string;
  create(title: string): string;
  rename(to: string): boolean;
  /** Delete the open presentation; what was stored comes back for Undo. */
  remove(): DeletedPresentation | null;
  close(): void;

  setMode(m: PresentMode): void;
  setStep(i: number): void;
  select(id: string | null): void;
  /** Change the document (immutably); saved a moment later. */
  update(fn: (p: Presentation) => Presentation): void;

  addStep(after: number): void;
  duplicateStep(i: number): void;
  deleteStep(i: number): void;
  moveStep(from: number, to: number): void;
  patchStep(i: number, patch: Partial<Omit<Step, 'id' | 'blocks'>>): void;

  addBlock(block: Block, at?: number): void;
  patchBlock(id: string, patch: Partial<Block>): void;
  replaceBlock(block: Block): void;
  deleteBlock(id: string): void;
  moveBlock(id: string, dir: -1 | 1): void;
  duplicateBlock(id: string): void;

  addSource(s: PresentSource): void;
  replaceSource(s: PresentSource): void;
  removeSource(id: string): void;
  setPoster(id: string, poster: string): void;
}

let timer: ReturnType<typeof setTimeout> | null = null;
const SAVE_MS = 500;

/** Which step holds a block. */
export function stepOfBlock(p: Presentation, id: string): number {
  return p.steps.findIndex(s => s.blocks.some(b => b.id === id));
}

export const usePresentation = create<PresentationState>((set, get) => {
  const flush = () => {
    timer = null;
    const { name, doc } = get();
    if (!name || !doc) return;
    const r = savePresentation(name, doc);
    set(r.ok ? { status: 'saved', savedAt: Date.now() } : { status: 'failed' });
    if (!r.ok) toast.error('Couldn’t save the presentation', { message: r.error });
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, SAVE_MS);
    set({ status: 'pending' });
  };
  const saveNow = () => { if (timer) { clearTimeout(timer); flush(); } };
  /**
   * Embedded pictures and font files (an imported file, a sample, a
   * presentation from before) move into the library and the font cache; the
   * open presentation keeps references, so what's saved here stays small.
   */
  const internOpen = async () => {
    const { doc, name } = get();
    if (!doc) return;
    let next: Presentation | null = null;
    try { next = await internPresentation(doc); } catch (e) { console.warn('[present] couldn’t move the pictures into the library', e); return; }
    if (!next || get().name !== name) return;
    const images = new Map((next.images ?? []).map(i => [i.id, i]));
    const fonts = next.fonts ?? [];
    get().update(p => ({
      ...p,
      ...(p.images ? { images: p.images.map(i => images.get(i.id) ?? i) } : {}),
      ...(p.fonts ? { fonts: p.fonts.map(f => (f.src ? fonts.find(g => g.family === f.family && g.weight === f.weight && g.style === f.style && g.unicodeRange === f.unicodeRange) ?? f : f)) } : {}),
    }));
  };
  const mapSteps = (fn: (s: Step, i: number) => Step) => get().update(p => ({ ...p, steps: p.steps.map(fn) }));

  return {
    name: null, doc: null, mode: 'edit', step: 0, selected: null, status: 'saved', savedAt: 0,

    open(name) {
      saveNow();
      const doc = loadPresentation(name);
      if (!doc) return false;
      rememberLast(name);
      set({ name, doc, step: 0, selected: null, status: 'saved', savedAt: doc.updatedAt });
      void internOpen();
      return true;
    },
    adopt(doc) {
      saveNow();
      const name = freeName(doc.title);
      const p = { ...doc, title: name, updatedAt: Date.now() };
      const r = savePresentation(name, p);
      if (!r.ok) toast.error('Couldn’t save the presentation', { message: r.error });
      set({ name, doc: p, step: 0, selected: null, status: r.ok ? 'saved' : 'failed', savedAt: r.ok ? Date.now() : 0, mode: 'edit' });
      void internOpen();
      return name;
    },
    create(title) {
      return get().adopt(emptyPresentation(title));
    },
    rename(to) {
      const { name, doc } = get();
      const t = to.trim();
      if (!name || !doc || !t) return false;
      saveNow();
      if (!renamePresentation(name, t)) return false;
      set({ name: t, doc: { ...doc, title: t } });
      return true;
    },
    remove() {
      const { name } = get();
      if (timer) { clearTimeout(timer); timer = null; }
      const gone = name ? deletePresentation(name) : null;
      set({ name: null, doc: null, step: 0, selected: null, mode: 'edit', status: 'saved' });
      return gone;
    },
    close() { saveNow(); set({ name: null, doc: null, step: 0, selected: null }); },

    setMode(mode) { set({ mode, selected: mode === 'edit' ? get().selected : null }); },
    setStep(i) {
      const n = get().doc?.steps.length ?? 0;
      set({ step: Math.max(0, Math.min(n - 1, i)), selected: null });
    },
    select(id) {
      const doc = get().doc;
      if (id && doc) {
        const s = stepOfBlock(doc, id);
        if (s >= 0 && s !== get().step) set({ step: s });
      }
      set({ selected: id });
    },
    update(fn) {
      const doc = get().doc;
      if (!doc) return;
      const next = fn(doc);
      if (next === doc) return;
      set({ doc: { ...next, updatedAt: Date.now() } });
      schedule();
    },

    addStep(after) {
      const s = newStep();
      get().update(p => { const steps = p.steps.slice(); steps.splice(after + 1, 0, s); return { ...p, steps }; });
      set({ step: after + 1, selected: null });
    },
    duplicateStep(i) {
      get().update(p => { const steps = p.steps.slice(); steps.splice(i + 1, 0, cloneStep(p.steps[i])); return { ...p, steps }; });
      set({ step: i + 1, selected: null });
    },
    deleteStep(i) {
      const before = get().doc;
      if (!before) return;
      get().update(p => {
        const steps = p.steps.filter((_, k) => k !== i);
        return { ...p, steps: steps.length ? steps : [newStep()] };
      });
      set(s => ({ step: Math.max(0, Math.min(s.step, (s.doc?.steps.length ?? 1) - 1)), selected: null }));
      toast.info('Step deleted', { action: { label: 'Undo', onClick: () => { get().update(() => before); set({ step: i }); } } });
    },
    moveStep(from, to) {
      const n = get().doc?.steps.length ?? 0;
      if (to < 0 || to >= n || from === to) return;
      get().update(p => { const steps = p.steps.slice(); const [s] = steps.splice(from, 1); steps.splice(to, 0, s); return { ...p, steps }; });
      if (get().step === from) set({ step: to });
    },
    patchStep(i, patch) { mapSteps((s, k) => (k === i ? { ...s, ...patch } : s)); },

    addBlock(block, at) {
      const i = get().step;
      mapSteps((s, k) => {
        if (k !== i) return s;
        const blocks = s.blocks.slice();
        blocks.splice(at ?? blocks.length, 0, block);
        return { ...s, blocks };
      });
      set({ selected: block.id });
    },
    patchBlock(id, patch) {
      mapSteps(s => (s.blocks.some(b => b.id === id) ? { ...s, blocks: s.blocks.map(b => (b.id === id ? { ...b, ...patch } as Block : b)) } : s));
    },
    replaceBlock(block) {
      mapSteps(s => (s.blocks.some(b => b.id === block.id) ? { ...s, blocks: s.blocks.map(b => (b.id === block.id ? block : b)) } : s));
    },
    deleteBlock(id) {
      const before = get().doc;
      mapSteps(s => ({ ...s, blocks: s.blocks.filter(b => b.id !== id) }));
      if (get().selected === id) set({ selected: null });
      if (before) toast.info('Block deleted', { action: { label: 'Undo', onClick: () => get().update(() => before) } });
    },
    moveBlock(id, dir) {
      mapSteps(s => {
        const i = s.blocks.findIndex(b => b.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= s.blocks.length) return s;
        const blocks = s.blocks.slice();
        [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
        return { ...s, blocks };
      });
    },
    duplicateBlock(id) {
      let copy: Block | null = null;
      mapSteps(s => {
        const i = s.blocks.findIndex(b => b.id === id);
        if (i < 0) return s;
        copy = cloneBlock(s.blocks[i]);
        const blocks = s.blocks.slice();
        blocks.splice(i + 1, 0, copy);
        return { ...s, blocks };
      });
      if (copy) set({ selected: (copy as Block).id });
    },

    addSource(src) { get().update(p => (p.sources.some(s => s.id === src.id) ? p : { ...p, sources: [...p.sources, src] })); },
    replaceSource(src) {
      // Blocks keep their choices where the new snapshot still has them (controls by id).
      get().update(p => {
        const sources = p.sources.map(s => (s.id === src.id ? src : s));
        const known = new Set(src.bundle.play.controls.map(c => c.id));
        const steps = p.steps.map(st => ({ ...st, blocks: st.blocks.map(b => (b.type === 'interactive' && b.source === src.id ? { ...b, controls: b.controls.filter(c => known.has(c.controlId)) } : b)) }));
        return { ...p, sources, steps };
      });
    },
    removeSource(id) { get().update(p => ({ ...p, sources: p.sources.filter(s => s.id !== id) })); },
    setPoster(id, poster) { get().update(p => ({ ...p, sources: p.sources.map(s => (s.id === id ? { ...s, poster } : s)) })); },
  };
});

// Leaving the page (or the app) saves what's pending.
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { if (timer) { clearTimeout(timer); const { name, doc } = usePresentation.getState(); if (name && doc) savePresentation(name, doc); } });
