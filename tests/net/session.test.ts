import { describe, expect, it, vi } from 'vitest';
import { SANJU } from '../../src/core/config';
import { encodeMove } from '../../src/core/serialize';
import { defaultAssignment } from '../../src/core/setup';
import { createMemoryPair, createMemoryRoom } from '../../src/net/memoryTransport';
import { commitHash, type NetMessage, type Transport } from '../../src/net/protocol';
import { OnlineSession } from '../../src/net/session';

const key = 'AAAAAAAAAAAAAAAAAAAAAA';
const assignment = defaultAssignment(SANJU);
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function connected(hostColorChoice: 'sente' | 'gote' | 'random' = 'sente') {
  const pair = createMemoryPair();
  const host = new OnlineSession({ role: 'host', hostColorChoice, transport: pair[0], config: SANJU, roomKey: key, storage: null });
  const guest = new OnlineSession({ role: 'guest', transport: pair[1], config: SANJU, roomKey: key, storage: null });
  await vi.waitFor(() => expect([host.status, guest.status]).toEqual(['placing', 'placing']));
  return { host, guest, pair };
}
async function started() {
  const result = await connected();
  await Promise.all([result.host.submitPlacement(assignment), result.guest.submitPlacement(assignment)]);
  await vi.waitFor(() => expect([result.host.status, result.guest.status]).toEqual(['playing', 'playing']));
  return result;
}
async function oneMove(host: OnlineSession, guest: OnlineSession) {
  host.play(host.game.legalMoves()[0]!);
  await vi.waitFor(() => expect(guest.game.moves).toHaveLength(host.game.moves.length));
}

describe('偽Transport', () => {
  it('非同期配送・切断・再接続・leaveとデータのコピー', async () => {
    const [a, b] = createMemoryPair();
    const received = vi.fn(); const joined = vi.fn(); const left = vi.fn();
    b.onMessage(received); b.onPeerJoin(joined); b.onPeerLeave(left);
    await tick();
    const msg: NetMessage = { type: 'move', epoch: 0, ply: 1, move: 'm:7,7,1>7,6,1' };
    a.send(msg); msg.ply = 42;
    expect(received).not.toHaveBeenCalled();
    await tick(); expect(received).toHaveBeenCalledWith({ ...msg, ply: 1 });
    a.disconnect(); a.send({ type: 'full' }); await tick();
    expect(left).toHaveBeenCalledTimes(1); expect(received).toHaveBeenCalledTimes(1);
    a.reconnect(); await tick(); expect(joined).toHaveBeenCalledTimes(2);
    a.leave(); a.reconnect(); await tick(); expect(joined).toHaveBeenCalledTimes(2);
    b.leave();
  });
  it('3人目だけにfullを返し、最初の2人の対戦に参加させない', async () => {
    const room = createMemoryRoom();
    const a = room.connect(); const b = room.connect(); const c = room.connect();
    const receivedA = vi.fn(); const receivedB = vi.fn(); const receivedC = vi.fn();
    a.onMessage(receivedA); b.onMessage(receivedB); c.onMessage(receivedC);
    await tick(); expect(receivedC).toHaveBeenCalledWith({ type: 'full' });
    c.send({ type: 'resign', epoch: 0, ply: 0, color: 'sente' }); await tick();
    expect(receivedA).not.toHaveBeenCalled(); expect(receivedB).not.toHaveBeenCalled();
    a.send({ type: 'hello', protocol: 2, role: 'host', layers: 3 }); await tick();
    expect(receivedB).toHaveBeenCalledTimes(1); expect(receivedC).toHaveBeenCalledTimes(1);
    a.leave(); b.leave(); c.leave();
  });
});

