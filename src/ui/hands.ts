import type { Game } from '../core/game';
import type { Color, HandKind } from '../core/types';
import { PIECE_NAMES } from '../render/types';
import { button, colorName, el } from './dom';
const KINDS: HandKind[] = ['R', 'B', 'G', 'S', 'N', 'L', 'P'];
export function hands(game: Game, color: Color, selected: HandKind | undefined, choose: (kind: HandKind) => void): HTMLElement {
  const panel = el('section', `hand-panel ${color}`); panel.append(el('h2', '', `${colorName(color)}の持ち駒`));
  const list = el('div', 'hand-list'); let count = 0;
  for (const kind of KINDS) {
    const n = game.position?.hands[color][kind] ?? 0; if (!n) continue; count += n;
    const b = button(`${PIECE_NAMES[kind]} ×${n}`, () => choose(kind));
    b.disabled = game.phase.kind !== 'playing' || game.position?.sideToMove !== color;
    b.setAttribute('aria-pressed', String(selected === kind && game.position?.sideToMove === color)); list.append(b);
  }
  if (!count) list.append(el('p', 'muted', '持ち駒なし')); panel.append(list); return panel;
}
