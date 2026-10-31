import { PIECE_SPECS, canPromoteType, directionFor } from './pieces';
import type { Position } from './position';
import type { Color, HandKind, Move, Square } from './types';

function targets(pos: Position, from: Square, includeFriendly: boolean): Square[] {
  const piece = pos.get(from);
  if (!piece) return [];
  const spec = PIECE_SPECS[piece.type];
  const result: Square[] = [];
  const ray = (dx: number, dy: number, dz: number, slide: boolean): void => {
    for (let k = 1; ; k++) {
      const to = { x: from.x + k * dx, y: from.y + k * dy, z: from.z + k * dz };
      if (!pos.inBounds(to)) break;
      const occupant = pos.get(to);
      if (includeFriendly || !occupant || occupant.color !== piece.color) result.push(to);
      if (!slide || occupant) break;
    }
  };
  for (const v of [...spec.steps, ...spec.jumps]) {
    const [dx, dy] = directionFor(piece.color, v);
    for (const dz of [-1, 0, 1]) ray(dx, dy, dz, false);
  }
  for (const v of spec.slides) {
    const [dx, dy] = directionFor(piece.color, v);
    for (const dz of [-1, 0, 1]) ray(dx, dy, dz, true);
  }
  if (spec.vertical !== 'none') {
    for (const dz of [-1, 1]) ray(0, 0, dz, spec.vertical === 'slide');
  }
  return result;
}

export function destinations(pos: Position, from: Square): Square[] { return targets(pos, from, false); }

export function isAttacked(pos: Position, sq: Square, by: Color): boolean {
  if (!pos.inBounds(sq)) return false;
  return pos.cells.some((piece, i) => {
    if (piece?.color !== by) return false;
    const from = { x: i % 9 + 1, y: Math.floor(i / 9) % 9 + 1, z: Math.floor(i / 81) };
    return targets(pos, from, true).some(to => to.x === sq.x && to.y === sq.y && to.z === sq.z);
  });
}

export function generatePseudoMoves(pos: Position): Move[] {
  const moves: Move[] = [];
  const inZone = (y: number): boolean => pos.sideToMove === 'sente' ? y <= 3 : y >= 7;
  pos.cells.forEach((piece, i) => {
    if (!piece) {
      const to = { x: i % 9 + 1, y: Math.floor(i / 9) % 9 + 1, z: Math.floor(i / 81) };
      for (const kind of Object.keys(pos.hands[pos.sideToMove]) as HandKind[]) {
        if (pos.hands[pos.sideToMove][kind] > 0) moves.push({ kind: 'drop', piece: kind, to });
      }
    } else if (piece.color === pos.sideToMove) {
      const from = { x: i % 9 + 1, y: Math.floor(i / 9) % 9 + 1, z: Math.floor(i / 81) };
      for (const to of destinations(pos, from)) {
        moves.push({ kind: 'move', from, to, promote: false });
        if (canPromoteType(piece.type) && (inZone(from.y) || inZone(to.y))) {
          moves.push({ kind: 'move', from, to, promote: true });
        }
      }
    }
  });
  return moves;
}
