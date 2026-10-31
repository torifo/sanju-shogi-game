import { el } from './dom';
export function moveLog(notation: readonly string[]): HTMLElement {
  const panel = el('section', 'move-log'); panel.append(el('h2', '', '棋譜'), el('p', 'muted', `${notation.length} 手`));
  const list = el('ol', 'notation');
  if (!notation.length) panel.append(el('p', 'muted', '最初の一手を待っています。'));
  for (const text of notation) list.append(el('li', '', text)); panel.append(list);
  // Wait until this detached panel has been attached.
  requestAnimationFrame(() => { if (list.isConnected) list.scrollTop = list.scrollHeight; }); return panel;
}
