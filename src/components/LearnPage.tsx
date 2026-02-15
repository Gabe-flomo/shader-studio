import React, { useRef, useState, useCallback } from 'react';
import { useNodeGraphStore } from '../store/useNodeGraphStore';

interface LearnPageProps {
  onNavigateToStudio: () => void;
}

// ─── Theme ───────────────────────────────────────────────────────────────────
const T = {
  bg:        '#11111b',
  surface:   '#181825',
  surface2:  '#1e1e2e',
  border:    '#313244',
  border2:   '#45475a',
  text:      '#bac2de',
  textBold:  '#cdd6f4',
  dim:       '#585b70',
  dim2:      '#45475a',
  blue:      '#89b4fa',
  green:     '#a6e3a1',
  red:       '#f38ba8',
  yellow:    '#f9e2af',
  mauve:     '#cba6f7',
  peach:     '#fab387',
} as const;

// ─── Shared style helpers ────────────────────────────────────────────────────
const S = {
  page: {
    display: 'flex',
    width: '100%',
    height: '100%',
    background: T.bg,
    overflow: 'hidden',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  } as React.CSSProperties,

  sidebar: {
    width: '196px',
    flexShrink: 0,
    background: T.surface,
    borderRight: `1px solid ${T.border}`,
    padding: '16px 0',
    overflowY: 'auto' as const,
    height: '100%',
  } as React.CSSProperties,

  content: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '32px 52px',
    maxWidth: '900px',
  } as React.CSSProperties,

  sectionTitle: {
    fontSize: '19px',
    fontWeight: 700,
    color: T.textBold,
    marginBottom: '4px',
    marginTop: '52px',
    letterSpacing: '-0.01em',
  } as React.CSSProperties,

  divider: {
    height: '1px',
    background: T.border,
    marginBottom: '24px',
    marginTop: '8px',
  } as React.CSSProperties,

  subTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: T.blue,
    marginBottom: '8px',
    marginTop: '28px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
  } as React.CSSProperties,

  p: {
    fontSize: '13px',
    color: T.text,
    lineHeight: 1.75,
    marginBottom: '10px',
  } as React.CSSProperties,

  ul: { paddingLeft: '20px', marginBottom: '10px' } as React.CSSProperties,
  li: { fontSize: '13px', color: T.text, lineHeight: 1.7, marginBottom: '3px' } as React.CSSProperties,

  code: {
    display: 'block' as const,
    background: T.surface2,
    border: `1px solid ${T.border}`,
    borderRadius: '6px',
    padding: '12px 16px',
    fontFamily: 'monospace',
    fontSize: '12px',
    color: T.green,
    marginBottom: '14px',
    whiteSpace: 'pre' as const,
    overflowX: 'auto' as const,
    lineHeight: 1.6,
  } as React.CSSProperties,

  codeWrapper: {
    position: 'relative' as const,
    marginBottom: '14px',
  } as React.CSSProperties,

  copyBtn: {
    position: 'absolute' as const,
    top: '6px',
    right: '8px',
    background: 'rgba(49,50,68,0.85)',
    border: `1px solid ${T.border2}`,
    borderRadius: '4px',
    color: T.dim,
    fontSize: '10px',
    padding: '2px 8px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    letterSpacing: '0.03em',
    lineHeight: 1.6,
    transition: 'color 0.15s, border-color 0.15s',
  } as React.CSSProperties,

  inlineCode: {
    fontFamily: 'monospace',
    fontSize: '12px',
    color: T.green,
    background: T.surface2,
    borderRadius: '3px',
    padding: '1px 5px',
  } as React.CSSProperties,

  tip: {
    background: T.surface2,
    borderLeft: `3px solid ${T.blue}`,
    borderRadius: '0 6px 6px 0',
    padding: '10px 14px',
    marginBottom: '14px',
    fontSize: '12px',
    color: T.text,
    lineHeight: 1.6,
  } as React.CSSProperties,

  warn: {
    background: T.surface2,
    borderLeft: `3px solid ${T.yellow}`,
    borderRadius: '0 6px 6px 0',
    padding: '10px 14px',
    marginBottom: '14px',
    fontSize: '12px',
    color: T.text,
    lineHeight: 1.6,
  } as React.CSSProperties,

  tryBtn: {
    background: T.surface,
    border: `1px solid ${T.border2}`,
    color: T.green,
    borderRadius: '6px',
    padding: '6px 16px',
    fontSize: '11px',
    cursor: 'pointer',
    letterSpacing: '0.03em',
    marginTop: '12px',
    marginBottom: '6px',
    display: 'inline-flex' as const,
    alignItems: 'center' as const,
    gap: '6px',
    fontFamily: 'system-ui, sans-serif',
  } as React.CSSProperties,

  tocSection: {
    display: 'block' as const,
    padding: '8px 16px 3px',
    fontSize: '10px',
    color: T.dim2,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    fontWeight: 600,
  } as React.CSSProperties,

  tocItem: {
    display: 'block' as const,
    padding: '4px 16px',
    fontSize: '11px',
    cursor: 'pointer',
    color: T.dim,
    borderLeft: '2px solid transparent',
    textDecoration: 'none',
    background: 'none',
    border: 'none',
    width: '100%',
    textAlign: 'left' as const,
    letterSpacing: '0.02em',
    lineHeight: 1.6,
  } as React.CSSProperties,
};

// ─── Micro components ─────────────────────────────────────────────────────────

function C({ children }: { children: React.ReactNode }) {
  return <code style={S.inlineCode}>{children}</code>;
}

function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(children).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [children]);
  return (
    <div style={S.codeWrapper}>
      <pre style={{ ...S.code, marginBottom: 0 }}>{children}</pre>
      <button
        style={{
          ...S.copyBtn,
          color: copied ? T.green : T.dim,
          borderColor: copied ? T.green : T.border2,
        }}
        onClick={handleCopy}
        title="Copy code"
      >
        {copied ? '✓ copied' : 'copy'}
      </button>
    </div>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return <div style={S.tip}>💡 {children}</div>;
}

function Warn({ children }: { children: React.ReactNode }) {
  return <div style={S.warn}>⚠ {children}</div>;
}

function TryIt({ exampleKey, label, onTry }: { exampleKey: string; label: string; onTry: (k: string) => void }) {
  return (
    <button
      style={S.tryBtn}
      onClick={() => onTry(exampleKey)}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = T.border; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = T.surface; }}
    >
      ▶ Open in Studio: {label}
    </button>
  );
}

function TocLink({ label, targetRef }: { label: string; targetRef: React.RefObject<HTMLElement | null> }) {
  return (
    <button
      style={S.tocItem}
      onClick={() => targetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.color = T.textBold;
        (e.currentTarget as HTMLButtonElement).style.borderLeftColor = T.dim;
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.color = T.dim;
        (e.currentTarget as HTMLButtonElement).style.borderLeftColor = 'transparent';
      }}
    >
      {label}
    </button>
  );
}

// ─── Node Graph Diagram ───────────────────────────────────────────────────────
// Renders a left-to-right visual diagram of a node pipeline

type DiagramNode = {
  label: string;
  type?: 'source' | 'transform' | 'effect' | 'color' | 'output';
  outputs?: string[];
  inputs?: string[];
};

type DiagramArrow = {
  from: number; // node index
  to: number;
  label?: string;
};

interface NodeDiagramProps {
  nodes: DiagramNode[];
  arrows?: DiagramArrow[];
  caption?: string;
}

function typeColor(type: DiagramNode['type']): string {
  switch (type) {
    case 'source':    return T.green;
    case 'transform': return T.blue;
    case 'effect':    return T.mauve;
    case 'color':     return T.peach;
    case 'output':    return T.red;
    default:          return T.border2;
  }
}

