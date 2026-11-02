import type { Color } from '../core/types';
import type { Role } from '../net/protocol';
import { readRoomKey } from '../net/roomKey';
import type { OnlineStatus } from '../net/session';

export function onlineEntry(hash: string, saved: { role: Role; layers: number } | null):
  { kind: 'title' } | { kind: 'invalid' } | { kind: 'room'; roomKey: string; role: Role; layers: number } {
  if (!hash.startsWith('#room=')) return { kind: 'title' };
  const roomKey = readRoomKey(hash);
  return roomKey ? { kind: 'room', roomKey, role: saved?.role ?? 'guest', layers: saved?.layers ?? 3 } : { kind: 'invalid' };
}
export function onlineBoardScreen(phase: 'placing' | 'playing' | 'ended', myColor: Color | null): 'lobby' | 'placement' | 'game' {
  return !myColor ? 'lobby' : phase === 'placing' ? 'placement' : 'game';
}
export function canPlayOnline(status: OnlineStatus, myColor: Color | null, turn: Color | undefined, pendingUndo: boolean): boolean {
  return status === 'playing' && myColor !== null && turn === myColor && !pendingUndo;
}
