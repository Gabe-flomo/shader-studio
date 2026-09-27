/**
 * three-slim.js — the part of three.js a 3D Script layer gets, as `s.three.THREE`.
 *
 * It is bundled from this file into one script that defines the `SSThree`
 * global (the `virtual:three-slim-source` module in vite.config.ts). An
 * exported page with a 3D Script layer carries that script; the app loads the
 * same script on first need (play/threeSource.ts), so both run one build and
 * the app's own three chunk is unchanged. Tests import this module directly.
 * Keeping it to what sketches use makes that script about 550 KB (140 KB
 * gzipped) instead of the 700 KB all of three.js would add to the page. Add a
 * name here and both the app and exported pages have it.
 */
export {
  // Rendering and the scene
  WebGLRenderer, Scene, Group, Object3D, Mesh, InstancedMesh, LineSegments, Line, LineLoop, Points, Sprite, Fog, FogExp2,
  PerspectiveCamera, OrthographicCamera,
  // Geometry
  BufferGeometry, BufferAttribute, Float32BufferAttribute, InstancedBufferAttribute, EdgesGeometry, WireframeGeometry,
  BoxGeometry, SphereGeometry, TorusGeometry, TorusKnotGeometry, CylinderGeometry, ConeGeometry, PlaneGeometry, CircleGeometry, RingGeometry,
  CapsuleGeometry, IcosahedronGeometry, OctahedronGeometry, TetrahedronGeometry, DodecahedronGeometry, LatheGeometry, TubeGeometry,
  // Materials
  MeshBasicMaterial, MeshLambertMaterial, MeshPhongMaterial, MeshStandardMaterial, MeshNormalMaterial, MeshMatcapMaterial, MeshToonMaterial,
  LineBasicMaterial, LineDashedMaterial, PointsMaterial, SpriteMaterial, ShaderMaterial,
  // Lights
  AmbientLight, HemisphereLight, DirectionalLight, PointLight, SpotLight,
  // Textures
  Texture, CanvasTexture, DataTexture,
  // Maths
  Vector2, Vector3, Vector4, Matrix3, Matrix4, Quaternion, Euler, Color, Box3, Sphere, Ray, Raycaster, Plane, MathUtils, Clock,
  CatmullRomCurve3, QuadraticBezierCurve3, CubicBezierCurve3,
  // Constants
  SRGBColorSpace, LinearSRGBColorSpace, FrontSide, BackSide, DoubleSide, AdditiveBlending, NormalBlending, MultiplyBlending, NoBlending,
  LinearFilter, NearestFilter, RepeatWrapping, ClampToEdgeWrapping, MirroredRepeatWrapping, DynamicDrawUsage, StaticDrawUsage,
} from 'three';
