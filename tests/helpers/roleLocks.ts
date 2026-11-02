import type { RoleLockManager } from '../../src/net/roleLock';

/** Origin-wide exclusive locks shared by simulated tabs. */
export class MemoryRoleLocks implements RoleLockManager {
  readonly held = new Set<string>();
  readonly requested: string[] = [];
  async request(name: string, _options: { ifAvailable: true }, callback: (lock: object | null) => Promise<void>): Promise<void> {
    this.requested.push(name);
    if (this.held.has(name)) { await callback(null); return; }
    this.held.add(name);
    try { await callback({ name }); }
    finally { this.held.delete(name); }
  }
}
