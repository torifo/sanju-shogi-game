import { describe, expect, it } from 'vitest';
import { onlineEntry, onlineBoardScreen, canPlayOnline } from '../src/ui/onlineRouting';
const key = 'AAAAAAAAAAAAAAAAAAAAAA';
describe('online routing without DOM', () => {
  it('routes normal and invalid hashes and uses saved host identity only for that room', () => {
    expect(onlineEntry('', null)).toEqual({ kind: 'title' });
    expect(onlineEntry('#help', null)).toEqual({ kind: 'title' });
    expect(onlineEntry('#room=bad', null)).toEqual({ kind: 'invalid' });
    expect(onlineEntry(`#room=${key}`, null)).toEqual({ kind: 'room', roomKey: key, role: 'guest', layers: 3 });
    expect(onlineEntry(`#room=${key}`, { role: 'host', layers: 9 })).toEqual({ kind: 'room', roomKey: key, role: 'host', layers: 9 });
  });
  it('keeps private placement on a separate screen and resumes a public game directly', () => {
    expect(onlineBoardScreen('placing', null)).toBe('lobby');
    expect(onlineBoardScreen('placing', 'gote')).toBe('placement');
    expect(onlineBoardScreen('playing', 'sente')).toBe('game');
    expect(onlineBoardScreen('ended', 'sente')).toBe('game');
  });
  it('only allows input on the assigned turn while connected and without an undo pending', () => {
    expect(canPlayOnline('playing', 'sente', 'sente', false)).toBe(true);
    expect(canPlayOnline('playing', 'sente', 'gote', false)).toBe(false);
    expect(canPlayOnline('disconnected', 'sente', 'sente', false)).toBe(false);
    expect(canPlayOnline('playing', 'sente', 'sente', true)).toBe(false);
    expect(canPlayOnline('error', 'sente', 'sente', false)).toBe(false);
  });
});
