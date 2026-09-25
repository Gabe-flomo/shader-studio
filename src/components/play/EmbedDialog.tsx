/**
 * EmbedDialog — put the Play setup on a website.
 *
 * Mode: a player (picture + controls) or a background (picture only, behind
 * your content). Output: a paste-in snippet for any page or site builder, or
 * a self-contained HTML file to host or iframe. Both run the standalone
 * runtime (play/runtime/play-runtime.js) with no app code.
 */
import { useMemo, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { DEFAULT_EMBED, buildPlaySnippet, type EmbedOptions } from '../../play/exportHtml';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { Field } from '../ui/Field';
import { reportFileResult } from '../shell/reportFileResult';
import { toast } from '../ui/toastStore';

const KB = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

export function EmbedDialog({ onClose }: { onClose: () => void }) {
  const tk = useTokens();
  const playWebInput = useNodeGraphStore(s => s.playWebInput);
  const exportPlayHtml = useNodeGraphStore(s => s.exportPlayHtml);
  const hasNulls = useNodeGraphStore(s => s.play.layers.some(l => l.kind === 'null'));
  const usesOsc = useNodeGraphStore(s => s.play.mappings.some(m => m.source.kind === 'osc' || (m.source.kind === 'trigger' && m.source.trigger.on === 'osc')));
  const needsGesture = useNodeGraphStore(s => s.play.mappings.some(m => m.enabled && (m.source.kind === 'midi' || m.source.kind === 'live' || (m.source.kind === 'trigger' && (m.source.trigger.on === 'note' || m.source.trigger.on === 'audio')))));
  const [title, setTitle] = useState('Shader Studio');
  const [opts, setOpts] = useState<EmbedOptions>(DEFAULT_EMBED);
  const set = (p: Partial<EmbedOptions>) => setOpts(o => ({ ...o, ...p, ...(p.mode === 'background' ? { markers: false } : p.mode === 'player' ? { markers: true } : {}) }));
  const bg = opts.mode === 'background';
  // Built once per open + option change; the snapshot is taken when the dialog opens.
  const { input, missing } = useMemo(() => playWebInput(title), [playWebInput, title]);
  const snippet = useMemo(() => buildPlaySnippet(input, opts), [input, opts]);
  // Show what the reader recognises: the div, then the mount call; the runtime and the piece are elided.
  const preview = useMemo(() => {
    const lines = snippet.trimEnd().split('\n');
    let mountAt = -1;
    for (let i = lines.length - 1; i >= 0; i--) if (lines[i].includes('ShaderStudioPlay.mount(e,')) { mountAt = i; break; }
    const mount = mountAt >= 0 ? lines[mountAt].replace(/mount\(e, \{.*\}, \{/, 'mount(e, {…your piece…}, {') : '';
    return [lines[0], lines[1], '<script>', `  /* Shader Studio runtime, ${KB(snippet.length)} with your piece */`, '  ' + mount.trim(), '</script>'].join('\n');
  }, [snippet]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(snippet); toast.success('Embed snippet copied', { message: bg ? 'Paste it inside the section you want it behind.' : 'Paste it where the player should go.' }); }
    catch { toast.error('Couldn’t copy', { message: 'Your browser blocked the clipboard. Download the page instead.' }); }
  };
  const download = async () => { if (reportFileResult(await exportPlayHtml(opts, title), { failTitle: 'Couldn’t export the page', success: 'Web page exported' })) onClose(); };

  const label = (text: string) => <div style={{ color: tk.text.faint, font: `600 10.5px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', margin: '14px 0 6px' }}>{text}</div>;
  const note = (text: string) => <div style={{ color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}`, marginTop: 6 }}>{text}</div>;

  return (
    <Modal
      title="Put it on a website"
      subtitle="The picture, and optionally the controls, as a snippet or a page"
      icon="code"
      onClose={onClose}
      width={560}
      footer={(
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button icon="export" onClick={download}>Download page</Button>
          <Button variant="primary" icon="copy" onClick={copy}>Copy snippet</Button>
        </div>
      )}
    >
      <div style={{ padding: '4px 20px 18px' }}>
      {label('What')}
      <Segmented
        fill
        ariaLabel="Embed mode"
        value={opts.mode}
        onChange={mode => set({ mode })}
        options={[
          { value: 'player', label: 'Player', sub: 'picture + controls' },
          { value: 'background', label: 'Background', sub: 'picture only' },
        ]}
      />
      {bg ? (
        <>
          {label('Where')}
          <Segmented
            fill
            ariaLabel="Background placement"
            value={opts.placement}
            onChange={placement => set({ placement })}
            options={[
              { value: 'section', label: 'Fill its section', sub: 'behind that block' },
              { value: 'page', label: 'Whole page', sub: 'fixed, behind everything' },
            ]}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            <Toggle checked={opts.followPage} onChange={followPage => set({ followPage })} label="Mouse mappings follow the pointer across the whole page" />
            {hasNulls && <Toggle checked={opts.markers} onChange={markers => set({ markers })} label="Show null markers" />}
            {usesOsc && <Toggle checked={opts.osc} onChange={osc => set({ osc })} label="Connect to the OSC bridge on load" />}
          </div>
          {note('The background never takes clicks or keys from your page, pauses when it scrolls out of view or the tab is hidden, and shows a still frame to visitors who ask for reduced motion. Keyboard and click triggers still fire.')}
          {needsGesture && note('MIDI and live audio need a visitor to click Enable first, which a background has no button for, so those mappings stay at rest there. Use the player for them.')}
        </>
      ) : (
        <>
          {label('Size')}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Segmented size="sm" ariaLabel="Fit" value={opts.fit} onChange={fit => set({ fit })} options={[{ value: 'contain', label: 'Keep shape', title: 'Letterbox to the canvas shape set on the Play page' }, { value: 'cover', label: 'Fill', title: 'Fill the player’s box' }]} />
            <span style={{ color: tk.text.muted, font: `12px ${fontFamily.ui}` }}>Snippet height</span>
            <Field type="number" value={String(opts.height)} onChange={e => set({ height: Math.max(200, parseInt(e.target.value, 10) || 560) })} height={30} mono style={{ width: 90 }} suffix="px" />
          </div>
          {note('The page version fills the browser window. On a phone the controls move under the picture.')}
        </>
      )}

      {label('Title')}
      <Field value={title} onChange={e => setTitle(e.target.value)} height={32} placeholder="Shown on the player and as the page title" />

      {label(`Snippet · ${KB(snippet.length)}`)}
      <pre style={{ margin: 0, maxHeight: 120, overflow: 'auto', padding: '8px 10px', borderRadius: radius.md, background: tk.bg.field, color: tk.text.secondary, font: `11px/1.5 ${fontFamily.mono}`, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {preview}
      </pre>
      {note(bg
        ? (opts.placement === 'section'
          ? 'Paste it as the first thing inside the section, hero or card you want it behind (in Webflow, Squarespace or WordPress: an Embed / Code block). Your text stays on top.'
          : 'Paste it anywhere in the page, ideally near the top of <body>. It sits behind all content.')
        : 'Paste it where the player should appear. Or download the page, host it, and use <iframe src="…" style="border:0;width:100%;height:560px">. Add ?mode=background to the page URL for the picture only.')}

      {missing.length > 0 && (
        <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: radius.md, background: alpha(tk.status.warning, 0.12), color: tk.status.warningText, font: `12px/1.5 ${fontFamily.ui}` }}>
          This graph uses {missing.join(', ')}, which can’t run outside Shader Studio. {missing.length === 1 ? 'It' : 'They'} will be blank or frozen in the export.
        </div>
      )}
      </div>
    </Modal>
  );
}
