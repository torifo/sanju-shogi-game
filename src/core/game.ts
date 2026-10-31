import type { BoardConfig } from './config';
import { hashPosition } from './hash';
import { formatMove } from './notation';
import { Position, type Undo } from './position';
import { generateLegalMoves, isInCheck, isLegalMove, status } from './rules';
import { createInitialPosition, validateAssignment, type LayerAssignment } from './setup';
import { opposite, type Color, type Move } from './types';

export type Phase =
  | { kind: 'placing'; color: Color }
  | { kind: 'playing' }
  | { kind: 'ended'; result: Result };
export type Result =
  | { kind: 'win'; winner: Color; reason: 'checkmate' | 'no-moves' | 'resign' | 'perpetual-check' }
  | { kind: 'draw'; reason: 'repetition' };
export interface GameEvent { type: 'phase' | 'move' | 'undo' }
interface HistoryEntry { undo: Undo; mover: Color; check: boolean }

export class Game {
  readonly config: BoardConfig;
  phase: Phase = { kind: 'placing', color: 'sente' };
  position: Position | null = null;
  readonly moves: Move[] = [];
  readonly notation: string[] = [];
  private readonly assignments: Record<Color, number[] | null> = { sente: null, gote: null };
  private readonly history: HistoryEntry[] = [];
  /** hashes[0] は初期局面、hashes[n] は n 手目の直後。 */
  private hashes: string[] = [];
  private readonly listeners = new Set<(e: GameEvent) => void>();

  constructor(config: BoardConfig) {
    // Position と同じ盤設定の検証を使う。配置中は局面自体は公開しない。
    this.config = new Position(config).config;
  }

  submitPlacement(color: Color, a: LayerAssignment): void {
    if (this.phase.kind !== 'placing' || this.phase.color !== color || !validateAssignment(this.config, a)) {
      throw new Error('配置の順番または層の割り当てが不正です');
    }
    this.assignments[color] = [...a];
    if (color === 'sente') {
      this.phase = { kind: 'placing', color: 'gote' };
    } else {
      this.position = createInitialPosition(this.config, this.assignments.sente!, this.assignments.gote!);
      this.phase = { kind: 'playing' };
    }
    this.emit('phase');
  }

  placement(color: Color): number[] | null {
    // 計画のAPIに従い、確定済みの割り当てのみ返す。相手画面への非表示はUIが担う。
    const a = this.assignments[color];
    return a ? [...a] : null;
  }

  legalMoves(): Move[] {
    return this.phase.kind === 'playing' && this.position ? generateLegalMoves(this.position) : [];
  }

  play(move: Move): void {
    const pos = this.position;
    if (this.phase.kind !== 'playing' || !pos || !isLegalMove(pos, move)) {
      throw new Error('指せない手です');
    }
    const recorded = structuredClone(move);
    const text = formatMove(pos, recorded);
    // 初手の直前を記録するので、テスト用に差し替えた局面も同じ進行処理を使える。
    if (this.history.length === 0) this.hashes = [hashPosition(pos)];
    const mover = pos.sideToMove;
    const undo = pos.apply(recorded);
    this.history.push({ undo, mover, check: isInCheck(pos, pos.sideToMove) });
    this.moves.push(structuredClone(recorded));
    this.notation.push(text);
    this.hashes.push(hashPosition(pos));
    const current = status(pos);
    if (current.kind !== 'ongoing') {
      this.phase = { kind: 'ended', result: { kind: 'win', winner: current.winner, reason: current.kind } };
    } else {
      const repeated = this.repetitionResult();
      if (repeated) this.phase = { kind: 'ended', result: repeated };
    }
    this.emit('move');
    if (this.phase.kind === 'ended') this.emit('phase');
  }

  private repetitionResult(): Result | null {
    const latest = this.hashes[this.hashes.length - 1]!;
    const occurrences = this.hashes.flatMap((hash, i) => hash === latest ? [i] : []);
    if (occurrences.length < 4) return null;
    const interval = this.history.slice(occurrences[0]!);
    for (const color of ['sente', 'gote'] as const) {
      const turns = interval.filter(entry => entry.mover === color);
      if (turns.length > 0 && turns.every(entry => entry.check)) {
        return { kind: 'win', winner: opposite(color), reason: 'perpetual-check' };
      }
    }
    return { kind: 'draw', reason: 'repetition' };
  }

  undo(): void {
    if (this.phase.kind === 'placing' || !this.position) throw new Error('対局が始まっていません');
    const entry = this.history.pop();
    if (!entry && this.phase.kind === 'playing') return;
    if (entry) {
      this.position.undo(entry.undo);
      this.moves.pop();
      this.notation.pop();
      this.hashes.pop();
    }
    this.phase = { kind: 'playing' };
    this.emit('undo');
  }

  resign(color: Color): void {
    if (this.phase.kind !== 'playing') throw new Error('投了できる対局中ではありません');
    this.phase = { kind: 'ended', result: { kind: 'win', winner: opposite(color), reason: 'resign' } };
    this.emit('phase');
  }

  subscribe(fn: (e: GameEvent) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit(type: GameEvent['type']): void {
    for (const listener of [...this.listeners]) listener({ type });
  }
}
