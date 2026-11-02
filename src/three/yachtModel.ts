import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mergeByMaterial } from './merge';
export { mergeByMaterial };
import { HullShape, gridGeometry, hullOpts } from './hull';
import { addCaustics } from './environment';
import type { Yacht } from '../lib/yacht';

export interface YachtParts {
  group: THREE.Group;
  shape: HullShape;
  underMesh: THREE.Mesh;
  underMat: THREE.MeshStandardMaterial;
  props: THREE.Group[];
  shafts: { from: THREE.Vector3; to: THREE.Vector3 }[];
  rope: THREE.Object3D | null;
  bentBlade: THREE.Object3D | null;
  anodes: THREE.Mesh[];
  gearPoints: THREE.Vector3[];
  /** where the bow line leaves the yacht, in yacht space */
  bowLine: THREE.Vector3;
  dispose: () => void;
}

/** Tessellation factor for the yacht being built (1 = hero, lower for boats further away). */
let Q = 1;
const nq = (n: number, min = 3) => Math.max(min, Math.round(n * Q));
function tubeQ(path: THREE.Curve<THREE.Vector3>, seg: number, r: number, rad: number) {
  return new THREE.TubeGeometry(path, nq(seg, 2), r, Math.max(3, Math.round(rad * Math.min(1, Q * 1.5))), false);
}

const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/* ------------------------------------------------------------------ */
/* Deckhouses: lofted sections with tumblehome, a crowned roof,        */
/* a raked windscreen and a plan that follows the deck                 */
/* ------------------------------------------------------------------ */
interface House {
  x0: number; x1: number; // aft end and front end at the base
  rf: number;             // where the roof starts to slope down into the windscreen (rf = x1: upright front)
  h: number;
  base: (x: number) => number;
  half: (x: number) => number;
  tumble?: number; rc?: number; crown?: number;
  shear?: number;         // top leans forward at the front (reverse-raked wheelhouse windows)
  nose?: number;          // fraction of the length over which the plan rounds off to a point
  screenPow?: number;
}

/** Rounded-rectangle section, v runs port base → roof → starboard base. Returns [y, z]. */
function section(v: number, wb: number, wt: number, h: number, rc0: number, crown: number): [number, number] {
  const rc = Math.max(0.001, Math.min(rc0, h * 0.45, wt * 0.45));
  const sideLen = Math.max(1e-5, Math.hypot(wb - wt, h - rc));
  const arc = (Math.PI / 2) * rc;
  const roof = Math.max(0, 2 * (wt - rc));
  let d = v * (2 * sideLen + 2 * arc + roof);
  if (d <= sideLen) { const k = d / sideLen; return [k * (h - rc), -(wb + (wt - wb) * k)]; }
  d -= sideLen;
  if (d <= arc) { const a = Math.PI - (d / arc) * (Math.PI / 2); return [h - rc + Math.sin(a) * rc, -wt + rc + Math.cos(a) * rc]; }
  d -= arc;
  if (d <= roof) { const z = -wt + rc + d; const k = z / Math.max(1e-6, wt - rc); return [h + crown * (1 - k * k), z]; }
  d -= roof;
  if (d <= arc) { const a = Math.PI / 2 - (d / arc) * (Math.PI / 2); return [h - rc + Math.sin(a) * rc, wt - rc + Math.cos(a) * rc]; }
  d -= arc;
  const k = Math.min(1, d / sideLen);
  return [(1 - k) * (h - rc), wt + (wb - wt) * k];
}

function dims(H: House, x: number) {
  const a = (x - H.x0) / (H.x1 - H.x0);
  let hh = H.h;
  if (x > H.rf && H.x1 > H.rf) hh = H.h * Math.pow(Math.max(0, (H.x1 - x) / (H.x1 - H.rf)), H.screenPow ?? 0.8);
  let wb = H.half(x);
  if (H.nose) { const k = Math.min(1, Math.max(0, (a - (1 - H.nose)) / H.nose)); wb *= Math.sqrt(Math.max(0, 1 - k * k)); }
  const wt = wb * (H.tumble ?? 0.93);
  const rc = Math.max(0.001, Math.min(H.rc ?? 0.12, hh * 0.45, wt * 0.45));
  return { a, hh: Math.max(0.0005, hh), wb, wt, rc };
}

function housePoint(H: House, x: number, v: number, o: THREE.Vector3) {
  const d = dims(H, x);
  const [yy, zz] = section(v, d.wb, d.wt, d.hh, H.rc ?? 0.12, H.crown ?? 0.04);
  const shear = (H.shear ?? 0) * (yy / H.h) * smooth(0.55, 1, d.a);
  return o.set(x + shear, H.base(x) + yy, zz);
}

function houseGeo(H: House, xa: number, xb: number, nA = 28, nV = 40) {
  return gridGeometry(nq(nA, 4), nq(nV, 10), (a, b, o) => { housePoint(H, xa + (xb - xa) * a, b, o); });
}

/** Flat end cap of a house at x (the aft bulkhead). */
function houseCap(H: House, x: number, nV0 = 40) {
  const nV = nq(nV0, 10);
  const pts: THREE.Vector2[] = [];
  const o = new THREE.Vector3();
  for (let i = 0; i <= nV; i++) { housePoint(H, x, i / nV, o); pts.push(new THREE.Vector2(o.z, o.y - H.base(x))); }
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts), 1);
  g.rotateY(-Math.PI / 2);
  g.translate(x, H.base(x), 0);
  return g;
}

/** Glass band on one side wall of a house, between fractions f0..f1 of the wall height. */
function sideGlass(H: House, xa: number, xb: number, f0: (a: number) => number, f1: (a: number) => number, side: number, nA = 24) {
  return gridGeometry(nq(nA, 2), 2, (a, b, o) => {
    const x = xa + (xb - xa) * a;
    const d = dims(H, x);
    const f = f0(a) + (f1(a) - f0(a)) * b;
    const y = f * (d.hh - d.rc);
    const shear = (H.shear ?? 0) * (y / H.h) * smooth(0.55, 1, d.a);
    o.set(x + shear, H.base(x) + y, side * (d.wb + (d.wt - d.wb) * f + 0.012));
  });
}

