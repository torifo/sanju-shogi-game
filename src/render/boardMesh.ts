import * as THREE from 'three';
import { RANKS } from './types';
function label(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#65533c'; ctx.font = '52px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 48, 48);
  }
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false }));
  sprite.scale.set(.48, .48, 1); return sprite;
}
export function createBoard(z: number): THREE.Group {
  const group = new THREE.Group(); group.userData.layer = z;
  try {
    const board = new THREE.Mesh(new THREE.BoxGeometry(9, .055, 9), new THREE.MeshBasicMaterial({ color: '#ceb88a', transparent: true, opacity: .35, depthWrite: false }));
    board.userData.boardLayer = z; group.add(board);
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= 9; i++) {
      const p = i - 4.5;
      points.push(new THREE.Vector3(p, .035, -4.5), new THREE.Vector3(p, .035, 4.5), new THREE.Vector3(-4.5, .035, p), new THREE.Vector3(4.5, .035, p));
    }
    group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#786345', transparent: true, opacity: .55 })));
    for (let i = 1; i <= 9; i++) {
      const file = label(String(i)); file.position.set(5 - i, .08, -4.9); group.add(file);
      const rank = label(RANKS[i - 1]!); rank.position.set(-4.9, .08, i - 5); group.add(rank);
    }
    return group;
  } catch (error) {
    disposeGroup(group);
    throw error;
  }
}
/** Shared piece geometry/textures are owned by PieceFactory. */
export function disposeGroup(group: THREE.Object3D, geometry = true): void {
  group.traverse(obj => {
    const drawable = obj as THREE.Mesh;
    if (geometry) drawable.geometry?.dispose();
    if (drawable.material) for (const material of Array.isArray(drawable.material) ? drawable.material : [drawable.material]) {
      if (geometry && 'map' in material) (material.map as THREE.Texture | null)?.dispose();
      material.dispose();
    }
  });
  group.removeFromParent();
}
