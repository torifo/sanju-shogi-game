import { describe, expect, it } from 'vitest';
import { destinations, generatePseudoMoves, isAttacked } from '../src/core/movegen';
import type { PieceType, Square } from '../src/core/types';
import { emptyPosition, put, sq } from './helpers';

const keys = (squares: Square[]) => squares.map(s => `${s.x},${s.y},${s.z}`).sort();

describe.each([3, 9])('%i層の立体移動', layers => {
  it('歩は前進と層±1だけ、下層では2マス', () => {
    for (const z of [0, 1]) {
      const pos = emptyPosition(layers);
      put(pos, 5, 5, z, 'P', 'sente');
      expect(keys(destinations(pos, sq(5, 5, z)))).toEqual(keys(
        (z === 0 ? [0, 1] : [0, 1, 2]).map(zz => sq(5, 4, zz)),
      ));
    }
  });
  it.each<[PieceType, number]>([['K', 26], ['S', 15], ['G', 20]])('%s の中央での移動数は%i', (type, n) => {
    const pos = emptyPosition(layers);
    put(pos, 5, 5, 1, type, 'sente');
    const ds = destinations(pos, sq(5, 5, 1));
    expect(ds).toHaveLength(n);
    expect(ds.some(s => s.x === 5 && s.y === 5 && s.z === 2)).toBe(type !== 'S');
  });
  it('銀には真上真下がなく、玉は下層で17マス', () => {
    const pos = emptyPosition(layers);
    put(pos, 5, 5, 1, 'S', 'sente');
    expect(destinations(pos, sq(5, 5, 1))).not.toContainEqual(sq(5, 5, 2));
    put(pos, 5, 5, 1, 'K', 'sente');
    expect(destinations(pos, sq(5, 5, 1))).toContainEqual(sq(5, 5, 0));
    pos.set(sq(5, 5, 1), null);
    put(pos, 5, 5, 0, 'K', 'sente');
    expect(destinations(pos, sq(5, 5, 0))).toHaveLength(17);
  });
  it.each(['sente', 'gote'] as const)('%sの桂は前方2段へ飛び越える', color => {
    const pos = emptyPosition(layers, color);
    put(pos, 5, 5, 1, 'N', color);
    const y = color === 'sente' ? 3 : 7;
    const expected = [4, 6].flatMap(x => [0, 1, 2].map(z => sq(x, y, z)));
    expect(keys(destinations(pos, sq(5, 5, 1)))).toEqual(keys(expected));
    put(pos, 5, color === 'sente' ? 4 : 6, 1, 'P', color);
    expect(keys(destinations(pos, sq(5, 5, 1)))).toEqual(keys(expected));
  });
  it('飛は層差と平面の距離を同じ倍率で進み、真上にも走る', () => {
    const pos = emptyPosition(layers);
    put(pos, 5, 5, 0, 'R', 'sente');
    const ds = destinations(pos, sq(5, 5, 0));
    expect(ds).toHaveLength(layers === 3 ? 26 : 40);
    for (let k = 1; k <= Math.min(4, layers - 1); k++) expect(ds).toContainEqual(sq(5 - k, 5, k));
    expect(ds).toContainEqual(sq(5, 5, layers - 1));
    expect(ds).not.toContainEqual(sq(5, 5, layers));
  });
  it.each(['sente', 'gote'] as const)('斜めの走りは%sの駒で止まる', color => {
    const pos = emptyPosition(layers);
    put(pos, 5, 5, 0, 'R', 'sente');
    put(pos, 4, 5, 1, 'P', color);
    const ds = destinations(pos, sq(5, 5, 0));
    expect(ds.some(s => s.x === 4 && s.y === 5 && s.z === 1)).toBe(color === 'gote');
    expect(ds).not.toContainEqual(sq(3, 5, 2));
  });
  it('角は平面斜めと層差を組み合わせるが真上に動かない', () => {
    const pos = emptyPosition(layers);
    put(pos, 5, 5, 1, 'B', 'sente');
    const ds = destinations(pos, sq(5, 5, 1));
    expect(ds).not.toContainEqual(sq(5, 5, 2));
    expect(ds).toContainEqual(sq(4, 4, 2));
    expect(ds).toContainEqual(sq(6, 6, 0));
  });
  it('香の走りは層の端で止まる', () => {
    const pos = emptyPosition(layers);
    put(pos, 5, 5, 1, 'L', 'sente');
    const ds = destinations(pos, sq(5, 5, 1));
    expect(ds).toHaveLength(layers === 3 ? 6 : 9);
    for (let y = 1; y <= 4; y++) expect(ds).toContainEqual(sq(5, y, 1));
    expect(ds).toContainEqual(sq(5, 4, 0));
    expect(ds).toContainEqual(sq(5, 4, 2));
  });
  it('竜は斜め一歩と真上真下への走り', () => {
    const pos = emptyPosition(layers);
    put(pos, 5, 5, 1, '+R', 'sente');
    const ds = destinations(pos, sq(5, 5, 1));
    for (const x of [4, 6]) for (const y of [4, 6]) for (const z of [0, 1, 2]) expect(ds).toContainEqual(sq(x, y, z));
    expect(ds).toContainEqual(sq(5, 5, layers - 1));
  });
  it('馬の真上真下は一歩だけ', () => {
    const pos = emptyPosition(layers);
    put(pos, 5, 5, 1, '+B', 'sente');
    const ds = destinations(pos, sq(5, 5, 1));
    expect(ds).toContainEqual(sq(5, 5, 2));
    expect(ds).not.toContainEqual(sq(5, 5, 3));
  });
  it('平面の端から盤外へ進めない', () => {
    const pos = emptyPosition(layers);
    put(pos, 1, 1, 0, 'K', 'sente');
    const ds = destinations(pos, sq(1, 1, 0));
    expect(ds).toHaveLength(7);
    expect(ds.every(s => pos.inBounds(s))).toBe(true);
    expect(destinations(pos, sq(9, 9, 0))).toEqual([]);
  });
  it('利きは遮蔽と立体の傾きを考慮する', () => {
    const pos = emptyPosition(layers);
    put(pos, 5, 1, 2, 'R', 'gote');
    put(pos, 5, 9, 2, 'K', 'sente');
    expect(isAttacked(pos, sq(5, 9, 2), 'gote')).toBe(true);
    put(pos, 5, 5, 2, 'P', 'sente');
    expect(isAttacked(pos, sq(5, 9, 2), 'gote')).toBe(false);
    pos.set(sq(5, 1, 2), null);
    put(pos, 5, 1, 1, 'R', 'gote');
    expect(isAttacked(pos, sq(5, 9, 2), 'gote')).toBe(false);
  });
  it('味方の駒のあるマスにも守りの利きがある', () => {
    const pos = emptyPosition(layers);
    put(pos, 5, 5, 1, 'G', 'gote');
    put(pos, 5, 6, 1, 'P', 'gote');
    expect(isAttacked(pos, sq(5, 6, 1), 'gote')).toBe(true);
    expect(destinations(pos, sq(5, 5, 1))).not.toContainEqual(sq(5, 6, 1));
  });
  it('敵陣に入る・出る・内部移動で成る/成らないを生成', () => {
    for (const [fromY, toY] of [[4, 3], [3, 4], [3, 2]] as const) {
      const pos = emptyPosition(layers);
      put(pos, 5, fromY, 1, 'S', 'sente');
      const ms = generatePseudoMoves(pos).filter(m => m.kind === 'move' && m.to.x === (toY > fromY ? 4 : 5) && m.to.y === toY && m.to.z === 1);
      expect(ms.map(m => m.kind === 'move' && m.promote).sort()).toEqual([false, true]);
    }
    const pos = emptyPosition(layers);
    put(pos, 5, 4, 1, 'G', 'sente');
    expect(generatePseudoMoves(pos).filter(m => m.to.x === 5 && m.to.y === 3 && m.to.z === 1)).toHaveLength(1);
  });
  it('持ち駒は種類ごとに全空きマスへ打つ候補を出す', () => {
    const pos = emptyPosition(layers);
    put(pos, 5, 5, 1, 'P', 'sente');
    pos.hands.sente.P = 2;
    pos.hands.sente.B = 1;
    const drops = generatePseudoMoves(pos).filter(m => m.kind === 'drop');
    expect(drops).toHaveLength((81 * layers - 1) * 2);
    expect(drops.every(m => pos.get(m.to) === null)).toBe(true);
  });
});
