/**
 * StartSheet — the desktop's first-run "Start" (UX audit §3.2; learnStore.ts says when): the ways in,
 * side by side. The Scene builder, the "Getting started" lesson, or a blank graph; or an example,
 * with a few pictured and every folder one click away. Skip (or Esc) keeps the starter graph that
 * is already open. Help → Start… brings it back.
 */
import { useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';
import { Modal } from '../ui/Modal';
import { EXAMPLE_FOLDERS, EXAMPLE_INDEX, useNodeGraphStore } from '../../store/useNodeGraphStore';
import { openBuilder } from '../../builders/open';
import { requestPage } from '../page';
import { useExampleStills } from '../present/useSampleStills';
import { GETTING_STARTED } from '../../present/samples';
import { openLesson } from './LearnDialog';
import { useLearnUi } from './learnStore';

/** A few examples with their pictures, across what Playfield does. */
export const FEATURED_EXAMPLES = ['learnFBM', 'particleGalaxy', 'agentParticles', 'learn3dLight', 'echoTrails', 'playGlowText'];

export function StartSheet() {
  const tk = useTokens();
  const close = useLearnUi(s => s.closeStart);
  const openLearn = useLearnUi(s => s.openLearn);
  const featured = FEATURED_EXAMPLES.filter(k => EXAMPLE_INDEX[k]);
  const stills = useExampleStills(featured);
  const [folder, setFolder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const folders = EXAMPLE_FOLDERS.filter(f => f.keys.some(k => EXAMPLE_INDEX[k]));
  const openFolder = folders.find(f => f.label === folder);

  const example = (k: string) => { requestPage('studio'); void useNodeGraphStore.getState().loadExampleGraph(k); close(); };
  const sceneBuilder = () => { requestPage('studio'); close(); openBuilder('scenes'); };
  const lesson = async () => { setBusy(true); const ok = await openLesson(GETTING_STARTED.title); setBusy(false); if (ok) close(); };
  const blank = () => { requestPage('studio'); useNodeGraphStore.getState().clearToMinimal(); close(); };

  const caps = { margin: 0, color: tk.text.faint, font: `700 10.5px ${fontFamily.ui}`, letterSpacing: '0.07em', textTransform: 'uppercase' as const };
  return (
    <Modal
      title="Start"
      subtitle="Pick a way in. Help → Start brings this back."
      icon="presets"
      onClose={close}
      width={860}
      footer={<>
        <Button variant="ghost" icon="book" onClick={openLearn}>All lessons…</Button>
        <span style={{ flex: 1 }} />
        <Button onClick={close} data-start-skip="">Skip: keep the starter graph</Button>
      </>}
    >
      <div data-start-sheet="" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
          <Choice icon="presets" title="Scene builder" line="A 2D, agent, grid or 3D scene, made from a form" onClick={sceneBuilder} data="scene" />
          <Choice icon="book" title="Getting started" line={busy ? 'Opening the lesson…' : 'A short lesson: nodes, wires, sliders, saving'} onClick={() => void lesson()} data="lesson" />
          <Choice icon="plus" title="Blank graph" line="Just UV and the Output: build from nothing" onClick={blank} data="blank" />
        </div>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={caps}>Or open an example</p>
          <div data-start-examples="" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14 }}>
            {featured.map(k => (
              <button key={k} type="button" data-start-example={k} onClick={() => example(k)} title={EXAMPLE_INDEX[k].description ?? EXAMPLE_INDEX[k].label}
                style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 6, minWidth: 0, textAlign: 'left', cursor: 'pointer', border: `1px solid ${tk.border.default}`, borderRadius: radius.card, overflow: 'hidden', background: tk.bg.panel, color: tk.text.primary, font: 'inherit' }}>
                {/* The picture sits inset in the card, with its own rounded corners */}
                <span style={{ position: 'relative', display: 'block', aspectRatio: '16 / 9', borderRadius: radius.md, overflow: 'hidden', background: `linear-gradient(135deg, ${tk.bg.render}, ${alpha(tk.accent.base, 0.3)})` }}>
                  {stills[k] && <img src={stills[k]!} alt="" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
                </span>
                <span style={{ padding: '0 3px 2px', font: `600 12px/1.3 ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{EXAMPLE_INDEX[k].label}</span>
              </button>
            ))}
          </div>
          <div data-start-folders="" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {folders.map(f => {
              const on = f.label === folder;
              return (
                <button key={f.label} type="button" aria-pressed={on} onClick={() => setFolder(on ? null : f.label)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px', border: 0, borderRadius: 14, cursor: 'pointer', background: on ? tk.bg.selected : tk.bg.field, color: on ? tk.accent.text : tk.text.secondary, font: `${on ? 600 : 500} 12px ${fontFamily.ui}` }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: f.color }} />
                  {f.label}
                  <span style={{ color: tk.text.faint, fontWeight: 500 }}>{f.keys.filter(k => EXAMPLE_INDEX[k]).length}</span>
                </button>
              );
            })}
          </div>
          {openFolder && (
            <div data-start-folder={openFolder.label} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 2, padding: 6, borderRadius: radius.md, background: tk.bg.subtle }}>
              {openFolder.keys.filter(k => EXAMPLE_INDEX[k]).sort((a, b) => EXAMPLE_INDEX[a].label.localeCompare(EXAMPLE_INDEX[b].label)).map(k => (
                <button key={k} type="button" onClick={() => example(k)} title={EXAMPLE_INDEX[k].description ?? undefined}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 8px', border: 0, borderRadius: radius.md, cursor: 'pointer', background: 'none', color: tk.text.secondary, font: `500 12.5px ${fontFamily.ui}`, textAlign: 'left', minWidth: 0 }}
                  onMouseEnter={e => { e.currentTarget.style.background = tk.bg.hover; }} onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}>
                  <Icon name="graphs" size={14} style={{ color: tk.text.faint, flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{EXAMPLE_INDEX[k].label}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}

function Choice({ icon, title, line, onClick, data }: { icon: IconName; title: string; line: string; onClick: () => void; data: string }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <button type="button" data-start-choice={data} onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 14px', minWidth: 0, textAlign: 'left', cursor: 'pointer',
        border: `1px solid ${hover ? tk.border.strong : tk.border.default}`, borderRadius: radius.card, background: hover ? tk.bg.hover : tk.bg.panel,
        color: tk.text.primary, font: 'inherit',
      }}>
      <span style={{ width: 34, height: 34, borderRadius: radius.md, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: alpha(tk.accent.base, 0.12), color: tk.accent.base }}>
        <Icon name={icon} size={17} />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <b style={{ font: `650 13.5px ${fontFamily.ui}` }}>{title}</b>
        <span style={{ color: tk.text.muted, font: `500 12px/1.4 ${fontFamily.ui}` }}>{line}</span>
      </span>
    </button>
  );
}
