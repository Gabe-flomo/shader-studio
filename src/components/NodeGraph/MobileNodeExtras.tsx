/**
 * MobileNodeExtras — the desktop card's own bodies, in the phone's node page (MobileGraphBrowser):
 * the Time Cube's video and clip (Choose video, Edit clip…), the Time Cube View's key, the Grid
 * Rules card (its rule line opens the editor, full screen on a phone), an Agents group's Edit
 * rules (the rules editor: full screen, its settings and rules as two tabs), the Recipe chip of
 * a builder-made node (a built scene's recipe, a rules group's rules), the Suggestions
 * strip's next moves as a list, and, while the eye is on this node, the preview with Show as and
 * Detail (docs/node-previews.md).
 *
 * The bodies are the same components the cards use, with `touch` for finger-sized buttons, so a
 * change on one shows on the other.
 */
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { TimeCubeCardBody } from '../timeCube/TimeCubeCardBody';
import { TimeCubeViewKeyInfo } from '../timeCube/TimeCubeViewKeyInfo';
import { GridRulesCardBody } from '../gridRules/GridRulesCardBody';
import { ValuePreview } from './ValuePreview';
import { SuggestionList } from './SuggestionStrip';
import { AgentRulesCardButtons } from './AgentRulesCard';
import { isRulesGroup } from '../../agentRules/apply';
import { fontFamily, radius } from '../../theme/tokens';
import { openGridRulesEditor } from '../../builders/windows';
import { RecipeChip } from '../builders/RecipeChip';

export function MobileNodeExtras({ node, nodes }: { node: GraphNode; nodes: GraphNode[] }) {
  const tk = useTokens();
  const previewing = useNodeGraphStore(s => s.previewNodeId === node.id);
  const box = { borderRadius: 12, background: tk.bg.panel, boxShadow: `0 0 0 1px ${tk.border.default}`, overflow: 'hidden', paddingTop: 6, flexShrink: 0 } as const;
  return (
    <>
      {previewing && (
        <div data-mobile-preview style={{ ...box, paddingTop: 0 }}>
          <ValuePreview node={node} />
        </div>
      )}
      {node.type === 'timeCube' && <div style={box}><TimeCubeCardBody node={node} touch /></div>}
      {node.type === 'timeCubeView' && <div style={box}><TimeCubeViewKeyInfo node={node} touch /></div>}
      {node.type === 'gridRules' && (
        <div style={box}>
          <GridRulesCardBody node={node} touch onOpen={() => openGridRulesEditor(node.id)} />
        </div>
      )}
      {/* A scene the 3D Scene Builder built: its recipe, Copy, Open in Scene Builder */}
      {node.type === 'sceneGroup' && !!node.params.sceneBuilder && <div style={{ ...box, paddingTop: 0 }}><RecipeChip node={node} touch /></div>}
      {node.type === 'agentsGroup' && isRulesGroup(node) && <div style={{ ...box, paddingTop: 0 }}><RecipeChip node={node} touch /></div>}
      {node.type === 'agentsGroup' && isRulesGroup(node) && (
        <div style={{ ...box, display: 'flex', gap: 8, padding: 10 }}>
          <AgentRulesCardButtons node={node} button={{
            flex: 1, height: 40, border: 0, borderRadius: radius.md, cursor: 'pointer', touchAction: 'manipulation',
            background: tk.bg.field, color: tk.text.primary, font: `600 13px ${fontFamily.ui}`,
          }} />
        </div>
      )}
      {/* The canvas's Suggestions strip ("Next" moves), which a phone has no card to show under */}
      <div style={{ flexShrink: 0 }}><SuggestionList node={node} nodes={nodes} /></div>
    </>
  );
}
