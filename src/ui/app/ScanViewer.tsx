import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { HullShape } from '../../three/hull';
import { buildScanCloud } from '../../three/scan';
import type { Yacht } from '../../lib/yacht';

/** Small interactive 3D view of the scanned hull (point cloud) inside the app. */
export default function ScanViewer({ yacht }: { yacht: Yacht }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    el.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
    const shape = new HullShape(yacht.lengthM, yacht.beamM);
    // gear points along the shafts so the propellers show
    const gear: THREE.Vector3[] = [];
    for (const side of [-1, 1]) {
      const from = shape.under(0.34, side * 0.3);
      const pc = shape.under(0.075, side * 0.3);
      const to = new THREE.Vector3(pc.x, pc.y - shape.D * 0.42, pc.z);
      for (let i = 0; i < 40; i++) gear.push(from.clone().lerp(to, i / 39));
      gear.push(to);
    }
    const cloud = buildScanCloud(shape, yacht, gear, 16000);
    cloud.mat.uniforms.uSweep.value = 1000;
    cloud.mat.uniforms.uShowFind.value = 1;
    cloud.mat.uniforms.uSize.value = 1.6;
    cloud.mat.uniforms.uPR.value = renderer.getPixelRatio();
    const group = new THREE.Group();
    group.add(cloud.points);
    // waterline outline
    const wl: THREE.Vector3[] = [];
    for (let i = 0; i <= 80; i++) wl.push(shape.under(i / 80, 1));
    for (let i = 80; i >= 0; i--) wl.push(shape.under(i / 80, -1));
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(wl), new THREE.LineBasicMaterial({ color: '#7fdfe3', transparent: true, opacity: 0.5 })));
    scene.add(group);
    let yaw = -0.6, drag: number | null = null, last = 0;
    const size = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);
    const c = renderer.domElement;
    const down = (e: PointerEvent) => { drag = e.clientX; last = performance.now(); };
    const move = (e: PointerEvent) => { if (drag !== null) { yaw += (e.clientX - drag) * 0.01; drag = e.clientX; last = performance.now(); } };
    const up = () => { drag = null; };
    c.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    let raf = 0;
    const clock = new THREE.Clock();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = clock.getElapsedTime();
      if (drag === null && performance.now() - last > 1500) yaw += 0.004;
      const dist = shape.L * 1.25;
      cam.position.set(Math.cos(yaw) * dist, -shape.L * 0.32, Math.sin(yaw) * dist);
      cam.lookAt(0, -shape.D * 0.4, 0);
      cloud.mat.uniforms.uTime.value = t;
      renderer.render(scene, cam);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      c.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      cloud.points.geometry.dispose();
      cloud.mat.dispose();
      renderer.dispose();
      c.remove();
    };
  }, [yacht]);
  return (
    <div className="oa-viewer" ref={ref}>
      <div className="legend"><span><i style={{ background: '#5fe0e4' }} />Hull surface</span><span><i style={{ background: '#ff6b4a' }} />New since last scan</span></div>
      <div className="cap">3D model from this dive · drag to rotate</div>
    </div>
  );
}
