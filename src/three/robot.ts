import * as THREE from 'three';
import { addCaustics } from './environment';
import { HullShape } from './hull';

/** Wordmark for the top of the float (text only, no symbol). */
function wordmarkTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 128;
  const x = c.getContext('2d')!;
  x.clearRect(0, 0, c.width, c.height);
  x.fillStyle = '#0A2233';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = '700 78px "Helvetica Neue", Arial, sans-serif';
  // letter-spacing by hand
  const word = 'UNDERSEEN';
  const spacing = 22;
  const widths = [...word].map((ch) => x.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (word.length - 1);
  let px = 512 - total / 2;
  x.textAlign = 'left';
  [...word].forEach((ch, i) => { x.fillText(ch, px, 66); px += widths[i] + spacing; });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function bristleTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = '#20282E'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    const a = Math.random() * Math.PI * 2, r = 22 + Math.random() * 104;
    x.fillStyle = Math.random() < 0.85 ? '#D9D4C6' : '#5A646B';
    x.fillRect(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 2, 2);
  }
  x.fillStyle = '#2A3238'; x.beginPath(); x.arc(128, 128, 22, 0, Math.PI * 2); x.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Hull-cleaning drone: low chamfered chassis, four ducted corner thrusters, hi-vis bumpers,
 * a sensor bar at the front, brush head and jet ring facing the hull.
 * Local axes: +X forward, +Y away from the hull, -Y toward the hull.
 */
export class Robot {
  group = new THREE.Group();
  body = new THREE.Group();
  brush: THREE.Mesh;
  jetRing: THREE.Mesh;
  spot: THREE.SpotLight;
  spotTarget = new THREE.Object3D();
  tether: THREE.Mesh;
  tetherMat: THREE.MeshStandardMaterial;
  private tetherFrame = 0;
  leds: THREE.MeshBasicMaterial;
  props: THREE.Object3D[] = [];
  private blurMat: THREE.MeshBasicMaterial;
  scanLine: THREE.Mesh;
  private scanT = 0;
  u = 0.5; t = 0.6;
  onHull = false;

