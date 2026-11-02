import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { addCaustics, causticUniforms } from './environment';
import { HullShape } from './hull';

function logoTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const x = c.getContext('2d')!;
  x.clearRect(0, 0, 512, 256);
  x.translate(56, 40);
  x.lineCap = 'round';
  x.strokeStyle = '#0A2233'; x.lineWidth = 18;
  x.beginPath(); x.moveTo(14 * 2, 40 * 2); x.lineTo(186 * 2, 40 * 2); x.stroke();
  x.beginPath(); x.arc(200, 80, 124, 0, Math.PI); x.stroke();
  x.strokeStyle = '#19C3C9'; x.lineWidth = 14;
  x.beginPath(); x.arc(200, 80, 80, 0, Math.PI); x.stroke();
  x.beginPath(); x.arc(200, 80, 38, 0, Math.PI); x.stroke();
  x.fillStyle = '#FF6B4A'; x.beginPath(); x.arc(252, 140, 16, 0, Math.PI * 2); x.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function bristleTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = '#1C2730'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 105;
    x.fillStyle = Math.random() < 0.7 ? '#E8E2D2' : '#19C3C9';
    x.fillRect(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 2, 2);
  }
  x.fillStyle = '#0A2233'; x.beginPath(); x.arc(128, 128, 22, 0, Math.PI * 2); x.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

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
  u = 0.5; t = 0.6;
  onHull = false;

  constructor() {
    const navy = addCaustics(new THREE.MeshPhysicalMaterial({ color: '#0E2A3D', roughness: 0.35, clearcoat: 0.7 }), 0.3);
    const white = addCaustics(new THREE.MeshPhysicalMaterial({ color: '#EEF1EE', roughness: 0.4, clearcoat: 0.5 }), 0.3);
    const cyan = addCaustics(new THREE.MeshStandardMaterial({ color: '#19C3C9', roughness: 0.45 }), 0.3);
    const dark = new THREE.MeshStandardMaterial({ color: '#141B21', roughness: 0.6, metalness: 0.3 });
    const glass = new THREE.MeshPhysicalMaterial({ color: '#203845', roughness: 0.02, metalness: 0.2, transmission: 0, clearcoat: 1, opacity: 0.85, transparent: true });

    // the robot's local -Y faces the hull; +X is forward
    const hull = new THREE.Mesh(new RoundedBoxGeometry(0.66, 0.2, 0.5, 4, 0.06), navy);
    this.body.add(hull);
    const float = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.14, 0.46, 4, 0.06), white);
    float.position.y = 0.16;
    this.body.add(float);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.61, 0.03, 0.47), cyan);
    stripe.position.y = 0.105;
    this.body.add(stripe);
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.17), new THREE.MeshBasicMaterial({ map: logoTexture(), transparent: true }));
    logo.rotation.x = -Math.PI / 2;
    logo.position.set(-0.02, 0.232, 0);
    this.body.add(logo);
    // camera dome + lights at the front
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass);
    dome.rotation.z = -Math.PI / 2;
    dome.position.set(0.33, 0.02, 0);
    this.body.add(dome);
    this.leds = new THREE.MeshBasicMaterial({ color: '#E8FBFF', toneMapped: false });
    for (const z of [-0.17, 0.17]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 16), this.leds);
      l.rotation.z = Math.PI / 2;
      l.position.set(0.335, 0.03, z);
      this.body.add(l);
    }
    const status = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), new THREE.MeshBasicMaterial({ color: '#FF6B4A', toneMapped: false }));
    status.position.set(-0.3, 0.12, 0.17);
    this.body.add(status);
    // thrusters: 4 vectored + 2 vertical
    const ductGeo = new THREE.TorusGeometry(0.055, 0.016, 8, 20);
    const hubGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.06, 10);
    for (const [x, z, a] of [[0.27, 0.25, 0.8], [0.27, -0.25, -0.8], [-0.27, 0.25, -0.8], [-0.27, -0.25, 0.8]] as const) {
      const g = new THREE.Group();
      const duct = new THREE.Mesh(ductGeo, dark);
      const hub = new THREE.Mesh(hubGeo, dark);
      hub.rotation.x = Math.PI / 2;
      g.add(duct, hub);
      g.position.set(x, 0, z);
      g.rotation.y = a;
      this.body.add(g);
    }
    for (const x of [-0.18, 0.18]) {
      const duct = new THREE.Mesh(ductGeo, dark);
      duct.rotation.x = Math.PI / 2;
      duct.position.set(x, 0.24, 0.17);
      this.body.add(duct);
    }
    // brush head underneath
    this.brush = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 32), [
      new THREE.MeshStandardMaterial({ color: '#1C2730', roughness: 0.8 }),
      new THREE.MeshStandardMaterial({ map: bristleTexture(), roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ map: bristleTexture(), roughness: 0.9 }),
    ]);
    this.brush.position.y = -0.13;
    this.body.add(this.brush);
    // cavitation jet ring around the brush
    this.jetRing = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.014, 8, 40), new THREE.MeshStandardMaterial({ color: '#B9C2C8', metalness: 1, roughness: 0.25, emissive: '#19C3C9', emissiveIntensity: 0 }));
    this.jetRing.rotation.x = Math.PI / 2;
    this.jetRing.position.y = -0.11;
    this.body.add(this.jetRing);
    // skirt / suction shroud
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.27, 0.05, 32, 1, true), dark);
    skirt.position.y = -0.12;
    this.body.add(skirt);

    this.spot = new THREE.SpotLight('#E6FBFF', 26, 7, 0.65, 0.5, 1.4);
    this.spot.position.set(0.33, 0.03, 0);
    this.spotTarget.position.set(1.5, -0.6, 0);
    this.body.add(this.spot, this.spotTarget);
    this.spot.target = this.spotTarget;

    this.group.add(this.body);

    this.tetherMat = new THREE.MeshStandardMaterial({ color: '#F0C030', roughness: 0.6 });
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
    this.group.position.copy(p).addScaledVector(n, 0.17);
    this.group.quaternion.slerp(q, 0.25);
  }

  /** Brush spin and jet glow. */
  animate(dt: number, brushing: boolean, jetting: boolean) {
    this.brush.rotation.y += dt * (brushing || jetting ? 22 : 2);
    const m = this.jetRing.material as THREE.MeshStandardMaterial;
    m.emissiveIntensity = THREE.MathUtils.lerp(m.emissiveIntensity, jetting ? 2.2 : 0, 0.2);
    this.leds.color.setScalar(1.6 + Math.sin(causticUniforms.uTime.value * 3) * 0.05);
  }

  /** Rebuild the yellow tether from the tender to the robot (throttled). */
  updateTether(from: THREE.Vector3) {
    if (this.tetherFrame++ % 3) return;
    const to = new THREE.Vector3();
    this.body.localToWorld(to.set(-0.33, 0.12, 0));
    const mid1 = from.clone().lerp(to, 0.35); mid1.y -= 1.2;
    const mid2 = from.clone().lerp(to, 0.7); mid2.y -= 0.8;
    const curve = new THREE.CatmullRomCurve3([from, mid1, mid2, to]);
    this.tether.geometry.dispose();
    this.tether.geometry = new THREE.TubeGeometry(curve, 40, 0.011, 6, false);
  }
}
