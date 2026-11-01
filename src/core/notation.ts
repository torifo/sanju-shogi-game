import { canPromoteType } from './pieces';
import type { Position } from './position';
import type { Move, PieceType } from './types';

const NAMES: Record<PieceType, string> = {
  K: '玉', R: '飛', B: '角', G: '金', S: '銀', N: '桂', L: '香', P: '歩',
  '+R': '竜', '+B': '馬', '+S': '成銀', '+N': '成桂', '+L': '成香', '+P': 'と',
};
const RANKS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

export function layerLabel(z: number, layers: number): string {
  return layers === 3 ? ['下', '中', '上'][z]! : `${z + 1}層`;
}

/** Full display name; layerLabel stays compact for move notation. */
export function layerName(z: number, layers: number): string {
  return layers === 3 ? `${layerLabel(z, layers)}層` : layerLabel(z, layers);
}

export function layerNames(layers: number): string[] {
  return Array.from({ length: layers }, (_, z) => layerName(z, layers));
}

export function layerKeyGuide(layers: number): string {
  return Array.from({ length: Math.min(layers, 9) }, (_, z) => `${z + 1}＝${layerLabel(z, layers)}`).join('・');
}

export function formatMove(pos: Position, move: Move): string {
  const prefix = `${pos.sideToMove === 'sente' ? '▲' : '△'}${move.to.x}${RANKS[move.to.y - 1]}`;
  const toLayer = layerLabel(move.to.z, pos.config.layers);
  if (move.kind === 'drop') return `${prefix}${NAMES[move.piece]}打 ${toLayer}`;
  const piece = pos.get(move.from);
  if (!piece) throw new Error('移動元に駒がありません');
  const inZone = (y: number): boolean => piece.color === 'sente' ? y <= 3 : y >= 7;
  const suffix = move.promote ? '成'
    : canPromoteType(piece.type) && (inZone(move.from.y) || inZone(move.to.y)) ? '不成' : '';
  return `${prefix}${NAMES[piece.type]}${suffix} ${layerLabel(move.from.z, pos.config.layers)}→${toLayer}`;
}
