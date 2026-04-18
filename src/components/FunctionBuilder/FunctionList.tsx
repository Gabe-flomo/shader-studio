import { useFunctionBuilder } from './useFunctionBuilder';
import { FunctionEditor } from './FunctionEditor';

interface Props {
  glslErrors: string[];
}

export function FunctionList({ glslErrors }: Props) {
  const { functions, activeId, addFunction } = useFunctionBuilder();

  // Parse error string to find which function caused it
  // GLSL errors reference line numbers; we map them back heuristically
  const fnErrors = (id: string) => {
    const fn = functions.find(f => f.id === id);
    if (!fn) return [];
    return glslErrors.filter(e => e.toLowerCase().includes(fn.name + '('));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {functions.map((fn, i) => (
          <FunctionEditor
            key={fn.id}
            fn={fn}
            index={i}
            isActive={fn.id === activeId}
            errors={fnErrors(fn.id)}
          />
        ))}
      </div>

      <div style={{ flexShrink: 0, padding: '6px 8px', borderTop: '1px solid #313244' }}>
        <button
          onClick={addFunction}
          style={{
            width: '100%',
            background: '#1e1e2e',
            border: '1px dashed #45475a',
            color: '#585b70',
            borderRadius: '6px',
            padding: '6px',
            fontSize: '12px',
            cursor: 'pointer',
            transition: 'color 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.color = '#cdd6f4';
            (e.currentTarget as HTMLButtonElement).style.borderColor = '#6c7086';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.color = '#585b70';
            (e.currentTarget as HTMLButtonElement).style.borderColor = '#45475a';
          }}
        >
          + Add Function
        </button>
      </div>
    </div>
  );
}
