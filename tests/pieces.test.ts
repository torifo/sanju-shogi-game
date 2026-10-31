import { describe, expect, it } from 'vitest';
import { PIECE_SPECS, canPromoteType, directionFor, promote, unpromote } from '../src/core/pieces';
import { opposite, type PieceType } from '../src/core/types';

describe('駒の定義', () => {
  it('玉は周囲8方向と真上真下への一歩', () => {
    expect(PIECE_SPECS.K.steps).toHaveLength(8);
    expect(PIECE_SPECS.K.vertical).toBe('step');
  });
  it.each<PieceType>(['G', '+S', '+N', '+L', '+P'])('%s は金の動き', type => {
    expect(PIECE_SPECS[type].steps).toEqual(PIECE_SPECS.G.steps);
    expect(PIECE_SPECS[type].steps).toHaveLength(6);
    expect(PIECE_SPECS[type].vertical).toBe('step');
  });
  it.each<PieceType>(['S', 'N', 'L', 'P', 'B'])('%s は真上真下に動けない', type => {
    expect(PIECE_SPECS[type].vertical).toBe('none');
  });
  it.each<PieceType>(['R', '+R'])('%s は真上真下に走れる', type => {
    expect(PIECE_SPECS[type].vertical).toBe('slide');
  });
  it('馬の真上真下は一歩', () => expect(PIECE_SPECS['+B'].vertical).toBe('step'));
  it.each<PieceType>(['R', 'B', 'S', 'N', 'L', 'P'])('%s の成りと成り戻し', type => {
    expect(canPromoteType(type)).toBe(true);
    expect(unpromote(promote(type))).toBe(type);
    expect(canPromoteType(promote(type))).toBe(false);
  });
  it('金と玉は成らない', () => {
    expect(promote('P')).toBe('+P');
    expect(promote('G')).toBe('G');
    expect(promote('K')).toBe('K');
    expect(unpromote('+R')).toBe('R');
    expect(canPromoteType('G')).toBe(false);
    expect(canPromoteType('K')).toBe(false);
  });
  it('後手の前方と手番の反転', () => {
    expect(directionFor('gote', [1, -2])[1]).toBe(2);
    expect(directionFor('sente', [1, -2])).toEqual([1, -2]);
    expect(opposite('sente')).toBe('gote');
    expect(opposite('gote')).toBe('sente');
  });
});
