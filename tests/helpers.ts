import type { Color, PieceType, Square } from '../src/core/types';
import { Position } from '../src/core/position';

export function emptyPosition(layers = 3, side: Color = 'sente'): Position {
  const pos = new Position({ files: 9, ranks: 9, layers });
  pos.sideToMove = side;
  return pos;
}
export function put(pos: Position, x: number, y: number, z: number, type: PieceType, color: Color): void {
  pos.set(sq(x, y, z), { type, color });
}
export const sq = (x: number, y: number, z: number): Square => ({ x, y, z });

export function pawnMatePosition(layers = 3): Position {
  const pos = emptyPosition(layers);
  put(pos, 9, 9, 0, 'K', 'sente');
  put(pos, 5, 1, 1, 'K', 'gote');
  put(pos, 5, 3, 1, 'G', 'sente');
  for (const x of [4, 5, 6]) for (const z of [0, 1, 2]) {
    if (x !== 5 || z !== 1) put(pos, x, 1, z, 'N', 'gote');
  }
  pos.hands.sente.P = 1;
  pos.hands.sente.G = 1;
  return pos;
}
