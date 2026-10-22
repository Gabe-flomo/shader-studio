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
import { CurvesCardViz } from './CurvesEditor';
import { ConvolveCard } from './ConvolveCard';
import { AudioToolCardBody } from '../audio/AudioToolCardBody';
import { EnvelopeCardViz } from './EnvelopeCardViz';
import { NodeInlineViz } from './NodeInlineViz';
import { ShaderTextureCardBody } from '../shaderTexture/ShaderTextureCardBody';
import { PaletteTools } from './PaletteTools';
import { ParticlePresets } from './ParticlePresets';
import { DataTextureCardBody } from './DataTextureCardBody';
import { RenderTargetsCardBody } from './RenderTargetsCardBody';
import { SendReceiveCardBody } from './SendReceiveCardBody';
import { SimpleExprCardBody } from './SimpleExprCard';
import { DepthCardBody } from '../depth/DepthCardBody';
import { BlobTrackCardBody } from '../blobs/BlobTrackCardBody';
import { CacheCardBody } from '../cache/CacheCardBody';
import { AnalyzeCardBody } from '../analyze/AnalyzeCardBody';
import { SegmentCardBody } from '../segment/SegmentCardBody';
import { DepthLightCardBody } from '../depth/DepthLightCardBody';
import { SplatSceneCardBody } from '../splats/SplatSceneCardBody';
import { ScatterReachNote } from './ScatterReachNote';
import { EmitScanCardBody } from '../splats/EmitScanCardBody';
import { isAudioToolType } from '../../nodes/definitions/audioTools';

/** Cards whose body is always a live picture on desktop (a Pass's texture, a Shuffle's channels…): shown here too. */
const ALWAYS_VIZ = new Set(['pass', 'dataTexture', 'renderTargets', 'textureFeedback', 'trailField', 'channelShuffle']);

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
      {/* Curves' graph editor, the Audio Source's File | Mic, a Shader Texture's picture, a Pass's
          texture: the card bodies a phone used to leave out (the 2026-10 mobile audit) */}
      {node.type === 'curves' && <div style={box}><CurvesCardViz node={node} touch /></div>}
      {node.type === 'convolve' && <div style={box}><ConvolveCard node={node} /></div>}
      {node.type === 'envelope' && <div style={box}><EnvelopeCardViz node={node} touch /></div>}
      {isAudioToolType(node.type) && <div style={box}><AudioToolCardBody node={node} /></div>}
      {node.type === 'shaderTexture' && <div style={box}><ShaderTextureCardBody node={node} /></div>}
      {ALWAYS_VIZ.has(node.type) && <div data-mobile-viz style={{ ...box, paddingTop: 0 }}><NodeInlineViz node={node} /></div>}
      {/* The rest of the card bodies NodeComponent.tsx draws under a card's sockets, in the same order */}
      {(node.type === 'palette' || node.type === 'stopPalette') && <div style={box}><PaletteTools node={node} /></div>}
      {node.type === 'gpuParticles' && <div style={box}><ParticlePresets node={node} /></div>}
      {node.type === 'dataTexture' && <div style={box}><DataTextureCardBody node={node} touch /></div>}
      {node.type === 'renderTargets' && <div style={box}><RenderTargetsCardBody node={node} touch /></div>}
      {(node.type === 'send' || node.type === 'receive') && <div style={box}><SendReceiveCardBody node={node} touch /></div>}
      {node.type === 'simpleExpr' && <div style={box}><SimpleExprCardBody node={node} touch rows /></div>}
      {node.type === 'depth' && <div style={box}><DepthCardBody node={node} touch /></div>}
      {node.type === 'blobTrack' && <div style={box}><BlobTrackCardBody node={node} /></div>}
      {node.type === 'cache' && <div style={box}><CacheCardBody node={node} /></div>}
      {node.type === 'analyze' && <div style={box}><AnalyzeCardBody node={node} /></div>}
      {node.type === 'segment' && <div style={box}><SegmentCardBody node={node} /></div>}
      {node.type === 'depthLight' && <div style={box}><DepthLightCardBody node={node} touch /></div>}
      {node.type === 'splatScene' && <div style={box}><SplatSceneCardBody node={node} /></div>}
      {(node.type === 'pieces' || node.type === 'pieceBalls') && <div style={box}><ScatterReachNote node={node} /></div>}
      {node.type === 'agentEmit' && node.params.shape === 'splats' && <div style={box}><EmitScanCardBody node={node} /></div>}
      {/* The canvas's Suggestions strip ("Next" moves), which a phone has no card to show under */}
      <div style={{ flexShrink: 0 }}><SuggestionList node={node} nodes={nodes} /></div>
    </>
  );
}
