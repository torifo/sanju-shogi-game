import * as THREE from 'three';
import type { Square } from '../core/types';
export function pickSquare(event: PointerEvent, canvas: HTMLCanvasElement, camera: THREE.Camera, pieces: THREE.Object3D[], targets: THREE.Object3D[], boards: THREE.Object3D[], focus: number | null): { sq: Square; piece: boolean } | null {
  const rect = canvas.getBoundingClientRect(); const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
  const allowed = (obj: THREE.Object3D): boolean => focus === null || obj.userData.layer === focus;
  for (const hit of ray.intersectObjects([...pieces.filter(allowed), ...targets.filter(allowed)], true)) {
    let object: THREE.Object3D | null = hit.object;
    while (object && !object.userData.sq) object = object.parent;
    if (object?.userData.sq) return { sq: { ...object.userData.sq as Square }, piece: pieces.includes(object) };
  }
  for (const hit of ray.intersectObjects(boards.filter(allowed), true)) {
    if (hit.object.userData.boardLayer === undefined) continue;
    const x = Math.floor(4.5 - hit.point.x) + 1; const y = Math.floor(hit.point.z + 4.5) + 1;
    if (x >= 1 && x <= 9 && y >= 1 && y <= 9) return { sq: { x, y, z: hit.object.userData.boardLayer as number }, piece: false };
  }
  return null;
}
