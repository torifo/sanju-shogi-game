import type { Role } from './protocol';

/** Small injectable subset of Web Locks; no browser dependency in tests. */
export interface RoleLockManager {
  request(name: string, options: { ifAvailable: true }, callback: (lock: object | null) => Promise<void>): Promise<void>;
}
export type ReleaseRoleLock = () => void;
export const ROOM_OPEN_IN_ANOTHER_TAB = 'この部屋はこのブラウザの別のタブで開かれています';

/** Resolve as soon as acquired, but keep the callback pending until the UI disposes. */
export function acquireRoleLock(
  key: string, role: Role, locks: RoleLockManager | undefined = globalThis.navigator?.locks,
): Promise<ReleaseRoleLock | null> {
  if (!locks) return Promise.resolve(() => {});
  return new Promise((resolve, reject) => {
    void locks.request(`sanju-shogi:${key}:${role}`, { ifAvailable: true }, async lock => {
      if (!lock) { resolve(null); return; }
      await new Promise<void>(release => { resolve(release); });
    }).catch(reject);
  });
}
