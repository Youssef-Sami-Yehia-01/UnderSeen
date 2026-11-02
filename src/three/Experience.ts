import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import {
  SUN_DIR, UNDERWATER_COLOR, causticUniforms, makeWater, makeSky, makeSeabed, makeLightShafts, makeMarineSnow,
  makePontoon, makeMountains, makeTender, makeMooring, makeFish, SEABED_Y,
} from './environment';
import { buildYacht, type YachtParts } from './yachtModel';
import { FoulingSystem, type Tool } from './fouling';
import { HullShape } from './hull';
import { Robot } from './robot';
import { buildScanCloud } from './scan';
import { makeYacht, mulberry32, type Yacht, type Finding } from '../lib/yacht';
import * as sound from '../lib/sound';

export type Phase = 'landing' | 'intro' | 'dive' | 'clean' | 'scan' | 'result';
export type ToolMode = 'auto' | 'brush' | 'jet';
export type CamMode = 'follow' | 'overview';

export interface CleanStats {
  coverage: number;
  barnaclesTotal: number;
  barnaclesLeft: number;
  removed: number;
  activeTool: Tool | null;
  brushOnBarnacles: boolean;
  seconds: number;
  areaM2: number;
  totalM2: number;
  debrisKg: number;
}
export interface Label { id: string; x: number; y: number; visible: boolean }
export interface Events {
  phase: (p: Phase) => void;
  stats: (s: CleanStats) => void;
  scan: (k: number) => void;
  labels: (l: Label[]) => void;
}

const isTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

interface Particle { p: THREE.Vector3; v: THREE.Vector3; life: number; max: number; kind: 0 | 1; c: THREE.Color }

