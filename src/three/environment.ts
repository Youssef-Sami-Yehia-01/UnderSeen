import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { mulberry32 } from '../lib/yacht';

export const SUN_DIR = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 16), THREE.MathUtils.degToRad(215));
export const UNDERWATER_COLOR = new THREE.Color('#0B4658');
export const UNDERWATER_DEEP = new THREE.Color('#03202C');
export const SEABED_Y = -5.6;

/** Shared uniforms for animated underwater light. */
export const causticUniforms = {
  uTime: { value: 0 },
  uCaustic: { value: 1 },
};

const CAUSTIC_GLSL = /* glsl */ `
float usCaustic(vec2 p, float t){
  p = mod(p * 0.9, 6.2831853) - 250.0;
  vec2 i = p; float c = 1.0; float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 1.0);
}`;

/** Adds moving caustic light to any lit material, below the waterline only. */
export function addCaustics(mat: THREE.Material, strength = 0.35) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = causticUniforms.uTime;
    shader.uniforms.uCaustic = causticUniforms.uCaustic;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vUsWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvUsWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vUsWorld;\nuniform float uTime;\nuniform float uCaustic;\n${CAUSTIC_GLSL}`)
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        if (vUsWorld.y < 0.02) {
          float depthFade = smoothstep(-9.0, -0.2, vUsWorld.y);
          float c = usCaustic(vUsWorld.xz * 1.6 + vec2(vUsWorld.y * 0.3), uTime * 0.55);
          gl_FragColor.rgb += c * ${strength.toFixed(3)} * uCaustic * depthFade * vec3(0.55, 0.9, 0.95);
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'caustic' + strength;
  return mat;
}

/* ------------------------------------------------------------------ */
/* Water surface: analytic waves, sky reflection, sun glint, underside */
/* ------------------------------------------------------------------ */
export function makeWater() {
  const geo = new THREE.PlaneGeometry(1600, 1600, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: causticUniforms.uTime,
      uSun: { value: SUN_DIR.clone() },
      uUnder: { value: 0 },
      uFogNear: { value: 120 },
      uFogFar: { value: 900 },
    },
    side: THREE.DoubleSide,
    transparent: false,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uSun; uniform float uUnder; uniform float uFogNear; uniform float uFogFar;
      varying vec3 vWorld;
      vec2 hash2(vec2 p){ p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3))); return fract(sin(p)*43758.5453)*2.0-1.0; }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(dot(hash2(i), f), dot(hash2(i+vec2(1,0)), f-vec2(1,0)), u.x),
                   mix(dot(hash2(i+vec2(0,1)), f-vec2(0,1)), dot(hash2(i+vec2(1,1)), f-vec2(1,1)), u.x), u.y);
      }
      float height(vec2 p){
        float t = uTime;
        float h = 0.0;
        h += sin(dot(p, vec2(0.36, 0.12)) + t*0.9) * 0.05;
        h += sin(dot(p, vec2(-0.21, 0.31)) + t*1.1) * 0.04;
        h += sin(dot(p, vec2(0.62, -0.47)) + t*1.7) * 0.02;
        h += noise(p*0.55 + vec2(t*0.12, t*0.07)) * 0.06;
        h += noise(p*1.6 - vec2(t*0.2, -t*0.15)) * 0.025;
        h += noise(p*4.2 + vec2(t*0.35, t*0.31)) * 0.008;
        return h;
      }
      vec3 skyCol(vec3 d){
        float y = max(d.y, 0.0);
        vec3 horizon = vec3(0.93, 0.80, 0.66);
        vec3 zen = vec3(0.30, 0.52, 0.78);
        vec3 c = mix(horizon, zen, pow(y, 0.45));
        float s = max(dot(d, uSun), 0.0);
        c += vec3(1.0, 0.75, 0.45) * pow(s, 8.0) * 0.35;
        return c;
      }
      void main(){
        vec2 p = vWorld.xz;
        float e = 0.08;
        float hx = height(p + vec2(e,0.0)) - height(p - vec2(e,0.0));
        float hz = height(p + vec2(0.0,e)) - height(p - vec2(0.0,e));
        vec3 n = normalize(vec3(-hx/(2.0*e), 1.0, -hz/(2.0*e)));
        vec3 V = normalize(cameraPosition - vWorld);
        float dist = length(cameraPosition - vWorld);
        if (uUnder > 0.5) {
          // seen from below: bright Snell's window above, dark mirror outside it
          vec3 nn = -n;
          float cosT = clamp(dot(-V, vec3(0.0,1.0,0.0)), 0.0, 1.0);
          float window = smoothstep(0.66, 0.82, cosT);
          float ripple = noise(p*1.4 + vec2(uTime*0.4, uTime*0.3))*0.5+0.5;
          vec3 inside = mix(vec3(0.08, 0.40, 0.48), vec3(0.24, 0.62, 0.68), ripple*0.7);
          inside += vec3(1.0, 0.9, 0.7) * pow(max(dot(normalize(reflect(V, nn)), uSun), 0.0), 40.0) * 0.6;
          vec3 outside = vec3(0.03, 0.24, 0.31) + ripple*0.04;
          vec3 c = mix(outside, inside, window);
          float fogk = 1.0 - exp(-dist * 0.11);
          c = mix(c, vec3(0.03, 0.24, 0.31), fogk*0.92);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
          return;
        }
        vec3 R = reflect(-V, n);
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
        vec3 refl = skyCol(R);
        vec3 deep = vec3(0.02, 0.17, 0.22);
        vec3 shallow = vec3(0.05, 0.38, 0.42);
        vec3 body = mix(shallow, deep, smoothstep(0.0, 0.6, 1.0 - max(dot(n, V), 0.0)));
        vec3 c = mix(body, refl, fres);
        float sp = pow(max(dot(R, uSun), 0.0), 480.0);
        c += vec3(1.0, 0.86, 0.62) * sp * 9.0;
        float sp2 = pow(max(dot(R, uSun), 0.0), 40.0);
        c += vec3(1.0, 0.8, 0.55) * sp2 * 0.18;
        float fogk = smoothstep(uFogNear, uFogFar, dist);
        c = mix(c, vec3(0.86, 0.80, 0.72), fogk);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1;
  return { mesh, mat };
}

/* ------------------------------------------------------------------ */
export function makeSky() {
  const sky = new Sky();
  sky.scale.setScalar(4500);
  const u = sky.material.uniforms;
  u.turbidity.value = 5.5;
  u.rayleigh.value = 1.4;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.82;
  u.sunPosition.value.copy(SUN_DIR).multiplyScalar(1000);
  return sky;
}

/** Simple value noise for terrain. */
function vnoise(r: () => number, size: number) {
  const g = new Float32Array(size * size);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const s = (a: number) => ((a % size) + size) % size;
    const v = (i: number, j: number) => g[s(j) * size + s(i)];
    const ux = xf * xf * (3 - 2 * xf), uy = yf * yf * (3 - 2 * yf);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(v(xi, yi), v(xi + 1, yi), ux), THREE.MathUtils.lerp(v(xi, yi + 1), v(xi + 1, yi + 1), ux), uy);
  };
}

export function makeSeabed() {
  const r = mulberry32(99);
  const n = vnoise(r, 64);
  const geo = new THREE.PlaneGeometry(260, 260, 160, 160);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors: number[] = [];
  const cA = new THREE.Color('#C9B48A'), cB = new THREE.Color('#9C8A66'), cC = new THREE.Color('#5E6B4E');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = n(x * 0.08, z * 0.08) * 1.2 + n(x * 0.35, z * 0.35) * 0.25 + Math.sin(x * 0.9 + z * 0.2) * 0.04;
    pos.setY(i, SEABED_Y + h - 0.6);
    const k = n(x * 0.05 + 10, z * 0.05);
    const c = cA.clone().lerp(cB, k);
    if (n(x * 0.12 + 40, z * 0.12) > 0.72) c.lerp(cC, 0.6);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = addCaustics(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }), 0.55);
  const mesh = new THREE.Mesh(geo, mat);

  // rocks and seagrass
  const group = new THREE.Group();
  group.add(mesh);
  const rockGeo = new THREE.IcosahedronGeometry(1, 1);
  const rp = rockGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < rp.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(rp, i);
    v.multiplyScalar(0.75 + r() * 0.45);
    rp.setXYZ(i, v.x, v.y * 0.6, v.z);
  }
  rockGeo.computeVertexNormals();
  const rocks = new THREE.InstancedMesh(rockGeo, addCaustics(new THREE.MeshStandardMaterial({ color: '#6F6A5B', roughness: 0.95, flatShading: true }), 0.5), 70);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 70; i++) {
    const x = (r() - 0.5) * 120, z = (r() - 0.5) * 120;
    if (Math.abs(x) < 14 && Math.abs(z) < 9) { i--; continue; }
    const s = 0.3 + r() * 1.4;
    m.compose(new THREE.Vector3(x, SEABED_Y - 0.4 + n(x * 0.08, z * 0.08) * 1.2, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(r(), r() * 6, r())), new THREE.Vector3(s, s, s));
    rocks.setMatrixAt(i, m);
  }
  group.add(rocks);

  const bladeGeo = new THREE.PlaneGeometry(0.06, 0.7, 1, 4);
  bladeGeo.translate(0, 0.35, 0);
  const grass = new THREE.InstancedMesh(bladeGeo, new THREE.MeshStandardMaterial({ color: '#3F6B3A', roughness: 0.9, side: THREE.DoubleSide }), 2600);
  for (let i = 0; i < 2600; i++) {
    const cx = (r() - 0.5) * 90, cz = (r() - 0.5) * 90;
    const patch = n(cx * 0.12 + 40, cz * 0.12);
    if (patch < 0.6 || (Math.abs(cx) < 12 && Math.abs(cz) < 8)) { m.makeScale(0, 0, 0); grass.setMatrixAt(i, m); continue; }
    const s = 0.5 + r() * 0.9;
    m.compose(new THREE.Vector3(cx, SEABED_Y - 0.6 + n(cx * 0.08, cz * 0.08) * 1.2, cz), new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.4, r() * 6, (r() - 0.5) * 0.4)), new THREE.Vector3(s, s, s));
    grass.setMatrixAt(i, m);
  }
  group.add(grass);
  return { group, grass };
}

/** God rays seen underwater. */
export function makeLightShafts() {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: causticUniforms.uTime },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; varying float vY; void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.0); vY = w.y; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform float uTime; varying vec2 vUv; varying float vY;
      void main(){
        float edge = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
        float fall = smoothstep(-9.0, -0.3, vY);
        float flick = 0.75 + 0.25 * sin(uTime * 0.9 + vUv.x * 9.0);
        gl_FragColor = vec4(vec3(0.55, 0.88, 0.92) * 0.11 * edge * fall * flick, 1.0);
      }`,
  });
  const r = mulberry32(5);
  for (let i = 0; i < 14; i++) {
    const g = new THREE.PlaneGeometry(1.2 + r() * 2.2, 12, 1, 1);
    g.translate(0, -6, 0);
    const m = new THREE.Mesh(g, mat);
    m.position.set((r() - 0.5) * 40, 0, (r() - 0.5) * 30);
    m.rotation.set(0.25 + r() * 0.15, r() * Math.PI, 0.3);
    m.userData.phase = r() * 6;
    group.add(m);
  }
  return group;
}

