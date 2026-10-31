import { generatePseudoMoves, isAttacked } from './movegen';
import type { Position } from './position';
import { opposite, type Color, type Move, type PieceType, type Square } from './types';

export function isInCheck(pos: Position, color: Color): boolean {
  const king = pos.findKing(color);
  return king !== null && isAttacked(pos, king, opposite(color));
}

export function mustPromote(type: PieceType, color: Color, toY: number): boolean {
  const rank = color === 'sente' ? toY : 10 - toY;
  return ((type === 'P' || type === 'L') && rank === 1) || (type === 'N' && rank <= 2);
}

function hasPawnInFile(pos: Position, color: Color, at: Square): boolean {
  for (let y = 1; y <= pos.config.ranks; y++) {
    const piece = pos.get({ x: at.x, y, z: at.z });
    if (piece?.color === color && piece.type === 'P') return true;
  }
  return false;
}

function legalMoves(pos: Position, skipPawnMate: boolean, firstOnly = false): Move[] {
  const color = pos.sideToMove;
  const legal: Move[] = [];
  for (const move of generatePseudoMoves(pos)) {
    if (move.kind === 'move') {
      if (pos.get(move.to)?.type === 'K') continue;
      const piece = pos.get(move.from)!;
      if (!move.promote && mustPromote(piece.type, color, move.to.y)) continue;
      // 立体では移動でも同じ層・筋へ2枚の歩が集まり得る（仕様§3.5）。
      if (piece.type === 'P' && !move.promote && move.from.z !== move.to.z
        && hasPawnInFile(pos, color, move.to)) continue;
    } else {
      if (mustPromote(move.piece, color, move.to.y)) continue;
      if (move.piece === 'P' && hasPawnInFile(pos, color, move.to)) continue;
    }
    const undo = pos.apply(move);
    let allowed: boolean;
    try {
      allowed = !isInCheck(pos, color);
      if (allowed && !skipPawnMate && move.kind === 'drop' && move.piece === 'P') {
        const king = pos.findKing(pos.sideToMove);
        // 打った歩自身の王手だけを打ち歩詰めの対象にする。
        const pawnChecks = king !== null && king.x === move.to.x
          && king.y === move.to.y + (color === 'sente' ? -1 : 1)
          && Math.abs(king.z - move.to.z) <= 1;
        if (pawnChecks && legalMoves(pos, true, true).length === 0) allowed = false;
      }
    } finally {
      pos.undo(undo);
    }
    if (allowed) {
      legal.push(move);
      if (firstOnly) break;
    }
  }
  return legal;
}

export function generateLegalMoves(pos: Position): Move[] { return legalMoves(pos, false); }

const sameSquare = (a: Square, b: Square): boolean => a.x === b.x && a.y === b.y && a.z === b.z;
export function isLegalMove(pos: Position, move: Move): boolean {
  return generateLegalMoves(pos).some(m => sameSquare(m.to, move.to) && (
    m.kind === 'move' && move.kind === 'move' ? sameSquare(m.from, move.from) && m.promote === move.promote
      : m.kind === 'drop' && move.kind === 'drop' && m.piece === move.piece
  ));
}

export type Status =
  | { kind: 'ongoing'; check: boolean }
  | { kind: 'checkmate'; winner: Color }
  | { kind: 'no-moves'; winner: Color };

export function status(pos: Position): Status {
  const check = isInCheck(pos, pos.sideToMove);
  return legalMoves(pos, false, true).length > 0 ? { kind: 'ongoing', check }
    : { kind: check ? 'checkmate' : 'no-moves', winner: opposite(pos.sideToMove) };
}
