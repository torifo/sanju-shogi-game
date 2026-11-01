import type { Game } from '../core/game';
import { isInCheck } from '../core/rules';
import { colorName, el } from './dom';
export function banner(game: Game, selected = false): HTMLElement {
  const node = el('div', 'status-banner'); node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite');
  if (game.phase.kind === 'ended') {
    const result = game.phase.result; node.classList.add('ended');
    if (result.kind === 'draw') node.textContent = '千日手 — 引き分けです';
    else {
      const reason = { checkmate: '詰み', 'no-moves': '合法手なし', resign: '投了', 'perpetual-check': '連続王手の千日手' }[result.reason];
      node.textContent = `${reason} — ${colorName(result.winner)}の勝ちです`;
    }
  } else if (game.position) {
    const check = isInCheck(game.position, game.position.sideToMove); node.classList.toggle('in-check', check);
    const instruction = selected ? '移動先を選んでください（もう一度押すと取り消し）'
      : check ? '玉を守る手を選んでください' : '駒を選んでください';
    node.textContent = `${colorName(game.position.sideToMove)}の手番 — ${check ? '王手。' : ''}${instruction}`;
  }
  return node;
}
