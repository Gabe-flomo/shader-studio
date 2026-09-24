import { useState, type ReactNode } from 'react';
import { ThemeOverrideContext, useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import type { ThemeMode } from '../../theme/tokens';
import { TYPE_COLORS } from '../NodeGraph/typeColors';
import { Button, IconButton } from './Button';
import { Callout } from './Callout';
import { Chip } from './Chip';
import { Segmented, Toggle } from './Choice';
import { Field, TypeSelect } from './Field';
import { Kbd } from './Kbd';
import { Menu } from './Menu';
import { Modal } from './Modal';
import { RulerSlider } from './RulerSlider';
import { Toaster } from './Toaster';
import { toast } from './toastStore';

// Dev-only page (open the app with #ui) showing every primitive in both themes side by side.

export function UiGallery() {
  return (
    // index.css locks body scrolling for the app, so the gallery scrolls its own box.
    <div style={{ height: '100vh', overflow: 'auto' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', minHeight: '100%' }}>
        {(['light', 'dark'] as ThemeMode[]).map(m => (
          <ThemeOverrideContext.Provider key={m} value={m}>
            <Column mode={m} />
          </ThemeOverrideContext.Provider>
        ))}
      </div>
      <Toaster />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const tk = useTokens();
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint }}>{title}</div>
      {children}
    </section>
  );
}

const row = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const };

