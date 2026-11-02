import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeYacht, mulberry32 } from '../lib/yacht';
import { buildTemplate } from './yachtModel';

/*
 * Hurghada-style marina around the hero yacht:
 * rows of moored yachts (instanced), the stern-to quay with a palm promenade,
 * low white and sand-coloured buildings with arcades and rooftop clutter, the town behind,
 * a desert plain and the Red Sea Hills.
 */

const FLOOR = 3.4;
const BAY = 4;

/** Facade atlas: bottom half a ground-floor arcade bay, top half an upper-floor bay with a window and balcony. */
function facadeTexture() {
  const W = 256, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d')!;
  // canvas y=0 is the top of the image = v=1 (upper floor), y=256..512 = v=0..0.5 (ground floor)
  x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, W, H);
  const wallNoise = (y0: number) => { for (let i = 0; i < 1800; i++) { x.fillStyle = `rgba(120,100,80,${Math.random() * 0.05})`; x.fillRect(Math.random() * W, y0 + Math.random() * 256, 2, 2); } };
  wallNoise(0); wallNoise(256);
  // upper floor: window with frame, small balcony, slab line
  x.fillStyle = 'rgba(0,0,0,.1)'; x.fillRect(0, 0, W, 10);
  x.fillStyle = '#E9E4DA'; x.fillRect(58, 58, 140, 150);
  x.fillStyle = '#1D2A33'; x.fillRect(68, 68, 120, 128);
  x.fillStyle = 'rgba(160,200,215,.35)'; x.fillRect(68, 68, 60, 128);
  x.fillStyle = '#E9E4DA'; x.fillRect(125, 68, 6, 128);
  x.fillStyle = '#BDB6A8'; x.fillRect(48, 196, 160, 12);
  for (let k = 0; k < 9; k++) { x.fillStyle = '#9A9287'; x.fillRect(52 + k * 19, 168, 3, 30); }
  x.fillStyle = '#9A9287'; x.fillRect(48, 166, 160, 4);
  // ground floor: arch with shop window
  const gy = 256;
  x.fillStyle = 'rgba(0,0,0,.12)'; x.fillRect(0, gy, W, 8);
  x.fillStyle = '#2A2724';
  x.beginPath(); x.moveTo(40, gy + 256); x.lineTo(40, gy + 110); x.arc(128, gy + 110, 88, Math.PI, 0); x.lineTo(216, gy + 256); x.closePath(); x.fill();
  x.fillStyle = 'rgba(255,214,150,.35)'; x.fillRect(58, gy + 140, 140, 116);
  x.fillStyle = '#C9B48E'; x.fillRect(40, gy + 120, 176, 10);
  x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(0, gy + 244, W, 12);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** A box with world-scaled facade UVs, written straight into arrays. */
