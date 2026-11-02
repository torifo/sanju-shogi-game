import { Game, type Result } from '../core/game';
import { decodeMove } from '../core/serialize';
import { validateAssignment } from '../core/setup';
import { opposite, type Color } from '../core/types';

export type Role = 'host' | 'guest';
export interface SyncState {
  layers: number;
  placements: { sente: number[]; gote: number[] } | null;
  moves: string[];
  result?: Result;
}
export type NetMessage =
  | { type: 'hello'; protocol: number; role: Role; layers: number; resume?: SyncState }
  | { type: 'assign'; hostColor: Color }
  | { type: 'commit'; hash: string }
  | { type: 'reveal'; assignment: number[]; salt: string }
  | { type: 'move'; ply: number; move: string }
  | { type: 'undo-request'; ply: number }
  | { type: 'undo-reply'; ply: number; accepted: boolean }
  | { type: 'resign'; color: Color }
  | { type: 'sync'; state: SyncState }
  | { type: 'full' }
  | { type: 'error'; reason: string };

/** N4's transport.ts can import/re-export this contract without loading a network library. */
export interface Transport {
  send(msg: NetMessage): void;
  onMessage(fn: (msg: unknown) => void): void;
  onPeerJoin(fn: () => void): void;
  onPeerLeave(fn: () => void): void;
  leave(): void;
}

type RecordValue = Record<string, unknown>;
export const isRecord = (v: unknown): v is RecordValue => typeof v === 'object' && v !== null && !Array.isArray(v);
export const isColor = (v: unknown): v is Color => v === 'sente' || v === 'gote';
export const isLayers = (v: unknown): v is number => v === 3 || v === 9;
export const isToken = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{22}$/.test(v) && v.length === 22;
export const isHash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/i.test(v) && v.length === 64;
export const hasKeys = (v: RecordValue, required: string[], optional: string[] = []): boolean =>
  required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));
const ply = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const assignment = (v: unknown, layers = 9): v is number[] => Array.isArray(v)
  && validateAssignment({ files: 9, ranks: 9, layers }, v);
const moveText = (v: unknown): v is string => {
  if (typeof v !== 'string') return false;
  try {
    const m = decodeMove(v);
    return m.to.z < 9 && (m.kind === 'drop' || m.from.z < 9);
  } catch { return false; }
};
const result = (v: unknown): v is Result => isRecord(v) && (v.kind === 'draw'
  ? hasKeys(v, ['kind', 'reason']) && v.reason === 'repetition'
  : v.kind === 'win' && hasKeys(v, ['kind', 'winner', 'reason']) && isColor(v.winner)
    && ['checkmate', 'no-moves', 'resign', 'perpetual-check'].includes(v.reason as string));

export function isSyncState(v: unknown): v is SyncState {
  if (!isRecord(v) || !hasKeys(v, ['layers', 'placements', 'moves'], ['result']) || !isLayers(v.layers)
    || !Array.isArray(v.moves) || !Array.from(v.moves).every(moveText)
    || (Object.hasOwn(v, 'result') && !result(v.result))) return false;
  if (v.placements === null) return v.moves.length === 0 && !Object.hasOwn(v, 'result');
  return isRecord(v.placements) && hasKeys(v.placements, ['sente', 'gote'])
    && assignment(v.placements.sente, v.layers) && assignment(v.placements.gote, v.layers);
}

