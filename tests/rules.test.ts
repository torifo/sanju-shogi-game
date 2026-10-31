import { describe, expect, it } from 'vitest';
import { generateLegalMoves, isInCheck, isLegalMove, mustPromote, status } from '../src/core/rules';
import type { Color, HandKind, Move, PieceType } from '../src/core/types';
import { emptyPosition, pawnMatePosition, put, sq } from './helpers';

describe.each([3, 9])('%i層の合法手', layers => {
  it('玉への飛の線を遮る金は横に動かせない', () => {
    const pos = emptyPosition(layers);
    put(pos, 5, 9, 1, 'K', 'sente');
    put(pos, 5, 1, 1, 'R', 'gote');
    put(pos, 5, 5, 1, 'G', 'sente');
    expect(isLegalMove(pos, { kind: 'move', from: sq(5, 5, 1), to: sq(4, 5, 1), promote: false })).toBe(false);
    expect(isLegalMove(pos, { kind: 'move', from: sq(5, 5, 1), to: sq(5, 4, 1), promote: false })).toBe(true);
    expect(isInCheck(pos, 'sente')).toBe(false);
    pos.set(sq(5, 5, 1), null);
    expect(isInCheck(pos, 'sente')).toBe(true);
  });
  it('飛と玉の層差と距離が線を作らなければ金を横に動かせる', () => {
    const pos = emptyPosition(layers);
    put(pos, 5, 9, 1, 'K', 'sente');
    put(pos, 5, 1, 0, 'R', 'gote');
    put(pos, 5, 5, 1, 'G', 'sente');
    expect(isLegalMove(pos, { kind: 'move', from: sq(5, 5, 1), to: sq(4, 5, 1), promote: false })).toBe(true);
  });
  it('二歩は同じ筋・同じ層だけ。と金は数えない', () => {
    const pos = emptyPosition(layers);
    put(pos, 5, 7, 1, 'P', 'sente');
    pos.hands.sente.P = 1;
    const legal = generateLegalMoves(pos);
    const drop = (z: number): Move => ({ kind: 'drop', piece: 'P', to: sq(5, 5, z) });
    expect(legal).not.toContainEqual(drop(1));
    expect(legal).toContainEqual(drop(0));
    expect(legal).toContainEqual(drop(2));
    put(pos, 5, 7, 1, '+P', 'sente');
    expect(isLegalMove(pos, drop(1))).toBe(true);
    put(pos, 5, 7, 1, 'P', 'gote');
    expect(isLegalMove(pos, drop(1))).toBe(true);
  });
  it.each(['sente', 'gote'] as const)('%sの歩は層移動でも二歩にできないが、成れば移れる', color => {
    const pos = emptyPosition(layers, color);
    const fromY = color === 'sente' ? 4 : 6;
    const toY = color === 'sente' ? 3 : 7;
    put(pos, 5, fromY, 1, 'P', color);
    put(pos, 5, fromY + (color === 'sente' ? 1 : -1), 0, 'P', color);
    const move: Move = { kind: 'move', from: sq(5, fromY, 1), to: sq(5, toY, 0), promote: false };
    expect(isLegalMove(pos, move)).toBe(false);
    expect(isLegalMove(pos, { ...move, promote: true })).toBe(true);
    expect(isLegalMove(pos, { ...move, to: sq(5, toY, 1) })).toBe(true);
    expect(isLegalMove(pos, { ...move, to: sq(5, toY, 2) })).toBe(true);
    put(pos, 5, fromY + (color === 'sente' ? 1 : -1), 0, '+P', color);
    expect(isLegalMove(pos, move)).toBe(true);
  });
  it.each(['sente', 'gote'] as const)('%sの行き所のない打ちを禁止', color => {
    const pos = emptyPosition(layers, color);
    pos.hands[color].P = pos.hands[color].N = pos.hands[color].L = 1;
    const legal = generateLegalMoves(pos);
    const y = color === 'sente' ? 1 : 9;
    const second = color === 'sente' ? 2 : 8;
    for (const z of [0, layers - 1]) {
      for (const piece of ['P', 'L', 'N'] as const) expect(legal).not.toContainEqual({ kind: 'drop', piece, to: sq(5, y, z) });
      expect(legal).not.toContainEqual({ kind: 'drop', piece: 'N', to: sq(5, second, z) });
      expect(legal).toContainEqual({ kind: 'drop', piece: 'P', to: sq(5, second, z) });
    }
  });
  it.each<[PieceType, number, number, number]>([['P', 2, 5, 1], ['L', 2, 5, 1], ['N', 4, 4, 2]])('%sは行き所がなくなる移動で強制成り', (type, fromY, toX, toY) => {
    const pos = emptyPosition(layers);
    put(pos, 5, fromY, 1, type, 'sente');
    const ms = generateLegalMoves(pos).filter(m => m.to.x === toX && m.to.y === toY);
    expect(ms).toHaveLength(3);
    expect(ms.every(m => m.kind === 'move' && m.promote)).toBe(true);
  });
  it('歩を打って詰ます手だけを禁止し、金打ちの詰みは認める', () => {
    const pos = pawnMatePosition(layers);
    const before = pos.clone();
    expect(isLegalMove(pos, { kind: 'drop', piece: 'P', to: sq(5, 2, 1) })).toBe(false);
    expect(isLegalMove(pos, { kind: 'drop', piece: 'G', to: sq(5, 2, 1) })).toBe(true);
    expect(pos).toEqual(before);
    pos.apply({ kind: 'drop', piece: 'G', to: sq(5, 2, 1) });
    expect(status(pos)).toEqual({ kind: 'checkmate', winner: 'sente' });
  });
  it('上下に逃げられる王手の歩打ちは詰みではない', () => {
    const pos = pawnMatePosition(layers);
    pos.set(sq(5, 1, 0), null);
    // 歩は別層の玉にも利くので、同じ筋段の空きだけでは逃げられない。
    pos.set(sq(4, 1, 0), null);
    expect(isLegalMove(pos, { kind: 'drop', piece: 'P', to: sq(5, 2, 1) })).toBe(true);
  });
  it('盤上の歩を動かした詰みは許可する', () => {
    const pos = pawnMatePosition(layers);
    put(pos, 5, 3, 1, 'P', 'sente');
    put(pos, 5, 3, 0, 'G', 'sente');
    // 下層の金だけでは (4/5/6,2,2) が逃げ道になる。上層からも守る。
    put(pos, 5, 3, 2, 'G', 'sente');
    const m: Move = { kind: 'move', from: sq(5, 3, 1), to: sq(5, 2, 1), promote: false };
    expect(isInCheck(pos, 'gote')).toBe(false);
    expect(isLegalMove(pos, m)).toBe(true);
    pos.apply(m);
    expect(generateLegalMoves(pos)).toEqual([]);
    expect(status(pos)).toEqual({ kind: 'checkmate', winner: 'sente' });
  });
  it('下層の金だけでは歩の王手から上層の3マスへ逃げられる', () => {
    const pos = pawnMatePosition(layers);
    put(pos, 5, 3, 1, 'P', 'sente');
    put(pos, 5, 3, 0, 'G', 'sente');
    pos.apply({ kind: 'move', from: sq(5, 3, 1), to: sq(5, 2, 1), promote: false });
    expect(generateLegalMoves(pos)).toEqual(expect.arrayContaining(
      [4, 5, 6].map(x => ({ kind: 'move', from: sq(5, 1, 1), to: sq(x, 2, 2), promote: false })),
    ));
    expect(generateLegalMoves(pos)).toHaveLength(3);
    expect(status(pos)).toEqual({ kind: 'ongoing', check: true });
  });
  it('王手なしで合法手がない場合も手番側の負け', () => {
    const pos = emptyPosition(layers, 'gote');
    put(pos, 1, 1, 0, 'K', 'gote');
    put(pos, 9, 9, 0, 'K', 'sente');
    put(pos, 1, 3, 0, 'G', 'sente');
    put(pos, 3, 3, 0, 'N', 'sente');
    put(pos, 2, 2, 2, 'B', 'sente');
    expect(isInCheck(pos, 'gote')).toBe(false);
    expect(status(pos)).toEqual({ kind: 'no-moves', winner: 'sente' });
  });
  it('王手を解除する手を残し、玉を取る手は指さない', () => {
    const pos = emptyPosition(layers);
    put(pos, 5, 9, 1, 'K', 'sente');
    put(pos, 5, 1, 1, 'R', 'gote');
    put(pos, 9, 1, 1, 'K', 'gote');
    expect(status(pos)).toEqual({ kind: 'ongoing', check: true });
    expect(isLegalMove(pos, { kind: 'move', from: sq(5, 9, 1), to: sq(4, 9, 1), promote: false })).toBe(true);
    put(pos, 9, 2, 1, 'R', 'sente');
    expect(isLegalMove(pos, { kind: 'move', from: sq(9, 2, 1), to: sq(9, 1, 1), promote: false })).toBe(false);
  });
  it('不正な手・二重の成り・持ち駒のない打ちは拒否', () => {
    const pos = emptyPosition(layers);
    put(pos, 5, 5, 1, '+P', 'sente');
    const before = pos.clone();
    for (const m of [
      { kind: 'move', from: sq(5, 5, 1), to: sq(5, 4, 1), promote: true },
      { kind: 'move', from: sq(5, 5, 1), to: sq(5, 2, 1), promote: false },
      { kind: 'drop', piece: 'B', to: sq(5, 6, 1) },
      { kind: 'drop', piece: 'P', to: sq(5, 0, 1) },
    ] satisfies Move[]) expect(isLegalMove(pos, m)).toBe(false);
    expect(pos).toEqual(before);
  });
});

describe('強制成りの対称性', () => {
  it.each<Color>(['sente', 'gote'])('%sの歩・香・桂だけが対象', color => {
    const last = color === 'sente' ? 1 : 9;
    const second = color === 'sente' ? 2 : 8;
    for (const type of ['P', 'L'] as const) {
      expect(mustPromote(type, color, last)).toBe(true);
      expect(mustPromote(type, color, second)).toBe(false);
    }
    expect(mustPromote('N', color, second)).toBe(true);
    for (const type of ['K', 'G', 'S', 'R', 'B', '+P', '+L', '+N'] as const) expect(mustPromote(type, color, last)).toBe(false);
  });
  it.each<HandKind>(['P', 'L', 'N'])('%sは最奥段へ打てない', piece => expect(mustPromote(piece, 'sente', 1)).toBe(true));
});