function NodeDiagram({ nodes, arrows, caption }: NodeDiagramProps) {
  // Simple horizontal layout — each node is a box, connected by arrows
  return (
    <div style={{ marginBottom: '16px', marginTop: '8px' }}>
      <div
        style={{
          background: T.surface2,
          border: `1px solid ${T.border}`,
          borderRadius: '8px',
          padding: '16px 20px',
          overflowX: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'nowrap', minWidth: 'max-content' }}>
          {nodes.map((node, i) => {
            const color = typeColor(node.type);
            const isLast = i === nodes.length - 1;
            // Check if this node has an explicit arrow to next, or auto-chain
            const hasArrow = !isLast;
            const arrow = arrows?.find(a => a.from === i);

            return (
              <React.Fragment key={i}>
                {/* Node box */}
                <div
                  style={{
                    background: T.surface,
                    border: `1px solid ${color}44`,
                    borderTop: `2px solid ${color}`,
                    borderRadius: '6px',
                    padding: '8px 12px',
                    minWidth: '90px',
                    flexShrink: 0,
                  }}
                >
                  <div style={{ fontSize: '11px', fontWeight: 600, color: color, marginBottom: node.inputs || node.outputs ? '6px' : '0', fontFamily: 'monospace' }}>
                    {node.label}
                  </div>
                  {node.inputs && node.inputs.length > 0 && (
                    <div style={{ marginBottom: '4px' }}>
                      {node.inputs.map((inp, j) => (
                        <div key={j} style={{ fontSize: '10px', color: T.dim, lineHeight: 1.4 }}>
                          <span style={{ color: T.dim2 }}>↳ </span>{inp}
                        </div>
                      ))}
                    </div>
                  )}
                  {node.outputs && node.outputs.length > 0 && (
                    <div>
                      {node.outputs.map((out, j) => (
                        <div key={j} style={{ fontSize: '10px', color: T.dim, lineHeight: 1.4 }}>
                          <span style={{ color: color + '99' }}>◆ </span>{out}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Arrow between nodes */}
                {hasArrow && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, color: T.dim2 }}>
                    <div style={{ fontSize: '10px', color: T.dim2, marginBottom: '2px', whiteSpace: 'nowrap' }}>
                      {arrow?.label ?? ''}
                    </div>
                    <div style={{ fontSize: '16px', lineHeight: 1 }}>→</div>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
      {caption && (
        <div style={{ fontSize: '11px', color: T.dim, marginTop: '5px', paddingLeft: '4px', fontStyle: 'italic' }}>
          {caption}
        </div>
      )}
    </div>
  );
}

// ─── Step-by-step builder diagram ────────────────────────────────────────────
// Shows how a graph builds up step by step with +1 node each step

interface BuildStep {
  title: string;
  description: React.ReactNode;
  nodes: DiagramNode[];
}

function StepBuilder({ steps }: { steps: BuildStep[] }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      {steps.map((step, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            gap: '16px',
            marginBottom: '12px',
            alignItems: 'flex-start',
          }}
        >
          {/* Step number */}
          <div
            style={{
              width: '22px',
              height: '22px',
              borderRadius: '50%',
              background: T.blue + '33',
              border: `1px solid ${T.blue}66`,
              color: T.blue,
              fontSize: '11px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              marginTop: '2px',
            }}
          >
            {i + 1}
          </div>

          {/* Content */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: T.textBold, marginBottom: '4px' }}>
              {step.title}
            </div>
            <div style={{ fontSize: '12px', color: T.text, lineHeight: 1.6, marginBottom: '6px' }}>
              {step.description}
            </div>
            <NodeDiagram nodes={step.nodes} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Type badge ───────────────────────────────────────────────────────────────
function TypeBadge({ type, label }: { type: string; label?: string }) {
  const color = type === 'float' ? T.yellow : type === 'vec2' ? T.blue : type === 'vec3' ? T.peach : T.green;
  return (
    <span style={{
      fontFamily: 'monospace',
      fontSize: '11px',
      color,
      background: color + '22',
      border: `1px solid ${color}44`,
      borderRadius: '4px',
      padding: '1px 6px',
      marginRight: '3px',
    }}>
      {label ?? type}
    </span>
  );
}

// ─── Data flow table ──────────────────────────────────────────────────────────
function DataTable({ rows }: { rows: [string, string, string][] }) {
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: '14px', fontSize: '12px' }}>
      <thead>
        <tr>
          {['Type', 'Means', 'Example'].map(h => (
            <th key={h} style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(([type, means, ex], i) => (
          <tr key={i} style={{ borderBottom: `1px solid ${T.border}22` }}>
            <td style={{ padding: '6px 10px' }}><TypeBadge type={type} /></td>
            <td style={{ padding: '6px 10px', color: T.text }}>{means}</td>
            <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: T.green, fontSize: '11px' }}>{ex}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
export function LearnPage({ onNavigateToStudio }: LearnPageProps) {
  const { loadExampleGraph } = useNodeGraphStore();

  const sec1Ref = useRef<HTMLDivElement>(null);
  const sec2Ref = useRef<HTMLDivElement>(null);
  const sec3Ref = useRef<HTMLDivElement>(null);
  const sec4Ref = useRef<HTMLDivElement>(null);
  const sec5Ref = useRef<HTMLDivElement>(null);
  const sec6Ref = useRef<HTMLDivElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  function tryExample(key: string) {
    loadExampleGraph(key);
    onNavigateToStudio();
  }

  return (
    <div style={S.page}>
      {/* ── Sidebar TOC ── */}
      <nav style={{
        ...S.sidebar,
        width: sidebarOpen ? '196px' : '32px',
        transition: 'width 0.2s ease',
        overflow: 'hidden',
        position: 'relative',
      }}>
        {/* Toggle button — always visible */}
        <button
          onClick={() => setSidebarOpen(v => !v)}
          title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          style={{
            position: sidebarOpen ? 'absolute' : 'static',
            top: sidebarOpen ? '12px' : undefined,
            right: sidebarOpen ? '8px' : undefined,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '20px',
            height: '20px',
            background: 'none',
            border: 'none',
            color: '#585b70',
            cursor: 'pointer',
            fontSize: '12px',
            borderRadius: '3px',
            flexShrink: 0,
            margin: sidebarOpen ? undefined : '8px auto',
            padding: 0,
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#cdd6f4')}
          onMouseLeave={e => (e.currentTarget.style.color = '#585b70')}
        >
          {sidebarOpen ? '◀' : '▶'}
        </button>

        {/* TOC content — hidden when collapsed */}
        {sidebarOpen && <>
        <span style={{ ...S.tocSection, paddingTop: '2px' }}>Shader Studio</span>
        <span style={{ ...S.tocSection }}>1. Node Basics</span>
        <TocLink label="How Nodes Work" targetRef={sec1Ref} />
        <TocLink label="Data Types" targetRef={sec1Ref} />
        <TocLink label="UV Coordinates" targetRef={sec1Ref} />

        <span style={S.tocSection}>2. Color & Math</span>
        <TocLink label="Colors are vec3" targetRef={sec2Ref} />
        <TocLink label="Math Nodes" targetRef={sec2Ref} />
        <TocLink label="Animation with Time" targetRef={sec2Ref} />

        <span style={S.tocSection}>3. Effects</span>
        <TocLink label="SDF Shapes" targetRef={sec3Ref} />
        <TocLink label="Glow & Light" targetRef={sec3Ref} />
        <TocLink label="Chromatic Aberration" targetRef={sec3Ref} />
        <TocLink label="Gravity Lens" targetRef={sec3Ref} />

        <span style={S.tocSection}>4. Noise & Fractals</span>
        <TocLink label="FBM Noise" targetRef={sec4Ref} />
        <TocLink label="Domain Warping" targetRef={sec4Ref} />
        <TocLink label="Flow Fields" targetRef={sec4Ref} />
        <TocLink label="Mandelbrot / Julia" targetRef={sec4Ref} />
        <TocLink label="IFS Fractals" targetRef={sec4Ref} />

        <span style={S.tocSection}>5. Physics Sims</span>
        <TocLink label="Chladni Plates" targetRef={sec5Ref} />
        <TocLink label="Electron Orbitals 2D" targetRef={sec5Ref} />
        <TocLink label="Orbital 3D Volume" targetRef={sec5Ref} />
        <TocLink label="Combining Both" targetRef={sec5Ref} />

        <span style={S.tocSection}>6. Generative Systems</span>
        <TocLink label="Flow Fields (Hobbs)" targetRef={sec6Ref} />
        <TocLink label="Field Modes" targetRef={sec6Ref} />
        <TocLink label="Circle Packing" targetRef={sec6Ref} />
        <TocLink label="Combining Both" targetRef={sec6Ref} />
        </>}
      </nav>

      {/* ── Scrollable content ── */}
      <main style={S.content}>
        {/* Header */}
        <div style={{ marginBottom: '8px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: 700, color: T.textBold, marginBottom: '6px', letterSpacing: '-0.02em' }}>
            Shader Studio Guide
          </h1>
          <p style={{ ...S.p, color: T.dim, marginBottom: 0 }}>
            A hands-on guide to building GLSL shaders with the node graph — from first UV to animated fractals.
            Each section builds on the previous one.
          </p>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 1 — NODE GRAPH BASICS & UV
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec1Ref as React.RefObject<HTMLDivElement>}>
          <h2 style={S.sectionTitle}>1 · Node Graph Basics & UV</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>How the Node Graph Works</h3>
          <p style={S.p}>
            The node graph is a visual programming environment. Each <strong style={{ color: T.textBold }}>node</strong> does one
            thing — compute a distance, generate a color, distort a position — and <strong style={{ color: T.textBold }}>wires</strong> carry
            data between them. When you press play, the entire graph is compiled into a single GLSL fragment shader
            that runs on the GPU — one parallel execution per pixel.
          </p>

          <NodeDiagram
            nodes={[
              { label: 'UV', type: 'source', outputs: ['uv: vec2'] },
              { label: 'Some Node', type: 'transform', inputs: ['uv: vec2'], outputs: ['value: float'] },
              { label: 'Palette', type: 'color', inputs: ['t: float'], outputs: ['color: vec3'] },
              { label: 'Output', type: 'output', inputs: ['color: vec3'] },
            ]}
            caption="A basic pipeline — data flows left to right through connected nodes."
          />

          <p style={S.p}><strong style={{ color: T.textBold }}>Controls:</strong></p>
          <ul style={S.ul}>
            <li style={S.li}><strong style={{ color: T.textBold }}>Add a node:</strong> click any item in the left palette panel</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Move:</strong> drag the node's title bar</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Connect:</strong> drag from an output socket (right side) to an input socket (left side)</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Disconnect:</strong> click a connection line</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Auto Layout:</strong> click ⊞ in the toolbar to automatically arrange nodes left-to-right</li>
          </ul>

          <Tip>
            Every graph needs exactly one <strong>Output</strong> node. It accepts a <C>vec3</C> color and writes
            it to the canvas. If you see a black screen, check that your Output node is connected.
          </Tip>

          <h3 style={S.subTitle}>Data Types</h3>
          <p style={S.p}>
            Sockets are typed — you can only connect matching types. There are three types you'll use constantly:
          </p>

          <DataTable rows={[
            ['float', 'A single decimal number — brightness, time, distance, angle', '0.75, -1.0, 3.14'],
            ['vec2',  '2D coordinate — UV position, mouse position, direction', 'vec2(0.3, -0.5)'],
            ['vec3',  '3D value — always a color (R, G, B), each 0.0–1.0', 'vec3(1.0, 0.5, 0.0)'],
          ]} />

          <Tip>
            A <TypeBadge type="float" /> can plug into a <TypeBadge type="vec3" /> input — it broadcasts to all 3
            channels, so <C>0.5</C> becomes <C>vec3(0.5, 0.5, 0.5)</C> grey.
          </Tip>

          <h3 style={S.subTitle}>UV Coordinates</h3>
          <p style={S.p}>
            UV is the 2D pixel position passed to every node. The <strong style={{ color: T.textBold }}>UV</strong> node
            outputs centered, aspect-corrected coordinates — <C>(0,0)</C> is the center, edges reach about <C>±0.5</C>.
            Every interesting shader starts here.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
            <div style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: '8px', padding: '14px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: T.blue, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>UV Space</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '1fr 1fr 1fr', width: '150px', height: '100px', fontFamily: 'monospace', fontSize: '9px', color: T.green }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start' }}>(-0.5, 0.5)</div>
                <div />
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' }}>(0.5, 0.5)</div>
                <div />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.blue, fontWeight: 700, fontSize: '10px' }}>(0, 0)</div>
                <div />
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-start' }}>(-0.5,-0.5)</div>
                <div />
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end' }}>(0.5,-0.5)</div>
              </div>
            </div>
            <div style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: '8px', padding: '14px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: T.blue, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Common UV Ops</div>
              {[
                ['length(uv)', 'Radial distance — 0 at center'],
                ['abs(uv)', 'Fold — 4-fold symmetry'],
                ['fract(uv*4)', 'Tile — repeat 4× across screen'],
                ['uv.x, uv.y', 'Horizontal / vertical gradient'],
              ].map(([op, desc]) => (
                <div key={op} style={{ marginBottom: '4px' }}>
                  <code style={{ fontSize: '10px', color: T.green, fontFamily: 'monospace' }}>{op}</code>
                  <span style={{ fontSize: '10px', color: T.dim, marginLeft: '6px' }}>{desc}</span>
                </div>
              ))}
            </div>
          </div>

          <h3 style={S.subTitle}>Build it step by step — UV to tiled colors</h3>
          <StepBuilder steps={[
            {
              title: 'Start with UV',
              description: 'The UV node is where every shader begins. Add it from the Sources section.',
              nodes: [{ label: 'UV', type: 'source', outputs: ['uv: vec2'] }],
            },
            {
              title: 'Add an Output node',
              description: <>Connect the UV to an Output node. UV is <TypeBadge type="vec2" /> but Output needs <TypeBadge type="vec3" /> — use a <strong style={{ color: T.textBold }}>Vec2ToVec3</strong> in between, or just observe the type error.</>,
              nodes: [
                { label: 'UV', type: 'source', outputs: ['uv: vec2'] },
                { label: 'Output', type: 'output', inputs: ['color: vec3'] },
              ],
            },
            {
              title: 'Tile with FractRaw',
              description: <>Add a <strong style={{ color: T.textBold }}>FractRaw</strong> node (Transforms). Set scale to 4. <C>fract(uv * 4)</C> repeats the 0→1 space 4 times, creating a tiled pattern.</>,
              nodes: [
                { label: 'UV', type: 'source', outputs: ['uv: vec2'] },
                { label: 'FractRaw', type: 'transform', inputs: ['uv: vec2'], outputs: ['uv: vec2'] },
                { label: 'Output', type: 'output', inputs: ['color: vec3'] },
              ],
            },
            {
              title: 'Color with Palette',
              description: <>Insert a <strong style={{ color: T.textBold }}>Palette Preset</strong> node. Wire the FractRaw UV to its <C>t</C> input (vec2 → float broadcasts the x channel). Try different preset numbers 1–8.</>,
              nodes: [
                { label: 'UV', type: 'source', outputs: ['uv: vec2'] },
                { label: 'FractRaw', type: 'transform', inputs: ['uv: vec2'], outputs: ['uv: vec2'] },
                { label: 'Palette Preset', type: 'color', inputs: ['t: float'], outputs: ['color: vec3'] },
                { label: 'Output', type: 'output', inputs: ['color: vec3'] },
              ],
            },
          ]} />

          <TryIt exampleKey="fractalRings" label="Fractal Rings" onTry={tryExample} />
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 2 — COLORS, MATH & ANIMATION
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec2Ref as React.RefObject<HTMLDivElement>}>
          <h2 style={S.sectionTitle}>2 · Colors, Math & Animation</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>Colors are vec3</h3>
          <p style={S.p}>
            A color in GLSL is just three floats — R, G, B — each clamped to <C>0.0–1.0</C>.
            Values outside this range won't display correctly unless you use a tone map node.
          </p>
          <DataTable rows={[
            ['vec3', 'vec3(1, 0, 0)', 'Pure red'],
            ['vec3', 'vec3(0, 1, 0)', 'Pure green'],
            ['vec3', 'vec3(0, 0, 1)', 'Pure blue'],
            ['vec3', 'vec3(1, 1, 1)', 'White'],
            ['vec3', 'vec3(0, 0, 0)', 'Black (default background)'],
            ['vec3', 'vec3(0.5)', 'Mid grey (broadcasts from float)'],
          ]} />

          <p style={S.p}>
            The <strong style={{ color: T.textBold }}>Constant</strong> node sets a fixed color or value.
            The <strong style={{ color: T.textBold }}>Palette Preset</strong> node maps a float 0→1 to a smooth gradient
            using 8 built-in presets. For full control, use the <strong style={{ color: T.textBold }}>Palette</strong> node
            with the IQ cosine formula parameters.
          </p>

          <h3 style={S.subTitle}>Math Nodes</h3>
          <p style={S.p}>
            Math nodes mirror GLSL built-ins and work componentwise on any type — <TypeBadge type="float" />,
            <TypeBadge type="vec2" />, or <TypeBadge type="vec3" />.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
            {([
              ['Mix', 'mix(a, b, t)', 'Blend: t=0→a, t=1→b. Great for crossfades and lerping colors.'],
              ['Smoothstep', 'smoothstep(e0, e1, x)', 'Smooth 0→1 ramp. Better than step for anti-aliased edges.'],
              ['Clamp', 'clamp(x, 0, 1)', 'Clamp to valid range. Essential to keep colors from going HDR.'],
              ['Sin / Cos', 'sin(x) / cos(x)', 'Oscillates −1 to 1. Excellent for continuous animation.'],
              ['Multiply', 'a * b', 'Scale values. Use to dim/brighten colors or stretch UV.'],
              ['Add', 'a + b', 'Offset values. Shift UV to translate shapes; tint colors.'],
              ['Abs', 'abs(x)', 'Absolute value. Folds negative values up, creates symmetry.'],
              ['Mod', 'mod(x, n)', 'Modulo. Repeat a pattern every n units.'],
            ] as [string, string, string][]).map(([name, sig, desc]) => (
              <div key={name} style={{ background: T.surface2, borderRadius: '6px', padding: '10px 12px', border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: T.blue, marginBottom: '3px' }}>{name}</div>
                <code style={{ fontSize: '11px', color: T.green, fontFamily: 'monospace', display: 'block', marginBottom: '4px' }}>{sig}</code>
                <div style={{ fontSize: '11px', color: T.dim, lineHeight: 1.5 }}>{desc}</div>
              </div>
            ))}
          </div>

          <h3 style={S.subTitle}>Animation with Time</h3>
          <p style={S.p}>
            The <strong style={{ color: T.textBold }}>Time</strong> node outputs the current elapsed time in seconds,
            incrementing every frame. Feed it into <C>sin()</C> or <C>cos()</C> to get smooth oscillation between
            −1 and 1.
          </p>

          <CodeBlock>{`sin(time)              // −1 to 1, period ~6.28s
sin(time * 2.0)        // twice as fast
sin(time) * 0.5 + 0.5  // remap to 0→1 (always positive)
time * 0.3             // slowly increasing ramp
mod(time, 3.0)         // sawtooth: 0→3 repeating`}</CodeBlock>

          <h3 style={S.subTitle}>Build it step by step — animated wavy colors</h3>
          <p style={S.p}>
            This builds a pulsing color wave: radial distance from center + animated sin wave → colored palette → brightness pulse.
          </p>
          <StepBuilder steps={[
            {
              title: 'Radial distance from center',
              description: <>Wire <strong>UV → Length</strong>. The <C>length(uv)</C> node returns a float — 0 at the center, growing outward. This creates a radial gradient.</>,
              nodes: [
                { label: 'UV', type: 'source', outputs: ['uv: vec2'] },
                { label: 'Length', type: 'transform', inputs: ['v: vec2'], outputs: ['result: float'] },
              ],
            },
            {
              title: 'Animated oscillation',
              description: <>Add <strong>Time → Sin</strong>. Set scale to 1.5 on the Sin node. This creates a smooth oscillation we'll combine with the distance.</>,
              nodes: [
                { label: 'Time', type: 'source', outputs: ['time: float'] },
                { label: 'Sin', type: 'transform', inputs: ['x: float'], outputs: ['result: float'] },
              ],
            },
            {
              title: 'Combine distance + sin wave',
              description: <>Add an <strong>Add</strong> node. Connect Length → A and Sin → B. This offsets the radial gradient by the oscillating wave, creating a wave that expands and contracts.</>,
              nodes: [
                { label: 'Length', type: 'transform', outputs: ['result: float'] },
                { label: 'Sin', type: 'transform', outputs: ['result: float'] },
                { label: 'Add', type: 'transform', inputs: ['a: float', 'b: float'], outputs: ['result: float'] },
              ],
            },
            {
              title: 'Color with Palette',
              description: <>Connect Add → Palette Preset <C>t</C> input. The palette maps 0→1 float to a gradient color. The result animates as the sin wave shifts the input value.</>,
              nodes: [
                { label: 'Add', type: 'transform', outputs: ['result: float'] },
                { label: 'Palette Preset', type: 'color', inputs: ['t: float'], outputs: ['color: vec3'] },
                { label: 'Output', type: 'output', inputs: ['color: vec3'] },
              ],
            },
            {
              title: 'Brightness pulse (optional)',
              description: <>Multiply the Sin output by 0.4, then Add 0.6 to keep it positive (0.2→1.0 range). Use <strong>MultiplyVec3</strong> to scale the palette color by this value — the whole image pulses in brightness.</>,
              nodes: [
                { label: 'Sin', type: 'source', outputs: ['result: float'] },
                { label: 'Multiply\n×0.4', type: 'transform', outputs: ['result: float'] },
                { label: 'Add\n+0.6', type: 'transform', outputs: ['result: float'] },
                { label: 'MultiplyVec3', type: 'color', inputs: ['color: vec3', 'scale: float'], outputs: ['result: vec3'] },
                { label: 'Output', type: 'output', inputs: ['color: vec3'] },
              ],
            },
          ]} />

          <TryIt exampleKey="wavyColors" label="Wavy Colors" onTry={tryExample} />
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 3 — EFFECTS
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec3Ref as React.RefObject<HTMLDivElement>}>
          <h2 style={S.sectionTitle}>3 · Effects: SDF Shapes, Glow & Lensing</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>Signed Distance Fields (SDF)</h3>
          <p style={S.p}>
            A Signed Distance Field function returns the <strong style={{ color: T.textBold }}>signed distance</strong> from
            any pixel to a shape's edge:
          </p>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
            {[
              { label: 'Inside', color: T.red,   desc: 'dist < 0' },
              { label: 'On edge', color: T.yellow, desc: 'dist = 0' },
              { label: 'Outside', color: T.blue,   desc: 'dist > 0' },
            ].map(({ label, color, desc }) => (
              <div key={label} style={{ background: color + '22', border: `1px solid ${color}44`, borderRadius: '6px', padding: '8px 14px', fontSize: '12px' }}>
                <div style={{ color, fontWeight: 600, marginBottom: '2px' }}>{label}</div>
                <code style={{ fontSize: '11px', fontFamily: 'monospace', color: T.text }}>{desc}</code>
              </div>
            ))}
          </div>

          <CodeBlock>{`// Circle SDF: distance to ring of given radius
float dist = length(uv) - radius;    // negative inside, positive outside

// Ring SDF: hollow circle
float dist = abs(length(uv) - r) - thickness;

// Box SDF (IQ's formula):
vec2 d = abs(uv) - vec2(w, h);
float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);`}</CodeBlock>

          <h3 style={S.subTitle}>Build it step by step — pulsing glowing circle</h3>
          <StepBuilder steps={[
            {
              title: 'Place a Circle SDF',
              description: <>Add <strong>UV → CircleSDF</strong>. Set radius to 0.25. The output is a <TypeBadge type="float" /> distance — negative inside the circle, positive outside.</>,
              nodes: [
                { label: 'UV', type: 'source', outputs: ['uv: vec2'] },
                { label: 'Circle SDF', type: 'effect', inputs: ['uv: vec2', 'radius: float'], outputs: ['dist: float'] },
              ],
            },
            {
              title: 'Animate the radius',
              description: <>Add <strong>Time → Sin → Multiply (×0.08)</strong>. Connect the multiply output to CircleSDF's <C>radius</C> input. The circle now pulses in and out over time.</>,
              nodes: [
                { label: 'Time', type: 'source', outputs: ['time: float'] },
                { label: 'Sin\n×0.8', type: 'transform', outputs: ['result: float'] },
                { label: 'Multiply\n×0.08', type: 'transform', outputs: ['result: float'] },
                { label: 'Circle SDF', type: 'effect', inputs: ['radius: float'], outputs: ['dist: float'] },
              ],
            },
            {
              title: 'Convert distance to glow',
              description: <>Add <strong>MakeLight</strong>. Connect CircleSDF → distance input. MakeLight computes <C>strength / max(|dist|, ε)</C> — bright at the edge, falling off quickly on both sides.</>,
              nodes: [
                { label: 'Circle SDF', type: 'effect', outputs: ['dist: float'] },
                { label: 'MakeLight', type: 'effect', inputs: ['distance: float'], outputs: ['glow: float'] },
              ],
            },
            {
              title: 'Add color',
              description: <>Add a <strong>Palette Preset</strong> node. Wire <strong>Time</strong> → palette <C>t</C> so the color slowly cycles. The palette outputs a <TypeBadge type="vec3" /> color that shifts over time.</>,
              nodes: [
                { label: 'Time', type: 'source', outputs: ['time: float'] },
                { label: 'Palette Preset', type: 'color', inputs: ['t: float'], outputs: ['color: vec3'] },
              ],
            },
            {
              title: 'Multiply color by glow intensity',
              description: <>Add <strong>MultiplyVec3</strong>. Connect Palette → color and MakeLight → scale. The glow intensity modulates the color — fully dark where there's no glow, bright at the ring edge.</>,
              nodes: [
                { label: 'Palette Preset', type: 'color', outputs: ['color: vec3'] },
                { label: 'MakeLight', type: 'effect', outputs: ['glow: float'] },
                { label: 'MultiplyVec3', type: 'color', inputs: ['color: vec3', 'scale: float'], outputs: ['result: vec3'] },
                { label: 'Output', type: 'output', inputs: ['color: vec3'] },
              ],
            },
          ]} />

          <TryIt exampleKey="glowShape" label="Glow Shape" onTry={tryExample} />

          {/* Chromatic Aberration */}
          <h3 style={S.subTitle}>Chromatic Aberration</h3>
          <p style={S.p}>
            Chromatic aberration splits UV into three slightly offset copies — one for each color channel.
            When you feed each offset UV into the same shape shader and recombine, the edges "fringe"
            with rainbow color like light through a cheap glass lens.
          </p>

          <NodeDiagram
            nodes={[
              { label: 'UV', type: 'source', outputs: ['uv: vec2'] },
              { label: 'Chromatic\nAberration', type: 'effect', inputs: ['uv: vec2'], outputs: ['uv_r: vec2', 'uv_g: vec2', 'uv_b: vec2'] },
              { label: 'Ring SDF\n(×3)', type: 'effect', inputs: ['uv per channel'] },
              { label: 'MakeLight\n(×3)', type: 'effect', outputs: ['glow R/G/B'] },
              { label: 'CombineRGB', type: 'color', inputs: ['r/g/b: float'], outputs: ['color: vec3'] },
              { label: 'Output', type: 'output', inputs: ['color: vec3'] },
            ]}
            caption="Each UV offset feeds its own SDF+glow chain. CombineRGB merges the three channel results."
          />

          <Tip>
            The key insight: you run the <em>same shape</em> three times, each on a slightly different UV.
            The red channel samples from a slightly shifted position — that's what creates the color split.
          </Tip>

          <TryIt exampleKey="chromaticRings" label="Chromatic Rings" onTry={tryExample} />

          {/* Gravity Lens */}
          <h3 style={S.subTitle}>Gravity Lens</h3>
          <p style={S.p}>
            The <strong style={{ color: T.textBold }}>Gravitational Lens</strong> node warps UV space using an
            inverse-square-law displacement — pixels are bent toward the lens center, just like light curving around
            a massive object.
          </p>
          <p style={S.p}>
            It outputs a <strong style={{ color: T.textBold }}>distorted UV</strong> (<C>uv_lensed</C>) — wire this
            into any shader's UV input to bend its output through the lens:
          </p>

          <NodeDiagram
            nodes={[
              { label: 'UV', type: 'source', outputs: ['uv: vec2'] },
              { label: 'Mouse', type: 'source', outputs: ['uv: vec2'] },
              { label: 'Gravity\nLens', type: 'effect', inputs: ['uv', 'lens_center'], outputs: ['uv_lensed: vec2', 'horizon_mask: float'] },
              { label: 'Mandelbrot', type: 'effect', inputs: ['uv: vec2'], outputs: ['color: vec3'] },
              { label: 'Output', type: 'output', inputs: ['color: vec3'] },
            ]}
            caption="Mouse → lens_center makes the lens follow your cursor. Wire uv_lensed upstream into any shader."
          />

          <p style={S.p}><strong style={{ color: T.textBold }}>Three lens modes:</strong></p>
          <ul style={S.ul}>
            <li style={S.li}><C>gravity</C> — 1/r² displacement (classic black hole)</li>
            <li style={S.li}><C>fisheye</C> — smooth barrel distortion (wide-angle lens effect)</li>
            <li style={S.li}><C>ripple</C> — animated wave warp (wire Time → time input)</li>
          </ul>

          <Warn>
            <C>uv_lensed</C> is a <em>displaced UV</em>, not a color. Always wire it into another node's UV
            input rather than directly to Output.
          </Warn>

          <TryIt exampleKey="gravitationalLens" label="Gravitational Lens" onTry={tryExample} />
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 4 — NOISE, FRACTALS & ADVANCED
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec4Ref as React.RefObject<HTMLDivElement>}>
          <h2 style={S.sectionTitle}>4 · Noise, Fractals & Advanced</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>FBM Noise</h3>
          <p style={S.p}>
            FBM (Fractal Brownian Motion) stacks multiple octaves of smooth Perlin-like noise at increasing
            frequencies — each octave adds smaller-scale detail. The result is organic, cloud-like texture.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
            {[
              ['octaves', 'Number of noise layers. More = finer detail. 4–6 is typical.'],
              ['scale', 'Base zoom level. Higher = smaller features.'],
              ['lacunarity', 'Frequency multiplier per octave. 2.0 = each octave is 2× finer.'],
              ['gain', 'Amplitude falloff per octave. 0.5 = each octave is half as loud.'],
            ].map(([param, desc]) => (
              <div key={param} style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: '6px', padding: '8px 12px' }}>
                <code style={{ fontSize: '11px', color: T.mauve, fontFamily: 'monospace', display: 'block', marginBottom: '3px' }}>{param}</code>
                <div style={{ fontSize: '11px', color: T.dim, lineHeight: 1.5 }}>{desc}</div>
              </div>
            ))}
          </div>

          <h3 style={S.subTitle}>Domain Warping</h3>
          <p style={S.p}>
            Domain warping is a technique where you use the <em>output</em> of one FBM node as the UV
            <em> input</em> to another. This creates turbulent, swirling patterns that look completely different
            from plain FBM:
          </p>

          <NodeDiagram
            nodes={[
              { label: 'UV', type: 'source', outputs: ['uv: vec2'] },
              { label: 'FBM\n(pass 1)', type: 'effect', inputs: ['uv: vec2'], outputs: ['value: float', 'uv: vec2'] },
              { label: 'Domain\nWarp', type: 'effect', inputs: ['uv: vec2', 'warp_uv: vec2'], outputs: ['warped_uv: vec2'] },
              { label: 'FBM\n(pass 2)', type: 'effect', inputs: ['uv: vec2'], outputs: ['value: float'] },
              { label: 'Palette', type: 'color', inputs: ['t: float'], outputs: ['color: vec3'] },
              { label: 'Output', type: 'output', inputs: ['color: vec3'] },
            ]}
            caption="The DomainWarp node offsets UV by a noise-derived displacement before feeding into the second FBM."
          />

          <CodeBlock>{`// What domain warp does internally:
vec2 offset = vec2(fbm(uv), fbm(uv + vec2(5.2, 1.3)));
vec2 warped_uv = uv + offset * warp_strength;
float final = fbm(warped_uv);  // much more complex patterns`}</CodeBlock>

          <TryIt exampleKey="domainWarpFractal" label="Domain Warp Fractal" onTry={tryExample} />

          {/* Flow Fields */}
          <h3 style={S.subTitle}>Flow Fields</h3>
          <p style={S.p}>
            As generative artist Tyler Hobbs describes: a flow field is a <strong style={{ color: T.textBold }}>grid of angles</strong>. Every point
            in the field stores a direction derived from noise. Curves are drawn by starting at a seed position
            and repeatedly taking small steps in the direction the field points — like a leaf floating in a river.
          </p>
          <p style={S.p}>
            The key insight is that short curves feel like <em>fur or grass</em>, while long curves feel like
            smooth, flowing <em>rivers</em>. The same field produces completely different aesthetics depending
            on how many steps you take per curve.
          </p>

          <CodeBlock>{`// Core algorithm (per curve, per step):
angle = fbmNoise(position * scale + time * speed) * 2π
position += vec2(cos(angle), sin(angle)) * step_size

// Per pixel: accumulate soft glow from ALL steps of ALL curves
dist  = length(pixel - step_position)
light = smoothstep(line_width * softness, line_width, dist)
color += curve_palette_color * light`}</CodeBlock>

          <NodeDiagram
            nodes={[
              { label: 'UV', type: 'source', outputs: ['uv: vec2'] },
              { label: 'Time', type: 'source', outputs: ['time: float'] },
              { label: 'Flow Field', type: 'effect', inputs: ['uv: vec2', 'time: float'], outputs: ['color: vec3', 'density: float'] },
              { label: 'Output', type: 'output', inputs: ['color: vec3'] },
            ]}
            caption="The Flow Field node is self-contained — curves, steps, colors all happen inside. density is a coverage mask you can use downstream."
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
            {([
              ['curves', 'Number of independent curves. More = denser. 60 is a good start.'],
              ['steps', 'Steps per curve. Low (6–8) = short fur-like strokes. High (40–64) = long fluid rivers.'],
              ['step_size', 'Distance each step travels. Smaller = smoother but slower.'],
              ['field_mode', 'perlin: classic smooth flow. curl: swirling loops (noise gradient rotated 90°). quantized: angular rocky forms.'],
              ['line_width', 'Stroke thickness. Try 0.003–0.015.'],
              ['noise_scale', 'Scale of the angle field. Large = big sweeping curves. Small = tight chaotic swirls.'],
            ] as [string, string][]).map(([p, d]) => (
              <div key={p} style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: '6px', padding: '8px 12px' }}>
                <code style={{ fontSize: '11px', color: T.mauve, fontFamily: 'monospace', display: 'block', marginBottom: '3px' }}>{p}</code>
                <div style={{ fontSize: '11px', color: T.dim, lineHeight: 1.5 }}>{d}</div>
              </div>
            ))}
          </div>

          <Tip>
            The <strong>density</strong> output is a 0→1 float representing how many curves passed near this pixel.
            Wire it into a <strong>Palette Preset</strong> for custom coloring, or multiply by an SDF mask to
            confine the flow to a shape.
          </Tip>

          <TryIt exampleKey="flowFieldDemo" label="Flow Field" onTry={tryExample} />

          {/* Mandelbrot / Julia */}
          <h3 style={S.subTitle}>Mandelbrot & Julia Sets</h3>
          <p style={S.p}>
            The Mandelbrot set visualizes which points in the complex plane remain bounded under repeated
            iteration of a simple formula. The <strong style={{ color: T.textBold }}>Mandelbrot</strong> node
            handles all the iteration and smooth coloring internally.
          </p>

          <CodeBlock>{`// The iteration (runs max_iter times per pixel):
z = z² + c       // Mandelbrot: c = UV position, z starts at 0
z = z² + c       // Julia:      c = fixed param, z = UV position

// Escape condition: |z| > bailout (usually 256)
// Smooth iteration count (continuous coloring):
iter_smooth = iter - log2(log2(|z|))`}</CodeBlock>

          <StepBuilder steps={[
            {
              title: 'Basic Mandelbrot',
              description: 'Add UV → Mandelbrot → Output. The node handles everything. Try adjusting zoom and offset_x/offset_y to explore the set.',
              nodes: [
                { label: 'UV', type: 'source', outputs: ['uv: vec2'] },
                { label: 'Mandelbrot', type: 'effect', inputs: ['uv: vec2'], outputs: ['color: vec3', 'iter: float'] },
                { label: 'Output', type: 'output', inputs: ['color: vec3'] },
              ],
            },
            {
              title: 'Switch to Julia mode',
              description: <>Change the mode param to <C>julia</C>. Now <C>c_pos</C> controls the shape of the entire Julia set — each value produces a completely different fractal structure.</>,
              nodes: [
                { label: 'UV', type: 'source', outputs: ['uv: vec2'] },
                { label: 'Mandelbrot\n(mode: julia)', type: 'effect', inputs: ['uv: vec2', 'c_pos: vec2'], outputs: ['color: vec3'] },
                { label: 'Output', type: 'output', inputs: ['color: vec3'] },
              ],
            },
            {
              title: 'Wire Mouse → c_pos for interactive Julia',
              description: 'Add a Mouse node and connect its uv output to the Mandelbrot c_pos input. Move your mouse over the canvas to explore different Julia shapes in real time.',
              nodes: [
                { label: 'UV', type: 'source', outputs: ['uv: vec2'] },
                { label: 'Mouse', type: 'source', outputs: ['uv: vec2'] },
                { label: 'Mandelbrot\n(julia)', type: 'effect', inputs: ['uv', 'c_pos: vec2'], outputs: ['color: vec3'] },
                { label: 'Output', type: 'output', inputs: ['color: vec3'] },
              ],
            },
            {
              title: 'Animated Julia with orbit traps',
              description: <>Use an <strong>Expr</strong> node to drive <C>c_pos</C> with time: <C>vec2(cos(t*0.3)*0.7, sin(t*0.4)*0.4)</C>. Enable orbit_trap to change coloring style.</>,
              nodes: [
                { label: 'Time', type: 'source', outputs: ['time: float'] },
                { label: 'Expr\nvec2(cos, sin)', type: 'transform', inputs: ['t: float'], outputs: ['result: vec2'] },
                { label: 'Mandelbrot\n(julia+trap)', type: 'effect', inputs: ['uv', 'c_pos'], outputs: ['color: vec3'] },
                { label: 'Output', type: 'output' },
              ],
            },
          ]} />

          <TryIt exampleKey="mandelbrotExplorer" label="Mandelbrot Explorer" onTry={tryExample} />
          <TryIt exampleKey="juliaExplorer" label="Animated Julia" onTry={tryExample} />

          {/* IFS */}
          <h3 style={S.subTitle}>IFS Fractals (Iterated Function Systems)</h3>
          <p style={S.p}>
            An IFS fractal is defined by a small set of affine transforms. The{' '}
            <strong style={{ color: T.textBold }}>chaos game</strong> algorithm reveals the attractor:
          </p>

          <div style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: '6px', padding: '14px 16px', marginBottom: '14px' }}>
            <ol style={{ paddingLeft: '18px', margin: 0 }}>
              {[
                'Start a single point at the origin (0, 0)',
                'Randomly pick one of the N transforms — each has a probability weight',
                'Apply that transform to move the point to a new position',
                'Pixels near where the point lands accumulate glow intensity',
                'Repeat 60–150 times per pixel — the point traces the attractor',
              ].map((step, i) => (
                <li key={i} style={{ fontSize: '12px', color: T.text, lineHeight: 1.7, marginBottom: '2px' }}>
                  {step}
                </li>
              ))}
            </ol>
          </div>

          <NodeDiagram
            nodes={[
              { label: 'UV', type: 'source', outputs: ['uv: vec2'] },
              { label: 'Time\n(optional)', type: 'source', outputs: ['time: float'] },
              { label: 'IFS\n(preset: sierpinski)', type: 'effect', inputs: ['uv: vec2', 'time: float'], outputs: ['color: vec3', 'glow: float'] },
              { label: 'Output', type: 'output', inputs: ['color: vec3'] },
            ]}
            caption="The IFS node contains 4 preset transform sets. Use the glow output for custom coloring."
          />

          <p style={S.p}><strong style={{ color: T.textBold }}>Available presets:</strong></p>
          <ul style={S.ul}>
            <li style={S.li}><C>sierpinski</C> — 3 contractions toward triangle corners</li>
            <li style={S.li}><C>fern</C> — Barnsley fern, 4 transforms simulating leaf structure</li>
            <li style={S.li}><C>dragon</C> — Dragon curve, 2 transforms creating a space-filling path</li>
            <li style={S.li}><C>koch</C> — Koch snowflake variant</li>
          </ul>

          <Tip>
            Increase <C>iterations</C> (60–150) for a denser, more defined attractor.
            The <C>glow</C> param controls how bright each hit is — lower values show fine structure better,
            higher values give a bright flame-like look.
          </Tip>

          <TryIt exampleKey="ifsFractal" label="IFS Fractal (Sierpinski)" onTry={tryExample} />
          <TryIt exampleKey="barnsleyFern" label="Barnsley Fern" onTry={tryExample} />
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 5 — PHYSICS SIMULATIONS
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec5Ref as React.RefObject<HTMLDivElement>}>
          <h2 style={S.sectionTitle}>5 · Physics Simulations</h2>
          <div style={S.divider} />

          <p style={S.p}>
            These nodes visualize physical phenomena directly as <strong style={{ color: T.textBold }}>density fields</strong>.
            The Chladni node renders nodal lines analytically per-pixel. The 2D orbital cross-section gives you
            the textbook probability density map. The 3D orbital volumetrically raymarches through
            the full <C>|ψ_nlm(r,θ,φ)|²</C> wavefunction using real spherical harmonics — a self-contained
            camera orbiting the atom in real time.
          </p>

          {/* ── Chladni ── */}
          <h3 style={S.subTitle}>Chladni Plates</h3>
          <p style={S.p}>
            When a metal plate is vibrated at a resonant frequency, sand grains are bounced away from the
            moving areas and settle along the <strong style={{ color: T.textBold }}>nodal lines</strong> —
            the stationary points of the standing wave. The pattern is determined by the eigenfunction:
          </p>

          <CodeBlock>{`// Chladni formula (integers m ≠ n pick the mode):
cos(n·π·x) · cos(m·π·y) − cos(m·π·x) · cos(n·π·y) = 0

// Points near zero → nodal lines → where sand clusters
density = exp(−|chladni(x,y)| · sharpness)`}</CodeBlock>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
            {[
              ['m / n', 'Integer mode numbers. Different combos give completely different patterns. m=n gives nothing (no pattern). Try (3,4), (2,5), (1,6).'],
              ['sharpness', 'How tight the nodal lines are. Low (4) = fat diffuse bands. High (20) = razor-thin lines.'],
              ['turbulence', 'How much each particle jitters. 0 = frozen. ~0.04 = sand that\'s still vibrating.'],
              ['particles', 'More particles = denser, richer glow on the lines. 50 is fast; 200 is lush.'],
            ].map(([p, d]) => (
              <div key={p as string} style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: '6px', padding: '8px 12px' }}>
                <code style={{ fontSize: '11px', color: T.mauve, fontFamily: 'monospace', display: 'block', marginBottom: '3px' }}>{p}</code>
                <div style={{ fontSize: '11px', color: T.dim, lineHeight: 1.5 }}>{d}</div>
              </div>
            ))}
          </div>

          <StepBuilder steps={[
            {
              title: 'Basic Chladni pattern',
              description: 'Add UV + Time → Chladni Plate → Output (Color output). You should immediately see glowing nodal lines on a dark background.',
              nodes: [
                { label: 'UV',    type: 'source',    outputs: ['uv: vec2']    },
                { label: 'Time',  type: 'source',    outputs: ['time: float'] },
                { label: 'Chladni\nPlate', type: 'effect', inputs: ['uv', 'time'], outputs: ['color: vec3', 'density: float', 'field: float'] },
                { label: 'Output', type: 'output',   inputs: ['color: vec3']  },
              ],
            },
            {
              title: 'Explore modes — try different m and n',
              description: <>Change the <C>m</C> and <C>n</C> params to different integers. They must differ for a pattern to appear. Even numbers tend to be more symmetric; odd combos are more irregular.</>,
              nodes: [
                { label: 'Chladni\nm=5, n=4', type: 'effect', outputs: ['color: vec3'] },
                { label: 'Output', type: 'output' },
              ],
            },
            {
              title: 'Use the Density output for custom coloring',
              description: <>Wire <C>density</C> (a float 0→1) into a <strong>Palette Preset</strong> node. Now you can color the nodal lines with any palette instead of the default white glow.</>,
              nodes: [
                { label: 'Chladni\nPlate', type: 'effect', outputs: ['density: float'] },
                { label: 'Palette\nPreset', type: 'color', inputs: ['t: float'], outputs: ['color: vec3'] },
                { label: 'Output', type: 'output' },
              ],
            },
            {
              title: 'Animate between modes with Time',
              description: <>Use an <strong>Expr</strong> node to slowly pulse <C>m</C> or <C>n</C> over time. Wire Time → Expr → Floor → Chladni m to step between integer modes with a crossfade.</>,
              nodes: [
                { label: 'Time',   type: 'source',    outputs: ['time: float'] },
                { label: 'Expr\nfloor(t*0.3)', type: 'transform', outputs: ['result: float'] },
                { label: 'Chladni\nPlate', type: 'effect', inputs: ['m: float'], outputs: ['color: vec3'] },
                { label: 'Output', type: 'output' },
              ],
            },
          ]} />

          <TryIt exampleKey="chladniDemo" label="Chladni Plate" onTry={tryExample} />

          <Tip>
            The <C>field</C> output is the raw signed value — positive on one side of the nodal line,
            negative on the other. Pipe it into <strong>Abs → Smoothstep</strong> to get a custom edge mask,
            or use it directly in an <strong>Expr</strong> node for interference patterns.
          </Tip>

          {/* ── Electron Orbitals ── */}
          <h3 style={S.subTitle}>Electron Orbitals</h3>
          <p style={S.p}>
            Solving the Schrödinger equation for hydrogen gives exact wavefunctions described by three
            quantum numbers. The node implements the 2D cross-section at z=0 using real spherical harmonics:
          </p>

          <CodeBlock>{`// Quantum numbers:
//   n = principal (shell) — 1,2,3,4
//   l = azimuthal (subshell) — 0..n-1   (0=s, 1=p, 2=d, 3=f)

// Wavefunction ψ_nl(r,θ) in 2D:
R(r) = rˡ · exp(−r / n·a₀) · L_{n−l−1}^{2l+1}(2r / n·a₀)
Y(θ) = cos(l·θ)   // real part of spherical harmonic

// Probability density:
|ψ|² = (R · Y)²   // this is what you see`}</CodeBlock>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
            {[
              ['n (shell)',     '1=K, 2=L, 3=M, 4=N shell. Higher n → bigger, more diffuse orbital with more nodes.'],
              ['l (subshell)',  '0=s (spherical), 1=p (dumbbell), 2=d (clover), 3=f (complex). Must be < n.'],
              ['a₀ (Bohr r.)', 'Sets the physical scale of the orbital. Increase to zoom out; decrease to zoom in.'],
              ['turbulence',   'Quantum jitter — how restless the particle swarm is. Matches the inherent uncertainty of |ψ|².'],
            ].map(([p, d]) => (
              <div key={p as string} style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: '6px', padding: '8px 12px' }}>
                <code style={{ fontSize: '11px', color: T.mauve, fontFamily: 'monospace', display: 'block', marginBottom: '3px' }}>{p}</code>
                <div style={{ fontSize: '11px', color: T.dim, lineHeight: 1.5 }}>{d}</div>
              </div>
            ))}
          </div>

          <div style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: '8px', padding: '14px 18px', marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: T.blue, marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Notable orbital shapes</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
              {[
                ['n=1, l=0', '1s — single sphere, maximum density at nucleus'],
                ['n=2, l=0', '2s — sphere with inner ring node'],
                ['n=2, l=1', '2p — dumbbell lobes, zero at center'],
                ['n=3, l=0', '3s — two ring nodes around core'],
                ['n=3, l=2', '3d — four-leaf clover pattern'],
                ['n=4, l=3', '4f — 8-lobed pattern'],
              ].map(([label, desc]) => (
                <div key={label as string} style={{ background: T.surface, borderRadius: '5px', padding: '7px 10px' }}>
                  <code style={{ fontSize: '11px', color: T.green, fontFamily: 'monospace', display: 'block', marginBottom: '3px' }}>{label}</code>
                  <div style={{ fontSize: '10px', color: T.dim, lineHeight: 1.4 }}>{desc}</div>
                </div>
              ))}
            </div>
          </div>

          <StepBuilder steps={[
            {
              title: 'Basic 2p orbital',
              description: 'Add UV + Time → Electron Orbital → Output. Default is n=2, l=1 — the classic dumbbell (2p orbital). You should see two glowing lobes with quantum jitter.',
              nodes: [
                { label: 'UV',    type: 'source',  outputs: ['uv: vec2']    },
                { label: 'Time',  type: 'source',  outputs: ['time: float'] },
                { label: 'Electron\nOrbital', type: 'effect', inputs: ['uv', 'time'], outputs: ['color: vec3', 'density: float', 'ψ: float'] },
                { label: 'Output', type: 'output', inputs: ['color: vec3']  },
              ],
            },
            {
              title: 'Explore orbitals — change n and l',
              description: <>Try <C>n=3, l=2</C> for a d-orbital with its 4-lobed pattern. Try <C>n=1, l=0</C> for the ground state 1s orbital — a simple sphere. Rule: l must always be less than n.</>,
              nodes: [
                { label: 'Electron\nn=3, l=2', type: 'effect', outputs: ['color: vec3'] },
                { label: 'Output', type: 'output' },
              ],
            },
            {
              title: 'Use density for interference',
              description: <>Wire the <C>density</C> (<TypeBadge type="float" />) into a <strong>Multiply</strong> with an FBM noise value. This modulates the orbital with turbulent noise — looks like orbital deformation in a molecule.</>,
              nodes: [
                { label: 'Electron\nOrbital', type: 'effect', outputs: ['density: float'] },
                { label: 'FBM',    type: 'effect',    outputs: ['value: float']  },
                { label: 'Multiply', type: 'transform', inputs: ['a', 'b: float'], outputs: ['result: float'] },
                { label: 'Palette', type: 'color',     outputs: ['color: vec3']  },
                { label: 'Output',  type: 'output'                                },
              ],
            },
          ]} />

          <TryIt exampleKey="electronOrbitalDemo" label="Electron Orbital (2p)" onTry={tryExample} />

          <Warn>
            The l constraint <C>l {'<'} n</C> is not enforced by the node — setting l ≥ n will give a
            degenerate Laguerre polynomial (p &lt; 0 clamps to 0) and the orbital will just be a uniform blob.
            It won't crash, but it won't be physically meaningful.
          </Warn>

          {/* ── 3D Orbital ── */}
          <h3 style={S.subTitle}>Orbital 3D — Volumetric Raymarch</h3>
          <p style={S.p}>
            The <strong style={{ color: T.textBold }}>Orbital 3D</strong> node renders the full
            3D wavefunction by marching a ray through the density cloud <C>|ψ_nlm|²</C>.
            It uses the complete hydrogen atom solution — real spherical harmonics <C>Y_l^m(θ,φ)</C>
            for the angular part, and associated Laguerre polynomials for the radial part:
          </p>

          <CodeBlock>{`// Full 3D wavefunction:
ψ_nlm(r,θ,φ) = R_nl(r) · Y_l^m(θ,φ)

// Radial (same as 2D):
R_nl(r) = ρˡ · exp(−ρ/2) · L_{n−l−1}^{2l+1}(ρ)   where ρ = 2r/(n·a₀)

// Real spherical harmonics (3D angular structure):
Y_l^0   → rotationally symmetric (s, p_z, d_z², ...)
Y_l^|m| → cos(m·φ) lobes   (p_x, d_xz, ...)
Y_l^-|m|→ sin(m·φ) lobes   (p_y, d_yz, ...)

// Volume integration (front-to-back alpha compositing):
color += (1 − alpha) · sampleAlpha · sampleColor
alpha += (1 − alpha) · sampleAlpha`}</CodeBlock>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
            {([
              ['n, l, m', 'Quantum numbers. n=shell, l=subshell shape, m=magnetic orientation. m goes from −l to +l.'],
              ['steps / step size', 'Quality vs speed. 64 steps at 0.06 is a good balance. More steps = cleaner at cost of framerate.'],
              ['density scale', 'How bright/opaque the cloud is. Increase if it looks faint; decrease if it\'s solid white.'],
              ['gamma', '< 1 reveals faint outer shells. > 1 deepens the core. Try 0.3 to see all radial nodes.'],
              ['cam dist / speed', 'Camera orbit radius and speed. Set speed=0 and adjust cam_dist for a still shot.'],
              ['Color A / Color B', 'Two-tone coloring mapped to lobe orientation (positive vs negative ψ axis projection).'],
            ] as [string, string][]).map(([p, d]) => (
              <div key={p} style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: '6px', padding: '8px 12px' }}>
                <code style={{ fontSize: '11px', color: T.mauve, fontFamily: 'monospace', display: 'block', marginBottom: '3px' }}>{p}</code>
                <div style={{ fontSize: '11px', color: T.dim, lineHeight: 1.5 }}>{d}</div>
              </div>
            ))}
          </div>

          <div style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: '8px', padding: '14px 18px', marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: T.blue, marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Good 3D orbital combos to try</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
              {([
                ['n=2, l=0, m=0', '2s — solid sphere with a hollow core'],
                ['n=2, l=1, m=0', '2p_z — two vertical lobes (default)'],
                ['n=2, l=1, m=1', '2p_x — two horizontal lobes'],
                ['n=3, l=2, m=0', '3d_z² — donut + two caps'],
                ['n=3, l=2, m=2', '3d_x²−y² — four-leaf clover in 3D'],
                ['n=4, l=3, m=0', '4f_z³ — layered lobes along z-axis'],
              ] as [string, string][]).map(([label, desc]) => (
                <div key={label} style={{ background: T.surface, borderRadius: '5px', padding: '7px 10px' }}>
                  <code style={{ fontSize: '11px', color: T.green, fontFamily: 'monospace', display: 'block', marginBottom: '3px' }}>{label}</code>
                  <div style={{ fontSize: '10px', color: T.dim, lineHeight: 1.4 }}>{desc}</div>
                </div>
              ))}
            </div>
          </div>

          <NodeDiagram
            nodes={[
              { label: 'UV',       type: 'source',  outputs: ['uv: vec2']    },
              { label: 'Time',     type: 'source',  outputs: ['time: float'] },
              { label: 'Orbital\n3D', type: 'effect', inputs: ['uv', 'time'], outputs: ['color: vec3', 'alpha: float', 'depth: float'] },
              { label: 'Output',   type: 'output',  inputs: ['color: vec3']  },
            ]}
            caption="The simplest setup — just UV + Time → Orbital 3D → Output. Camera auto-orbits. Try wiring depth into a Palette for a depth-shaded version."
          />

          <Tip>
            Wire the <C>depth</C> output into a <strong>Palette Preset</strong> node then <strong>Mix</strong>
            it with the <C>color</C> output for a depth-tinted version. Or multiply <C>alpha</C> by
            a Chladni <C>density</C> to mask the orbital volume to only appear inside the nodal lines.
          </Tip>

          <TryIt exampleKey="orbitalVolume3dDemo" label="3D Orbital (2p)" onTry={tryExample} />

          {/* ── Combining both ── */}
          <h3 style={S.subTitle}>Combining Both — Interference & Layering</h3>
          <p style={S.p}>
            Both nodes output a <C>density</C> float and a <C>color</C> vec3, making them easy to
            compose with each other or with other nodes:
          </p>

          <NodeDiagram
            nodes={[
              { label: 'UV',    type: 'source',    outputs: ['uv: vec2']        },
              { label: 'Time',  type: 'source',    outputs: ['time: float']     },
              { label: 'Chladni\nPlate',  type: 'effect',    outputs: ['density: float'] },
              { label: 'Electron\nOrbital', type: 'effect',  outputs: ['density: float'] },
              { label: 'Multiply\n(interference)', type: 'transform', outputs: ['result: float'] },
              { label: 'Palette', type: 'color',   outputs: ['color: vec3']     },
              { label: 'Output',  type: 'output'                                 },
            ]}
            caption="Multiplying both density outputs creates a moiré-like interference pattern — bright only where both fields are simultaneously dense."
          />

          <p style={S.p}>
            Other ideas to try:
          </p>
          <ul style={S.ul}>
            <li style={S.li}><strong style={{ color: T.textBold }}>Add densities</strong> — overlay both patterns at once, brighter where they coincide</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Mix colors</strong> — blend the two <C>color</C> outputs with a <strong>Mix</strong> node driven by Time → Sin</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Domain warp the UV first</strong> — feed the Chladni UV through a DomainWarp to bend the plate</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Gravity lens over an orbital</strong> — wire <C>uv_lensed</C> into the Orbital's UV input to simulate curvature</li>
          </ul>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 6 — GENERATIVE SYSTEMS (Hobbs Flow Fields + Circle Packing)
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec6Ref as React.RefObject<HTMLDivElement>}>
          <h2 style={S.sectionTitle}>6 · Generative Systems</h2>
          <div style={S.divider} />

          <p style={S.p}>
            Two essays by generative artist <strong style={{ color: T.textBold }}>Tyler Hobbs</strong> form the
            conceptual backbone of this section: his 2020 essay on flow fields and his 2016 essay on circle
            packing. Both are about the same idea — using simple, well-defined rules to produce organic
            complexity that looks alive, physical, and impossible to predict from the rule alone.
          </p>

          {/* ── Flow Fields: Hobbs Deep Dive ── */}
          <h3 style={S.subTitle}>Flow Fields — The Hobbs Model</h3>
          <p style={S.p}>
            A flow field is a <strong style={{ color: T.textBold }}>2D array of angles</strong>. Every cell in
            the grid holds one number: a direction. To draw a curve, you pick a starting point, look up the
            angle in the nearest cell, take a small step in that direction, and repeat. The curve follows the
            field like a leaf on water. The shape of the field determines everything.
          </p>

          <CodeBlock>{`// The grid (conceptually — in GLSL we sample it directly):
for each column, row:
    angle = fbmNoise(col * 0.005, row * 0.005) * 2π
    grid[col][row] = angle

// Drawing one curve:
pos = seed_position
for step in 0..num_steps:
    angle = grid[nearest_cell(pos)]
    pos  += vec2(cos(angle), sin(angle)) * step_length
    draw_dot(pos)               // or accumulate glow at dist to pixel`}</CodeBlock>

          <p style={S.p}>
            Hobbs identifies three choices that control the entire aesthetic:
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '16px' }}>
            {([
              ['Starting positions', 'Grid (rigid), random (loose, clumpy), or circle packing (evenly spaced but relaxed). Each creates a different texture.'],
              ['steps per curve', 'Short = fur, bristles, grass. Long = rivers, smoke, calligraphy. This single number changes the entire mood.'],
              ['Angle distortion', 'How you fill the angle grid. Perlin = organic smooth. Curl = loops. Quantized/snapped = rocky crystalline.'],
            ] as [string, string][]).map(([p, d]) => (
              <div key={p} style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: '6px', padding: '10px 12px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: T.blue, marginBottom: '5px' }}>{p}</div>
                <div style={{ fontSize: '11px', color: T.dim, lineHeight: 1.5 }}>{d}</div>
              </div>
            ))}
          </div>

          {/* ── Field Modes ── */}
          <h3 style={S.subTitle}>Field Modes — Three Distortion Approaches</h3>
          <p style={S.p}>
            The <C>field_mode</C> param determines the mathematical distortion of the angle grid.
            These map to three distinct visual personalities:
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '16px' }}>
            {([
              ['perlin (smooth)', 'FBM noise maps directly to angle. Classic Hobbs look — organic, continuous, never loops on itself. Curves flow gracefully in one direction then turn.'],
              ['curl (loops)', 'Takes the gradient of the noise field and rotates it 90°. This creates a divergence-free (curl) field — curves loop and spiral. Great for vortex / fluid dynamics look.'],
              ['quantized (rocky)', 'Angles are snapped to multiples of π/N. With N=2 you get a crosshatch; N=4 is diamond facets; N=10 is a sculpted stone surface. Hobbs calls these "non-continuous distortions."'],
            ] as [string, string][]).map(([p, d]) => (
              <div key={p} style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: '6px', padding: '10px 12px' }}>
                <code style={{ fontSize: '11px', color: T.mauve, fontFamily: 'monospace', display: 'block', marginBottom: '5px' }}>{p}</code>
                <div style={{ fontSize: '11px', color: T.dim, lineHeight: 1.5 }}>{d}</div>
              </div>
            ))}
          </div>

          <CodeBlock>{`// Smooth (perlin) — angle = fbm(pos) * 2π

// Curl — rotate noise gradient 90°:
float nx = fbm(pos + vec2(eps, 0.0));
float ny = fbm(pos + vec2(0.0, eps));
angle = atan((ny - n) / eps, -(nx - n) / eps);

// Quantized — snap to multiples of quant:
float quant = PI / quant_steps;   // e.g. π/10 = 18°
angle = round(angle / quant) * quant;`}</CodeBlock>

          <StepBuilder steps={[
            {
              title: 'Fur / grass texture (short curves)',
              description: <>Set <C>steps=6</C>, <C>step_size=0.025</C>, <C>curves=100</C>. The result looks like
                a dense fur or grass field. Tune <C>noise_scale</C> to change the swirl size. Add Time to animate it gently.</>,
              nodes: [
                { label: 'UV',        type: 'source',  outputs: ['uv: vec2']    },
                { label: 'Time',      type: 'source',  outputs: ['time: float'] },
                { label: 'Flow Field\nsteps=6', type: 'effect', inputs: ['uv', 'time'], outputs: ['color: vec3'] },
                { label: 'Output',    type: 'output',  inputs: ['color: vec3']  },
              ],
            },
            {
              title: 'Long fluid strokes',
              description: <>Increase to <C>steps=48</C>, <C>curves=40</C>. Now you see long curving brushstrokes.
                These feel calligraphic or like ink in water. Lower <C>noise_scale</C> (0.5–1.0) for bigger sweeping arcs.</>,
              nodes: [
                { label: 'UV',        type: 'source',  outputs: ['uv: vec2']    },
                { label: 'Time',      type: 'source',  outputs: ['time: float'] },
                { label: 'Flow Field\nsteps=48', type: 'effect', inputs: ['uv', 'time'], outputs: ['color: vec3'] },
                { label: 'Output',    type: 'output',  inputs: ['color: vec3']  },
              ],
            },
            {
              title: 'Curl mode: vortex spirals',
              description: <>Switch <C>field_mode</C> to <C>curl</C>. Curves now loop and spiral back on
                themselves because the field is divergence-free — no sources or sinks, only rotation.</>,
              nodes: [
                { label: 'UV',        type: 'source',  outputs: ['uv: vec2']    },
                { label: 'Flow Field\ncurl mode', type: 'effect', inputs: ['uv', 'time'], outputs: ['color: vec3'] },
                { label: 'Output',    type: 'output',  inputs: ['color: vec3']  },
              ],
            },
            {
              title: 'Quantized rocky forms',
              description: <>Switch to <C>quantized</C>, set <C>quant_steps=4</C> for dramatic crystalline
                angles. Increase <C>quant_steps</C> to 12–16 to soften back toward smooth but keep the
                faceted, architectural quality.</>,
              nodes: [
                { label: 'UV',        type: 'source',  outputs: ['uv: vec2']    },
                { label: 'Flow Field\nquantized', type: 'effect', inputs: ['uv', 'time'], outputs: ['color: vec3'] },
                { label: 'Output',    type: 'output',  inputs: ['color: vec3']  },
              ],
            },
            {
              title: 'Use density output for custom coloring',
              description: <>Wire <C>density</C> into a <strong>Palette Preset</strong> node instead of using
                the built-in <C>color</C>. Now your palette controls the hue. Or multiply <C>density</C> by
                a Voronoi pattern to get cellular texture on the curves.</>,
              nodes: [
                { label: 'Flow Field', type: 'effect', outputs: ['density: float'] },
                { label: 'Palette\nPreset', type: 'color', inputs: ['t: float'], outputs: ['color: vec3'] },
                { label: 'Output',     type: 'output', inputs: ['color: vec3']   },
              ],
            },
          ]} />

          <TryIt exampleKey="flowFieldDemo" label="Flow Field" onTry={tryExample} />

          <Tip>
            Hobbs' key insight: <strong>don't just use Perlin noise and call it a day.</strong> The most
            interesting work comes from non-standard distortions — quantizing angles, using curl fields,
            mixing multiple noise layers, or combining flow fields with other geometric constraints.
          </Tip>

          {/* ── Circle Packing ── */}
          <h3 style={S.subTitle}>Circle Packing</h3>
          <p style={S.p}>
            Circle packing places circles as tightly as possible without overlapping. Hobbs' 2016 approach
            is elegantly simple: for each circle, try a random location, check for collisions with all
            previous circles, and only place it if there's room. Repeat with 2000 failures allowed before
            giving up on a given size.
          </p>

          <CodeBlock>{`// Core collision check (two circles):
distance(center_a, center_b) > radius_a + radius_b + padding
//  → no collision, safe to place

// Algorithm (per circle size, largest first):
failures = 0
while placed < target AND failures < 2000:
    candidate = random_position()
    if no_collision(candidate, radius, all_placed):
        place(candidate, radius)
        failures = 0
    else:
        failures++`}</CodeBlock>

          <p style={S.p}>
            In shader GLSL we do this differently — we use deterministic hash-based placement so the same
            circle always appears at the same position regardless of frame. Each circle's center and radius
            come from a hash of its index number. The collision check loops over all earlier circles.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
            {([
              ['circle_mode: flat', 'Hard solid disc with 1px AA. Clean, geometric.'],
              ['circle_mode: gradient', 'Radial falloff — dense at centre, irregular fringe at edge. Looks like probability clouds or ink drops.'],
              ['circle_mode: ring', 'Hollow stroke — only the circumference is lit. Good for diagrams or bubble soap textures.'],
              ['circle_mode: noise', 'FBM texture masked to the disc. Each circle has a turbulent interior.'],
              ['padding', 'Gap between circle edges. 0 = touching, 0.02 = visible breathing room.'],
              ['animate', 'Pulses each circle radius with time at a unique phase. Makes the packing breathe.'],
            ] as [string, string][]).map(([p, d]) => (
              <div key={p} style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: '6px', padding: '8px 12px' }}>
                <code style={{ fontSize: '11px', color: T.mauve, fontFamily: 'monospace', display: 'block', marginBottom: '3px' }}>{p}</code>
                <div style={{ fontSize: '11px', color: T.dim, lineHeight: 1.5 }}>{d}</div>
              </div>
            ))}
          </div>

          <NodeDiagram
            nodes={[
              { label: 'UV',          type: 'source',    outputs: ['uv: vec2']    },
              { label: 'Time',        type: 'source',    outputs: ['time: float'] },
              { label: 'Circle Pack', type: 'effect',    inputs: ['uv', 'time'],  outputs: ['color: vec3', 'mask: float', 'centers: vec2'] },
              { label: 'Output',      type: 'output',    inputs: ['color: vec3']  },
            ]}
            caption="CirclePack outputs color (filled circles), mask (coverage float), and centers (nearest circle center as vec2 — useful for compositing)."
          />

          <StepBuilder steps={[
            {
              title: 'Basic circle packing',
              description: 'Add UV + Time → Circle Pack → Output. Default is gradient mode with 80 circles. Adjust min_radius and max_radius to control the size distribution.',
              nodes: [
                { label: 'UV',          type: 'source',  outputs: ['uv: vec2']    },
                { label: 'Time',        type: 'source',  outputs: ['time: float'] },
                { label: 'Circle Pack', type: 'effect',  inputs: ['uv', 'time'],  outputs: ['color: vec3'] },
                { label: 'Output',      type: 'output',  inputs: ['color: vec3']  },
              ],
            },
            {
              title: 'Ring mode for a bubble/cell look',
              description: <>Switch <C>circle_mode</C> to <C>ring</C>. Lower <C>circles</C> to 40 and increase <C>max_radius</C> to 0.25
                for large soap bubbles. The padding controls how tightly they pack.</>,
              nodes: [
                { label: 'Circle Pack\nring mode', type: 'effect', outputs: ['color: vec3'] },
                { label: 'Output', type: 'output' },
              ],
            },
            {
              title: 'Animate the packing',
              description: <>Set <C>animate</C> to 0.5 — each circle pulses at a slightly different phase,
                making the whole field breathe. Pairs well with gradient mode for a living cell look.</>,
              nodes: [
                { label: 'Time',        type: 'source',  outputs: ['time: float'] },
                { label: 'Circle Pack\nanimate=0.5', type: 'effect', inputs: ['uv', 'time'], outputs: ['color: vec3'] },
                { label: 'Output',      type: 'output'  },
              ],
            },
            {
              title: 'Use mask to cut other effects into circles',
              description: <>Wire <C>mask</C> into a <strong>Mix</strong> node to blend between two effects —
                one inside circles, one outside. For example: FBM pattern inside circles, black outside.</>,
              nodes: [
                { label: 'Circle Pack', type: 'effect',    outputs: ['mask: float']   },
                { label: 'FBM',         type: 'effect',    outputs: ['value: float']  },
                { label: 'Mix',         type: 'transform', inputs: ['a', 'b', 't'],   outputs: ['result: float'] },
                { label: 'Palette',     type: 'color',     outputs: ['color: vec3']   },
                { label: 'Output',      type: 'output'                                },
              ],
            },
          ]} />

          <TryIt exampleKey="circlePackDemo" label="Circle Pack" onTry={tryExample} />

          {/* ── Combining Flow Fields + Circle Pack ── */}
          <h3 style={S.subTitle}>Combining Flow Fields & Circle Packing</h3>
          <p style={S.p}>
            Hobbs uses circle packing to choose <em>starting positions</em> for his flow field curves.
            In Shader Studio the two nodes compose naturally — wire <C>density</C> from one into a
            <strong> Mix</strong> with the other, or use Circle Pack's <C>mask</C> to confine the flow:
          </p>

          <NodeDiagram
            nodes={[
              { label: 'UV',          type: 'source',    outputs: ['uv: vec2']        },
              { label: 'Time',        type: 'source',    outputs: ['time: float']     },
              { label: 'Circle Pack', type: 'effect',    outputs: ['mask: float']     },
              { label: 'Flow Field',  type: 'effect',    outputs: ['color: vec3', 'density: float'] },
              { label: 'Multiply\n(mask × density)', type: 'transform', outputs: ['result: float'] },
              { label: 'Palette',     type: 'color',     outputs: ['color: vec3']     },
              { label: 'Output',      type: 'output'                                   },
            ]}
            caption="Multiplying Flow Field density by Circle Pack mask confines the curves to live inside the circles — each circle becomes a swirling micro-field."
          />

          <p style={S.p}>Other composition ideas from the Hobbs essays:</p>
          <ul style={S.ul}>
            <li style={S.li}>
              <strong style={{ color: T.textBold }}>Domain warp before flow field</strong> — feed UV through
              a <strong>Domain Warp</strong> node first. The warp pre-distorts the coordinate space so the
              flow field curves through an already-turbulent landscape.
            </li>
            <li style={S.li}>
              <strong style={{ color: T.textBold }}>Voronoi as angle field</strong> — wire a <strong>Voronoi</strong>{' '}
              node's distance output through an <strong>Expr</strong> (<C>v * 6.28318</C>) and into a
              custom <strong>Flow Field</strong>. Cells create their own local current directions.
            </li>
            <li style={S.li}>
              <strong style={{ color: T.textBold }}>Orbital density as flow mask</strong> — multiply the
              Flow Field <C>density</C> by an Electron Orbital <C>density</C>. Curves only appear where the
              quantum probability is high — the atom itself becomes the flow field boundary.
            </li>
            <li style={S.li}>
              <strong style={{ color: T.textBold }}>Chladni as collision boundary</strong> — use the
              Chladni <C>field</C> output (positive inside, negative outside nodal lines) to mask flow
              curves. Curves travel along the resonance pattern but never cross the nodal boundaries.
            </li>
            <li style={S.li}>
              <strong style={{ color: T.textBold }}>Circle Pack noise fill + flow overlay</strong> — use
              circle mode <C>noise</C> for the background, then blend Flow Field <C>color</C> on top with
              low opacity. The circles form islands; the flow field connects them.
            </li>
          </ul>

          <Tip>
            The <strong>density</strong> output from Flow Field and the <strong>mask</strong> output from
            Circle Pack are both plain <TypeBadge type="float" /> values — they compose with any math node.
            Think of them as painterly alpha channels: multiply, mix, add, threshold however you want.
          </Tip>
        </div>

        {/* Bottom padding */}
        <div style={{ height: '80px' }} />
      </main>
    </div>
  );
}
