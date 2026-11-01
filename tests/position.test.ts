import { describe, expect, it } from 'vitest';
import { CUBE, SANJU } from '../src/core/config';
import { Position } from '../src/core/position';
import { STANDARD_LAYOUT, createInitialPosition, defaultAssignment, randomAssignment, validateAssignment } from '../src/core/setup';
import type { Move } from '../src/core/types';
import { emptyPosition, put, sq } from './helpers';

describe('局面と初期配置', () => {
  it.each([0, -1, 1, 2, 4, 8, 10, 3.5, NaN, Infinity])('非対応の層数 %s を拒否する', layers => {
    expect(() => new Position({ files: 9, ranks: 9, layers })).toThrow('盤の設定が不正です');
  });
  it('添字は0始まりで、層を含む', () => {
    expect(Position.index(sq(1, 1, 0))).toBe(0);
    expect(Position.index(sq(9, 9, 2))).toBe(242);
  });
  it.each([3, 9])('%i層の範囲判定', layers => {
    const pos = emptyPosition(layers);
    expect(pos.cells).toHaveLength(81 * layers);
    expect(pos.inBounds(sq(5, 5, 3))).toBe(layers === 9);
    for (const s of [sq(0, 5, 0), sq(10, 5, 0), sq(5, 0, 0), sq(5, 10, 0), sq(5, 5, -1), sq(1.5, 1, 0)]) {
      expect(pos.inBounds(s)).toBe(false);
    }
  });
  it.each([SANJU, CUBE])('標準配置40枚と反転（$layers層）', config => {
    const mid = Math.floor(config.layers / 2);
    const pos = createInitialPosition(config, defaultAssignment(config), defaultAssignment(config));
    expect(pos.cells.filter(Boolean)).toHaveLength(40);
    pos.cells.forEach((p, i) => { if (p) expect(Math.floor(i / 81)).toBe(mid); });
    expect(pos.findKing('sente')).toEqual(sq(5, 9, mid));
    expect(pos.findKing('gote')).toEqual(sq(5, 1, mid));
    expect(pos.get(sq(8, 2, mid))).toEqual({ type: 'R', color: 'gote' });
    expect(STANDARD_LAYOUT).toHaveLength(20);
    expect(STANDARD_LAYOUT[0]).toEqual({ kind: 'P', x: 9, y: 7 });
    expect(STANDARD_LAYOUT[8]).toEqual({ kind: 'P', x: 1, y: 7 });
  });
  it('飛の割り当ては添字10', () => {
    const a = defaultAssignment(SANJU);
    a[10] = 2;
    const pos = createInitialPosition(SANJU, a, defaultAssignment(SANJU));
    expect(pos.get(sq(2, 8, 2))).toEqual({ type: 'R', color: 'sente' });
    expect(pos.get(sq(2, 8, 1))).toBeNull();
  });
  it('割り当ての長さ・範囲・整数を検証', () => {
    for (const a of [[], Array(19).fill(1), Array(21).fill(1), Array(20).fill(-1), Array(20).fill(3), Array(20).fill(0.5), Array(20).fill(NaN), Array(20)]) {
      expect(validateAssignment(SANJU, a)).toBe(false);
      expect(() => createInitialPosition(SANJU, a, defaultAssignment(SANJU))).toThrow();
    }
    expect(validateAssignment(CUBE, Array(20).fill(8))).toBe(true);
  });
  it('乱数源を指定してランダム配置できる', () => {
    expect(randomAssignment(SANJU, () => 0)).toEqual(Array(20).fill(0));
    expect(randomAssignment(CUBE, () => 0.999)).toEqual(Array(20).fill(8));
    expect(validateAssignment(SANJU, randomAssignment(SANJU))).toBe(true);
  });
  it.each<Move>([
    { kind: 'move', from: sq(5, 4, 1), to: sq(5, 3, 2), promote: false },
    { kind: 'move', from: sq(5, 4, 1), to: sq(5, 3, 2), promote: true },
    { kind: 'drop', piece: 'B', to: sq(4, 5, 0) },
  ])('適用と取消で取り・成り・打ちを復元: $kind $promote', move => {
    const pos = emptyPosition();
    put(pos, 5, 4, 1, 'P', 'sente');
    put(pos, 5, 3, 2, '+R', 'gote');
    pos.hands.sente.B = 1;
    const before = pos.clone();
    const u = pos.apply(move);
    expect(pos.sideToMove).toBe('gote');
    if (move.kind === 'move') {
      expect(pos.hands.sente.R).toBe(1);
      expect(pos.get(move.to)?.type).toBe(move.promote ? '+P' : 'P');
    } else {
      expect(pos.hands.sente.B).toBe(0);
      expect(pos.get(move.to)).toEqual({ type: 'B', color: 'sente' });
    }
    pos.undo(u);
    expect(pos).toEqual(before);
  });
  it('cloneは盤・駒・持ち駒を共有しない', () => {
    const pos = emptyPosition();
    put(pos, 5, 5, 1, 'P', 'sente');
    const copy = pos.clone();
    copy.hands.sente.P++;
    copy.get(sq(5, 5, 1))!.type = '+P';
    expect(pos.hands.sente.P).toBe(0);
    expect(pos.get(sq(5, 5, 1))?.type).toBe('P');
    expect(pos.findKing('sente')).toBeNull();
  });
});