function Column({ mode }: { mode: ThemeMode }) {
  const tk = useTokens();
  const [radiusV, setRadius] = useState(0.3);
  const [bright, setBright] = useState(10);
  const [count, setCount] = useState(6);
  const [edge, setEdge] = useState(0.05);
  const [name, setName] = useState('Wobbly Disc');
  const [type, setType] = useState('vec2');
  const [snap, setSnap] = useState(true);
  const [loop, setLoop] = useState<'once' | 'loop' | 'interpolate'>('loop');
  const [tool, setTool] = useState<'select' | 'add' | 'draw'>('select');
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [modal, setModal] = useState(false);

  return (
    <div style={{ flex: '1 1 480px', minWidth: 0, padding: 32, background: tk.bg.app, color: tk.text.primary, font: `12.5px ${fontFamily.ui}`, display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{mode === 'light' ? 'Light' : 'Dark'}</div>

      <Section title="Buttons">
        <div style={row}>
          <Button variant="primary">Done</Button>
          <Button icon="export">Save as preset</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger" icon="trash">Delete</Button>
          <Button size="sm" icon="fit">Fit</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div style={row}>
          <IconButton icon="fit" label="Fit all nodes in view" shortcut="f" />
          <IconButton icon="minimap" label="Hide minimap" active />
          <IconButton icon="trash" label="Clear all nodes" tone="danger" />
          <IconButton icon="eye" label="Preview this node in isolation" size="sm" />
          <IconButton icon="moon" label="Switch to dark theme" />
        </div>
      </Section>

      <Section title="Fields">
        <div style={{ ...row, maxWidth: 420 }}>
          <Field value={name} onChange={e => setName(e.target.value)} style={{ flex: 1 }} />
          <TypeSelect value={type} options={['float', 'vec2', 'vec3', 'vec4']} onChange={setType} />
        </div>
        <div style={{ ...row, maxWidth: 420 }}>
          <Field mono defaultValue="shader-export" suffix=".webm" style={{ flex: 1 }} />
          <Field mono defaultValue="1/0" invalid style={{ width: 120 }} />
        </div>
      </Section>

      <Section title="Toggles · segmented">
        <div style={row}>
          <Toggle checked={snap} onChange={setSnap} label="Always snap" />
          <Toggle checked={!snap} onChange={v => setSnap(!v)} label="Bypass" />
          <Toggle checked={false} onChange={() => {}} label="Disabled" disabled />
        </div>
        <div style={row}>
          <Segmented ariaLabel="End behaviour" value={loop} onChange={setLoop}
            options={[{ value: 'once', label: 'Play once' }, { value: 'loop', label: 'Loop' }, { value: 'interpolate', label: 'Smooth loop' }]} />
          <Segmented ariaLabel="Tool" value={tool} onChange={setTool}
            options={[{ value: 'select', label: 'Select', shortcut: 'v' }, { value: 'add', label: 'Add', shortcut: 'c' }, { value: 'draw', label: 'Draw', shortcut: 'd' }]} />
        </div>
      </Section>

      <Section title="Chips · keycaps">
        <div style={row}>
          <Chip onClick={() => {}}>sin(f)</Chip>
          <Chip active>length(v2)</Chip>
          <Chip dot={TYPE_COLORS.float}>sharp</Chip>
          <Chip dot={TYPE_COLORS.vec2}>uv</Chip>
          <Chip mono={false}>2D Primitives</Chip>
          <Kbd combo="cmd+g" /><Kbd combo="shift+f" /><Kbd combo="?" />
        </div>
      </Section>

      <Section title="Ruler slider">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 330, background: tk.bg.panel, borderRadius: 14, padding: '10px 12px 10px 16px', boxShadow: tk.shadow.card }}>
          {[
            ['Radius', <RulerSlider key="r" ariaLabel="Radius" value={radiusV} min={0.01} max={2} defaultValue={0.3} onChange={setRadius} />],
            ['Brightness', <RulerSlider key="b" ariaLabel="Brightness" value={bright} min={0.1} max={100} step={0.1} defaultValue={10} onChange={setBright} />],
            ['Count', <RulerSlider key="c" ariaLabel="Count" value={count} min={1} max={12} integer defaultValue={6} onChange={setCount} />],
            ['Near min', <RulerSlider key="e" ariaLabel="Edge" value={edge} min={0.01} max={2} defaultValue={0.05} onChange={setEdge} />],
            ['Keyframed', <RulerSlider key="k" ariaLabel="Keyframed" value={0.41} min={0.01} max={2} onChange={() => {}} keyframed={{ summary: '4 keys · loop' }} />],
          ].map(([label, control]) => (
            <div key={label as string} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 66, flexShrink: 0, color: tk.text.secondary }}>{label}</span>
              {control}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Errors · callouts">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 460 }}>
          <Callout title="Shader didn't compile" details={"ERROR: 0:93: 'circ_3_dist' : undeclared identifier\nERROR: 0:93: '' : compilation terminated"}
            actions={<Button size="sm">Show in code</Button>}>
            Circle SDF uses a variable that doesn't exist. The preview is showing the last version that worked.
          </Callout>
          <Callout tone="warning" title="2 connections removed" onDismiss={() => {}}>Group output changed to vec3, so the float wires into it no longer fit.</Callout>
          <Callout tone="info" title="Recording in real time">The file downloads when you stop.</Callout>
          <Callout tone="success" title="Saved to Graphs" />
        </div>
      </Section>

      <Section title="Menu · modal · toasts">
        <div style={row}>
          <Button onClick={e => setMenu({ x: e.clientX, y: e.clientY })}>Open menu</Button>
          <Button onClick={() => setModal(true)}>Open modal</Button>
          <Button onClick={() => toast.error("Couldn't import “glow.json”", { message: "It isn't a Shader Studio graph file.", details: 'SyntaxError: Unexpected token < in JSON at position 0', action: { label: 'Choose another file', onClick: () => {} } })}>Error toast</Button>
          <Button onClick={() => toast.success('Exported shader-graph.json')}>Success toast</Button>
        </div>
      </Section>

      {menu && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
          { label: 'Edit keyframes…', icon: 'kf', hint: 'dbl-click', onSelect: () => {} },
          { label: 'Bypass keyframes', icon: 'bypass', onSelect: () => {} },
          'separator',
          { label: 'Remove keyframes', icon: 'trash', danger: true, onSelect: () => {} },
        ]} />
      )}
      {modal && (
        <Modal title="Record" subtitle="Export the preview as video or a still" icon="camera" iconColor={tk.status.danger}
          onClose={() => setModal(false)}
          footer={<><Button icon="camera">Snapshot PNG</Button><span style={{ flex: 1 }} /><Button variant="ghost" onClick={() => setModal(false)}>Cancel</Button><Button variant="primary">Start recording</Button></>}>
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Callout title="Recording failed" details="NotSupportedError: MediaRecorder: no supported video format found on this platform."
              actions={<Button size="sm" variant="primary">Try again</Button>}>
              This browser can't encode video at 4×. Try 1× or 2×.
            </Callout>
            <Segmented ariaLabel="Resolution" fill value="1" onChange={() => {}}
              options={[{ value: '1', label: '1×', sub: 'native' }, { value: '2', label: '2×', sub: '2K / 4K' }, { value: '4', label: '4×', sub: 'ultra' }]} />
          </div>
        </Modal>
      )}
    </div>
  );
}