/** Floating particles ("marine snow") that follow the camera underwater. */
export function makeMarineSnow() {
  const N = 1400;
  const pos = new Float32Array(N * 3);
  const r = mulberry32(17);
  for (let i = 0; i < N; i++) { pos[i * 3] = (r() - 0.5) * 30; pos[i * 3 + 1] = (r() - 0.5) * 14; pos[i * 3 + 2] = (r() - 0.5) * 30; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: '#CFEFF0', size: 0.035, transparent: true, opacity: 0.55, depthWrite: false, sizeAttenuation: true });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

/** Floating pontoon with piles, on which the yacht is moored stern-to. */
export function makePontoon(atX: number) {
  const g = new THREE.Group();
  const deckMat = new THREE.MeshStandardMaterial({ color: '#B49A78', roughness: 0.75 });
  const floatMat = addCaustics(new THREE.MeshStandardMaterial({ color: '#4E585D', roughness: 0.85 }), 0.25);
  const pileMat = addCaustics(new THREE.MeshStandardMaterial({ color: '#6B7378', roughness: 0.7, metalness: 0.2 }), 0.35);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.18, 70), deckMat);
  deck.position.set(atX, 0.42, 0);
  g.add(deck);
  const plankMat = new THREE.MeshStandardMaterial({ color: '#8C7356', roughness: 0.9 });
  for (let i = -34; i <= 34; i += 0.5) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(2.38, 0.02, 0.04), plankMat);
    p.position.set(atX, 0.52, i);
    g.add(p);
  }
  const fl = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 70), floatMat);
  fl.position.set(atX, 0.05, 0);
  g.add(fl);
  for (let z = -30; z <= 30; z += 10) {
    const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 9, 16), pileMat);
    pile.position.set(atX - 1.45, -2.2, z);
    g.add(pile);
  }
  // cleats & a light post
  const steel = new THREE.MeshStandardMaterial({ color: '#D7DCE0', metalness: 1, roughness: 0.25 });
  for (let z = -30; z <= 30; z += 5) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.36), steel);
    c.position.set(atX + 1.05, 0.56, z);
    g.add(c);
  }
  return g;
}

