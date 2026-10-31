import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/game';
import type { GameEvent } from '../src/core/game';
import { hashPosition } from '../src/core/hash';
import { defaultAssignment } from '../src/core/setup';
import type { Color, Move } from '../src/core/types';
import { opposite } from '../src/core/types';
import { emptyPosition, pawnMatePosition, put, sq } from './helpers';

function startedGame(layers = 3): Game {
  const game = new Game({ files: 9, ranks: 9, layers });
  const a = defaultAssignment(game.config);
  game.submitPlacement('sente', a);
  game.submitPlacement('gote', a);
  return game;
}
const move = (fx: number, fy: number, fz: number, tx: number, ty: number, tz: number): Move =>
  ({ kind: 'move', from: sq(fx, fy, fz), to: sq(tx, ty, tz), promote: false });

describe.each([3, 9])('%i層の対局', layers => {
  it('配置は先手→後手。確定前の相手の割り当ては返さない', () => {
    const game = new Game({ files: 9, ranks: 9, layers });
    const a = defaultAssignment(game.config);
    expect(game.phase).toEqual({ kind: 'placing', color: 'sente' });
    expect(game.position).toBeNull();
    expect(game.placement('sente')).toBeNull();
    expect(game.placement('gote')).toBeNull();
    expect(game.legalMoves()).toEqual([]);
    expect(() => game.submitPlacement('gote', a)).toThrow();
    expect(() => game.submitPlacement('sente', [0])).toThrow();
    game.submitPlacement('sente', a);
    expect(game.phase).toEqual({ kind: 'placing', color: 'gote' });
    expect(game.placement('sente')).toEqual(a);
    expect(game.placement('gote')).toBeNull();
    expect(game.position).toBeNull();
    a[0] = 0;
    expect(game.placement('sente')?.[0]).toBe(Math.floor(layers / 2));
    game.placement('sente')![1] = 0;
    expect(game.placement('sente')?.[1]).toBe(Math.floor(layers / 2));
    game.submitPlacement('gote', a);
    expect(game.phase).toEqual({ kind: 'playing' });
    expect(game.position?.sideToMove).toBe('sente');
    expect(game.placement('gote')).toEqual(a);
    expect(() => game.submitPlacement('sente', a)).toThrow();
  });
  it('非合法手は局面・棋譜・通知を変えない', () => {
    const game = startedGame(layers);
    const before = game.position!.clone();
    const events: GameEvent[] = [];
    game.subscribe(e => events.push(e));
    expect(() => game.play(move(5, 7, Math.floor(layers / 2), 5, 4, 0))).toThrow();
    expect(game.position).toEqual(before);
    expect(game.moves).toEqual([]);
    expect(game.notation).toEqual([]);
    expect(events).toEqual([]);
  });
  it('指し手と表記を記録し、待ったで局面を戻す', () => {
    const game = startedGame(layers);
    const hash = hashPosition(game.position!);
    const m = move(7, 7, Math.floor(layers / 2), 7, 6, Math.floor(layers / 2) + 1);
    game.play(m);
    expect(game.moves).toEqual([m]);
    expect(game.notation).toHaveLength(1);
    expect(game.position?.sideToMove).toBe('gote');
    m.to.x = 1;
    expect(game.moves[0]?.to.x).toBe(7);
    game.undo();
    expect(hashPosition(game.position!)).toBe(hash);
    expect(game.moves).toEqual([]);
    expect(game.notation).toEqual([]);
    expect(game.phase).toEqual({ kind: 'playing' });
    game.undo();
    expect(hashPosition(game.position!)).toBe(hash);
  });
  it('初期局面を含め同一局面の4回目で千日手。待った後も数え直せる', () => {
    const game = startedGame(layers);
    const z = Math.floor(layers / 2);
    const cycle = [move(2, 8, z, 2, 8, z + 1), move(8, 2, z, 8, 2, z + 1),
      move(2, 8, z + 1, 2, 8, z), move(8, 2, z + 1, 8, 2, z)];
    for (let i = 0; i < 11; i++) game.play(cycle[i % 4]!);
    expect(game.phase).toEqual({ kind: 'playing' });
    game.play(cycle[3]!);
    expect(game.phase).toEqual({ kind: 'ended', result: { kind: 'draw', reason: 'repetition' } });
    expect(game.legalMoves()).toEqual([]);
    expect(() => game.play(cycle[0]!)).toThrow();
    game.undo();
    expect(game.phase).toEqual({ kind: 'playing' });
    game.play(cycle[3]!);
    expect(game.phase).toEqual({ kind: 'ended', result: { kind: 'draw', reason: 'repetition' } });
  });
  it.each<Color>(['sente', 'gote'])('%sが連続王手で千日手にするとその側の負け', checker => {
    const game = startedGame(layers);
    const pos = emptyPosition(layers, checker);
    put(pos, 9, 9, layers - 1, 'K', checker);
    put(pos, 5, 1, 0, 'K', opposite(checker));
    put(pos, 4, 2, 0, 'R', checker);
    game.position = pos;
    const cycle = [move(4, 2, 0, 5, 2, 0), move(5, 1, 0, 4, 1, 0),
      move(5, 2, 0, 4, 2, 0), move(4, 1, 0, 5, 1, 0)];
    for (let i = 0; i < 12; i++) game.play(cycle[i % 4]!);
    expect(game.phase).toEqual({ kind: 'ended', result: {
      kind: 'win', winner: opposite(checker), reason: 'perpetual-check',
    } });
  });
  it('途中に王手でない手があれば連続王手の負けにしない', () => {
    const game = startedGame(layers);
    const pos = emptyPosition(layers);
    put(pos, 9, 9, layers - 1, 'K', 'sente');
    put(pos, 5, 1, 1, 'K', 'gote');
    put(pos, 4, 2, 0, 'R', 'sente');
    game.position = pos;
    const cycle = [move(4, 2, 0, 5, 2, 0), move(5, 1, 1, 4, 1, 0),
      move(5, 2, 0, 5, 3, 0), move(4, 1, 0, 4, 1, 1),
      move(5, 3, 0, 4, 3, 0), move(4, 1, 1, 5, 1, 0),
      move(4, 3, 0, 4, 2, 0), move(5, 1, 0, 5, 1, 1)];
    for (let i = 0; i < 24; i++) game.play(cycle[i % 8]!);
    expect(game.phase).toEqual({ kind: 'ended', result: { kind: 'draw', reason: 'repetition' } });
  });
  it('詰みで終局し、終局後も待ったできる', () => {
    const game = startedGame(layers);
    game.position = pawnMatePosition(layers);
    const before = hashPosition(game.position);
    game.play({ kind: 'drop', piece: 'G', to: sq(5, 2, 1) });
    expect(game.phase).toEqual({ kind: 'ended', result: { kind: 'win', winner: 'sente', reason: 'checkmate' } });
    game.undo();
    expect(game.phase).toEqual({ kind: 'playing' });
    expect(hashPosition(game.position!)).toBe(before);
  });
  it('王手でない合法手なしでも負け', () => {
    const game = startedGame(layers);
    const pos = emptyPosition(layers);
    put(pos, 1, 1, 0, 'K', 'gote');
    put(pos, 9, 9, 0, 'K', 'sente');
    put(pos, 1, 3, 0, 'G', 'sente');
    put(pos, 3, 3, 0, 'N', 'sente');
    put(pos, 3, 3, 1, 'B', 'sente');
    game.position = pos;
    game.play(move(3, 3, 1, 2, 2, 2));
    expect(game.phase).toEqual({ kind: 'ended', result: { kind: 'win', winner: 'sente', reason: 'no-moves' } });
  });
  it('投了で相手が勝ち、手を指す前の投了も待ったできる', () => {
    const game = startedGame(layers);
    game.resign('gote');
    expect(game.phase).toEqual({ kind: 'ended', result: { kind: 'win', winner: 'sente', reason: 'resign' } });
    expect(() => game.resign('sente')).toThrow();
    game.undo();
    expect(game.phase).toEqual({ kind: 'playing' });
  });
});