class BoxBuilder {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = [];
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, n: THREE.Vector3, uvs: number[], color: THREE.Color) {
    for (const [p, i] of [[a, 0], [b, 1], [c, 2], [a, 0], [c, 2], [d, 3]] as const) {
      this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.uv.push(uvs[i * 2], uvs[i * 2 + 1]); this.col.push(color.r, color.g, color.b);
    }
  }
  /** Box from (x0,y0,z0) to (x1,y1,z1); side faces get facade UVs in [v0, v1], the top a plain patch. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, v0: number, v1: number, color: THREE.Color, plain = false) {
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const P = [0.04, 0.6, 0.04, 0.6, 0.04, 0.6, 0.04, 0.6];
    const side = (len: number) => (plain ? P : [0, v0, len / BAY, v0, len / BAY, v1, 0, v1]);
    const dz = z1 - z0, dx = x1 - x0;
    this.quad(V(x1, y0, z0), V(x1, y0, z1), V(x1, y1, z1), V(x1, y1, z0), V(1, 0, 0), side(dz), color);
    this.quad(V(x0, y0, z1), V(x0, y0, z0), V(x0, y1, z0), V(x0, y1, z1), V(-1, 0, 0), side(dz), color);
    this.quad(V(x0, y0, z0), V(x1, y0, z0), V(x1, y1, z0), V(x0, y1, z0), V(0, 0, -1), side(dx), color);
    this.quad(V(x1, y0, z1), V(x0, y0, z1), V(x0, y1, z1), V(x1, y1, z1), V(0, 0, 1), side(dx), color);
    this.quad(V(x0, y1, z0), V(x1, y1, z0), V(x1, y1, z1), V(x0, y1, z1), V(0, 1, 0), P, color);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

function palmTextures() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 512;
  const x = c.getContext('2d')!;
  x.clearRect(0, 0, 128, 512);
  // rachis down the middle, leaflets angled outwards
  x.strokeStyle = '#6F7A3E'; x.lineWidth = 5;
  x.beginPath(); x.moveTo(64, 0); x.lineTo(64, 512); x.stroke();
  for (let y = 12; y < 500; y += 7) {
    const len = 58 * Math.sin((y / 512) * Math.PI) + 8;
    for (const s of [-1, 1]) {
      x.strokeStyle = Math.random() < 0.5 ? '#4F7535' : '#64873E';
      x.lineWidth = 3;
      x.beginPath(); x.moveTo(64, y); x.lineTo(64 + s * len, y + len * 0.55); x.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const b = document.createElement('canvas');
  b.width = 64; b.height = 256;
  const y = b.getContext('2d')!;
  y.fillStyle = '#8A7558'; y.fillRect(0, 0, 64, 256);
  for (let k = 0; k < 256; k += 9) { y.fillStyle = 'rgba(60,45,30,.45)'; y.fillRect(0, k, 64, 3); y.fillStyle = 'rgba(200,180,150,.25)'; y.fillRect(0, k + 3, 64, 2); }
  const bark = new THREE.CanvasTexture(b);
  bark.colorSpace = THREE.SRGBColorSpace;
  bark.wrapT = THREE.RepeatWrapping;
  return { leaf: t, bark };
}

/** One palm crown: arched fronds round the top of the trunk. */
function crownGeometry() {
  const geos: THREE.BufferGeometry[] = [];
  const frond = (len: number, droop: number) => {
    const g = new THREE.PlaneGeometry(1.1, len, 1, 10);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const yy = p.getY(i) + len / 2; // 0 at the trunk
      const k = yy / len;
      p.setXYZ(i, p.getX(i) * (0.35 + Math.sin(k * Math.PI) * 0.9), Math.sin(k * 1.6) * len * 0.45 - droop * k * k * len, yy * 0.95);
      // fold the leaflets into a shallow V
      p.setY(i, p.getY(i) - Math.abs(p.getX(i)) * 0.25);
    }
    g.computeVertexNormals();
    return g;
  };
  for (let i = 0; i < 12; i++) {
    const g = frond(3.2 + (i % 3) * 0.4, 0.55 + (i % 4) * 0.12);
    g.rotateY((i / 12) * Math.PI * 2 + (i % 2) * 0.2);
    geos.push(g);
  }
  for (let i = 0; i < 4; i++) {
    const g = frond(2.0, -0.2);
    g.rotateX(-0.6);
    g.rotateY((i / 4) * Math.PI * 2 + 0.4);
    geos.push(g);
  }
  const m = mergeGeometries(geos, false)!;
  geos.forEach((g) => g.dispose());
  return m;
}

function trunkGeometry(h: number) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) { const k = i / 8; pts.push(new THREE.Vector3(Math.sin(k * 1.4) * 0.6 * k, k * h, 0)); }
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.2, 8, false);
  const p = g.attributes.position as THREE.BufferAttribute;
  // taper towards the crown
  for (let i = 0; i < p.count; i++) {
    const yy = p.getY(i) / h;
    const cx = Math.sin(yy * 1.4) * 0.6 * yy;
    const sc = 1.25 - yy * 0.45;
    p.setX(i, cx + (p.getX(i) - cx) * sc); p.setZ(i, p.getZ(i) * sc);
  }
  g.computeVertexNormals();
  return g;
}

