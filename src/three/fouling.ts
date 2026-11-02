import * as THREE from 'three';
import { HullShape } from './hull';
import { addCaustics } from './environment';
import { mulberry32, type Yacht, type Finding } from '../lib/yacht';

export const SKIN_W = 1024;
export const SKIN_H = 256;
export type Tool = 'brush' | 'jet';

export interface Barnacle { u: number; t: number; hp: number; alive: boolean; idx: number; pos: THREE.Vector3; normal: THREE.Vector3; scale: number }

const toPx = (u: number, t: number): [number, number] => [u * SKIN_W, ((t + 1) / 2) * SKIN_H];

/** Draws the yacht's problems onto a skin canvas (they sit under the fouling). */
function drawFindings(x: CanvasRenderingContext2D, y: Yacht, shape: HullShape, findings: Finding[]) {
  const r = mulberry32(y.seed ^ 0x55aa);
  const mU = SKIN_W / shape.L; // px per metre along the hull
  for (const f of findings) {
    const [px, py] = toPx(f.u, f.t);
    const mT = SKIN_H / shape.girth(f.u); // px per metre across
    if (f.kind === 'scrape') {
      const len = (parseInt(f.size.replace(/\D+/g, ' ').trim().split(' ')[0] || '20', 10) / 100) * mU;
      x.save();
      x.lineCap = 'round';
      for (const [w, c] of [[5, 'rgba(20,20,20,.35)'], [3.2, '#E3DED2'], [1.2, '#FFFFFF']] as const) {
        x.strokeStyle = c; x.lineWidth = w;
        x.beginPath();
        x.moveTo(px - len / 2, py);
        for (let k = 1; k <= 8; k++) x.lineTo(px - len / 2 + (len * k) / 8, py + (r() - 0.5) * 3);
        x.stroke();
      }
      x.restore();
    } else if (f.kind === 'blisters') {
      const n = parseInt(f.size, 10) || 9;
      for (let k = 0; k < n; k++) {
        const bx = px + (r() - 0.5) * 0.5 * mU, by = py + (r() - 0.5) * 0.4 * mT;
        const rad = (0.01 + r() * 0.018) * mU;
        const g = x.createRadialGradient(bx - rad * 0.35, by - rad * 0.35, rad * 0.1, bx, by, rad);
        g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(0.6, 'rgba(160,160,150,.35)'); g.addColorStop(1, 'rgba(0,0,0,.45)');
        x.fillStyle = g; x.beginPath(); x.arc(bx, by, rad, 0, Math.PI * 2); x.fill();
      }
    } else if (f.kind === 'paint') {
      x.save();
      x.fillStyle = '#8F918B';
      x.beginPath();
      const w = 0.4 * mU, h = 0.2 * mT;
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        const rr = 0.75 + r() * 0.35;
        const xx = px + Math.cos(a) * w * 0.5 * rr, yy = py + Math.sin(a) * h * 0.5 * rr;
        k ? x.lineTo(xx, yy) : x.moveTo(xx, yy);
      }
      x.closePath(); x.fill();
      x.strokeStyle = 'rgba(0,0,0,.3)'; x.lineWidth = 1.2; x.stroke();
      x.restore();
    } else if (f.kind === 'intake') {
      const w = 0.36 * mU, h = 0.22 * mT;
      x.fillStyle = '#0E1114'; x.fillRect(px - w / 2, py - h / 2, w, h);
      x.fillStyle = '#5B6268';
      for (let k = 1; k < 6; k++) x.fillRect(px - w / 2 + (w * k) / 6 - 1, py - h / 2, 2, h);
    }
  }
}

export class FoulingSystem {
  shape: HullShape;
  yacht: Yacht;
  base: HTMLCanvasElement;   // previous scan: clean, no new findings
  clean: HTMLCanvasElement;  // clean hull with this month's findings
  skin: HTMLCanvasElement;   // what is displayed: clean + growth
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  barnacles: Barnacle[] = [];
  mesh: THREE.InstancedMesh;
  cellsU = 128; cellsT = 32;
  cleaned: Uint8Array;
  cleanedCount = 0;
  removed = 0;
  private buckets = new Map<number, Barnacle[]>();
  private dirty = false;