describe('対局の通知と開始前の操作', () => {
  it('配置・指し手・待った・投了を通知し、購読解除できる', () => {
    const game = new Game({ files: 9, ranks: 9, layers: 3 });
    const events: string[] = [];
    const off = game.subscribe(e => events.push(e.type));
    const a = defaultAssignment(game.config);
    expect(() => game.play(move(7, 7, 1, 7, 6, 1))).toThrow();
    expect(() => game.resign('sente')).toThrow();
    expect(() => game.undo()).toThrow();
    game.submitPlacement('sente', a);
    game.submitPlacement('gote', a);
    game.play(move(7, 7, 1, 7, 6, 1));
    game.undo();
    game.resign('sente');
    expect(events).toEqual(['phase', 'phase', 'move', 'undo', 'phase']);
    off();
    game.undo();
    expect(events).toHaveLength(5);
  });
});

describe('局面ハッシュ', () => {
  it.each([3, 9])('%i層で盤・成り・所有者・持ち駒の数と所有者・手番を区別する', layers => {
    const pos = emptyPosition(layers);
    put(pos, 5, 5, 1, 'P', 'sente');
    const hash = hashPosition(pos);
    expect(hashPosition(pos.clone())).toBe(hash);
    const variants = [pos.clone(), pos.clone(), pos.clone(), pos.clone(), pos.clone(), pos.clone()];
    variants[0]!.set(sq(5, 5, 1), { type: '+P', color: 'sente' });
    variants[1]!.set(sq(5, 5, 1), { type: 'P', color: 'gote' });
    variants[2]!.set(sq(5, 5, 1), null);
    put(variants[2]!, 5, 5, layers - 1, 'P', 'sente');
    variants[3]!.hands.sente.P = 1;
    variants[4]!.hands.gote.P = 1;
    variants[5]!.sideToMove = 'gote';
    const hashes = [hash, ...variants.map(hashPosition)];
    const twoPawns = pos.clone();
    twoPawns.hands.sente.P = 2;
    hashes.push(hashPosition(twoPawns));
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(hashPosition(pos)).toBe(hash);
  });
  it('盤の寸法も区別する', () => {
    expect(hashPosition(emptyPosition(3))).not.toBe(hashPosition(emptyPosition(9)));
  });
});
