export type Color = 'sente' | 'gote';
export type HandKind = 'R' | 'B' | 'G' | 'S' | 'N' | 'L' | 'P';
export type BaseKind = 'K' | HandKind;
export type PromotedKind = '+R' | '+B' | '+S' | '+N' | '+L' | '+P';
export type PieceType = BaseKind | PromotedKind;

export interface Piece { type: PieceType; color: Color }
/** x: 筋 1..9、y: 段 1..9、z: 層 0..layers-1 */
export interface Square { x: number; y: number; z: number }

export type Move =
  | { kind: 'move'; from: Square; to: Square; promote: boolean }
  | { kind: 'drop'; piece: HandKind; to: Square };

export const opposite = (c: Color): Color => (c === 'sente' ? 'gote' : 'sente');
