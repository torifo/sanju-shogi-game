import type { BoardConfig } from '../core/config';
import { Game } from '../core/game';
import { decodeMove, encodeMove } from '../core/serialize';
import { validateAssignment } from '../core/setup';
import { opposite, type Color, type Move } from '../core/types';
import {
  PROTOCOL, MAX_MOVES, chooseHostColor, commitHash, gameFromSync, verifyReveals,
  isLayers, isRecord, isToken, mergeSync, parseMessage, randomSalt,
  type PendingUndo, type UndoOperation, type NetMessage, type Role, type SyncState, type Transport,
} from './protocol';
import { isSavedRoom, localRoomStorage, type RoomStorage, type SavedRoom } from './storage';

export type OnlineStatus = 'waiting' | 'connected' | 'placing' | 'waiting-commit' | 'revealing' | 'playing' | 'ended' | 'disconnected' | 'error';
export type { PendingUndo } from './protocol';
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
  private reveals: SyncState['reveals'] = null;
  private undo: UndoOperation | null = null;

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
    this.game = saved ? gameFromSync(saved.sync) : new Game(options.config);
    if (saved) {
      this.myColor = saved.myColor;
      this.reveals = saved.sync.reveals; this.undo = saved.sync.undo; this.pendingUndo = saved.pendingUndo;
      if (saved.sync.placements) this.queue = verifyReveals(saved.sync).then(valid => {
        if (!valid) this.fail(MISMATCH);
      });
      if (saved.setup) {
        this.assignment = saved.setup.assignment; this.salt = saved.setup.salt;
        this.hash = saved.setup.hash?.toLowerCase() ?? null; this.peerHash = saved.setup.peerHash?.toLowerCase() ?? null;
      }
      // Recover even if a reload interrupted the first digest before it was persisted.
      if (this.assignment && this.salt && !this.hash) {
        this.queue = commitHash(this.assignment, this.salt).then(hash => {
          if (this.stopped()) return;
          this.hash = hash; this.send({ type: 'commit', hash }); this.advancePlacement();
        });
      }
    }
    if (this.role === 'host' && !this.myColor) {
      this.myColor = chooseHostColor(options.hostColorChoice ?? 'random');
    }
    this.transport.onPeerJoin(() => {
      if (this.stopped()) return;
      this.connectionEpoch++;
      this.connected = true; this.greeted = false; this.revealSent = false;
      this.status = 'connected'; this.changed();
      this.send({ type: 'hello', protocol: PROTOCOL, role: this.role, layers: this.game.config.layers, resume: this.syncState() });
    });
    this.transport.onPeerLeave(() => {
      if (this.stopped()) return;
      this.connectionEpoch++;
      this.connected = false; this.greeted = false;
      this.status = 'disconnected'; this.changed();
    });
    this.transport.onMessage(raw => {
      const msg = parseMessage(raw);
      if (this.stopped()) return;
      if (!msg) {
        // An attempted public transition without verifiable evidence must stop, not publish.
        const state = isRecord(raw) ? raw.type === 'sync' ? raw.state : raw.type === 'hello' ? raw.resume : null : null;
        if (isRecord(state) && isRecord(state.placements)) this.fail(MISMATCH);
        return;
      }
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
    if (this.game.moves.length >= MAX_MOVES) throw new Error('棋譜の上限に達しました');
    this.game.play(move);
    this.send({ type: 'move', epoch: this.undo?.epoch ?? 0, ply: this.game.moves.length, move: encodeMove(move) });
    this.updateStatus(); this.changed();
  }

  requestUndo(): void {
    this.ensurePlaying();
    if (!this.connected || !this.greeted || this.pendingUndo || this.game.moves.length === 0) throw new Error('待ったを申し込めません');
    this.pendingUndo = { epoch: (this.undo?.epoch ?? 0) + 1, id: randomSalt(), requester: this.role,
      ply: this.game.moves.length, direction: 'outgoing' };
    this.changed();
    this.sendUndoRequest();
  }

  replyUndo(accepted: boolean): void {
    this.ensurePlaying();
    const pending = this.pendingUndo;
    if (!this.connected || !pending || pending.direction !== 'incoming' || pending.ply !== this.game.moves.length) throw new Error('待ったの申し入れがありません');
    const { direction: _, ...operation } = pending;
    if (accepted) { this.game.undo(); this.undo = operation; }
    this.pendingUndo = undefined;
    this.changed(); // Persist the accepted operation before attempting delivery.
    this.send({ type: 'undo-reply', ...operation, accepted });
  }

  resign(): void {
    this.ensurePlaying();
    this.game.resign(this.myColor!); this.pendingUndo = undefined;
    this.send({ type: 'resign', color: this.myColor!, epoch: this.undo?.epoch ?? 0, ply: this.game.moves.length }); this.updateStatus(); this.changed();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.listeners.clear(); this.transport.leave();
  }

  private async receive(msg: NetMessage, epoch: number): Promise<void> {
    if (msg.type === 'full') { this.fail('この部屋は満員です', false); return; }
    if (msg.type === 'error') { this.fail(msg.reason, false); return; }
    if (msg.type === 'hello') {
      if (msg.protocol !== PROTOCOL) { this.fail(VERSION); return; }
      if (msg.role === this.role) {
        this.fail('同じ役割の端末どうしがつながりました。招待リンクは作成者以外の人が開いてください'); return;
      }
      if (!this.connected || msg.layers !== this.game.config.layers) { this.fail(MISMATCH); return; }
      this.greeted = true;
      if (this.role === 'host') {
        this.send({ type: 'assign', hostColor: this.myColor! });
      }
      if (msg.resume) {
        if (this.myColor) await this.reconcile(msg.resume, epoch);
        else this.deferredSync = msg.resume;
      }
      if (this.stopped()) return;
      if (this.hash) this.send({ type: 'commit', hash: this.hash });
      this.advancePlacement();
      this.sendUndoRequest();
      return;
    }
    if (!this.connected || !this.greeted) return;
    if (msg.type === 'assign') {
      if (this.role !== 'guest' || (this.myColor && this.myColor !== opposite(msg.hostColor))) { this.fail(MISMATCH); return; }
      this.myColor = opposite(msg.hostColor);
      if (this.deferredSync) { await this.reconcile(this.deferredSync, epoch); this.deferredSync = undefined; }
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
        const ownProof = { salt: this.salt, hash: this.hash };
        const peerProof = { salt: msg.salt, hash: this.peerHash };
        this.reveals = this.myColor === 'sente' ? { sente: ownProof, gote: peerProof } : { sente: peerProof, gote: ownProof };
        this.game = gameFromSync({ layers: this.game.config.layers, placements, reveals: this.reveals, undo: null, moves: [] });
        this.clearSecrets(); this.updateStatus(); this.changed(); break;
      }
      case 'move':
        if (msg.epoch < (this.undo?.epoch ?? 0)) return;
        if (msg.epoch > (this.undo?.epoch ?? 0)) { this.sendSync(); return; }
        if (this.game.phase.kind === 'ended' && this.game.phase.result.reason === 'resign') return;
        if (msg.ply <= this.game.moves.length) return;
        if (msg.ply !== this.game.moves.length + 1) { this.sendSync(); return; }
        if (this.game.phase.kind !== 'playing' || this.game.position?.sideToMove === this.myColor) { this.fail(MISMATCH); return; }
        this.game.play(decodeMove(msg.move)); this.pendingUndo = undefined;
        this.updateStatus(); this.changed(); break;
      case 'undo-request':
        if (msg.requester === this.role || msg.epoch !== (this.undo?.epoch ?? 0) + 1
          || this.game.phase.kind !== 'playing' || this.game.moves.length === 0 || msg.ply !== this.game.moves.length) return;
        if (this.pendingUndo?.direction === 'outgoing') {
          // A host request wins a simultaneous request on both endpoints.
          if (this.role === 'host') return;
        }
        this.pendingUndo = { epoch: msg.epoch, id: msg.id, ply: msg.ply, requester: msg.requester, direction: 'incoming' }; this.changed(); break;
      case 'undo-reply':
        if (this.pendingUndo?.direction !== 'outgoing' || this.pendingUndo.id !== msg.id
          || this.pendingUndo.epoch !== msg.epoch || msg.epoch !== (this.undo?.epoch ?? 0) + 1
          || msg.requester !== this.role || this.pendingUndo.ply !== msg.ply || msg.ply !== this.game.moves.length) return;
        if (msg.accepted) {
          this.game.undo(); this.undo = { epoch: msg.epoch, id: msg.id, ply: msg.ply, requester: msg.requester };
        }
        this.pendingUndo = undefined; this.updateStatus(); this.changed(); break;
      case 'resign': {
        if (msg.color === this.myColor) { this.fail(MISMATCH); return; }
        if (msg.epoch < (this.undo?.epoch ?? 0)) return;
        if (msg.epoch > (this.undo?.epoch ?? 0) || msg.ply > this.game.moves.length) { this.sendSync(); return; }
        const remote = this.syncState();
        remote.moves = remote.moves.slice(0, msg.ply);
        remote.result = { kind: 'win', winner: opposite(msg.color), reason: 'resign' };
        await this.reconcile(remote, epoch); break;
      }
      case 'sync': await this.reconcile(msg.state, epoch); break;
    }
  }

  private async reconcile(remote: SyncState, epoch: number): Promise<void> {
    if (remote.placements) {
      const valid = await verifyReveals(remote);
      if (this.stopped() || epoch !== this.connectionEpoch) return;
      if (!valid) { this.fail(MISMATCH); return; }
    }
    const local = this.syncState();
    if (remote.placements) {
      // Pin public evidence to commits already accepted on this endpoint, on every path.
      if (!local.placements) {
        if (!this.assignment || !this.hash || !this.peerHash || !this.myColor || !remote.reveals
          || remote.reveals[this.myColor].hash.toLowerCase() !== this.hash
          || remote.reveals[opposite(this.myColor)].hash.toLowerCase() !== this.peerHash
          || this.assignment.some((z, i) => remote.placements![this.myColor!][i] !== z)) {
          this.fail(MISMATCH); return;
        }
      } else if (!local.reveals || !remote.reveals
        || local.reveals.sente.hash.toLowerCase() !== remote.reveals.sente.hash.toLowerCase()
        || local.reveals.gote.hash.toLowerCase() !== remote.reveals.gote.hash.toLowerCase()) {
        this.fail(MISMATCH); return;
      }
    }
    const merged = mergeSync(local, remote);
    if (merged.kind === 'conflict') { this.fail(CONFLICT); return; }
    if (merged.kind === 'adopt-remote') {
      this.game = gameFromSync(remote); this.reveals = structuredClone(remote.reveals); this.undo = structuredClone(remote.undo);
      this.clearSecrets(); this.pendingUndo = undefined;
    } else if (merged.kind === 'keep-local') this.sendSync();
    if (this.pendingUndo && this.pendingUndo.epoch <= (this.undo?.epoch ?? 0)) this.pendingUndo = undefined;
    this.updateStatus(); this.changed();
  }

  private syncState(): SyncState {
    const sente = this.game.placement('sente'); const gote = this.game.placement('gote');
    const state: SyncState = { reveals: structuredClone(this.reveals), undo: structuredClone(this.undo), layers: this.game.config.layers,
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
    const saved: SavedRoom = { v: 2, role: this.role, myColor: this.myColor, sync: this.syncState() };
    if (!saved.sync.placements) saved.setup = {
      assignment: this.assignment ? [...this.assignment] : null, salt: this.salt, hash: this.hash, peerHash: this.peerHash,
    };
    if (this.pendingUndo) saved.pendingUndo = structuredClone(this.pendingUndo);
    try { this.storage?.save(this.roomKey, saved); } catch { /* Best effort, also for injected adapters. */ }
  }
  private changed(): void {
    this.persist();
    for (const fn of [...this.listeners]) fn();
  }
  private send(msg: NetMessage): void { if (this.connected && !this.disposed) this.transport.send(msg); }
  private sendUndoRequest(): void {
    if (this.pendingUndo?.direction !== 'outgoing') return;
    const { direction: _, ...operation } = this.pendingUndo;
    this.send({ type: 'undo-request', ...operation });
  }
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
