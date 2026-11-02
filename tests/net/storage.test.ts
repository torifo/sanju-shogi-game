import { describe, expect, it, vi } from 'vitest';
import { SANJU } from '../../src/core/config';
import { defaultAssignment } from '../../src/core/setup';
import { createMemoryPair, createMemoryRoom } from '../../src/net/memoryTransport';
import { commitHash, type NetMessage } from '../../src/net/protocol';
import { OnlineSession } from '../../src/net/session';
import { clearRoom, hasLegacyPublicRoom, loadRoom, saveRoom, type RoomStorage, type SavedRoom, type StorageLike } from '../../src/net/storage';

const key = 'AAAAAAAAAAAAAAAAAAAAAA';
const publicProofs = { sente: { salt: 'AAAAAAAAAAAAAAAAAAAAAA', hash: '8bf74bdd58e9012f58c94137573112160a64ec370cef13712f2b1fa3d8877a83' },
  gote: { salt: 'AAAAAAAAAAAAAAAAAAAAAA', hash: '8bf74bdd58e9012f58c94137573112160a64ec370cef13712f2b1fa3d8877a83' } };
const assignment = defaultAssignment(SANJU);
const empty: SavedRoom = { v: 2, role: 'host', myColor: null,
  sync: { layers: 3, reveals: null, undo: null, placements: null, moves: [] },
  setup: { assignment: null, salt: null, hash: null, peerHash: null } };
