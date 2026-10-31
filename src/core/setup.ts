import type { BoardConfig } from './config';
import { Position } from './position';
import type { BaseKind } from './types';

export interface LayoutEntry { kind: BaseKind; x: number; y: number }
export const STANDARD_LAYOUT: readonly LayoutEntry[] = [
  ...Array.from({ length: 9 }, (_, i): LayoutEntry => ({ kind: 'P', x: 9 - i, y: 7 })),
  { kind: 'B', x: 8, y: 8 }, { kind: 'R', x: 2, y: 8 },
  { kind: 'L', x: 9, y: 9 }, { kind: 'N', x: 8, y: 9 },
  { kind: 'S', x: 7, y: 9 }, { kind: 'G', x: 6, y: 9 },
  { kind: 'K', x: 5, y: 9 }, { kind: 'G', x: 4, y: 9 },
  { kind: 'S', x: 3, y: 9 }, { kind: 'N', x: 2, y: 9 }, { kind: 'L', x: 1, y: 9 },
];
export type LayerAssignment = readonly number[];
export function defaultAssignment(config: BoardConfig): number[] {
  return Array<number>(STANDARD_LAYOUT.length).fill(Math.floor(config.layers / 2));
}
export function randomAssignment(config: BoardConfig, rng: () => number = Math.random): number[] {
  return STANDARD_LAYOUT.map(() => Math.floor(rng() * config.layers));
}
export function validateAssignment(config: BoardConfig, a: LayerAssignment): boolean {
  return Array.isArray(a) && a.length === STANDARD_LAYOUT.length
    && Array.from(a).every(z => Number.isInteger(z) && z >= 0 && z < config.layers);
}
export function createInitialPosition(config: BoardConfig, sente: LayerAssignment, gote: LayerAssignment): Position {
  if (!validateAssignment(config, sente) || !validateAssignment(config, gote)) throw new Error('層の割り当てが不正です');
  const pos = new Position(config);
  for (const color of ['sente', 'gote'] as const) {
    const assignment = color === 'sente' ? sente : gote;
    STANDARD_LAYOUT.forEach((p, i) => {
      const z = assignment[i]!;
      const x = color === 'sente' ? p.x : 10 - p.x;
      const y = color === 'sente' ? p.y : 10 - p.y;
      pos.set({ x, y, z }, { type: p.kind, color });
    });
  }
  return pos;
}
