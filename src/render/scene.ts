import * as THREE from 'three';
import type { Square } from '../core/types';
import { createBoard, disposeGroup } from './boardMesh';
import { CameraRig, type CameraPreset } from './camera';
import { createPointerGesture } from './gesture';
import { createHighlights } from './highlights';
import { pickSquare } from './picking';
import { PieceFactory } from './pieceMesh';
import type { Highlights, RenderPiece } from './types';
export interface BoardViewOptions { layers: number; layerGap: number }
export function isWebGLAvailable(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext(); return true;
  } catch { return false; }
}
export class BoardView {
  private readonly renderer!: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly rig!: CameraRig;
  private readonly factory!: PieceFactory;
  private readonly boards: THREE.Group[] = [];
  private pieces = new THREE.Group();
  private lines = new THREE.Group();
  private highlights = new THREE.Group();
  private highlightData: Highlights = { targets: [] };
  private data: RenderPiece[] = [];
  private focus: number | null = null;
  private gap: number;
  private preset: CameraPreset = 'oblique';
  private observer?: ResizeObserver;
  private frame = 0;
  private disposed = false;
  private pick: (hit: { sq: Square }) => void = () => {};
  private drag?: (sq: Square, delta: number) => void;
  private cancelReveal?: () => void;
  private readonly events = new AbortController();
  constructor(container: HTMLElement, readonly opts: BoardViewOptions) {
    this.gap = opts.layerGap;
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.factory = new PieceFactory();
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); this.renderer.setClearColor('#000000', 0);
      this.renderer.domElement.setAttribute('aria-label', `${opts.layers}層の将棋盤。ドラッグで回転、展開図からも操作できます`);
      container.append(this.renderer.domElement); this.rig = new CameraRig(this.renderer.domElement);
      this.scene.add(new THREE.AmbientLight('#fff5df', 2.5));
      const light = new THREE.DirectionalLight('#ffffff', 3); light.position.set(3, 15, 8); this.scene.add(light);
      for (let z = 0; z < opts.layers; z++) {
        const board = createBoard(z); board.position.y = z * this.gap; this.boards.push(board); this.scene.add(board);
      }
      this.scene.add(this.pieces, this.lines, this.highlights); this.rig.preset(this.preset, (opts.layers - 1) * this.gap);
      let lastWidth = 0, lastHeight = 0;
      const resize = (): void => {
        const width = container.clientWidth; const height = container.clientHeight;
        if (!width || !height || (width === lastWidth && height === lastHeight)) return;
        lastWidth = width; lastHeight = height;
        this.renderer.setSize(width, height); this.rig.camera.aspect = width / height; this.rig.camera.updateProjectionMatrix();
        this.rig.fit((this.opts.layers - 1) * this.gap);
      };
      this.observer = new ResizeObserver(resize); this.observer.observe(container);
      const canvas = this.renderer.domElement;
      const gesture = createPointerGesture();
      let startHit: ReturnType<typeof pickSquare>;
      const hit = (e: PointerEvent): ReturnType<typeof pickSquare> => pickSquare(e, canvas, this.rig.camera, this.pieces.children, this.highlights.children, this.boards, this.focus);
      canvas.addEventListener('pointerdown', e => {
        canvas.setPointerCapture(e.pointerId);
        startHit = gesture.down(e) ? hit(e) : null;
        this.rig.controls.enabled = !(this.drag && startHit?.piece);
      }, { signal: this.events.signal });
      canvas.addEventListener('pointermove', e => gesture.move(e), { signal: this.events.signal });
      canvas.addEventListener('pointerup', e => {
        const result = gesture.up(e); const picked = startHit; startHit = null; this.rig.controls.enabled = true;
        if (!result || !picked) return;
        if (this.drag && picked.piece && Math.abs(result.dy) > 28) this.drag(picked.sq, result.dy < 0 ? 1 : -1);
        else if (result.click) this.pick({ sq: picked.sq });
      }, { signal: this.events.signal });
      canvas.addEventListener('pointercancel', e => { gesture.cancel(e.pointerId); startHit = null; this.rig.controls.enabled = true; }, { signal: this.events.signal });
      canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); container.dispatchEvent(new CustomEvent('board-context-lost')); }, { signal: this.events.signal });
      const loop = (): void => {
        if (this.disposed) return;
        this.rig.controls.update(); this.renderer.render(this.scene, this.rig.camera); this.frame = requestAnimationFrame(loop);
      };
      // UIがコンテナをDOMへ追加した後、最初のフレームも正しいサイズで必ず描く。
      this.frame = requestAnimationFrame(() => { resize(); loop(); });
    } catch (error) {
      // Construction may fail before the caller receives a view to dispose.
      this.dispose();
      throw error;
    }
  }
  setPieces(pieces: RenderPiece[]): void {
    this.data = pieces.map(p => ({ sq: { ...p.sq }, piece: { ...p.piece } }));
    disposeGroup(this.pieces, false); disposeGroup(this.lines); this.pieces = new THREE.Group(); this.lines = new THREE.Group();
    for (const p of this.data) {
      const piece = this.factory.create(p); piece.position.set(5 - p.sq.x, p.sq.z * this.gap + .08, p.sq.y - 5); this.pieces.add(piece);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(5 - p.sq.x, .05, p.sq.y - 5), piece.position.clone()]), new THREE.LineBasicMaterial({ color: '#6b604e', transparent: true, opacity: .4 }));
      line.userData.layer = p.sq.z; this.lines.add(line);
    }
    this.scene.add(this.pieces, this.lines); this.applyFocus();
  }
  setHighlights(h: Highlights): void {
    this.highlightData = h; disposeGroup(this.highlights); this.highlights = createHighlights(h, this.gap); this.scene.add(this.highlights); this.applyFocus();
  }
  setFocusLayer(z: number | null): void { this.focus = z; this.applyFocus(); }
  private applyFocus(): void {
    for (const group of [...this.boards, ...this.pieces.children, ...this.lines.children, ...this.highlights.children]) {
      const dim = this.focus !== null && group.userData.layer !== this.focus;
      group.traverse(obj => {
        const drawable = obj as THREE.Mesh;
        if (!drawable.material) return;
        for (const m of Array.isArray(drawable.material) ? drawable.material : [drawable.material]) {
          if (m.userData.baseOpacity === undefined) m.userData.baseOpacity = m.opacity;
          m.transparent = true; m.opacity = (m.userData.baseOpacity as number) * (dim ? .25 : 1);
        }
      });
    }
  }
  setLayerGap(gap: number): void {
    this.gap = Math.max(1, Math.min(gap, 5)); this.boards.forEach((board, z) => { board.position.y = z * this.gap; });
    this.setPieces(this.data); this.setHighlights(this.highlightData); this.setCameraPreset(this.preset);
  }
  setCameraPreset(p: CameraPreset): void { this.preset = p; this.rig.preset(p, (this.opts.layers - 1) * this.gap); }
  onPick(fn: (hit: { sq: Square }) => void): void { this.pick = fn; }
  onLayerDrag(fn: (sq: Square, delta: number) => void): void { this.drag = fn; }
  animateReveal(durationMs: number): Promise<void> {
    this.cancelReveal?.(); const start = performance.now();
    return new Promise(resolve => {
      let frame = 0;
      const finish = (): void => { cancelAnimationFrame(frame); this.cancelReveal = undefined; resolve(); }; this.cancelReveal = finish;
      const tick = (now: number): void => {
        if (this.disposed) { finish(); return; }
        const t = Math.min(1, (now - start) / Math.max(1, durationMs)); const ease = 1 - (1 - t) ** 3;
        for (const piece of this.pieces.children) piece.position.y = .08 + (piece.userData.layer as number) * this.gap * ease;
        this.lines.visible = t === 1;
        if (t < 1) frame = requestAnimationFrame(tick); else finish();
      }; tick(start);
    });
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.cancelReveal?.(); cancelAnimationFrame(this.frame);
    this.observer?.disconnect(); this.events.abort(); this.rig?.dispose();
    for (const board of this.boards) disposeGroup(board);
    disposeGroup(this.pieces, false); disposeGroup(this.lines); disposeGroup(this.highlights); this.factory?.dispose();
    if (this.renderer) {
      this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove();
    }
  }
}
