import * as THREE from 'three';
import { HullShape } from './hull';
import { mulberry32, type Yacht } from '../lib/yacht';

/**
 * Point cloud of the hull. Points appear as the robot cleans (coverage texture, sampled by (u, t)),
 * and a final sweep fills any gaps before the result.
 */
export function buildScanCloud(shape: HullShape, y: Yacht, gear: THREE.Vector3[], count = 32000) {
  const r = mulberry32(y.seed ^ 0x5ca);
  const pos: number[] = [], find: number[] = [], depth: number[] = [], ut: number[] = [];
  const gearUT = (p: THREE.Vector3) => [Math.min(0.99, Math.max(0.01, p.x / shape.L + 0.5)), Math.sign(p.z || 1) * 0.3];
  const tmp = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const u = r(), t = r() * 2 - 1;
    shape.under(u, t, tmp);
    shape.underNormal(u, t, n);
    tmp.addScaledVector(n, (r() - 0.5) * 0.01);
    let f = 0;
    for (const fd of y.findings) {
      const du = (u - fd.u) * shape.L, dt = ((t - fd.t) / 2) * shape.girth(u);
      const rad = fd.kind === 'paint' ? 0.32 : fd.kind === 'blisters' ? 0.3 : fd.kind === 'intake' ? 0.25 : 0.2;
      if (fd.kind !== 'propeller' && fd.kind !== 'rope' && du * du + dt * dt < rad * rad) f = 1;
    }
    pos.push(tmp.x, tmp.y, tmp.z);
    find.push(f);
    depth.push(1 - Math.pow(Math.abs(t), 1.25));
    ut.push(u, t);
  }
  // extra density on findings so they read clearly
  for (const fd of y.findings) {
    if (fd.kind === 'propeller' || fd.kind === 'rope') continue;
    for (let i = 0; i < 700; i++) {
      const u = fd.u + (r() - 0.5) * 0.035, t = Math.max(-1, Math.min(1, fd.t + (r() - 0.5) * 0.12));
      shape.under(u, t, tmp);
      pos.push(tmp.x, tmp.y, tmp.z); find.push(1); depth.push(0.7); ut.push(u, t);
    }
  }
  // running gear
  for (const g of gear) {
    for (let k = 0; k < 14; k++) {
      pos.push(g.x + (r() - 0.5) * 0.08, g.y + (r() - 0.5) * 0.08, g.z + (r() - 0.5) * 0.08);
      find.push(0); depth.push(1); ut.push(...gearUT(g));
    }
  }
  for (const fd of y.findings) {
    if (fd.kind !== 'propeller' && fd.kind !== 'rope') continue;
    const target = gear[fd.side === 'port' ? (fd.kind === 'propeller' ? 40 : 35) : fd.kind === 'propeller' ? 81 : 76];
    if (!target) continue;
    for (let k = 0; k < 500; k++) { pos.push(target.x + (r() - 0.5) * 0.4, target.y + (r() - 0.5) * 0.4, target.z + (r() - 0.5) * 0.4); find.push(1); depth.push(1); ut.push(...gearUT(target)); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aFind', new THREE.Float32BufferAttribute(find, 1));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
  geo.setAttribute('aUT', new THREE.Float32BufferAttribute(ut, 2));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSweep: { value: -100 }, uTime: { value: 0 }, uShowFind: { value: 0 }, uSize: { value: 2.4 }, uPR: { value: 1 }, uAlpha: { value: 1 },
      uCov: { value: null as THREE.Texture | null }, uLive: { value: 0 }, uRobot: { value: new THREE.Vector3(0, 100, 0) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uSweep; uniform float uTime; uniform float uShowFind; uniform float uSize; uniform float uPR;
      uniform sampler2D uCov; uniform float uLive; uniform vec3 uRobot;
      attribute float aFind; attribute float aDepth; attribute vec2 aUT;
      varying vec3 vCol; varying float vA;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float d = uSweep - position.x;
        // scanned where the robot has cleaned, or behind the final sweep
        float cov = texture2D(uCov, vec2(aUT.x, aUT.y * 0.5 + 0.5)).r;
        float seen = max(step(0.0, d), step(0.002, cov));
        float edge = exp(-d*d*6.0) * step(0.0, d);
        vec3 dr = position - uRobot;
        float fresh = exp(-dot(dr, dr) * 3.0) * uLive * seen;
        vec3 base = mix(vec3(0.10, 0.55, 0.62), vec3(0.55, 0.95, 0.97), aDepth);
        vec3 coral = vec3(1.0, 0.42, 0.29) * (0.75 + 0.25 * sin(uTime * 6.0));
        vCol = mix(base, coral, aFind * uShowFind) + (edge + fresh) * vec3(0.6, 1.0, 1.0);
        vA = seen * (0.55 + 0.45 * aDepth) + edge + fresh;
        gl_PointSize = uSize * uPR * (1.0 + (edge + fresh) * 1.5 + aFind * uShowFind * 0.8) * (7.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol; varying float vA; uniform float uAlpha;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float r = dot(c, c);
        if (r > 0.25) discard;
        gl_FragColor = vec4(vCol * vA * uAlpha * (1.0 - r * 3.0), 1.0);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  // laser sheet
  const sheetMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform float uTime; void main(){ float e = smoothstep(0.0,0.2,vUv.y)*smoothstep(1.0,0.6,vUv.y)*smoothstep(0.0,0.15,vUv.x)*smoothstep(1.0,0.85,vUv.x); float l = 0.5+0.5*sin(vUv.y*80.0 - uTime*12.0); gl_FragColor = vec4(vec3(0.1,0.76,0.79)*(0.25+0.2*l)*e, 1.0); }`,
  });
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(shape.B * 1.6, shape.D * 3.4), sheetMat);
  sheet.rotation.y = Math.PI / 2;
  sheet.position.y = -shape.D * 0.9;
  sheet.visible = false;
  return { points, mat, sheet, sheetMat };
}
