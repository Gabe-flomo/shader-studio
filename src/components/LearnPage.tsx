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

  const sec0Ref = useRef<HTMLDivElement>(null);
  const sec1Ref = useRef<HTMLDivElement>(null);
  const sec2Ref = useRef<HTMLDivElement>(null);
  const sec3Ref = useRef<HTMLDivElement>(null);
  const sec4Ref = useRef<HTMLDivElement>(null);
  const sec5Ref = useRef<HTMLDivElement>(null);
  const sec6Ref = useRef<HTMLDivElement>(null);
  const sec7Ref = useRef<HTMLDivElement>(null);
  const sec8Ref = useRef<HTMLDivElement>(null);
  const sec9Ref = useRef<HTMLDivElement>(null);
  const sec10Ref = useRef<HTMLDivElement>(null);
  const sec11Ref = useRef<HTMLDivElement>(null);
  const sec12Ref = useRef<HTMLDivElement>(null);
  const sec13Ref = useRef<HTMLDivElement>(null);
  const sec14Ref = useRef<HTMLDivElement>(null);
  const sec15Ref = useRef<HTMLDivElement>(null);
  const sec16Ref = useRef<HTMLDivElement>(null);
  const sec17Ref = useRef<HTMLDivElement>(null);
  const sec3dRef = useRef<HTMLDivElement>(null);
  const secAppRef = useRef<HTMLDivElement>(null);
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

        <span style={S.tocSection}>Getting Started</span>
        <TocLink label="Introduction" targetRef={sec0Ref} />
        <TocLink label="Interface" targetRef={sec1Ref} />
        <TocLink label="First Shader" targetRef={sec2Ref} />

        <span style={S.tocSection}>Core Concepts</span>
        <TocLink label="Data & Types" targetRef={sec3Ref} />
        <TocLink label="SDFs" targetRef={sec4Ref} />
        <TocLink label="Sources" targetRef={sec5Ref} />
        <TocLink label="Transforms" targetRef={sec6Ref} />
        <TocLink label="Groups" targetRef={sec7Ref} />
        <TocLink label="Loops" targetRef={sec8Ref} />
        <TocLink label="Noise" targetRef={sec9Ref} />
        <TocLink label="Color" targetRef={sec10Ref} />
        <TocLink label="Math" targetRef={sec11Ref} />

        <span style={S.tocSection}>Advanced</span>
        <TocLink label="Animation" targetRef={sec12Ref} />
        <TocLink label="Effects" targetRef={sec13Ref} />
        <TocLink label="Fractals" targetRef={sec14Ref} />
        <TocLink label="3D / Raymarch" targetRef={sec15Ref} />
        <TocLink label="3D Composable" targetRef={sec3dRef} />
        <TocLink label="Import / Export" targetRef={sec16Ref} />

        <span style={S.tocSection}>Reference</span>
        <TocLink label="Examples" targetRef={sec17Ref} />
        <TocLink label="Node Reference" targetRef={secAppRef} />
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
            A comprehensive guide to building GLSL shaders with the node graph — from first UV to animated fractals and volumetric rendering.
          </p>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 0 — INTRODUCTION
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec0Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Introduction</h2>
          <div style={S.divider} />

          <p style={S.p}>
            Shader Studio is a node-based GLSL shader editor. Every pixel is computed independently and in parallel on the GPU. You define "what color should this coordinate be" as a composition of math functions.
          </p>

          <p style={S.p}>
            This is the same paradigm used across the visual-computing world:
          </p>
          <ul style={S.ul}>
            <li style={S.li}><strong style={{ color: T.textBold }}>Shadertoy</strong> — write GLSL fragment shaders in a browser</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>TouchDesigner</strong> — node-based visual programming for real-time graphics</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Blender Shader Editor</strong> — material graph for 3D rendering</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Unreal / Unity Shader Graphs</strong> — game-engine material editors</li>
          </ul>
          <p style={S.p}>
            The key difference: Shader Studio compiles your graph directly into GLSL you can inspect, copy, and run anywhere.
          </p>

          <Tip>You don't need to write any code. But understanding what's happening mathematically will help you build more interesting things. This guide explains both layers — what you click and why it works.</Tip>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 1 — THE INTERFACE
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec1Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>The Interface</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>The Layout</h3>
          <pre style={S.code}>{`┌─────────────────────────────────────────────────────┐
│                    Top Nav Bar                      │
├──────────┬────────────────────────┬─────────────────┤
│          │                        │                 │
│  Node    │    Node Graph Canvas   │   Shader        │
│  Palette │                        │   Preview       │
│          │   (drag, connect,      │                 │
│  (click  │    build your graph)   │   (live GPU     │
│   to add │                        │    output)      │
│   nodes) │                        │                 │
│          ├────────────────────────┤                 │
│          │     Code Panel         │                 │
│          │   (generated GLSL)     │                 │
└──────────┴────────────────────────┴─────────────────┘`}</pre>
          <ul style={S.ul}>
            <li style={S.li}><strong style={{ color: T.textBold }}>Top Nav</strong> — file operations, view toggles, recording controls</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Node Palette</strong> — categorized list of all available nodes; click to add</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Node Graph Canvas</strong> — drag nodes, draw wires between sockets, build your shader</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Shader Preview</strong> — live GPU-rendered output of your graph</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Code Panel</strong> — the generated GLSL source; toggle with <C>Cmd+\</C></li>
          </ul>

          <h3 style={S.subTitle}>Node Anatomy</h3>
          <pre style={S.code}>{`        ┌──────────────────────┐
        │   Node Title         │
        ├──────────────────────┤
  ● ──▶ │  input_a    output ──▶ ○
  ● ──▶ │  input_b             │
        ├──────────────────────┤
        │  [param: 0.50]       │
        │  [dropdown: mode]    │
        ├──────────────────────┤
        │  ┌────────────────┐  │
        │  │  inline preview│  │
        │  └────────────────┘  │
        └──────────────────────┘

  ● = input socket (left, filled)
  ○ = output socket (right, open)`}</pre>
          <p style={S.p}>
            Socket colors indicate data type: <span style={{ color: '#bac2de' }}>float = gray/white</span>, <span style={{ color: T.blue }}>vec2 = blue</span>, <span style={{ color: T.green }}>vec3 = green</span>, <span style={{ color: T.mauve }}>vec4 = purple</span>. You can only connect matching types.
          </p>

          <h3 style={S.subTitle}>Keyboard Shortcuts Quick Reference</h3>
          <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: '14px', fontSize: '12px' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>Action</th>
                <th style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>Shortcut</th>
              </tr>
            </thead>
            <tbody>
              {([
                ['Open palette', 'A'],
                ['Add UV', 'U'],
                ['Add Time', 'T'],
                ['Add Output', 'O'],
                ['Add Mix', 'M'],
                ['Add Float constant', 'Shift+F'],
                ['Add Color', 'C'],
                ['Fit view', 'F'],
                ['Toggle GLSL', 'Cmd+\\'],
                ['Undo', 'Cmd+Z'],
                ['Export graph', 'Cmd+S'],
                ['Import graph', 'Cmd+O'],
                ['Group selected', 'Cmd+G'],
                ['Wrap in loop', 'Cmd+L'],
                ['Record video', 'Cmd+R'],
                ['Show shortcuts', '?'],
              ] as [string, string][]).map(([action, shortcut], i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${T.border}22` }}>
                  <td style={{ padding: '6px 10px', color: T.text }}>{action}</td>
                  <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: T.green, fontSize: '11px' }}>{shortcut}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Tip>Hold <C>1</C>, <C>2</C>, or <C>3</C> to highlight nodes by type — useful for finding specific nodes in a complex graph.</Tip>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 2 — YOUR FIRST SHADER
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec2Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Your First Shader</h2>
          <div style={S.divider} />

          <StepBuilder steps={[
            {
              title: 'Step 1: The Coordinate System',
              description: <>Press <C>U</C> to add a <strong style={{ color: T.textBold }}>UV</strong> node. This is the starting point for every shader. It outputs centered, aspect-corrected coordinates — <C>(0,0)</C> is the center, y spans roughly <C>±0.5</C>, and x is scaled by the aspect ratio.</>,
              nodes: [{ label: 'UV', type: 'source', outputs: ['uv: vec2'] }],
            },
            {
              title: 'Step 2: A Shape',
              description: <>Add a <strong style={{ color: T.textBold }}>Circle SDF</strong> node and connect <C>UV → CircleSDF.position</C>. An SDF (Signed Distance Field) returns a float: negative inside, zero on the boundary, positive outside. The circle formula is simply <C>distance_from_center - radius</C>.</>,
              nodes: [
                { label: 'UV', type: 'source', outputs: ['uv: vec2'] },
                { label: 'CircleSDF', type: 'effect', inputs: ['position: vec2'], outputs: ['distance: float'] },
              ],
            },
            {
              title: 'Step 3: Lighting',
              description: <>Add a <strong style={{ color: T.textBold }}>MakeLight</strong> node and connect <C>CircleSDF.distance → MakeLight.sdf</C>. MakeLight computes a glow formula: bright at the boundary (distance near 0) and falling off quickly elsewhere.</>,
              nodes: [
                { label: 'CircleSDF', type: 'effect', outputs: ['distance: float'] },
                { label: 'MakeLight', type: 'effect', inputs: ['sdf: float'], outputs: ['glow: float'] },
              ],
            },
            {
              title: 'Step 4: Color',
              description: <>Add a <strong style={{ color: T.textBold }}>Palette</strong> node and connect <C>MakeLight → Palette.t</C>. The palette uses the IQ cosine formula: <C>{'a + b * cos(2\u03C0 * (c * t + d))'}</C>. This maps any float to a smooth rainbow gradient.</>,
              nodes: [
                { label: 'MakeLight', type: 'effect', outputs: ['glow: float'] },
                { label: 'Palette', type: 'color', inputs: ['t: float'], outputs: ['color: vec3'] },
              ],
            },
            {
              title: 'Step 5: Output',
              description: <>Press <C>O</C> to add an <strong style={{ color: T.textBold }}>Output</strong> node. Connect <C>Palette.color → Output.color</C>. You should see a glowing colored circle in the preview.</>,
              nodes: [
                { label: 'Palette', type: 'color', outputs: ['color: vec3'] },
                { label: 'Output', type: 'output', inputs: ['color: vec3'] },
              ],
            },
          ]} />

          <NodeDiagram
            nodes={[
              { label: 'UV', type: 'source', outputs: ['uv: vec2'] },
              { label: 'CircleSDF', type: 'effect', inputs: ['position'], outputs: ['distance'] },
              { label: 'MakeLight', type: 'effect', inputs: ['sdf'], outputs: ['glow'] },
              { label: 'Palette', type: 'color', inputs: ['t'], outputs: ['color'] },
              { label: 'Output', type: 'output', inputs: ['color'] },
            ]}
            caption="Complete first shader: UV → CircleSDF → MakeLight → Palette → Output"
          />

          <Tip>Try adding Time: Press <C>T</C>, add a Time node. Connect Time → Sin → Multiply(0.3) → MakeLight.brightness. Now the glow pulses.</Tip>

          <TryIt exampleKey="glowing-circle" label="Glowing Circle" onTry={tryExample} />
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 3 — DATA FLOW & TYPES
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec3Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Data Flow & Types</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>Types in Shader Studio</h3>
          <DataTable rows={[
            ['float', 'Single number', 'Time / Constant / Sin'],
            ['vec2', 'Two numbers (x, y)', 'UV / Mouse / MakeVec2'],
            ['vec3', 'Three numbers (r, g, b)', 'Palette / MakeVec3 / FloatToVec3'],
            ['vec4', 'Four numbers (r, g, b, a)', 'Vec4Output'],
          ]} />

          <h3 style={S.subTitle}>The Compilation Model</h3>
          <p style={S.p}>
            When you connect nodes and hit play, the compiler runs four steps:
          </p>
          <ol style={{ ...S.ul, listStyleType: 'decimal' }}>
            <li style={S.li}><strong style={{ color: T.textBold }}>Topological sort</strong> — orders nodes so every input is computed before it is used</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Generate GLSL</strong> — each node emits its GLSL snippet with unique variable names</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Assemble main()</strong> — all snippets are concatenated into a single <C>void main()</C></li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Compile on GPU</strong> — the shader is compiled and linked by WebGL</li>
          </ol>

          <CodeBlock>{`// Example generated GLSL for UV → CircleSDF → MakeLight
void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution)
              / u_resolution.y;

    float n1_dist = length(uv) - 0.25;  // CircleSDF
    float n2_glow = 0.02 / max(abs(n1_dist), 0.001);  // MakeLight

    gl_FragColor = vec4(vec3(n2_glow), 1.0);
}`}</CodeBlock>

          <h3 style={S.subTitle}>Wired vs. Parameter Values</h3>
          <p style={S.p}>
            Every node parameter has two modes. As a <strong style={{ color: T.textBold }}>static parameter</strong>, the value is set by the slider and baked into the GLSL as a literal constant. As a <strong style={{ color: T.textBold }}>wired parameter</strong>, the value comes from another node at runtime — the slider shows "wired" and becomes inactive.
          </p>
          <p style={S.p}>
            Example: CircleSDF radius as static <C>0.3</C> versus wired from <C>Sin(Time*2)*0.2+0.3</C> for an animated pulsing radius.
          </p>

          <h3 style={S.subTitle}>Type Conversion Nodes</h3>
          <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: '14px', fontSize: '12px' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>From</th>
                <th style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>To</th>
                <th style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>Node</th>
              </tr>
            </thead>
            <tbody>
              {([
                ['float', 'vec3', 'FloatToVec3'],
                ['float + float', 'vec2', 'MakeVec2'],
                ['float x 3', 'vec3', 'MakeVec3'],
                ['vec2', 'float (x)', 'ExtractX'],
                ['vec2', 'float (y)', 'ExtractY'],
                ['float', 'remapped float', 'Remap'],
              ] as [string, string, string][]).map(([from, to, node], i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${T.border}22` }}>
                  <td style={{ padding: '6px 10px', color: T.text }}>{from}</td>
                  <td style={{ padding: '6px 10px', color: T.text }}>{to}</td>
                  <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: T.green, fontSize: '11px' }}>{node}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 4 — SIGNED DISTANCE FIELDS
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec4Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Signed Distance Fields</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>What is an SDF?</h3>
          <p style={S.p}>
            A Signed Distance Field is a function <C>f(point) → float</C> that returns the signed distance from any point to the nearest surface. Negative means inside, zero means on the boundary, positive means outside.
          </p>
          <p style={S.p}>Four reasons SDFs are powerful:</p>
          <ol style={{ ...S.ul, listStyleType: 'decimal' }}>
            <li style={S.li}>Shapes combine with <C>min</C>/<C>max</C> — union, intersection, subtraction</li>
            <li style={S.li}>Smooth blending between shapes with SmoothMin</li>
            <li style={S.li}>The same definition works for rendering, coloring, and compositing</li>
            <li style={S.li}>Transforming the input coordinates = transforming the shape</li>
          </ol>

          <h3 style={S.subTitle}>2D Primitive Nodes</h3>
          <p style={S.p}><strong style={{ color: T.textBold }}>Circle SDF</strong> — the simplest distance function:</p>
          <CodeBlock>{`float dist = length(point) - radius;`}</CodeBlock>

          <p style={S.p}><strong style={{ color: T.textBold }}>Box SDF</strong> — uses the elegant abs+max formula:</p>
          <CodeBlock>{`vec2 d = abs(point) - vec2(width, height);
float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);`}</CodeBlock>

          <p style={S.p}><strong style={{ color: T.textBold }}>Ring SDF</strong> — hollow circle variant:</p>
          <CodeBlock>{`float dist = abs(length(point) - radius) - thickness;`}</CodeBlock>

          <p style={S.p}><strong style={{ color: T.textBold }}>Shape SDF</strong> — dropdown with 30+ shapes including star, heart, hexagon, cross, and more.</p>

          <h3 style={S.subTitle}>SDF Repeat Nodes</h3>
          <p style={S.p}>
            <strong style={{ color: T.textBold }}>OpRepeat</strong> — tiles space via <C>mod</C>. Feed your UV through OpRepeat before the SDF to create an infinite grid of the shape.
          </p>
          <p style={S.p}>
            <strong style={{ color: T.textBold }}>OpRepeatPolar</strong> — N-fold angular repeat. Creates mandala-like radial symmetry by repeating the SDF around a circle.
          </p>

          <h3 style={S.subTitle}>Combining SDFs</h3>
          <p style={S.p}>SDFs combine with simple math operations:</p>
          <ul style={S.ul}>
            <li style={S.li}><strong style={{ color: T.textBold }}>Union</strong> — <C>min(sdf_a, sdf_b)</C> — merges two shapes</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Intersection</strong> — <C>max(sdf_a, sdf_b)</C> — keeps only overlap</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Subtraction</strong> — <C>max(sdf_a, -sdf_b)</C> — cuts shape B from shape A</li>
          </ul>
          <pre style={S.code}>{`Union (min):       ██████████
                   ████  ████
Shape A ████       ██████████    Shape B    ████
        ████  +    ██████████  =            ████
        ████       ████  ████               ████
                   ██████████`}</pre>

          <h3 style={S.subTitle}>Smooth Blending</h3>
          <p style={S.p}>
            SmoothMin blends two SDFs together with a smooth transition controlled by parameter <C>k</C>:
          </p>
          <CodeBlock>{`float smoothMin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}`}</CodeBlock>
          <pre style={S.code}>{`k = 0.0    k = 0.2    k = 0.5
██    ██   ██    ██   ██████████
██    ██   ████████   ██████████
██    ██   ██████████ ██████████
(sharp)    (smooth)   (heavy blend)`}</pre>
          <Tip>Wire <C>Time → Sin → k</C> to animate the blend amount and morph between sharp and blobby.</Tip>

          <h3 style={S.subTitle}>Rendering SDFs</h3>
          <ul style={S.ul}>
            <li style={S.li}><strong style={{ color: T.textBold }}>MakeLight</strong> — converts SDF distance to a glow intensity (<C>strength / max(|dist|, epsilon)</C>)</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>SDF Colorize</strong> — maps distance to a color gradient</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>SDF Outline</strong> — renders only the boundary edge of the SDF</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Glow Layer</strong> — additive glow with controllable falloff</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Blend Node</strong> — blend two colors using an SDF as a mask</li>
          </ul>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 5 — SOURCES & INPUTS
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec5Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Sources & Inputs</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>UV</h3>
          <p style={S.p}>
            The primary coordinate source. Outputs centered, aspect-corrected <TypeBadge type="vec2" />. Origin <C>(0,0)</C> at center, y spans <C>±0.5</C>, x is scaled by aspect ratio. Every shader starts here.
          </p>

          <h3 style={S.subTitle}>PixelUV</h3>
          <p style={S.p}>
            Raw pixel coordinates — <C>(0,0)</C> at bottom-left, <C>(width, height)</C> at top-right. Useful when you need integer pixel positions or exact resolution-dependent effects.
          </p>

          <h3 style={S.subTitle}>Time</h3>
          <p style={S.p}>
            Outputs elapsed seconds as a <TypeBadge type="float" />. Increments every frame. The foundation of all animation.
          </p>
          <CodeBlock>{`sin(time)              // smooth oscillation, period ~6.28s
cos(time * 0.5)        // slow oscillation
fract(time * 0.2)      // sawtooth ramp 0→1 repeating
mod(time, 4.0)         // 0→4 repeating ramp
time * 0.1             // slowly increasing value`}</CodeBlock>

          <h3 style={S.subTitle}>Mouse</h3>
          <p style={S.p}>
            Outputs the cursor position as <TypeBadge type="vec2" /> in the same coordinate space as UV. Great for interactive effects.
          </p>
          <p style={S.p}>Example: subtract Mouse from UV and feed into CircleSDF — the circle follows your cursor.</p>

          <h3 style={S.subTitle}>Constant</h3>
          <p style={S.p}>
            Outputs a fixed value — <TypeBadge type="float" />, <TypeBadge type="vec2" />, or <TypeBadge type="vec3" /> depending on configuration. Use for colors, offsets, or any static parameter.
          </p>

          <h3 style={S.subTitle}>Texture Input</h3>
          <p style={S.p}>
            Loads an image as a <TypeBadge type="vec3" /> color field. Sample it with UV coordinates to use photographs, patterns, or any bitmap in your shader.
          </p>

          <h3 style={S.subTitle}>Previous Frame</h3>
          <p style={S.p}>
            Samples the previous frame's output — enables feedback loops where the output feeds back into itself. Creates trails, blur, echo, and accumulation effects.
          </p>
          <Warn>Previous Frame requires enabling the Feedback toggle on the Output node. Without it, the node outputs black.</Warn>

          <h3 style={S.subTitle}>Loop Index</h3>
          <p style={S.p}>
            Inside a loop body, outputs the current iteration number as a <TypeBadge type="float" /> (<C>0.0, 1.0, 2.0...</C>). Used to vary behavior per iteration.
          </p>

          <h3 style={S.subTitle}>Audio Input</h3>
          <p style={S.p}>
            Analyzes microphone or audio input via FFT. Outputs multiple frequency bands as <TypeBadge type="float" /> values: <C>bass</C>, <C>mid</C>, <C>high</C>, <C>sub</C>, <C>presence</C>, <C>brilliance</C>, plus <C>volume</C> (overall level). Use these to drive any parameter for audio-reactive visuals.
          </p>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 6 — TRANSFORMS & SPACES
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec6Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Transforms & Spaces</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>Why Domain Transformation?</h3>
          <p style={S.p}>
            There are two ways to move a shape. Option A: change the shape's position parameter. Option B: subtract an offset from the UV before passing it to the shape. In shaders, Option B — <strong style={{ color: T.textBold }}>domain transformation</strong> — is the native approach. Instead of moving shapes through space, you warp space itself.
          </p>

          <h3 style={S.subTitle}>Transform Nodes</h3>
          <p style={S.p}><strong style={{ color: T.textBold }}>Fract</strong> — tiles space by repeating the 0→1 range:</p>
          <pre style={S.code}>{`Input:   0.0  0.5  1.0  1.5  2.0  2.5  3.0
Output:  0.0  0.5  0.0  0.5  0.0  0.5  0.0
         └──tile──┘└──tile──┘└──tile──┘`}</pre>

          <p style={S.p}><strong style={{ color: T.textBold }}>Rotate2D</strong> — rotates UV around the origin:</p>
          <CodeBlock>{`vec2 rotated = mat2(cos(a), -sin(a), sin(a), cos(a)) * uv;`}</CodeBlock>

          <p style={S.p}><strong style={{ color: T.textBold }}>UVWarp</strong> — displaces UV by a noise-derived offset. Connect a noise source to the warp input:</p>
          <NodeDiagram
            nodes={[
              { label: 'UV', type: 'source', outputs: ['uv: vec2'] },
              { label: 'FBM', type: 'effect', inputs: ['uv'], outputs: ['value: float'] },
              { label: 'UVWarp', type: 'transform', inputs: ['uv', 'warp'], outputs: ['warped: vec2'] },
              { label: 'CircleSDF', type: 'effect', inputs: ['uv'], outputs: ['dist'] },
            ]}
            caption="FBM noise warps the UV before the SDF sees it — the circle becomes organic."
          />

          <p style={S.p}><strong style={{ color: T.textBold }}>CurlWarp</strong> — divergence-free warp that creates smoke and liquid-like distortion. Unlike UVWarp, curl warps never compress or expand space — they only rotate it.</p>

          <p style={S.p}><strong style={{ color: T.textBold }}>SwirlWarp</strong> — twists UV around the origin with distance-dependent rotation.</p>
          <p style={S.p}><strong style={{ color: T.textBold }}>Displace</strong> — shifts UV along a direction by a float amount.</p>

          <h3 style={S.subTitle}>Space Nodes</h3>
          <p style={S.p}>Space nodes remap the entire coordinate system into a different geometry:</p>
          <ul style={S.ul}>
            <li style={S.li}><strong style={{ color: T.textBold }}>Polar Space</strong> — Cartesian to polar (<C>r, theta</C>). The twist parameter rotates the angle offset. Useful for radial patterns and spirals.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>LogPolar</strong> — logarithmic polar coordinates. Creates Escher-like infinite zoom effects where the center repeats infinitely.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Hyperbolic Space</strong> — Poincare disc model. Points near the edge get compressed, simulating hyperbolic geometry.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Inversion Space</strong> — circle inversion (<C>p/|p|^2</C>). Inside maps to outside and vice versa.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Mobius Space</strong> — Mobius transformation. Conformal mapping that preserves angles but warps distances.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Swirl Space</strong> — distance-dependent rotation of the entire coordinate plane.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Kaleido Space</strong> — N-sided kaleidoscope. Folds the plane into N symmetric wedges. Set sides to 6 for a mandala.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Spherical Space</strong> — projects UV onto a sphere surface.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Ripple Space</strong> — concentric wave distortion radiating from center.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Infinite Repeat Space</strong> — tiles the plane infinitely with configurable cell size.</li>
          </ul>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 7 — GROUPS
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec7Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Groups</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>Creating a Group</h3>
          <p style={S.p}>
            Select one or more nodes and press <C>Cmd+G</C>. The system auto-detects inputs and outputs from wires that cross the group boundary. Everything inside collapses into a single group node.
          </p>

          <h3 style={S.subTitle}>How Groups Work</h3>
          <p style={S.p}>
            Groups are compiled inline — no function call overhead, just inlined GLSL. Double-click a group to enter it and edit the internal nodes. Groups let you clean up, reuse, and iterate on sub-graphs.
          </p>

          <h3 style={S.subTitle}>Group Inputs and Outputs</h3>
          <pre style={S.code}>{`Before grouping:
  UV → [Rotate2D] → [FBM] → Palette

After Cmd+G on Rotate2D + FBM:
  UV → ┌─────────────────┐ → Palette
       │  Group           │
       │  ↳ Rotate2D      │
       │  ↳ FBM           │
       └─────────────────┘
       in: vec2    out: float`}</pre>

          <h3 style={S.subTitle}>The Iterations Parameter</h3>
          <p style={S.p}>
            Every group has an Iterations parameter (default 1). Set it to N and the group body runs N times, with each pass feeding into the next. This turns any sub-graph into a loop.
          </p>
          <p style={S.p}>
            Example: a UV Fold Loop. Inside the group: <C>Multiply(1.5) → Fract → Subtract(0.5)</C>. With 6 iterations, each pass scales, tiles, and re-centers — creating a fractal pattern.
          </p>
          <CodeBlock>{`// What each iteration does:
uv = fract(uv * 1.5) - 0.5;
// Iteration 1: tiles 1.5x, re-centers
// Iteration 2: tiles again on the tiled result
// ...
// Iteration 6: deep fractal structure`}</CodeBlock>

          <h3 style={S.subTitle}>Nesting Groups</h3>
          <p style={S.p}>
            Groups can contain other groups. This lets you build hierarchical compositions — a fractal group inside a color-processing group, for example.
          </p>

          <h3 style={S.subTitle}>Loop Carry (Stateful Groups)</h3>
          <p style={S.p}>
            For stateful iteration, groups support the Init/Next/Value pattern. The <strong style={{ color: T.textBold }}>Init</strong> value feeds the first iteration, each iteration transforms it via <strong style={{ color: T.textBold }}>Next</strong>, and the final <strong style={{ color: T.textBold }}>Value</strong> is the group output. Example: accumulating brightness across iterations by adding a glow contribution each pass.
          </p>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 8 — THE WIRED LOOP SYSTEM
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec8Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>The Wired Loop System</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>LoopStart / LoopEnd</h3>
          <p style={S.p}>
            The <strong style={{ color: T.textBold }}>Loop Start / Loop End</strong> pair lets you run any chain of nodes multiple times. Wire body nodes between them, set the iteration count on Loop Start, and choose a carry type (<C>vec2</C>, <C>vec3</C>, <C>float</C>, or <C>vec4</C>). The carry value flows through the body once per iteration.
          </p>

          <div style={{
            background: T.surface2,
            border: `1px solid ${T.border}`,
            borderRadius: '8px',
            padding: '16px 20px',
            marginBottom: '16px',
            fontFamily: 'monospace',
            fontSize: '12px',
            color: T.dim,
            lineHeight: 2,
          }}>
            <div style={{ color: T.dim2, fontSize: '10px', marginBottom: '8px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>How a loop runs</div>
            <div>
              <span style={{ color: T.green }}>initial value</span>
              <span style={{ color: T.dim2 }}> ──→ </span>
              <span style={{ color: T.blue, background: T.blue + '15', borderRadius: '4px', padding: '1px 8px' }}>Loop Start</span>
              <span style={{ color: T.dim2 }}> ──carry──→ </span>
              <span style={{ color: T.mauve, background: T.mauve + '15', borderRadius: '4px', padding: '1px 8px' }}>Body A</span>
              <span style={{ color: T.dim2 }}> ──→ </span>
              <span style={{ color: T.mauve, background: T.mauve + '15', borderRadius: '4px', padding: '1px 8px' }}>Body B</span>
              <span style={{ color: T.dim2 }}> ──carry──→ </span>
              <span style={{ color: T.blue, background: T.blue + '15', borderRadius: '4px', padding: '1px 8px' }}>Loop End</span>
              <span style={{ color: T.dim2 }}> ──→ </span>
              <span style={{ color: T.green }}>result</span>
            </div>
            <div style={{ marginTop: '6px', color: T.dim2, fontSize: '11px' }}>
              ↑ this entire body runs N times — the output of each pass feeds the next
            </div>
          </div>

          <h3 style={S.subTitle}>Wrap in Loop</h3>
          <p style={S.p}>
            Select any chain of nodes and press <C>Cmd+L</C>. This auto-inserts LoopStart before and LoopEnd after the selection, wiring everything up. The carry type is inferred from the first node's input.
          </p>

          <h3 style={S.subTitle}>Loop Step Nodes</h3>
          <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: '14px', fontSize: '12px' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>Node</th>
                <th style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>Shape</th>
                <th style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>Use</th>
              </tr>
            </thead>
            <tbody>
              {([
                ['LoopRippleStep', 'Radial displacement', 'Concentric waves'],
                ['LoopRotateStep', 'Rotates UV', 'Rotating ring patterns'],
                ['LoopDomainFold', 'abs fold', 'Kleinian fractals'],
                ['LoopFloatAccumulate', 'Sums float', 'Layered contributions'],
                ['LoopRingStep', 'Ring formation', 'N copies of SDF'],
                ['LoopColorRingStep', 'Ring of colored glows', 'Fractal ring colors'],
              ] as [string, string, string][]).map(([node, shape, use], i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${T.border}22` }}>
                  <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: T.green, fontSize: '11px' }}>{node}</td>
                  <td style={{ padding: '6px 10px', color: T.text }}>{shape}</td>
                  <td style={{ padding: '6px 10px', color: T.text }}>{use}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 style={S.subTitle}>Example: Building a Spiral</h3>
          <CodeBlock>{`UV → LoopStart(vec2, iter=8)
  → LoopRotateStep(angle: 0.4)
  → LoopRippleStep(strength: 0.1)
→ LoopEnd
→ CircleSDF → MakeLight → Output

// Each iteration rotates UV slightly and adds a radial ripple.
// After 8 passes, the UV is heavily spiraled — the CircleSDF
// renders as a mandala of concentric, rotated rings.`}</CodeBlock>

          <TryIt exampleKey="loopRippleWarp" label="Loop Spiral" onTry={tryExample} />
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 9 — NOISE
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec9Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Noise</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>FBM — Fractal Brownian Motion</h3>
          <p style={S.p}>
            FBM stacks multiple octaves of smooth noise at increasing frequencies. Each octave adds finer detail. The result is organic, cloud-like texture.
          </p>
          <CodeBlock>{`// FBM pseudocode:
float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int i = 0; i < octaves; i++) {
        value += amplitude * noise(p * frequency);
        frequency *= lacunarity;  // typically 2.0
        amplitude *= gain;        // typically 0.5
    }
    return value;
}`}</CodeBlock>
          <p style={S.p}>Parameters: <C>octaves</C> (detail layers, 4-6 typical), <C>scale</C> (base zoom), <C>lacunarity</C> (frequency multiplier per octave, 2.0 = each is 2x finer), <C>gain</C> (amplitude falloff, 0.5 = each is half as loud), <C>anim speed</C> (time-based animation rate).</p>

          <h3 style={S.subTitle}>Voronoi (Worley / Cell Noise)</h3>
          <pre style={S.code}>{`  ┌─────┬─────┬─────┐
  │  *  │     │ *   │
  │     │  *  │     │
  ├─────┼─────┼─────┤
  │     │     │     │
  │ *   │     │  *  │
  ├─────┼─────┼─────┤
  │     │  *  │     │
  │  *  │     │ *   │
  └─────┴─────┴─────┘
  * = cell center (seed point)
  Pixel color = distance to nearest *`}</pre>
          <p style={S.p}>
            Voronoi divides space into cells, each centered on a random point. The <C>jitter</C> parameter controls randomness: 0 = regular grid, 1 = fully random placement. Use cases: organic cells, cracked earth, stained glass, biological tissue.
          </p>

          <h3 style={S.subTitle}>Domain Warp</h3>
          <p style={S.p}>
            Feed noise output back as input to create turbulent patterns. The standard recipe is three passes:
          </p>
          <CodeBlock>{`p1 = p + FBM(p)           // first warp
p2 = p1 + FBM(p1)        // second warp
result = FBM(p2)          // final sample`}</CodeBlock>
          <p style={S.p}>Use cases: clouds, smoke, marble, organic textures that look nothing like raw noise.</p>

          <h3 style={S.subTitle}>Flow Field</h3>
          <p style={S.p}>
            Advects curves along a vector field derived from noise. Each curve follows the field direction, producing long streaming streaks. Parameters control curve count, step count (short = fur, long = rivers), and field mode.
          </p>

          <h3 style={S.subTitle}>Circle Pack</h3>
          <p style={S.p}>
            Pseudo-random circle packing — places non-overlapping circles with controllable size distribution. Use cases: bubbles, stippling, cellular patterns, polka dots.
          </p>

          <h3 style={S.subTitle}>Noise Float</h3>
          <p style={S.p}>
            Single-octave cheap noise. Faster than FBM when you just need simple randomness without multi-octave detail.
          </p>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 10 — COLOR
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec10Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Color</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>Palette</h3>
          <p style={S.p}>
            The IQ cosine palette maps any float to a smooth color using four vec3 parameters:
          </p>
          <CodeBlock>{`vec3 palette(float t) {
    return a + b * cos(6.28318 * (c * t + d));
}
// a = offset, b = amplitude, c = frequency, d = phase`}</CodeBlock>
          <Tip>Start with <C>a = b = vec3(0.5)</C> — this gives a full-range color cycle. Then adjust <C>c</C> and <C>d</C> to control which colors appear and where.</Tip>

          <h3 style={S.subTitle}>Palette Preset</h3>
          <p style={S.p}>
            Dropdown with 8 pre-configured palettes. Quick way to get good colors without tuning the four cosine parameters manually.
          </p>

          <h3 style={S.subTitle}>Gradient</h3>
          <p style={S.p}>
            Linear interpolation between two colors. Input <C>t</C> controls the blend: 0 = color A, 1 = color B.
          </p>

          <h3 style={S.subTitle}>HSV</h3>
          <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: '14px', fontSize: '12px' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>Component</th>
                <th style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>Range</th>
                <th style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>Meaning</th>
              </tr>
            </thead>
            <tbody>
              {([
                ['Hue', '0 → 1', 'Position on color wheel (0=red, 0.33=green, 0.66=blue)'],
                ['Saturation', '0 → 1', 'Gray → full color'],
                ['Value', '0 → 1', 'Black → full brightness'],
              ] as [string, string, string][]).map(([comp, range, meaning], i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${T.border}22` }}>
                  <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: T.green, fontSize: '11px' }}>{comp}</td>
                  <td style={{ padding: '6px 10px', color: T.text }}>{range}</td>
                  <td style={{ padding: '6px 10px', color: T.text }}>{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={S.p}>Wire <C>Time → Hue</C> for a continuously cycling color wheel effect.</p>

          <h3 style={S.subTitle}>Posterize</h3>
          <p style={S.p}>
            Quantizes color to N discrete steps, creating a cel-shaded / flat-color aesthetic. Lower N = more cartoon-like.
          </p>

          <h3 style={S.subTitle}>Invert</h3>
          <p style={S.p}>
            Computes <C>1.0 - color</C> for each channel. Swaps darks and lights.
          </p>

          <h3 style={S.subTitle}>Desaturate</h3>
          <p style={S.p}>
            Converts to grayscale using the luminance formula: <C>0.299*r + 0.587*g + 0.114*b</C>. The mix parameter blends between full color and grayscale.
          </p>

          <h3 style={S.subTitle}>Hue Range</h3>
          <p style={S.p}>
            Selective recoloring — shifts hues within a specified range while leaving other colors untouched. Useful for targeted color grading.
          </p>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 11 — MATH NODES
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec11Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Math Nodes</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>Arithmetic</h3>
          <p style={S.p}>
            <C>Add</C>, <C>Subtract</C>, <C>Multiply</C>, <C>Divide</C>, <C>Negate</C>, <C>Abs</C> — all work componentwise on any type. Multiply a color by a float to dim/brighten it. Add to a UV to translate a shape.
          </p>

          <h3 style={S.subTitle}>Trigonometry</h3>
          <p style={S.p}>
            <C>Sin</C> / <C>Cos</C> — period is 2pi. Connect Time to get smooth oscillation between -1 and 1. <C>Atan2</C> — returns the angle of a vec2, useful for polar conversions.
          </p>

          <h3 style={S.subTitle}>Exponents & Powers</h3>
          <p style={S.p}>
            <C>Pow</C> — raises to a power (use for gamma correction or shaping falloff curves). <C>Sqrt</C> — square root. <C>Exp</C> — natural exponential.
          </p>

          <h3 style={S.subTitle}>Range / Interpolation</h3>
          <ul style={S.ul}>
            <li style={S.li}><strong style={{ color: T.textBold }}>Mix</strong> — linear interpolation: <C>mix(a, b, t)</C>. t=0 returns a, t=1 returns b. The workhorse of blending.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Smoothstep</strong> — S-curve ramp: <C>smoothstep(edge0, edge1, x)</C>. Returns a smooth 0→1 transition. Essential for anti-aliased SDF edges.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Remap</strong> — remaps a value from one range to another.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Clamp</strong> — restricts a value to a min/max range.</li>
          </ul>

          <h3 style={S.subTitle}>Min / Max</h3>
          <p style={S.p}>
            <C>Min</C> / <C>Max</C> — component-wise minimum/maximum (note: different from SDF union/intersection which use these on distance values). Also: <C>Floor</C>, <C>Ceil</C>, <C>Round</C>, <C>Fract Raw</C> (fractional part), <C>Mod</C> (modulo).
          </p>

          <h3 style={S.subTitle}>Vectors</h3>
          <p style={S.p}>
            <C>Length</C> — magnitude of a vector. <C>Dot</C> — dot product. <C>Normalize</C> — unit vector. <C>MakeVec2</C> — combine two floats. <C>ExtractX</C> / <C>ExtractY</C> — split a vec2. <C>MakeVec3</C> / <C>FloatToVec3</C> — build vec3. <C>AddVec2</C> / <C>MultiplyVec2</C>, <C>AddVec3</C> / <C>MultiplyVec3</C> — typed vector arithmetic. <C>Tanh</C> — hyperbolic tangent (smooth clamping).
          </p>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 12 — ANIMATION
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec12Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Animation</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>LFO Nodes</h3>
          <p style={S.p}>
            Low-Frequency Oscillators generate repeating waveforms. All share the same parameters: Frequency, Amplitude, and Offset.
          </p>
          <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: '14px', fontSize: '12px' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>Node</th>
                <th style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>Shape</th>
                <th style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>Range</th>
                <th style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>Use</th>
              </tr>
            </thead>
            <tbody>
              {([
                ['SineLFO', 'Smooth sine wave', '-1 to 1', 'Organic motion, breathing'],
                ['SquareLFO', 'On/off toggle', '-1 or 1', 'Blinking, strobing'],
                ['SawtoothLFO', 'Linear ramp up', '-1 to 1', 'Scrolling, phase drives'],
                ['TriangleLFO', 'Linear up-down', '-1 to 1', 'Ping-pong motion'],
              ] as [string, string, string, string][]).map(([node, shape, range, use], i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${T.border}22` }}>
                  <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: T.green, fontSize: '11px' }}>{node}</td>
                  <td style={{ padding: '6px 10px', color: T.text }}>{shape}</td>
                  <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: T.text, fontSize: '11px' }}>{range}</td>
                  <td style={{ padding: '6px 10px', color: T.text }}>{use}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={S.p}>
            Example: breathing circle — <C>SineLFO → Remap(-1, 1 to 0.1, 0.4) → CircleSDF.radius</C>. The radius oscillates smoothly between 0.1 and 0.4.
          </p>

          <h3 style={S.subTitle}>BPM Sync</h3>
          <p style={S.p}>
            Locks animation to a musical tempo. Outputs a beat phase from 0→1 that resets each beat. Use beat divisions to sync to different note values: multiply by 1 for quarter notes, 0.5 for half notes, 4 for sixteenth notes.
          </p>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 13 — EFFECTS
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec13Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Effects</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>Grain</h3>
          <p style={S.p}>
            Three variants: <C>Grain</C> (static noise overlay), <C>LumaGrain</C> (noise scaled by luminance — more grain in darks), <C>TemporalGrain</C> (animated noise that changes every frame). All have an intensity parameter.
          </p>

          <h3 style={S.subTitle}>Tone Map</h3>
          <p style={S.p}>
            HDR compression using a Reinhard-style curve. Maps bright values into displayable range without clipping. Essential when combining multiple glow sources.
          </p>

          <h3 style={S.subTitle}>Chromatic Aberration</h3>
          <p style={S.p}>
            Splits UV into three offset copies — one per RGB channel. Creates rainbow fringing at edges, like light through a cheap lens. Parameters: strength (offset amount) and direction.
          </p>

          <h3 style={S.subTitle}>Gravitational Lens</h3>
          <p style={S.p}>
            Bends UV using an inverse-square-law displacement field. Pixels are attracted toward the lens center. Outputs <C>uv_lensed</C> (displaced coordinates) — wire this into any node's UV input to bend its output.
          </p>

          <h3 style={S.subTitle}>Float Warp</h3>
          <p style={S.p}>
            Directional UV displacement by a float value. Shifts pixels along a specified direction, controlled by a float input. Simpler than UVWarp when you only need one-axis displacement.
          </p>

          <h3 style={S.subTitle}>Expr Node</h3>
          <p style={S.p}>
            Inline GLSL expression with inputs <C>a</C>, <C>b</C>, <C>c</C>. Write any single-line GLSL expression using these inputs.
          </p>
          <CodeBlock>{`sin(a * 3.14159) * b + cos(c)`}</CodeBlock>

          <h3 style={S.subTitle}>Custom Function Node</h3>
          <p style={S.p}>
            Full GLSL function — declare inputs by name, specify the output type, and write a complete function body. For when Expr is too limited and you need multiple statements, local variables, or loops.
          </p>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 14 — FRACTALS & PHYSICS
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec14Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Fractals & Physics</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>Mandelbrot / Julia</h3>
          <p style={S.p}>
            The Mandelbrot node visualizes the iteration formula <C>{'z → z^k + c'}</C>, computing an escape count per pixel. Four modes: <strong style={{ color: T.textBold }}>Mandelbrot</strong> (c = UV, z starts at 0), <strong style={{ color: T.textBold }}>Julia</strong> (c = fixed param, z = UV), <strong style={{ color: T.textBold }}>Burning Ship</strong> (abs applied to real/imag), <strong style={{ color: T.textBold }}>Tricorn</strong> (conjugate of z).
          </p>
          <p style={S.p}>Outputs:</p>
          <ul style={S.ul}>
            <li style={S.li}><C>Color</C> — pre-colored fractal using smooth iteration count</li>
            <li style={S.li}><C>Smooth Iter</C> — continuous iteration count for custom coloring</li>
            <li style={S.li}><C>Distance SDF</C> — estimated distance to the fractal boundary</li>
            <li style={S.li}><C>Orbit Trap</C> — minimum distance to a trap shape during iteration</li>
          </ul>
          <p style={S.p}>
            Key params: <C>Power k</C> (exponent, 2 = classic, try 3-8 for multibrot), <C>Max Iterations</C> (detail level), <C>Zoom</C> (magnification).
          </p>
          <Tip>Wire <C>Mouse → c(Julia)</C> for interactive morphing — move your cursor to explore different Julia set shapes in real time.</Tip>

          <TryIt exampleKey="mandelbrotExplorer" label="Mandelbrot Explorer" onTry={tryExample} />

          <h3 style={S.subTitle}>IFS (Iterated Function Systems)</h3>
          <p style={S.p}>
            An IFS fractal is defined by a small set of affine transforms. The chaos game algorithm reveals the attractor: start a point at the origin, randomly pick a transform, apply it, and repeat. Where the point visits most frequently defines the fractal shape.
          </p>
          <p style={S.p}>
            Classic examples: Sierpinski triangle (3 contractions), Barnsley fern (4 transforms simulating leaf structure).
          </p>

          <h3 style={S.subTitle}>Chladni Patterns</h3>
          <p style={S.p}>
            Vibrational modes of a 2D plate. The formula uses integer mode numbers <C>m</C> and <C>n</C>:
          </p>
          <CodeBlock>{`// Chladni formula (m and n pick the mode):
cos(n*PI*x) * cos(m*PI*y) - cos(m*PI*x) * cos(n*PI*y) = 0

// Points near zero = nodal lines = where sand clusters
density = exp(-abs(chladni(x,y)) * sharpness)`}</CodeBlock>

          <h3 style={S.subTitle}>Chladni 3D / Particles</h3>
          <p style={S.p}>
            3D volumetric extension of Chladni patterns. Renders particle-based 3D vibrational modes with depth.
          </p>

          <h3 style={S.subTitle}>Electron Orbital</h3>
          <p style={S.p}>
            Visualizes hydrogen wavefunction probability density <C>|psi|^2</C> using quantum numbers: <C>n</C> (principal/shell), <C>l</C> (azimuthal/subshell), <C>m</C> (magnetic). Uses real spherical harmonics and associated Laguerre polynomials for the radial part.
          </p>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 15 — 3D / VOLUMETRIC
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec15Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>3D / Volumetric</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>How Raymarching Works</h3>
          <p style={S.p}>
            Raymarching is the primary 3D rendering technique in shader art. The algorithm: cast a ray from the camera, evaluate the SDF at the current position, step forward by the SDF distance (the minimum safe distance), and repeat until the ray hits a surface or exceeds the maximum distance.
          </p>
          <pre style={S.code}>{`       Camera
         \\
          \\   step 1 (large — far from surface)
           \\
            * ─ ─ step 2 (medium)
                   \\
                    * ─ step 3 (small — close!)
                       \\
                        * HIT ● Sphere surface

Key insight: the SDF value tells you exactly how far
you can safely step without missing any geometry.`}</pre>

          <h3 style={S.subTitle}>Raymarch 3D Node</h3>
          <p style={S.p}>
            A self-contained 3D scene renderer. Inputs: UV, Time, plus wirable params for scene configuration. Choose from multiple scene types, configure camera position and lighting (Phong shading + ambient occlusion).
          </p>
          <p style={S.p}>Outputs:</p>
          <ul style={S.ul}>
            <li style={S.li}><C>Color</C> — fully lit and shaded scene</li>
            <li style={S.li}><C>Depth</C> — distance from camera (use for fog or DOF effects)</li>
            <li style={S.li}><C>Normal</C> — surface normal as vec3 (wire into Palette for colored-by-normal)</li>
            <li style={S.li}><C>Occlusion</C> — ambient occlusion factor (wire into Multiply for AO shading)</li>
            <li style={S.li}><C>Fog Mask</C> — distance-based fog amount</li>
          </ul>
          <Tip>Wire <C>Normal → Palette</C> for a colored-by-normal effect. Wire <C>Occlusion → Multiply</C> with the color output for ambient occlusion shading.</Tip>

          <h3 style={S.subTitle}>Volume Clouds</h3>
          <p style={S.p}>
            Volumetric raymarching that accumulates opacity through a density field. Instead of finding a surface hit, it samples density at each step and composites front-to-back. Parameters: Coverage, Puffiness, Scale, Light Direction.
          </p>

          <h3 style={S.subTitle}>Orbital Volume 3D</h3>
          <p style={S.p}>
            Combines the electron orbital wavefunction formula with volumetric raymarching. Renders the full 3D <C>|psi_nlm|^2</C> probability density as a rotating, semi-transparent cloud. Camera auto-orbits around the atom.
          </p>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 16 — IMPORT / EXPORT
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec16Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Import / Export</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>Graph Files (.json)</h3>
          <p style={S.p}>
            Save your graph with <C>Cmd+S</C> and load with <C>Cmd+O</C>. Graphs are stored as JSON files containing all node positions, connections, and parameter values. Share .json files to exchange graphs.
          </p>

          <h3 style={S.subTitle}>GLSL Export</h3>
          <p style={S.p}>
            The generated GLSL is always visible in the Code Panel (toggle with <C>Cmd+\</C>). The shader is compatible with Shadertoy and requires these uniforms:
          </p>
          <CodeBlock>{`uniform vec2 u_resolution;  // viewport size in pixels
uniform float u_time;       // elapsed time in seconds
uniform vec2 u_mouse;       // mouse position (normalized)`}</CodeBlock>

          <h3 style={S.subTitle}>Video Recording</h3>
          <p style={S.p}>
            Press <C>Cmd+R</C> to start recording the shader preview. Available formats: H.264 (smallest, web-friendly), ProRes 422 HQ (lossless quality, large files), FFV1 (open-source lossless). Configure resolution, duration, and the FFmpeg encoder is used under the hood.
          </p>

          <h3 style={S.subTitle}>Popping Out the Preview</h3>
          <p style={S.p}>
            Detach the shader preview to a floating window. Useful for putting the preview on a second monitor, comparing two graphs side by side, or presenting full-screen.
          </p>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 17 — COMPLETE EXAMPLES
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec17Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Complete Examples</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>Example 1: Animated Mandala</h3>
          <p style={S.p}>
            Kaleidoscopic symmetry with fractal noise, colored by a palette and animated by Time.
          </p>
          <NodeDiagram
            nodes={[
              { label: 'UV', type: 'source', outputs: ['uv'] },
              { label: 'KaleidoSpace', type: 'transform', inputs: ['uv', 'sides: 6'], outputs: ['uv'] },
              { label: 'PolarSpace', type: 'transform', inputs: ['uv'], outputs: ['uv'] },
              { label: 'FBM', type: 'effect', inputs: ['uv'], outputs: ['value'] },
              { label: 'Palette', type: 'color', inputs: ['t'], outputs: ['color'] },
              { label: 'Output', type: 'output', inputs: ['color'] },
            ]}
            caption="Time drives the FBM animation speed and the KaleidoSpace angle offset."
          />
          <TryIt exampleKey="mandala" label="Animated Mandala" onTry={tryExample} />

          <h3 style={S.subTitle}>Example 2: Floating Orbs</h3>
          <p style={S.p}>
            Three CircleSDFs with time-animated positions, merged with SmoothMin(k=0.15), then rendered with MakeLight and colored by a Palette.
          </p>
          <NodeDiagram
            nodes={[
              { label: 'UV', type: 'source', outputs: ['uv'] },
              { label: 'CircleSDF\nx3', type: 'effect', inputs: ['animated positions'], outputs: ['dist x3'] },
              { label: 'SmoothMin\nk=0.15', type: 'effect', inputs: ['dist a', 'dist b'], outputs: ['merged'] },
              { label: 'MakeLight', type: 'effect', inputs: ['dist'], outputs: ['glow'] },
              { label: 'Palette', type: 'color', inputs: ['t'], outputs: ['color'] },
              { label: 'Output', type: 'output', inputs: ['color'] },
            ]}
            caption="Three orbs smoothly blend together as they drift past each other."
          />
          <TryIt exampleKey="orbs" label="Floating Orbs" onTry={tryExample} />

          <h3 style={S.subTitle}>Example 3: Fractal UV Fold</h3>
          <p style={S.p}>
            A Group with 6 iterations containing <C>Multiply(1.5) → Fract → Subtract(0.5)</C>. The folded UV is fed into a CircleSDF for a deep fractal pattern.
          </p>
          <NodeDiagram
            nodes={[
              { label: 'UV', type: 'source', outputs: ['uv'] },
              { label: 'Group\n6 iters', type: 'transform', inputs: ['uv'], outputs: ['folded uv'] },
              { label: 'CircleSDF', type: 'effect', inputs: ['uv'], outputs: ['dist'] },
              { label: 'MakeLight', type: 'effect', inputs: ['dist'], outputs: ['glow'] },
              { label: 'Palette', type: 'color', inputs: ['t'], outputs: ['color'] },
              { label: 'Output', type: 'output', inputs: ['color'] },
            ]}
            caption="Each iteration scales, tiles, and re-centers — 6 passes creates deep fractal structure."
          />
          <TryIt exampleKey="fractal-fold" label="Fractal UV Fold" onTry={tryExample} />

          <h3 style={S.subTitle}>Example 4: Audio-Reactive Visualizer</h3>
          <p style={S.p}>
            AudioInput drives multiple parameters: bass controls CircleSDF radius, mid drives MakeLight brightness, Time feeds PolarSpace and FBM for background texture, and high modulates the Palette phase offset.
          </p>
          <NodeDiagram
            nodes={[
              { label: 'AudioInput', type: 'source', outputs: ['bass', 'mid', 'high'] },
              { label: 'CircleSDF', type: 'effect', inputs: ['radius ← bass'], outputs: ['dist'] },
              { label: 'MakeLight', type: 'effect', inputs: ['dist', 'brightness ← mid'], outputs: ['glow'] },
              { label: 'Palette', type: 'color', inputs: ['t', 'phase ← high'], outputs: ['color'] },
              { label: 'Output', type: 'output', inputs: ['color'] },
            ]}
            caption="The shader pulses and shifts color in response to music."
          />
          <TryIt exampleKey="audio-reactive" label="Audio-Reactive Visualizer" onTry={tryExample} />
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            APPENDIX — NODE REFERENCE
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={secAppRef as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Node Reference</h2>
          <div style={S.divider} />

          <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: '14px', fontSize: '12px' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600, width: '140px' }}>Category</th>
                <th style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>Nodes</th>
              </tr>
            </thead>
            <tbody>
              {([
                ['Sources', 'UV, PixelUV, Time, Mouse, Constant, TextureInput, PrevFrame, LoopIndex, AudioInput'],
                ['Transforms', 'Fract, Rotate2D, UVWarp, SmoothWarp, CurlWarp, SwirlWarp, Displace'],
                ['Spaces', 'Polar, LogPolar, Hyperbolic, Inversion, Mobius, Swirl, Kaleido, Spherical, Ripple, InfiniteRepeat'],
                ['2D Primitives', 'CircleSDF, BoxSDF, RingSDF, ShapeSDF (30+ shapes)'],
                ['SDF Repeat', 'OpRepeat, OpRepeatPolar'],
                ['Combiners', 'SmoothMin, Min, Max, Subtract, SmoothMax, SmoothSubtract, Blend, Mask, AddColor, ScreenBlend, GlowLayer, SDFOutline, SDFColorize'],
                ['Effects', 'MakeLight, ToneMap, Grain, LumaGrain, TemporalGrain, ChromaticAberration, GravitationalLens, FloatWarp, Expr, CustomFn'],
                ['Loops (high-level)', 'FractalLoop, RotatingLinesLoop, AccumulateLoop, ForLoop'],
                ['Loops (wired pair)', 'LoopStart, LoopEnd, LoopCarry, LoopRippleStep, LoopRotateStep, LoopDomainFold, LoopFloatAccumulate, LoopRingStep, LoopColorRingStep'],
                ['Noise', 'FBM, Voronoi, DomainWarp, FlowField, CirclePack, NoiseFloat'],
                ['Fractals', 'Mandelbrot/Julia, IFS'],
                ['Physics', 'Chladni, Chladni3D, Chladni3DParticles, ElectronOrbital'],
                ['3D', 'Raymarch3D, VolumeClouds, OrbitalVolume3D'],
                ['Color', 'Palette, PalettePreset, Gradient, HSV, Posterize, Invert, Desaturate, HueRange'],
                ['Output', 'Output, Vec4Output'],
                ['Utility', 'Group, Scope'],
                ['Math', 'Add, Sub, Mul, Div, Sin, Cos, Exp, Pow, Negate, Length, Tanh, Min, Max, Clamp, Mix, Mod, Atan2, Ceil, Floor, Sqrt, Round, Dot, MakeVec2, ExtractX, ExtractY, MakeVec3, FloatToVec3, Fract, Smoothstep, AddVec2, MultiplyVec2, Remap'],
                ['Animation', 'SineLFO, SquareLFO, SawtoothLFO, TriangleLFO, BPMSync'],
              ] as [string, string][]).map(([cat, nodes], i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${T.border}22` }}>
                  <td style={{ padding: '6px 10px', color: T.blue, fontWeight: 600, fontSize: '11px', verticalAlign: 'top' }}>{cat}</td>
                  <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: T.green, fontSize: '11px', lineHeight: 1.7 }}>{nodes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 8 — NEW MATH NODES
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec8Ref as React.RefObject<HTMLDivElement>}>
          <h2 style={S.sectionTitle}>8 · New Math Nodes</h2>
          <div style={S.divider} />

          <p style={S.p}>
            These math nodes were added in V2 to cover common GLSL patterns that previously required an
            <C>Expr</C> node. Each one maps directly to a GLSL built-in or a small inline formula.
          </p>

          {/* CrossProduct & Reflect */}
          <h3 style={S.subTitle}>CrossProduct & Reflect</h3>
          <p style={S.p}>
            <strong style={{ color: T.textBold }}>CrossProduct</strong> takes two <TypeBadge type="vec3" /> inputs
            and outputs their cross product — a <TypeBadge type="vec3" /> perpendicular to both. Use it to compute
            surface normals from two tangent vectors, or to generate a rotation axis.
          </p>
          <p style={S.p}>
            <strong style={{ color: T.textBold }}>Reflect</strong> reflects a direction vector{' '}
            <C>I</C> around a surface normal <C>N</C>, computing <C>I − 2·dot(N,I)·N</C>. Both inputs and the
            output are <TypeBadge type="vec3" />. Classic use: reflect a ray direction off a plane normal for
            mirror-like effects.
          </p>

          <NodeDiagram
            nodes={[
              { label: 'ScenePos', type: 'source', outputs: ['p: vec3'] },
              { label: 'CrossProduct', type: 'transform', inputs: ['a: vec3', 'b: vec3'], outputs: ['out: vec3'] },
              { label: 'Normalize', type: 'transform', inputs: ['v: vec3'], outputs: ['n: vec3'] },
            ]}
            caption="Compute a normal from two edge vectors, then normalize — ready to feed into lighting."
          />

          {/* Complex Math */}
          <h3 style={S.subTitle}>Complex Math — ComplexMul & ComplexPow</h3>
          <p style={S.p}>
            Shader Studio represents complex numbers as <TypeBadge type="vec2" /> values where <C>.x</C> is the real
            part and <C>.y</C> is the imaginary part. These two nodes implement complex arithmetic directly:
          </p>
          <ul style={S.ul}>
            <li style={S.li}>
              <strong style={{ color: T.textBold }}>ComplexMul</strong> — multiply two complex numbers:
              <C>(a.x·b.x − a.y·b.y, a.x·b.y + a.y·b.x)</C>. Output is <TypeBadge type="vec2" />.
            </li>
            <li style={S.li}>
              <strong style={{ color: T.textBold }}>ComplexPow</strong> — raise a complex number to a real power
              using polar form: convert to <C>(r, θ)</C>, compute <C>(rⁿ, n·θ)</C>, convert back. Power is a{' '}
              <TypeBadge type="float" /> param. Great for Julia-set-style iteration without writing an Expr node.
            </li>
          </ul>

          <CodeBlock>{`// ComplexMul: z = a * b
vec2 complexMul(vec2 a, vec2 b) {
    return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x);
}

// ComplexPow: z = c ^ n  (via polar form)
float r     = length(c);
float theta = atan(c.y, c.x);
vec2  result = pow(r, n) * vec2(cos(n*theta), sin(n*theta));`}</CodeBlock>

          <Tip>
            Chain ComplexPow into ComplexMul (or vice-versa) to build custom fractal iteration.
            Wire UV directly into the input — <TypeBadge type="vec2" /> UV maps cleanly to the complex plane.
          </Tip>

          {/* Angle / Luminance / Sign / Step */}
          <h3 style={S.subTitle}>AngleToVec2, Vec2Angle, Luminance, Sign, Step</h3>
          <p style={S.p}>
            These are convenience nodes for patterns that come up constantly:
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
            {([
              ['AngleToVec2', 'float radians → vec2', 'Converts a radian angle to a unit direction vector: vec2(cos(θ), sin(θ)). Feed Time → Sin into it to get a direction that spins with time.'],
              ['Vec2Angle', 'vec2 → float radians', 'Returns atan2(v.y, v.x) — the angle of a 2D vector. Use on UV to get radial angle for spiral patterns.'],
              ['Luminance', 'vec3 → float', 'Computes perceptual brightness using BT.709 weights: 0.2126·R + 0.7152·G + 0.0722·B. Use to convert a color output to a grayscale mask.'],
              ['Sign', 'float → float', 'Returns −1.0 for negative, 0.0 for zero, +1.0 for positive. Useful for creating sharp sign-based patterns from SDF fields.'],
              ['Step', 'edge, x → float', 'step(edge, x) — returns 0 if x < edge, 1 otherwise. Sharp threshold. Chain with Smoothstep for a soft version, or use raw for hard outlines.'],
            ] as [string, string, string][]).map(([name, sig, desc]) => (
              <div key={name} style={{ background: T.surface2, borderRadius: '6px', padding: '10px 12px', border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: T.blue, marginBottom: '3px' }}>{name}</div>
                <code style={{ fontSize: '11px', color: T.green, fontFamily: 'monospace', display: 'block', marginBottom: '4px' }}>{sig}</code>
                <div style={{ fontSize: '11px', color: T.dim, lineHeight: 1.5 }}>{desc}</div>
              </div>
            ))}
          </div>

          <Tip>
            <strong>Vec2Angle → AngleToVec2</strong> is a round-trip: you can extract the angle of a
            UV position, add a Time-driven offset, then convert back to a direction to rotate flow or
            spiral sampling positions smoothly.
          </Tip>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 9 — NEW COLOR NODES
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec9Ref as React.RefObject<HTMLDivElement>}>
          <h2 style={S.sectionTitle}>9 · New Color Nodes</h2>
          <div style={S.divider} />

          {/* ColorRamp */}
          <h3 style={S.subTitle}>ColorRamp — Multi-Stop Gradient</h3>
          <p style={S.p}>
            <strong style={{ color: T.textBold }}>ColorRamp</strong> maps a <TypeBadge type="float" /> <C>t</C> value
            (0→1) through a multi-stop gradient with up to 8 color stops, evenly spaced along the ramp.
            You define each stop color directly in the node. The output is a <TypeBadge type="vec3" /> interpolated
            between the two nearest stops.
          </p>
          <p style={S.p}>
            The most natural drivers for <C>t</C> are <C>length(uv)</C> for radial gradients, or an FBM noise
            value for organic coloring. Connect the output of any node that produces a 0→1 float.
          </p>

          <NodeDiagram
            nodes={[
              { label: 'UV', type: 'source', outputs: ['uv: vec2'] },
              { label: 'FBM', type: 'effect', inputs: ['uv: vec2'], outputs: ['value: float'] },
              { label: 'ColorRamp', type: 'color', inputs: ['t: float'], outputs: ['color: vec3'] },
              { label: 'Output', type: 'output', inputs: ['color: vec3'] },
            ]}
            caption="FBM noise drives the ramp position — organic variation across the gradient stops."
          />

          <Tip>
            ColorRamp gives you more expressive gradients than Palette Preset when you need specific colors
            at specific positions. For smooth fire or aurora effects, set stops to deep red → orange → yellow → white.
          </Tip>

          {/* BlendModes */}
          <h3 style={S.subTitle}>BlendModes — Photoshop-Style Layer Compositing</h3>
          <p style={S.p}>
            <strong style={{ color: T.textBold }}>BlendModes</strong> takes a base color, a blend color, and a
            mode selector. Both colors are <TypeBadge type="vec3" />. It implements the standard Photoshop blend
            formulas exactly:
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '16px' }}>
            {([
              ['multiply', 'base * blend — darkens, like overlapping transparencies'],
              ['screen', '1 − (1−base)(1−blend) — brightens, like two projectors'],
              ['overlay', 'Multiply for darks, Screen for lights — high contrast'],
              ['soft light', 'Gentle version of overlay — subtle contrast boost'],
              ['hard light', 'Overlay with base/blend swapped — more aggressive'],
              ['difference', 'abs(base − blend) — inverts where they differ, black where equal'],
              ['exclusion', 'Softer version of difference — lower contrast subtraction'],
              ['dodge', 'base / (1 − blend) — extreme brightening in highlights'],
              ['burn', '1 − (1 − base) / blend — extreme darkening in shadows'],
              ['lighten', 'max(base, blend) — keeps the lighter pixel'],
              ['darken', 'min(base, blend) — keeps the darker pixel'],
            ] as [string, string][]).map(([mode, desc]) => (
              <div key={mode} style={{ background: T.surface2, borderRadius: '5px', padding: '7px 10px', border: `1px solid ${T.border}` }}>
                <code style={{ fontSize: '11px', color: T.mauve, fontFamily: 'monospace', display: 'block', marginBottom: '3px' }}>{mode}</code>
                <div style={{ fontSize: '10px', color: T.dim, lineHeight: 1.4 }}>{desc}</div>
              </div>
            ))}
          </div>

          <Tip>
            <strong>Overlay</strong> is the most versatile — it simultaneously adds contrast to both darks and
            lights. Try blending an FBM noise layer over your main color output in overlay mode to add
            instant texture and depth.
          </Tip>

          {/* BrightnessContrast */}
          <h3 style={S.subTitle}>BrightnessContrast</h3>
          <p style={S.p}>
            <strong style={{ color: T.textBold }}>BrightnessContrast</strong> takes a <TypeBadge type="vec3" /> color
            and applies a brightness offset and contrast multiplier. Brightness shifts all channels up or down.
            Contrast is applied around the midpoint (0.5) — values above 1.0 increase contrast, below 1.0 flatten it.
            Use it as a final grade node before Output to polish any result.
          </p>

          {/* Blackbody */}
          <h3 style={S.subTitle}>Blackbody — Temperature to RGB</h3>
          <p style={S.p}>
            <strong style={{ color: T.textBold }}>Blackbody</strong> converts a color temperature in Kelvin
            (1000–12000K) to a physically-based RGB color using a polynomial fit to the Planckian locus.
            Feed a <TypeBadge type="float" /> temperature value to get a <TypeBadge type="vec3" /> color output.
          </p>

          <div style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: '8px', padding: '14px 18px', marginBottom: '14px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: T.blue, marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Temperature reference</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
              {([
                ['1000 K', 'Deep red — glowing embers, very hot metal'],
                ['2000 K', 'Orange-red — candle flame, incandescent bulb'],
                ['3000 K', 'Warm white — tungsten lamp, firelight'],
                ['5500 K', 'Neutral white — sunlight at noon'],
                ['6500 K', 'Daylight white — overcast sky, monitor calibration'],
                ['12000 K', 'Blue-white — clear sky, arc lamp, blue giant star'],
              ] as [string, string][]).map(([temp, desc]) => (
                <div key={temp} style={{ background: T.surface, borderRadius: '5px', padding: '7px 10px' }}>
                  <code style={{ fontSize: '11px', color: T.green, fontFamily: 'monospace', display: 'block', marginBottom: '3px' }}>{temp}</code>
                  <div style={{ fontSize: '10px', color: T.dim, lineHeight: 1.4 }}>{desc}</div>
                </div>
              ))}
            </div>
          </div>

          <p style={S.p}>
            Blackbody is especially useful for fire, sun, and star effects. Drive the temperature with an FBM
            noise value scaled into the 1000–6500K range — hotter at the core, cooler at the edges — for
            realistic flames or plasma:
          </p>

          <CodeBlock>{`// Wire FBM (0→1) into temperature:
temperature = 1000.0 + fbm_value * 5500.0
// Core of fire = high fbm → 6500K = warm white
// Edges of fire = low fbm  → 1000K = deep red`}</CodeBlock>

          <NodeDiagram
            nodes={[
              { label: 'UV', type: 'source', outputs: ['uv: vec2'] },
              { label: 'FBM', type: 'effect', inputs: ['uv: vec2'], outputs: ['value: float'] },
              { label: 'Multiply\n×5500', type: 'transform', outputs: ['scaled: float'] },
              { label: 'Add\n+1000', type: 'transform', outputs: ['temp K: float'] },
              { label: 'Blackbody', type: 'color', inputs: ['kelvin: float'], outputs: ['color: vec3'] },
              { label: 'Output', type: 'output', inputs: ['color: vec3'] },
            ]}
            caption="FBM noise scaled to 1000–6500K drives the blackbody temperature — organic fire coloring."
          />
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 10 — NEW SPACE / TEXTURE NODES
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec10Ref as React.RefObject<HTMLDivElement>}>
          <h2 style={S.sectionTitle}>10 · New Space & Texture Nodes</h2>
          <div style={S.divider} />

          {/* WaveTexture */}
          <h3 style={S.subTitle}>WaveTexture</h3>
          <p style={S.p}>
            <strong style={{ color: T.textBold }}>WaveTexture</strong> generates a procedural wave or band pattern
            from UV coordinates. It outputs a <TypeBadge type="float" /> value you can drive into a palette
            or use as a mask. Five band types:
          </p>
          <ul style={S.ul}>
            <li style={S.li}><C>bands</C> — concentric rings driven by <C>length(uv)</C></li>
            <li style={S.li}><C>rings</C> — same as bands but with a sharpness parameter for harder edges</li>
            <li style={S.li}><C>x</C> — horizontal stripes along the x-axis</li>
            <li style={S.li}><C>y</C> — vertical stripes along the y-axis</li>
            <li style={S.li}><C>diagonal</C> — stripes at 45°</li>
          </ul>
          <p style={S.p}>
            The <strong style={{ color: T.textBold }}>distortion</strong> parameter adds FBM turbulence to the
            wave pattern before sampling — great for wavy, hand-drawn stripes or disturbed rings.
          </p>

          <NodeDiagram
            nodes={[
              { label: 'UV', type: 'source', outputs: ['uv: vec2'] },
              { label: 'Time', type: 'source', outputs: ['time: float'] },
              { label: 'WaveTexture\nbands mode', type: 'transform', inputs: ['uv: vec2', 'time: float'], outputs: ['value: float'] },
              { label: 'ColorRamp', type: 'color', inputs: ['t: float'], outputs: ['color: vec3'] },
              { label: 'Output', type: 'output', inputs: ['color: vec3'] },
            ]}
            caption="Animated concentric rings with custom coloring via ColorRamp."
          />

          {/* MagicTexture */}
          <h3 style={S.subTitle}>MagicTexture</h3>
          <p style={S.p}>
            <strong style={{ color: T.textBold }}>MagicTexture</strong> generates a psychedelic multicolored
            interference pattern from UV — inspired by Blender's Magic Texture node. It internally applies
            multiple sine waves at different scales and rotations to each UV axis, then maps to RGB.
            The <strong style={{ color: T.textBold }}>depth</strong> parameter controls how many nested sine
            iterations are applied — higher depth gives more complex, fractal-like interference. Outputs a
            <TypeBadge type="vec3" /> color directly; no palette needed.
          </p>

          <Tip>
            MagicTexture responds well to UV distortion upstream — feed the UV through a Shear or Domain Warp
            node first to break the pattern's symmetry and make it feel more organic.
          </Tip>

          {/* Grid */}
          <h3 style={S.subTitle}>Grid — Four Outputs for Tiling Effects</h3>
          <p style={S.p}>
            <strong style={{ color: T.textBold }}>Grid</strong> takes a UV input and a scale parameter, and
            divides the space into a regular grid of cells. It produces four distinct outputs, each useful
            for different tiling techniques:
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
            {([
              ['grid (float)', 'Bright at cell edges, 0 in the interior — the grid lines themselves. Use to render a visible grid or as a mask to highlight boundaries.'],
              ['checker (float)', 'Alternating 0/1 per cell in a checkerboard pattern. Multiply by any color to get a checker-tinted result, or use as a hard mask.'],
              ['cell UV (vec2)', 'Local position within the current cell, re-centered at (0,0). Useful for running SDFs or patterns relative to each cell center independently.'],
              ['cell ID (vec2)', 'Integer cell coordinates (e.g. (3.0, 7.0)) identifying which cell the pixel is in. Feed into a hash function for per-cell random colors or offsets.'],
            ] as [string, string][]).map(([out, desc]) => (
              <div key={out} style={{ background: T.surface2, borderRadius: '6px', padding: '10px 12px', border: `1px solid ${T.border}` }}>
                <code style={{ fontSize: '11px', color: T.green, fontFamily: 'monospace', display: 'block', marginBottom: '4px' }}>{out}</code>
                <div style={{ fontSize: '11px', color: T.dim, lineHeight: 1.5 }}>{desc}</div>
              </div>
            ))}
          </div>

          <p style={S.p}>
            A typical tiling workflow: use <C>cell UV</C> to run a CircleSDF relative to each cell center
            (one circle per cell), then use <C>cell ID</C> fed through a hash to vary the circle radius or
            color per cell:
          </p>

          <NodeDiagram
            nodes={[
              { label: 'UV', type: 'source', outputs: ['uv: vec2'] },
              { label: 'Grid', type: 'transform', inputs: ['uv: vec2'], outputs: ['cell UV: vec2', 'cell ID: vec2', 'checker: float', 'grid: float'] },
              { label: 'CircleSDF', type: 'effect', inputs: ['uv: vec2 (cell UV)'], outputs: ['dist: float'] },
              { label: 'MakeLight', type: 'effect', inputs: ['dist: float'], outputs: ['glow: float'] },
              { label: 'Output', type: 'output', inputs: ['color: vec3'] },
            ]}
            caption="Cell UV centers each SDF within its own tile — Grid divides, SDF draws per-cell."
          />

          {/* Shear */}
          <h3 style={S.subTitle}>Shear</h3>
          <p style={S.p}>
            <strong style={{ color: T.textBold }}>Shear</strong> skews UV space along one axis proportionally
            to the other axis: <C>uv.x += shear_x * uv.y</C> and <C>uv.y += shear_y * uv.x</C>.
            The output is a distorted <TypeBadge type="vec2" /> to wire into any downstream UV input.
            Use it to lean stripes at an angle, slant shapes, or create a parallelogram tiling from a
            Grid node. At small values it acts like a subtle skew; at large values it creates dramatic
            diagonal distortion.
          </p>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 11 — NEW EFFECT NODES
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec11Ref as React.RefObject<HTMLDivElement>}>
          <h2 style={S.sectionTitle}>11 · New Effect Nodes</h2>
          <div style={S.divider} />

          {/* Vignette */}
          <h3 style={S.subTitle}>Vignette</h3>
          <p style={S.p}>
            <strong style={{ color: T.textBold }}>Vignette</strong> applies a smooth edge darkening — the
            classic photographic vignette. It takes a UV input and outputs a <TypeBadge type="float" /> mask
            (1.0 at center, 0.0 at edges) computed via <C>smoothstep</C>.
          </p>
          <Warn>
            Vignette's UV input expects <strong>0–1 range coordinates</strong>. Use a{' '}
            <strong>PixelUV</strong> node (not the standard <strong>UV</strong> node) to get the correct
            range. The standard UV outputs −1 to 1 centered; PixelUV outputs 0 to 1 from bottom-left.
          </Warn>
          <p style={S.p}>
            Wire the float output into a <strong>MultiplyVec3</strong> to dim your final color toward the
            edges, or use it as a <strong>Mix</strong> weight to blend in a dark color at the border:
          </p>

          <NodeDiagram
            nodes={[
              { label: 'PixelUV', type: 'source', outputs: ['uv: vec2 (0–1)'] },
              { label: 'Vignette', type: 'effect', inputs: ['uv: vec2'], outputs: ['mask: float'] },
              { label: 'MultiplyVec3', type: 'color', inputs: ['color: vec3', 'scale: float'], outputs: ['result: vec3'] },
              { label: 'Output', type: 'output', inputs: ['color: vec3'] },
            ]}
            caption="PixelUV is essential here — the vignette mask is computed in 0–1 space."
          />

          {/* Scanlines */}
          <h3 style={S.subTitle}>Scanlines</h3>
          <p style={S.p}>
            <strong style={{ color: T.textBold }}>Scanlines</strong> overlays horizontal CRT scan lines on
            your image. It darkens every other row of pixels slightly, replicating the look of old TV displays
            or retro monitors. The <strong style={{ color: T.textBold }}>scroll speed</strong> parameter
            animates the lines slowly downward over time (wire <strong>Time</strong> into the time input).
            Set scroll speed to 0 for a static pattern.
          </p>
          <Warn>
            Like Vignette, Scanlines expects a <strong>PixelUV</strong> (0–1) UV input, not the standard
            centered UV. The line spacing is calculated in pixel-space rows.
          </Warn>
          <p style={S.p}>
            Scanlines outputs a <TypeBadge type="float" /> multiplier (near 1.0 for bright rows, near 0.85
            for dark rows). Multiply it by your color to apply the effect:
          </p>

          <NodeDiagram
            nodes={[
              { label: 'PixelUV', type: 'source', outputs: ['uv: vec2 (0–1)'] },
              { label: 'Time', type: 'source', outputs: ['time: float'] },
              { label: 'Scanlines', type: 'effect', inputs: ['uv: vec2', 'time: float'], outputs: ['mask: float'] },
              { label: 'MultiplyVec3', type: 'color', inputs: ['color: vec3', 'scale: float'], outputs: ['result: vec3'] },
              { label: 'Output', type: 'output', inputs: ['color: vec3'] },
            ]}
            caption="Animated CRT scanlines — combine with Vignette for a full retro CRT post-process."
          />

          <Tip>
            Stack Vignette and Scanlines together as a finishing chain on top of any other effect:
            main color → MultiplyVec3 (×scanlines mask) → MultiplyVec3 (×vignette mask) → Output.
            Both use PixelUV, so they share a single PixelUV node.
          </Tip>

          {/* Sobel */}
          <h3 style={S.subTitle}>Sobel Edge Detection</h3>
          <p style={S.p}>
            <strong style={{ color: T.textBold }}>Sobel</strong> detects edges in your image by computing the
            image gradient at each pixel using <C>dFdx</C> and <C>dFdy</C> — the screen-space partial
            derivatives available in fragment shaders. It produces two outputs:
          </p>
          <ul style={S.ul}>
            <li style={S.li}>
              <strong style={{ color: T.textBold }}>edge strength</strong> (<TypeBadge type="float" />) — 0 in
              flat regions, bright at edges. Use to threshold or glow-detect boundaries.
            </li>
            <li style={S.li}>
              <strong style={{ color: T.textBold }}>edge color</strong> (<TypeBadge type="vec3" />) — the
              gradient direction mapped to color space — useful for normal-map-like visualizations or artistic
              colored-edge effects.
            </li>
          </ul>

          <NodeDiagram
            nodes={[
              { label: 'UV', type: 'source', outputs: ['uv: vec2'] },
              { label: 'FBM', type: 'effect', inputs: ['uv: vec2'], outputs: ['value: float'] },
              { label: 'Sobel', type: 'effect', inputs: ['value: float'], outputs: ['strength: float', 'edge color: vec3'] },
              { label: 'Output', type: 'output', inputs: ['color: vec3'] },
            ]}
            caption="Sobel on FBM noise isolates ridges and valleys as bright edges — a sketch or toon-shading effect."
          />

          <Tip>
            Wire Sobel's <C>edge strength</C> into a <strong>MakeLight</strong> to glow the detected edges,
            or multiply it by a palette color to tint only the outlines. This is a quick way to get a
            cel-shaded look from any procedural pattern.
          </Tip>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 12 — 3D PRIMITIVES & TRANSFORMS
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec12Ref as React.RefObject<HTMLDivElement>}>
          <h2 style={S.sectionTitle}>12 · 3D SDF Primitives & Transforms</h2>
          <div style={S.divider} />

          <p style={S.p}>
            The 3D Primitives and 3D Transforms categories give you the building blocks for constructing
            3D scenes that feed into the <strong style={{ color: T.textBold }}>Scene System</strong>
            (see Section 13). Each primitive takes a <TypeBadge type="vec3" /> position and outputs a
            <TypeBadge type="float" /> signed distance. Transforms reshape the position space before
            it reaches the primitive — chain them in sequence.
          </p>

          {/* SDF Primitives */}
          <h3 style={S.subTitle}>3D SDF Primitives</h3>
          <p style={S.p}>
            All primitives live under <strong style={{ color: T.textBold }}>3D Primitives</strong> in the node
            palette. Each one takes a <C>Position: vec3</C> input and outputs a <C>Distance: float</C>.
            Inside a Scene Group, wire <strong>ScenePos</strong> (optionally through transforms) into the
            Position input.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
            {([
              ['SphereSDF3D', 'pos, radius', 'length(pos) − radius. The simplest SDF.'],
              ['BoxSDF3D', 'pos, size (vec3)', 'IQ box formula — axis-aligned rounded box. Size controls x/y/z half-extents.'],
              ['TorusSDF3D', 'pos, major_r, minor_r', 'A donut. Major_r = ring radius from center, minor_r = tube thickness.'],
              ['CapsuleSDF3D', 'pos, height, radius', 'Pill shape — a capped cylinder. Height sets the length of the straight section.'],
              ['CylinderSDF3D', 'pos, height, radius', 'Infinite cylinder capped at ±height. Exact IQ formula.'],
              ['ConeSDF3D', 'pos, angle, height', 'Cone with apex at origin. Angle in radians, height caps the tip.'],
              ['OctahedronSDF3D', 'pos, size', 'Eight-faced diamond. size controls the vertex distance from origin.'],
            ] as [string, string, string][]).map(([name, params, desc]) => (
              <div key={name} style={{ background: T.surface2, borderRadius: '6px', padding: '10px 12px', border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: T.peach, marginBottom: '3px' }}>{name}</div>
                <code style={{ fontSize: '10px', color: T.green, fontFamily: 'monospace', display: 'block', marginBottom: '4px' }}>{params}</code>
                <div style={{ fontSize: '11px', color: T.dim, lineHeight: 1.5 }}>{desc}</div>
              </div>
            ))}
          </div>

          {/* 3D Transforms */}
          <h3 style={S.subTitle}>3D Transforms</h3>
          <p style={S.p}>
            Transform nodes take <TypeBadge type="vec3" /> in and output <TypeBadge type="vec3" />. Place
            them between <strong>ScenePos</strong> and a primitive to shape the space the SDF sees. Chain
            multiple transforms for compound effects — the order matters.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
            {([
              ['Translate3D', 'offset: vec3', 'Shift the position — moves the primitive in world space.'],
              ['Rotate3D', 'axis: X/Y/Z, angle: float', 'Rotate around the chosen axis by angle radians. Chain two for arbitrary 3D rotation.'],
              ['Repeat3D', 'period: vec3', 'Infinite domain repetition: mod(pos, period) − period*0.5. Tiles the SDF infinitely in all three axes.'],
              ['Twist3D', 'k: float', 'Twists position around the Y-axis: angle = k*pos.y, then rotate x/z. Higher k = tighter twist.'],
              ['Fold3D', 'axes: bvec3', 'Applies abs() per chosen axis — mirror-folds the space. Good for symmetrical shapes without duplicating primitives.'],
            ] as [string, string, string][]).map(([name, params, desc]) => (
              <div key={name} style={{ background: T.surface2, borderRadius: '6px', padding: '10px 12px', border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: T.blue, marginBottom: '3px' }}>{name}</div>
                <code style={{ fontSize: '10px', color: T.green, fontFamily: 'monospace', display: 'block', marginBottom: '4px' }}>{params}</code>
                <div style={{ fontSize: '11px', color: T.dim, lineHeight: 1.5 }}>{desc}</div>
              </div>
            ))}
          </div>

          <p style={S.p}>
            A few powerful combinations to try:
          </p>
          <ul style={S.ul}>
            <li style={S.li}>
              <strong style={{ color: T.textBold }}>Repeat3D → BoxSDF3D</strong> — infinite grid of boxes
              with a single node pair. Adjust period to control spacing.
            </li>
            <li style={S.li}>
              <strong style={{ color: T.textBold }}>Fold3D → SphereSDF3D</strong> — fold space on all three
              axes before the sphere SDF to get an 8-way symmetric cluster of spheres from one primitive.
            </li>
            <li style={S.li}>
              <strong style={{ color: T.textBold }}>Twist3D → CylinderSDF3D</strong> — twisted column.
              Animate the twist angle with Time for a continuously rotating helix effect.
            </li>
            <li style={S.li}>
              <strong style={{ color: T.textBold }}>Rotate3D (Y) → Rotate3D (X) → TorusSDF3D</strong> — rotate
              the torus into any orientation. Two rotate nodes cover arbitrary rotation since each handles one axis.
            </li>
          </ul>

          <NodeDiagram
            nodes={[
              { label: 'ScenePos', type: 'source', outputs: ['p: vec3'] },
              { label: 'Repeat3D\nperiod=2', type: 'transform', inputs: ['p: vec3'], outputs: ['p: vec3'] },
              { label: 'Twist3D\nk=0.4', type: 'transform', inputs: ['p: vec3'], outputs: ['p: vec3'] },
              { label: 'BoxSDF3D\nsize=0.4', type: 'effect', inputs: ['pos: vec3'], outputs: ['dist: float'] },
            ]}
            caption="Infinite twisted boxes — Repeat tiles the field, Twist bends each copy, Box evaluates the SDF."
          />

          <Tip>
            Transforms in 3D SDF work on the <em>position space</em>, not the shape itself. Think of each
            transform as "what does the SDF see" rather than "how does the shape move." Translate moves
            the SDF origin; Rotate spins the coordinate system that the SDF samples from.
          </Tip>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 13 — 3D SCENE SYSTEM
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec13Ref as React.RefObject<HTMLDivElement>}>
          <h2 style={S.sectionTitle}>13 · 3D Scene System</h2>
          <div style={S.divider} />

          <p style={S.p}>
            The 3D Scene system in V2 is the full ray marching pipeline. It compiles your node subgraph
            into a GLSL <C>mapScene</C> function, then uses a sphere tracer to render it with camera,
            lighting, and fog — all from within the node graph.
          </p>

          {/* ScenePos & SceneGroup */}
          <h3 style={S.subTitle}>ScenePos & SceneGroup</h3>
          <p style={S.p}>
            <strong style={{ color: T.textBold }}>SceneGroup</strong> is the container for your 3D scene
            subgraph. Think of it as the 3D equivalent of the Loop Start/End pair — it defines a scope that
            the compiler treats specially. Inside it, you build the distance function for your scene.
          </p>
          <p style={S.p}>
            <strong style={{ color: T.textBold }}>ScenePos</strong> is only valid inside a SceneGroup. It
            outputs the current ray march sample position <C>p</C> as a <TypeBadge type="vec3" /> — this is
            the point in 3D space that the tracer is currently testing. Wire it through any chain of 3D
            Transforms, then into an SDF Primitive. The final distance float becomes the SceneGroup's output.
          </p>

          <div style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: '8px', padding: '14px 18px', marginBottom: '14px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: T.blue, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>How SceneGroup compiles</div>
            <p style={{ ...S.p, marginBottom: '6px' }}>
              When you press play, the compiler walks the nodes connected inside SceneGroup and emits:
            </p>
            <CodeBlock>{`float mapScene_<id>(vec3 p) {
    // your transform nodes become inline GLSL here
    vec3 p1 = p - translate_offset;      // Translate3D
    vec3 p2 = repeatDomain(p1, period);  // Repeat3D
    return sdBox(p2, half_extents);       // BoxSDF3D
}`}</CodeBlock>
            <p style={{ ...S.p, fontSize: '11px', color: T.dim, marginBottom: 0 }}>
              This function is then called by the ray marcher on every step of every ray.
            </p>
          </div>

          <Tip>
            Set the <strong>output port</strong> on SceneGroup to the final distance float. If multiple SDF
            primitives are in the subgraph, combine them with a <strong>Min</strong> node (union) or
            a <strong>Max</strong> node (intersection) before connecting to the output.
          </Tip>

          {/* RayRender */}
          <h3 style={S.subTitle}>RayRender</h3>
          <p style={S.p}>
            <strong style={{ color: T.textBold }}>RayRender</strong> is the full sphere tracer. It takes three
            inputs and produces three outputs:
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
            {([
              ['scene3d (input)', 'scene3d wire', 'Connect the output port of a SceneGroup here.'],
              ['UV (input)', 'vec2', 'Standard UV node — defines the ray direction per pixel.'],
              ['Time (input)', 'float', 'Drives camera orbit and any animated transforms inside the scene.'],
              ['color (output)', 'vec3', 'Fully shaded RGB result — wire to Output.'],
              ['depth (output)', 'float', 'Normalized ray hit distance. Use for depth-based effects or fog overrides.'],
              ['normal (output)', 'vec3', 'Surface normal at the hit point, in world space. Use for custom shading or normal maps.'],
            ] as [string, string, string][]).map(([port, type, desc]) => (
              <div key={port} style={{ background: T.surface2, borderRadius: '6px', padding: '10px 12px', border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: T.mauve, marginBottom: '3px' }}>{port}</div>
                <code style={{ fontSize: '10px', color: T.yellow, fontFamily: 'monospace', display: 'block', marginBottom: '4px' }}>{type}</code>
                <div style={{ fontSize: '11px', color: T.dim, lineHeight: 1.5 }}>{desc}</div>
              </div>
            ))}
          </div>

          <p style={S.p}>
            RayRender has configurable parameters for the built-in camera and lighting:
          </p>
          <ul style={S.ul}>
            <li style={S.li}><strong style={{ color: T.textBold }}>Camera orbit</strong> — radius, elevation, and azimuth speed. The camera circles the origin over time.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Key light</strong> — direction and color of the primary directional light.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Ambient</strong> — fill light intensity, prevents pure black in unlit regions.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Fog</strong> — exponential distance fog, color and density params.</li>
          </ul>

          {/* Full Pipeline */}
          <h3 style={S.subTitle}>Full 3D Pipeline — Step by Step</h3>
          <p style={S.p}>
            Here is the complete wiring for a minimal 3D scene with a sphere and a torus:
          </p>

          <StepBuilder steps={[
            {
              title: 'Add a SceneGroup',
              description: 'Add a SceneGroup from the 3D Scene category. It appears as a container node. This is where your SDF subgraph lives.',
              nodes: [
                { label: 'SceneGroup', type: 'effect', outputs: ['scene3d'] },
              ],
            },
            {
              title: 'Inside SceneGroup: ScenePos → SDF',
              description: <>Add <strong>ScenePos</strong> inside the SceneGroup. Connect it to a <strong>SphereSDF3D</strong> (radius = 0.5). Connect the distance float to the SceneGroup output port.</>,
              nodes: [
                { label: 'ScenePos', type: 'source', outputs: ['p: vec3'] },
                { label: 'SphereSDF3D\nradius=0.5', type: 'effect', inputs: ['pos: vec3'], outputs: ['dist: float'] },
              ],
            },
            {
              title: 'Add transforms between ScenePos and SDF',
              description: <>Insert a <strong>Translate3D</strong> to move the sphere. Or add <strong>Repeat3D</strong> for an infinite field of spheres. The distance float at the end of the chain goes to the output port.</>,
              nodes: [
                { label: 'ScenePos', type: 'source', outputs: ['p: vec3'] },
                { label: 'Translate3D\noffset=(0,0,0)', type: 'transform', inputs: ['p: vec3'], outputs: ['p: vec3'] },
                { label: 'SphereSDF3D', type: 'effect', inputs: ['pos: vec3'], outputs: ['dist: float'] },
              ],
            },
            {
              title: 'Add RayRender',
              description: <>Outside the SceneGroup, add a <strong>RayRender</strong> node. Connect <strong>SceneGroup → scene3d</strong>, <strong>UV → uv</strong>, and <strong>Time → time</strong>.</>,
              nodes: [
                { label: 'UV', type: 'source', outputs: ['uv: vec2'] },
                { label: 'Time', type: 'source', outputs: ['time: float'] },
                { label: 'SceneGroup', type: 'effect', outputs: ['scene3d'] },
                { label: 'RayRender', type: 'effect', inputs: ['scene3d', 'uv', 'time'], outputs: ['color: vec3', 'depth: float', 'normal: vec3'] },
                { label: 'Output', type: 'output', inputs: ['color: vec3'] },
              ],
            },
            {
              title: 'Extend: combine two SDFs with Min',
              description: <>Inside the SceneGroup, add a second SDF (e.g. <strong>TorusSDF3D</strong>). Feed both distances into a <strong>Min</strong> node — the minimum distance is the SDF union, showing whichever surface is closer.</>,
              nodes: [
                { label: 'SphereSDF3D', type: 'effect', outputs: ['dist_a: float'] },
                { label: 'TorusSDF3D', type: 'effect', outputs: ['dist_b: float'] },
                { label: 'Min\n(union)', type: 'transform', inputs: ['a: float', 'b: float'], outputs: ['dist: float'] },
              ],
            },
          ]} />

          <Tip>
            The <C>normal</C> output from RayRender is in world space as a <TypeBadge type="vec3" /> with
            values in the −1 to 1 range. Remap it with <C>normal * 0.5 + 0.5</C> (using a <strong>Multiply</strong>{' '}
            and <strong>Add</strong> node) to get a visible normal-map color. Or wire it directly into a{' '}
            <strong>Dot</strong> with a light direction for custom per-pixel shading on top of the
            built-in lighting.
          </Tip>

          <Warn>
            The <C>scene3d</C> wire type is special — it can only connect from a SceneGroup output to a
            RayRender input. It cannot be wired into math or color nodes. Think of it as carrying compiled
            scene code, not a data value.
          </Warn>
        </div>

        {/* ── 3D Composable Scenes ── */}
        <div ref={sec3dRef as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>3D Composable Scenes</h2>
          <div style={S.divider} />

          <p style={S.p}>
            The composable 3D system lets you build raymarched scenes from individual nodes rather than writing raw GLSL.
            Five node types form the pipeline: <strong>ScenePos</strong>, SDF primitives, transform nodes, <strong>SceneGroup</strong>, and <strong>RayRender</strong>.
          </p>

          <p style={S.subTitle}>The Flow: ScenePos → SDF → SceneGroup → RayRender</p>
          <p style={S.p}>
            Inside a <strong>SceneGroup</strong>, <strong>ScenePos</strong> outputs the current ray position <code>p</code>.
            Feed it through any chain of transforms and SDFs. The final distance float goes to the SceneGroup output port,
            which compiles the subgraph into a GLSL function. Outside the group, connect <strong>SceneGroup → RayRender</strong> along with UV and Time.
          </p>
          <pre style={S.code}>{`// Compiled from the SceneGroup subgraph:
float mapScene_abc123(vec3 p) {
    float sdf_dist = sdf3d_sphere(p, 0.5);
    return sdf_dist;
}
// RayRender marches rays against mapScene_abc123`}</pre>

          <p style={S.subTitle}>Order of Operations</p>
          <Warn>
            Transform nodes <em>must come before</em> the SDF node in the chain, not after.
            The SDF evaluates distance from the <em>transformed</em> position — if you connect the SDF first and the transform second,
            the transform has no effect. Always wire: <strong>ScenePos → Transform → SDF → output</strong>.
          </Warn>

          <p style={S.subTitle}>Infinite Space Repetition</p>
          <p style={S.p}>
            <strong>Repeat3D</strong> folds space so every point sees a copy of the scene within a cell. The implementation
            uses a mod-based fold: <code>mod(p + 0.5*cell, cell) - 0.5*cell</code>. One SDF becomes infinitely tiled with no
            extra cost — only the primitive inside the cell is evaluated.
          </p>
          <pre style={S.code}>{`// Repeat3D mental model:
//   cellX=2.0, cellY=2.0, cellZ=2.0
//   every 2 units in each direction, space resets
// Chain: ScenePos → Repeat3D → SphereSDF3D`}</pre>

          <Tip>
            To create a flying-forward effect, add a <strong>Translate3D</strong> node <em>before</em> <strong>Repeat3D</strong> and wire <strong>Time</strong> into the Z offset.
            The entire repeated field scrolls toward the camera.
          </Tip>

          <p style={S.subTitle}>Domain Warp Nodes: SinWarp3D &amp; SpiralWarp3D</p>
          <p style={S.p}>
            <strong>SinWarp3D</strong> displaces one axis by a sine of another: <code>p.y += sin(p.x * freq + time) * amp</code>.
            <strong>SpiralWarp3D</strong> rotates the chosen plane by an angle proportional to the point's distance from the origin,
            creating a vortex. Both distort the SDF metric — keep amplitude below 0.15 for SinWarp and frequency below 1.5 for SpiralWarp
            to avoid over-stepping artifacts.
          </p>

          <Warn>
            Domain warp nodes break the Lipschitz condition of the SDF. If you see grainy or missing surfaces,
            reduce the warp amplitude or increase <strong>Max Steps</strong> on the RayRender node.
          </Warn>

          <p style={S.subTitle}>RayRender Outputs: color, depth, normal, iter</p>
          <ul style={S.ul}>
            <li style={S.li}><strong>color</strong> — fully shaded vec3 with diffuse + ambient + fog.</li>
            <li style={S.li}><strong>depth</strong> — normalized hit distance (0 = camera, 1 = max dist / miss).</li>
            <li style={S.li}><strong>normal</strong> — world-space surface normal vec3, range −1 to 1. Zero on miss.</li>
            <li style={S.li}><strong>iter</strong> — normalized step count 0–1. High values (near 1) indicate expensive regions.</li>
          </ul>

          <p style={S.subTitle}>Normal-Based Coloring</p>
          <p style={S.p}>
            The raw <strong>normal</strong> output has components in −1 to 1. To turn it into a visible color, remap to 0–1:
            wire <code>normal</code> into <strong>MultiplyVec3</strong> (scale = 0.5) then <strong>AddVec3</strong> (b = 0.5, 0.5, 0.5).
            The result is a classic normal-map RGB where X=red, Y=green, Z=blue.
          </p>

          <p style={S.subTitle}>Iteration Count Shading</p>
          <p style={S.p}>
            Wire <strong>iter</strong> (multiplied by a factor like 8) into a <strong>Palette</strong> node's <code>t</code> input
            to color surfaces by marching cost. Cheap regions stay one color; complex or thin features glow differently.
            Combine with depth for a depth + cost composite.
          </p>
        </div>

        {/* Bottom padding */}
        <div style={{ height: '80px' }} />
      </main>
    </div>
  );
}