describe('OnlineSession', () => {
  it.each(['host', 'guest'] as const)('helloで両者が%sなら役割の重複を伝えて中断する', async role => {
    const pair = createMemoryPair();
    const a = new OnlineSession({ role, transport: pair[0], config: SANJU, roomKey: key, storage: null });
    const b = new OnlineSession({ role, transport: pair[1], config: SANJU, roomKey: key, storage: null });
    await vi.waitFor(() => expect([a.status, b.status]).toEqual(['error', 'error']));
    expect(a.error).toBe('同じ役割の端末どうしがつながりました。招待リンクは作成者以外の人が開いてください');
    expect(b.error).toBe(a.error); a.dispose(); b.dispose();
  });
  it.each(['sente', 'gote', 'random'] as const)('接続と色の割り当て: %s', async choice => {
    const { host, guest } = await connected(choice);
    expect(host.myColor).not.toBe(guest.myColor);
    expect(['sente', 'gote']).toContain(host.myColor);
    if (choice !== 'random') expect(host.myColor).toBe(choice);
    host.dispose(); guest.dispose();
  });
  it('接続→秘密配置→公開→数手→投了。通知を解除できる', async () => {
    const { host, guest, pair } = await connected();
    const sent = vi.spyOn(pair[0], 'send');
    const listener = vi.fn(); const unsubscribe = host.subscribe(listener);
    await host.submitPlacement(assignment);
    await tick();
    expect(host.status).toBe('waiting-commit'); expect(host.game.position).toBeNull();
    expect(sent.mock.calls.some(([m]) => m.type === 'reveal')).toBe(false);
    expect(guest.game.placement('sente')).toBeNull();
    await guest.submitPlacement(assignment);
    await vi.waitFor(() => expect(host.status).toBe('playing'));
    await vi.waitFor(() => expect(guest.status).toBe('playing'));
    for (let i = 0; i < 4; i++) {
      const player = i % 2 ? guest : host; const other = i % 2 ? host : guest;
      player.play(player.game.legalMoves()[0]!);
      await vi.waitFor(() => expect(other.game.moves).toHaveLength(i + 1));
    }
    expect(guest.game.position).toEqual(host.game.position);
    guest.resign(); await vi.waitFor(() => expect(host.status).toBe('ended'));
    expect(host.game.phase).toEqual({ kind: 'ended', result: { kind: 'win', winner: 'sente', reason: 'resign' } });
    expect(listener).toHaveBeenCalled(); unsubscribe(); listener.mockClear(); host.dispose(); guest.dispose();
    expect(listener).not.toHaveBeenCalled();
  });
  it('公開のハッシュ不一致は両者を中断する', async () => {
    const { host, guest, pair } = await connected();
    const original = pair[1].send.bind(pair[1]);
    vi.spyOn(pair[1], 'send').mockImplementation(m => original(m.type === 'reveal' ? { ...m, salt: 'BBBBBBBBBBBBBBBBBBBBBB' } : m));
    await Promise.all([host.submitPlacement(assignment), guest.submitPlacement(assignment)]);
    await vi.waitFor(() => expect([host.status, guest.status]).toEqual(['error', 'error']));
    expect(host.error).toBe('対局の記録が食い違ったため中断しました');
    host.dispose(); guest.dispose();
  });
  it('早すぎるrevealを拒否し、自分の秘密配置は送らない', async () => {
    const { host, guest, pair } = await connected();
    const sent = vi.spyOn(pair[0], 'send');
    pair[1].send({ type: 'reveal', assignment, salt: key });
    await vi.waitFor(() => expect(host.status).toBe('error'));
    expect(sent.mock.calls.some(([m]) => m.type === 'reveal')).toBe(false);
    host.dispose(); guest.dispose();
  });
  it('ハッシュが正しくても現在の層数に対する不正配置は拒否する', async () => {
    const { host, guest, pair } = await connected();
    await host.submitPlacement(assignment);
    const invalid = Array<number>(20).fill(3);
    pair[1].send({ type: 'commit', hash: await commitHash(invalid, key) });
    pair[1].send({ type: 'reveal', assignment: invalid, salt: key });
    await vi.waitFor(() => expect([host.status, guest.status]).toEqual(['error', 'error']));
    expect(host.game.position).toBeNull(); host.dispose(); guest.dispose();
  });
  it('確定後の再配置と相手のcommit変更を拒否する', async () => {
    const { host, guest, pair } = await connected();
    const first = host.submitPlacement(assignment);
    await expect(host.submitPlacement(assignment)).rejects.toThrow(); await first;
    pair[1].send({ type: 'commit', hash: 'a'.repeat(64) });
    pair[1].send({ type: 'commit', hash: 'b'.repeat(64) });
    await vi.waitFor(() => expect(host.status).toBe('error')); host.dispose(); guest.dispose();
  });
  it('自分の手番以外の操作と不正な配置を拒否する', async () => {
    const { host, guest } = await connected();
    await expect(host.submitPlacement([])).rejects.toThrow();
    await Promise.all([host.submitPlacement(assignment), guest.submitPlacement(assignment)]);
    await vi.waitFor(() => expect(guest.status).toBe('playing'));
    expect(() => guest.play(host.game.legalMoves()[0]!)).toThrow();
    expect(() => host.play({ kind: 'drop', piece: 'P', to: { x: 5, y: 5, z: 1 } })).toThrow();
    expect(host.game.moves).toHaveLength(0); expect(host.status).toBe('playing');
    host.dispose(); guest.dispose();
  });
  it('受信した不正な手をcoreで検証して中断する', async () => {
    const { host, guest, pair } = await started();
    pair[0].send({ type: 'move', epoch: 0, ply: 1, move: 'm:7,7,1>7,4,1' });
    await vi.waitFor(() => expect([host.status, guest.status]).toEqual(['error', 'error']));
    expect(guest.game.moves).toHaveLength(0); host.dispose(); guest.dispose();
  });
  it('相手の番ではない手も中断する', async () => {
    const { host, guest, pair } = await started();
    pair[1].send({ type: 'move', epoch: 0, ply: 1, move: encodeMove(host.game.legalMoves()[0]!) });
    await vi.waitFor(() => expect(host.status).toBe('error')); host.dispose(); guest.dispose();
  });
  it('重複plyを捨て、飛んだplyはsync交換で回復する', async () => {
    const { host, guest, pair } = await started();
    const sent = vi.spyOn(pair[1], 'send');
    await oneMove(host, guest);
    pair[0].send({ type: 'move', epoch: 0, ply: 1, move: encodeMove(host.game.moves[0]!) });
    await tick(); expect(guest.game.moves).toHaveLength(1);
    pair[0].send({ type: 'move', epoch: 0, ply: 3, move: encodeMove(host.game.moves[0]!) });
    await tick();
    expect(sent.mock.calls.some(([m]) => m.type === 'sync')).toBe(true);
    expect(guest.status).toBe('playing'); expect(guest.game.moves).toHaveLength(1);
    host.dispose(); guest.dispose();
  });
  it.each([true, false])('待ったの返事: %s', async accepted => {
    const { host, guest } = await started();
    await oneMove(host, guest);
    host.requestUndo();
    await vi.waitFor(() => expect(guest.pendingUndo).toEqual(expect.objectContaining({ ply: 1, direction: 'incoming' })));
    expect(host.game.moves).toHaveLength(1);
    guest.replyUndo(accepted);
    await vi.waitFor(() => expect(host.pendingUndo).toBeUndefined());
    expect(host.game.moves).toHaveLength(accepted ? 0 : 1);
    expect(guest.game.position).toEqual(host.game.position);
    expect(guest.pendingUndo).toBeUndefined(); host.dispose(); guest.dispose();
  });
  it('同時の待ったではhostの申し入れを残し、古い返事を二度適用しない', async () => {
    const { host, guest, pair } = await started(); await oneMove(host, guest);
    host.requestUndo(); guest.requestUndo();
    await vi.waitFor(() => expect(guest.pendingUndo?.direction).toBe('incoming'));
    expect(host.pendingUndo?.direction).toBe('outgoing');
    const { direction: _, ...operation } = guest.pendingUndo!;
    guest.replyUndo(true);
    await vi.waitFor(() => expect(host.game.moves).toHaveLength(0));
    pair[1].send({ type: 'undo-reply', ...operation, accepted: true }); await tick();
    expect(host.game.moves).toHaveLength(0); expect(host.status).toBe('playing');
    expect(host.game.position).toEqual(guest.game.position); host.dispose(); guest.dispose();
  });
  it('R2: 拒否された操作の古い承認を同じply・世代の新しい申し入れに適用しない', async () => {
    const { host, guest, pair } = await started(); await oneMove(host, guest);
    host.requestUndo(); await vi.waitFor(() => expect(guest.pendingUndo?.direction).toBe('incoming'));
    const { direction: _, ...old } = guest.pendingUndo!;
    guest.replyUndo(false); await vi.waitFor(() => expect(host.pendingUndo).toBeUndefined());
    host.requestUndo(); await vi.waitFor(() => expect(guest.pendingUndo?.id).toBe(host.pendingUndo?.id));
    expect(host.pendingUndo!.id).not.toBe(old.id);
    pair[1].send({ type: 'undo-reply', ...old, accepted: true }); await tick();
    expect(host.game.moves).toHaveLength(1); expect(host.pendingUndo).toBeDefined();
    guest.replyUndo(true); await vi.waitFor(() => expect(host.game.moves).toHaveLength(0));
    expect(host.game.position).toEqual(guest.game.position); host.dispose(); guest.dispose();
  });
  it('3人目のセッションは満員の文言で停止する', async () => {
    const room = createMemoryRoom(); const a = room.connect(); const b = room.connect();
    const third = new OnlineSession({ role: 'guest', transport: room.connect(), config: SANJU, roomKey: key, storage: null });
    await vi.waitFor(() => expect(third.status).toBe('error'));
    expect(third.error).toBe('この部屋は満員です'); a.leave(); b.leave(); third.dispose();
  });
  it('形の違う入力と未要求のundo-replyを捨てる', async () => {
    const { host, guest, pair } = await started();
    await oneMove(host, guest);
    pair[1].send({ type: 'undo-reply', epoch: 1, id: 'AAAAAAAAAAAAAAAAAAAAAA', requester: 'host', ply: 1, accepted: true });
    pair[1].send({ type: 'move', epoch: 0, ply: '1' } as unknown as NetMessage);
    pair[1].send({ type: 'full', extra: true } as unknown as NetMessage);
    await tick(); expect(host.game.moves).toHaveLength(1); expect(host.status).toBe('playing');
    host.dispose(); guest.dispose();
  });
  it('protocol不一致は専用文言で停止する', async () => {
    const pair = createMemoryPair();
    const host = new OnlineSession({ role: 'host', transport: pair[0], config: SANJU, roomKey: key, storage: null });
    pair[1].onPeerJoin(() => pair[1].send({ type: 'hello', protocol: 1, role: 'guest', layers: 3, resume: { layers: 3, placements: null, moves: [] } } as unknown as NetMessage));
    await vi.waitFor(() => expect(host.status).toBe('error'));
    expect(host.error).toBe('相手のアプリのバージョンが違います。ページを再読み込みしてください');
    host.dispose(); pair[1].leave();
  });
  it('dispose後は受信・操作・通知を止める', async () => {
    const { host, guest, pair } = await started();
    const listener = vi.fn(); host.subscribe(listener); host.dispose();
    pair[1].send({ type: 'error', reason: 'late' }); await tick();
    expect(listener).not.toHaveBeenCalled(); expect(() => host.resign()).toThrow();
    expect(() => host.play(host.game.legalMoves()[0]!)).toThrow(); guest.dispose();
  });
  it('処理待ちのhelloが切断後に実行されてもerrorにしない', async () => {
    let receive!: (raw: unknown) => void; let join!: () => void; let leave!: () => void;
    const transport: Transport = {
      send: vi.fn(), onMessage: fn => { receive = fn; }, onPeerJoin: fn => { join = fn; },
      onPeerLeave: fn => { leave = fn; }, leave: vi.fn(),
    };
    const host = new OnlineSession({ role: 'host', transport, config: SANJU, roomKey: key, storage: null });
    join(); receive({ type: 'hello', protocol: 2, role: 'guest', layers: 3 }); leave();
    await tick(); expect(host.status).toBe('disconnected'); expect(host.error).toBeUndefined();
    join(); receive({ type: 'hello', protocol: 2, role: 'guest', layers: 3 });
    await vi.waitFor(() => expect(host.status).toBe('placing')); host.dispose();
  });
});
