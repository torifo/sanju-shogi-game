import type { Position } from './position';
import type { HandKind } from './types';

type Key = readonly [number, number];
const table = new Map<string, Key>();

/** 固定シードから特徴ごとの64bit相当のZobristキーを遅延生成する。
 * 参照順や対局の履歴によらず、同じ特徴には同じキーを返す。 */
function key(feature: string): Key {
  const cached = table.get(feature);
  if (cached) return cached;
  let lowSeed = 0x811c9dc5;
  let highSeed = 0x9e3779b9;
  for (let i = 0; i < feature.length; i++) {
    const code = feature.charCodeAt(i);
    lowSeed = Math.imul(lowSeed ^ code, 0x01000193);
    highSeed = Math.imul(highSeed ^ code, 0x85ebca6b);
  }
  const random = (seed: number): number => {
    if (seed === 0) seed = 0x6d2b79f5;
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed >>> 0;
  };
  const value: Key = [random(lowSeed), random(highSeed)];
  table.set(feature, value);
  return value;
}

export function hashPosition(pos: Position): string {
  let low = 0;
  let high = 0;
  const add = (feature: string): void => {
    const pair = key(feature);
    low ^= pair[0];
    high ^= pair[1];
  };
  add(`board:${pos.config.files}:${pos.config.ranks}:${pos.config.layers}`);
  if (pos.sideToMove === 'gote') add('turn:gote');
  pos.cells.forEach((piece, i) => {
    if (piece) add(`piece:${i}:${piece.color}:${piece.type}`);
  });
  for (const color of ['sente', 'gote'] as const) {
    for (const kind of Object.keys(pos.hands[color]) as HandKind[]) {
      const count = pos.hands[color][kind];
      if (count !== 0) add(`hand:${color}:${kind}:${count}`);
    }
  }
  const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');
  return `${hex(low)}:${hex(high)}`;
}
