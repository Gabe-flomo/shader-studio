/**
 * agentShapeRenderer.ts — draws Draw agents' Shapes (agentShapes.ts) with THREE: one RawShaderMaterial
 * per variant (made when first asked for), the Voxel dedupe's claim pass and its grid, and one draw
 * of V × shapes vertices over the runner's empty geometry into a target with a depth buffer. The
 * runner (agentRunner.ts drawShapes) and the benchmark (agentShapesBench.ts) both draw through it.
 */
import * as THREE from 'three';
import {
  AG_SHAPE_CLAIM_FRAG, AG_SHAPE_CLAIM_VERT, type ShapeKind, type Shading, type Facing, type SphereDetail,
  shapeClass, shapeShaders, shapeStride, shapeVariantKey, shapeVertices, voxelGrid, type ShapeVariant,
} from './agentShapes';

/** What one draw of shapes needs besides the state: the look, already read from the node's settings. */
export interface ShapeDrawLook {
  shape: ShapeKind; shading: Shading; facing: Facing; detail: SphereDetail;
  size: number; sizeBy: number; rodLength: number; rodStretch: number; spin: number;
  grid: number; dedupe: boolean; every: number; maxShapes: number; farDots: number;
  ambient: number; rim: number; edgeWidth: number;
  colorBy: number; bright: number; speedRef: number; fade: boolean; usePal: boolean; rainbow: boolean; pal: number[][] | null; colA: number[]; colB: number[];
}
export interface ShapeDrawState {
  a: THREE.Texture; b: THREE.Texture; c: THREE.Texture | null; e: THREE.Texture | null;
  side: number; species: number;
}
export interface ShapeCamera { eye: number[]; fwd: number[]; right: number[]; up: number[]; lens: number; ortho: number; dist: number; proj?: number[] }

const v3 = () => ({ value: new THREE.Vector3() });

export class AgentShapeRenderer {
  private mats = new Map<string, THREE.RawShaderMaterial>();
  private scene = new THREE.Scene();
  private mesh: THREE.Mesh;
  private claimScene = new THREE.Scene();
  private claimMat = new THREE.RawShaderMaterial({
    vertexShader: AG_SHAPE_CLAIM_VERT, fragmentShader: AG_SHAPE_CLAIM_FRAG, glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    uniforms: {
      u_a: { value: null }, u_b: { value: null }, u_side: { value: 1 }, u_stride: { value: 1 }, u_tiles: { value: 1 }, u_grid: { value: 0.04 },
      u_boxHalf: v3(), u_gridN: { value: new THREE.Vector3(1, 1, 1) }, u_atlas: { value: new THREE.Vector2(1, 1) },
    },
  });
  private owner: THREE.WebGLRenderTarget | null = null;
  private ownerKey = '';
  private camera = new THREE.Camera();
  /** The last draw's numbers, for the benchmark and the tests: shapes drawn, vertices each. */
  last = { drawn: 0, vertices: 0, deduped: false };

  private geometry: THREE.BufferGeometry;

