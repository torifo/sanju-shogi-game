import type { BoardConfig } from '../core/config';
import { Game } from '../core/game';
import { decodeMove, encodeMove } from '../core/serialize';
import { validateAssignment } from '../core/setup';
import { opposite, type Color, type Move } from '../core/types';
import { commitHash, gameFromSync, isLayers, isToken, mergeSync, parseMessage, randomSalt, type NetMessage, type Role, type SyncState, type Transport } from './protocol';
import { isSavedRoom, localRoomStorage, type RoomStorage, type SavedRoom } from './storage';

export type OnlineStatus = 'waiting' | 'connected' | 'placing' | 'waiting-commit' | 'revealing' | 'playing' | 'ended' | 'disconnected' | 'error';
export interface PendingUndo { ply: number; direction: 'incoming' | 'outgoing' }
export interface OnlineSessionOptions {
  role: Role;
  roomKey: string;
  hostColorChoice?: Color | 'random';
  transport: Transport;
  config: BoardConfig;
  /** undefined uses localStorage; null explicitly disables persistence. */
  storage?: RoomStorage | null;
}

const MISMATCH = '対局の記録が食い違ったため中断しました';
const CONFLICT = '対局の記録が食い違っています';
const VERSION = '相手のアプリのバージョンが違います。ページを再読み込みしてください';

/** DOM-free session. Subscribe to the session, and read game again after every notification. */
export class OnlineSession {
  readonly role: Role;
  status: OnlineStatus = 'waiting';
  myColor: Color | null = null;
  game: Game;
  error?: string;
  pendingUndo?: PendingUndo;
  private readonly transport: Transport;
  private readonly hostColorChoice: Color | 'random';
  private readonly roomKey: string;
  private readonly storage: RoomStorage | null;
  private readonly listeners = new Set<() => void>();
  private connected = false;
  private connectionEpoch = 0;
  private greeted = false;
  private disposed = false;
  private assignment: number[] | null = null;
  private salt: string | null = null;
  private hash: string | null = null;
  private peerHash: string | null = null;
  private revealSent = false;
  private queue = Promise.resolve();
  private deferredSync?: SyncState;

