import type { NetMessage, Transport } from './protocol';

export interface MemoryTransport extends Transport {
  disconnect(): void;
  reconnect(): void;
}
export interface MemoryRoom { connect(): MemoryTransport }

/** Two reserved seats. A temporary disconnect keeps its seat until leave(). */
export function createMemoryRoom(): MemoryRoom {
  const seats = new Set<Endpoint>();
  class Endpoint implements MemoryTransport {
    peer?: Endpoint;
    online = true;
    closed = false;
    epoch = 0;
    messages = new Set<(msg: unknown) => void>();
    joins = new Set<() => void>();
    leaves = new Set<() => void>();
    send(msg: NetMessage): void {
      const peer = this.peer;
      if (!peer || this.closed) return;
      const epoch = this.epoch;
      const copy = structuredClone(msg);
      queueMicrotask(() => {
        if (this.peer === peer && this.epoch === epoch && !peer.closed) {
          for (const fn of peer.messages) fn(structuredClone(copy));
        }
      });
    }
    onMessage(fn: (msg: unknown) => void): void { this.messages.add(fn); }
    onPeerJoin(fn: () => void): void { this.joins.add(fn); }
    onPeerLeave(fn: () => void): void { this.leaves.add(fn); }
    disconnect(): void {
      if (this.closed) return;
      this.online = false;
      const peer = this.peer;
      this.peer = undefined; this.epoch++;
      if (peer) {
        peer.peer = undefined; peer.epoch++;
        for (const endpoint of [this, peer]) queueMicrotask(() => {
          if (!endpoint.closed) for (const fn of endpoint.leaves) fn();
        });
      }
    }
    reconnect(): void {
      if (this.closed || !seats.has(this)) return;
      this.online = true; link();
    }
    leave(): void {
      this.disconnect(); this.closed = true; seats.delete(this);
      this.messages.clear(); this.joins.clear(); this.leaves.clear();
    }
  }
  function link(): void {
    const [a, b] = [...seats];
    if (!a || !b || !a.online || !b.online || a.peer) return;
    a.peer = b; b.peer = a;
    for (const endpoint of [a, b]) {
      const epoch = endpoint.epoch;
      queueMicrotask(() => {
        if (!endpoint.closed && endpoint.peer && endpoint.epoch === epoch) for (const fn of endpoint.joins) fn();
      });
    }
  }
  return {
    connect() {
      const endpoint = new Endpoint();
      if (seats.size >= 2) {
        endpoint.online = false;
        queueMicrotask(() => {
          if (!endpoint.closed) for (const fn of endpoint.messages) fn({ type: 'full' });
        });
      } else { seats.add(endpoint); link(); }
      return endpoint;
    },
  };
}

export function createMemoryPair(): [MemoryTransport, MemoryTransport] {
  const room = createMemoryRoom();
  return [room.connect(), room.connect()];
}
