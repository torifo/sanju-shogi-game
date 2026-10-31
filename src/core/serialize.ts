import { Game } from './game';
import { opposite, type Color, type HandKind, type Move, type Square } from './types';

export interface SavedGame {
  v: 1;
  layers: number;
  sente: number[];
  gote: number[];
  moves: string[];
  /** 投了は棋譜から導出できないため、投了した側だけを追加保存する。 */
  resigned?: Color;
}

const squareText = (sq: Square): string => `${sq.x},${sq.y},${sq.z}`;

export function encodeMove(m: Move): string {
  return m.kind === 'move' ? `m:${squareText(m.from)}>${squareText(m.to)}${m.promote ? '+' : ''}`
    : `d:${m.piece}>${squareText(m.to)}`;
}

function parseSquare(s: string): Square {
  const [x, y, z] = s.split(',').map(Number);
  if (!Number.isSafeInteger(z)) throw new Error('層の番号が不正です');
  return { x: x!, y: y!, z: z! };
}

export function decodeMove(s: string): Move {
  if (typeof s !== 'string') throw new Error('指し手は文字列で指定してください');
  const m = /^m:([1-9],[1-9],(?:0|[1-9]\d*))>([1-9],[1-9],(?:0|[1-9]\d*))(\+)?$/.exec(s);
  if (m && m[0] === s) {
    return { kind: 'move', from: parseSquare(m[1]!), to: parseSquare(m[2]!), promote: m[3] === '+' };
  }
  const d = /^d:([RBGSNLP])>([1-9],[1-9],(?:0|[1-9]\d*))$/.exec(s);
  if (d && d[0] === s) return { kind: 'drop', piece: d[1] as HandKind, to: parseSquare(d[2]!) };
  throw new Error('指し手の形式が不正です');
}

export function saveGame(g: Game): SavedGame {
  const sente = g.placement('sente');
  const gote = g.placement('gote');
  if (g.phase.kind === 'placing' || !g.position || !sente || !gote) {
    throw new Error('配置中の対局は保存できません');
  }
  const saved: SavedGame = { v: 1, layers: g.config.layers, sente, gote, moves: g.moves.map(encodeMove) };
  if (g.phase.kind === 'ended' && g.phase.result.kind === 'win' && g.phase.result.reason === 'resign') {
    saved.resigned = opposite(g.phase.result.winner);
  }
  return saved;
}

export function loadGame(data: unknown): Game {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('保存形式が不正です');
  const d = data as Record<string, unknown>;
  if (d.v !== 1 || typeof d.layers !== 'number' || !Number.isSafeInteger(d.layers) || d.layers < 1
    || !Array.isArray(d.sente) || !Array.isArray(d.gote) || !Array.isArray(d.moves)
    || (d.resigned !== undefined && d.resigned !== 'sente' && d.resigned !== 'gote')) {
    throw new Error('保存形式またはバージョンが不正です');
  }
  const game = new Game({ files: 9, ranks: 9, layers: d.layers });
  // 配置の長さ・整数・範囲は submitPlacement が検証する。
  game.submitPlacement('sente', d.sente);
  game.submitPlacement('gote', d.gote);
  for (const text of d.moves) {
    if (typeof text !== 'string') throw new Error('棋譜が不正です');
    game.play(decodeMove(text));
  }
  if (d.resigned !== undefined) game.resign(d.resigned);
  return game;
}