  constructor(geometry: THREE.BufferGeometry) {
    this.geometry = geometry;
    this.mesh = new THREE.Mesh(geometry, this.claimMat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    const pts = new THREE.Points(geometry, this.claimMat);
    pts.frustumCulled = false;
    this.claimScene.add(pts);
  }

  /** A variant's material (compiled on first use). */
  material(v: ShapeVariant): THREE.RawShaderMaterial {
    const key = shapeVariantKey(v);
    let m = this.mats.get(key);
    if (m) return m;
    const { vertex, fragment } = shapeShaders(v);
    m = new THREE.RawShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment, glslVersion: THREE.GLSL3,
      depthTest: true, depthWrite: true, depthFunc: THREE.LessDepth, blending: THREE.NoBlending, side: THREE.DoubleSide,
      uniforms: {
        u_a: { value: null }, u_b: { value: null }, u_c: { value: null }, u_e: { value: null }, u_cam: { value: null }, u_owner: { value: null }, u_field: { value: null },
        u_side: { value: 1 }, u_species: { value: 1 }, u_colorBy: { value: 0 }, u_fade: { value: 1 }, u_usePal: { value: 0 }, u_rainbow: { value: 0 },
        u_stateC: { value: 0 }, u_stateE: { value: 0 }, u_camSrc: { value: 0 }, u_sizeBy: { value: 0 }, u_stride: { value: 1 }, u_facing: { value: 0 },
        u_voxel: { value: 0 }, u_dedupe: { value: 0 }, u_tiles: { value: 1 }, u_depth: { value: 0 },
        u_aspect: { value: 1 }, u_bright: { value: 1 }, u_speedRef: { value: 0.5 }, u_size: { value: 0.02 }, u_rodLen: { value: 0 }, u_rodStretch: { value: 0 },
        u_spin: { value: 1 }, u_time: { value: 0 }, u_grid: { value: 0.04 }, u_far: { value: 0 },
        u_colA: v3(), u_colB: v3(), u_pal: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
        u_viewSize: { value: new THREE.Vector2(1, 1) },
        u_eye: v3(), u_fwd: { value: new THREE.Vector3(0, 0, -1) }, u_right: { value: new THREE.Vector3(1, 0, 0) }, u_up: { value: new THREE.Vector3(0, 1, 0) }, u_boxHalf: v3(),
        u_gridN: { value: new THREE.Vector3(1, 1, 1) },
        u_lens: { value: 1.8 }, u_ortho: { value: 0 }, u_camDist: { value: 3 }, u_proj: { value: new THREE.Vector2(0, 1) },
        u_ambient: { value: 0.3 }, u_rim: { value: 0.35 }, u_edgeW: { value: 0.12 },
      },
    });
    this.mats.set(key, m);
    return m;
  }

  /** The dedupe grid's target (made again when the grid's size changes). */
  private ownerTarget(grid: ReturnType<typeof voxelGrid>): THREE.WebGLRenderTarget {
    const key = `${grid.w}x${grid.h}`;
    if (this.owner && this.ownerKey === key) return this.owner;
    this.owner?.dispose();
    this.owner = new THREE.WebGLRenderTarget(grid.w, grid.h, {
      type: THREE.FloatType, format: THREE.RedFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false,
    });
    this.ownerKey = key;
    return this.owner;
  }

  /**
   * Draw the shapes into `into` (cleared, colour and depth; it must have a depth buffer). `scene`: a
   * ray-marched scene's camera texture (its probe) and its Depth, when the Draw agents looks through one.
   */
  draw(renderer: THREE.WebGLRenderer, into: THREE.WebGLRenderTarget, st: ShapeDrawState, look: ShapeDrawLook, cam: ShapeCamera, aspect: number, time: number,
    scene: { cam: THREE.Texture; depth: THREE.Texture | null } | null): void {
    const n = st.side * st.side;
    const { stride, drawn } = shapeStride(n, look.every, look.maxShapes);
    const voxel = look.shape === 'voxel';
    const cls = shapeClass(look.shape, look.detail);
    const V = shapeVertices(look.shape, look.detail);
    const grid = voxelGrid(look.grid, aspect);
    const g = Math.max(0.01, look.grid);
    const dedupe = voxel && look.dedupe;
    if (dedupe) {
      const cu = this.claimMat.uniforms;
      cu.u_a.value = st.a; cu.u_b.value = st.b; cu.u_side.value = st.side; cu.u_stride.value = stride;
      cu.u_tiles.value = grid.tiles; cu.u_grid.value = g;
      (cu.u_boxHalf.value as THREE.Vector3).set(aspect, 1, 1);
      (cu.u_gridN.value as THREE.Vector3).set(grid.nx, grid.ny, grid.nz);
      (cu.u_atlas.value as THREE.Vector2).set(grid.w, grid.h);
      this.claimMat.uniformsNeedUpdate = true;
      this.geometry.setDrawRange(0, drawn);
      // Cleared every frame (a few MB at most): nothing of the last frame is kept, so a reset needs nothing here.
      const prevC = renderer.getClearColor(new THREE.Color()), prevA = renderer.getClearAlpha();
      renderer.setRenderTarget(this.ownerTarget(grid));
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, false, false);
      renderer.setClearColor(prevC, prevA);
      renderer.render(this.claimScene, this.camera);
    }
    const mat = this.material({ cls, shading: look.shading, detail: look.detail });
    const u = mat.uniforms;
    u.u_a.value = st.a; u.u_b.value = st.b; u.u_c.value = st.c; u.u_e.value = st.e;
    u.u_stateC.value = st.c ? 1 : 0; u.u_stateE.value = st.e ? 1 : 0;
    u.u_side.value = st.side; u.u_species.value = st.species; u.u_stride.value = stride;
    u.u_colorBy.value = look.colorBy; u.u_fade.value = look.fade ? 1 : 0; u.u_usePal.value = look.usePal ? 1 : 0; u.u_rainbow.value = look.rainbow ? 1 : 0;
    if (look.pal) (u.u_pal.value as THREE.Vector3[]).forEach((v, i) => v.fromArray(look.pal![i]));
    (u.u_colA.value as THREE.Vector3).fromArray(look.colA);
    (u.u_colB.value as THREE.Vector3).fromArray(look.colB);
    u.u_bright.value = look.bright; u.u_speedRef.value = look.speedRef;
    u.u_size.value = Math.max(0, look.size); u.u_sizeBy.value = look.sizeBy;
    u.u_rodLen.value = look.shape === 'rod' ? Math.max(0.05, look.rodLength) : 0; u.u_rodStretch.value = look.rodStretch;
    u.u_facing.value = ['motion', 'tumble', 'aligned', 'camera'].indexOf(look.facing);
    u.u_spin.value = look.spin; u.u_time.value = time;
    u.u_voxel.value = voxel ? 1 : 0; u.u_dedupe.value = dedupe ? 1 : 0; u.u_grid.value = g; u.u_tiles.value = grid.tiles;
    u.u_owner.value = dedupe ? this.owner!.texture : null;
    (u.u_gridN.value as THREE.Vector3).set(grid.nx, grid.ny, grid.nz);
    (u.u_boxHalf.value as THREE.Vector3).set(aspect, 1, 1);
    u.u_far.value = Math.max(0, look.farDots);
    u.u_aspect.value = aspect;
    (u.u_viewSize.value as THREE.Vector2).set(into.width, into.height);
    (u.u_eye.value as THREE.Vector3).fromArray(cam.eye); (u.u_fwd.value as THREE.Vector3).fromArray(cam.fwd);
    (u.u_right.value as THREE.Vector3).fromArray(cam.right); (u.u_up.value as THREE.Vector3).fromArray(cam.up);
    u.u_lens.value = cam.lens; u.u_ortho.value = scene ? 0 : cam.ortho; u.u_camDist.value = cam.dist;
    (u.u_proj.value as THREE.Vector2).fromArray(cam.proj ?? [0, 1]);
    u.u_camSrc.value = scene ? 1 : 0; u.u_cam.value = scene?.cam ?? null;
    u.u_depth.value = scene?.depth ? 1 : 0; u.u_field.value = scene?.depth ?? null;
    u.u_ambient.value = look.ambient; u.u_rim.value = look.rim; u.u_edgeW.value = look.edgeWidth;
    mat.uniformsNeedUpdate = true;
    this.mesh.material = mat;
    const prevColor = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(into);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.setClearColor(prevColor, prevAlpha);
    this.geometry.setDrawRange(0, V * drawn);
    renderer.render(this.scene, this.camera);
    this.last = { drawn, vertices: V, deduped: dedupe };
  }

  dispose(): void {
    for (const m of this.mats.values()) m.dispose();
    this.mats.clear();
    this.claimMat.dispose();
    this.owner?.dispose();
    this.owner = null;
  }
}
