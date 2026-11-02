import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Merge every mesh in a group into one mesh per material, leaving the meshes in `keep` (and their children) alone. */
export function mergeByMaterial(group: THREE.Group, keep: Set<THREE.Object3D>) {
  group.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const drop: THREE.Mesh[] = [];
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    for (let a: THREE.Object3D | null = m; a && a !== group; a = a.parent) if (keep.has(a)) return;
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(m.matrixWorld);
    g = g.index ? g.toNonIndexed() : g;
    const list = buckets.get(m.material) ?? [];
    list.push(g);
    buckets.set(m.material, list);
    drop.push(m);
  });
  drop.forEach((m) => m.parent?.remove(m));
  const made: THREE.BufferGeometry[] = [];
  buckets.forEach((geos, mat) => {
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) return;
    made.push(merged);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  });
  return made;
}

