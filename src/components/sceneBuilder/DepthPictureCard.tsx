/**
 * DepthPictureCard — "Picture with depth" in the 3D Scene Builder (docs/scene-builder-3d.md, "A picture with depth"):
 * the objects stand in a photo. Pick the picture, generate its depth on this device, and choose how far it goes: in
 * the picture (Depth Composite), lit by the scene (+ Depth Light), and reflected (+ Picture Environment). The same
 * three as "Add a picture with depth" on a March Loop card, as plain choices.
 */
import { useSceneBuilder } from '../../sceneBuilder/store';
import { DEPTH_PIC_3D_HOWS, newDepthPic3D, type DepthPic3D, type DepthPic3DHow } from '../../sceneBuilder/spec';
import { findTex, withSource } from '../../builders/textures';
import { TexturePicker } from '../builders/TexturePicker';
import { DepthGenerateRow } from '../builders/DepthGenerateRow';
import { BuilderNote } from '../builders/BuilderWindow';
import { Card, NumRow, Row } from './controls';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';

const D = newDepthPic3D('');

export function DepthPictureCard() {
  const depth = useSceneBuilder(s => s.spec.depth) ?? null;
  const textures = useSceneBuilder(s => s.spec.textures) ?? [];
  const camera = useSceneBuilder(s => s.spec.camera);
  const edit = useSceneBuilder(s => s.edit);
  const setD = (fn: (d: DepthPic3D) => void, key?: string) => edit(s => { if (s.depth) fn(s.depth); }, key && `depth:${key}`);
  const src = depth ? findTex(textures, depth.tex) : undefined;
  const how = depth ? DEPTH_PIC_3D_HOWS.find(h => h.how === depth.how)! : null;
  const facing = camera.angle === 0 && camera.elev === 0 && camera.orbit === 0;
  return (
    <Card id="look:depth" title="Picture with depth" summary={depth ? `${depth.tex} · ${how!.label.replace(/^…/, '')}` : 'none'} defaultOpen={!!depth}>
      <BuilderNote>A photo the objects stand in: they pass behind and in front of what is in it. Its depth is worked out on this device.</BuilderNote>
      <TexturePicker id="depth3d" sources={textures} value={depth?.tex} none="No picture with depth"
        onAdd={s => edit(d => { d.textures = withSource(d.textures, s); })}
        onChange={name => edit(d => { d.depth = name ? (d.depth ? { ...d.depth, tex: name, bake: d.depth.tex === name ? d.depth.bake : null } : newDepthPic3D(name)) : null; })} />
      {depth && (
        <>
          <Row label="How" hint={how!.blurb}>
            <Select ariaLabel="How the picture and the scene go together" value={depth.how} options={DEPTH_PIC_3D_HOWS.map(h => ({ value: h.how, label: h.label }))}
              onChange={v => setD(d => { d.how = v as DepthPic3DHow; })} />
          </Row>
          <BuilderNote>{how!.blurb}</BuilderNote>
          <DepthGenerateRow pictureNode={src?.node} source={depth.tex} bake={depth.bake} onBake={info => setD(d => { d.bake = info; })} />
          <NumRow label="Nearest" hint="How far from the camera, in scene units, the nearest thing in the picture is." value={depth.near} defaultValue={D.near} min={0.1} max={20} onChange={v => setD(d => { d.near = v; }, 'near')} />
          <NumRow label="Farthest" hint="How far the farthest thing in the picture is. Further spreads the picture deeper." value={depth.far} defaultValue={D.far} min={0.2} max={100} step={0.1} onChange={v => setD(d => { d.far = v; }, 'far')} />
          <NumRow label="Edge softness" hint="How gently the objects fade in at the picture's edges (hides halos round hair)." value={depth.soft} defaultValue={D.soft} min={0} max={1} step={0.005} onChange={v => setD(d => { d.soft = v; }, 'soft')} />
          <Row label="Camera" hint="A photo is seen from the front: the camera at angle 0 and height 0, not orbiting, roughly matches it.">
            <Button size="sm" disabled={facing} onClick={() => edit(d => { d.camera.angle = 0; d.camera.elev = 0; d.camera.orbit = 0; })}>{facing ? 'Facing the picture' : 'Face the picture'}</Button>
          </Row>
        </>
      )}
    </Card>
  );
}
