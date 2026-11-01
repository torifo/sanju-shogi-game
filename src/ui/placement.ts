import type { BoardConfig } from '../core/config';
import { layerKeyGuide, layerName } from '../core/notation';
import { defaultAssignment, randomAssignment, STANDARD_LAYOUT } from '../core/setup';
import type { Color, Square } from '../core/types';
import { PIECE_NAMES, type RenderPiece } from '../render/types';
import { button, el } from './dom';

/** A private draft, independent of Game's submitted assignments. Never contains the other side. */
export class Placement {
  assignment: number[];
  selected: number | null = null;
  constructor(readonly config: BoardConfig, readonly color: Color) { this.assignment = defaultAssignment(config); }
  pieces(): RenderPiece[] {
    return STANDARD_LAYOUT.map((piece, i) => ({ sq: { x: this.color === 'sente' ? piece.x : 10 - piece.x, y: this.color === 'sente' ? piece.y : 10 - piece.y, z: this.assignment[i]! }, piece: { type: piece.kind, color: this.color } }));
  }
  select(sq: Square): void {
    const index = this.pieces().findIndex(p => p.sq.x === sq.x && p.sq.y === sq.y && p.sq.z === sq.z);
    this.selected = index < 0 || this.selected === index ? null : index;
  }
  setLayer(z: number): void {
    if (this.selected !== null && z >= 0 && z < this.config.layers) this.assignment[this.selected] = z;
  }
  drag(sq: Square, delta: number): void {
    const i = this.pieces().findIndex(p => p.sq.x === sq.x && p.sq.y === sq.y && p.sq.z === sq.z);
    if (i >= 0) { this.selected = i; this.setLayer(Math.max(0, Math.min(this.config.layers - 1, sq.z + delta))); }
  }
  controls(update: () => void, submit: () => void): HTMLElement {
    const panel = el('section', 'placement-controls');
    const selected = this.selected === null ? null : this.pieces()[this.selected];
    panel.append(el('h2', '', selected ? `${selected.sq.x}筋の${PIECE_NAMES[selected.piece.type]}を配置` : '駒を選んで、層を決める'));
    const layers = el('div', 'button-row');
    for (let z = this.config.layers - 1; z >= 0; z--) {
      const b = button(`${layerName(z, this.config.layers)} / ${z + 1}`, () => { this.setLayer(z); update(); });
      b.disabled = !selected; b.setAttribute('aria-pressed', String(selected?.sq.z === z)); layers.append(b);
    }
    const presets = el('div', 'button-row');
    presets.append(button(`全部を${layerName(Math.floor(this.config.layers / 2), this.config.layers)}`, () => { this.assignment = defaultAssignment(this.config); update(); }), button('ランダム', () => { this.assignment = randomAssignment(this.config); update(); }), button('配置を確定', submit, 'primary'));
    panel.append(layers, el('p', 'muted', `数字キー ${layerKeyGuide(this.config.layers)}。駒を上下にドラッグしても変更できます。`), presets);
    return panel;
  }
}
