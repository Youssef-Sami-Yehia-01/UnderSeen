import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { HullShape, gridGeometry } from './hull';
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
  dispose: () => void;
}

function footprint(x0: number, x1: number, wAft: number, wFront: number, noseRound = 0.6) {
  // shape in (x, -z) for extrusion upward after rotateX(-PI/2)
  const s = new THREE.Shape();
  const r = Math.min(0.35, wAft * 0.3);
  s.moveTo(x0 + r, -wAft);
  s.lineTo(x1 - (x1 - x0) * 0.25, -wFront);
  s.quadraticCurveTo(x1, -wFront * noseRound, x1, 0);
  s.quadraticCurveTo(x1, wFront * noseRound, x1 - (x1 - x0) * 0.25, wFront);
  s.lineTo(x0 + r, wAft);
  s.quadraticCurveTo(x0, wAft, x0, wAft - r);
  s.lineTo(x0, -wAft + r);
  s.quadraticCurveTo(x0, -wAft, x0 + r, -wAft);
  return s;
}

function extrudeUp(shape: THREE.Shape, height: number, bevel = 0.06) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 20 });
  g.rotateX(-Math.PI / 2);
  return g;
}

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

function deckTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = '#F1F1EC';
  x.fillRect(0, 0, 1024, 256);
  // teak on the aft cockpit (u < 0.22) and side decks
  const teak = (x0: number, y0: number, w: number, h: number) => {
    x.fillStyle = '#A57A4E';
    x.fillRect(x0, y0, w, h);
    for (let y = y0; y < y0 + h; y += 6) {
      x.fillStyle = 'rgba(40,25,10,.55)';
      x.fillRect(x0, y, w, 1.2);
      x.fillStyle = `rgba(${150 + Math.random() * 30},${100 + Math.random() * 20},${60},.25)`;
      x.fillRect(x0, y + 1.2, w, 4);
    }
  };
  teak(0, 0, 230, 256);
  teak(230, 0, 600, 26);
  teak(230, 230, 600, 26);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function buildYacht(y: Yacht, skin: THREE.Texture, opts: { detail?: 'high' | 'low' } = {}): YachtParts {
  const hi = opts.detail !== 'low';
  const shape = new HullShape(y.lengthM, y.beamM);
  const { L, B } = shape;
  const group = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(o: T) => { disposables.push(o); return o; };

  const hullMat = track(new THREE.MeshPhysicalMaterial({ color: y.hullColor, roughness: 0.16, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06, side: THREE.DoubleSide }));
  const stripeMat = track(new THREE.MeshPhysicalMaterial({ color: y.stripeColor, roughness: 0.25, clearcoat: 0.8, side: THREE.DoubleSide }));
  const superMat = track(new THREE.MeshPhysicalMaterial({ color: y.superColor, roughness: 0.2, clearcoat: 0.9, clearcoatRoughness: 0.08 }));
  const glassMat = track(new THREE.MeshPhysicalMaterial({ color: '#0B1822', metalness: 0.4, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, reflectivity: 1 }));
  const steelMat = track(new THREE.MeshStandardMaterial({ color: '#DDE2E6', metalness: 1, roughness: 0.18 }));
  const teakMat = track(new THREE.MeshStandardMaterial({ color: '#A57A4E', roughness: 0.7 }));
  const darkMat = track(new THREE.MeshStandardMaterial({ color: '#20262C', roughness: 0.5 }));
  const underMat = track(addCaustics(new THREE.MeshStandardMaterial({ map: skin, roughness: 0.82, metalness: 0, side: THREE.DoubleSide }), 0.26)) as THREE.MeshStandardMaterial;
  const bronzeMat = track(addCaustics(new THREE.MeshStandardMaterial({ color: '#B88B54', metalness: 1, roughness: 0.32 }), 0.4));
  const shaftMat = track(addCaustics(new THREE.MeshStandardMaterial({ color: '#B9C2C8', metalness: 1, roughness: 0.25 }), 0.4));
  const zincMat = track(addCaustics(new THREE.MeshStandardMaterial({ color: '#AEB4B6', metalness: 0.6, roughness: 0.55 }), 0.4));
  const ruddMat = track(addCaustics(new THREE.MeshStandardMaterial({ color: y.antifoul, roughness: 0.8 }), 0.4));

  const nu = hi ? 150 : 60, nt = hi ? 64 : 24;

  // underwater hull (antifouling, carries the fouling skin)
  const underGeo = track(gridGeometry(nu, nt, (a, b, o) => { shape.under(a, -1 + 2 * b, o); }, (a, b) => [a, b]));
  const underMesh = new THREE.Mesh(underGeo, underMat);
  underMesh.name = 'under';
  group.add(underMesh);

  // topsides: boot stripe band + main hull, both sides
  for (const side of [-1, 1]) {
    const band = new THREE.Mesh(track(gridGeometry(nu, 3, (a, b, o) => shape.top(a, b * 0.06, side, o))), stripeMat);
    const main = new THREE.Mesh(track(gridGeometry(nu, hi ? 18 : 8, (a, b, o) => shape.top(a, 0.06 + b * 0.94, side, o))), hullMat);
    group.add(band, main);
    // hull side windows
    const win = new THREE.Mesh(
      track(gridGeometry(40, 3, (a, b, o) => {
        const u = 0.42 + a * 0.2;
        const s = 0.5 + b * 0.13 * (1 - Math.pow(Math.abs(a - 0.5) * 2, 6));
        shape.top(u, s, side, o);
        o.z += side * 0.012;
      })),
      glassMat,
    );
    group.add(win);
    // rub rail just under the sheer
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 60; i++) { const p = shape.top(i / 60, 0.97, side); p.z += side * 0.03; pts.push(p); }
    const rail = new THREE.Mesh(track(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.035, 8)), steelMat);
    group.add(rail);
  }

  // transom
  {
    const verts: number[] = [];
    const ring: THREE.Vector3[] = [];
    const N = 20;
    for (let i = 0; i <= N; i++) ring.push(shape.under(0, -1 + (2 * i) / N));
    for (let i = 0; i <= 10; i++) ring.push(shape.top(0, i / 10, 1));
    for (let i = 10; i >= 0; i--) ring.push(shape.top(0, i / 10, -1).clone().setY(shape.top(0, i / 10, -1).y));
    const c = new THREE.Vector3(); ring.forEach((p) => c.add(p)); c.multiplyScalar(1 / ring.length);
    // split: below y=0 antifoul, above hull colour
    const above: number[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const arr = (a.y + b.y) / 2 < 0.01 ? verts : above;
      arr.push(c.x, c.y, c.z, a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const g1 = track(new THREE.BufferGeometry()); g1.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); g1.computeVertexNormals();
    const g2 = track(new THREE.BufferGeometry()); g2.setAttribute('position', new THREE.Float32BufferAttribute(above, 3)); g2.computeVertexNormals();
    group.add(new THREE.Mesh(g1, ruddMat), new THREE.Mesh(g2, hullMat));
    // name board
    const tex = track(nameTexture(y.name, 'Hurghada', y.hullColor === '#1D2B42' || y.hullColor === '#3A4048' ? '#E8E3D6' : '#1D2B42'));
    const plane = new THREE.Mesh(track(new THREE.PlaneGeometry(B * 0.62, B * 0.155)), track(new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false })));
    plane.position.set(-L / 2 - 0.02, shape.sheer(0) * 0.56, 0);
    plane.rotation.y = -Math.PI / 2;
    group.add(plane);
    // swim platform
    const plat = new THREE.Mesh(track(new RoundedBoxGeometry(1.0, 0.1, B * 0.86, 2, 0.04)), teakMat);
    plat.position.set(-L / 2 - 0.5, 0.32, 0);
    group.add(plat);
  }

  // deck
  const deck = new THREE.Mesh(
    track(gridGeometry(nu, 16, (a, b, o) => shape.deck(a, -1 + 2 * b, o))),
    track(new THREE.MeshStandardMaterial({ map: track(deckTexture()), roughness: 0.6 })),
  );
  group.add(deck);

  // bow rail with stanchions
  for (const side of [-1, 1]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 30; i++) {
      const u = 0.5 + (i / 30) * 0.49;
      const p = shape.deck(u, side * 0.9);
      p.y += 0.62;
      pts.push(p);
    }
    group.add(new THREE.Mesh(track(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.018, 6)), steelMat));
    for (let i = 0; i <= 6; i++) {
      const u = 0.5 + (i / 6) * 0.46;
      const p = shape.deck(u, side * 0.9);
      const st = new THREE.Mesh(track(new THREE.CylinderGeometry(0.014, 0.014, 0.62, 6)), steelMat);
      st.position.set(p.x, p.y + 0.31, p.z);
      group.add(st);
    }
  }

  // superstructure
  const deckY = shape.sheer(0.45) + 0.04;
  const W = B * 0.5;
  if (y.style === 'flybridge' || y.style === 'explorer') {
    const tall = y.style === 'explorer';
    const cabH = tall ? 1.55 : 1.25;
    const x0 = -L * 0.3, x1 = L * (tall ? 0.16 : 0.2);
    const cabin = new THREE.Mesh(track(extrudeUp(footprint(x0, x1, W * 0.86, W * 0.62, tall ? 0.9 : 0.55), cabH)), superMat);
    cabin.position.y = deckY;
    group.add(cabin);
    const band = new THREE.Mesh(track(extrudeUp(footprint(x0 + 0.5, x1 + 0.05, W * 0.86 + 0.03, W * 0.62 + 0.03, tall ? 0.9 : 0.55), cabH * 0.42, 0.02)), glassMat);
    band.position.y = deckY + cabH * 0.42;
    group.add(band);
    // flybridge deck and bulwark
    const fx0 = -L * 0.24, fx1 = L * (tall ? 0.08 : 0.06);
    const fly = new THREE.Mesh(track(extrudeUp(footprint(fx0, fx1, W * 0.8, W * 0.55, 0.8), 0.42)), superMat);
    fly.position.y = deckY + cabH + 0.06;
    group.add(fly);
    // windscreen strip on flybridge
    const ws = new THREE.Mesh(track(extrudeUp(footprint(fx1 - 0.6, fx1 + 0.04, W * 0.56, W * 0.42, 0.8), 0.2, 0.02)), glassMat);
    ws.position.y = deckY + cabH + 0.5;
    group.add(ws);
    // hardtop on posts
    const htY = deckY + cabH + 0.48 + 1.55;
    const ht = new THREE.Mesh(track(extrudeUp(footprint(fx0 - 0.3, fx1 - 0.6, W * 0.82, W * 0.62, 0.7), 0.08, 0.04)), superMat);
    ht.position.y = htY;
    group.add(ht);
    for (const [px, pz] of [[fx0 + 0.1, W * 0.7], [fx0 + 0.1, -W * 0.7], [fx1 - 1.1, W * 0.55], [fx1 - 1.1, -W * 0.55]]) {
      const post = new THREE.Mesh(track(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 8)), steelMat);
      post.position.set(px, deckY + cabH + 0.48 + 0.75, pz);
      group.add(post);
    }
    // radar dome + antennas
    const dome = new THREE.Mesh(track(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 24)), superMat);
    dome.position.set((fx0 + fx1) / 2 - 0.4, htY + 0.2, 0);
    group.add(dome);
    for (const z of [-0.5, 0.5]) {
      const ant = new THREE.Mesh(track(new THREE.CylinderGeometry(0.012, 0.02, 1.4, 6)), superMat);
      ant.position.set(fx0 + 0.6, htY + 0.75, z);
      group.add(ant);
    }
    if (tall) {
      const mast = new THREE.Mesh(track(new THREE.CylinderGeometry(0.05, 0.08, 2.2, 10)), steelMat);
      mast.position.set(fx0 + 1.2, htY + 1.1, 0);
      group.add(mast);
    }
  } else {
    // sport: low cabin, long hardtop with glass sides
    const cabH = 0.95;
    const x0 = -L * 0.2, x1 = L * 0.26;
    const cabin = new THREE.Mesh(track(extrudeUp(footprint(x0, x1, W * 0.84, W * 0.45, 0.4), cabH)), superMat);
    cabin.position.y = deckY;
    group.add(cabin);
    const glass = new THREE.Mesh(track(extrudeUp(footprint(x0 + 0.2, x1 - 1.2, W * 0.8, W * 0.62, 0.5), 0.8, 0.02)), glassMat);
    glass.position.y = deckY + cabH;
    group.add(glass);
    const ht = new THREE.Mesh(track(extrudeUp(footprint(x0 - 0.8, x1 - 1.1, W * 0.86, W * 0.62, 0.5), 0.09, 0.05)), superMat);
    ht.position.y = deckY + cabH + 0.8;
    group.add(ht);
    const band = new THREE.Mesh(track(extrudeUp(footprint(x0 + 0.6, x1 + 0.04, W * 0.84 + 0.02, W * 0.45 + 0.02, 0.4), 0.22, 0.01)), glassMat);
    band.position.y = deckY + cabH * 0.55;
    group.add(band);
  }

  // cockpit seat block
  const seat = new THREE.Mesh(track(new RoundedBoxGeometry(0.7, 0.45, B * 0.62, 3, 0.08)), track(new THREE.MeshStandardMaterial({ color: '#E6E1D6', roughness: 0.85 })));
  seat.position.set(-L * 0.43, shape.sheer(0.05) + 0.2, 0);
  group.add(seat);

  // running gear: shafts, struts, propellers, rudders, anodes
  const props: THREE.Group[] = [];
  const shafts: { from: THREE.Vector3; to: THREE.Vector3 }[] = [];
  const gearPoints: THREE.Vector3[] = [];
  const anodes: THREE.Mesh[] = [];
  let bentBlade: THREE.Object3D | null = null;
  let rope: THREE.Object3D | null = null;
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
    // strut
    const sp = from.clone().lerp(to, 0.78);
    const hullAbove = shape.under(0.12, zt);
    const strut = new THREE.Mesh(track(new THREE.BoxGeometry(0.05, hullAbove.y - sp.y + 0.05, 0.14)), bronzeMat);
    strut.position.set(sp.x, (hullAbove.y + sp.y) / 2, sp.z);
    group.add(strut);
    // collar anode
    const collar = new THREE.Mesh(track(new THREE.CylinderGeometry(0.07 * anodeScale, 0.07 * anodeScale, 0.1, 14)), zincMat);
    collar.position.copy(from.clone().lerp(to, 0.6));
    collar.quaternion.copy(shaft.quaternion);
    group.add(collar);
    anodes.push(collar);
    // propeller
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
    // rudder
    const rc = shape.under(0.025, zt);
    const rudder = new THREE.Mesh(track(new THREE.BoxGeometry(0.42, shape.D * 0.85, 0.04)), ruddMat);
    rudder.position.set(rc.x, rc.y - shape.D * 0.42, rc.z);
    group.add(rudder);
    for (let i = 0; i < 40; i++) gearPoints.push(from.clone().lerp(to, i / 39));
    gearPoints.push(to.clone());
    // rope wrap
    if (ropeFinding && ((ropeFinding.side === 'port' && side < 0) || (ropeFinding.side === 'starboard' && side > 0))) {
      const rg = new THREE.Group();
      const ropeMat = track(addCaustics(new THREE.MeshStandardMaterial({ color: '#E2B23A', roughness: 0.85 }), 0.4));
      for (let k = 0; k < 5; k++) {
        const tor = new THREE.Mesh(track(new THREE.TorusGeometry(0.07 + k * 0.004, 0.018, 8, 24)), ropeMat);
        tor.position.set(0, (k - 2) * 0.03, 0);
        tor.rotation.x = Math.PI / 2 + (k % 2 ? 0.25 : -0.2);
        rg.add(tor);
      }
      const tail = new THREE.Mesh(track(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.07, 0, 0), new THREE.Vector3(0.25, -0.3, 0.1), new THREE.Vector3(0.1, -0.8, 0.25), new THREE.Vector3(0.3, -1.3, 0.1)]), 30, 0.016, 6)), ropeMat);
      rg.add(tail);
      rg.position.copy(from.clone().lerp(to, 0.88));
      rg.quaternion.copy(shaft.quaternion);
      group.add(rg);
      rope = rg;
    }
  }
  // transom anodes
  for (const z of [-0.35, 0.35]) {
    const a = new THREE.Mesh(track(new RoundedBoxGeometry(0.06, 0.18 * anodeScale, 0.32 * anodeScale, 2, 0.02)), zincMat);
    const p = shape.under(0.0, z / (shape.hb(0) * B * 0.5));
    a.position.set(-L / 2 - 0.04, p.y * 0.5, z);
    group.add(a);
    anodes.push(a);
  }

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
    dispose: () => { disposables.forEach((d) => d.dispose()); },
  };
}

/** Low-detail neighbour yacht for the marina. */
export function buildNeighbour(y: Yacht, antifoulSkin: THREE.Texture) {
  return buildYacht(y, antifoulSkin, { detail: 'low' });
}
