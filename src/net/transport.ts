import { MAX_RECEIVE_BYTES, type NetMessage, type Role, type Transport } from './protocol';
import { roomNameFor } from './roomKey';
import type { JsonValue } from '@trystero-p2p/nostr';
export type { Transport } from './protocol';

export const ROOM_NOT_FOUND = '部屋が見つかりません。リンクが正しいか、相手が待機画面を開いているか確認してください。ネットワークによっては接続できないことがあります';
export const RELAY_UNAVAILABLE = '接続の仲介サーバーにつながりません';
export interface TransportOptions { role?: Role; onIssue?: (message: string) => void }

/** No network code is fetched until online play is entered. Trystero 0.26 object API. */
export async function createTrysteroTransport(roomKey: string, options: TransportOptions = {}): Promise<Transport> {
  const [{ joinRoom, getRelaySockets }, roomName] = await Promise.all([
    import('@trystero-p2p/nostr'), roomNameFor(roomKey),
  ]);
  const room = joinRoom({ appId: 'sanju-shogi-game', password: roomKey, maxReceiveBytes: MAX_RECEIVE_BYTES }, roomName);
  const action = room.makeAction('msg');
  let peer: string | null = null, closed = false, joined = false;
  let messageHandler: ((msg: unknown) => void) | undefined;
  let joinHandler: (() => void) | undefined, leaveHandler: (() => void) | undefined;
  let buffered: unknown[] = [];
  let issue = '';
  const started = Date.now();
  const report = (next: string): void => {
    if (!closed && next !== issue) { issue = next; options.onIssue?.(next); }
  };
  const sendTo = (msg: NetMessage, target: string): void => {
    // NetMessage contains JSON-only interfaces; TS interfaces lack JsonValue's index signature.
    try { void action.send(msg as unknown as JsonValue, { target }).catch(() => report('送信できませんでした。同じリンクを開き直して再接続してください。')); }
    catch { report('送信できませんでした。同じリンクを開き直して再接続してください。'); }
  };
  room.onPeerJoin = id => {
    if (closed || peer === id) return;
    if (peer !== null) { sendTo({ type: 'full' }, id); return; }
    peer = id; joined = true; report(''); joinHandler?.();
  };
  room.onPeerLeave = id => {
    if (closed || id !== peer) return;
    peer = null; buffered = []; leaveHandler?.();
  };
  action.onMessage = (data, { peerId }) => {
    if (closed || peerId !== peer) return;
    if (messageHandler) messageHandler(data);
    else if (buffered.length < 32) buffered.push(data);
  };
  // getRelaySockets is untyped in 0.26; inspect only the documented readyState.
  // A closed signaling socket does not invalidate an already connected data channel.
  const timer = setInterval(() => {
    if (peer || Date.now() - started < 20_000) return;
    const sockets = Object.values(getRelaySockets()) as { readyState: number }[];
    report(!sockets.some(socket => socket.readyState === 1) ? RELAY_UNAVAILABLE
      : !joined && options.role === 'guest' ? ROOM_NOT_FOUND : '');
  }, 1_000);
  return {
    send(msg) { if (!closed && peer) sendTo(msg, peer); },
    onMessage(fn) {
      messageHandler = fn;
      const pending = buffered; buffered = []; const id = peer;
      queueMicrotask(() => { if (!closed && id === peer) pending.forEach(fn); });
    },
    onPeerJoin(fn) {
      joinHandler = fn;
      const id = peer;
      if (id) queueMicrotask(() => { if (!closed && id === peer) fn(); });
    },
    onPeerLeave(fn) { leaveHandler = fn; },
    leave() {
      if (closed) return;
      closed = true; clearInterval(timer); buffered = []; peer = null;
      room.onPeerJoin = null; room.onPeerLeave = null; action.onMessage = null;
      messageHandler = undefined; joinHandler = undefined; leaveHandler = undefined;
      void room.leave().catch(() => { /* Leaving is best effort; no callbacks survive. */ });
    },
  };
}
