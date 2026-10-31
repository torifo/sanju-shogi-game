import type { Piece, PieceType, Square } from '../core/types';
export interface RenderPiece { sq: Square; piece: Piece }
export interface Highlights { selected?: Square; targets: Square[]; lastMove?: Square[]; check?: Square }
export const squareKey = (sq: Square): string => `${sq.x},${sq.y},${sq.z}`;
export const sameSquare = (a: Square | undefined, b: Square): boolean => !!a && squareKey(a) === squareKey(b);
export const PIECE_NAMES: Record<PieceType, string> = {
  K: '玉', R: '飛', B: '角', G: '金', S: '銀', N: '桂', L: '香', P: '歩',
  '+R': '竜', '+B': '馬', '+S': '成銀', '+N': '成桂', '+L': '成香', '+P': 'と',
};
export const RANKS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
