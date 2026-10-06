/**
 * A Video Input node's clip editor (docs/clip-editor.md): the shared editor
 * with playback capabilities. Apply saves `clip` (segments, crop / rotate /
 * flip) and the node's own speed and loop; with a clip the video follows the
 * graph clock through the kept segments (lib/videoEngine.ts), in the app,
 * renders and web pages alike. A clip that changes nothing is dropped, so the
 * node runs free as before.
 */
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { videoEngine } from '../../lib/videoEngine';
import { getVideo } from '../../lib/backgroundLibrary';
import { parseSavedClip } from '../../lib/media/clip';
import { LazyClipEditorModal } from '../media/lazyClipEditor';

export function VideoInputClipModal({ node, onClose }: { node: GraphNode; onClose: () => void }) {
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const p = node.params;
  const speed = typeof p._speed === 'number' && p._speed > 0 ? p._speed : 1;
  const loop = p._loop !== false;
  const videoId = typeof p.videoId === 'string' ? p.videoId : '';
  return (
    <LazyClipEditorModal
      host="videoInput"
      title="Edit clip"
      subtitle={`Video Input · ${(typeof p._fileName === 'string' && p._fileName) || 'video'}`}
      load={async () => videoEngine.file(node.id) ?? (videoId ? (await getVideo(videoId))?.blob ?? null : null)}
      saved={parseSavedClip(p.clip)}
      speed={speed}
      loop={loop}
      note="Apply sets how the node plays. With a trim, segments or a crop it follows the clock (pause the preview and it pauses); renders and web pages show the same frames."
      onApply={a => {
        videoEngine.setSpeed(node.id, a.speed);
        videoEngine.setLoop(node.id, a.loop);
        updateNodeParams(node.id, { clip: a.clip ?? undefined, _speed: a.speed, _loop: a.loop });
      }}
      onClose={onClose}
    />
  );
}
