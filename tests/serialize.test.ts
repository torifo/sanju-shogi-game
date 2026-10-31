import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/game';
import { hashPosition } from '../src/core/hash';
import { decodeMove, encodeMove, loadGame, saveGame } from '../src/core/serialize';
import { defaultAssignment } from '../src/core/setup';
import type { Move } from '../src/core/types';
import { sq } from './helpers';

function startedGame(layers = 3): Game {
  const game = new Game({ files: 9, ranks: 9, layers });
  game.submitPlacement('sente', defaultAssignment(game.config));
  game.submitPlacement('gote', defaultAssignment(game.config));
  return game;
}
const move = (fx: number, fy: number, fz: number, tx: number, ty: number, tz: number, promote = false): Move =>
  ({ kind: 'move', from: sq(fx, fy, fz), to: sq(tx, ty, tz), promote });

describe('指し手の符号化', () => {
  it.each<[Move, string]>([
    [move(7, 7, 1, 7, 6, 2), 'm:7,7,1>7,6,2'],
    [move(2, 4, 0, 2, 3, 1, true), 'm:2,4,0>2,3,1+'],
    [{ kind: 'drop', piece: 'P', to: sq(5, 5, 8) }, 'd:P>5,5,8'],
    [{ kind: 'drop', piece: 'B', to: sq(5, 5, 0) }, 'd:B>5,5,0'],
  ])('%sを往復できる', (m, s) => {
    expect(encodeMove(m)).toBe(s);
    expect(decodeMove(s)).toEqual(m);
  });
  it.each(['', 'm:0,1,0>1,2,0', 'm:10,1,0>1,2,0', 'm:1,1,-1>1,2,0',
    'm:1,1,0>1,2,0++', 'm:1,1,0>1,2,0 trailing', 'm:1,1,0>1,2,0\n',
    'm:1,1,1.5>1,2,0', 'd:K>5,5,0', 'd:+P>5,5,0', 'd:P>5,5,0+',
    'd:P>5,5,9007199254740992', 'd:P>5,5,01'])('不正な文字列 %j はthrow', s => {
    expect(() => decodeMove(s)).toThrow();
  });
});

describe.each([3, 9])('%i層の保存と再開', layers => {
  it('JSON経由で取り・持ち駒・打ち・成りを含む棋譜と局面を復元する', () => {
    const game = startedGame(layers);
    const z = Math.floor(layers / 2);
    const moves: Move[] = [move(7, 7, z, 7, 6, z), move(7, 3, z, 7, 4, z),
      move(7, 6, z, 7, 5, z), move(7, 4, z, 7, 5, z),
      move(2, 8, z, 2, 8, z + 1), { kind: 'drop', piece: 'P', to: sq(5, 5, z + 1) },
      move(2, 8, z + 1, 2, 3, z + 1, true)];
    for (const m of moves) game.play(m);
    const saved = saveGame(game);
    expect(saved.v).toBe(1);
    const restored = loadGame(JSON.parse(JSON.stringify(saved)));
    expect(restored.moves).toEqual(game.moves);
    expect(restored.notation).toEqual(game.notation);
    expect(restored.position).toEqual(game.position);
    expect(hashPosition(restored.position!)).toBe(hashPosition(game.position!));
    expect(restored.phase).toEqual(game.phase);
    restored.undo();
    game.undo();
    expect(hashPosition(restored.position!)).toBe(hashPosition(game.position!));
    saved.sente[0] = 0;
    saved.moves.length = 0;
    expect(game.moves).toHaveLength(6);
    expect(game.placement('sente')?.[0]).toBe(z);
  });
  it('再開後も千日手を数え、終局した千日手も復元する', () => {
    const game = startedGame(layers);
    const z = Math.floor(layers / 2);
    const cycle = [move(2, 8, z, 2, 8, z + 1), move(8, 2, z, 8, 2, z + 1),
      move(2, 8, z + 1, 2, 8, z), move(8, 2, z + 1, 8, 2, z)];
    for (let i = 0; i < 11; i++) game.play(cycle[i % 4]!);
    const restored = loadGame(JSON.parse(JSON.stringify(saveGame(game))));
    restored.play(cycle[3]!);
    const ended = loadGame(saveGame(restored));
    expect(ended.phase).toEqual({ kind: 'ended', result: { kind: 'draw', reason: 'repetition' } });
    const invalid = saveGame(ended);
    invalid.moves.push(encodeMove(cycle[0]!));
    expect(() => loadGame(invalid)).toThrow();
  });
  it.each(['sente', 'gote'] as const)('%sの投了も保存・復元する', color => {
    const game = startedGame(layers);
    game.play(move(7, 7, Math.floor(layers / 2), 7, 6, Math.floor(layers / 2)));
    game.resign(color);
    const restored = loadGame(JSON.parse(JSON.stringify(saveGame(game))));
    expect(restored.phase).toEqual(game.phase);
    expect(restored.moves).toEqual(game.moves);
    restored.undo();
    expect(restored.phase).toEqual({ kind: 'playing' });
    expect(restored.moves).toHaveLength(0);
  });
  it('配置中は保存できない', () => {
    const game = new Game({ files: 9, ranks: 9, layers });
    expect(() => saveGame(game)).toThrow();
    game.submitPlacement('sente', defaultAssignment(game.config));
    expect(() => saveGame(game)).toThrow();
  });
});

describe('保存データの検証', () => {
  it.each([{}, null, [], 'text', { v: 2 }, { v: 1, layers: 0 }, { v: 1, layers: 3.5 }])('%jを拒否', data => {
    expect(() => loadGame(data)).toThrow();
  });
  it('割り当て・層数・棋譜の形式と合法性を検証する', () => {
    const valid = saveGame(startedGame());
    for (const data of [
      { ...valid, v: 2 }, { ...valid, layers: '3' }, { ...valid, layers: -1 },
      { ...valid, layers: NaN }, { ...valid, layers: Infinity },
      { ...valid, sente: [] }, { ...valid, gote: Array(20).fill(3) },
      { ...valid, sente: Array(20).fill(0.5) }, { ...valid, sente: Array(20) },
      { ...valid, moves: null }, { ...valid, moves: [42] }, { ...valid, moves: Array(1) },
      { ...valid, moves: ['m:7,7,1>7,4,1'] }, { ...valid, moves: ['d:P>5,5,1'] },
      { ...valid, moves: ['m:7,7,1>7,6,3'] }, { ...valid, resigned: 'nobody' },
    ]) expect(() => loadGame(data)).toThrow();
  });
});
