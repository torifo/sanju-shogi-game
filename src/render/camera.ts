import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
export type CameraPreset = 'oblique' | 'top' | 'side';

/** 盤・目盛り・駒を含む外接箱の全頂点が、画面端から7%の余白内に入る距離を求める。 */
export function fitBoardCamera(camera: THREE.PerspectiveCamera, height: number, direction: THREE.Vector3): { distance: number; target: THREE.Vector3 } {
  const bounds = new THREE.Box3(new THREE.Vector3(-5.15, -.16, -5.15), new THREE.Vector3(4.55, height + .32, 4.55));
  const center = bounds.getCenter(new THREE.Vector3());
  const outward = direction.clone().normalize();
  camera.position.copy(center).add(outward); camera.lookAt(center);
  const inverse = camera.quaternion.clone().invert();
  const tanY = Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV()) / 2) * .86;
  const tanX = tanY * camera.aspect;
  let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity, front = -Infinity;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const corner = new THREE.Vector3(x, y, z).sub(center).applyQuaternion(inverse);
    left = Math.min(left, corner.x - corner.z * tanX); right = Math.max(right, corner.x + corner.z * tanX);
    bottom = Math.min(bottom, corner.y - corner.z * tanY); top = Math.max(top, corner.y + corner.z * tanY);
    front = Math.max(front, corner.z);
  }
  const distance = Math.max((right - left) / (2 * tanX), (top - bottom) / (2 * tanY), front + camera.near);
  // 遠近法で上下左右の余白が偏らないよう、視線の中心も投影した箱に合わせる。
  const target = center.clone().add(new THREE.Vector3((left + right) / 2, (bottom + top) / 2, 0).applyQuaternion(camera.quaternion));
  camera.position.copy(target).addScaledVector(outward, distance);
  camera.far = distance * 3 + bounds.getSize(new THREE.Vector3()).length();
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  return { distance, target };
}

export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(42, 1, .1, 250);
  readonly controls: OrbitControls;
  constructor(canvas: HTMLCanvasElement) {
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * .49;
  }
  preset(preset: CameraPreset, height: number): void {
    const direction = preset === 'top' ? new THREE.Vector3(0, 1, .001)
      : preset === 'side' ? new THREE.Vector3(1, .04, 0) : new THREE.Vector3(12, 13, 16);
    this.fit(height, direction);
  }
  fit(height: number, direction?: THREE.Vector3): void {
    // 回転・パンの減衰が再フィット後のカメラを動かさないよう、残りを先に消化する。
    this.controls.enableDamping = false; this.controls.update(); this.controls.enableDamping = true;
    const outward = direction ?? this.camera.position.clone().sub(this.controls.target);
    const { distance, target } = fitBoardCamera(this.camera, height, outward);
    this.controls.target.copy(target);
    this.controls.minDistance = distance * .45; this.controls.maxDistance = distance * 3;
    this.controls.update();
  }
  dispose(): void { this.controls.dispose(); }
}