export function parseMessage(raw: unknown): NetMessage | null {
  if (!isRecord(raw)) return null;
  let valid = false;
  switch (raw.type) {
    case 'hello': valid = hasKeys(raw, ['type', 'protocol', 'role', 'layers'], ['resume'])
      && Number.isSafeInteger(raw.protocol) && (raw.protocol as number) > 0
      && (raw.role === 'host' || raw.role === 'guest') && isLayers(raw.layers)
      && (!Object.hasOwn(raw, 'resume') || (isSyncState(raw.resume) && raw.resume.layers === raw.layers)); break;
    case 'assign': valid = hasKeys(raw, ['type', 'hostColor']) && isColor(raw.hostColor); break;
    case 'commit': valid = hasKeys(raw, ['type', 'hash']) && isHash(raw.hash); break;
    case 'reveal': valid = hasKeys(raw, ['type', 'assignment', 'salt']) && assignment(raw.assignment) && isToken(raw.salt); break;
    case 'move': valid = hasKeys(raw, ['type', 'ply', 'move']) && ply(raw.ply) && raw.ply > 0 && moveText(raw.move); break;
    case 'undo-request': valid = hasKeys(raw, ['type', 'ply']) && ply(raw.ply); break;
    case 'undo-reply': valid = hasKeys(raw, ['type', 'ply', 'accepted']) && ply(raw.ply) && typeof raw.accepted === 'boolean'; break;
    case 'resign': valid = hasKeys(raw, ['type', 'color']) && isColor(raw.color); break;
    case 'sync': valid = hasKeys(raw, ['type', 'state']) && isSyncState(raw.state); break;
    case 'full': valid = hasKeys(raw, ['type']); break;
    case 'error': valid = hasKeys(raw, ['type', 'reason']) && typeof raw.reason === 'string' && raw.reason.length > 0; break;
  }
  return valid ? structuredClone(raw) as NetMessage : null;
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export const commitHash = (assignment: readonly number[], salt: string): Promise<string> => sha256(JSON.stringify({ assignment, salt }));
export function randomSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Replays every move through core. Never trust a peer's claimed result. */
export function gameFromSync(state: SyncState): Game {
  if (!isSyncState(state)) throw new Error('保存形式が不正です');
  const game = new Game({ files: 9, ranks: 9, layers: state.layers });
  if (state.placements) {
    game.submitPlacement('sente', state.placements.sente);
    game.submitPlacement('gote', state.placements.gote);
    for (const move of state.moves) game.play(decodeMove(move));
    if (state.result?.kind === 'win' && state.result.reason === 'resign') game.resign(opposite(state.result.winner));
  }
  const actual = game.phase.kind === 'ended' ? game.phase.result : undefined;
  if (JSON.stringify(actual) !== JSON.stringify(state.result)) {
    // Compare fields rather than property insertion order for wire objects.
    if (!actual || !state.result || actual.kind !== state.result.kind || actual.reason !== state.result.reason
      || (actual.kind === 'win' && (state.result.kind !== 'win' || actual.winner !== state.result.winner))) {
      throw new Error('結果が不正です');
    }
  }
  return game;
}

export type SyncMerge = { kind: 'same' | 'adopt-remote' | 'keep-local' | 'conflict' };
export function mergeSync(local: SyncState, remote: SyncState): SyncMerge {
  try { gameFromSync(local); gameFromSync(remote); } catch { return { kind: 'conflict' }; }
  if (local.layers !== remote.layers) return { kind: 'conflict' };
  if (local.placements === null || remote.placements === null) {
    return { kind: local.placements === remote.placements ? 'same' : local.placements ? 'keep-local' : 'adopt-remote' };
  }
  if (local.placements.sente.some((z, i) => remote.placements!.sente[i] !== z)
    || local.placements.gote.some((z, i) => remote.placements!.gote[i] !== z)) return { kind: 'conflict' };
  const length = Math.min(local.moves.length, remote.moves.length);
  if (local.moves.slice(0, length).some((move, i) => remote.moves[i] !== move)) return { kind: 'conflict' };
  if (local.moves.length !== remote.moves.length) {
    const shorter = local.moves.length < remote.moves.length ? local : remote;
    if (shorter.result) return { kind: 'conflict' };
    return { kind: shorter === local ? 'adopt-remote' : 'keep-local' };
  }
  if (local.result && remote.result) {
    return { kind: local.result.kind === remote.result.kind && local.result.reason === remote.result.reason
      && (local.result.kind !== 'win' || (remote.result.kind === 'win' && local.result.winner === remote.result.winner)) ? 'same' : 'conflict' };
  }
  return { kind: local.result ? 'keep-local' : remote.result ? 'adopt-remote' : 'same' };
}
