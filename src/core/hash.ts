import type { Position } from './position';
import type { HandKind, PieceType } from './types';

type Key = readonly [number, number];
const COLORS = ['sente', 'gote'] as const;
const HAND_KINDS: readonly HandKind[] = ['R', 'B', 'G', 'S', 'N', 'L', 'P'];
const PIECE_TYPES: readonly PieceType[] = ['K', ...HAND_KINDS, '+R', '+B', '+S', '+N', '+L', '+P'];

/** 固定シードの xorshift128。特徴を固定順に列挙し、文字列ハッシュの代数的な衝突を避ける。
 * 表は先に生成するため、局面を参照する順序には依存しない。 */
function createTable(): Map<string, Key> {
  const table = new Map<string, Key>();
  let x = 123456789, y = 362436069, z = 521288629, w = 88675123;
  const next = (): number => {
    const t = x ^ (x << 11);
    x = y; y = z; z = w;
    w = (w ^ (w >>> 19) ^ t ^ (t >>> 8)) >>> 0;
    return w;
  };
  const add = (feature: string): void => { table.set(feature, [next(), next()]); };
  for (const layers of [3, 9]) add(`board:9:9:${layers}`);
  add('turn:gote');
  for (let i = 0; i < 81 * 9; i++) {
    for (const color of COLORS) for (const type of PIECE_TYPES) add(`piece:${i}:${color}:${type}`);
  }
  // 枚数は二進表現の各ビットで区別する（Number の安全な整数の全範囲）。
  for (const color of COLORS) for (const kind of HAND_KINDS) {
    for (let bit = 0; bit < 53; bit++) add(`hand:${color}:${kind}:${bit}`);
  }
  return table;
}
const table = createTable();

/** 千日手の最終照合用。駒や持ち駒オブジェクトのプロパティ順序には依存しない。 */
export function positionKey(pos: Position): string {
  return JSON.stringify([
    pos.config.files, pos.config.ranks, pos.config.layers,
    pos.cells.map(piece => piece ? [piece.color, piece.type] : null),
    COLORS.map(color => HAND_KINDS.map(kind => pos.hands[color][kind])),
    pos.sideToMove,
  ]);
}

export function hashPosition(pos: Position): string {
  let low = 0;
  let high = 0;
  const add = (feature: string): void => {
    const pair = table.get(feature)!;
    low ^= pair[0];
    high ^= pair[1];
  };
  add(`board:${pos.config.files}:${pos.config.ranks}:${pos.config.layers}`);
  if (pos.sideToMove === 'gote') add('turn:gote');
  pos.cells.forEach((piece, i) => {
    if (piece) add(`piece:${i}:${piece.color}:${piece.type}`);
  });
  for (const color of COLORS) {
    for (const kind of HAND_KINDS) {
      let count = pos.hands[color][kind];
      for (let bit = 0; count > 0; bit++, count = Math.floor(count / 2)) {
        if (count % 2 === 1) add(`hand:${color}:${kind}:${bit}`);
      }
    }
  }
  const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');
  return `${hex(low)}:${hex(high)}`;
}
