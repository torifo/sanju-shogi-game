import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageAction, Room } from '@trystero-p2p/nostr';
import { createTrysteroTransport, ROOM_NOT_FOUND, RELAY_UNAVAILABLE } from '../../src/net/transport';

const mock = vi.hoisted(() => ({ joinRoom: vi.fn(), getRelaySockets: vi.fn() }));
vi.mock('@trystero-p2p/nostr', () => mock);
let room: Room;
let action: MessageAction;
beforeEach(() => {
  vi.useFakeTimers(); mock.joinRoom.mockReset(); mock.getRelaySockets.mockReturnValue({ relay: { readyState: 1 } });
  action = { send: vi.fn().mockResolvedValue(undefined), onMessage: null, onReceive: null, onReceiveProgress: null };
  room = { makeAction: vi.fn(() => action), leave: vi.fn().mockResolvedValue(undefined), onPeerJoin: null, onPeerLeave: null } as unknown as Room;
  mock.joinRoom.mockReturnValue(room);
});
afterEach(() => vi.useRealTimers());
const key = 'AAAAAAAAAAAAAAAAAAAAAA';

describe('Trystero 0.26 adapter', () => {
  it('uses the installed object API, targets one peer, rejects others and filters their traffic', async () => {
    const transport = await createTrysteroTransport(key);
    const join = vi.fn(), leave = vi.fn(), receive = vi.fn();
    transport.onPeerJoin(join); transport.onPeerLeave(leave); transport.onMessage(receive);
    expect(mock.joinRoom).toHaveBeenCalledWith({ appId: 'sanju-shogi-game', password: key }, expect.stringMatching(/^[a-f0-9]{16}$/));
    expect(room.makeAction).toHaveBeenCalledWith('msg');
    room.onPeerJoin!('one'); transport.send({ type: 'commit', hash: 'a'.repeat(64) });
    expect(action.send).toHaveBeenLastCalledWith({ type: 'commit', hash: 'a'.repeat(64) }, { target: 'one' });
    room.onPeerJoin!('two');
    expect(action.send).toHaveBeenLastCalledWith({ type: 'full' }, { target: 'two' });
    action.onMessage!({ type: 'full' }, { peerId: 'two' });
    expect(receive).not.toHaveBeenCalled();
    action.onMessage!({ type: 'full' }, { peerId: 'one' });
    expect(receive).toHaveBeenCalledOnce(); expect(join).toHaveBeenCalledOnce();
    room.onPeerLeave!('two'); expect(leave).not.toHaveBeenCalled();
    room.onPeerLeave!('one'); expect(leave).toHaveBeenCalledOnce();
    // An already rejected peer cannot replace the original opponent after they leave.
    action.onMessage!({ type: 'hello' }, { peerId: 'two' });
    expect(receive).toHaveBeenCalledOnce();
    room.onPeerJoin!('new-one'); expect(join).toHaveBeenCalledTimes(2);
    transport.leave(); transport.leave();
    expect(room.leave).toHaveBeenCalledOnce(); expect(room.onPeerJoin).toBeNull(); expect(action.onMessage).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('buffers an early join/message until session listeners are installed', async () => {
    const transport = await createTrysteroTransport(key);
    room.onPeerJoin!('one'); action.onMessage!({ type: 'full' }, { peerId: 'one' });
    const join = vi.fn(), receive = vi.fn();
    transport.onPeerJoin(join); transport.onMessage(receive);
    await vi.advanceTimersByTimeAsync(0);
    expect(join).toHaveBeenCalledOnce(); expect(receive).toHaveBeenCalledOnce(); transport.leave();
  });
  it('reports guest timeout, distinguishes all relays unavailable, and accepts a late peer', async () => {
    const issue = vi.fn();
    const transport = await createTrysteroTransport(key, { role: 'guest', onIssue: issue });
    await vi.advanceTimersByTimeAsync(20_000); expect(issue).toHaveBeenLastCalledWith(ROOM_NOT_FOUND);
    mock.getRelaySockets.mockReturnValue({ relay: { readyState: 3 } });
    await vi.advanceTimersByTimeAsync(1_000); expect(issue).toHaveBeenLastCalledWith(RELAY_UNAVAILABLE);
    room.onPeerJoin!('late'); expect(issue).toHaveBeenLastCalledWith('');
    transport.leave();
  });
  it('does not time out a host waiting for an invitation to be opened', async () => {
    const issue = vi.fn(); const transport = await createTrysteroTransport(key, { role: 'host', onIssue: issue });
    await vi.advanceTimersByTimeAsync(25_000); expect(issue).not.toHaveBeenCalled(); transport.leave();
  });
  it('reports unavailable relays for a host but never interrupts an established peer', async () => {
    mock.getRelaySockets.mockReturnValue({});
    const issue = vi.fn(); const transport = await createTrysteroTransport(key, { role: 'host', onIssue: issue });
    await vi.advanceTimersByTimeAsync(20_000); expect(issue).toHaveBeenLastCalledWith(RELAY_UNAVAILABLE);
    room.onPeerJoin!('one'); expect(issue).toHaveBeenLastCalledWith(''); issue.mockClear();
    await vi.advanceTimersByTimeAsync(30_000); expect(issue).not.toHaveBeenCalled(); transport.leave();
  });
  it('does not replay buffered callbacks after leaving before listener microtasks run', async () => {
    const transport = await createTrysteroTransport(key);
    room.onPeerJoin!('one'); action.onMessage!({ type: 'full' }, { peerId: 'one' });
    const join = vi.fn(), receive = vi.fn(); transport.onPeerJoin(join); transport.onMessage(receive);
    transport.leave(); await vi.advanceTimersByTimeAsync(0);
    expect(join).not.toHaveBeenCalled(); expect(receive).not.toHaveBeenCalled();
  });
  it('handles rejected send and leave promises without an unhandled rejection', async () => {
    const issue = vi.fn(); const transport = await createTrysteroTransport(key, { onIssue: issue });
    room.onPeerJoin!('one'); vi.mocked(action.send).mockRejectedValueOnce(new Error('closed'));
    transport.send({ type: 'full' }); await Promise.resolve(); expect(issue).toHaveBeenCalled();
    vi.mocked(room.leave).mockRejectedValueOnce(new Error('closed')); transport.leave(); await Promise.resolve();
  });
});
