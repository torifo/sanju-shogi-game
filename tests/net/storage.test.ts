import { describe, expect, it, vi } from 'vitest';
import { SANJU } from '../../src/core/config';
import { defaultAssignment } from '../../src/core/setup';
import { createMemoryPair, createMemoryRoom } from '../../src/net/memoryTransport';
import type { NetMessage } from '../../src/net/protocol';
import { OnlineSession } from '../../src/net/session';
import { clearRoom, loadRoom, saveRoom, type RoomStorage, type SavedRoom, type StorageLike } from '../../src/net/storage';

const key = 'AAAAAAAAAAAAAAAAAAAAAA';
const assignment = defaultAssignment(SANJU);
const empty: SavedRoom = { v: 1, role: 'host', myColor: null,
  sync: { layers: 3, placements: null, moves: [] },
  setup: { assignment: null, salt: null, hash: null, peerHash: null } };
function store() {
  const data = new Map<string, string>();
  const raw: StorageLike = {
    getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: k => { data.delete(k); },
  };
  const adapter: RoomStorage = { load: k => loadRoom(k, raw), save: (k, v) => saveRoom(k, v, raw), clear: k => clearRoom(k, raw) };
  return { data, raw, adapter };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
async function fixture() {
  const room = createMemoryRoom(); const pair = [room.connect(), room.connect()] as const;
  const a = store(); const b = store();
  const host = new OnlineSession({ role: 'host', hostColorChoice: 'sente', roomKey: key, config: SANJU, transport: pair[0], storage: a.adapter });
  const guest = new OnlineSession({ role: 'guest', roomKey: key, config: SANJU, transport: pair[1], storage: b.adapter });
  await vi.waitFor(() => expect(guest.status).toBe('placing'));
  return { host, guest, pair, room, a, b };
}
async function start(f: Awaited<ReturnType<typeof fixture>>) {
  await Promise.all([f.host.submitPlacement(assignment), f.guest.submitPlacement(assignment)]);
  await vi.waitFor(() => expect([f.host.status, f.guest.status]).toEqual(['playing', 'playing']));
}

describe('部屋の保存', () => {
  it('部屋ごとのキーで保存・読み込み・削除し、コピーを返す', () => {
    const { raw, data } = store();
    saveRoom(key, empty, raw);
    expect(data.has(`sanju-shogi:online:${key}`)).toBe(true);
    expect(loadRoom(key, raw)).toEqual(empty);
    const restored = loadRoom(key, raw)!; restored.role = 'guest';
    expect(loadRoom(key, raw)?.role).toBe('host');
    saveRoom('BBBBBBBBBBBBBBBBBBBBBB', empty, raw); clearRoom(key, raw);
    expect(loadRoom(key, raw)).toBeNull(); expect(data.size).toBe(1);
  });
  it('使用不能・容量超過・不正JSON・非対応バージョンでも例外を出さない', () => {
    const broken = { getItem() { throw Error('denied'); }, setItem() { throw Error('quota'); }, removeItem() { throw Error('denied'); } };
    expect(() => saveRoom(key, empty, broken)).not.toThrow();
    expect(loadRoom(key, broken)).toBeNull(); expect(() => clearRoom(key, broken)).not.toThrow();
    const { raw, data } = store();
    for (const value of ['{bad', 'null', JSON.stringify({ ...empty, v: 2 }), JSON.stringify({ ...empty, role: 'bad' }),
      JSON.stringify({ ...empty, myColor: 'other' }), JSON.stringify({ ...empty, sync: { ...empty.sync, layers: 4 } }),
      JSON.stringify({ ...empty, setup: { ...empty.setup, hash: 'bad' } }),
      JSON.stringify({ ...empty, setup: { ...empty.setup, assignment, salt: null } }),
      JSON.stringify({ ...empty, sync: { layers: 3, placements: { sente: assignment, gote: assignment }, moves: ['m:7,7,1>7,4,1'] } }),
    ]) { data.set(`sanju-shogi:online:${key}`, value); expect(loadRoom(key, raw)).toBeNull(); }
  });
  it('localStorage未提供でもセッションを進められる', async () => {
    const pair = createMemoryPair();
    const host = new OnlineSession({ role: 'host', roomKey: key, config: SANJU, transport: pair[0] });
    const guest = new OnlineSession({ role: 'guest', roomKey: key, config: SANJU, transport: pair[1] });
    await vi.waitFor(() => expect(guest.status).toBe('placing'));
    host.dispose(); guest.dispose();
  });
});

describe('切断と再開', () => {
  it('配置確定後に再読み込みし、同じsalt/commitを再送して続行する（helloには秘密を含めない）', async () => {
    const f = await fixture();
    await f.host.submitPlacement(assignment); await tick();
    const saved = f.a.adapter.load(key)!;
    expect(saved.setup?.assignment).toEqual(assignment); expect(saved.setup?.hash).toMatch(/^[a-f0-9]{64}$/);
    f.host.dispose(); await vi.waitFor(() => expect(f.guest.status).toBe('disconnected'));
    const replacement = f.room.connect(); const send = vi.spyOn(replacement, 'send');
    const host = new OnlineSession({ role: 'guest', hostColorChoice: 'gote', roomKey: key, config: SANJU, transport: replacement, storage: f.a.adapter });
    await vi.waitFor(() => expect(host.status).toBe('waiting-commit'));
    expect(host.role).toBe('host'); expect(host.myColor).toBe('sente');
    expect(f.a.adapter.load(key)?.setup?.salt).toBe(saved.setup?.salt);
    const hello = send.mock.calls.map(([msg]) => msg).find(m => m.type === 'hello');
    expect(hello).toEqual({ type: 'hello', protocol: 1, role: 'host', layers: 3, resume: { layers: 3, placements: null, moves: [] } });
    await f.guest.submitPlacement(assignment);
    await vi.waitFor(() => expect([host.status, f.guest.status]).toEqual(['playing', 'playing']));
    expect(f.a.adapter.load(key)?.setup).toBeUndefined(); expect(f.b.adapter.load(key)?.setup).toBeUndefined();
    host.dispose(); f.guest.dispose();
  });
  it('相手のcommitだけを受けた未確定端末も復元する', async () => {
    const f = await fixture(); await f.host.submitPlacement(assignment); await tick();
    expect(f.b.adapter.load(key)?.setup?.peerHash).toBe(f.a.adapter.load(key)?.setup?.hash);
    f.guest.dispose(); await tick();
    const guest = new OnlineSession({ role: 'guest', roomKey: key, config: SANJU, transport: f.room.connect(), storage: f.b.adapter });
    await vi.waitFor(() => expect(guest.status).toBe('placing'));
    await guest.submitPlacement(assignment);
    await vi.waitFor(() => expect([f.host.status, guest.status]).toEqual(['playing', 'playing']));
    f.host.dispose(); guest.dispose();
  });
  it('ダイジェスト完了前の保存も、再計算して配置を続けられる', async () => {
    const f = await fixture(); await f.host.submitPlacement(assignment); await tick();
    const saved = f.a.adapter.load(key)!; saved.setup!.hash = null; f.a.adapter.save(key, saved);
    f.host.dispose(); await tick();
    const host = new OnlineSession({ role: 'host', roomKey: key, config: SANJU, transport: f.room.connect(), storage: f.a.adapter });
    await vi.waitFor(() => expect(host.status).toBe('waiting-commit'));
    await f.guest.submitPlacement(assignment);
    await vi.waitFor(() => expect([host.status, f.guest.status]).toEqual(['playing', 'playing']));
    host.dispose(); f.guest.dispose();
  });
  it.each([false, true])('切断中の1手を保存し、再接続で長い棋譜を採用する（再読み込み=%s）', async reload => {
    const f = await fixture(); await start(f);
    f.pair[0].disconnect(); await vi.waitFor(() => expect(f.host.status).toBe('disconnected'));
    f.host.play(f.host.game.legalMoves()[0]!);
    expect(f.a.adapter.load(key)?.sync.moves).toHaveLength(1); expect(f.guest.game.moves).toHaveLength(0);
    let guest = f.guest;
    if (reload) {
      f.guest.dispose();
      guest = new OnlineSession({ role: 'guest', roomKey: key, config: SANJU, transport: f.room.connect(), storage: f.b.adapter });
    }
    f.pair[0].reconnect();
    await vi.waitFor(() => expect([f.host.status, guest.status]).toEqual(['playing', 'playing']));
    await vi.waitFor(() => expect(guest.game.moves).toHaveLength(1));
    expect(guest.game.position).toEqual(f.host.game.position);
    expect(f.b.adapter.load(key)?.sync.moves).toHaveLength(1);
    f.host.dispose(); guest.dispose();
  });
  it('再接続時の棋譜の不一致を双方で中断する', async () => {
    const f = await fixture(); await start(f);
    f.pair[0].disconnect(); await vi.waitFor(() => expect(f.host.status).toBe('disconnected'));
    f.host.play(f.host.game.legalMoves()[0]!);
    // A legitimately replayable but different persisted line from another endpoint.
    f.guest.game.play(f.guest.game.legalMoves()[1]!);
    f.pair[0].reconnect();
    await vi.waitFor(() => expect([f.host.status, f.guest.status]).toEqual(['error', 'error']));
    expect(f.host.error).toBe('対局の記録が食い違っています'); f.host.dispose(); f.guest.dispose();
  });
  it('不正なsyncの棋譜を採用しない', async () => {
    const f = await fixture(); await start(f);
    f.pair[1].send({ type: 'sync', state: { layers: 3, placements: { sente: assignment, gote: assignment }, moves: ['m:7,7,1>7,4,1'] } });
    await vi.waitFor(() => expect(f.host.status).toBe('error'));
    expect(f.host.game.moves).toHaveLength(0); f.host.dispose(); f.guest.dispose();
  });
  it('配置公開の配送途中の切断から、公開済み側の状態を採用して回復する', async () => {
    const f = await fixture();
    const original = f.pair[0].send.bind(f.pair[0]);
    vi.spyOn(f.pair[0], 'send').mockImplementation((msg: NetMessage) => { if (msg.type !== 'reveal') original(msg); });
    await Promise.all([f.host.submitPlacement(assignment), f.guest.submitPlacement(assignment)]);
    await vi.waitFor(() => expect(f.host.status).toBe('playing'));
    expect(f.guest.game.phase.kind).toBe('placing');
    f.pair[0].disconnect(); await tick(); f.pair[0].reconnect();
    await vi.waitFor(() => expect([f.host.status, f.guest.status]).toEqual(['playing', 'playing']));
    expect(f.host.game.position).toEqual(f.guest.game.position); f.host.dispose(); f.guest.dispose();
  });
  it('切断中の投了を保存し、相手にも結果を反映する', async () => {
    const f = await fixture(); await start(f);
    f.pair[0].disconnect(); await tick(); f.host.resign();
    expect(f.a.adapter.load(key)?.sync.result).toEqual({ kind: 'win', winner: 'gote', reason: 'resign' });
    f.pair[0].reconnect(); await vi.waitFor(() => expect([f.host.status, f.guest.status]).toEqual(['ended', 'ended']));
    expect(f.host.game.phase).toEqual(f.guest.game.phase); f.host.dispose(); f.guest.dispose();
  });
  it('両端末を再生成しても棋譜・局面・結果が復元され、undo履歴も残る', async () => {
    const f = await fixture(); await start(f);
    f.host.play(f.host.game.legalMoves()[0]!);
    await vi.waitFor(() => expect(f.guest.game.moves).toHaveLength(1));
    f.guest.resign(); await vi.waitFor(() => expect(f.host.status).toBe('ended'));
    const expected = structuredClone(f.host.game.phase);
    f.host.dispose(); f.guest.dispose();
    const pair = createMemoryPair();
    const host = new OnlineSession({ role: 'guest', roomKey: key, config: SANJU, transport: pair[0], storage: f.a.adapter });
    const guest = new OnlineSession({ role: 'host', roomKey: key, config: SANJU, transport: pair[1], storage: f.b.adapter });
    const send = vi.spyOn(pair[0], 'send');
    await vi.waitFor(() => expect([host.status, guest.status]).toEqual(['ended', 'ended']));
    expect(host.game.phase).toEqual(expected); expect(host.game.position).toEqual(guest.game.position);
    expect(host.game.moves).toHaveLength(1);
    expect(send.mock.calls.some(([m]) => m.type === 'hello' && m.resume?.moves.length === 1)).toBe(true);
    host.game.undo(); expect(host.game.moves).toHaveLength(0);
    host.dispose(); guest.dispose();
  });
  it('外部storageアダプタが例外を出しても対局を続行する', async () => {
    const pair = createMemoryPair();
    const broken: RoomStorage = { load() { throw Error('denied'); }, save() { throw Error('quota'); }, clear() { throw Error('denied'); } };
    const host = new OnlineSession({ role: 'host', roomKey: key, config: SANJU, transport: pair[0], storage: broken });
    const guest = new OnlineSession({ role: 'guest', roomKey: key, config: SANJU, transport: pair[1], storage: broken });
    await vi.waitFor(() => expect(guest.status).toBe('placing'));
    host.dispose(); guest.dispose();
  });
});
