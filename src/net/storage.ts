import { validateAssignment } from '../core/setup';
import type { Color } from '../core/types';
import { gameFromSync, hasKeys, isColor, isHash, isRecord, isSyncState, isToken, type Role, type SyncState } from './protocol';

export interface SetupState {
  assignment: number[] | null;
  salt: string | null;
  hash: string | null;
  peerHash: string | null;
}
export interface SavedRoom {
  v: 1;
  role: Role;
  myColor: Color | null;
  sync: SyncState;
  /** Omitted after reveal; salts and private placements are no longer needed. */
  setup?: SetupState;
}
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface RoomStorage {
  load(key: string): SavedRoom | null;
  save(key: string, state: SavedRoom): void;
  clear(key: string): void;
}
const prefix = 'sanju-shogi:online:';

export function isSavedRoom(raw: unknown): raw is SavedRoom {
  if (!isRecord(raw) || !hasKeys(raw, ['v', 'role', 'myColor', 'sync'], ['setup']) || raw.v !== 1
    || (raw.role !== 'host' && raw.role !== 'guest') || (raw.myColor !== null && !isColor(raw.myColor))
    || !isSyncState(raw.sync)) return false;
  if (raw.sync.placements) {
    if (!isColor(raw.myColor) || Object.hasOwn(raw, 'setup')) return false;
  } else {
    const setup = raw.setup;
    if (!isRecord(setup) || !hasKeys(setup, ['assignment', 'salt', 'hash', 'peerHash'])
      || (setup.hash !== null && !isHash(setup.hash)) || (setup.peerHash !== null && !isHash(setup.peerHash))) return false;
    if (setup.assignment === null) {
      if (setup.salt !== null || setup.hash !== null) return false;
    } else if (!isColor(raw.myColor) || !Array.isArray(setup.assignment)
      || !validateAssignment({ files: 9, ranks: 9, layers: raw.sync.layers }, setup.assignment) || !isToken(setup.salt)) return false;
  }
  try { gameFromSync(raw.sync); return true; } catch { return false; }
}

/** Accessing globalThis.localStorage itself can throw (e.g. denied browser storage). */
export function saveRoom(key: string, state: SavedRoom, storage?: StorageLike): void {
  try { (storage ?? globalThis.localStorage)?.setItem(prefix + key, JSON.stringify(state)); } catch { /* Best effort. */ }
}
export function loadRoom(key: string, storage?: StorageLike): SavedRoom | null {
  try {
    const text = (storage ?? globalThis.localStorage)?.getItem(prefix + key);
    if (!text) return null;
    const raw: unknown = JSON.parse(text);
    return isSavedRoom(raw) ? raw : null;
  } catch { return null; }
}
export function clearRoom(key: string, storage?: StorageLike): void {
  try { (storage ?? globalThis.localStorage)?.removeItem(prefix + key); } catch { /* Best effort. */ }
}
export const localRoomStorage: RoomStorage = { load: loadRoom, save: saveRoom, clear: clearRoom };