/** Distant ridge of mountains to the west, like the Red Sea coast behind Hurghada. */
export function makeMountains() {
  const r = mulberry32(7);
  const n = vnoise(r, 64);
  const g = new THREE.Group();
  const layers = [
    { dist: 1500, height: 95, col: '#A98272', haze: '#D9C3B2', off: 0 },
    { dist: 2100, height: 140, col: '#B99886', haze: '#E2CFBF', off: 37 },
  ];
  for (const L of layers) {
    const geo = new THREE.PlaneGeometry(5200, 1, 360, 12);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors: number[] = [];
    const cRock = new THREE.Color(L.col), cHaze = new THREE.Color(L.haze);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const v = pos.getY(i) + 0.5; // 0 at base, 1 at ridge
      const ridge = 0.25 + n(x * 0.0022 + L.off, 3) * 0.75 + n(x * 0.011 + L.off, 7) * 0.22 + n(x * 0.04, 9) * 0.06;
      const h = ridge * L.height * Math.pow(v, 0.9) - 6;
      pos.setY(i, h);
      pos.setZ(i, (n(x * 0.01, v * 5 + L.off) - 0.5) * 40 * v);
      const c = cHaze.clone().lerp(cRock, Math.min(1, v * 1.2) * 0.85);
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: true }));
    m.position.set(-L.dist, 0, 0);
    m.rotation.y = Math.PI / 2;
    g.add(m);
  }
  return g;
}

