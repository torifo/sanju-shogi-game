import * as THREE from 'three';
import type { PieceType } from '../core/types';
import { PIECE_NAMES, type RenderPiece } from './types';

/** Resources are shared within one view and disposed with that view. */
export class PieceFactory {
  private readonly geometry: THREE.ExtrudeGeometry;
  private readonly face = new THREE.PlaneGeometry(.68, .79);
  private readonly textures = new Map<PieceType, THREE.CanvasTexture>();
  constructor() {
    const shape = new THREE.Shape();
    shape.moveTo(-.36, -.4); shape.lineTo(.36, -.4); shape.lineTo(.30, .24);
    shape.lineTo(0, .44); shape.lineTo(-.30, .24); shape.closePath();
    this.geometry = new THREE.ExtrudeGeometry(shape, { depth: .10, bevelEnabled: true, bevelSize: .025, bevelThickness: .02, bevelSegments: 1, steps: 1 });
    this.geometry.rotateX(-Math.PI / 2);
  }
  create({ sq, piece }: RenderPiece): THREE.Group {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(this.geometry, new THREE.MeshStandardMaterial({ color: '#dcb77c', roughness: .85 })));
    let texture = this.textures.get(piece.type);
    if (!texture) {
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 320;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('駒の文字を描画できません');
      ctx.fillStyle = piece.type.startsWith('+') ? '#a52c26' : '#28251f';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `bold ${PIECE_NAMES[piece.type].length > 1 ? 104 : 175}px "Yu Mincho", "Hiragino Mincho ProN", serif`;
      ctx.fillText(PIECE_NAMES[piece.type], 128, 168, 240);
      texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      this.textures.set(piece.type, texture);
    }
    const face = new THREE.Mesh(this.face, new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
    face.rotation.x = -Math.PI / 2; face.position.y = .132; group.add(face);
    group.rotation.y = piece.color === 'gote' ? Math.PI : 0;
    group.userData.sq = { ...sq }; group.userData.layer = sq.z; return group;
  }
  dispose(): void {
    this.geometry.dispose(); this.face.dispose();
    for (const texture of this.textures.values()) texture.dispose();
    this.textures.clear();
  }
}