/** Ridged noise for the Red Sea Hills. */
function makeNoise(seed: number) {
  const r = mulberry32(seed);
  const size = 256;
  const g = new Float32Array(size * size);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const n = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const s = (a: number) => ((a % size) + size) % size;
    const v = (i: number, j: number) => g[s(j) * size + s(i)];
    const ux = xf * xf * (3 - 2 * xf), uy = yf * yf * (3 - 2 * yf);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(v(xi, yi), v(xi + 1, yi), ux), THREE.MathUtils.lerp(v(xi, yi + 1), v(xi + 1, yi + 1), ux), uy);
  };
  const ridged = (x: number, y: number, oct: number) => {
    let a = 0.5, f = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) { const v = 1 - Math.abs(n(x * f, y * f) * 2 - 1); sum += v * v * a; norm += a; a *= 0.5; f *= 2.03; }
    return sum / norm;
  };
  return { n, ridged };
}

/** The Red Sea Hills west of Hurghada: three ranges of bare, ridged rock fading into haze. */
export function makeMountains() {
  const { ridged, n } = makeNoise(7);
  const g = new THREE.Group();
  const ranges = [
    { dist: 1300, depth: 500, height: 210, rock: '#A5735A', shadow: '#6E4A3B', haze: '#D7C2B2', off: 0, seg: 300 },
    { dist: 2300, depth: 700, height: 360, rock: '#B48B76', shadow: '#8A6656', haze: '#D9CCC3', off: 40, seg: 260 },
    { dist: 3600, depth: 900, height: 520, rock: '#BFA596', shadow: '#A08A80', haze: '#DCD3CE', off: 90, seg: 220 },
  ];
  const sun = new THREE.Vector3(0.2, 0.62, 0.76).normalize(); // the sun in the ranges' own frame (east is local +z)
  for (const R of ranges) {
    const width = 9000;
    const geo = new THREE.PlaneGeometry(width, R.depth, R.seg, 24);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const front = (R.depth / 2 - z) / R.depth; // 0 at the edge facing the sea (east), 1 at the back
      const ridge = ridged(x * 0.0016 + R.off, z * 0.0016 + R.off, 5);
      const mass = 0.35 + 0.65 * n(x * 0.0007 + R.off, 3.3);
      const rise = Math.pow(Math.sin(Math.min(1, front * 1.25) * Math.PI * 0.5), 1.4);
      pos.setY(i, Math.max(0, (ridge * 0.75 + 0.25) * mass * R.height * rise) - 4);
    }
    geo.computeVertexNormals();
    const nor = geo.attributes.normal as THREE.BufferAttribute;
    const colors: number[] = [];
    const cRock = new THREE.Color(R.rock), cShadow = new THREE.Color(R.shadow), cHaze = new THREE.Color(R.haze);
    const nv = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      nv.fromBufferAttribute(nor, i);
      const lit = Math.max(0, nv.dot(sun));
      const steep = 1 - nv.y;
      const c = cShadow.clone().lerp(cRock, Math.min(1, lit * 1.3));
      c.lerp(cShadow, steep * 0.25);
      c.lerp(cHaze, 0.25 + 0.1 * (pos.getY(i) / R.height));
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }));
    // ranges run north–south (along z), west of the town (−x)
    m.rotation.y = Math.PI / 2;
    m.position.set(-R.dist - R.depth / 2, 0, 0);
    g.add(m);
  }
  return g;
}

export class Marina {
  group = new THREE.Group();
  shore = new THREE.Group();
  boats: { body: THREE.InstancedMesh; glass: THREE.InstancedMesh; L: number; B: number }[] = [];
  walkway: THREE.Mesh;
  private disposables: { dispose: () => void }[] = [];

