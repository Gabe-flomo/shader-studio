// @ts-nocheck — legacy file, unused in active app
import { useState } from 'react';
import Editor from '@monaco-editor/react';
import { useShaderStore } from '../store/useShaderStore';
import { generateFragmentShader } from '../shaders/generator';

export default function CodeView() {
  const [isOpen, setIsOpen] = useState(false);
  const nodes = useShaderStore((state) => state.nodes);

  const fragmentShader = generateFragmentShader(nodes);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          padding: '12px 20px',
          background: '#3a3a3a',
          border: '1px solid #555',
          borderRadius: '6px',
          color: '#fff',
          cursor: 'pointer',
          fontSize: '13px',
          zIndex: 1000,
        }}
      >
        View GLSL Code
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: '40%',
        background: '#1e1e1e',
        borderTop: '1px solid #333',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          padding: '12px 20px',
          background: '#2a2a2a',
          borderBottom: '1px solid #333',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h3 style={{ margin: 0, color: '#fff', fontSize: '14px' }}>
          Generated Fragment Shader
        </h3>
        <button
          onClick={() => setIsOpen(false)}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#888',
            cursor: 'pointer',
            fontSize: '20px',
          }}
        >
          ×
        </button>
      </div>
      <div style={{ flex: 1 }}>
        <Editor
          height="100%"
          defaultLanguage="glsl"
          value={fragmentShader}
          theme="vs-dark"
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontSize: 13,
            scrollBeyondLastLine: false,
          }}
        />
      </div>
    </div>
  );
}