/** Small tender (RIB) the pilot works from. */
export function makeTender() {
  const g = new THREE.Group();
  const tubeMat = new THREE.MeshStandardMaterial({ color: '#2F3A42', roughness: 0.6 });
  const hullMat = new THREE.MeshPhysicalMaterial({ color: '#E9ECEA', roughness: 0.3, clearcoat: 0.6 });
  const path = new THREE.CurvePath<THREE.Vector3>();
  const pts = [
    new THREE.Vector3(-1.9, 0, -0.85), new THREE.Vector3(1.0, 0, -0.85), new THREE.Vector3(2.1, 0, 0), new THREE.Vector3(1.0, 0, 0.85),
    new THREE.Vector3(-1.9, 0, 0.85),
  ];
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.3);
  path.add(curve);
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.24, 12, false), tubeMat);
  tube.position.y = 0.32;
  g.add(tube);
  const base = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.35, 1.5), hullMat);
  base.position.set(0, 0.05, 0);
  g.add(base);
  const consoleM = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.6), hullMat);
  consoleM.position.set(0.1, 0.6, 0);
  g.add(consoleM);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.26), new THREE.MeshBasicMaterial({ color: '#19C3C9' }));
  screen.position.set(-0.21, 0.88, 0);
  screen.rotation.y = -Math.PI / 2;
  screen.rotation.x = -0.4;
  g.add(screen);
  const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.3, 20), new THREE.MeshStandardMaterial({ color: '#19C3C9', roughness: 0.4 }));
  reel.rotation.x = Math.PI / 2;
  reel.position.set(-1.2, 0.5, 0);
  g.add(reel);
  const engine = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.8, 0.4), tubeMat);
  engine.position.set(-1.95, 0.4, 0);
  g.add(engine);
  return g;
}

