/**
 * Kuwahara's card body (nodes/definitions/kuwahara.ts, docs/kuwahara.md): where its reads come from, how many a
 * pixel costs, and, for a Colour chain, the plain warning that every read works the chain out again.
 */
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore, getActiveNodes } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { getNodeDefinitionFor } from '../../nodes/definitions';
import { kuwaharaNote } from '../../nodes/definitions/kuwahara';

export function KuwaharaCard({ node }: { node: GraphNode }) {
  const tk = useTokens();
  // One string (lines joined), so the selector's result compares equal between renders.
  const note = useNodeGraphStore(s => {
    const path = s.activeGroupPath;
    const here = (path.length ? getActiveNodes(s.nodes, path) : s.nodes) ?? s.nodes;
    return kuwaharaNote(here.find(n => n.id === node.id) ?? node, here, getNodeDefinitionFor).join('\n');
  });
  return (
    <div style={{ padding: '4px 12px 8px 16px', display: 'flex', flexDirection: 'column', gap: 4 }} data-kuwahara-card>
      {note.split('\n').map((line, i) => (
        <span key={i} style={{ color: tk.text.faint, fontSize: 11, lineHeight: 1.4 }}>{line}</span>
      ))}
    </div>
  );
}
