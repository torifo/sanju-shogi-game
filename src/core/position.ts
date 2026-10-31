import type { BoardConfig } from './config';
import { promote, unpromote } from './pieces';
import { opposite, type Color, type HandKind, type Move, type Piece, type Square } from './types';

export type Hands = Record<Color, Record<HandKind, number>>;
export interface Undo { move: Move; captured: Piece | null; movedBefore: Piece | null }

const emptyHand = (): Record<HandKind, number> => ({ R: 0, B: 0, G: 0, S: 0, N: 0, L: 0, P: 0 });

export class Position {
  readonly config: BoardConfig;
  cells: (Piece | null)[];
  hands: Hands = { sente: emptyHand(), gote: emptyHand() };
  sideToMove: Color = 'sente';

  constructor(config: BoardConfig) {
    if (config.files !== 9 || config.ranks !== 9 || !Number.isSafeInteger(config.layers) || config.layers < 1) {
      throw new Error('盤の設定が不正です');
    }
    this.config = { ...config };
    this.cells = Array<Piece | null>(81 * config.layers).fill(null);
  }

  static index(sq: Square): number { return (sq.x - 1) + (sq.y - 1) * 9 + sq.z * 81; }
  inBounds(sq: Square): boolean {
    return Number.isInteger(sq.x) && Number.isInteger(sq.y) && Number.isInteger(sq.z)
      && sq.x >= 1 && sq.x <= 9 && sq.y >= 1 && sq.y <= 9 && sq.z >= 0 && sq.z < this.config.layers;
  }
  get(sq: Square): Piece | null { return this.inBounds(sq) ? this.cells[Position.index(sq)] ?? null : null; }
  set(sq: Square, p: Piece | null): void {
    if (!this.inBounds(sq)) throw new Error('盤外のマスです');
    this.cells[Position.index(sq)] = p;
  }
  clone(): Position {
    const copy = new Position(this.config);
    copy.cells = this.cells.map(p => p ? { ...p } : null);
    copy.hands = { sente: { ...this.hands.sente }, gote: { ...this.hands.gote } };
    copy.sideToMove = this.sideToMove;
    return copy;
  }
  apply(move: Move): Undo {
    const captured = this.get(move.to);
    const movedBefore = move.kind === 'move' ? this.get(move.from) : null;
    if (move.kind === 'move') {
      if (!movedBefore) throw new Error('移動元に駒がありません');
      this.set(move.from, null);
      this.set(move.to, { ...movedBefore, type: move.promote ? promote(movedBefore.type) : movedBefore.type });
      if (captured) {
        const kind = unpromote(captured.type);
        if (kind !== 'K') this.hands[this.sideToMove][kind]++;
      }
    } else {
      this.hands[this.sideToMove][move.piece]--;
      this.set(move.to, { type: move.piece, color: this.sideToMove });
    }
    this.sideToMove = opposite(this.sideToMove);
    return { move, captured, movedBefore };
  }
  undo(u: Undo): void {
    this.sideToMove = opposite(this.sideToMove);
    this.set(u.move.to, u.captured);
    if (u.move.kind === 'move') {
      this.set(u.move.from, u.movedBefore);
      if (u.captured) {
        const kind = unpromote(u.captured.type);
        if (kind !== 'K') this.hands[this.sideToMove][kind]--;
      }
    } else {
      this.hands[this.sideToMove][u.move.piece]++;
    }
  }
  findKing(color: Color): Square | null {
    const i = this.cells.findIndex(p => p?.type === 'K' && p.color === color);
    return i < 0 ? null : { x: i % 9 + 1, y: Math.floor(i / 9) % 9 + 1, z: Math.floor(i / 81) };
  }
}
