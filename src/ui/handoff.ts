import type { Color } from '../core/types';
import { button, colorName, el, heading } from './dom';
export function handoff(color: Color, begin: () => void): HTMLElement {
  const panel = el('section', 'handoff paper');
  panel.append(heading('秘密配置', `${colorName(color)}の番です`, color === 'sente' ? '後手は画面を見ないでください。準備ができたら配置を始めます。' : '後手に端末を渡してください。先手は画面を見ないでください。'));
  panel.append(el('div', 'seal', color === 'sente' ? '先' : '後'), el('p', 'muted', 'この画面では、盤と駒は表示されません。'), button('配置を始める', begin, 'primary'));
  return panel;
}