  constructor() {
    const shellMat = addCaustics(new THREE.MeshPhysicalMaterial({ color: '#1B3346', roughness: 0.42, metalness: 0.1, clearcoat: 0.5, clearcoatRoughness: 0.3 }), 0.1);
    const panelMat = addCaustics(new THREE.MeshPhysicalMaterial({ color: '#E9ECEA', roughness: 0.45, clearcoat: 0.4 }), 0.1);
    const darkMat = addCaustics(new THREE.MeshStandardMaterial({ color: '#14191D', roughness: 0.6, metalness: 0.3 }), 0.1);
    const hiVis = addCaustics(new THREE.MeshStandardMaterial({ color: '#F08A24', roughness: 0.5 }), 0.1);
    const alu = new THREE.MeshStandardMaterial({ color: '#AEB6BB', metalness: 1, roughness: 0.32 });
    const glass = new THREE.MeshPhysicalMaterial({ color: '#0B141A', roughness: 0.05, metalness: 0.3, clearcoat: 1 });

    const W = 0.78, D = 0.6; // length (x), width (z)
    // chamfered chassis: low, flat, wide, so it can sit against a hull
    const chamfer = (w: number, d: number, c: number) => {
      const sh = new THREE.Shape();
      sh.moveTo(-w / 2 + c, -d / 2); sh.lineTo(w / 2 - c, -d / 2); sh.lineTo(w / 2, -d / 2 + c); sh.lineTo(w / 2, d / 2 - c);
      sh.lineTo(w / 2 - c, d / 2); sh.lineTo(-w / 2 + c, d / 2); sh.lineTo(-w / 2, d / 2 - c); sh.lineTo(-w / 2, -d / 2 + c); sh.closePath();
      return sh;
    };
    const slab = (w: number, d: number, c: number, h: number, bevel: number) => {
      const g = new THREE.ExtrudeGeometry(chamfer(w, d, c), { depth: h, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1 });
      g.rotateX(-Math.PI / 2); // extrude along +y
      return g;
    };
    const chassis = new THREE.Mesh(slab(W, D, 0.15, 0.07, 0.012), shellMat);
    chassis.position.y = -0.06;
    this.body.add(chassis);
    // raised top panel with the wordmark
    const panel = new THREE.Mesh(slab(0.4, 0.26, 0.05, 0.035, 0.008), panelMat);
    panel.position.set(-0.03, 0.02, 0);
    this.body.add(panel);
    const word = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.0375), new THREE.MeshBasicMaterial({ map: wordmarkTexture(), transparent: true }));
    word.rotation.x = -Math.PI / 2;
    word.position.set(-0.03, 0.0645, 0);
    this.body.add(word);
    // hi-vis bumper along both long edges (so divers and tenders can spot it)
    for (const sz of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(W - 0.32, 0.05, 0.03), hiVis);
      b.position.set(0, -0.025, sz * (D / 2 + 0.008));
      this.body.add(b);
    }
    // four ducted thrusters in the chamfered corners
    const duct = new THREE.CylinderGeometry(0.075, 0.075, 0.07, 28, 1, true);
    const lip = new THREE.TorusGeometry(0.075, 0.009, 8, 28); lip.rotateX(Math.PI / 2);
    const hub = new THREE.CylinderGeometry(0.02, 0.024, 0.05, 10);
    const blade = new THREE.BoxGeometry(0.12, 0.004, 0.026);
    // blur disc shown while the props spin fast (spinning blades strobe at phone frame rates)
    this.blurMat = new THREE.MeshBasicMaterial({ color: '#C9D3D8', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const blurGeo = new THREE.CircleGeometry(0.066, 28); blurGeo.rotateX(-Math.PI / 2);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(duct, new THREE.MeshStandardMaterial({ color: '#14191D', roughness: 0.6, side: THREE.DoubleSide })));
      const l1 = new THREE.Mesh(lip, hiVis); l1.position.y = 0.035; g.add(l1);
      g.add(new THREE.Mesh(hub, alu));
      const pr = new THREE.Group();
      for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(blade, alu); b.rotation.y = (k * Math.PI * 2) / 3; b.rotation.x = 0.4; pr.add(b); }
      pr.position.y = -0.008;
      g.add(pr);
      this.props.push(pr);
      const disc = new THREE.Mesh(blurGeo, this.blurMat);
      disc.position.y = 0.012; disc.renderOrder = 2;
      g.add(disc);
      g.position.set(sx * (W / 2 - 0.05), -0.02, sz * (D / 2 - 0.05));
      // strut from the duct wall to the chassis, outside the blades
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.02), darkMat);
      strut.position.set(-sx * 0.07, 0.02, -sz * 0.07); strut.rotation.y = sx * sz * Math.PI / 4;
      g.add(strut);
      this.body.add(g);
    }
    // sensor bar across the front: one wide camera window and a sonar puck
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3), darkMat);
    bar.position.set(W / 2 - 0.02, -0.02, 0);
    this.body.add(bar);
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.026, 0.22), glass);
    win.position.set(W / 2 + 0.006, -0.02, 0);
    this.body.add(win);
    const sonar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 20), alu);
    sonar.position.set(0.12, 0.012, 0.17);
    this.body.add(sonar);
    // light bars under the front edge, shining at the hull
    this.leds = new THREE.MeshBasicMaterial({ color: '#F2FBFF', toneMapped: false });
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.006, 0.26), this.leds);
    led.position.set(W / 2 - 0.02, -0.068, 0);
    this.body.add(led);
    // status light and tether port at the back
    const status = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.012), new THREE.MeshBasicMaterial({ color: '#19C3C9', toneMapped: false }));
    status.position.set(-W / 2 + 0.03, 0.02, 0.1);
    this.body.add(status);
    const port = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.06, 10), alu);
    port.rotation.z = Math.PI / 2;
    port.position.set(-W / 2 - 0.01, -0.01, 0);
    this.body.add(port);
    // brush head underneath with suction skirt and cavitation jet ring
    this.brush = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.035, 36), [
      new THREE.MeshStandardMaterial({ color: '#20282E', roughness: 0.8 }),
      new THREE.MeshStandardMaterial({ map: bristleTexture(), roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ map: bristleTexture(), roughness: 0.9 }),
    ]);
    this.brush.position.y = -0.1;
    this.body.add(this.brush);
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.245, 0.04, 36, 1, true), new THREE.MeshStandardMaterial({ color: '#151A1E', roughness: 0.7, side: THREE.DoubleSide }));
    skirt.position.y = -0.095;
    this.body.add(skirt);
    this.jetRing = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.011, 8, 48), new THREE.MeshStandardMaterial({ color: '#AEB6BB', metalness: 1, roughness: 0.3, emissive: '#19C3C9', emissiveIntensity: 0 }));
    this.jetRing.rotation.x = Math.PI / 2;
    this.jetRing.position.y = -0.085;
    this.body.add(this.jetRing);

    // scan line: the cameras' laser stripe on the hull just ahead of the robot
    this.scanLine = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.95), new THREE.MeshBasicMaterial({ color: '#3FE6EA', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    this.scanLine.rotation.x = -Math.PI / 2;
    this.scanLine.position.set(W / 2 + 0.22, -0.118, 0);
    this.body.add(this.scanLine);

    this.spot = new THREE.SpotLight('#E8F7FA', 9, 6, 0.75, 0.6, 1.5);
    this.spot.position.set(W / 2 - 0.03, -0.08, 0);
    this.spotTarget.position.set(1.4, -0.9, 0);
    this.body.add(this.spot, this.spotTarget);
    this.spot.target = this.spotTarget;

    this.group.add(this.body);

    this.tetherMat = new THREE.MeshStandardMaterial({ color: '#F08A24', roughness: 0.6, emissive: '#F08A24', emissiveIntensity: 0.15 });
    this.tether = new THREE.Mesh(new THREE.BufferGeometry(), this.tetherMat);
    this.tether.frustumCulled = false;
  }

  /** Put the robot on the hull at (u, t), brush facing the hull. */
  placeOnHull(shape: HullShape, u: number, t: number, heading?: THREE.Vector3) {
    this.u = u; this.t = t;
    const p = shape.under(u, t);
    const n = shape.underNormal(u, t);
    const fwd = (heading ?? new THREE.Vector3(1, 0, 0)).clone();
    fwd.addScaledVector(n, -fwd.dot(n)).normalize();
    if (fwd.lengthSq() < 0.1) fwd.set(1, 0, 0);
    const up = n.clone();
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
    const m = new THREE.Matrix4().makeBasis(fwd, up, right);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    this.group.position.copy(p).addScaledVector(n, 0.125);
    this.group.quaternion.slerp(q, 0.25);
  }

  /** Brush spin, thruster spin and jet glow. */
  animate(dt: number, brushing: boolean, jetting: boolean) {
    const working = brushing || jetting;
    this.brush.rotation.y += dt * (working ? 22 : 2);
    // blades turn slowly enough to read; a soft disc stands in for the fast spin
    this.props.forEach((p) => { p.rotation.y += dt * (working ? 7 : 3); });
    this.blurMat.opacity = THREE.MathUtils.lerp(this.blurMat.opacity, working ? 0.32 : 0, 0.15);
    this.scanT += dt;
    const lm = this.scanLine.material as THREE.MeshBasicMaterial;
    lm.opacity = THREE.MathUtils.lerp(lm.opacity, working ? 0.75 + 0.25 * Math.sin(this.scanT * 9) : 0.25, 0.2);
    const m = this.jetRing.material as THREE.MeshStandardMaterial;
    m.emissiveIntensity = THREE.MathUtils.lerp(m.emissiveIntensity, jetting ? 1.6 : 0, 0.2);
  }

  /** Rebuild the tether from the tender to the robot (throttled). */
  updateTether(from: THREE.Vector3) {
    if (this.tetherFrame++ % 3) return;
    const to = new THREE.Vector3();
    this.body.localToWorld(to.set(-0.42, -0.01, 0));
    const mid1 = from.clone().lerp(to, 0.35); mid1.y -= 1.2;
    const mid2 = from.clone().lerp(to, 0.7); mid2.y -= 0.8;
    const curve = new THREE.CatmullRomCurve3([from, mid1, mid2, to]);
    this.tether.geometry.dispose();
    this.tether.geometry = new THREE.TubeGeometry(curve, 40, 0.011, 6, false);
  }
}
