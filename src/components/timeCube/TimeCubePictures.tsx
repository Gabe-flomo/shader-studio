/**
 * The Time Cube card's pictures (docs/time-cube.md, "From pictures"): the list of pictures the cube
 * stacks, one a frame, with thumbnails; add more (files: a browser or a phone, several at once; the
 * desktop app's dialog keeps paths on disk), add from the Library (by reference), sort by name,
 * reverse, move or remove one. Nothing is added to the Library.
 */
import { useEffect, useRef, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import type { GraphNode } from '../../types/nodeGraph';
import { MAX_FRAMES } from '../../lib/timeCube/plan';
import {
  movePicture, pictureCap, picturesOf, picturesWhere, removePicture, reversePictures, sortByName, takePictures, type TcPicture,
} from '../../lib/timeCube/pictures';
import {
  fitEmbedded, keepInGraph, onPictureThumbs, pickPicturePaths, pictureThumb, picturesFromFiles, picturesFromLibrary, picturesFromPaths, picturesOnDiskAvailable,
} from '../../lib/timeCube/pictureSource';
import type { BackgroundImageMeta } from '../../lib/backgroundLibrary';

/** The pictures' part of the Time Cube card. */
export function TimeCubePictures({ node, touch = false }: { node: GraphNode; touch?: boolean }) {
  const tk = useTokens();
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const list = picturesOf(node.params);
  const cap = pictureCap(node.params);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [library, setLibrary] = useState<BackgroundImageMeta[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [showLibrary, setShowLibrary] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [, bump] = useState(0);
  // Thumbnails arrive as pictures are read (picked, or built after the graph opens).
  useEffect(() => onPictureThumbs(() => bump(n => n + 1)), []);

  useEffect(() => {
    if (!showLibrary) return;
    let live = true;
    import('../../lib/backgroundLibrary').then(m => m.listImages()).then(l => { if (live) setLibrary(l); }).catch(() => { if (live) setLibrary([]); });
    return () => { live = false; };
  }, [showLibrary]);

  const write = (pictures: TcPicture[]) => updateNodeParams(node.id, { pictures });

  /** Add what was picked (`refused`: already left out past the cap), with a note for what wasn't taken. */
  const add = async (picked: TcPicture[], unreadable = 0, refused = 0) => {
    const { list: next, refused: more } = takePictures(list, picked, cap);
    write(await fitEmbedded(next));
    const out = refused + more;
    setNote([
      out ? `${out} ${out === 1 ? 'picture was' : 'pictures were'} left out: the cube holds ${cap} frames (Frames). Raise Frames (up to ${MAX_FRAMES}) to take more.` : '',
      unreadable ? `${unreadable} ${unreadable === 1 ? 'file' : 'files'} couldn't be read as pictures.` : '',
    ].filter(Boolean).join(' '));
  };

  const onFiles = async (files: FileList | null) => {
    const arr = files ? Array.from(files) : [];
    if (!arr.length) return;
    setBusy(`Reading ${arr.length} ${arr.length === 1 ? 'picture' : 'pictures'}…`);
    try {
      // Only the ones that fit are read; the rest are refused in name order, as takePictures does.
      const room = Math.max(0, cap - list.length);
      const take = sortByName(arr).slice(0, room);
      const { pictures, unreadable } = await picturesFromFiles(take, list.filter(p => p.src).length + take.length);
      await add(pictures, unreadable, arr.length - take.length);
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  };

  const onDisk = async () => {
    try {
      const paths = await pickPicturePaths();
      if (!paths?.length) return;
      setBusy(`Reading ${paths.length} ${paths.length === 1 ? 'picture' : 'pictures'}…`);
      const room = Math.max(0, cap - list.length);
      const take = sortByName(paths.map(p => ({ name: p.split(/[\\/]/).pop() || p, p }))).slice(0, room).map(x => x.p);
      const { pictures, unreadable } = await picturesFromPaths(take);
      await add(pictures, unreadable, paths.length - take.length);
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  };

  const addFromLibrary = async () => {
    const metas = (library ?? []).filter(m => chosen.has(m.id));
    if (!metas.length) return;
    await add(picturesFromLibrary(metas));
    setChosen(new Set()); setShowLibrary(false);
  };

  const keep = async () => {
    setBusy('Keeping copies in the graph…');
    try {
      const { pictures, unreadable } = await keepInGraph(list);
      write(pictures);
      setNote(unreadable ? `${unreadable} couldn't be read, so they still point at their files.` : 'The pictures are now kept with the graph: it opens anywhere.');
    } finally { setBusy(''); }
  };

  const small = { fontSize: 11.5, lineHeight: 1.4, color: tk.text.muted } as const;
  const btn = {
    padding: touch ? '8px 10px' : '4px 9px', border: 0, borderRadius: radius.sm, cursor: 'pointer',
    background: tk.bg.field, color: tk.text.primary, font: `600 11.5px ${fontFamily.ui}`,
  } as const;
  const tiny = { ...btn, padding: touch ? '4px 7px' : '1px 5px', fontWeight: 500, fontSize: 10.5 } as const;
  const onDiskOk = picturesOnDiskAvailable();
  const where = picturesWhere(list);
  const over = list.length > cap;

  return (
    <div data-tc-pictures style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={small}>
        {list.length ? `${Math.min(list.length, cap)} of ${cap} frames${where ? ` · ${where}` : ''}` : `Pick up to ${cap} pictures (Frames), one a frame, in file-name order. They stay with this graph: nothing is added to the Library.`}
      </span>
      {over && <span style={{ ...small, color: tk.status.warningText }}>{`Using the first ${cap} of ${list.length} pictures: Frames is ${cap}.`}</span>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {onDiskOk
          ? <button type="button" style={btn} onClick={() => void onDisk()} title="Pick pictures on this computer: they are read from where they are each time the graph opens (nothing is copied)">Add pictures…</button>
          : <button type="button" style={btn} onClick={() => fileRef.current?.click()} title="Pick several pictures at once: they are kept with the graph">Add pictures…</button>}
        {onDiskOk && <button type="button" style={btn} onClick={() => fileRef.current?.click()} title="Pick pictures and keep copies with the graph (it opens on any computer)">Add, keep in graph…</button>}
        <button type="button" style={btn} onClick={() => setShowLibrary(v => !v)} title="Pictures already in the Library, by reference">{showLibrary ? 'Close Library' : 'From the Library…'}</button>
        <input ref={fileRef} data-tc-pictures-input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => { void onFiles(e.target.files); e.target.value = ''; }} />
      </div>
      {list.length > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <button type="button" style={btn} onClick={() => write(sortByName(list))} title="File-name order (frame 2 before frame 10)">Sort by name</button>
          <button type="button" style={btn} onClick={() => write(reversePictures(list))} title="Last picture first">Reverse</button>
          {onDiskOk && list.some(p => p.path && !p.src) && <button type="button" style={btn} onClick={() => void keep()} title="Copy the pictures on disk into the graph, so it opens on another computer">Keep in graph</button>}
          <button type="button" style={btn} onClick={() => { write([]); setNote(''); }} title="Take every picture off">Clear</button>
        </div>
      )}
      {busy && <span style={small}>{busy}</span>}
      {note && <span style={{ ...small, color: /left out|couldn't/.test(note) ? tk.status.warningText : tk.text.muted }}>{note}</span>}

      {showLibrary && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 6, borderRadius: radius.md, background: tk.bg.subtle }}>
          {library === null && <span style={small}>Loading the Library…</span>}
          {library?.length === 0 && <span style={small}>No pictures in the Library yet.</span>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
            {library?.map(m => (
              <button key={m.id} type="button" title={m.name} onClick={() => setChosen(s => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })}
                style={{ padding: 0, border: `2px solid ${chosen.has(m.id) ? tk.accent.base : 'transparent'}`, borderRadius: 4, background: '#000', cursor: 'pointer', aspectRatio: '1', overflow: 'hidden' }}>
                {m.thumb ? <img src={m.thumb} alt={m.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : null}
              </button>
            ))}
          </div>
          {!!library?.length && <button type="button" style={btn} disabled={!chosen.size} onClick={() => void addFromLibrary()}>{chosen.size ? `Add ${chosen.size}` : 'Choose some'}</button>}
        </div>
      )}

      {list.length > 0 && (
        <div data-tc-picture-list style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${touch ? 72 : 60}px, 1fr))`, gap: 4, maxHeight: 220, overflowY: 'auto' }}>
          {list.map((p, i) => {
            const thumb = pictureThumb(p.id) ?? p.src;
            const unused = i >= cap;
            return (
              <div key={p.id} title={`${i + 1}. ${p.name}${p.path ? `\n${p.path}` : ''}${unused ? '\nNot used: past Frames' : ''}`}
                style={{ position: 'relative', borderRadius: 4, overflow: 'hidden', background: '#000', aspectRatio: '1', opacity: unused ? 0.35 : 1 }}>
                {thumb ? <img src={thumb} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} /> : <span style={{ ...small, position: 'absolute', inset: 4, color: '#aaa', overflow: 'hidden' }}>{p.name}</span>}
                <span style={{ position: 'absolute', left: 2, top: 2, padding: '0 3px', borderRadius: 3, background: 'rgba(0,0,0,0.6)', color: '#fff', font: `600 9.5px ${fontFamily.ui}` }}>{i + 1}</span>
                <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'space-between', background: 'rgba(0,0,0,0.45)' }}>
                  <button type="button" aria-label={`Move ${p.name} earlier`} style={{ ...tiny, background: 'transparent', color: '#fff' }} disabled={i === 0} onClick={() => write(movePicture(list, i, i - 1))}>‹</button>
                  <button type="button" aria-label={`Remove ${p.name}`} style={{ ...tiny, background: 'transparent', color: '#fff' }} onClick={() => write(removePicture(list, p.id))}>×</button>
                  <button type="button" aria-label={`Move ${p.name} later`} style={{ ...tiny, background: 'transparent', color: '#fff' }} disabled={i === list.length - 1} onClick={() => write(movePicture(list, i, i + 1))}>›</button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
