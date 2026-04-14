import React, { useRef, useState, useEffect, useCallback } from 'react';
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
    overflowX: 'hidden',
    overflowY: 'hidden',
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
    userSelect: 'text' as const,
    WebkitUserSelect: 'text' as const,
  } as React.CSSProperties,

  ul: { paddingLeft: '20px', marginBottom: '10px' } as React.CSSProperties,
  li: {
    fontSize: '13px',
    color: T.text,
    lineHeight: 1.7,
    marginBottom: '3px',
    userSelect: 'text' as const,
    WebkitUserSelect: 'text' as const,
  } as React.CSSProperties,

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
    maxWidth: '100%',
    lineHeight: 1.6,
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,

  codeWrapper: {
    position: 'relative' as const,
    marginBottom: '14px',
    maxWidth: '100%',
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
type DiagramNode = {
  label: string;
  type?: 'source' | 'transform' | 'effect' | 'color' | 'output';
  outputs?: string[];
  inputs?: string[];
};

type DiagramArrow = {
  from: number;
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
  return (
    <div style={{ marginBottom: '16px', marginTop: '8px', overflowX: 'auto', maxWidth: '100%' }}>
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
            const hasArrow = !isLast;
            const arrow = arrows?.find(a => a.from === i);

            return (
              <React.Fragment key={i}>
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

          <div style={{ flex: 1, minWidth: 0 }}>
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
    <div style={{ overflowX: 'auto', width: '100%', marginBottom: '14px' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12px' }}>
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
    </div>
  );
}

// ─── Comparison Table ─────────────────────────────────────────────────────────
function CompareTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div style={{ overflowX: 'auto', width: '100%', marginBottom: '14px' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12px' }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${T.border}22` }}>
              {row.map((cell, j) => (
                <td key={j} style={{ padding: '6px 10px', color: j === 0 ? T.blue : T.text, fontFamily: j === 0 ? 'monospace' : undefined, fontSize: j === 0 ? '11px' : undefined }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
export function LearnPage({ onNavigateToStudio }: LearnPageProps) {
  const { loadExampleGraph } = useNodeGraphStore();
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // Section refs
  const secIntroRef = useRef<HTMLDivElement>(null);
  const secInterfaceRef = useRef<HTMLDivElement>(null);
  const secFirstRef = useRef<HTMLDivElement>(null);
  const secTypesRef = useRef<HTMLDivElement>(null);
  const secSdfRef = useRef<HTMLDivElement>(null);
  const secSourcesRef = useRef<HTMLDivElement>(null);
  const secTransformsRef = useRef<HTMLDivElement>(null);
  const secCombinersRef = useRef<HTMLDivElement>(null);
  const secColorRef = useRef<HTMLDivElement>(null);
  const secMathRef = useRef<HTMLDivElement>(null);
  const secNoiseRef = useRef<HTMLDivElement>(null);
  const secAnimRef = useRef<HTMLDivElement>(null);
  const secGroupsRef = useRef<HTMLDivElement>(null);
  const secLoopsRef = useRef<HTMLDivElement>(null);
  const secEffectsRef = useRef<HTMLDivElement>(null);
  const sec2dLightRef = useRef<HTMLDivElement>(null);
  const sec3dHowRef = useRef<HTMLDivElement>(null);
  const sec3dSceneGroupRef = useRef<HTMLDivElement>(null);
  const sec3dPrimitivesRef = useRef<HTMLDivElement>(null);
  const secRayMarchRef = useRef<HTMLDivElement>(null);
  const secRayMarchLitRef = useRef<HTMLDivElement>(null);
  const sec3dBuildRef = useRef<HTMLDivElement>(null);
  const secKishimisuRef = useRef<HTMLDivElement>(null);
  const sec3dTransformsRef = useRef<HTMLDivElement>(null);
  const secFractalsRef = useRef<HTMLDivElement>(null);
  const secPhysicsRef = useRef<HTMLDivElement>(null);
  const secImportRef = useRef<HTMLDivElement>(null);
  const secExamplesRef = useRef<HTMLDivElement>(null);

  function tryExample(key: string) {
    loadExampleGraph(key);
    onNavigateToStudio();
  }

  const contentStyle: React.CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: isMobile ? '16px 16px 40px' : '32px 52px',
    maxWidth: isMobile ? '100%' : '900px',
    width: '100%',
    boxSizing: 'border-box',
    userSelect: 'text',
    WebkitUserSelect: 'text',
  };

  return (
    <div style={S.page}>
      {/* ── Sidebar TOC ── */}
      {!isMobile && (
        <nav style={{
          ...S.sidebar,
          width: sidebarOpen ? '196px' : '32px',
          transition: 'width 0.2s ease',
          overflow: 'hidden',
          position: 'relative',
          flexShrink: 0,
        }}>
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

          {sidebarOpen && <>
            <span style={{ ...S.tocSection, paddingTop: '2px' }}>Shader Studio</span>

            <span style={S.tocSection}>Getting Started</span>
            <TocLink label="Introduction" targetRef={secIntroRef} />
            <TocLink label="The Interface" targetRef={secInterfaceRef} />
            <TocLink label="Your First Shader" targetRef={secFirstRef} />

            <span style={S.tocSection}>2D Fundamentals</span>
            <TocLink label="Data & Types" targetRef={secTypesRef} />
            <TocLink label="SDFs (2D)" targetRef={secSdfRef} />
            <TocLink label="Sources & Inputs" targetRef={secSourcesRef} />
            <TocLink label="Transforms & Spaces" targetRef={secTransformsRef} />

            <span style={S.tocSection}>Building Complexity</span>
            <TocLink label="Combiners & Blending" targetRef={secCombinersRef} />
            <TocLink label="Color & Palettes" targetRef={secColorRef} />
            <TocLink label="Math & Utilities" targetRef={secMathRef} />
            <TocLink label="Noise & Patterns" targetRef={secNoiseRef} />
            <TocLink label="Animation & Audio" targetRef={secAnimRef} />
            <TocLink label="Groups & Loops" targetRef={secGroupsRef} />

            <span style={S.tocSection}>Effects</span>
            <TocLink label="Effects Layer" targetRef={secEffectsRef} />
            <TocLink label="2D Lighting" targetRef={sec2dLightRef} />

            <span style={S.tocSection}>3D Scenes</span>
            <TocLink label="How 3D Works" targetRef={sec3dHowRef} />
            <TocLink label="Scene Group" targetRef={sec3dSceneGroupRef} />
            <TocLink label="3D Primitives" targetRef={sec3dPrimitivesRef} />
            <TocLink label="RayMarch" targetRef={secRayMarchRef} />
            <TocLink label="RayMarchLit" targetRef={secRayMarchLitRef} />
            <TocLink label="Building a Scene" targetRef={sec3dBuildRef} />
            <TocLink label="Kishimisu Coloring" targetRef={secKishimisuRef} />
            <TocLink label="3D Transforms" targetRef={sec3dTransformsRef} />

            <span style={S.tocSection}>Advanced</span>
            <TocLink label="Fractals" targetRef={secFractalsRef} />
            <TocLink label="Physics" targetRef={secPhysicsRef} />
            <TocLink label="Import / Export" targetRef={secImportRef} />

            <span style={S.tocSection}>Reference</span>
            <TocLink label="All Examples" targetRef={secExamplesRef} />
          </>}
        </nav>
      )}

      {/* ── Scrollable content ── */}
      <main style={contentStyle}>
        {/* Header */}
        <div style={{ marginBottom: '8px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: 700, color: T.textBold, marginBottom: '6px', letterSpacing: '-0.02em' }}>
            Shader Studio Guide
          </h1>
          <p style={{ ...S.p, color: T.dim, marginBottom: 0 }}>
            A comprehensive guide to building GLSL shaders with the node graph — from first UV to animated 3D scenes.
          </p>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            INTRODUCTION
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={secIntroRef} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Introduction</h2>
          <div style={S.divider} />

          <p style={S.p}>
            Shader Studio is a node-based GLSL shader editor. Every pixel is computed independently and in parallel on the GPU. You define "what color should this coordinate be" as a composition of math functions, connected visually in a node graph.
          </p>
          <p style={S.p}>
            This paradigm is the same one used in Shadertoy, TouchDesigner, Blender's Shader Editor, and Unreal/Unity material graphs. The key difference: Shader Studio compiles your graph directly into GLSL you can inspect, copy, and run anywhere.
          </p>
          <Tip>You don't need to write any code. But understanding what's happening mathematically will help you build more interesting things. This guide explains both layers — what you click and why it works.</Tip>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            THE INTERFACE
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={secInterfaceRef} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>The Interface</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>Layout</h3>
          <CodeBlock>{`┌─────────────────────────────────────────────────────┐
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
└──────────┴────────────────────────┴─────────────────┘`}</CodeBlock>
          <ul style={S.ul}>
            <li style={S.li}><strong style={{ color: T.textBold }}>Node Palette</strong> — categorized list of all nodes; click to add</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Node Graph Canvas</strong> — drag nodes, draw wires between sockets</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Shader Preview</strong> — live GPU-rendered output</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Code Panel</strong> — generated GLSL; toggle with <C>Cmd+\</C></li>
          </ul>

          <h3 style={S.subTitle}>Node Anatomy</h3>
          <CodeBlock>{`        ┌──────────────────────┐
        │   Node Title         │
        ├──────────────────────┤
  ● ──▶ │  input_a    output ──▶ ○
  ● ──▶ │  input_b             │
        ├──────────────────────┤
        │  [param: 0.50]       │
        └──────────────────────┘
  ● = input socket   ○ = output socket`}</CodeBlock>
          <p style={S.p}>
            Socket colors indicate type: <span style={{ color: T.text }}>float = gray</span>, <span style={{ color: T.blue }}>vec2 = blue</span>, <span style={{ color: T.green }}>vec3 = green</span>, <span style={{ color: T.mauve }}>vec4 = purple</span>. Only matching types connect.
          </p>

          <h3 style={S.subTitle}>Keyboard Shortcuts</h3>
          <div style={{ overflowX: 'auto', width: '100%', marginBottom: '14px' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12px' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>Action</th>
                  <th style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>Shortcut</th>
                </tr>
              </thead>
              <tbody>
                {([
                  ['Open palette', 'A'], ['Add UV', 'U'], ['Add Time', 'T'], ['Add Output', 'O'],
                  ['Add Mix', 'M'], ['Add Float', 'Shift+F'], ['Fit view', 'F'],
                  ['Toggle GLSL', 'Cmd+\\'], ['Undo', 'Cmd+Z'], ['Export graph', 'Cmd+S'],
                  ['Import graph', 'Cmd+O'], ['Group selected', 'Cmd+G'], ['Wrap in loop', 'Cmd+L'],
                  ['Record video', 'Cmd+R'], ['Show shortcuts', '?'],
                ] as [string, string][]).map(([action, shortcut], i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${T.border}22` }}>
                    <td style={{ padding: '6px 10px', color: T.text }}>{action}</td>
                    <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: T.green, fontSize: '11px' }}>{shortcut}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            YOUR FIRST SHADER
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={secFirstRef} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Your First Shader</h2>
          <div style={S.divider} />

          <StepBuilder steps={[
            {
              title: 'The Coordinate System',
              description: <>Press <C>U</C> to add a <strong style={{ color: T.textBold }}>UV</strong> node. This outputs centered, aspect-corrected coordinates — <C>(0,0)</C> is the center, y spans roughly <C>±0.5</C>.</>,
              nodes: [{ label: 'UV', type: 'source', outputs: ['uv: vec2'] }],
            },
            {
              title: 'A Shape',
              description: <>Add a <strong style={{ color: T.textBold }}>Circle SDF</strong> and connect <C>UV → CircleSDF.position</C>. Returns negative inside, zero at boundary, positive outside.</>,
              nodes: [
                { label: 'UV', type: 'source', outputs: ['uv: vec2'] },
                { label: 'CircleSDF', type: 'effect', inputs: ['position: vec2'], outputs: ['distance: float'] },
              ],
            },
            {
              title: 'Lighting',
              description: <>Add <strong style={{ color: T.textBold }}>MakeLight</strong> and connect <C>CircleSDF.distance → MakeLight.sdf</C>. Bright at the boundary, falls off quickly.</>,
              nodes: [
                { label: 'CircleSDF', type: 'effect', outputs: ['distance: float'] },
                { label: 'MakeLight', type: 'effect', inputs: ['sdf: float'], outputs: ['glow: float'] },
              ],
            },
            {
              title: 'Color',
              description: <>Add <strong style={{ color: T.textBold }}>Palette</strong> and connect <C>MakeLight → Palette.t</C>. Uses the IQ cosine formula to map floats to color.</>,
              nodes: [
                { label: 'MakeLight', type: 'effect', outputs: ['glow: float'] },
                { label: 'Palette', type: 'color', inputs: ['t: float'], outputs: ['color: vec3'] },
              ],
            },
            {
              title: 'Output',
              description: <>Press <C>O</C> to add <strong style={{ color: T.textBold }}>Output</strong>. Connect <C>Palette.color → Output.color</C>. A glowing colored circle appears.</>,
              nodes: [
                { label: 'Palette', type: 'color', outputs: ['color: vec3'] },
                { label: 'Output', type: 'output', inputs: ['color: vec3'] },
              ],
            },
          ]} />

          <NodeDiagram
            nodes={[
              { label: 'UV', type: 'source', outputs: ['uv'] },
              { label: 'CircleSDF', type: 'effect', inputs: ['position'], outputs: ['distance'] },
              { label: 'MakeLight', type: 'effect', inputs: ['sdf'], outputs: ['glow'] },
              { label: 'Palette', type: 'color', inputs: ['t'], outputs: ['color'] },
              { label: 'Output', type: 'output', inputs: ['color'] },
            ]}
            caption="Complete first shader pipeline"
          />

          <Tip>Add a Time node, connect Time → Sin → Multiply(0.3) → MakeLight.brightness to make the glow pulse.</Tip>
          <TryIt exampleKey="glowing-circle" label="Glowing Circle" onTry={tryExample} />
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            DATA & TYPES
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={secTypesRef} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Data &amp; Types</h2>
          <div style={S.divider} />

          <DataTable rows={[
            ['float', 'Single number', 'Time / Constant / Sin'],
            ['vec2', 'Two numbers (x, y)', 'UV / Mouse / MakeVec2'],
            ['vec3', 'Three numbers (r, g, b)', 'Palette / MakeVec3 / FloatToVec3'],
            ['vec4', 'Four numbers (r, g, b, a)', 'Vec4Output'],
          ]} />

          <h3 style={S.subTitle}>The Compilation Model</h3>
          <p style={S.p}>Each node emits a GLSL snippet. The graph is topologically sorted and all snippets are assembled into a single <C>void main()</C> then compiled on the GPU.</p>

          <CodeBlock>{`// Example: UV → CircleSDF → MakeLight
void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
    float n1_dist = length(uv) - 0.25;
    float n2_glow = 0.02 / max(abs(n1_dist), 0.001);
    gl_FragColor = vec4(vec3(n2_glow), 1.0);
}`}</CodeBlock>

          <h3 style={S.subTitle}>Wired vs. Static Parameters</h3>
          <p style={S.p}>
            As a <strong style={{ color: T.textBold }}>static parameter</strong>, the value is set by the slider and baked as a literal constant. As a <strong style={{ color: T.textBold }}>wired parameter</strong>, the value comes from another node at runtime.
          </p>

          <h3 style={S.subTitle}>Type Conversion Nodes</h3>
          <div style={{ overflowX: 'auto', width: '100%', marginBottom: '14px' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12px' }}>
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
                  ['float × 3', 'vec3', 'MakeVec3'],
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
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SDFs
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={secSdfRef} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Signed Distance Fields (2D)</h2>
          <div style={S.divider} />

          <p style={S.p}>
            An SDF is a function <C>f(point) → float</C> returning the signed distance to the nearest surface. Negative = inside, zero = boundary, positive = outside.
          </p>

          <h3 style={S.subTitle}>2D Primitive Nodes</h3>
          <ul style={S.ul}>
            <li style={S.li}><strong style={{ color: T.textBold }}>CircleSDF</strong> — <C>length(point) - radius</C></li>
            <li style={S.li}><strong style={{ color: T.textBold }}>BoxSDF</strong> — abs+max formula for axis-aligned box</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>RingSDF</strong> — <C>abs(length(point) - radius) - thickness</C></li>
            <li style={S.li}><strong style={{ color: T.textBold }}>ShapeSDF</strong> — dropdown with 30+ shapes (star, heart, hexagon, cross...)</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>OpRepeat</strong> — tiles space via <C>mod</C> — infinite grid of the shape</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>OpRepeatPolar</strong> — N-fold angular repeat for mandala/radial patterns</li>
          </ul>

          <h3 style={S.subTitle}>Combining SDFs</h3>
          <ul style={S.ul}>
            <li style={S.li}><strong style={{ color: T.textBold }}>Union</strong> — <C>min(sdf_a, sdf_b)</C></li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Intersection</strong> — <C>max(sdf_a, sdf_b)</C></li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Subtraction</strong> — <C>max(sdf_a, -sdf_b)</C></li>
            <li style={S.li}><strong style={{ color: T.textBold }}>SmoothMin</strong> — smooth blend with parameter <C>k</C></li>
          </ul>

          <h3 style={S.subTitle}>Rendering SDFs</h3>
          <ul style={S.ul}>
            <li style={S.li}><strong style={{ color: T.textBold }}>MakeLight</strong> — <C>strength / max(|dist|, epsilon)</C> — glow at the boundary</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>SDFColorize</strong> — maps distance to a color gradient</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>SDFOutline</strong> — renders only the boundary edge</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>GlowLayer</strong> — additive glow with controllable falloff</li>
          </ul>
          <Tip>Wire <C>Time → Sin → k</C> on SmoothMin to animate the blend amount — shapes morph from sharp to blobby.</Tip>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SOURCES & INPUTS
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={secSourcesRef} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Sources &amp; Inputs</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>UV</h3>
          <p style={S.p}>Centered, aspect-corrected <TypeBadge type="vec2" />. Origin at center, y spans ±0.5. Every shader starts here.</p>

          <h3 style={S.subTitle}>PixelUV</h3>
          <p style={S.p}>Raw pixel coordinates — <C>(0,0)</C> at bottom-left, <C>(1,1)</C> at top-right (normalized). Required by Vignette and Scanlines nodes.</p>

          <h3 style={S.subTitle}>Time</h3>
          <p style={S.p}>Elapsed seconds as <TypeBadge type="float" />. The foundation of all animation.</p>
          <CodeBlock>{`sin(time)         // smooth oscillation, period ~6.28s
fract(time * 0.2) // sawtooth ramp 0→1 repeating
mod(time, 4.0)    // 0→4 repeating ramp`}</CodeBlock>

          <h3 style={S.subTitle}>Mouse</h3>
          <p style={S.p}>Cursor position as <TypeBadge type="vec2" /> in UV space. Subtract from UV and feed to CircleSDF for a circle that follows the cursor.</p>

          <h3 style={S.subTitle}>Audio Input</h3>
          <p style={S.p}>FFT analysis of microphone/audio. Outputs: <C>bass</C>, <C>mid</C>, <C>high</C>, <C>sub</C>, <C>presence</C>, <C>brilliance</C>, <C>volume</C> — all floats. Drive any parameter for audio-reactive visuals.</p>

          <h3 style={S.subTitle}>Previous Frame</h3>
          <p style={S.p}>Samples last frame's output — enables feedback loops for trails, blur, and accumulation effects.</p>
          <Warn>Previous Frame requires enabling the Feedback toggle on the Output node. Without it, the node outputs black.</Warn>

          <h3 style={S.subTitle}>Loop Index</h3>
          <p style={S.p}>Inside a loop body, outputs the current iteration number as <TypeBadge type="float" /> (<C>0.0, 1.0, 2.0...</C>).</p>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            TRANSFORMS & SPACES
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={secTransformsRef} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Transforms &amp; Spaces</h2>
          <div style={S.divider} />

          <p style={S.p}>
            In shaders, instead of moving shapes, you warp the coordinate space they sample from. This is <strong style={{ color: T.textBold }}>domain transformation</strong>.
          </p>

          <h3 style={S.subTitle}>Transform Nodes</h3>
          <ul style={S.ul}>
            <li style={S.li}><strong style={{ color: T.textBold }}>Fract</strong> — tiles space by repeating 0→1</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Rotate2D</strong> — rotates UV around origin</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>UVWarp</strong> — displaces UV by a noise-derived offset</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>CurlWarp</strong> — divergence-free smoke/liquid distortion</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>SwirlWarp</strong> — twists UV around the origin</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Displace</strong> — shifts UV along a direction by a float</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Shear</strong> — skews UV: <C>uv.x += shear_x * uv.y</C></li>
          </ul>

          <h3 style={S.subTitle}>Space Nodes</h3>
          <ul style={S.ul}>
            <li style={S.li}><strong style={{ color: T.textBold }}>Polar Space</strong> — Cartesian to polar (r, theta)</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>LogPolar</strong> — logarithmic polar; Escher-like infinite zoom</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>KaleidoSpace</strong> — N-sided kaleidoscope mirror folds</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Hyperbolic</strong> — Poincare disc model</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Inversion</strong> — circle inversion (<C>p/|p|²</C>)</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Mobius</strong> — conformal Möbius transformation</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Ripple Space</strong> — concentric wave distortion</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Infinite Repeat</strong> — tiles the plane infinitely</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Perspective2D</strong> — fake-perspective floor/ceiling warp. <C>axis</C> = x or y, <C>ratio</C> controls vanishing point. Outputs <C>uv</C> + <C>depth</C> float for fog.</li>
          </ul>

          <NodeDiagram
            nodes={[
              { label: 'UV', type: 'source', outputs: ['uv: vec2'] },
              { label: 'Perspective2D', type: 'transform', inputs: ['uv', 'ratio'], outputs: ['uv', 'depth'] },
              { label: 'Grid', type: 'effect', inputs: ['uv'], outputs: ['grid: float'] },
              { label: 'Output', type: 'output', inputs: ['color'] },
            ]}
            caption="Perspective2D warps UV for a floor grid — use depth output for fog."
          />
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            COMBINERS & BLENDING
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={secCombinersRef} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Combiners &amp; Blending</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>SDF Combiners</h3>
          <ul style={S.ul}>
            <li style={S.li}><C>Min</C> / <C>Max</C> — union / intersection of SDFs</li>
            <li style={S.li}><C>SmoothMin</C> / <C>SmoothMax</C> — smooth blend with k parameter</li>
            <li style={S.li}><C>SmoothSubtract</C> — soft boolean subtraction</li>
          </ul>

          <h3 style={S.subTitle}>Color Combiners</h3>
          <ul style={S.ul}>
            <li style={S.li}><C>Blend</C> — mix two colors by a float mask</li>
            <li style={S.li}><C>AddColor</C> — additive blending (good for glows)</li>
            <li style={S.li}><C>ScreenBlend</C> — <C>1-(1-a)(1-b)</C> — brighter than additive, no clipping</li>
            <li style={S.li}><C>BlendModes</C> — Photoshop-style: multiply, screen, overlay, soft light, hard light, difference, exclusion, dodge, burn, lighten, darken</li>
            <li style={S.li}><C>MixVec3</C> — blend two vec3 colors by a float factor</li>
          </ul>

          <h3 style={S.subTitle}>AlphaBlend (new)</h3>
          <p style={S.p}>
            <strong style={{ color: T.textBold }}>AlphaBlend</strong> layers two RGBA surfaces with premultiplied alpha compositing:
          </p>
          <CodeBlock>{`result = top_rgb * top_a + bottom_rgb * bottom_a * (1.0 - top_a)`}</CodeBlock>
          <p style={S.p}>Connect bottom_rgb + bottom_a (the background layer) and top_rgb + top_a (the foreground). Use for compositing glowing shapes over backgrounds.</p>

          <NodeDiagram
            nodes={[
              { label: 'Background\n(vec3)', type: 'source', outputs: ['rgb', 'alpha=1'] },
              { label: 'Foreground\nShape', type: 'effect', outputs: ['rgb', 'alpha'] },
              { label: 'AlphaBlend', type: 'effect', inputs: ['bottom_rgb', 'bottom_a', 'top_rgb', 'top_a'], outputs: ['result: vec3'] },
              { label: 'Output', type: 'output', inputs: ['color'] },
            ]}
            caption="AlphaBlend composites a glowing shape over a background using premultiplied alpha."
          />
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            COLOR & PALETTES
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={secColorRef} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Color &amp; Palettes</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>Palette</h3>
          <p style={S.p}>IQ cosine palette — maps any float to a smooth color:</p>
          <CodeBlock>{`vec3 palette(float t) {
    return a + b * cos(6.28318 * (c * t + d));
}
// a=offset, b=amplitude, c=frequency, d=phase`}</CodeBlock>
          <Tip>Start with <C>a = b = vec3(0.5)</C> for a full-range cycle, then tune c/d to place specific colors.</Tip>

          <h3 style={S.subTitle}>PalettePreset</h3>
          <p style={S.p}>Dropdown with 8 pre-configured palettes — quick beautiful colors without tuning parameters.</p>

          <h3 style={S.subTitle}>ColorRamp</h3>
          <p style={S.p}>Multi-stop gradient — maps a float <C>t</C> (0→1) through up to 8 custom color stops. More expressive than Palette when you need specific colors at specific positions.</p>

          <h3 style={S.subTitle}>Blackbody</h3>
          <p style={S.p}>Converts color temperature (Kelvin) to physically-based RGB. 1000K = deep red embers, 3000K = warm tungsten, 5500K = noon sunlight, 12000K = blue-white star. Drive with FBM noise scaled to 1000–6500K for fire effects.</p>

          <h3 style={S.subTitle}>BrightnessContrast</h3>
          <p style={S.p}>Shifts brightness and adjusts contrast around midpoint 0.5. Use as a final grade node before Output.</p>

          <h3 style={S.subTitle}>Other Color Nodes</h3>
          <ul style={S.ul}>
            <li style={S.li}><C>Gradient</C> — linear interpolation between two colors</li>
            <li style={S.li}><C>HSV</C> — hue/saturation/value. Wire Time → Hue for a color wheel cycle.</li>
            <li style={S.li}><C>Posterize</C> — quantize to N steps; cel-shaded look</li>
            <li style={S.li}><C>Invert</C> — <C>1.0 - color</C></li>
            <li style={S.li}><C>Desaturate</C> — grayscale using luminance weights</li>
            <li style={S.li}><C>HueRange</C> — selective hue shifting</li>
            <li style={S.li}><C>WaveTexture</C> — procedural bands/rings/stripes pattern → float</li>
            <li style={S.li}><C>MagicTexture</C> — psychedelic multicolor interference → vec3</li>
            <li style={S.li}><C>Grid</C> — tiling grid with cell UV, cell ID, checker, and grid-line outputs</li>
          </ul>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            MATH & UTILITIES
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={secMathRef} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Math &amp; Utilities</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>Arithmetic & Trig</h3>
          <p style={S.p}><C>Add</C>, <C>Subtract</C>, <C>Multiply</C>, <C>Divide</C>, <C>Negate</C>, <C>Abs</C> work componentwise on any type. <C>Sin</C>/<C>Cos</C> period = 2π. <C>Atan2</C> — angle of a vec2.</p>

          <h3 style={S.subTitle}>Range & Interpolation</h3>
          <ul style={S.ul}>
            <li style={S.li}><C>Mix</C> — <C>mix(a, b, t)</C>. The workhorse of blending.</li>
            <li style={S.li}><C>Smoothstep</C> — S-curve ramp; essential for anti-aliased SDF edges</li>
            <li style={S.li}><C>Remap</C> — remaps a value from one range to another</li>
            <li style={S.li}><C>Clamp</C> — restricts to min/max range</li>
          </ul>

          <h3 style={S.subTitle}>WeightedAverage (new)</h3>
          <p style={S.p}>Weighted mean of 2–4 float inputs:</p>
          <CodeBlock>{`result = (w1*a + w2*b + w3*c + ...) / (w1 + w2 + w3 + ...)`}</CodeBlock>
          <p style={S.p}>Use to blend FBM octaves with custom weights, or merge SDF distances with controlled influence per shape.</p>
          <TryIt exampleKey="weightedNoiseOctaves" label="Weighted Noise Octaves" onTry={tryExample} />
          <TryIt exampleKey="weightedSdfBlend" label="Weighted SDF Blend" onTry={tryExample} />

          <h3 style={S.subTitle}>Vector Math</h3>
          <p style={S.p}><C>Length</C>, <C>Dot</C>, <C>Normalize</C>, <C>CrossProduct</C> (vec3→vec3 perpendicular), <C>Reflect</C> (I - 2·dot(N,I)·N). <C>MakeVec2</C>, <C>ExtractX/Y</C>, <C>MakeVec3</C>, <C>FloatToVec3</C>, <C>AddVec2/Vec3</C>, <C>MultiplyVec2/Vec3</C>.</p>

          <h3 style={S.subTitle}>Complex Math</h3>
          <ul style={S.ul}>
            <li style={S.li}><C>ComplexMul</C> — multiply two vec2 as complex numbers</li>
            <li style={S.li}><C>ComplexPow</C> — raise a complex number to a real power (via polar form). Great for Julia-set iteration.</li>
          </ul>

          <h3 style={S.subTitle}>Utility Nodes</h3>
          <p style={S.p}><C>Luminance</C> (vec3→float BT.709), <C>Sign</C> (−1/0/+1), <C>Step</C> (threshold), <C>AngleToVec2</C> (radians→unit vec2), <C>Vec2Angle</C> (vec2→radians), <C>Tanh</C>, <C>Pow</C>, <C>Sqrt</C>, <C>Exp</C>, <C>Floor</C>, <C>Ceil</C>, <C>Round</C>, <C>Mod</C>, <C>Fract Raw</C>.</p>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            NOISE & PATTERNS
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={secNoiseRef} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Noise &amp; Patterns</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>FBM — Fractal Brownian Motion</h3>
          <p style={S.p}>Stacks multiple octaves of smooth noise at increasing frequencies. Creates organic, cloud-like texture. Parameters: octaves (4–6 typical), scale, lacunarity (2.0 = each octave 2× finer), gain (0.5 = each octave half as loud), anim speed.</p>
          <CodeBlock>{`float fbm(vec2 p) {
    float value = 0.0, amplitude = 0.5, frequency = 1.0;
    for (int i = 0; i < octaves; i++) {
        value += amplitude * noise(p * frequency);
        frequency *= lacunarity;
        amplitude *= gain;
    }
    return value;
}`}</CodeBlock>

          <h3 style={S.subTitle}>Voronoi (Cell Noise)</h3>
          <p style={S.p}>Divides space into cells centered on random points. <C>jitter</C>: 0 = regular grid, 1 = fully random. Use cases: organic cells, cracked earth, stained glass.</p>

          <h3 style={S.subTitle}>Domain Warp</h3>
          <p style={S.p}>Feed noise back as its own input for turbulent patterns:</p>
          <CodeBlock>{`p1 = p + FBM(p)
p2 = p1 + FBM(p1)
result = FBM(p2)  // cloudy, smoky, marble-like`}</CodeBlock>

          <h3 style={S.subTitle}>Other Noise Nodes</h3>
          <ul style={S.ul}>
            <li style={S.li}><C>NoiseFloat</C> — single-octave cheap noise</li>
            <li style={S.li}><C>FlowField</C> — advects curves along noise-derived vectors; streaming streaks</li>
            <li style={S.li}><C>CirclePack</C> — pseudo-random non-overlapping circles; bubbles, stippling</li>
          </ul>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            ANIMATION & AUDIO
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={secAnimRef} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Animation &amp; Audio</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>LFO Nodes</h3>
          <div style={{ overflowX: 'auto', width: '100%', marginBottom: '14px' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12px' }}>
              <thead>
                <tr>
                  {['Node', 'Shape', 'Range', 'Use'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {([
                  ['SineLFO', 'Smooth sine', '−1 to 1', 'Breathing, organic motion'],
                  ['SquareLFO', 'On/off toggle', '−1 or 1', 'Blinking, strobing'],
                  ['SawtoothLFO', 'Linear ramp up', '−1 to 1', 'Scrolling, phase drives'],
                  ['TriangleLFO', 'Linear up-down', '−1 to 1', 'Ping-pong motion'],
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
          </div>

          <h3 style={S.subTitle}>BPM Sync</h3>
          <p style={S.p}>Locks animation to a musical tempo. Outputs a beat phase 0→1 that resets each beat. Multiply by 0.5 for half notes, by 4 for sixteenth notes.</p>

          <h3 style={S.subTitle}>Audio Input</h3>
          <p style={S.p}>Connects to microphone/audio via WebAudio FFT. Outputs: <C>bass</C>, <C>mid</C>, <C>high</C>, <C>sub</C>, <C>presence</C>, <C>brilliance</C>, <C>volume</C>. Wire any band into any parameter for live audio-reactive visuals.</p>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            GROUPS & LOOPS
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={secGroupsRef} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Groups &amp; Loops</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>Creating a Group</h3>
          <p style={S.p}>Select nodes and press <C>Cmd+G</C>. The system auto-detects which wires cross the group boundary and creates input/output ports. Double-click a group to enter it.</p>

          <h3 style={S.subTitle}>Iterations Parameter</h3>
          <p style={S.p}>Every group has an Iterations parameter (default 1). Set it to N and the body runs N times with each pass feeding into the next. This turns any sub-graph into a loop.</p>
          <CodeBlock>{`// Example: UV Fold Loop (iterations=6)
// Inside group: Multiply(1.5) → Fract → Subtract(0.5)
uv = fract(uv * 1.5) - 0.5;  // run 6 times → deep fractal`}</CodeBlock>

          <h3 style={S.subTitle}>LoopStart / LoopEnd (Wired Loops)</h3>
          <p style={S.p}>Wire body nodes between a LoopStart/LoopEnd pair. Set iteration count and carry type (<C>float</C>, <C>vec2</C>, <C>vec3</C>, <C>vec4</C>). The carry value flows through the body once per iteration. Press <C>Cmd+L</C> to wrap selected nodes automatically.</p>

          <h3 style={S.subTitle}>Loop Step Nodes</h3>
          <ul style={S.ul}>
            <li style={S.li}><C>LoopRippleStep</C> — radial displacement per pass</li>
            <li style={S.li}><C>LoopRotateStep</C> — rotates UV per pass</li>
            <li style={S.li}><C>LoopDomainFold</C> — abs fold (Kleinian fractals)</li>
            <li style={S.li}><C>LoopFloatAccumulate</C> — sums float contributions</li>
            <li style={S.li}><C>LoopRingStep</C> — ring formation</li>
            <li style={S.li}><C>LoopColorRingStep</C> — ring of colored glows</li>
          </ul>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            EFFECTS LAYER
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={secEffectsRef} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Effects Layer</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>Post-Process Nodes</h3>
          <ul style={S.ul}>
            <li style={S.li}><strong style={{ color: T.textBold }}>ToneMap</strong> — Reinhard HDR compression. Essential when combining multiple glow sources.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Grain / LumaGrain / TemporalGrain</strong> — noise overlay. LumaGrain scales noise by luminance. TemporalGrain animates every frame.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>ChromaticAberration</strong> — splits RGB channels with UV offsets; rainbow lens fringing.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>ChromaticAberrationAuto</strong> (new) — automatic compound CA: splits a vec3 into R/G/B, displaces each by signed offset from center. Much simpler than manual ChromaticAberration.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>GravitationalLens</strong> — bends UV using inverse-square-law. Wire <C>uv_lensed</C> into any downstream UV input.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Vignette</strong> — smooth edge darkening. Outputs float mask; use PixelUV not standard UV.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Scanlines</strong> — horizontal CRT scanline overlay. Use PixelUV, wire Time for animated scroll.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Sobel</strong> — edge detection via <C>dFdx/dFdy</C>. Outputs <C>edge strength</C> (float) and <C>edge color</C> (vec3).</li>
          </ul>

          <h3 style={S.subTitle}>RadianceCascades2D (new)</h3>
          <p style={S.p}>
            Approximate 2D global illumination using prev-frame feedback. Outputs <C>radiance</C> (vec3 GI result) plus individual <C>gi_r</C>, <C>gi_b</C>, <C>gi_b</C> channels.
          </p>
          <Warn>RadianceCascades2D requires the Output node's Feedback toggle ON — it samples <C>u_prevFrame</C>.</Warn>
          <TryIt exampleKey="neonGI" label="Neon GI" onTry={tryExample} />

          <h3 style={S.subTitle}>Custom Logic Nodes</h3>
          <ul style={S.ul}>
            <li style={S.li}><C>Expr</C> — inline GLSL expression with inputs a, b, c</li>
            <li style={S.li}><C>CustomFn</C> — full GLSL function with named inputs and output type</li>
          </ul>
          <TryIt exampleKey="spectralLens" label="Spectral Lens (CA auto)" onTry={tryExample} />
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            2D LIGHTING
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec2dLightRef} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>2D Lighting</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>Light2D</h3>
          <p style={S.p}>
            A 2D point light. Set <C>light_pos_x/y</C>, <C>intensity</C>, <C>radius</C>, and choose a falloff model:
          </p>
          <ul style={S.ul}>
            <li style={S.li}><strong style={{ color: T.textBold }}>linear</strong> — falloff proportional to distance</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>squared</strong> — physically correct inverse-square falloff</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>exponential</strong> — fast falloff for tight glow effects</li>
          </ul>
          <p style={S.p}>Outputs: <C>light</C> (vec3 colored), <C>falloff</C> (float), <C>dist</C> (float). Wire <C>falloff</C> into a <C>MultiplyVec3</C> with your scene color to shade surfaces as if lit by this point light.</p>

          <NodeDiagram
            nodes={[
              { label: 'UV', type: 'source', outputs: ['uv'] },
              { label: 'Light2D', type: 'effect', inputs: ['uv', 'pos', 'intensity'], outputs: ['light', 'falloff', 'dist'] },
              { label: 'SceneColor\n(vec3)', type: 'color', outputs: ['color'] },
              { label: 'MultiplyVec3', type: 'transform', inputs: ['color', 'falloff'], outputs: ['lit: vec3'] },
              { label: 'Output', type: 'output', inputs: ['color'] },
            ]}
            caption="Light2D falloff multiplies scene color — pixels closer to the light are brighter."
          />
          <TryIt exampleKey="threePointLights" label="Three Point Lights" onTry={tryExample} />

          <h3 style={S.subTitle}>Perspective2D + Light2D: Neon Floor</h3>
          <p style={S.p}>Combine Perspective2D for a floor perspective warp, Grid for the grid pattern, and Light2D for a neon point light illuminating the floor:</p>
          <NodeDiagram
            nodes={[
              { label: 'UV', type: 'source', outputs: ['uv'] },
              { label: 'Perspective2D', type: 'transform', inputs: ['uv'], outputs: ['uv', 'depth'] },
              { label: 'Grid', type: 'effect', inputs: ['uv'], outputs: ['grid', 'cellUV'] },
              { label: 'Light2D', type: 'effect', inputs: ['uv', 'pos'], outputs: ['falloff'] },
              { label: 'MultiplyVec3', type: 'transform', inputs: ['grid color', 'falloff'], outputs: ['result'] },
              { label: 'Output', type: 'output', inputs: ['color'] },
            ]}
            caption="Perspective-warped grid lit by a 2D point light."
          />
          <TryIt exampleKey="neonFloorGrid" label="Neon Floor Grid" onTry={tryExample} />
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            3D: HOW IT WORKS
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec3dHowRef} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>3D: How It Works</h2>
          <div style={S.divider} />

          <p style={S.p}>
            Shader Studio's 3D pipeline is built on <strong style={{ color: T.textBold }}>sphere tracing</strong> (raymarching). The full pipeline is:
          </p>

          <ol style={{ ...S.ul, listStyleType: 'decimal' }}>
            <li style={S.li}><strong style={{ color: T.textBold }}>SceneGroup</strong> compiles all inner nodes into a GLSL function: <C>float mapScene(vec3 p)</C></li>
            <li style={S.li}><strong style={{ color: T.textBold }}>ScenePos</strong> inside the group outputs the position <C>p</C> being evaluated</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>RayMarch / RayMarchLit</strong> calls that function in a sphere-tracing loop, stepping forward by the returned distance until it hits the surface</li>
            <li style={S.li}>Outputs (dist, normal, iter...) are wired to color nodes for custom rendering</li>
          </ol>

          <CodeBlock>{`// Compiled SceneGroup:
float mapScene_abc(vec3 p) {
    return length(p) - 0.5;  // sphere SDF
}

// RayMarch sphere-traces it:
float dist = 0.0;
for (int i = 0; i < maxSteps; i++) {
    float d = mapScene_abc(ro + rd * dist);
    if (d < 0.001) break;  // hit!
    dist += d;             // safe to step forward by d
}`}</CodeBlock>

          <p style={S.p}>
            The key insight: the SDF value tells you exactly how far you can safely step without missing any geometry. This is why sphere tracing is so efficient.
          </p>

          <NodeDiagram
            nodes={[
              { label: 'ScenePos', type: 'source', outputs: ['p: vec3'] },
              { label: 'SphereSDF3D', type: 'effect', inputs: ['pos'], outputs: ['dist'] },
              { label: 'SceneGroup', type: 'effect', outputs: ['scene3d'] },
              { label: 'RayMarch', type: 'effect', inputs: ['scene3d', 'uv', 'time'], outputs: ['dist', 'normal', 'iter', 'depth', 'hit'] },
              { label: 'PalettePreset', type: 'color', inputs: ['t'], outputs: ['color'] },
              { label: 'Output', type: 'output', inputs: ['color'] },
            ]}
            caption="Full 3D pipeline: ScenePos → SDF → SceneGroup → RayMarch → color → Output"
          />
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SCENE GROUP & SCENE POS
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec3dSceneGroupRef} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Scene Group &amp; Scene Pos</h2>
          <div style={S.divider} />

          <p style={S.p}>
            <strong style={{ color: T.textBold }}>SceneGroup</strong> is a container node — the 3D equivalent of a Group node but with special compilation behavior. Inside it, you build the distance function for your scene.
          </p>
          <p style={S.p}>
            <strong style={{ color: T.textBold }}>ScenePos</strong> is only valid inside a SceneGroup. It outputs the current ray march sample position <C>p</C> as a <TypeBadge type="vec3" />. Wire it through 3D transforms and into SDF primitives. The final <TypeBadge type="float" /> distance becomes the SceneGroup's output.
          </p>

          <Tip>If you have multiple SDFs inside a SceneGroup, combine them with a <C>Min</C> node (union) before connecting to the output port.</Tip>

          <Warn>Transform nodes must come <em>before</em> the SDF in the chain. Always wire: ScenePos → Transform → SDF → output.</Warn>

          <h3 style={S.subTitle}>Domain Repetition Inside Scenes</h3>
          <p style={S.p}>
            <strong style={{ color: T.textBold }}>Repeat3D</strong> inside a SceneGroup creates infinite tiling at zero extra cost. Only one SDF primitive is evaluated — the domain fold makes it repeat:
          </p>
          <CodeBlock>{`// Repeat3D implementation:
p_repeated = mod(p + 0.5*period, period) - 0.5*period;
// One SphereSDF3D → infinite spheres`}</CodeBlock>
          <Tip>To create a flying-forward effect: add Translate3D before Repeat3D and wire Time into the Z offset. The entire field scrolls toward the camera.</Tip>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            3D SDF PRIMITIVES
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec3dPrimitivesRef} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>3D SDF Primitives</h2>
          <div style={S.divider} />

          <p style={S.p}>All primitives take a <C>Position: vec3</C> input and output a <C>Distance: float</C>. Wire ScenePos (optionally through transforms) into the Position input.</p>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
            {([
              ['SphereSDF3D', 'pos, radius', 'length(pos) − radius. The simplest SDF.'],
              ['BoxSDF3D', 'pos, size (vec3)', 'IQ box formula. Size = x/y/z half-extents.'],
              ['TorusSDF3D', 'pos, major_r, minor_r', 'Donut shape. major_r = ring radius, minor_r = tube thickness.'],
              ['CapsuleSDF3D', 'pos, height, radius', 'Pill / capped cylinder shape.'],
              ['CylinderSDF3D', 'pos, height, radius', 'Infinite cylinder capped at ±height.'],
              ['ConeSDF3D', 'pos, angle, height', 'Cone with apex at origin.'],
              ['OctahedronSDF3D', 'pos, size', 'Eight-faced diamond shape.'],
            ] as [string, string, string][]).map(([name, params, desc]) => (
              <div key={name} style={{ background: T.surface2, borderRadius: '6px', padding: '10px 12px', border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: T.peach, marginBottom: '3px' }}>{name}</div>
                <code style={{ fontSize: '10px', color: T.green, fontFamily: 'monospace', display: 'block', marginBottom: '4px' }}>{params}</code>
                <div style={{ fontSize: '11px', color: T.dim, lineHeight: 1.5 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            RAYMARCH
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={secRayMarchRef} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>RayMarch</h2>
          <div style={S.divider} />

          <p style={S.p}>
            <strong style={{ color: T.textBold }}>RayMarch</strong> is the raw sphere tracer — camera + march only. It produces no color of its own. You wire the outputs to palette and math nodes to create custom coloring.
          </p>

          <h3 style={S.subTitle}>Outputs</h3>
          <ul style={S.ul}>
            <li style={S.li}><C>dist</C> <TypeBadge type="float" /> — total ray travel distance from camera to hit point</li>
            <li style={S.li}><C>depth</C> <TypeBadge type="float" /> — normalized 0–1 depth</li>
            <li style={S.li}><C>normal</C> <TypeBadge type="vec3" /> — world-space surface normal at hit</li>
            <li style={S.li}><C>iter</C> <TypeBadge type="float" /> — normalized step count (0–1). High values = expensive regions / edges</li>
            <li style={S.li}><C>hit</C> <TypeBadge type="float" /> — 1.0 if ray hit, 0.0 if missed (sky)</li>
          </ul>

          <h3 style={S.subTitle}>Inputs</h3>
          <p style={S.p}><C>scene3d</C> (from SceneGroup), <C>uv</C> (vec2), <C>time</C> (float), plus wirable camera sockets: <C>camDist</C>, <C>camAngle</C>, <C>rotSpeed</C>, <C>fov</C>, <C>maxDist</C>. <C>maxSteps</C> is slider-only (compile-time constant).</p>

          <h3 style={S.subTitle}>Example: Normal Visualization</h3>
          <NodeDiagram
            nodes={[
              { label: 'RayMarch', type: 'effect', outputs: ['normal: vec3'] },
              { label: 'MultiplyVec3\n×0.5', type: 'transform', inputs: ['normal'], outputs: ['vec3'] },
              { label: 'AddVec3\n+0.5', type: 'transform', outputs: ['0–1 range'] },
              { label: 'Output', type: 'output', inputs: ['color'] },
            ]}
            caption="Remap normal −1..1 to 0..1 for visible RGB normal-map coloring."
          />
          <TryIt exampleKey="normalColor3D" label="Normal Color 3D" onTry={tryExample} />
          <TryIt exampleKey="depthIterAO3D" label="Depth + Iter AO" onTry={tryExample} />
          <TryIt exampleKey="infiniteFalling3D" label="Infinite Falling 3D" onTry={tryExample} />
          <TryIt exampleKey="spiralWorld3D" label="Spiral World 3D" onTry={tryExample} />
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            RAYMARCHLIT
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={secRayMarchLitRef} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>RayMarchLit</h2>
          <div style={S.divider} />

          <p style={S.p}>
            <strong style={{ color: T.textBold }}>RayMarchLit</strong> is the full PBR renderer with soft shadows (toggleable), AO, sky-dome ambient, and warm key light. It has all the same raw outputs as RayMarch, plus a finished <C>color</C> (vec3).
          </p>

          <h3 style={S.subTitle}>Additional Inputs</h3>
          <p style={S.p}>All camera params are wirable sockets (<C>camDist</C>, <C>camAngle</C>, <C>rotSpeed</C>, <C>fov</C>, <C>maxDist</C>). Also: <C>lightX/Y/Z</C>, <C>albedoR/G/B</C> as wirable sockets. <C>maxSteps</C> is slider-only.</p>

          <h3 style={S.subTitle}>RayMarch vs RayMarchLit</h3>
          <CompareTable
            headers={['', 'RayMarch', 'RayMarchLit']}
            rows={[
              ['color output', '✗ (you add it)', '✓ (PBR finished)'],
              ['dist', '✓', '✓'],
              ['normal', '✓', '✓'],
              ['iter', '✓', '✓'],
              ['AO', '✗', '✓'],
              ['Soft shadows', '✗', 'optional toggle'],
              ['Best for', 'kishimisu, normal viz, depth maps', 'clay renders, architectural viz'],
            ]}
          />

          <TryIt exampleKey="sphereScene3D" label="Sphere Scene" onTry={tryExample} />
          <TryIt exampleKey="torusScene3D" label="Torus Scene" onTry={tryExample} />
          <TryIt exampleKey="twoShapes3D" label="Two Shapes" onTry={tryExample} />
          <TryIt exampleKey="infiniteBoxes3D" label="Infinite Boxes" onTry={tryExample} />
          <TryIt exampleKey="softMetaballs3D" label="Soft Metaballs" onTry={tryExample} />
          <TryIt exampleKey="shapesAndGround3D" label="Shapes and Ground" onTry={tryExample} />
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            BUILDING A SCENE: STEP BY STEP
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec3dBuildRef} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Building a Scene: Step-by-Step</h2>
          <div style={S.divider} />

          <StepBuilder steps={[
            {
              title: 'ScenePos + SDF → SceneGroup',
              description: <>Add a <strong style={{ color: T.textBold }}>SceneGroup</strong>. Inside it, add <strong style={{ color: T.textBold }}>ScenePos</strong> and wire it to a <strong style={{ color: T.textBold }}>SphereSDF3D</strong> (radius=0.5). Connect the distance float to the SceneGroup output port.</>,
              nodes: [
                { label: 'ScenePos', type: 'source', outputs: ['p: vec3'] },
                { label: 'SphereSDF3D', type: 'effect', inputs: ['pos: vec3'], outputs: ['dist: float'] },
                { label: 'SceneGroup', type: 'effect', outputs: ['scene3d'] },
              ],
            },
            {
              title: 'Add RayMarch (scene + uv + time)',
              description: <>Outside the SceneGroup, add <strong style={{ color: T.textBold }}>RayMarch</strong>. Connect <C>SceneGroup → scene3d</C>, <C>UV → uv</C>, <C>Time → time</C>.</>,
              nodes: [
                { label: 'UV', type: 'source' },
                { label: 'Time', type: 'source' },
                { label: 'SceneGroup', type: 'effect', outputs: ['scene3d'] },
                { label: 'RayMarch', type: 'effect', inputs: ['scene3d', 'uv', 'time'], outputs: ['dist', 'iter', 'normal'] },
              ],
            },
            {
              title: 'Wire dist + iter to palette',
              description: <>Connect RayMarch's outputs to color nodes. For a quick result: <C>dist × 0.04 + iter × 0.005 → PalettePreset</C>. This is the kishimisu coloring technique.</>,
              nodes: [
                { label: 'RayMarch', type: 'effect', outputs: ['dist', 'iter'] },
                { label: 'Multiply\n×0.04', type: 'transform', outputs: ['float'] },
                { label: 'Add', type: 'transform', outputs: ['t: float'] },
                { label: 'PalettePreset', type: 'color', inputs: ['t'], outputs: ['color'] },
              ],
            },
            {
              title: 'Add Output',
              description: 'Connect PalettePreset.color → Output.color.',
              nodes: [
                { label: 'PalettePreset', type: 'color', outputs: ['color'] },
                { label: 'Output', type: 'output', inputs: ['color'] },
              ],
            },
          ]} />

          <h3 style={S.subTitle}>Combining Two SDFs</h3>
          <p style={S.p}>Inside the SceneGroup, add a second SDF (e.g. <C>TorusSDF3D</C>). Feed both distances into a <C>Min</C> node — the minimum distance is the SDF union, showing whichever surface is closer. Use <C>SmoothMin</C> for soft metaball-like blending.</p>
          <TryIt exampleKey="helloSphere3D" label="Hello Sphere 3D" onTry={tryExample} />
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            KISHIMISU COLORING
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={secKishimisuRef} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Kishimisu Coloring Technique</h2>
          <div style={S.divider} />

          <p style={S.p}>
            The kishimisu coloring technique — named after the Shadertoy artist — maps RayMarch outputs to a palette in a way that produces richly detailed, glowing results with almost no setup:
          </p>
          <CodeBlock>{`t = dist * 0.04 + iter * 0.005
color = palette(t)`}</CodeBlock>

          <p style={S.p}>The two components work together:</p>
          <ul style={S.ul}>
            <li style={S.li}><strong style={{ color: T.textBold }}>dist × 0.04</strong> — total ray travel distance. Surfaces close to the camera = small dist = one end of palette. Far surfaces = large dist = other end. Creates depth-based color banding.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>iter × 0.005</strong> — normalized step count. Edges and thin features cost more steps → higher iter → shifts the palette offset. Creates natural edge darkening and highlighting.</li>
          </ul>

          <p style={S.p}>The 0.04 and 0.005 scales are tunable. Larger values = more palette cycles across depth. Try 0.02/0.003 for subtler variation, or 0.08/0.01 for more intense cycling.</p>

          <NodeDiagram
            nodes={[
              { label: 'RayMarch', type: 'effect', outputs: ['dist', 'iter'] },
              { label: 'Multiply\n×0.04', type: 'transform', outputs: ['d_scaled'] },
              { label: 'Multiply\n×0.005', type: 'transform', outputs: ['i_scaled'] },
              { label: 'Add', type: 'transform', inputs: ['d_scaled', 'i_scaled'], outputs: ['t: float'] },
              { label: 'PalettePreset', type: 'color', inputs: ['t'], outputs: ['color'] },
            ]}
            caption="The kishimisu formula: dist × 0.04 + iter × 0.005 → palette"
          />

          <TryIt exampleKey="kishimisu3D" label="Kishimisu 3D" onTry={tryExample} />
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            3D TRANSFORMS
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec3dTransformsRef} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>3D Transforms</h2>
          <div style={S.divider} />

          <p style={S.p}>Transform nodes take <TypeBadge type="vec3" /> in and output <TypeBadge type="vec3" />. Place them between ScenePos and a primitive. The order matters — transforms compose left-to-right.</p>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
            {([
              ['Translate3D', 'offset: vec3', 'Shift the primitive in world space.'],
              ['Rotate3D', 'axis: X/Y/Z, angle', 'Rotate around the chosen axis. Chain two for arbitrary 3D rotation.'],
              ['Repeat3D', 'period: vec3', 'Infinite domain tiling. One SDF → infinite copies.'],
              ['Twist3D', 'k: float', 'Twists position around Y-axis. Higher k = tighter twist.'],
              ['Fold3D', 'axes: bvec3', 'abs() per axis — mirror-folds space for symmetrical shapes.'],
              ['SinWarp3D', 'freq, amp', 'Displaces one axis by sine of another.'],
              ['SpiralWarp3D', 'strength', 'Distance-dependent rotation — creates vortex effects.'],
            ] as [string, string, string][]).map(([name, params, desc]) => (
              <div key={name} style={{ background: T.surface2, borderRadius: '6px', padding: '10px 12px', border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: T.blue, marginBottom: '3px' }}>{name}</div>
                <code style={{ fontSize: '10px', color: T.green, fontFamily: 'monospace', display: 'block', marginBottom: '4px' }}>{params}</code>
                <div style={{ fontSize: '11px', color: T.dim, lineHeight: 1.5 }}>{desc}</div>
              </div>
            ))}
          </div>

          <Warn>Domain warp nodes (SinWarp3D, SpiralWarp3D) break the Lipschitz condition of the SDF. If you see grainy surfaces, reduce amplitude or increase maxSteps on RayMarch.</Warn>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            FRACTALS
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={secFractalsRef} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Fractals</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>Mandelbrot / Julia</h3>
          <p style={S.p}>Visualizes the iteration formula <C>{'z → z^k + c'}</C>. Four modes: Mandelbrot (c = UV), Julia (c = fixed param), Burning Ship, Tricorn. Outputs: <C>Color</C> (pre-colored), <C>Smooth Iter</C> (for custom coloring), <C>Distance SDF</C> (boundary distance), <C>Orbit Trap</C>.</p>
          <Tip>Wire Mouse → c(Julia) for interactive morphing — move your cursor to explore different Julia set shapes in real time.</Tip>

          <h3 style={S.subTitle}>IFS (Iterated Function Systems)</h3>
          <p style={S.p}>Defines a fractal via a small set of affine transforms — the chaos game reveals the attractor. Classic examples: Sierpinski triangle (3 contractions), Barnsley fern (4 transforms).</p>

          <h3 style={S.subTitle}>Groups as Fractal Loops</h3>
          <p style={S.p}>Set a Group's Iterations to 6 and put <C>Multiply(1.5) → Fract → Subtract(0.5)</C> inside. Each pass scales, tiles, and re-centers — deep fractal structure with no extra nodes.</p>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            PHYSICS
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={secPhysicsRef} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Physics Simulations</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>Chladni Patterns</h3>
          <p style={S.p}>Vibrational modes of a 2D plate. Integer mode numbers m and n select the pattern. Points near zero = nodal lines (where sand clusters in the physical experiment).</p>
          <CodeBlock>{`// Chladni formula:
cos(n*PI*x) * cos(m*PI*y) - cos(m*PI*x) * cos(n*PI*y) = 0
density = exp(-abs(chladni(x,y)) * sharpness)`}</CodeBlock>
          <p style={S.p}>Also available: <C>Chladni3D</C> (volumetric 3D modes) and <C>Chladni3DParticles</C> (particle-based depth rendering).</p>

          <h3 style={S.subTitle}>Electron Orbital</h3>
          <p style={S.p}>Visualizes hydrogen wavefunction probability density <C>|ψ|²</C> using quantum numbers n (principal/shell), l (azimuthal), m (magnetic). Uses real spherical harmonics and associated Laguerre polynomials.</p>

          <h3 style={S.subTitle}>Orbital Volume 3D</h3>
          <p style={S.p}>Combines the electron orbital formula with volumetric raymarching. Renders the full 3D <C>|ψ_nlm|²</C> probability density as a rotating semi-transparent cloud.</p>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            IMPORT / EXPORT
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={secImportRef} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Import / Export</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>Graph Files (.json)</h3>
          <p style={S.p}>Save with <C>Cmd+S</C>, load with <C>Cmd+O</C>. All node positions, connections, and parameters are stored in JSON. Share .json files to exchange graphs.</p>

          <h3 style={S.subTitle}>GLSL Export</h3>
          <p style={S.p}>Generated GLSL is always visible in the Code Panel (<C>Cmd+\</C>). Compatible with Shadertoy with these uniforms:</p>
          <CodeBlock>{`uniform vec2 u_resolution;  // viewport size in pixels
uniform float u_time;       // elapsed time in seconds
uniform vec2 u_mouse;       // mouse position (normalized)`}</CodeBlock>

          <h3 style={S.subTitle}>Video Recording</h3>
          <p style={S.p}>Press <C>Cmd+R</C> to start recording. Formats: H.264 (web-friendly), ProRes 422 HQ (lossless), FFV1 (open-source lossless). Configure resolution and duration.</p>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            ALL EXAMPLES
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={secExamplesRef} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>All Examples</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>Getting Started</h3>
          <TryIt exampleKey="glowing-circle" label="Glowing Circle" onTry={tryExample} />

          <h3 style={S.subTitle}>3D Scenes — RayMarchLit (PBR)</h3>
          <TryIt exampleKey="helloSphere3D" label="Hello Sphere 3D (minimal)" onTry={tryExample} />
          <TryIt exampleKey="sphereScene3D" label="Sphere Scene" onTry={tryExample} />
          <TryIt exampleKey="torusScene3D" label="Torus Scene (rotating)" onTry={tryExample} />
          <TryIt exampleKey="twoShapes3D" label="Two Shapes (sphere + box)" onTry={tryExample} />
          <TryIt exampleKey="infiniteBoxes3D" label="Infinite Boxes (domain repeat)" onTry={tryExample} />
          <TryIt exampleKey="shapesAndGround3D" label="Shapes and Ground Plane" onTry={tryExample} />
          <TryIt exampleKey="softMetaballs3D" label="Soft Metaballs (3 orbiting)" onTry={tryExample} />

          <h3 style={S.subTitle}>3D Scenes — RayMarch (custom coloring)</h3>
          <TryIt exampleKey="normalColor3D" label="Normal Color (normal→RGB)" onTry={tryExample} />
          <TryIt exampleKey="depthIterAO3D" label="Depth + Iter AO (torus)" onTry={tryExample} />
          <TryIt exampleKey="infiniteFalling3D" label="Infinite Falling (octahedra)" onTry={tryExample} />
          <TryIt exampleKey="spiralWorld3D" label="Spiral World (warped octahedra)" onTry={tryExample} />
          <TryIt exampleKey="kishimisu3D" label="Kishimisu 3D (flying octahedra)" onTry={tryExample} />

          <h3 style={S.subTitle}>2D Lighting & Perspective</h3>
          <TryIt exampleKey="neonFloorGrid" label="Neon Floor Grid (Perspective2D)" onTry={tryExample} />
          <TryIt exampleKey="threePointLights" label="Three Point Lights (key/fill/rim)" onTry={tryExample} />
          <TryIt exampleKey="neonGI" label="Neon GI (RadianceCascades2D)" onTry={tryExample} />

          <h3 style={S.subTitle}>Effects & Post-Processing</h3>
          <TryIt exampleKey="spectralLens" label="Spectral Lens (ChromaticAberrationAuto)" onTry={tryExample} />

          <h3 style={S.subTitle}>Math & Noise</h3>
          <TryIt exampleKey="weightedNoiseOctaves" label="Weighted Noise Octaves" onTry={tryExample} />
          <TryIt exampleKey="weightedSdfBlend" label="Weighted SDF Blend" onTry={tryExample} />

          <h3 style={S.subTitle}>Node Reference</h3>
          <div style={{ overflowX: 'auto', width: '100%', marginBottom: '14px' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12px' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600, minWidth: '120px' }}>Category</th>
                  <th style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>Nodes</th>
                </tr>
              </thead>
              <tbody>
                {([
                  ['Sources', 'UV, PixelUV, Time, Mouse, Constant, TextureInput, PrevFrame, LoopIndex, AudioInput'],
                  ['Transforms', 'Fract, Rotate2D, UVWarp, CurlWarp, SwirlWarp, Displace, Shear'],
                  ['Spaces', 'Polar, LogPolar, Hyperbolic, Inversion, Mobius, Swirl, Kaleido, Spherical, Ripple, InfiniteRepeat, Perspective2D'],
                  ['2D Primitives', 'CircleSDF, BoxSDF, RingSDF, ShapeSDF (30+ shapes), OpRepeat, OpRepeatPolar'],
                  ['Combiners', 'SmoothMin, Min, Max, SmoothMax, Subtract, SmoothSubtract, Blend, Mask, AddColor, ScreenBlend, GlowLayer, SDFOutline, SDFColorize, BlendModes, MixVec3, AlphaBlend'],
                  ['Effects', 'MakeLight, ToneMap, Grain, LumaGrain, TemporalGrain, ChromaticAberration, ChromaticAberrationAuto, GravitationalLens, FloatWarp, Vignette, Scanlines, Sobel, RadianceCascades2D, Expr, CustomFn'],
                  ['2D Lighting', 'Light2D'],
                  ['Loops (high-level)', 'FractalLoop, RotatingLinesLoop, AccumulateLoop, ForLoop'],
                  ['Loops (wired)', 'LoopStart, LoopEnd, LoopCarry, LoopRippleStep, LoopRotateStep, LoopDomainFold, LoopFloatAccumulate, LoopRingStep, LoopColorRingStep'],
                  ['Noise', 'FBM, Voronoi, DomainWarp, FlowField, CirclePack, NoiseFloat'],
                  ['Fractals', 'Mandelbrot/Julia, IFS'],
                  ['Physics', 'Chladni, Chladni3D, Chladni3DParticles, ElectronOrbital, OrbitalVolume3D'],
                  ['3D Primitives', 'SphereSDF3D, BoxSDF3D, TorusSDF3D, CapsuleSDF3D, CylinderSDF3D, ConeSDF3D, OctahedronSDF3D'],
                  ['3D Transforms', 'Translate3D, Rotate3D, Repeat3D, Twist3D, Fold3D, SinWarp3D, SpiralWarp3D'],
                  ['3D Scene', 'ScenePos, SceneGroup, RayMarch, RayMarchLit, VolumeClouds'],
                  ['Color', 'Palette, PalettePreset, Gradient, HSV, Posterize, Invert, Desaturate, HueRange, ColorRamp, Blackbody, BrightnessContrast, WaveTexture, MagicTexture, Grid'],
                  ['Output', 'Output, Vec4Output'],
                  ['Math', 'Add, Sub, Mul, Div, Sin, Cos, Exp, Pow, Negate, Length, Tanh, Min, Max, Clamp, Mix, Mod, Atan2, Ceil, Floor, Sqrt, Round, Dot, Normalize, CrossProduct, Reflect, MakeVec2, ExtractX, ExtractY, MakeVec3, FloatToVec3, Fract, Smoothstep, AddVec2, MultiplyVec2, AddVec3, MultiplyVec3, MixVec3, Remap, ComplexMul, ComplexPow, Luminance, Sign, Step, AngleToVec2, Vec2Angle, WeightedAverage'],
                  ['Animation', 'SineLFO, SquareLFO, SawtoothLFO, TriangleLFO, BPMSync'],
                ] as [string, string][]).map(([cat, nodes], i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${T.border}22` }}>
                    <td style={{ padding: '6px 10px', color: T.blue, fontWeight: 600, fontSize: '11px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>{cat}</td>
                    <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: T.green, fontSize: '11px', lineHeight: 1.7 }}>{nodes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Bottom padding */}
        <div style={{ height: '80px' }} />
      </main>
    </div>
  );
}
