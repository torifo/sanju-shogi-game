import * as THREE from 'three';
import type { Square } from '../core/types';
import type { Highlights } from './types';
export function createHighlights(h: Highlights, gap: number): THREE.Group {
  const group = new THREE.Group();
  const add = (sq: Square, color: string, opacity: number, pickable = false): void => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(.92, .92), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(5 - sq.x, sq.z * gap + .06, sq.y - 5);
    mesh.userData.layer = sq.z;
    if (pickable) mesh.userData.sq = { ...sq };
    group.add(mesh);
  };
  for (const sq of h.lastMove ?? []) add(sq, '#6598be', .35);
  for (const sq of h.targets) add(sq, '#3e8c64', .55, true);
  if (h.selected) add(h.selected, '#e5b63e', .70);
  if (h.check) add(h.check, '#c44837', .65);
  return group;
}