  constructor() {
    const T = <X extends { dispose: () => void }>(o: X) => { this.disposables.push(o); return o; };
    const r = mulberry32(2024);
    this.group.add(this.shore);

    /* yachts moored further away */
    const bodyMat = T(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0, side: THREE.DoubleSide }));
    const glassMat = T(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.06, metalness: 0.7, side: THREE.DoubleSide }));
    for (const name of ['row-fly', 'row-sport', 'row-exp']) {
      let y = makeYacht(name);
      let guard = 0;
      const want = name === 'row-fly' ? 'flybridge' : name === 'row-sport' ? 'sport' : 'explorer';
      while (y.style !== want && guard < 200) y = makeYacht(name + guard++);
      const t = buildTemplate(y);
      const body = new THREE.InstancedMesh(T(t.body), bodyMat, 40);
      const glass = new THREE.InstancedMesh(T(t.glass), glassMat, 40);
      body.count = 0; glass.count = 0;
      this.boats.push({ body, glass, L: t.length, B: t.beam });
      this.group.add(body, glass);
    }

    /* the walkway from our pontoon to the quay */
    this.walkway = new THREE.Mesh(T(new THREE.BoxGeometry(1, 0.35, 2.2)), T(new THREE.MeshStandardMaterial({ color: '#8E8A82', roughness: 0.85 })));
    this.group.add(this.walkway);

    /* shore, built with the quay edge at x = 0 and the land towards −x */
    const S = this.shore;
    const concrete = T(new THREE.MeshStandardMaterial({ color: '#C9C2B4', roughness: 0.9 }));
    const wall = new THREE.Mesh(T(new THREE.BoxGeometry(2, 9, 600)), concrete);
    wall.position.set(-1, -3.5, 0);
    S.add(wall);
    const edge = new THREE.Mesh(T(new THREE.BoxGeometry(0.6, 0.25, 600)), T(new THREE.MeshStandardMaterial({ color: '#E7E2D8', roughness: 0.8 })));
    edge.position.set(-0.3, 1.12, 0);
    S.add(edge);
    // promenade paving
    const pave = document.createElement('canvas');
    pave.width = 256; pave.height = 256;
    const px = pave.getContext('2d')!;
    px.fillStyle = '#D9CDB6'; px.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) { px.fillStyle = `rgba(${(i + j) % 2 ? 150 : 200},${(i + j) % 2 ? 130 : 180},110,.18)`; px.fillRect(i * 16, j * 16, 15, 15); }
    const paveTex = T(new THREE.CanvasTexture(pave));
    paveTex.colorSpace = THREE.SRGBColorSpace;
    paveTex.wrapS = paveTex.wrapT = THREE.RepeatWrapping;
    paveTex.repeat.set(4, 150);
    paveTex.anisotropy = 8;
    const prom = new THREE.Mesh(T(new THREE.PlaneGeometry(18, 600)), T(new THREE.MeshStandardMaterial({ map: paveTex, roughness: 0.85 })));
    prom.rotation.x = -Math.PI / 2;
    prom.position.set(-9, 1.0, 0);
    prom.receiveShadow = true;
    S.add(prom);
    // desert plain behind the town
    const land = new THREE.Mesh(T(new THREE.PlaneGeometry(6000, 9000)), T(new THREE.MeshLambertMaterial({ color: '#CDB592' })));
    land.rotation.x = -Math.PI / 2;
    land.position.set(-3000 - 18, 0.9, 0);
    S.add(land);

    // buildings along the promenade: 2 to 4 floors, arcades on the ground floor, rooftop tanks and AC units
    const tints = ['#F4F1EA', '#EFE6D6', '#E8D9C0', '#F2EEE6', '#E6CFB0', '#F0E4D2', '#E3C9A2', '#D9B68E', '#F3E1C7'].map((c) => new THREE.Color(c));
    const bb = new BoxBuilder();
    let z = -300;
    while (z < 300) {
      const w = 12 + r() * 22;
      const d = 12 + r() * 10;
      const floors = 2 + Math.floor(r() * 3);
      const tint = tints[(r() * tints.length) | 0];
      const x0 = -18 - d - r() * 3;
      for (let f = 0; f < floors; f++) {
        const y0 = 1 + f * FLOOR;
        const inset = f === 0 ? 0 : -0.4;
        bb.box(x0, y0, z, -18 - inset, y0 + FLOOR, z + w, f === 0 ? 0.0 : 0.5, f === 0 ? 0.5 : 1.0, tint);
      }
      const top = 1 + floors * FLOOR;
      // parapet and rooftop clutter
      bb.box(x0, top, z, -18 + 0.4, top + 0.5, z + 0.25, 0, 0, tint, true);
      bb.box(x0, top, z + w - 0.25, -18 + 0.4, top + 0.5, z + w, 0, 0, tint, true);
      for (let k = 0; k < 3 + r() * 4; k++) {
        const bx = x0 + 1 + r() * (d - 3), bz = z + 1 + r() * (w - 3);
        const big = r() < 0.4;
        bb.box(bx, top, bz, bx + (big ? 2.2 : 1), top + (big ? 1.6 : 0.8), bz + (big ? 1.4 : 0.8), 0, 0, new THREE.Color(big ? '#DADDDF' : '#C9CBCC'), true);
      }
      z += w + (r() < 0.25 ? 6 + r() * 6 : 0.2);
    }
    // the town further back: lower, denser, a couple of minarets
    for (let i = 0; i < 420; i++) {
      const bx = -60 - Math.pow(r(), 0.8) * 900, bz = (r() - 0.5) * 1600;
      const w = 10 + r() * 24, d = 10 + r() * 24, floors = 1 + Math.floor(r() * 4);
      const tint = tints[(r() * tints.length) | 0];
      for (let f = 0; f < floors; f++) bb.box(bx - d, 1 + f * FLOOR, bz, bx, 1 + (f + 1) * FLOOR, bz + w, f ? 0.5 : 0, f ? 1 : 0.5, tint);
    }
    const facade = T(facadeTexture());
    const town = new THREE.Mesh(T(bb.geometry()), T(new THREE.MeshStandardMaterial({ map: facade, vertexColors: true, roughness: 0.92 })));
    town.receiveShadow = true;
    S.add(town);
    const minaret = T(mergeGeometries([new THREE.CylinderGeometry(1.1, 1.4, 34, 10).translate(0, 17, 0), new THREE.CylinderGeometry(1.8, 1.8, 1, 10).translate(0, 27, 0), new THREE.ConeGeometry(1.1, 4, 10).translate(0, 36, 0)], false)!);
    for (const [mx, mz] of [[-190, -120], [-420, 260], [-150, 340]]) {
      const m = new THREE.Mesh(minaret, T(new THREE.MeshStandardMaterial({ color: '#EFE7DA', roughness: 0.9 })));
      m.position.set(mx, 1, mz);
      S.add(m);
    }

    // palms, lamps and café parasols on the promenade
    const { leaf, bark } = palmTextures();
    T(leaf); T(bark);
    const palmCount = 70;
    const trunks = new THREE.InstancedMesh(T(trunkGeometry(7)), T(new THREE.MeshStandardMaterial({ map: bark, roughness: 0.95 })), palmCount);
    const crowns = new THREE.InstancedMesh(T(crownGeometry()), T(new THREE.MeshStandardMaterial({ map: leaf, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8 })), palmCount);
    const lampGeo = T(mergeGeometries([new THREE.CylinderGeometry(0.06, 0.09, 4.2, 8).translate(0, 2.1, 0), new THREE.CylinderGeometry(0.28, 0.12, 0.35, 10).translate(0, 4.3, 0)], false)!);
    const lamps = new THREE.InstancedMesh(lampGeo, T(new THREE.MeshStandardMaterial({ color: '#2B3136', metalness: 0.5, roughness: 0.4 })), 80);
    const paraGeo = T(mergeGeometries([new THREE.ConeGeometry(1.6, 0.6, 12, 1, true).translate(0, 2.5, 0), new THREE.CylinderGeometry(0.03, 0.03, 2.5, 6).translate(0, 1.25, 0)], false)!);
    const paras = new THREE.InstancedMesh(paraGeo, T(new THREE.MeshStandardMaterial({ color: '#F2EFE8', roughness: 0.8, side: THREE.DoubleSide })), 60);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    let li = 0, pi = 0;
    for (let i = 0; i < palmCount; i++) {
      const pz = -280 + i * 8 + (r() - 0.5) * 2;
      const s = 0.85 + r() * 0.35;
      q.setFromEuler(new THREE.Euler(0, r() * Math.PI * 2, 0));
      // crown sits on the bent top of the trunk
      const base = new THREE.Vector3(-5 - r() * 1.5, 1, pz);
      m.compose(base, q, new THREE.Vector3(s, s, s));
      trunks.setMatrixAt(i, m);
      const top = new THREE.Vector3(Math.sin(1.4) * 0.6, 7, 0).multiplyScalar(s).applyQuaternion(q).add(base);
      m.compose(top, q, new THREE.Vector3(s, s, s));
      crowns.setMatrixAt(i, m);
      if (i % 2 === 0 && li < 80) { m.compose(new THREE.Vector3(-1.4, 1, pz + 4), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)); lamps.setMatrixAt(li++, m); }
      if (r() < 0.45 && pi < 60) { m.compose(new THREE.Vector3(-11 - r() * 4, 1, pz + 2), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)); paras.setMatrixAt(pi++, m); }
    }
    lamps.count = li; paras.count = pi;
    S.add(trunks, crowns, lamps, paras);
  }

  /**
   * Lay out the marina around the hero berth.
   * px: x of our pontoon, zFree: z ranges along our pontoon already used by the close neighbours.
   */
  layout(px: number, heroRowX: number, zPos: number, zNeg: number) {
    const r = mulberry32(77);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    const counts = this.boats.map(() => 0);
    /** Moor one boat with its transom at x, its side starting at zEdge and the row running in dir; returns its beam. */
    const place = (x: number, zEdge: number, dir: number, facing: number) => {
      const k = Math.floor(r() * this.boats.length);
      const b = this.boats[k];
      if (counts[k] >= 40) return 0;
      const sc = 0.8 + r() * 0.35;
      const beam = b.B * sc;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), facing > 0 ? 0 : Math.PI);
      s.setScalar(sc);
      m.compose(new THREE.Vector3(x + facing * (b.L * sc) / 2, 0, zEdge + (dir * beam) / 2), q, s);
      b.body.setMatrixAt(counts[k], m);
      b.glass.setMatrixAt(counts[k], m);
      counts[k]++;
      return beam;
    };
    const row = (x: number, z0: number, z1: number, dir: number, facing: number, gap: number) => {
      for (let z = z0; dir > 0 ? z < z1 : z > z1;) { const w = place(x, z, dir, facing); if (!w) break; z += dir * (w + gap); }
    };
    // same row as us, beyond the close neighbours
    row(heroRowX, zPos + 0.9, 33, 1, 1, 0.9);
    row(heroRowX, zNeg - 0.9, -33, -1, 1, 0.9);
    // the other side of our pontoon, bows to the town
    const backX = px - 1.2 - 1.5 - 1.0;
    row(backX, -33, 33, 1, -1, 1.0);
    // stern-to the quay, bows towards us across the fairway
    const quayX = backX - 18 - 16 - 18 - 2.5;
    row(quayX + 2.5, -70, 70, 1, 1, 1.0);
    this.boats.forEach((b, i) => {
      b.body.count = counts[i]; b.glass.count = counts[i];
      b.body.instanceMatrix.needsUpdate = true; b.glass.instanceMatrix.needsUpdate = true;
      b.body.computeBoundingSphere(); b.glass.computeBoundingSphere();
    });
    this.shore.position.x = quayX;
    // walkway along z = −36 from our pontoon to the quay
    this.walkway.scale.set(px - quayX, 1, 1);
    this.walkway.position.set((px + quayX) / 2, 0.42, -36);
  }

  dispose() { this.disposables.forEach((d) => d.dispose()); }
}
