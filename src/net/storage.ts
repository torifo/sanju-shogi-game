import { validateAssignment } from '../core/setup';
import type { Color } from '../core/types';
import {
  gameFromSync, hasKeys, isColor, isHash, isRecord, isSyncState, isToken, isPendingUndo,
  type PendingUndo, type Role, type SyncState,
} from './protocol';

export interface SetupState {
  assignment: number[] | null;
  salt: string | null;
  hash: string | null;
  peerHash: string | null;
}
export interface SavedRoom {
  v: 2;
  role: Role;
  myColor: Color | null;
  sync: SyncState;
  /** Public reveal evidence remains in sync after setup is omitted. */
  setup?: SetupState;
  pendingUndo?: PendingUndo;
}
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface RoomStorage {
  load(key: string, role?: Role): SavedRoom | null;
  save(key: string, state: SavedRoom): void;
  clear(key: string): void;
}
const prefix = 'sanju-shogi:online:';

export function isSavedRoom(raw: unknown): raw is SavedRoom {
  if (!isRecord(raw) || !hasKeys(raw, ['v', 'role', 'myColor', 'sync'], ['setup', 'pendingUndo']) || raw.v !== 2
    || (raw.role !== 'host' && raw.role !== 'guest') || (raw.myColor !== null && !isColor(raw.myColor))
    || !isSyncState(raw.sync) || (Object.hasOwn(raw, 'pendingUndo') && !isPendingUndo(raw.pendingUndo))) return false;
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
  try { (storage ?? globalThis.localStorage)?.setItem(`${prefix}${key}:${state.role}`, JSON.stringify(state)); } catch { /* Best effort. */ }
}
/** Without a role, prefer the host save when deciding how to enter an invitation. */
export function loadRoom(key: string, storage?: StorageLike, role?: Role): SavedRoom | null {
  try {
    const target = storage ?? globalThis.localStorage;
    const read = (name: string): SavedRoom | null => {
      try {
        const text = target?.getItem(name);
        let raw: unknown = text ? JSON.parse(text) : null;
        // A private v1 setup still contains all pinned commits and can be upgraded safely.
        // Public v1 saves discarded salts, so never manufacture evidence for them.
        if (isRecord(raw) && raw.v === 1 && isRecord(raw.sync) && raw.sync.placements === null) {
          raw = { ...raw, v: 2, sync: { ...raw.sync, reveals: null, undo: null } };
        }
        return isSavedRoom(raw) ? raw : null;
      } catch { return null; }
    };
    const legacy = read(prefix + key);
    if (legacy) {
      const name = `${prefix}${key}:${legacy.role}`;
      // A newer role-specific save wins. Never discard the old save if writing fails.
      try {
        if (read(name)?.role !== legacy.role) target?.setItem(name, JSON.stringify(legacy));
        target?.removeItem(prefix + key);
      } catch { /* Still restore the legacy save when storage is read-only. */ }
    }
    for (const candidate of role ? [role] : ['host', 'guest'] as const) {
      const saved = read(`${prefix}${key}:${candidate}`);
      if (saved?.role === candidate) return saved;
      if (legacy?.role === candidate) return legacy;
    }
    return null;
  } catch { return null; }
}
export function clearRoom(key: string, storage?: StorageLike): void {
  for (const suffix of ['', ':host', ':guest']) {
    try { (storage ?? globalThis.localStorage)?.removeItem(prefix + key + suffix); } catch { /* Best effort. */ }
  }
}
export const localRoomStorage: RoomStorage = {
  load: (key, role) => loadRoom(key, undefined, role), save: saveRoom, clear: clearRoom,
};

/** Keep unverifiable v1 games intact and tell the UI to refuse a fresh session over them. */
export function hasLegacyPublicRoom(key: string, role?: Role, storage?: StorageLike): boolean {
  try {
    const target = storage ?? globalThis.localStorage;
    return ['', ...(role ? [':' + role] : [':host', ':guest'])].some(suffix => {
      const text = target?.getItem(prefix + key + suffix);
      if (!text) return false;
      try {
        const raw: unknown = JSON.parse(text);
        return isRecord(raw) && raw.v === 1 && (!role || raw.role === role)
          && isRecord(raw.sync) && isRecord(raw.sync.placements);
      } catch { return false; }
    });
  } catch { return false; }
}