/** Framed windscreen glass laid on the sloped front of a house (between fractions f0..f1 up the slope). */
function screenGlass(H: House, f0: number, f1: number, widthFrac = 0.86) {
  return gridGeometry(nq(16), nq(8, 2), (a, b, o) => {
    const f = f0 + (f1 - f0) * b;
    const x = H.x1 - (H.x1 - H.rf) * f;
    const d = dims(H, x);
    const zmax = Math.max(0.01, (d.wt - d.rc) * widthFrac);
    const z = (a * 2 - 1) * zmax;
    const k = z / Math.max(1e-6, d.wt - d.rc);
    const y = H.base(x) + d.hh + (H.crown ?? 0.04) * (1 - k * k);
    o.set(x + 0.01, y + 0.012, z);
  });
}

/* ------------------------------------------------------------------ */
function nameTexture(name: string, port: string, color: string) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const x = c.getContext('2d')!;
  x.clearRect(0, 0, c.width, c.height);
  x.fillStyle = color;
  x.textAlign = 'center';
  x.font = '600 108px "Times New Roman", Georgia, serif';
  x.fillText(name.toUpperCase(), 512, 140);
  x.font = '500 46px system-ui, sans-serif';
  x.globalAlpha = 0.85;
  x.fillText(port.toUpperCase(), 512, 215);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Deck: teak cockpit and side decks, white non-skid foredeck. */
function deckTexture(cockpitU: number, foreU: number) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = '#ECEBE5';
  x.fillRect(0, 0, 1024, 256);
  // non-skid speckle
  for (let i = 0; i < 9000; i++) { x.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,.035)' : 'rgba(255,255,255,.4)'; x.fillRect(Math.random() * 1024, Math.random() * 256, 1.5, 1.5); }
  const teak = (x0: number, y0: number, w: number, h: number, along: boolean) => {
    x.fillStyle = '#A9784A';
    x.fillRect(x0, y0, w, h);
    if (along) {
      for (let y = y0; y < y0 + h; y += 5) {
        x.fillStyle = 'rgba(35,22,10,.6)'; x.fillRect(x0, y, w, 1);
        x.fillStyle = `rgba(${140 + Math.random() * 40},${92 + Math.random() * 22},55,.35)`; x.fillRect(x0, y + 1, w, 3.4);
      }
    } else {
      for (let xx = x0; xx < x0 + w; xx += 5) {
        x.fillStyle = 'rgba(35,22,10,.6)'; x.fillRect(xx, y0, 1, h);
        x.fillStyle = `rgba(${140 + Math.random() * 40},${92 + Math.random() * 22},55,.35)`; x.fillRect(xx + 1, y0, 3.4, h);
      }
    }
  };
  const cx = cockpitU * 1024, fx = foreU * 1024;
  teak(0, 0, cx, 256, true);
  teak(cx, 0, fx - cx, 30, true);
  teak(cx, 226, fx - cx, 30, true);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/* ------------------------------------------------------------------ */
