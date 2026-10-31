import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
export type CameraPreset = 'oblique' | 'top' | 'side';
export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(42, 1, .1, 250);
  readonly controls: OrbitControls;
  constructor(canvas: HTMLCanvasElement) {
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true; this.controls.minDistance = 7; this.controls.maxDistance = 65;
    this.controls.maxPolarAngle = Math.PI * .49;
  }
  preset(preset: CameraPreset, height: number): void {
    this.controls.target.set(0, height / 2, 0);
    if (preset === 'top') this.camera.position.set(0, height / 2 + 24 + height, .01);
    else if (preset === 'side') this.camera.position.set(17 + height, height / 2 + 1, 0);
    else this.camera.position.set(12 + height * .5, 13 + height, 16 + height * .5);
    this.camera.lookAt(this.controls.target); this.controls.update();
  }
  dispose(): void { this.controls.dispose(); }
}