function store() {
  const data = new Map<string, string>();
  const raw: StorageLike = {
    getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: k => { data.delete(k); },
  };
  const adapter: RoomStorage = { load: (k, role) => loadRoom(k, raw, role), save: (k, v) => saveRoom(k, v, raw), clear: k => clearRoom(k, raw) };
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
    expect(data.has(`sanju-shogi:online:${key}:host`)).toBe(true);
    expect(loadRoom(key, raw)).toEqual(empty);
    const restored = loadRoom(key, raw)!; restored.role = 'guest';
    expect(loadRoom(key, raw)?.role).toBe('host');
    saveRoom('BBBBBBBBBBBBBBBBBBBBBB', empty, raw); clearRoom(key, raw);
    expect(loadRoom(key, raw)).toBeNull(); expect(data.size).toBe(1);
  });
  it('同じ部屋のhostとguestを別々に保存し、指定した役割だけ読み込む', () => {
    const { raw } = store(); const guest: SavedRoom = { ...empty, role: 'guest', myColor: 'gote' };
    saveRoom(key, empty, raw);
    expect(loadRoom(key, raw, 'guest')).toBeNull();
    saveRoom(key, guest, raw);
    expect(loadRoom(key, raw, 'host')).toEqual(empty); expect(loadRoom(key, raw, 'guest')).toEqual(guest);
    expect(loadRoom(key, raw)?.role).toBe('host');
    clearRoom(key, raw); expect(loadRoom(key, raw)).toBeNull();
  });
  it.each(['host', 'guest'] as const)('旧キーの%sを同じ役割のキーへ移行する', role => {
    const { raw, data } = store(); const saved = { ...empty, role };
    data.set(`sanju-shogi:online:${key}`, JSON.stringify(saved));
    expect(loadRoom(key, raw, role)).toEqual(saved);
    expect(data.has(`sanju-shogi:online:${key}`)).toBe(false);
    expect(JSON.parse(data.get(`sanju-shogi:online:${key}:${role}`)!)).toEqual(saved);
    expect(loadRoom(key, raw, role === 'host' ? 'guest' : 'host')).toBeNull();
  });
  it('移行時に新形式の保存を上書きせず、書込不能でも旧データを読み込む', () => {
    const { raw, data } = store(); const newer = { ...empty, myColor: 'sente' as const };
    data.set(`sanju-shogi:online:${key}`, JSON.stringify(empty)); saveRoom(key, newer, raw);
    expect(loadRoom(key, raw, 'host')).toEqual(newer);
    data.clear(); data.set(`sanju-shogi:online:${key}`, JSON.stringify(empty));
    const readOnly = { ...raw, setItem() { throw Error('quota'); } };
    expect(loadRoom(key, readOnly, 'host')).toEqual(empty);
    expect(data.has(`sanju-shogi:online:${key}`)).toBe(true);
  });
  it('使用不能・容量超過・不正JSON・非対応バージョンでも例外を出さない', () => {
    const broken = { getItem() { throw Error('denied'); }, setItem() { throw Error('quota'); }, removeItem() { throw Error('denied'); } };
    expect(() => saveRoom(key, empty, broken)).not.toThrow();
    expect(loadRoom(key, broken)).toBeNull(); expect(() => clearRoom(key, broken)).not.toThrow();
    const { raw, data } = store();
    for (const value of ['{bad', 'null', JSON.stringify({ ...empty, v: 99 }), JSON.stringify({ ...empty, role: 'bad' }),
      JSON.stringify({ ...empty, myColor: 'other' }), JSON.stringify({ ...empty, sync: { ...empty.sync, layers: 4 } }),
      JSON.stringify({ ...empty, setup: { ...empty.setup, hash: 'bad' } }),
      JSON.stringify({ ...empty, setup: { ...empty.setup, assignment, salt: null } }),
      JSON.stringify({ ...empty, sync: { layers: 3, reveals: publicProofs, undo: null, placements: { sente: assignment, gote: assignment }, moves: ['m:7,7,1>7,4,1'] } }),
    ]) { data.set(`sanju-shogi:online:${key}`, value); expect(loadRoom(key, raw)).toBeNull(); }
  });
  it('v1の未公開配置は移行し、証拠のない公開済み保存は変更せず拒否する', () => {
    const { raw, data } = store();
    const oldPrivate = { ...empty, v: 1, sync: { layers: 3, placements: null, moves: [] } };
    data.set(`sanju-shogi:online:${key}:host`, JSON.stringify(oldPrivate));
    expect(loadRoom(key, raw, 'host')).toEqual(empty);
    const oldPublic = JSON.stringify({ ...oldPrivate, myColor: 'sente',
      sync: { layers: 3, placements: { sente: assignment, gote: assignment }, moves: [] } });
    data.set(`sanju-shogi:online:${key}:host`, oldPublic);
    expect(loadRoom(key, raw, 'host')).toBeNull();
    expect(hasLegacyPublicRoom(key, 'host', raw)).toBe(true);
    expect(hasLegacyPublicRoom(key, 'guest', raw)).toBe(false);
    expect(data.get(`sanju-shogi:online:${key}:host`)).toBe(oldPublic);
  });
  it('localStorage未提供でもセッションを進められる', async () => {
    const pair = createMemoryPair();
    const host = new OnlineSession({ role: 'host', roomKey: key, config: SANJU, transport: pair[0] });
    const guest = new OnlineSession({ role: 'guest', roomKey: key, config: SANJU, transport: pair[1] });
    await vi.waitFor(() => expect(guest.status).toBe('placing'));
    host.dispose(); guest.dispose();
  });
  it('注入した保存先が異なる役割を返しても、指定された役割を上書きしない', async () => {
    const pair = createMemoryPair();
    const host = new OnlineSession({ role: 'host', hostColorChoice: 'sente', roomKey: key, config: SANJU, transport: pair[0], storage: null });
    const guest = new OnlineSession({ role: 'guest', roomKey: key, config: SANJU, transport: pair[1],
      storage: { load: () => empty, save() {}, clear() {} } });
    await vi.waitFor(() => expect(guest.status).toBe('placing'));
    expect(guest.role).toBe('guest'); expect(guest.myColor).toBe('gote'); host.dispose(); guest.dispose();
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
    const host = new OnlineSession({ role: 'host', hostColorChoice: 'gote', roomKey: key, config: SANJU, transport: replacement, storage: f.a.adapter });
    await vi.waitFor(() => expect(host.status).toBe('waiting-commit'));
    expect(host.role).toBe('host'); expect(host.myColor).toBe('sente');
    expect(f.a.adapter.load(key)?.setup?.salt).toBe(saved.setup?.salt);
    const hello = send.mock.calls.map(([msg]) => msg).find(m => m.type === 'hello');
    expect(hello).toEqual({ type: 'hello', protocol: 2, role: 'host', layers: 3, resume: { layers: 3, reveals: null, undo: null, placements: null, moves: [] } });
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
    f.pair[1].send({ type: 'sync', state: { layers: 3, reveals: publicProofs, undo: null, placements: { sente: assignment, gote: assignment }, moves: ['m:7,7,1>7,4,1'] } });
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
    const host = new OnlineSession({ role: 'host', roomKey: key, config: SANJU, transport: pair[0], storage: f.a.adapter });
    const guest = new OnlineSession({ role: 'guest', roomKey: key, config: SANJU, transport: pair[1], storage: f.b.adapter });
    const send = vi.spyOn(pair[0], 'send');
    await vi.waitFor(() => expect([host.status, guest.status]).toEqual(['ended', 'ended']));
    expect(host.game.phase).toEqual(expected); expect(host.game.position).toEqual(guest.game.position);
    expect(host.game.moves).toHaveLength(1);
    expect(send.mock.calls.some(([m]) => m.type === 'hello' && m.resume?.moves.length === 1)).toBe(true);
    host.game.undo(); expect(host.game.moves).toHaveLength(0);
    host.dispose(); guest.dispose();
  });
  it.each(['sync', 'reload-hello'] as const)('R1: %sでもcommit後の配置差し替えを拒否する', async path => {
    const f = await fixture();
    const original = f.pair[1].send.bind(f.pair[1]);
    vi.spyOn(f.pair[1], 'send').mockImplementation(msg => { if (msg.type !== 'reveal') original(msg); });
    await Promise.all([f.host.submitPlacement(assignment), f.guest.submitPlacement(assignment)]);
    await vi.waitFor(() => expect(f.guest.status).toBe('playing'));
    expect(f.host.game.phase.kind).toBe('placing');
    const state = f.b.adapter.load(key)!.sync;
    state.placements!.gote = Array<number>(20).fill(2);
    // Even a self-consistent replacement proof must match the previously pinned commit.
    state.reveals!.gote.hash = await commitHash(state.placements!.gote, state.reveals!.gote.salt);
    let host = f.host;
    if (path === 'sync') original({ type: 'sync', state });
    else {
      host.dispose(); await tick();
      vi.mocked(f.pair[1].send).mockImplementation(msg => original(msg.type === 'hello' ? { ...msg, resume: state } : msg));
      host = new OnlineSession({ role: 'host', roomKey: key, config: SANJU, transport: f.room.connect(), storage: f.a.adapter });
    }
    await vi.waitFor(() => expect([host.status, f.guest.status]).toEqual(['error', 'error']));
    expect(host.game.position).toBeNull(); host.dispose(); f.guest.dispose();
  });
  it.each(['salt', 'missing', 'null'] as const)('R1: syncの証拠不正（%s）を拒否する', async variant => {
    const f = await fixture();
    const original = f.pair[1].send.bind(f.pair[1]);
    vi.spyOn(f.pair[1], 'send').mockImplementation(msg => { if (msg.type !== 'reveal') original(msg); });
    await Promise.all([f.host.submitPlacement(assignment), f.guest.submitPlacement(assignment)]);
    await vi.waitFor(() => expect(f.guest.status).toBe('playing'));
    const state = f.b.adapter.load(key)!.sync;
    if (variant === 'salt') state.reveals!.gote.salt = key;
    else if (variant === 'null') state.reveals = null;
    else Reflect.deleteProperty(state, 'reveals');
    original({ type: 'sync', state });
    await vi.waitFor(() => expect(f.host.status).toBe('error'));
    expect(f.host.game.position).toBeNull(); f.host.dispose(); f.guest.dispose();
  });
  it.each([false, true])('R2: 承認通知が消えても取り消しと別の初手を保存・同期する（再読み込み=%s）', async reload => {
    const f = await fixture(); await start(f);
    f.host.play(f.host.game.legalMoves()[0]!);
    await vi.waitFor(() => expect(f.guest.game.moves).toHaveLength(1));
    f.guest.requestUndo(); await vi.waitFor(() => expect(f.host.pendingUndo?.direction).toBe('incoming'));
    const original = f.pair[0].send.bind(f.pair[0]); let reply!: NetMessage;
    vi.spyOn(f.pair[0], 'send').mockImplementation(msg => {
      if (msg.type === 'undo-reply') reply = msg; else if (msg.type !== 'move') original(msg);
    });
    f.host.replyUndo(true);
    expect(f.a.adapter.load(key)!.sync.undo?.epoch).toBe(1);
    expect(f.b.adapter.load(key)!.pendingUndo?.direction).toBe('outgoing');
    f.host.play(f.host.game.legalMoves()[1]!); // A different first move in the new generation.
    let host = f.host, guest = f.guest, pair = f.pair;
    if (reload) {
      host.dispose(); guest.dispose(); pair = createMemoryPair();
      host = new OnlineSession({ role: 'host', roomKey: key, config: SANJU, transport: pair[0], storage: f.a.adapter });
      guest = new OnlineSession({ role: 'guest', roomKey: key, config: SANJU, transport: pair[1], storage: f.b.adapter });
    } else { pair[0].disconnect(); await tick(); pair[0].reconnect(); }
    await vi.waitFor(() => expect([host.status, guest.status]).toEqual(['playing', 'playing']));
    await vi.waitFor(() => expect(guest.game.moves).toEqual(host.game.moves));
    expect(host.game.moves).toHaveLength(1); expect(guest.pendingUndo).toBeUndefined();
    pair[0].send(reply); await tick(); // A late delivery must not undo the replacement move.
    expect(guest.game.moves).toHaveLength(1);
    guest.requestUndo(); await vi.waitFor(() => expect(host.pendingUndo?.epoch).toBe(2)); host.replyUndo(true);
    // In the original fixture the send spy still drops replies; reconnect recovers that too.
    if (!reload) { pair[0].disconnect(); await tick(); pair[0].reconnect(); }
    await vi.waitFor(() => expect(guest.game.moves).toHaveLength(0));
    expect(f.a.adapter.load(key)!.sync.undo?.epoch).toBe(2);
    expect(f.b.adapter.load(key)!.sync.undo?.epoch).toBe(2);
    expect(guest.game.position).toEqual(host.game.position); host.dispose(); guest.dispose();
  });
  it('R2: 承認通知が消えた0手の棋譜を長い旧棋譜で上書きしない', async () => {
    const f = await fixture(); await start(f);
    f.host.play(f.host.game.legalMoves()[0]!); await vi.waitFor(() => expect(f.guest.game.moves).toHaveLength(1));
    f.guest.requestUndo(); await vi.waitFor(() => expect(f.host.pendingUndo).toBeDefined());
    const original = f.pair[0].send.bind(f.pair[0]);
    vi.spyOn(f.pair[0], 'send').mockImplementation(msg => { if (msg.type !== 'undo-reply') original(msg); });
    f.host.replyUndo(true); f.pair[0].disconnect(); await tick(); f.pair[0].reconnect();
    await vi.waitFor(() => expect([f.host.status, f.guest.status]).toEqual(['playing', 'playing']));
    await vi.waitFor(() => expect(f.guest.game.moves).toHaveLength(0));
    expect(f.host.game.moves).toHaveLength(0); expect(f.guest.game.position).toEqual(f.host.game.position);
    // Old-epoch moves cannot resurrect the removed move at the same ply.
    original({ type: 'move', epoch: 0, ply: 1, move: 'm:7,7,1>7,6,1' }); await tick();
    expect(f.guest.game.moves).toHaveLength(0); f.host.dispose(); f.guest.dispose();
  });
  it.each([0, 1].flatMap(ply => [false, true].map(dropped => ({ ply, dropped }))))('R4: 指し手と投了の行き違い（投了ply=$ply、配送失敗=$dropped）', async ({ ply, dropped }) => {
    const f = await fixture(); await start(f);
    if (ply === 1) {
      f.host.play(f.host.game.legalMoves()[0]!); await vi.waitFor(() => expect(f.guest.game.moves).toHaveLength(1));
    }
    const mover = ply === 0 ? f.host : f.guest, resigner = ply === 0 ? f.guest : f.host;
    const endpoint = f.pair[ply === 0 ? 1 : 0], original = endpoint.send.bind(endpoint);
    if (dropped) vi.spyOn(endpoint, 'send').mockImplementation(msg => { if (msg.type !== 'resign') original(msg); });
    mover.play(mover.game.legalMoves()[0]!); resigner.resign();
    if (dropped) { await tick(); f.pair[0].disconnect(); await tick(); f.pair[0].reconnect(); }
    await vi.waitFor(() => expect([f.host.status, f.guest.status]).toEqual(['ended', 'ended']));
    expect(f.host.game.moves).toHaveLength(ply); expect(f.guest.game.moves).toHaveLength(ply);
    expect(f.host.game.phase).toEqual(f.guest.game.phase);
    expect(f.host.game.position).toEqual(f.guest.game.position);
    expect(f.a.adapter.load(key)!.sync).toEqual(f.b.adapter.load(key)!.sync);
    f.host.dispose(); f.guest.dispose();
  });
  it.each(['sente', 'gote', 'random'] as const)('R6: 相手参加前の再読み込みでも作成時の色を維持する（%s）', async choice => {
    const room = createMemoryRoom(), storage = store();
    const rng = vi.spyOn(crypto, 'getRandomValues').mockImplementation(array => { (array as Uint8Array).fill(1); return array; });
    const first = new OnlineSession({ role: 'host', hostColorChoice: choice, roomKey: key, config: SANJU, transport: room.connect(), storage: storage.adapter });
    const color = first.myColor; expect(storage.adapter.load(key)!.myColor).toBe(color); first.dispose(); await tick();
    rng.mockImplementation(array => { (array as Uint8Array).fill(0); return array; });
    const host = new OnlineSession({ role: 'host', roomKey: key, config: SANJU, transport: room.connect(), storage: storage.adapter });
    const guest = new OnlineSession({ role: 'guest', roomKey: key, config: SANJU, transport: room.connect(), storage: null });
    await vi.waitFor(() => expect([host.status, guest.status]).toEqual(['placing', 'placing']));
    expect(host.myColor).toBe(color); expect(guest.myColor).not.toBe(color);
    host.dispose(); guest.dispose(); rng.mockRestore();
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
