import { describe, expect, it } from 'vitest';
import { formatMove, layerKeyGuide, layerLabel, layerName, layerNames } from '../src/core/notation';
import { createInitialPosition, defaultAssignment } from '../src/core/setup';
import { SANJU } from '../src/core/config';
import type { PieceType } from '../src/core/types';
import { emptyPosition, put, sq } from './helpers';

describe('層の表示名と操作案内', () => {
  it('3層の表示名には層を一度だけ付ける', () => {
    expect(layerNames(3)).toEqual(['下層', '中層', '上層']);
    expect(layerKeyGuide(3)).toBe('1＝下・2＝中・3＝上');
  });
  it('9層の表示名とキー案内は1から9まで', () => {
    expect(layerNames(9)).toEqual(['1層', '2層', '3層', '4層', '5層', '6層', '7層', '8層', '9層']);
    expect(layerKeyGuide(9)).toBe('1＝1層・2＝2層・3＝3層・4＝4層・5＝5層・6＝6層・7＝7層・8＝8層・9＝9層');
    expect(layerName(8, 9)).toBe('9層');
  });
});

describe('棋譜表記', () => {
  it('3層は下中上、それ以外は1始まりの層番号', () => {
    expect([0, 1, 2].map(z => layerLabel(z, 3))).toEqual(['下', '中', '上']);
    expect(layerLabel(4, 9)).toBe('5層');
    expect(layerLabel(0, 1)).toBe('1層');
  });
  it('初期局面から層をまたぐ歩の手を表記する', () => {
    const a = defaultAssignment(SANJU);
    const pos = createInitialPosition(SANJU, a, a);
    const before = pos.clone();
    expect(formatMove(pos, { kind: 'move', from: sq(7, 7, 1), to: sq(7, 6, 2), promote: false }))
      .toBe('▲7六歩 中→上');
    expect(pos).toEqual(before);
  });
  it('打ちと後手の記号、9層の移動を表記する', () => {
    const pos = emptyPosition();
    expect(formatMove(pos, { kind: 'drop', piece: 'B', to: sq(5, 5, 2) })).toBe('▲5五角打 上');
    const cube = emptyPosition(9, 'gote');
    put(cube, 5, 5, 4, 'P', 'gote');
    expect(formatMove(cube, { kind: 'move', from: sq(5, 5, 4), to: sq(5, 6, 5), promote: false }))
      .toBe('△5六歩 5層→6層');
  });
  it('成りと選べる不成を区別する', () => {
    const pos = emptyPosition();
    put(pos, 2, 4, 1, 'P', 'sente');
    expect(formatMove(pos, { kind: 'move', from: sq(2, 4, 1), to: sq(2, 3, 1), promote: true }))
      .toBe('▲2三歩成 中→中');
    put(pos, 2, 4, 0, 'S', 'sente');
    expect(formatMove(pos, { kind: 'move', from: sq(2, 4, 0), to: sq(2, 3, 1), promote: false }))
      .toBe('▲2三銀不成 下→中');
    put(pos, 2, 3, 0, 'S', 'sente');
    expect(formatMove(pos, { kind: 'move', from: sq(2, 3, 0), to: sq(1, 4, 1), promote: false }))
      .toBe('▲1四銀不成 下→中');
  });
  it.each<[PieceType, string]>([
    ['K', '玉'], ['R', '飛'], ['B', '角'], ['G', '金'], ['S', '銀'], ['N', '桂'], ['L', '香'], ['P', '歩'],
    ['+R', '竜'], ['+B', '馬'], ['+S', '成銀'], ['+N', '成桂'], ['+L', '成香'], ['+P', 'と'],
  ])('%sの駒名を表記する', (type, name) => {
    const pos = emptyPosition();
    put(pos, 5, 5, 1, type, 'sente');
    expect(formatMove(pos, { kind: 'move', from: sq(5, 5, 1), to: sq(5, 4, 1), promote: false }))
      .toBe(`▲5四${name} 中→中`);
  });
});