export function buildYacht(y: Yacht, skin: THREE.Texture, opts: { detail?: 'high' | 'low' | 'tiny'; dockX?: number } = {}): YachtParts {
  const hi = opts.detail === undefined || opts.detail === 'high';
  const tiny = opts.detail === 'tiny';
  Q = hi ? 1 : tiny ? 0.25 : 0.5;
  const shape = new HullShape(y.lengthM, y.beamM, hullOpts(y.style));
  const { L, B } = shape;
  const group = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(o: T) => { disposables.push(o); return o; };
  const add = (g: THREE.BufferGeometry, m: THREE.Material, pos?: THREE.Vector3) => {
    const mesh = new THREE.Mesh(track(g), m);
    if (pos) mesh.position.copy(pos);
    group.add(mesh);
    return mesh;
  };

  const darkHull = y.hullColor === '#1D2B42' || y.hullColor === '#3A4048';
  const hullMat = track(new THREE.MeshPhysicalMaterial({ color: y.hullColor, roughness: 0.14, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.DoubleSide }));
  const stripeMat = track(new THREE.MeshPhysicalMaterial({ color: y.stripeColor, roughness: 0.25, clearcoat: 0.8, side: THREE.DoubleSide }));
  const superMat = track(new THREE.MeshPhysicalMaterial({ color: y.superColor, roughness: 0.2, clearcoat: 0.9, clearcoatRoughness: 0.08, side: THREE.DoubleSide }));
  const glassMat = track(new THREE.MeshPhysicalMaterial({ color: '#0A1620', metalness: 0.55, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02, side: THREE.DoubleSide }));
  const steelMat = track(new THREE.MeshStandardMaterial({ color: '#E3E7EA', metalness: 1, roughness: 0.16 }));
  const teakMat = track(new THREE.MeshStandardMaterial({ color: '#A9784A', roughness: 0.72 }));
  const cushionMat = track(new THREE.MeshStandardMaterial({ color: '#E9E3D5', roughness: 0.9 }));
  const darkMat = track(new THREE.MeshStandardMaterial({ color: '#23292F', roughness: 0.45, metalness: 0.2 }));
  const ropeMat = track(new THREE.MeshStandardMaterial({ color: '#E8E4DA', roughness: 0.9 }));
  const fenderMat = track(new THREE.MeshPhysicalMaterial({ color: '#F1F2EF', roughness: 0.35, clearcoat: 0.4 }));
  const fenderCap = track(new THREE.MeshStandardMaterial({ color: '#1C2B44', roughness: 0.5 }));
  const underMat = track(addCaustics(new THREE.MeshStandardMaterial({ map: skin, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }), 0.07)) as THREE.MeshStandardMaterial;
  const bronzeMat = track(addCaustics(new THREE.MeshStandardMaterial({ color: '#B88B54', metalness: 1, roughness: 0.32 }), 0.4));
  const shaftMat = track(addCaustics(new THREE.MeshStandardMaterial({ color: '#B9C2C8', metalness: 1, roughness: 0.25 }), 0.4));
  const zincMat = track(addCaustics(new THREE.MeshStandardMaterial({ color: '#AEB4B6', metalness: 0.6, roughness: 0.55 }), 0.4));
  const ruddMat = track(addCaustics(new THREE.MeshStandardMaterial({ color: y.antifoul, roughness: 0.8 }), 0.4));

  const nu = hi ? 150 : tiny ? 22 : 56, nt = hi ? 64 : tiny ? 6 : 20;
  const uOf = (x: number) => x / L + 0.5;
  const deckY = (x: number) => shape.sheer(uOf(x)) + 0.06;
  const deckHalf = (x: number) => shape.bd(uOf(x)) * B * 0.5;

  // underwater hull (antifouling, carries the fouling skin)
  const underMesh = new THREE.Mesh(track(gridGeometry(nu, nt, (a, b, o) => { shape.under(a, -1 + 2 * b, o); }, (a, b) => [a, b])), underMat);
  underMesh.name = 'under';
  group.add(underMesh);

  // topsides: boot stripe, main hull, styling line
  for (const side of [-1, 1]) {
    add(gridGeometry(nu, tiny ? 1 : 3, (a, b, o) => shape.top(a, b * 0.06, side, o)), stripeMat);
    add(gridGeometry(nu, hi ? 22 : tiny ? 4 : 8, (a, b, o) => shape.top(a, 0.06 + b * 0.94, side, o)), hullMat);
    // rubbing strake just below the sheer
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 64; i++) { const p = shape.top(Math.min(0.995, i / 64), 0.965, side); p.z += side * 0.028; pts.push(p); }
    add(tubeQ(new THREE.CatmullRomCurve3(pts), 128, 0.03, 8), steelMat);

    if (tiny) continue;
    if (y.style === 'explorer') {
      // round portholes in two groups
      const disc = new THREE.CircleGeometry(0.11, 20);
      for (const u of [0.34, 0.39, 0.44, 0.58, 0.63, 0.68]) {
        const p = shape.top(u, 0.55, side), n = topNormal(shape, u, 0.55, side);
        const m = add(disc.clone(), glassMat, p.addScaledVector(n, 0.012));
        m.lookAt(m.position.clone().add(n));
        const ring = add(new THREE.TorusGeometry(0.115, 0.016, 6, 20), steelMat, m.position.clone());
        ring.lookAt(ring.position.clone().add(n));
      }
      disc.dispose();
    } else {
      // long hull windows: one big swept slot and a short one forward
      const slots = y.style === 'sport' ? [[0.3, 0.66, 0.5, 0.14]] : [[0.36, 0.58, 0.5, 0.15], [0.61, 0.69, 0.53, 0.11]];
      for (const [u0, u1, s0, hgt] of slots) {
        add(gridGeometry(36, 3, (a, b, o) => {
          const u = u0 + a * (u1 - u0);
          const taper = 1 - Math.pow(Math.abs(a - 0.5) * 2, 5);
          const s = s0 + (b - 0.5) * hgt * (0.35 + 0.65 * taper) + a * 0.04;
          shape.top(u, s, side, o);
          o.add(topNormal(shape, u, s, side).multiplyScalar(0.012));
        }), glassMat);
      }
    }
  }

  // transom
  {
    const verts: number[] = [];
    const ring: THREE.Vector3[] = [];
    const N = 20;
    for (let i = 0; i <= N; i++) ring.push(shape.under(0, -1 + (2 * i) / N));
    for (let i = 0; i <= 10; i++) ring.push(shape.top(0, i / 10, 1));
    for (let i = 10; i >= 0; i--) ring.push(shape.top(0, i / 10, -1));
    const c = new THREE.Vector3(); ring.forEach((p) => c.add(p)); c.multiplyScalar(1 / ring.length);
    const above: number[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const arr = (a.y + b.y) / 2 < 0.01 ? verts : above;
      arr.push(c.x, c.y, c.z, a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const g1 = new THREE.BufferGeometry(); g1.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); g1.computeVertexNormals();
    const g2 = new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.Float32BufferAttribute(above, 3)); g2.computeVertexNormals();
    add(g1, ruddMat); add(g2, hullMat);
    const tex = track(nameTexture(y.name, 'Hurghada', darkHull ? '#E8E3D6' : '#1D2B42'));
    const plane = add(new THREE.PlaneGeometry(B * 0.6, B * 0.15), track(new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false })), new THREE.Vector3(-L / 2 - 0.02, shape.sheer(0) * 0.6, 0));
    plane.rotation.y = -Math.PI / 2;
    // swim platform with a teak top
    add(new RoundedBoxGeometry(1.0, 0.12, B * 0.88, 2, 0.04), hullMat, new THREE.Vector3(-L / 2 - 0.5, 0.3, 0));
    add(new THREE.BoxGeometry(0.96, 0.02, B * 0.84), teakMat, new THREE.Vector3(-L / 2 - 0.5, 0.37, 0));
    // steps from the platform up to the cockpit
    for (let k = 0; k < 2; k++) add(new THREE.BoxGeometry(0.3, 0.05, 0.7), teakMat, new THREE.Vector3(-L / 2 + 0.05 + k * 0.28, 0.37 + (k + 1) * (shape.sheer(0) - 0.37) / 3, B * 0.28));
  }

  // deck
  const style = y.style;
  const sideDeck = style === 'explorer' ? 0.5 : 0.42;
  const saloonX0 = style === 'sport' ? -0.2 * L : style === 'explorer' ? -0.3 * L : -0.27 * L;
  add(
    gridGeometry(nu, tiny ? 4 : 16, (a, b, o) => shape.deck(a, -1 + 2 * b, o)),
    track(new THREE.MeshStandardMaterial({ map: track(deckTexture(uOf(saloonX0) - 0.005, 0.72)), roughness: 0.62 })),
  );

  // stainless rails along the side decks and round the bow
  const railH = style === 'explorer' ? 1.0 : 0.66;
  for (const side of [-1, 1]) {
    const top: THREE.Vector3[] = [], mid: THREE.Vector3[] = [];
    for (let i = 0; i <= 40; i++) {
      const u = 0.2 + (i / 40) * 0.785;
      const p = shape.deck(u, side * 0.93);
      top.push(p.clone().setY(p.y + railH));
      mid.push(p.clone().setY(p.y + railH * 0.5));
    }
    // meet at the bow
    const tip = shape.deck(0.995, 0); tip.y += railH;
    top.push(tip);
    add(tubeQ(new THREE.CatmullRomCurve3(top), 80, 0.017, 6), steelMat);
    if (tiny) continue;
    if (style !== 'explorer') add(tubeQ(new THREE.CatmullRomCurve3(mid), 60, 0.008, 5), steelMat);
    const post = new THREE.CylinderGeometry(0.013, 0.013, railH, 6);
    for (let i = 0; i <= 9; i++) {
      const p = shape.deck(0.2 + (i / 9) * 0.76, side * 0.93);
      add(post.clone(), steelMat, p.setY(p.y + railH / 2));
    }
    post.dispose();
  }

  // explorer bulwarks: solid hull-coloured wall round the foredeck with a teak cap
  if (style === 'explorer') {
    const bh = (u: number) => 0.85 * smooth(0.28, 0.5, u);
    for (const side of [-1, 1]) {
      add(gridGeometry(60, 2, (a, b, o) => {
        const u = 0.25 + a * 0.745;
        const p = shape.top(u, 1, side);
        o.set(p.x, p.y + b * bh(u), p.z);
      }), hullMat);
      const cap: THREE.Vector3[] = [];
      for (let i = 0; i <= 40; i++) { const u = 0.3 + (i / 40) * 0.69; const p = shape.top(u, 1, side); cap.push(p.setY(p.y + bh(u))); }
      add(tubeQ(new THREE.CatmullRomCurve3(cap), 80, 0.05, 6), teakMat);
    }
  }

  // ---------------- superstructure ----------------
  const flatShadow: THREE.Mesh[] = [];
  const houseHalf = (inset: number, min = 0.3) => (x: number) => Math.max(min, deckHalf(x) - inset);
  const radar = (x: number, yTop: number) => {
    add(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 28), superMat, new THREE.Vector3(x, yTop + 0.1, 0));
    add(new THREE.SphereGeometry(0.3, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), superMat, new THREE.Vector3(x, yTop + 0.2, 0));
  };
  const antenna = (x: number, z: number, yTop: number, h: number) => add(new THREE.CylinderGeometry(0.01, 0.022, h, 6), superMat, new THREE.Vector3(x, yTop + h / 2, z));
  const settee = (x: number, yBase: number, w: number, d: number) => {
    add(new RoundedBoxGeometry(d, 0.42, w, 3, 0.06), superMat, new THREE.Vector3(x, yBase + 0.21, 0));
    add(new RoundedBoxGeometry(d * 0.92, 0.12, w * 0.96, 3, 0.05), cushionMat, new THREE.Vector3(x, yBase + 0.48, 0));
  };

  if (style === 'flybridge') {
    const h = 1.55 + 0.02 * L;
    const saloon: House = { x0: saloonX0, x1: 0.215 * L, rf: 0.09 * L, h, base: deckY, half: houseHalf(sideDeck), tumble: 0.92, rc: 0.14, crown: 0.05, screenPow: 0.75 };
    add(houseGeo(saloon, saloon.x0, saloon.rf), superMat);
    add(houseGeo(saloon, saloon.rf, saloon.x1, 16), superMat);
    add(screenGlass(saloon, 0.1, 0.94), glassMat);
    add(houseCap(saloon, saloon.x0), glassMat);
    for (const side of [-1, 1]) add(sideGlass(saloon, saloon.x0 + 0.5, saloon.rf, (a) => THREE.MathUtils.lerp(0.42, 0.24, a), () => 0.9, side), glassMat);
    // flybridge: floor over the saloon reaching aft over the cockpit
    const flyY = deckY(saloon.x0) + h + 0.02;
    const flyHalf = houseHalf(sideDeck + 0.05);
    const flyAft = -0.43 * L;
    const fly: House = { x0: flyAft, x1: saloon.rf - 0.4, rf: saloon.rf - 0.4, h: 0.2, base: () => flyY - 0.12, half: (x) => flyHalf(Math.max(saloon.x0, x)), tumble: 1, rc: 0.06, crown: 0 };
    add(houseGeo(fly, fly.x0, fly.x1, 20, 24), superMat);
    add(houseCap(fly, fly.x0, 24), superMat);
    add(houseCap(fly, fly.x1, 24), superMat);
    // console fairing with a small screen at the front of the flybridge
    const fair: House = { x0: saloon.rf - 2.4, x1: saloon.rf - 0.25, rf: saloon.rf - 1.3, h: 0.95, base: () => flyY, half: (x) => flyHalf(x) * 0.96, tumble: 0.9, rc: 0.1, crown: 0.03 };
    add(houseGeo(fair, fair.x0, fair.rf), superMat);
    add(houseGeo(fair, fair.rf, fair.x1, 10), superMat);
    add(screenGlass(fair, 0.45, 0.95, 0.8), glassMat);
    add(houseCap(fair, fair.x0), superMat);
    // seating on the flybridge
    settee(flyAft + 1.3, flyY + 0.08, flyHalf(flyAft) * 1.5, 0.75);
    settee(fair.x0 - 0.7, flyY + 0.08, 0.7, 0.75);
    // rails round the back of the flybridge
    for (const side of [-1, 1]) {
      const rp = [new THREE.Vector3(fair.x0, flyY + 0.95, side * flyHalf(fair.x0)), new THREE.Vector3(flyAft + 0.15, flyY + 0.95, side * flyHalf(flyAft))];
      add(tubeQ(new THREE.LineCurve3(rp[0], rp[1]), 8, 0.017, 6), steelMat);
      for (let k = 0; k <= 4; k++) { const p = rp[0].clone().lerp(rp[1], k / 4); add(new THREE.CylinderGeometry(0.013, 0.013, 0.95, 6), steelMat, p.setY(flyY + 0.475)); }
    }
    add(tubeQ(new THREE.LineCurve3(new THREE.Vector3(flyAft + 0.15, flyY + 0.95, -flyHalf(flyAft)), new THREE.Vector3(flyAft + 0.15, flyY + 0.95, flyHalf(flyAft))), 8, 0.017, 6), steelMat);
    // hardtop on a raked arch
    const htY = flyY + 2.15;
    const ht: House = { x0: -0.37 * L, x1: fair.x0 + 0.4, rf: fair.x0 - 0.2, h: 0.13, base: () => htY, half: (x) => flyHalf(x) * 0.97, tumble: 1, rc: 0.05, crown: 0.06, screenPow: 1.4 };
    add(houseGeo(ht, ht.x0, ht.x1, 24, 24), superMat);
    add(houseCap(ht, ht.x0, 24), superMat);
    for (const side of [-1, 1]) {
      for (const [xb, xt] of [[-0.12 * L, -0.17 * L], [-0.3 * L, -0.33 * L]]) {
        const a = new THREE.Vector3(xb, flyY + 0.1, side * flyHalf(xb) * 0.9), b = new THREE.Vector3(xt, htY + 0.02, side * flyHalf(xt) * 0.82);
        const leg = add(new THREE.BoxGeometry(0.12, a.distanceTo(b), 0.3), superMat, a.clone().lerp(b, 0.5));
        leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      }
    }
    radar(-0.2 * L + 0.6, htY + 0.13);
    antenna(-0.33 * L, 0.5, htY + 0.13, 1.3);
    antenna(-0.33 * L, -0.5, htY + 0.13, 1.0);
    // cockpit: transom settee and a teak table
    settee(saloon.x0 - 0.3 - (saloon.x0 + L / 2) * 0.35, deckY(-0.4 * L), B * 0.5, 0.6);
    add(new THREE.BoxGeometry(0.8, 0.05, 1.1), teakMat, new THREE.Vector3(saloon.x0 - 1.4, deckY(saloon.x0) + 0.72, 0));
    add(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 8), steelMat, new THREE.Vector3(saloon.x0 - 1.4, deckY(saloon.x0) + 0.36, 0));
    // foredeck sunpad and hatch
    const sx = 0.33 * L;
    add(new RoundedBoxGeometry(1.7, 0.16, Math.max(0.8, deckHalf(sx) * 1.1), 3, 0.06), cushionMat, new THREE.Vector3(sx, deckY(sx) + 0.08, 0));
  } else if (style === 'sport') {
    const h = 1.3 + 0.012 * L;
    const cabin: House = { x0: saloonX0, x1: 0.28 * L, rf: 0.03 * L, h, base: deckY, half: houseHalf(sideDeck), tumble: 0.88, rc: 0.16, crown: 0.06, screenPow: 0.7 };
    add(houseGeo(cabin, cabin.x0, cabin.rf), superMat);
    add(houseGeo(cabin, cabin.rf, cabin.x1, 18), superMat);
    add(screenGlass(cabin, 0.32, 0.97, 0.9), glassMat);
    for (const side of [-1, 1]) add(sideGlass(cabin, cabin.x0 + 0.2, cabin.rf, (a) => THREE.MathUtils.lerp(0.36, 0.2, a), () => 0.92, side), glassMat);
    // hardtop reaching aft over the cockpit, sunroof, slim aft pillars
    const topY = deckY(cabin.x0) + h;
    const htAft = cabin.x0 - 0.1 * L;
    const ht: House = { x0: htAft, x1: cabin.x0 + 0.6, rf: cabin.x0 + 0.6, h: 0.11, base: () => topY - 0.06, half: (x) => houseHalf(sideDeck)(Math.max(cabin.x0, x)) * 0.94, tumble: 1, rc: 0.05, crown: 0.06 };
    add(houseGeo(ht, ht.x0, ht.x1, 16, 20), superMat);
    add(houseCap(ht, ht.x0, 20), superMat);
    add(new THREE.BoxGeometry(cabin.rf - cabin.x0 - 1.0, 0.02, houseHalf(sideDeck)(0) * 1.1), glassMat, new THREE.Vector3((cabin.x0 + cabin.rf) / 2 - 0.3, topY + 0.07, 0));
    add(houseCap(cabin, cabin.x0), glassMat);
    for (const side of [-1, 1]) {
      const a = new THREE.Vector3(htAft + 0.35, deckY(htAft) + 0.4, side * houseHalf(sideDeck)(cabin.x0) * 0.9), b = new THREE.Vector3(htAft + 0.2, topY - 0.05, side * houseHalf(sideDeck)(cabin.x0) * 0.88);
      const pillar = add(new THREE.BoxGeometry(0.1, a.distanceTo(b), 0.22), superMat, a.clone().lerp(b, 0.5));
      pillar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    }
    antenna(htAft + 0.6, 0, topY + 0.05, 0.6);
    settee(htAft - 0.6, deckY(htAft), B * 0.5, 0.6);
    const sx = 0.36 * L;
    add(new RoundedBoxGeometry(1.9, 0.16, Math.max(0.8, deckHalf(sx) * 1.2), 3, 0.06), cushionMat, new THREE.Vector3(sx, deckY(sx) + 0.08, 0));
  } else {
    // explorer: tall deckhouse, wheelhouse with reverse-raked windows, mast, tender on the boat deck
    const h = 1.85 + 0.012 * L;
    const house: House = { x0: saloonX0, x1: 0.15 * L, rf: 0.1 * L, h, base: deckY, half: houseHalf(sideDeck), tumble: 0.97, rc: 0.08, crown: 0.04, screenPow: 0.9 };
    add(houseGeo(house, house.x0, house.rf), superMat);
    add(houseGeo(house, house.rf, house.x1, 10), superMat);
    add(screenGlass(house, 0.3, 0.88, 0.8), glassMat);
    add(houseCap(house, house.x0), glassMat);
    // separate rectangular windows
    for (const side of [-1, 1]) {
      const span = house.rf - house.x0 - 1.0;
      for (let k = 0; k < 4; k++) {
        const xa = house.x0 + 0.5 + (k * span) / 4 + 0.12, xb = house.x0 + 0.5 + ((k + 1) * span) / 4 - 0.12;
        add(sideGlass(house, xa, xb, () => 0.38, () => 0.84, side, 4), glassMat);
      }
    }
    const roofY = deckY(house.x0) + h + 0.02;
    const whHalf = houseHalf(sideDeck + 0.15);
    const wh: House = { x0: -0.06 * L, x1: 0.1 * L, rf: 0.1 * L, h: 1.7, base: () => roofY, half: whHalf, tumble: 0.96, rc: 0.06, crown: 0.03, shear: 0.32, nose: 0.3 };
    add(houseGeo(wh, wh.x0, wh.x1, 26, 40), superMat);
    add(houseCap(wh, wh.x0), superMat);
    // glazed door in the back of the wheelhouse
    add(new THREE.PlaneGeometry(whHalf(wh.x0) * 1.1, 1.05), glassMat, new THREE.Vector3(wh.x0 - 0.012, roofY + 0.85, 0)).rotation.y = -Math.PI / 2;
    for (const side of [-1, 1]) add(sideGlass(wh, wh.x0 + 0.4, wh.x1 - 0.01, () => 0.42, () => 0.9, side, 20), glassMat);
    // roof overhang above the wheelhouse windows
    const visor: House = { x0: wh.x0 - 0.3, x1: wh.x1 + 0.55, rf: wh.x1 + 0.55, h: 0.1, base: () => roofY + 1.74, half: (x) => whHalf(Math.min(x, wh.x1)) * 1.04, tumble: 1, rc: 0.04, crown: 0.03, nose: 0.3 };
    add(houseGeo(visor, visor.x0, visor.x1, 20, 20), superMat);
    add(houseCap(visor, visor.x0, 20), superMat);
    // mast with an open-array radar
    const mx = wh.x0 + 0.9, mTop = roofY + 1.84;
    add(new THREE.CylinderGeometry(0.06, 0.1, 2.6, 10), superMat, new THREE.Vector3(mx, mTop + 1.3, 0));
    add(new THREE.BoxGeometry(0.12, 0.08, 1.6), superMat, new THREE.Vector3(mx, mTop + 2.0, 0));
    add(new THREE.BoxGeometry(0.16, 0.1, 1.9), darkMat, new THREE.Vector3(mx + 0.1, mTop + 2.25, 0));
    add(new THREE.CylinderGeometry(0.04, 0.04, 0.14, 8), superMat, new THREE.Vector3(mx + 0.1, mTop + 2.14, 0));
    radar(mx - 0.8, mTop);
    antenna(mx, 0.75, mTop + 2.0, 1.2);
    // tender on chocks and a davit on the boat deck (only on the yachts you get close to)
    const tx = (house.x0 + wh.x0) / 2;
    if (!tiny) {
    const tender = new THREE.Group();
    const tubeGeo = new THREE.CapsuleGeometry(0.2, 2.4, 4, 10); tubeGeo.rotateZ(Math.PI / 2);
    const tenderTube = track(new THREE.MeshStandardMaterial({ color: '#8A949C', roughness: 0.7 }));
    for (const z of [-0.5, 0.5]) { const t = new THREE.Mesh(track(tubeGeo.clone()), tenderTube); t.position.z = z; tender.add(t); }
    tubeGeo.dispose();
    const tb = new THREE.Mesh(track(new THREE.BoxGeometry(2.4, 0.3, 0.9)), hullMat); tb.position.y = -0.05; tender.add(tb);
    tender.position.set(tx, roofY + 0.32, 0);
    group.add(tender);
    const davit = new THREE.CatmullRomCurve3([new THREE.Vector3(tx + 1.6, roofY, -0.9), new THREE.Vector3(tx + 1.6, roofY + 1.5, -0.9), new THREE.Vector3(tx + 1.1, roofY + 1.9, -0.6), new THREE.Vector3(tx + 0.5, roofY + 1.7, -0.2)]);
    add(tubeQ(davit, 24, 0.07, 8), superMat);
    }
    // aft deck: teak table and settee under the boat-deck overhang
    settee(house.x0 - 1.1, deckY(house.x0 - 1.1), B * 0.5, 0.6);
    add(new THREE.BoxGeometry(0.8, 0.05, 1.1), teakMat, new THREE.Vector3(house.x0 - 2.0, deckY(house.x0) + 0.72, 0));
    // foredeck: anchor windlass and hatch
    const fx = 0.4 * L;
    add(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 14), darkMat, new THREE.Vector3(fx, deckY(fx) + 0.2, 0)).rotation.x = Math.PI / 2;
    add(new THREE.BoxGeometry(0.7, 0.06, 0.7), glassMat, new THREE.Vector3(fx - 1.6, deckY(fx - 1.6) + 0.04, 0));
  }
  void flatShadow;

  // anchor in the stem
  {
    const p = shape.top(0.985, 0.88, 1);
    add(new THREE.BoxGeometry(0.42, 0.22, 0.06), steelMat, new THREE.Vector3(p.x - 0.05, p.y, 0)).rotation.z = -0.5;
  }

  // cleats, fenders and mooring lines
  const cleat = (p: THREE.Vector3) => add(new THREE.BoxGeometry(0.26, 0.07, 0.07), steelMat, p.clone().setY(p.y + 0.04));
  const sternCleats = [-1, 1].map((s) => shape.deck(0.02, s * 0.8));
  sternCleats.forEach(cleat);
  const bowCleat = shape.deck(0.97, 0);
  cleat(bowCleat);
  const bowLine = new THREE.Vector3(L / 2 + L * 0.1, -0.05, 0);
  add(tubeQ(new THREE.QuadraticBezierCurve3(bowCleat.clone().setY(bowCleat.y + 0.05), new THREE.Vector3((bowCleat.x + bowLine.x) / 2 + 0.2, bowCleat.y * 0.45, 0), bowLine), 20, 0.016, 6), ropeMat);
  const fenderGeo = new THREE.CapsuleGeometry(0.12, 0.42, 6, 14);
  const capGeo = new THREE.CylinderGeometry(0.05, 0.07, 0.05, 10);
  for (const side of tiny ? [] : [-1, 1]) {
    for (const u of [0.24, 0.42, 0.6]) {
      const p = shape.top(u, 0.42, side), n = topNormal(shape, u, 0.42, side);
      const c = p.clone().addScaledVector(n, 0.14);
      add(fenderGeo.clone(), fenderMat, c);
      add(capGeo.clone(), fenderCap, c.clone().setY(c.y + 0.36));
      const top = shape.deck(u, side * 0.93);
      add(tubeQ(new THREE.LineCurve3(c.clone().setY(c.y + 0.38), top.clone().setY(top.y + railH)), 2, 0.006, 4), ropeMat);
    }
  }
  fenderGeo.dispose(); capGeo.dispose();
  if (opts.dockX !== undefined) {
    const dockX = opts.dockX;
    const dockY = 0.58;
    // stern lines to the pontoon cleats
    sternCleats.forEach((c, i) => {
      const to = new THREE.Vector3(dockX + 0.35, dockY, (i ? 1 : -1) * (B * 0.55 + 0.4));
      const mid = c.clone().lerp(to, 0.5); mid.y = Math.min(c.y, to.y) - 0.35;
      add(tubeQ(new THREE.QuadraticBezierCurve3(c.clone().setY(c.y + 0.06), mid, to), 20, 0.016, 6), ropeMat);
    });
    // passerelle from the cockpit to the pontoon
    const from = new THREE.Vector3(-L / 2 - 0.1, shape.sheer(0) + 0.06, -B * 0.18);
    const to = new THREE.Vector3(dockX + 0.25, dockY, -B * 0.18);
    const len = from.distanceTo(to);
    const plank = add(new THREE.BoxGeometry(len, 0.05, 0.5), steelMat, from.clone().lerp(to, 0.5));
    plank.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), to.clone().sub(from).normalize());
    const tread = add(new THREE.BoxGeometry(len * 0.98, 0.012, 0.44), teakMat, from.clone().lerp(to, 0.5).setY((from.y + to.y) / 2 + 0.03));
    tread.quaternion.copy(plank.quaternion);
    for (const dz of [-0.25, 0.25]) {
      const a = from.clone().add(new THREE.Vector3(0.1, 0.8, dz)), b = to.clone().add(new THREE.Vector3(-0.1, 0.8, dz));
      add(tubeQ(new THREE.QuadraticBezierCurve3(a, a.clone().lerp(b, 0.5).setY((a.y + b.y) / 2 - 0.12), b), 12, 0.008, 4), ropeMat);
      for (const k of [0, 1]) { const p = (k ? to : from).clone(); add(new THREE.CylinderGeometry(0.012, 0.012, 0.8, 6), steelMat, p.add(new THREE.Vector3(k ? -0.1 : 0.1, 0.4, dz))); }
    }
  }

  // running gear: shafts, struts, propellers, rudders, anodes
  const props: THREE.Group[] = [];
  const shafts: { from: THREE.Vector3; to: THREE.Vector3 }[] = [];
  const gearPoints: THREE.Vector3[] = [];
  const anodes: THREE.Mesh[] = [];
  let bentBlade: THREE.Object3D | null = null;
  let rope: THREE.Object3D | null = null;
  if (hi) {
    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(0, 0);
    bladeShape.bezierCurveTo(0.12, 0.05, 0.2, 0.2, 0.08, 0.34);
    bladeShape.bezierCurveTo(0.0, 0.38, -0.08, 0.3, -0.05, 0.16);
    bladeShape.lineTo(0, 0);
    const bladeGeo = track(new THREE.ShapeGeometry(bladeShape, 12));
    const propFinding = y.findings.find((f) => f.kind === 'propeller');
    const ropeFinding = y.findings.find((f) => f.kind === 'rope');
    const anodeScale = 0.45 + 0.55 * (y.anodePct / 100);

    for (const side of [-1, 1]) {
      const zt = side * 0.3;
      const from = shape.under(0.34, zt).add(new THREE.Vector3(0, 0.02, 0));
      const pc = shape.under(0.075, zt);
      const to = new THREE.Vector3(pc.x, pc.y - shape.D * 0.42, pc.z);
      shafts.push({ from, to });
      const dir = to.clone().sub(from);
      const shaft = new THREE.Mesh(track(new THREE.CylinderGeometry(0.035, 0.035, dir.length(), 10)), shaftMat);
      shaft.position.copy(from).add(to).multiplyScalar(0.5);
      shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      group.add(shaft);
      const sp = from.clone().lerp(to, 0.78);
      const hullAbove = shape.under(0.12, zt);
      const strut = new THREE.Mesh(track(new THREE.BoxGeometry(0.05, hullAbove.y - sp.y + 0.05, 0.14)), bronzeMat);
      strut.position.set(sp.x, (hullAbove.y + sp.y) / 2, sp.z);
      group.add(strut);
      const collar = new THREE.Mesh(track(new THREE.CylinderGeometry(0.07 * anodeScale, 0.07 * anodeScale, 0.1, 14)), zincMat);
      collar.position.copy(from.clone().lerp(to, 0.6));
      collar.quaternion.copy(shaft.quaternion);
      group.add(collar);
      anodes.push(collar);
      const prop = new THREE.Group();
      const hub = new THREE.Mesh(track(new THREE.CylinderGeometry(0.06, 0.08, 0.16, 14)), bronzeMat);
      hub.rotation.z = Math.PI / 2;
      prop.add(hub);
      for (let k = 0; k < 4; k++) {
        const blade = new THREE.Mesh(bladeGeo, bronzeMat);
        blade.scale.setScalar(L * 0.06);
        blade.rotation.set(k * (Math.PI / 2), 0.0, 0);
        blade.rotateY(0.55);
        const holder = new THREE.Group();
        holder.add(blade);
        holder.rotation.x = k * (Math.PI / 2);
        prop.add(holder);
        if (propFinding && ((propFinding.side === 'port' && side < 0) || (propFinding.side === 'starboard' && side > 0)) && k === 1) {
          blade.rotateX(0.5);
          blade.scale.multiplyScalar(0.9);
          bentBlade = holder;
        }
      }
      prop.position.copy(to);
      prop.lookAt(from);
      prop.rotateY(Math.PI / 2);
      group.add(prop);
      props.push(prop);
      const rc = shape.under(0.025, zt);
      const rudder = new THREE.Mesh(track(new THREE.BoxGeometry(0.42, shape.D * 0.85, 0.04)), ruddMat);
      rudder.position.set(rc.x, rc.y - shape.D * 0.42, rc.z);
      group.add(rudder);
      for (let i = 0; i < 40; i++) gearPoints.push(from.clone().lerp(to, i / 39));
      gearPoints.push(to.clone());
      if (ropeFinding && ((ropeFinding.side === 'port' && side < 0) || (ropeFinding.side === 'starboard' && side > 0))) {
        const rg = new THREE.Group();
        const ropeWrap = track(addCaustics(new THREE.MeshStandardMaterial({ color: '#E2B23A', roughness: 0.85 }), 0.4));
        for (let k = 0; k < 5; k++) {
          const tor = new THREE.Mesh(track(new THREE.TorusGeometry(0.07 + k * 0.004, 0.018, 8, 24)), ropeWrap);
          tor.position.set(0, (k - 2) * 0.03, 0);
          tor.rotation.x = Math.PI / 2 + (k % 2 ? 0.25 : -0.2);
          rg.add(tor);
        }
        const tail = new THREE.Mesh(track(tubeQ(new THREE.CatmullRomCurve3([new THREE.Vector3(0.07, 0, 0), new THREE.Vector3(0.25, -0.3, 0.1), new THREE.Vector3(0.1, -0.8, 0.25), new THREE.Vector3(0.3, -1.3, 0.1)]), 30, 0.016, 6)), ropeWrap);
        rg.add(tail);
        rg.position.copy(from.clone().lerp(to, 0.88));
        rg.quaternion.copy(shaft.quaternion);
        group.add(rg);
        rope = rg;
      }
    }
    for (const z of [-0.35, 0.35]) {
      const a = new THREE.Mesh(track(new RoundedBoxGeometry(0.06, 0.18 * anodeScale, 0.32 * anodeScale, 2, 0.02)), zincMat);
      const p = shape.under(0.0, z / (shape.hb(0) * B * 0.5));
      a.position.set(-L / 2 - 0.04, p.y * 0.5, z);
      group.add(a);
      anodes.push(a);
    }
  }

  Q = 1;
  // one draw call per material for everything that doesn't move on its own
  const keep = new Set<THREE.Object3D>([underMesh, ...props, ...anodes]);
  if (rope) keep.add(rope);
  mergeByMaterial(group, keep).forEach((g) => track(g));
  if (hi) group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m !== underMesh) { m.castShadow = true; m.receiveShadow = true; } });

  return {
    group,
    shape,
    underMesh,
    underMat,
    props,
    shafts,
    rope,
    bentBlade,
    anodes,
    gearPoints,
    bowLine,
    dispose: () => { disposables.forEach((d) => d.dispose()); },
  };
}