  constructor(y: Yacht, shape: HullShape) {
    this.yacht = y;
    this.shape = shape;
    const mk = () => { const c = document.createElement('canvas'); c.width = SKIN_W; c.height = SKIN_H; return c; };
    this.base = mk(); this.clean = mk(); this.skin = mk();
    this.paintBase(this.base.getContext('2d')!);
    const cx = this.clean.getContext('2d')!;
    cx.drawImage(this.base, 0, 0);
    drawFindings(cx, y, shape, y.findings);
    this.ctx = this.skin.getContext('2d')!;
    this.ctx.drawImage(this.clean, 0, 0);
    this.paintGrowth(this.ctx);
    this.texture = new THREE.CanvasTexture(this.skin);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.cleaned = new Uint8Array(this.cellsU * this.cellsT);
    this.mesh = this.makeBarnacles();
  }

  private paintBase(x: CanvasRenderingContext2D) {
    const r = mulberry32(this.yacht.seed ^ 0x1234);
    x.fillStyle = this.yacht.antifoul;
    x.fillRect(0, 0, SKIN_W, SKIN_H);
    for (let i = 0; i < 9000; i++) {
      x.fillStyle = r() < 0.5 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.06)';
      x.fillRect(r() * SKIN_W, r() * SKIN_H, 1 + r() * 2, 1 + r() * 2);
    }
    // faint roller marks along the hull
    x.strokeStyle = 'rgba(255,255,255,.025)';
    for (let yy = 0; yy < SKIN_H; yy += 7) { x.beginPath(); x.moveTo(0, yy + r() * 2); x.lineTo(SKIN_W, yy + r() * 2); x.stroke(); }
    // keel band slightly worn
    x.fillStyle = 'rgba(255,255,255,.04)';
    x.fillRect(0, SKIN_H / 2 - 3, SKIN_W, 6);
  }

  private paintGrowth(x: CanvasRenderingContext2D) {
    const y = this.yacht;
    const r = mulberry32(y.seed ^ 0xbeef);
    const lvl = y.fouling === 'light' ? 0.45 : y.fouling === 'medium' ? 0.75 : 1;
    const cols = ['#5E7A3F', '#4A6131', '#73844A', '#3E532D', '#857A47', '#677D43', '#4F5F36'];
    // base slime film over everything
    x.fillStyle = `rgba(78,95,58,${0.55 * lvl + 0.25})`;
    x.fillRect(0, 0, SKIN_W, SKIN_H);
    const blobs = Math.round(2400 * lvl);
    for (let i = 0; i < blobs; i++) {
      const u = r(), t = r() * 2 - 1;
      const edge = Math.abs(t);
      if (r() > 0.35 + edge * 0.65) continue; // denser toward the waterline
      const [px, py] = toPx(u, t);
      const mU = SKIN_W / this.shape.L, mT = SKIN_H / this.shape.girth(u);
      const rad = (0.03 + r() * 0.12) * (0.7 + edge * 0.8);
      x.globalAlpha = 0.25 + r() * 0.5;
      x.fillStyle = cols[(r() * cols.length) | 0];
      x.beginPath(); x.ellipse(px, py, rad * mU, rad * mT, r() * 3, 0, Math.PI * 2); x.fill();
    }
    // weed beard near the waterline
    x.globalAlpha = 1;
    x.lineCap = 'round';
    for (let i = 0; i < 1400 * lvl; i++) {
      const u = r(), side = r() < 0.5 ? -1 : 1, t = side * (0.86 + r() * 0.14);
      const [px, py] = toPx(u, t);
      x.strokeStyle = r() < 0.5 ? 'rgba(70,105,50,.7)' : 'rgba(110,125,60,.6)';
      x.lineWidth = 1 + r() * 1.5;
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + (r() - 0.5) * 4, py - side * (4 + r() * 10)); x.stroke();
    }
    // fine speckle
    for (let i = 0; i < 6000; i++) {
      x.fillStyle = r() < 0.5 ? 'rgba(200,190,150,.18)' : 'rgba(20,30,15,.2)';
      x.fillRect(r() * SKIN_W, r() * SKIN_H, 1.5, 1.5);
    }
  }

  private makeBarnacles() {
    const y = this.yacht, s = this.shape;
    const r = mulberry32(y.seed ^ 0xb4);
    const pts: { u: number; t: number }[] = [];
    let guard = 0;
    while (pts.length < y.barnacleCount && guard++ < 50000) {
      const u = 0.02 + r() * 0.96, t = (r() * 2 - 1) * 0.985;
      const w = 0.25 + Math.abs(t) * 0.55 + (u < 0.3 ? 0.35 : 0) + (r() < 0.04 ? 1 : 0);
      if (r() < w) pts.push({ u, t });
    }
    const intake = y.findings.find((f) => f.kind === 'intake');
    if (intake) for (let i = 0; i < 26; i++) pts.push({ u: intake.u + (r() - 0.5) * 0.03, t: intake.t + (r() - 0.5) * 0.08 });
    // clusters
    for (let c = 0; c < 18; c++) {
      const cu = r(), ct = (r() * 2 - 1) * 0.95;
      const n = y.fouling === 'heavy' ? 30 : y.fouling === 'medium' ? 14 : 4;
      for (let i = 0; i < n; i++) pts.push({ u: Math.min(0.98, Math.max(0.02, cu + (r() - 0.5) * 0.025)), t: Math.min(0.985, Math.max(-0.985, ct + (r() - 0.5) * 0.08)) });
    }

    const prof = [
      new THREE.Vector2(0.0, 0), new THREE.Vector2(1.0, 0), new THREE.Vector2(0.97, 0.18), new THREE.Vector2(0.82, 0.48),
      new THREE.Vector2(0.62, 0.72), new THREE.Vector2(0.44, 0.78), new THREE.Vector2(0.36, 0.7), new THREE.Vector2(0.3, 0.55), new THREE.Vector2(0.0, 0.5),
    ];
    const geo = new THREE.LatheGeometry(prof, 9);
    // ridges
    const p = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i), vz = p.getZ(i), vy = p.getY(i);
      const a = Math.atan2(vz, vx);
      const k = 1 + 0.08 * Math.sin(a * 6) * (vy > 0.05 && vy < 0.7 ? 1 : 0);
      p.setX(i, vx * k); p.setZ(i, vz * k);
    }
    geo.computeVertexNormals();
    const mat = addCaustics(new THREE.MeshStandardMaterial({ color: '#D8D0BC', roughness: 0.92, metalness: 0 }), 0.35);
    const mesh = new THREE.InstancedMesh(geo, mat, pts.length);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    pts.forEach((pt, i) => {
      const pos = s.under(pt.u, pt.t);
      const n = s.underNormal(pt.u, pt.t);
      const sc = 0.011 + r() * 0.017;
      q.setFromUnitVectors(up, n);
      m.compose(pos.clone().addScaledVector(n, -0.002), q, new THREE.Vector3(sc, sc * (0.8 + r() * 0.6), sc));
      mesh.setMatrixAt(i, m);
      col.setHSL(0.11 + r() * 0.04, 0.12 + r() * 0.12, 0.62 + r() * 0.18);
      mesh.setColorAt(i, col);
      const b: Barnacle = { u: pt.u, t: pt.t, hp: 1, alive: true, idx: i, pos, normal: n, scale: sc };
      this.barnacles.push(b);
      const key = this.bucketKey(pt.u, pt.t);
      if (!this.buckets.has(key)) this.buckets.set(key, []);
      this.buckets.get(key)!.push(b);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
  }

  private bucketKey(u: number, t: number) {
    const bu = Math.floor(u * 64), bt = Math.floor(((t + 1) / 2) * 16);
    return bu * 100 + bt;
  }

  get total() { return this.barnacles.length; }
  get alive() { return this.total - this.removed; }
  coverage() { return this.cleanedCount / this.cleaned.length; }

  /** Barnacles within radius (metres) of (u, t). */
  barnaclesNear(u: number, t: number, radius: number) {
    const out: Barnacle[] = [];
    const g = this.shape.girth(u);
    const du = radius / this.shape.L, dt = (radius / g) * 2;
    for (let bu = Math.floor((u - du) * 64); bu <= Math.floor((u + du) * 64); bu++) {
      for (let bt = Math.floor(((t - dt + 1) / 2) * 16); bt <= Math.floor(((t + dt + 1) / 2) * 16); bt++) {
        const list = this.buckets.get(bu * 100 + bt);
        if (!list) continue;
        for (const b of list) {
          if (!b.alive) continue;
          const dx = (b.u - u) * this.shape.L, dy = ((b.t - t) / 2) * g;
          if (dx * dx + dy * dy <= radius * radius) out.push(b);
        }
      }
    }
    return out;
  }

  /**
   * Clean around (u, t). Brush removes soft growth but barely marks barnacles; the cavitation jet removes barnacles.
   * Returns the barnacles that came off this call.
   */
  cleanAt(u: number, t: number, radius: number, tool: Tool, dtSec: number) {
    const s = this.shape;
    const g = s.girth(u);
    const [px, py] = toPx(u, t);
    const rx = (radius / s.L) * SKIN_W, ry = (radius / g) * SKIN_H;
    const x = this.ctx;
    x.save();
    x.beginPath();
    x.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
    x.clip();
    x.globalAlpha = tool === 'brush' ? 0.9 : 0.75;
    x.drawImage(this.clean, 0, 0);
    x.restore();
    this.dirty = true;
    // coverage cells
    const cu0 = Math.max(0, Math.floor(((px - rx) / SKIN_W) * this.cellsU)), cu1 = Math.min(this.cellsU - 1, Math.floor(((px + rx) / SKIN_W) * this.cellsU));
    const ct0 = Math.max(0, Math.floor(((py - ry) / SKIN_H) * this.cellsT)), ct1 = Math.min(this.cellsT - 1, Math.floor(((py + ry) / SKIN_H) * this.cellsT));
    for (let i = cu0; i <= cu1; i++) for (let j = ct0; j <= ct1; j++) {
      const cx = ((i + 0.5) / this.cellsU) * SKIN_W, cy = ((j + 0.5) / this.cellsT) * SKIN_H;
      const k = j * this.cellsU + i;
      if (!this.cleaned[k] && ((cx - px) / rx) ** 2 + ((cy - py) / ry) ** 2 <= 1) { this.cleaned[k] = 1; this.cleanedCount++; }
    }
    // barnacles
    const popped: Barnacle[] = [];
    const near = this.barnaclesNear(u, t, radius);
    const dmg = tool === 'jet' ? 9 * dtSec : 0.06 * dtSec;
    const m = new THREE.Matrix4();
    for (const b of near) {
      b.hp -= dmg;
      if (b.hp <= 0) {
        b.alive = false;
        this.removed++;
        m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(b.idx, m);
        popped.push(b);
        // leave a pale base-plate ring where it was, which the jet then lifts too
        const [bx, by] = toPx(b.u, b.t);
        x.fillStyle = 'rgba(225,220,205,.35)';
        x.beginPath(); x.ellipse(bx, by, (b.scale / s.L) * SKIN_W * 0.9, (b.scale / g) * SKIN_H * 0.9, 0, 0, Math.PI * 2); x.fill();
      }
    }
    if (popped.length) this.mesh.instanceMatrix.needsUpdate = true;
    return { popped, barnaclesHere: near.length };
  }

  flush() {
    if (this.dirty) { this.texture.needsUpdate = true; this.dirty = false; }
  }

  /** Show the hull as it looked at the previous scan (for before / after photos). */
  private backup: HTMLCanvasElement | null = null;
  showPrevious(on: boolean) {
    const x = this.ctx;
    if (on) {
      this.backup = document.createElement('canvas');
      this.backup.width = SKIN_W; this.backup.height = SKIN_H;
      this.backup.getContext('2d')!.drawImage(this.skin, 0, 0);
      x.drawImage(this.base, 0, 0);
    } else if (this.backup) {
      x.drawImage(this.backup, 0, 0);
      this.backup = null;
    }
    this.texture.needsUpdate = true;
  }

  /** Bottom-view plan image of the hull for the time-lapse. */
  planImage(growth: number, withFindings: boolean, width = 720) {
    const s = this.shape;
    const H = Math.round(width * 0.42);
    const c = document.createElement('canvas');
    c.width = width; c.height = H;
    const x = c.getContext('2d')!;
    x.fillStyle = '#0B2737'; x.fillRect(0, 0, width, H);
    const src = document.createElement('canvas');
    src.width = SKIN_W; src.height = SKIN_H;
    const sx = src.getContext('2d')!;
    sx.drawImage(withFindings ? this.clean : this.base, 0, 0);
    if (growth > 0) {
      const r = mulberry32(this.yacht.seed + Math.round(growth * 100));
      sx.fillStyle = `rgba(78,95,58,${0.25 + growth * 0.5})`;
      sx.fillRect(0, 0, SKIN_W, SKIN_H);
      for (let i = 0; i < 1600 * growth; i++) {
        const t = r() * 2 - 1;
        if (r() > 0.3 + Math.abs(t) * 0.7) continue;
        sx.globalAlpha = 0.3 + r() * 0.5;
        sx.fillStyle = ['#5E7A3F', '#4A6131', '#73844A', '#857A47'][(r() * 4) | 0];
        const [px, py] = toPx(r(), t);
        sx.beginPath(); sx.arc(px, py, 2 + r() * 7, 0, Math.PI * 2); sx.fill();
      }
      sx.globalAlpha = 1;
      for (let i = 0; i < 700 * growth * growth; i++) {
        const [px, py] = toPx(r(), (r() * 2 - 1) * 0.98);
        sx.fillStyle = '#DCD3BE'; sx.beginPath(); sx.arc(px, py, 1.4 + r() * 1.6, 0, Math.PI * 2); sx.fill();
      }
    }
    const pad = width * 0.06;
    const len = width - pad * 2;
    const maxHalf = (H / 2) * 0.86;
    // draw column by column: u along x (stern left, bow right), t across scaled to hull half-width
    const cols = 240;
    for (let i = 0; i < cols; i++) {
      const u = (i + 0.5) / cols;
      const half = s.hb(u) * maxHalf;
      if (half < 0.5) continue;
      x.drawImage(src, (i / cols) * SKIN_W, 0, SKIN_W / cols + 1, SKIN_H, pad + (i / cols) * len, H / 2 - half, len / cols + 1, half * 2);
    }
    // outline + keel
    x.strokeStyle = 'rgba(220,235,240,.6)'; x.lineWidth = 1.5;
    x.beginPath();
    for (let i = 0; i <= cols; i++) { const u = i / cols; const px = pad + u * len, py = H / 2 - s.hb(u) * maxHalf; i ? x.lineTo(px, py) : x.moveTo(px, py); }
    for (let i = cols; i >= 0; i--) { const u = i / cols; x.lineTo(pad + u * len, H / 2 + s.hb(u) * maxHalf); }
    x.closePath(); x.stroke();
    x.strokeStyle = 'rgba(220,235,240,.25)'; x.beginPath(); x.moveTo(pad, H / 2); x.lineTo(pad + len, H / 2); x.stroke();
    x.fillStyle = 'rgba(220,235,240,.65)'; x.font = '600 11px system-ui, sans-serif';
    x.fillText('STERN', 6, 14); x.textAlign = 'right'; x.fillText('BOW', width - 6, 14);
    return { canvas: c, map: (u: number, t: number) => [pad + u * len, H / 2 + t * s.hb(u) * maxHalf] as [number, number] };
  }

  dispose() {
    this.texture.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
