import type { Color } from '../core/types';
export const colorName = (color: Color): string => color === 'sente' ? '先手' : '後手';
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
}
export function button(text: string, action: () => void, className = ''): HTMLButtonElement {
  const node = el('button', className, text); node.type = 'button'; node.addEventListener('click', action); return node;
}
export function heading(kicker: string, title: string, description: string): HTMLElement {
  const group = el('div', 'heading'); group.append(el('p', 'eyebrow', kicker), el('h1', '', title), el('p', 'description', description)); return group;
}