function simpleSkin(y: Yacht) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = y.antifoul; x.fillRect(0, 0, 256, 64);
  const r = mulberry32(y.seed);
  x.fillStyle = 'rgba(78,95,58,.55)'; x.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 500; i++) { x.fillStyle = ['#5E7A3F', '#4A6131', '#73844A'][(r() * 3) | 0]; x.globalAlpha = 0.5; x.beginPath(); x.arc(r() * 256, r() * 64, 1 + r() * 4, 0, 7); x.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Experience {
  container: HTMLElement;
  ev: Events;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  controls: OrbitControls;
  clock = new THREE.Clock();
  phase: Phase = 'landing';

  // world
  water = makeWater();
  sky = makeSky();
  seabed = makeSeabed();
  shafts = makeLightShafts();
  snow = makeMarineSnow();
  fish = makeFish();
  mountains = makeMountains();
  pontoon = makePontoon(0);
  tender = makeTender();
  hemi = new THREE.HemisphereLight('#D8ECF7', '#4B5A4F', 0.75);
  sun = new THREE.DirectionalLight('#FFE2C0', 2.2);
  fill = new THREE.DirectionalLight('#7FD0D8', 0);
  envAbove: THREE.Texture;
  envUnder: THREE.Texture;
  fogAbove = new THREE.Fog('#E3D3C3', 500, 3200);
  fogUnder = new THREE.FogExp2('#1E5F6D', 0.075);
  private waterDome: THREE.Mesh;
  private camSide = 1;
  underwater = false;

  // yacht
  yacht!: Yacht;
  shape!: HullShape;
  parts!: YachtParts;
  fouling!: FoulingSystem;
  scan!: ReturnType<typeof buildScanCloud>;
  mooring: THREE.Group | null = null;
  neighbours: YachtParts[] = [];
  robot = new Robot();

  // interaction
  toolMode: ToolMode = 'auto';
  camMode: CamMode = 'follow';
  autopilot = false;
  private autoPath: { u: number; t: number }[] = [];
  private autoI = 0;
  private mop: { u: number; t: number; alive: boolean } | null = null;
  private pointerDown = false;
  private target: { u: number; t: number } | null = null;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private camDist = 4.2;
  private camTarget = new THREE.Vector3();
  private heading = new THREE.Vector3(1, 0, 0);
  private activeTool: Tool | null = null;
  private brushOnBarnacles = false;
  private cleanStart = 0;
  private cleanSeconds = 0;
  private statsT = 0;
  private labelsT = 0;
  private popT = 0;
  private seq: { start: number; dur: number; update: (k: number) => void; done?: () => void } | null = null;
  private particles: Particle[] = [];
  private pGeo: THREE.BufferGeometry;
  private pPoints: THREE.Points;
  private readonly P_MAX = 700;
  private findingMarkers: THREE.Mesh[] = [];
  private raf = 0;
  private ro: ResizeObserver;
  private slowFrames = 0;
  private quality = 2;
  shots: Record<string, { now: string; before: string }> = {};
  heroImage = '';
  timeScale = 1;
  private used = false;

  constructor(container: HTMLElement, ev: Events, initial?: Yacht) {
    this.container = container;
    this.ev = ev;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.6 : 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.62;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = 'none';

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 6000);
    this.camera.position.set(20, 6, 18);

    const pm = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.add(makeSky());
    this.envAbove = pm.fromScene(envScene, 0, 0.1, 5000).texture;
    const uScene = new THREE.Scene();
    const grad = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 c = mix(vec3(0.01,0.08,0.11), vec3(0.35,0.75,0.8), smoothstep(-0.3,1.0,h)); gl_FragColor = vec4(c,1.0); }',
    }));
    uScene.add(grad);
    this.envUnder = pm.fromScene(uScene, 0, 0.1, 100).texture;
    pm.dispose();

    const s = this.scene;
    s.environment = this.envAbove;
    s.environmentIntensity = 0.55;
    s.fog = this.fogAbove;
    this.fill.position.set(10, -60, 25);
    this.sun.position.copy(SUN_DIR).multiplyScalar(120);
    s.add(this.hemi, this.sun, this.fill, this.sky, this.water.mesh, this.seabed.group, this.shafts, this.snow, this.fish.fish, this.mountains, this.pontoon, this.tender);
    s.add(this.robot.group, this.robot.tether);
    // underwater sky: lighter toward the surface, dark below, follows the camera
    this.waterDome = new THREE.Mesh(new THREE.SphereGeometry(80, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vD; void main(){ float h = vD.y; vec3 top = vec3(0.05,0.36,0.44); vec3 mid = vec3(0.013,0.114,0.153); vec3 low = vec3(0.004,0.04,0.06); vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.7)) : mix(mid, low, pow(-h, 0.6)); gl_FragColor = vec4(c, 1.0); }',
    }));
    this.waterDome.renderOrder = -2;
    this.waterDome.visible = false;
    s.add(this.waterDome);
    this.robot.group.visible = false;
    this.robot.tether.visible = false;

    // particles (debris pulled into the robot, jet bubbles)
    this.pGeo = new THREE.BufferGeometry();
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.P_MAX * 3), 3));
    this.pGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.P_MAX * 3), 3));
    this.pGeo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(this.P_MAX), 1));
    this.pPoints = new THREE.Points(this.pGeo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uPR: { value: this.renderer.getPixelRatio() } },
      vertexShader: 'attribute float aSize; varying vec3 vC; uniform float uPR; void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = aSize*uPR*(6.0/-mv.z); gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'varying vec3 vC; void main(){ vec2 c = gl_PointCoord-0.5; float r = dot(c,c); if(r>0.25) discard; gl_FragColor = vec4(vC, 0.9*(1.0-r*4.0)); }',
      vertexColors: true,
    }));
    this.pPoints.frustumCulled = false;
    s.add(this.pPoints);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = false;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.minPolarAngle = 0.55;
    this.controls.maxPolarAngle = 1.45;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.45, 0.94);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.setYacht(initial ?? makeYacht('UNDERSEEN'), true);

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: true });

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.loop();
  }

  /* ----------------------------------------------------------------- */
  setYacht(y: Yacht, landing = false) {
    if (this.parts) {
      this.scene.remove(this.parts.group);
      this.parts.dispose();
      this.fouling.dispose();
      this.scan.points.geometry.dispose();
      this.findingMarkers.forEach((m) => m.parent?.remove(m));
      this.findingMarkers = [];
    }
    if (this.mooring) { this.scene.remove(this.mooring); this.mooring = null; }
    this.yacht = y;
    this.shape = new HullShape(y.lengthM, y.beamM);
    this.fouling = new FoulingSystem(y, this.shape);
    this.parts = buildYacht(y, this.fouling.texture);
    this.parts.group.add(this.fouling.mesh);
    this.scan = buildScanCloud(this.shape, y, this.parts.gearPoints);
    this.scan.points.visible = false;
    this.parts.group.add(this.scan.points, this.scan.sheet);
    this.scene.add(this.parts.group);
    const { L, B, D } = this.shape;
    this.pontoon.position.x = -L / 2 - 1.0 - 1.25;
    this.tender.position.set(L * 0.05, 0, B / 2 + 2.8);
    this.tender.rotation.y = 0.15;
    this.mooring = makeMooring(new THREE.Vector3(L / 2 + L * 0.06, 0.4, 0), new THREE.Vector3(L / 2 + 10, SEABED_Y - 0.2, 0));
    this.scene.add(this.mooring);
    this.fish.fish.position.set(L * 0.1, 0, 0);
    this.buildNeighbours();
    this.controls.target.set(0, 1.4, 0);
    const R = L * 1.45 + 6;
    if (landing) this.camera.position.set(R * 0.9, L * 0.3 + 3, R * 0.42);
    this.limitToOpenWater(true);
    this.controls.minDistance = L * 0.8;
    this.controls.maxDistance = L * 3;
    this.robot.group.visible = false;
    this.robot.tether.visible = false;
    this.particles = [];
    this.shots = {};
    void D;
  }

  private buildNeighbours() {
    this.neighbours.forEach((n) => { this.scene.remove(n.group); n.dispose(); });
    this.neighbours = [];
    const px = this.pontoon.position.x;
    let zPos = this.shape.B / 2 + 0.9, zNeg = -this.shape.B / 2 - 0.9;
    ['harbour-1', 'harbour-2', 'harbour-3', 'harbour-4'].forEach((name, i) => {
      const ny = makeYacht(name + this.yacht.seed);
      ny.findings = [];
      const n = buildYacht(ny, simpleSkin(ny), { detail: 'low' });
      const side = i % 2 ? -1 : 1;
      const z = side > 0 ? zPos + ny.beamM / 2 : zNeg - ny.beamM / 2;
      if (side > 0) zPos = z + ny.beamM / 2 + 0.9; else zNeg = z - ny.beamM / 2 - 0.9;
      n.group.position.set(px + 1.25 + 1.0 + ny.lengthM / 2, 0, z + (side > 0 && i === 0 ? 3.2 : 0));
      if (i === 0) n.group.position.z += 2.6; // leave room for the tender
      this.scene.add(n.group);
      n.group.visible = !this.underwater;
      this.neighbours.push(n);
    });
  }

  /* ----------------------------------------------------------------- */
  private resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.composer.setSize(w, h);
    this.bloom.setSize(w / 2, h / 2);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.8 ? 55 : 42;
    this.camera.updateProjectionMatrix();
    (this.pPoints.material as THREE.ShaderMaterial).uniforms.uPR.value = this.renderer.getPixelRatio();
    (this.scan.mat.uniforms.uPR as { value: number }).value = this.renderer.getPixelRatio();
  }

  private setUnderwater(u: boolean) {
    if (u === this.underwater) return;
    this.underwater = u;
    const s = this.scene;
    s.fog = u ? this.fogUnder : this.fogAbove;
    s.background = u ? new THREE.Color('#1E5F6D') : null;
    this.waterDome.visible = u;
    // below the surface only your yacht is shown, so its hull never gets confused with the next berth
    this.neighbours.forEach((n) => { n.group.visible = !u; });
    s.environment = u ? this.envUnder : this.envAbove;
    this.sky.visible = !u;
    this.mountains.visible = !u;
    this.shafts.visible = false;
    this.snow.visible = u;
    this.water.mat.uniforms.uUnder.value = u ? 1 : 0;
    this.hemi.color.set(u ? '#7FD3DC' : '#D8ECF7');
    this.hemi.groundColor.set(u ? '#2F7380' : '#4B5A4F');
    this.hemi.intensity = u ? 1.5 : 0.75;
    this.sun.intensity = u ? 0.8 : 2.2;
    this.sun.color.set(u ? '#9EE3EA' : '#FFE2C0');
    this.fill.intensity = u ? 1.1 : 0;
    s.environmentIntensity = u ? 0.9 : 0.55;
    this.renderer.toneMappingExposure = u ? 1.0 : 0.62;
    sound.setLoops({ ambience: u ? 1 : 0 });
  }

  /* ---------------------------- input ------------------------------ */
  private onDown = (e: PointerEvent) => {
    if (this.phase !== 'clean' || this.camMode !== 'follow') return;
    this.pointerDown = true;
    this.autopilot = false;
    this.pick(e);
  };
  private onMove = (e: PointerEvent) => {
    if (this.pointerDown) this.pick(e);
  };
  private onUp = () => {
    this.pointerDown = false;
    if (!this.autopilot) this.target = null;
  };
  private onWheel = (e: WheelEvent) => {
    if (this.phase === 'clean' && this.camMode === 'follow') this.camDist = THREE.MathUtils.clamp(this.camDist + e.deltaY * 0.002, 1.8, 7);
  };
  private pick(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.parts.underMesh, false)[0];
    if (hit && hit.uv) this.target = { u: THREE.MathUtils.clamp(hit.uv.x, 0.02, 0.98), t: THREE.MathUtils.clamp(hit.uv.y * 2 - 1, -0.985, 0.985) };
  }

  private limitToOpenWater(on: boolean) {
    // the yacht is moored stern-to between neighbours, so keep the orbit on the open-water side
    this.controls.minAzimuthAngle = on ? 0.75 : -Infinity;
    this.controls.maxAzimuthAngle = on ? 2.4 : Infinity;
  }

  zoom(delta: number) { this.camDist = THREE.MathUtils.clamp(this.camDist + delta, 1.8, 7); }

  setTool(m: ToolMode) { this.toolMode = m; }
  setCamMode(m: CamMode) {
    this.camMode = m;
    if (this.phase !== 'clean') return;
    if (m === 'overview') {
      const { L, B, D } = this.shape;
      this.controls.enabled = true;
      this.controls.autoRotate = false;
      this.controls.target.set(0, -D * 0.6, 0);
      this.controls.minPolarAngle = Math.PI / 2 + 0.12;
      this.controls.maxPolarAngle = Math.PI - 0.05;
      this.controls.minDistance = 4; this.controls.maxDistance = L * 1.2;
      this.tweenCamera(new THREE.Vector3(L * 0.2, -D - 3.2, B * 1.5), new THREE.Vector3(0, -D * 0.6, 0), 1.1);
    } else {
      this.controls.enabled = false;
    }
  }
  setAutopilot(on: boolean) {
    this.autopilot = on;
    if (on) {
      this.camMode = 'follow';
      this.controls.enabled = false;
      const path: { u: number; t: number }[] = [];
      const g = this.shape.girth(0.5);
      const rows = Math.max(6, Math.ceil(g / 0.62));
      let dir = 1;
      // start on the side the robot is on
      const startSide = this.robot.t >= 0 ? 1 : -1;
      for (let i = 0; i < rows; i++) {
        const t = startSide * (0.96 - (1.92 * i) / (rows - 1));
        const a = dir > 0 ? 0.03 : 0.97, b = dir > 0 ? 0.97 : 0.03;
        path.push({ u: a, t }, { u: b, t });
        dir *= -1;
      }
      // nearest start
      let best = 0, bd = 1e9;
      path.forEach((p, i) => { const d = Math.hypot(p.u - this.robot.u, p.t - this.robot.t); if (d < bd) { bd = d; best = i; } });
      this.autoPath = path.slice(best).concat(path.slice(0, best));
      this.autoI = 0;
    } else this.target = null;
  }

  /* -------------------------- sequences ---------------------------- */
  private tweenCamera(toPos: THREE.Vector3, toTarget: THREE.Vector3, dur: number, done?: () => void) {
    const p0 = this.camera.position.clone(), t0 = this.controls.target.clone();
    this.seq = {
      start: this.clock.elapsedTime, dur,
      update: (k) => {
        const e = ease(k);
        this.camera.position.lerpVectors(p0, toPos, e);
        this.controls.target.lerpVectors(t0, toTarget, e);
        this.camera.lookAt(this.controls.target);
      },
      done,
    };
  }

  /** Called after the visitor enters their name. */
  showYacht(y: Yacht) {
    if (!this.yacht || this.yacht.owner !== y.owner || this.used) { this.setYacht(y); this.used = false; }
    this.phase = 'intro';
    const { L, B } = this.shape;
    this.controls.enabled = true;
    this.controls.autoRotate = true;
    this.controls.minPolarAngle = 0.75; this.controls.maxPolarAngle = 1.42;
    this.limitToOpenWater(true);
    this.tweenCamera(new THREE.Vector3(L * 1.15 + 4, L * 0.28 + 2.2, B * 0.6 + L * 0.45), new THREE.Vector3(0, 1.3, 0), 2.4);
    this.ev.phase('intro');
  }

  startDive() {
    this.used = true;
    this.phase = 'dive';
    this.ev.phase('dive');
    this.controls.enabled = false;
    this.controls.autoRotate = false;
    this.limitToOpenWater(false);
    this.fogUnder.density = 0.07;
    const { L, B, D } = this.shape;
    const tp = this.tender.position.clone();
    const reel = tp.clone().add(new THREE.Vector3(-1.2, 0.5, 0));
    const attachU = 0.52, attachT = 0.78;
    const attach = this.shape.under(attachU, attachT);
    const n = this.shape.underNormal(attachU, attachT);
    const startCamPos = this.camera.position.clone(), startTarget = this.controls.target.clone();
    const camPath = new THREE.CatmullRomCurve3([
      startCamPos,
      tp.clone().add(new THREE.Vector3(5.5, 2.4, 5.0)),
      tp.clone().add(new THREE.Vector3(2.6, 0.45, 2.6)),
      tp.clone().add(new THREE.Vector3(1.4, -1.4, 1.2)),
      attach.clone().addScaledVector(n, 2.8).add(new THREE.Vector3(-1.4, -0.6, 0)),
    ], false, 'centripetal');
    const tgtPath = new THREE.CatmullRomCurve3([
      startTarget,
      tp.clone().add(new THREE.Vector3(0, 0.2, 0)),
      tp.clone().add(new THREE.Vector3(-0.8, -0.6, -0.4)),
      new THREE.Vector3(0, -D * 0.7, B * 0.2),
      attach.clone(),
    ], false, 'centripetal');
    const robotStart = reel.clone();
    const robotMid = tp.clone().add(new THREE.Vector3(-0.6, -1.8, -0.8));
    const robotEnd = attach.clone().addScaledVector(n, 0.6);
    this.robot.group.visible = true;
    this.robot.tether.visible = true;
    this.robot.group.position.copy(robotStart);
    this.robot.group.quaternion.identity();
    this.camDist = 4.2;
    this.seq = {
      start: this.clock.elapsedTime, dur: 7.2,
      update: (k) => {
        const e = ease(k);
        this.camera.position.copy(camPath.getPointAt(e));
        this.controls.target.copy(tgtPath.getPointAt(e));
        this.camera.lookAt(this.controls.target);
        // robot: lowered from the reel, then flies to the hull
        if (k < 0.45) {
          const kk = ease(k / 0.45);
          this.robot.group.position.lerpVectors(robotStart, robotMid, kk);
        } else if (k < 0.9) {
          const kk = ease((k - 0.45) / 0.45);
          this.robot.group.position.lerpVectors(robotMid, robotEnd, kk);
          this.robot.group.lookAt(robotEnd.clone().add(new THREE.Vector3(1, 0, 0)));
          this.robot.group.rotateY(-Math.PI / 2);
        } else {
          this.robot.placeOnHull(this.shape, attachU, attachT, this.heading);
        }
      },
      done: () => {
        this.robot.u = attachU; this.robot.t = attachT;
        this.robot.onHull = true;
        this.phase = 'clean';
        this.camMode = 'follow';
        this.cleanStart = this.clock.elapsedTime;
        this.camTarget.copy(this.robot.group.position);
        this.ev.phase('clean');
      },
    };
    void L;
  }

  startScan() {
    this.phase = 'scan';
    this.ev.phase('scan');
    this.autopilot = false;
    this.target = null;
    this.controls.enabled = false;
    this.cleanSeconds = this.clock.elapsedTime - this.cleanStart;
    sound.setLoops({ brush: 0, jet: 0 });
    const { L, B, D } = this.shape;
    this.scan.points.visible = true;
    this.scan.sheet.visible = true;
    this.scan.mat.uniforms.uShowFind.value = 0;
    this.fouling.mesh.visible = true;
    const camPos = new THREE.Vector3(L * 0.1, -D - L * 0.3, B * 0.6 + L * 0.68);
    this.fogUnder.density = 0.03;
    const camTgt = new THREE.Vector3(0, -D * 0.55, 0);
    const p0 = this.camera.position.clone(), t0 = this.controls.target.clone();
    sound.sweep(6.0);
    this.seq = {
      start: this.clock.elapsedTime, dur: 7.0,
      update: (k) => {
        const kc = Math.min(1, k / 0.18);
        const e = ease(kc);
        const orbit = (k * 0.5 - 0.1);
        const cp = camPos.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), orbit);
        this.camera.position.lerpVectors(p0, cp, e);
        this.controls.target.lerpVectors(t0, camTgt, e);
        this.camera.lookAt(this.controls.target);
        const ks = THREE.MathUtils.clamp((k - 0.12) / 0.8, 0, 1);
        const u = 0.0 + ks * 1.04;
        const x = (u - 0.5) * L;
        this.scan.mat.uniforms.uSweep.value = x;
        this.scan.sheet.position.x = x;
        if (ks > 0 && ks < 1) this.robot.placeOnHull(this.shape, Math.min(0.97, Math.max(0.03, u)), 0.02, this.heading.set(1, 0, 0));
        this.ev.scan(ks);
      },
      done: () => {
        this.scan.sheet.visible = false;
        this.scan.mat.uniforms.uShowFind.value = 1;
        this.addFindingMarkers();
        this.phase = 'result';
        this.controls.enabled = true;
        this.controls.autoRotate = true;
        this.controls.autoRotateSpeed = 0.5;
        this.controls.minPolarAngle = Math.PI / 2 + 0.1;
        this.controls.maxPolarAngle = Math.PI - 0.05;
        this.controls.minDistance = 4; this.controls.maxDistance = L * 1.6;
        this.ev.phase('result');
      },
    };
  }

  findingWorld(f: Finding) {
    if (f.kind === 'propeller' || f.kind === 'rope') {
      const idx = f.side === 'port' ? 0 : 1;
      const s = this.parts.shafts[idx];
      return f.kind === 'propeller' ? s.to.clone() : s.from.clone().lerp(s.to, 0.88);
    }
    return this.shape.under(f.u, f.t);
  }

  private addFindingMarkers() {
    const mat = new THREE.MeshBasicMaterial({ color: '#FF6B4A', transparent: true, opacity: 0.95, side: THREE.DoubleSide, toneMapped: false, depthTest: false });
    for (const f of this.yacht.findings) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.3, 40), mat);
      m.position.copy(this.findingWorld(f));
      m.renderOrder = 10;
      m.userData.id = f.id;
      this.parts.group.add(m);
      this.findingMarkers.push(m);
    }
  }

  getStats(): CleanStats {
    const f = this.fouling;
    const area = this.shape.area();
    const cov = f.coverage();
    return {
      coverage: cov,
      barnaclesTotal: f.total,
      barnaclesLeft: f.alive,
      removed: f.removed,
      activeTool: this.activeTool,
      brushOnBarnacles: this.brushOnBarnacles,
      seconds: this.phase === 'clean' ? this.clock.elapsedTime - this.cleanStart : this.cleanSeconds,
      areaM2: area * cov,
      totalM2: area,
      debrisKg: area * cov * (this.yacht.fouling === 'heavy' ? 0.55 : this.yacht.fouling === 'medium' ? 0.3 : 0.12) + f.removed * 0.004,
    };
  }

  /* ---------------------------- shots ------------------------------ */
  private grab(cam: THREE.PerspectiveCamera, aspectOut: number, w = 900) {
    const canvas = this.renderer.domElement;
    cam.aspect = canvas.width / canvas.height;
    cam.updateProjectionMatrix();
    this.renderer.render(this.scene, cam);
    const cw = canvas.width, ch = canvas.height;
    let sw = cw, sh = cw / aspectOut;
    if (sh > ch) { sh = ch; sw = ch * aspectOut; }
    const out = document.createElement('canvas');
    out.width = w; out.height = Math.round(w / aspectOut);
    out.getContext('2d')!.drawImage(canvas, (cw - sw) / 2, (ch - sh) / 2, sw, sh, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', 0.86);
  }

  heroShot() {
    const { L, B } = this.shape;
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 6000);
    const wasUnder = this.underwater;
    this.setUnderwater(false);
    const robotVis = this.robot.group.visible;
    this.robot.group.visible = false; this.robot.tether.visible = false;
    const canvas = this.renderer.domElement;
    const aspect = canvas.width / canvas.height;
    const k = 1 / Math.min(1, aspect / 1.6);
    cam.fov = 28;
    cam.position.set((L * 1.15 + 4) * k, (L * 0.3 + 2.4) * k, (B * 0.25 + L * 0.16) * k);
    cam.lookAt(-L * 0.08, 1.0, 0);
    const img = this.grab(cam, 16 / 10, 1000);
    this.robot.group.visible = robotVis; this.robot.tether.visible = robotVis;
    this.setUnderwater(wasUnder);
    return img;
  }

  private takeFindingShots() {
    const cam = new THREE.PerspectiveCamera(40, 1, 0.02, 200);
    const robotVis = this.robot.group.visible;
    this.robot.group.visible = false; this.robot.tether.visible = false;
    this.scan.points.visible = false;
    this.findingMarkers.forEach((m) => (m.visible = false));
    this.setUnderwater(true);
    const flash = new THREE.PointLight('#F2FBFF', 9, 6, 1.6);
    this.scene.add(flash);
    const fogD = this.fogUnder.density;
    this.fogUnder.density = 0.05;
    for (const f of this.yacht.findings) {
      const p = this.findingWorld(f);
      let pos: THREE.Vector3;
      if (f.kind === 'propeller' || f.kind === 'rope') {
        pos = p.clone().add(new THREE.Vector3(0.9, -0.55, (f.side === 'port' ? -1 : 1) * 1.1));
      } else {
        const n = this.shape.underNormal(f.u, f.t);
        pos = p.clone().addScaledVector(n, f.kind === 'scrape' ? 0.85 : 1.15).add(new THREE.Vector3(-0.15, -0.1, 0));
      }
      cam.position.copy(pos);
      cam.lookAt(p);
      flash.position.copy(pos).add(new THREE.Vector3(0, 0.15, 0));
      const now = this.grab(cam, 4 / 3, 800);
      // the same view at the previous scan
      this.fouling.showPrevious(true);
      if (this.parts.rope) this.parts.rope.visible = false;
      const bent = this.parts.bentBlade;
      const rx = bent ? bent.children[0].rotation.x : 0;
      if (bent) bent.children[0].rotateX(-0.5);
      const before = this.grab(cam, 4 / 3, 800);
      if (bent) bent.children[0].rotation.x = rx;
      if (this.parts.rope) this.parts.rope.visible = true;
      this.fouling.showPrevious(false);
      this.shots[f.id] = { now, before };
    }
    this.scene.remove(flash);
    flash.dispose();
    this.fogUnder.density = fogD;
    this.robot.group.visible = robotVis; this.robot.tether.visible = robotVis;
    this.scan.points.visible = true;
    this.findingMarkers.forEach((m) => (m.visible = true));
  }

  planImages(levels: number[], findingFrom: number) {
    return levels.map((g, i) => this.fouling.planImage(g, i >= findingFrom).canvas.toDataURL('image/jpeg', 0.85));
  }

  /* ----------------------------- loop ------------------------------ */
  private spawn(p: THREE.Vector3, v: THREE.Vector3, life: number, kind: 0 | 1, c: THREE.Color) {
    if (this.particles.length >= this.P_MAX) this.particles.shift();
    this.particles.push({ p, v, life, max: life, kind, c });
  }

  private updateParticles(dt: number) {
    const rp = this.robot.group.position;
    const pos = this.pGeo.attributes.position as THREE.BufferAttribute;
    const col = this.pGeo.attributes.color as THREE.BufferAttribute;
    const size = this.pGeo.attributes.aSize as THREE.BufferAttribute;
    let n = 0;
    const keep: Particle[] = [];
    for (const q of this.particles) {
      q.life -= dt;
      if (q.life <= 0) continue;
      if (q.kind === 0) {
        // debris sucked into the robot
        const d = rp.clone().sub(q.p);
        const dist = d.length();
        if (dist < 0.12) continue;
        q.v.addScaledVector(d.normalize(), dt * 9).multiplyScalar(0.9);
      } else {
        // bubbles rise and wobble
        q.v.y += dt * 1.6;
        q.v.multiplyScalar(0.97);
        q.p.x += Math.sin(q.life * 9 + q.max) * 0.004;
        if (q.p.y > -0.05) continue;
      }
      q.p.addScaledVector(q.v, dt);
      keep.push(q);
      pos.setXYZ(n, q.p.x, q.p.y, q.p.z);
      const a = Math.min(1, q.life / q.max * 2);
      col.setXYZ(n, q.c.r * a, q.c.g * a, q.c.b * a);
      size.setX(n, q.kind === 0 ? 0.55 : 0.4 + (1 - q.life / q.max) * 0.5);
      n++;
    }
    this.particles = keep;
    this.pGeo.setDrawRange(0, n);
    pos.needsUpdate = true; col.needsUpdate = true; size.needsUpdate = true;
  }

  private stepClean(dt: number) {
    const s = this.shape;
    const r = this.robot;
    if (this.autopilot) {
      const wp = this.autoPath[this.autoI];
      if (wp) this.target = wp;
      else {
        // mop-up: go back for barnacles the rows missed
        const f = this.fouling;
        if (f.alive > Math.max(4, f.total * 0.03)) {
          if (!this.mop || !this.mop.alive) {
            let best: typeof this.mop = null, bd = 1e9;
            const g = s.girth(r.u);
            for (const b of f.barnacles) {
              if (!b.alive) continue;
              const d = Math.hypot((b.u - r.u) * s.L, ((b.t - r.t) / 2) * g);
              if (d < bd) { bd = d; best = b; }
            }
            this.mop = best;
          }
          if (this.mop) this.target = { u: this.mop.u, t: this.mop.t };
        } else { this.autopilot = false; this.target = null; this.mop = null; }
      }
    }
    let moving = false;
    const working = this.pointerDown || this.autopilot;
    const autoTool = this.toolMode === 'auto' || this.autopilot;
    const pickTool = (): { tool: Tool; near: number } => {
      const near = this.fouling.barnaclesNear(r.u, r.t, 0.44).length;
      return { tool: autoTool ? (near > 0 ? 'jet' : 'brush') : (this.toolMode as Tool), near };
    };
    let cur = pickTool();
    if (this.target && working) {
      // move in small steps and choose the tool at every step, so it works at any frame rate
      let remaining = dt;
      let guard = 0;
      while (remaining > 1e-4 && guard++ < 400 && this.target) {
        cur = pickTool();
        const speed = cur.tool === 'jet' ? (this.autopilot ? 1.3 : 1.5) : this.autopilot ? 5.2 : 3.4;
        const g = s.girth(r.u);
        const du = (this.target.u - r.u) * s.L, dtm = ((this.target.t - r.t) / 2) * g;
        const dm = Math.hypot(du, dtm);
        if (dm <= 0.02) {
          if (this.autopilot && this.autoI < this.autoPath.length) { this.autoI++; this.target = this.autoPath[this.autoI] ?? this.target; if (this.autoI < this.autoPath.length) continue; }
          break;
        }
        const stepLen = Math.min(dm, speed * remaining, 0.08);
        const used = stepLen / speed;
        r.u = THREE.MathUtils.clamp(r.u + ((du / dm) * stepLen) / s.L, 0.02, 0.98);
        r.t = THREE.MathUtils.clamp(r.t + ((dtm / dm) * stepLen) / (g / 2), -0.985, 0.985);
        this.cleanHere(cur.tool, used);
        remaining -= used;
        moving = true;
        const a = s.under(r.u, r.t), b = s.under(r.u + (du / s.L) * 0.01, r.t + (dtm / (g / 2)) * 0.01);
        const h = b.sub(a);
        if (h.lengthSq() > 1e-8) this.heading.lerp(h.normalize(), 0.08).normalize();
      }
      // time left over is spent working in place (lets the jet finish barnacles)
      if (remaining > 1e-4) this.cleanHere(cur.tool, remaining);
    } else if (working) {
      this.cleanHere(cur.tool, dt);
    }
    const tool: Tool | null = working ? cur.tool : null;
    this.activeTool = tool;
    this.brushOnBarnacles = working && cur.tool === 'brush' && cur.near > 0;
    r.placeOnHull(s, r.u, r.t, this.heading);
    r.animate(dt, this.activeTool === 'brush', this.activeTool === 'jet');
    sound.setLoops({ brush: this.activeTool === 'brush' ? 1 : 0, jet: this.activeTool === 'jet' ? 1 : 0 });
    this.fouling.flush();

    // debris suction ring
    if (this.activeTool) {
      const n = s.underNormal(r.u, r.t);
      const center = s.under(r.u, r.t);
      const tangent = new THREE.Vector3().crossVectors(n, new THREE.Vector3(0, 0, 1)).normalize();
      const bit = new THREE.Vector3().crossVectors(n, tangent).normalize();
      const count = this.activeTool === 'jet' ? 3 : 4;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2, rad = 0.35 + Math.random() * 0.35;
        const p = center.clone().addScaledVector(tangent, Math.cos(a) * rad).addScaledVector(bit, Math.sin(a) * rad).addScaledVector(n, 0.03);
        const c = new THREE.Color().setHSL(0.2 + Math.random() * 0.06, 0.35, 0.28 + Math.random() * 0.15);
        this.spawn(p, new THREE.Vector3(), 1.2, 0, c);
      }
      if (this.activeTool === 'jet') {
        for (let i = 0; i < 5; i++) {
          const p = r.group.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, -0.05, (Math.random() - 0.5) * 0.4));
          this.spawn(p, n.clone().multiplyScalar(0.4 + Math.random() * 0.4).add(new THREE.Vector3(0, 0.3, 0)), 1.6 + Math.random(), 1, new THREE.Color('#D8F6F8'));
        }
      }
    }

    // camera
    if (this.camMode === 'follow') {
      const rp = r.group.position;
      const n = s.underNormal(r.u, r.t);
      // stay on the robot's side of the boat (with some hysteresis) and look along the hull, not straight up at it
      if (r.t > 0.18) this.camSide = 1; else if (r.t < -0.18) this.camSide = -1;
      const d = this.camDist;
      const want = rp.clone()
        .addScaledVector(n, d * 0.55)
        .add(new THREE.Vector3(-d * 0.5, -d * 0.5, this.camSide * d * 0.55));
      want.y = Math.min(want.y, -0.3);
      want.y = Math.max(want.y, SEABED_Y + 0.8);
      const k = 1 - Math.pow(0.02, dt);
      this.camera.position.lerp(want, k);
      this.camTarget.lerp(rp, k * 1.4);
      this.camera.lookAt(this.camTarget);
      this.controls.target.copy(this.camTarget);
    } else {
      this.controls.update();
      if (this.camera.position.y > -0.35) this.camera.position.y = -0.35;
    }
  }

  private cleanHere(tool: Tool, dt: number) {
    const r = this.robot;
    const radius = tool === 'jet' ? 0.4 : 0.48;
    const res = this.fouling.cleanAt(r.u, r.t, radius, tool, dt);
    if (res.popped.length) {
      for (const b of res.popped) {
        for (let i = 0; i < 4; i++) {
          this.spawn(b.pos.clone().addScaledVector(b.normal, 0.04), b.normal.clone().multiplyScalar(0.3 + Math.random() * 0.5).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, -0.2, (Math.random() - 0.5) * 0.4)), 1.4, 0, new THREE.Color('#E6DFCB'));
        }
      }
      if (this.clock.elapsedTime - this.popT > 0.05) { sound.pop(); this.popT = this.clock.elapsedTime; }
    }
  }

  private emitLabels() {
    if (!this.findingMarkers.length) return;
    const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
    const out: Label[] = this.findingMarkers.map((m) => {
      const p = m.getWorldPosition(new THREE.Vector3()).project(this.camera);
      return { id: m.userData.id as string, x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h, visible: p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1 };
    });
    this.ev.labels(out);
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta()) * this.timeScale;
    const t = this.clock.elapsedTime;
    causticUniforms.uTime.value = t;
    this.scan.mat.uniforms.uTime.value = t;
    (this.scan.sheetMat.uniforms.uTime as { value: number }).value = t;
    this.fish.update(t);

    if (this.seq) {
      const k = Math.min(1, (t - this.seq.start) / this.seq.dur);
      this.seq.update(k);
      if (k >= 1) { const d = this.seq.done; this.seq = null; d?.(); }
    } else if (this.phase === 'clean') {
      this.stepClean(dt);
    } else if (this.controls.enabled) {
      this.controls.update();
      if ((this.phase === 'result') && this.camera.position.y > -0.35) this.camera.position.y = -0.35;
      if ((this.phase === 'landing' || this.phase === 'intro') && this.camera.position.y < 0.8) this.camera.position.y = 0.8;
    }

    if (this.phase === 'result') {
      this.findingMarkers.forEach((m) => { m.lookAt(this.camera.position); const s = 1 + Math.sin(t * 4) * 0.12; m.scale.setScalar(s); });
    }
    if (this.robot.tether.visible) this.robot.updateTether(this.tender.position.clone().add(new THREE.Vector3(-1.2, 0.5, 0)));
    if (this.phase === 'dive' || this.phase === 'scan') this.robot.animate(dt, false, false);

    this.setUnderwater(this.camera.position.y < 0);
    this.snow.position.copy(this.camera.position);
    this.waterDome.position.copy(this.camera.position);
    this.shafts.children.forEach((m, i) => { m.rotation.z = 0.3 + Math.sin(t * 0.15 + i) * 0.06; });
    // gentle yacht motion above water
    if (this.parts) {
      const bob = Math.sin(t * 0.6) * 0.03;
      this.parts.group.position.y = this.phase === 'landing' || this.phase === 'intro' ? bob : 0;
      this.parts.group.rotation.x = this.phase === 'landing' || this.phase === 'intro' ? Math.sin(t * 0.45) * 0.006 : 0;
    }
    this.updateParticles(dt);

    const now = performance.now();
    if (now - this.statsT > 120 && (this.phase === 'clean')) { this.statsT = now; this.ev.stats(this.getStats()); }
    if (now - this.labelsT > 60 && this.phase === 'result') { this.labelsT = now; this.emitLabels(); }

    this.applyViewOffset();
    if (this.quality >= 2 && this.underwater) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);

    // adaptive quality
    if (dt > 0.034) this.slowFrames++; else this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 90 && this.quality > 0) {
      this.quality--;
      this.slowFrames = 0;
      if (this.quality === 1) this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
      if (this.quality === 0) this.renderer.setPixelRatio(1);
      this.resize();
    }
  };

  private offsetOn = false;
  private panelCheck = 0;
  private panelInset: [number, number] = [0, 0];
  private applyViewOffset() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const want = (this.phase === 'landing' || this.phase === 'intro') && w > 900 && !this.seq;
    // while cleaning, keep the robot in the part of the screen the control panel doesn't cover
    let ox = 0, oy = 0;
    if (this.phase === 'clean' && this.camMode === 'follow') {
      const now = performance.now();
      if (now - this.panelCheck > 400) {
        this.panelCheck = now;
        const el = document.querySelector('.hud-panel');
        const r = el?.getBoundingClientRect();
        this.panelInset = !r ? [0, 0] : r.width < w * 0.6 ? [-r.right / 2, 0] : [0, (h - r.top) * 0.45];
      }
      [ox, oy] = this.panelInset;
    }
    if (want) {
      this.camera.setViewOffset(w, h, -w * 0.17, 0, w, h);
      this.offsetOn = true;
    } else if (ox || oy) {
      this.camera.setViewOffset(w, h, ox, oy, w, h);
      this.offsetOn = true;
    } else if (this.offsetOn) {
      this.camera.clearViewOffset();
      this.offsetOn = false;
    }
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.controls.dispose();
    this.renderer.dispose();
    el.remove();
  }
}
