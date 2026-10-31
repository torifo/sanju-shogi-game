import type { BaseKind, Color, PieceType } from './types';

export interface PieceSpec {
  steps: ReadonlyArray<readonly [dx: number, dy: number]>;
  jumps: ReadonlyArray<readonly [dx: number, dy: number]>;
  slides: ReadonlyArray<readonly [dx: number, dy: number]>;
  vertical: 'none' | 'step' | 'slide';
}

const diagonals = [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const;
const orthogonals = [[0, -1], [-1, 0], [1, 0], [0, 1]] as const;
const gold: PieceSpec = {
  steps: [[0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0], [0, 1]],
  jumps: [], slides: [], vertical: 'step',
};

export const PIECE_SPECS: Record<PieceType, PieceSpec> = {
  K: { steps: [...diagonals, ...orthogonals], jumps: [], slides: [], vertical: 'step' },
  G: gold, '+S': gold, '+N': gold, '+L': gold, '+P': gold,
  S: { steps: [[0, -1], ...diagonals], jumps: [], slides: [], vertical: 'none' },
  N: { steps: [], jumps: [[-1, -2], [1, -2]], slides: [], vertical: 'none' },
  L: { steps: [], jumps: [], slides: [[0, -1]], vertical: 'none' },
  P: { steps: [[0, -1]], jumps: [], slides: [], vertical: 'none' },
  R: { steps: [], jumps: [], slides: orthogonals, vertical: 'slide' },
  B: { steps: [], jumps: [], slides: diagonals, vertical: 'none' },
  '+R': { steps: diagonals, jumps: [], slides: orthogonals, vertical: 'slide' },
  '+B': { steps: orthogonals, jumps: [], slides: diagonals, vertical: 'step' },
};

const promotions: Partial<Record<PieceType, PieceType>> = {
  R: '+R', B: '+B', S: '+S', N: '+N', L: '+L', P: '+P',
};

export function promote(t: PieceType): PieceType { return promotions[t] ?? t; }
export function unpromote(t: PieceType): BaseKind {
  return (t.startsWith('+') ? t.slice(1) : t) as BaseKind;
}
export function canPromoteType(t: PieceType): boolean { return promotions[t] !== undefined; }
export function directionFor(color: Color, v: readonly [number, number]): [number, number] {
  return [v[0], color === 'sente' ? v[1] : -v[1]];
}