/** Concrete block and chain for the bow mooring line. */
export function makeMooring(from: THREE.Vector3, to: THREE.Vector3) {
  const g = new THREE.Group();
  const block = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 1.2), addCaustics(new THREE.MeshStandardMaterial({ color: '#8E918C', roughness: 1 }), 0.45));
  block.position.copy(to).add(new THREE.Vector3(0, 0.1, 0));
  g.add(block);
  const mid = from.clone().lerp(to, 0.5);
  mid.y = to.y + 0.4;
  const curve = new THREE.QuadraticBezierCurve3(from, mid, to.clone().add(new THREE.Vector3(0, 0.45, 0)));
  const len = curve.getLength();
  const links = Math.floor(len / 0.09);
  const linkGeo = new THREE.TorusGeometry(0.05, 0.014, 6, 10);
  linkGeo.scale(1.5, 1, 1);
  const inst = new THREE.InstancedMesh(linkGeo, addCaustics(new THREE.MeshStandardMaterial({ color: '#5E5548', roughness: 0.8, metalness: 0.4 }), 0.3), links);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (let i = 0; i < links; i++) {
    const p = curve.getPointAt(i / links);
    const tan = curve.getTangentAt(i / links);
    q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tan);
    if (i % 2) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    m.compose(p, q, new THREE.Vector3(1, 1, 1));
    inst.setMatrixAt(i, m);
  }
  g.add(inst);
  return g;
}

/** A few fish circling near the seabed. */
export function makeFish() {
  const geo = new THREE.ConeGeometry(0.06, 0.28, 6);
  geo.rotateZ(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: '#C8D3D8', metalness: 0.6, roughness: 0.35 });
  const N = 60;
  const fish = new THREE.InstancedMesh(geo, mat, N);
  const r = mulberry32(31);
  const data = Array.from({ length: N }, () => ({ rad: 3 + r() * 4, h: -3.2 - r() * 1.6, sp: 0.25 + r() * 0.15, ph: r() * Math.PI * 2, cx: -6 + r() * 3, cz: 8 + r() * 3 }));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
  const update = (t: number) => {
    data.forEach((d, i) => {
      const a = d.ph + t * d.sp;
      const p = new THREE.Vector3(d.cx + Math.cos(a) * d.rad, d.h + Math.sin(t * 1.3 + d.ph) * 0.15, d.cz + Math.sin(a) * d.rad * 0.6);
      const dir = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a) * 0.6).normalize();
      q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      m.compose(p, q, s);
      fish.setMatrixAt(i, m);
    });
    fish.instanceMatrix.needsUpdate = true;
  };
  update(0);
  return { fish, update };
}
