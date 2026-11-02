import { describe, expect, it } from 'vitest';
import { acquireRoleLock } from '../../src/net/roleLock';
import { MemoryRoleLocks } from '../helpers/roleLocks';

const key = 'AAAAAAAAAAAAAAAAAAAAAA';
describe('tab role locks', () => {
  it('holds each room and role exclusively until released, then allows resuming', async () => {
    const locks = new MemoryRoleLocks();
    const host = await acquireRoleLock(key, 'host', locks);
    const guest = await acquireRoleLock(key, 'guest', locks);
    const otherRoom = await acquireRoleLock('BBBBBBBBBBBBBBBBBBBBBB', 'host', locks);
    expect(host).toBeTypeOf('function'); expect(guest).toBeTypeOf('function'); expect(otherRoom).toBeTypeOf('function');
    expect(await acquireRoleLock(key, 'host', locks)).toBeNull();
    expect(await acquireRoleLock(key, 'guest', locks)).toBeNull();
    host!(); host!();
    await Promise.resolve(); await Promise.resolve();
    const resumed = await acquireRoleLock(key, 'host', locks);
    expect(resumed).toBeTypeOf('function');
    resumed!(); guest!(); otherRoom!();
  });
  it('preserves the legacy behavior without Web Locks', async () => {
    // The node environment has no navigator.locks.
    const release = await acquireRoleLock(key, 'host');
    expect(release).toBeTypeOf('function'); release!();
  });
  it('propagates a request failure instead of silently allowing duplicate owners', async () => {
    await expect(acquireRoleLock(key, 'host', { request: async () => { throw Error('denied'); } })).rejects.toThrow('denied');
  });
});