  constructor(options: OnlineSessionOptions) {
    if (!isToken(options.roomKey) || !isLayers(options.config.layers)) throw new Error('部屋のキーまたは層数が不正です');
    this.roomKey = options.roomKey;
    this.storage = options.storage === undefined ? localRoomStorage : options.storage;
    let saved: SavedRoom | null = null;
    try {
      const raw = this.storage?.load(this.roomKey, options.role);
      if (isSavedRoom(raw) && raw.role === options.role) saved = structuredClone(raw);
    } catch { /* Storage must never prevent a game. */ }
    if (saved && saved.sync.layers !== options.config.layers) throw new Error('保存された部屋の層数が異なります');
    this.role = options.role;
    this.transport = options.transport;
    this.hostColorChoice = options.hostColorChoice ?? 'random';
    this.game = saved ? gameFromSync(saved.sync) : new Game(options.config);
    if (saved) {
      this.myColor = saved.myColor;
      if (saved.setup) {
        this.assignment = saved.setup.assignment; this.salt = saved.setup.salt;
        this.hash = saved.setup.hash; this.peerHash = saved.setup.peerHash;
      }
      // Recover even if a reload interrupted the first digest before it was persisted.
      if (this.assignment && this.salt && !this.hash) {
        this.queue = commitHash(this.assignment, this.salt).then(hash => {
          if (this.stopped()) return;
          this.hash = hash; this.send({ type: 'commit', hash }); this.advancePlacement();
        });
      }
    }
    this.transport.onPeerJoin(() => {
      if (this.stopped()) return;
      this.connectionEpoch++;
      this.connected = true; this.greeted = false; this.revealSent = false;
      this.status = 'connected'; this.changed();
      this.send({ type: 'hello', protocol: 1, role: this.role, layers: this.game.config.layers, resume: this.syncState() });
    });
    this.transport.onPeerLeave(() => {
      if (this.stopped()) return;
      this.connectionEpoch++;
      this.connected = false; this.greeted = false; this.pendingUndo = undefined;
      this.status = 'disconnected'; this.changed();
    });
    this.transport.onMessage(raw => {
      const msg = parseMessage(raw);
      if (!msg || this.stopped()) return;
      const epoch = this.connectionEpoch;
      // Web Crypto is async; preserve wire order while checking a reveal.
      this.queue = this.queue.then(async () => {
        if (!this.stopped() && epoch === this.connectionEpoch) await this.receive(msg, epoch);
      }).catch(() => { if (!this.stopped() && epoch === this.connectionEpoch) this.fail(MISMATCH); });
    });
    this.persist();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  async submitPlacement(assignment: readonly number[]): Promise<void> {
    this.ensureActive();
    if (!this.myColor || !['placing', 'disconnected'].includes(this.status) || this.assignment
      || this.game.phase.kind !== 'placing' || !validateAssignment(this.game.config, assignment)) throw new Error('配置を確定できません');
    this.assignment = [...assignment]; this.salt = randomSalt();
    this.updateStatus(); this.changed();
    const hash = await commitHash(this.assignment, this.salt);
    if (this.stopped()) return;
    this.hash = hash;
    this.send({ type: 'commit', hash });
    this.advancePlacement();
  }

  play(move: Move): void {
    this.ensurePlaying();
    if (this.pendingUndo || this.game.position?.sideToMove !== this.myColor) throw new Error('自分の手番ではありません');
    this.game.play(move);
    this.send({ type: 'move', ply: this.game.moves.length, move: encodeMove(move) });
    this.updateStatus(); this.changed();
  }

  requestUndo(): void {
    this.ensurePlaying();
    if (!this.connected || !this.greeted || this.pendingUndo || this.game.moves.length === 0) throw new Error('待ったを申し込めません');
    this.pendingUndo = { ply: this.game.moves.length, direction: 'outgoing' };
    this.send({ type: 'undo-request', ply: this.pendingUndo.ply }); this.changed();
  }

  replyUndo(accepted: boolean): void {
    this.ensurePlaying();
    const pending = this.pendingUndo;
    if (!this.connected || !pending || pending.direction !== 'incoming' || pending.ply !== this.game.moves.length) throw new Error('待ったの申し入れがありません');
    if (accepted) this.game.undo();
    this.pendingUndo = undefined;
    this.send({ type: 'undo-reply', ply: pending.ply, accepted }); this.changed();
  }

  resign(): void {
    this.ensurePlaying();
    this.game.resign(this.myColor!); this.pendingUndo = undefined;
    this.send({ type: 'resign', color: this.myColor! }); this.updateStatus(); this.changed();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.listeners.clear(); this.transport.leave();
  }

  private async receive(msg: NetMessage, epoch: number): Promise<void> {
    if (msg.type === 'full') { this.fail('この部屋は満員です', false); return; }
    if (msg.type === 'error') { this.fail(msg.reason, false); return; }
    if (msg.type === 'hello') {
      if (msg.protocol !== 1) { this.fail(VERSION); return; }
      if (msg.role === this.role) {
        this.fail('同じ役割の端末どうしがつながりました。招待リンクは作成者以外の人が開いてください'); return;
      }
      if (!this.connected || msg.layers !== this.game.config.layers) { this.fail(MISMATCH); return; }
      this.greeted = true;
      if (this.role === 'host') {
        this.myColor ??= this.hostColorChoice === 'random'
          ? (crypto.getRandomValues(new Uint8Array(1))[0]! % 2 ? 'sente' : 'gote') : this.hostColorChoice;
        this.send({ type: 'assign', hostColor: this.myColor });
      }
      if (msg.resume) {
        if (this.myColor) this.reconcile(msg.resume);
        else this.deferredSync = msg.resume;
      }
      if (this.stopped()) return;
      if (this.hash) this.send({ type: 'commit', hash: this.hash });
      this.advancePlacement();
      return;
    }
    if (!this.connected || !this.greeted) return;
    if (msg.type === 'assign') {
      if (this.role !== 'guest' || (this.myColor && this.myColor !== opposite(msg.hostColor))) { this.fail(MISMATCH); return; }
      this.myColor = opposite(msg.hostColor);
      if (this.deferredSync) { this.reconcile(this.deferredSync); this.deferredSync = undefined; }
      if (!this.stopped()) this.advancePlacement();
      return;
    }
    if (!this.myColor) return;
    switch (msg.type) {
      case 'commit':
        if (this.game.phase.kind !== 'placing') return;
        if (this.peerHash && this.peerHash !== msg.hash.toLowerCase()) { this.fail(MISMATCH); return; }
        this.peerHash = msg.hash.toLowerCase(); this.advancePlacement(); break;
      case 'reveal': {
        if (this.game.phase.kind !== 'placing') return;
        if (!this.hash || !this.peerHash || !this.assignment || !this.salt
          || !validateAssignment(this.game.config, msg.assignment)) { this.fail(MISMATCH); return; }
        const hash = await commitHash(msg.assignment, msg.salt);
        if (this.stopped() || epoch !== this.connectionEpoch) return;
        if (hash !== this.peerHash) { this.fail(MISMATCH); return; }
        const placements = this.myColor === 'sente'
          ? { sente: this.assignment, gote: msg.assignment } : { sente: msg.assignment, gote: this.assignment };
        this.game = gameFromSync({ layers: this.game.config.layers, placements, moves: [] });
        this.clearSecrets(); this.updateStatus(); this.changed(); break;
      }
      case 'move':
        if (msg.ply <= this.game.moves.length) return;
        if (msg.ply !== this.game.moves.length + 1) { this.sendSync(); return; }
        if (this.game.phase.kind !== 'playing' || this.game.position?.sideToMove === this.myColor) { this.fail(MISMATCH); return; }
        this.game.play(decodeMove(msg.move)); this.pendingUndo = undefined;
        this.updateStatus(); this.changed(); break;
      case 'undo-request':
        if (this.game.phase.kind !== 'playing' || this.game.moves.length === 0 || msg.ply !== this.game.moves.length) return;
        if (this.pendingUndo?.direction === 'outgoing') {
          // A host request wins a simultaneous request on both endpoints.
          if (this.role === 'host') return;
        }
        this.pendingUndo = { ply: msg.ply, direction: 'incoming' }; this.changed(); break;
      case 'undo-reply':
        if (this.pendingUndo?.direction !== 'outgoing' || this.pendingUndo.ply !== msg.ply || msg.ply !== this.game.moves.length) return;
        if (msg.accepted) this.game.undo();
        this.pendingUndo = undefined; this.updateStatus(); this.changed(); break;
      case 'resign':
        if (msg.color === this.myColor) { this.fail(MISMATCH); return; }
        if (this.game.phase.kind === 'ended') return;
        this.game.resign(msg.color); this.pendingUndo = undefined; this.updateStatus(); this.changed(); break;
      case 'sync': this.reconcile(msg.state); break;
    }
  }

  private reconcile(remote: SyncState): void {
    const local = this.syncState();
    const merged = mergeSync(local, remote);
    if (merged.kind === 'conflict') { this.fail(CONFLICT); return; }
    if (merged.kind === 'adopt-remote') {
      // A peer must not replace this endpoint's secret setup after a disconnect.
      if (!local.placements && (!this.assignment || !this.hash || !this.peerHash || !this.myColor
        || !remote.placements || this.assignment.some((z, i) => remote.placements![this.myColor!][i] !== z))) {
        this.fail(CONFLICT); return;
      }
      this.game = gameFromSync(remote); this.clearSecrets(); this.pendingUndo = undefined;
    } else if (merged.kind === 'keep-local') this.sendSync();
    this.updateStatus(); this.changed();
  }

  private syncState(): SyncState {
    const sente = this.game.placement('sente'); const gote = this.game.placement('gote');
    const state: SyncState = { layers: this.game.config.layers,
      placements: this.game.phase.kind === 'placing' || !sente || !gote ? null : { sente, gote },
      moves: this.game.moves.map(encodeMove) };
    if (this.game.phase.kind === 'ended') state.result = structuredClone(this.game.phase.result);
    return state;
  }

  private advancePlacement(): void {
    if (this.stopped()) return;
    if (this.connected && this.greeted && this.game.phase.kind === 'placing' && this.hash && this.peerHash
      && this.assignment && this.salt && !this.revealSent) {
      this.revealSent = true;
      this.send({ type: 'reveal', assignment: [...this.assignment], salt: this.salt });
    }
    this.updateStatus(); this.changed();
  }
  private clearSecrets(): void {
    this.assignment = null; this.salt = null; this.hash = null; this.peerHash = null;
  }
  private updateStatus(): void {
    if (this.stopped()) return;
    this.status = !this.connected ? 'disconnected' : !this.greeted || !this.myColor ? 'connected'
      : this.game.phase.kind === 'ended' ? 'ended' : this.game.phase.kind === 'playing' ? 'playing'
        : this.revealSent ? 'revealing' : this.assignment ? 'waiting-commit' : 'placing';
  }
  private persist(): void {
    const saved: SavedRoom = { v: 1, role: this.role, myColor: this.myColor, sync: this.syncState() };
    if (!saved.sync.placements) saved.setup = {
      assignment: this.assignment ? [...this.assignment] : null, salt: this.salt, hash: this.hash, peerHash: this.peerHash,
    };
    try { this.storage?.save(this.roomKey, saved); } catch { /* Best effort, also for injected adapters. */ }
  }
  private changed(): void {
    this.persist();
    for (const fn of [...this.listeners]) fn();
  }
  private send(msg: NetMessage): void { if (this.connected && !this.disposed) this.transport.send(msg); }
  private sendSync(): void { this.send({ type: 'sync', state: this.syncState() }); }
  private stopped(): boolean { return this.disposed || this.status === 'error'; }
  private ensureActive(): void { if (this.stopped()) throw new Error('対局は終了しています'); }
  private ensurePlaying(): void {
    this.ensureActive();
    if (!this.myColor || this.game.phase.kind !== 'playing') throw new Error('対局中ではありません');
  }
  private fail(reason: string, notify = true): void {
    if (this.stopped()) return;
    if (notify) this.send({ type: 'error', reason });
    this.error = reason; this.status = 'error'; this.pendingUndo = undefined; this.changed();
  }
}