/** Outward normal of the topsides at (u, s). */
function topNormal(shape: HullShape, u: number, s: number, side: number) {
  const e = 0.004;
  const pu = shape.top(Math.min(1, u + e), s, side).sub(shape.top(Math.max(0, u - e), s, side));
  const ps = shape.top(u, Math.min(1, s + e), side).sub(shape.top(u, Math.max(0, s - e), side));
  const n = new THREE.Vector3().crossVectors(pu, ps).normalize();
  if (n.z * side < 0) n.negate();
  return n;
}

/** Low-detail neighbour yacht for the marina. */
export function buildNeighbour(y: Yacht, antifoulSkin: THREE.Texture, dockX?: number) {
  return buildYacht(y, antifoulSkin, { detail: 'low', dockX });
}

/**
 * One merged, vertex-coloured mesh per yacht style for the rows of boats further away
 * (drawn instanced: two draw calls for a whole row).
 */
export function buildTemplate(y: Yacht) {
  const parts = buildYacht(y, new THREE.Texture(), { detail: 'tiny' });
  const body: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [];
  parts.group.children.forEach((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m === parts.underMesh) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    if ((mat as unknown as THREE.MeshBasicMaterial).isMeshBasicMaterial) return;
    const g = m.geometry.clone();
    const c = mat.map ? new THREE.Color('#CDBFA6') : mat.color ?? new THREE.Color('#ffffff');
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    (mat.color && mat.color.getHexString() === '0a1620' ? glass : body).push(g);
  });
  const out = { body: mergeGeometries(body, false)!, glass: mergeGeometries(glass, false)!, length: parts.shape.L, beam: parts.shape.B };
  body.concat(glass).forEach((g) => g.dispose());
  parts.dispose();
  return out;
}
