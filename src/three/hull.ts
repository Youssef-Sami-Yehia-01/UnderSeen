import * as THREE from 'three';

/**
 * Parametric motor-yacht hull in metres.
 * x runs along the boat (bow = +x), y is up (waterline = 0), z is across (starboard = +z).
 * Underwater surface is addressed by (u, t): u = 0 stern → 1 bow, t = -1 port waterline → +1 starboard waterline.
 * Topsides are addressed by (u, s, side): s = 0 waterline → 1 sheer line.
 */
const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

export class HullShape {
  L: number; B: number; D: number; F: number;
  constructor(lengthM: number, beamM: number) {
    this.L = lengthM;
    this.B = beamM;
    this.D = lengthM * 0.07;
    this.F = lengthM * 0.11;
  }
  /** waterline half-beam fraction */
  hb(u: number) {
    u = Math.min(1, Math.max(0, u));
    return u < 0.5 ? 0.93 + 0.07 * (u / 0.5) : Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs((u - 0.5) / 0.5), 2.2)));
  }
  /** draft fraction */
  df(u: number) {
    u = Math.min(1, Math.max(0, u));
    return u < 0.55 ? 0.8 + 0.2 * Math.sin((Math.PI * u) / 1.1) : Math.max(0, 1 - Math.pow((u - 0.55) / 0.45, 1.6));
  }
  /** deck half-beam fraction */
  bd(u: number) {
    u = Math.min(1, Math.max(0, u));
    return u < 0.5 ? 1.05 : 1.05 * Math.sqrt(Math.max(0, 1 - Math.pow((u - 0.5) / 0.5, 2.4)));
  }
  rake(u: number) { return this.L * 0.075 * smooth(0.62, 1, u); }
  sheer(u: number) { return this.F * (1 + 0.22 * u * u); }

  under(u: number, t: number, out = new THREE.Vector3()) {
    const x = (u - 0.5) * this.L;
    const z = t * this.hb(u) * this.B * 0.5;
    const y = -this.D * this.df(u) * (1 - Math.pow(Math.abs(t), 1.25));
    return out.set(x, y, z);
  }
  top(u: number, s: number, side: number, out = new THREE.Vector3()) {
    const x = (u - 0.5) * this.L + this.rake(u) * s;
    const half = THREE.MathUtils.lerp(this.hb(u), this.bd(u), Math.pow(s, 0.7)) * this.B * 0.5;
    return out.set(x, s * this.sheer(u), side * half);
  }
  deck(u: number, v: number, out = new THREE.Vector3()) {
    const x = (u - 0.5) * this.L + this.rake(u);
    const z = v * this.bd(u) * this.B * 0.5;
    return out.set(x, this.sheer(u) + 0.05 * (1 - v * v), z);
  }
  /** outward normal on the underwater surface */
  underNormal(u: number, t: number, out = new THREE.Vector3()) {
    const e = 0.002;
    const p = this.under(u, t);
    const pu = this.under(Math.min(1, u + e), t).sub(this.under(Math.max(0, u - e), t));
    const pt = this.under(u, Math.min(1, t + e)).sub(this.under(u, Math.max(-1, t - e)));
    out.crossVectors(pu, pt).normalize();
    const ref = new THREE.Vector3(0, p.y + 0.05, p.z);
    if (out.dot(ref) < 0) out.negate();
    if (out.lengthSq() < 0.5) out.set(0, -1, 0);
    return out;
  }
  /** approximate girth of the underwater section at u (waterline to waterline) */
  girth(u: number) {
    let g = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    this.under(u, -1, a);
    for (let i = 1; i <= 16; i++) {
      this.under(u, -1 + (2 * i) / 16, b);
      g += a.distanceTo(b);
      a.copy(b);
    }
    return Math.max(0.3, g);
  }
  /** wetted area estimate (m²) */
  area() {
    let a = 0;
    for (let i = 0; i < 40; i++) a += this.girth((i + 0.5) / 40) * (this.L / 40);
    return a;
  }
}

/** Build an indexed grid geometry. */
export function gridGeometry(
  nu: number,
  nv: number,
  pos: (a: number, b: number, out: THREE.Vector3) => void,
  uv?: (a: number, b: number) => [number, number],
) {
  const verts: number[] = [], uvs: number[] = [], idx: number[] = [];
  const v = new THREE.Vector3();
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const a = i / nu, b = j / nv;
      pos(a, b, v);
      verts.push(v.x, v.y, v.z);
      const w = uv ? uv(a, b) : [a, b];
      uvs.push(w[0], w[1]);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const p = j * (nu + 1) + i;
      idx.push(p, p + 1, p + nu + 1, p + 1, p + nu + 2, p + nu + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
