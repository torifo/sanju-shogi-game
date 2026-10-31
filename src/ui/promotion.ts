import { button, el } from './dom';
export function chooseDialog(title: string, description: string, options: string[], signal: AbortSignal): Promise<number | null> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(null); return; }
    const dialog = el('dialog', 'choice-dialog'); const actions = el('div', 'button-row');
    const finish = (value: number | null): void => {
      signal.removeEventListener('abort', abort); dialog.close(); dialog.remove(); resolve(value);
    };
    const abort = (): void => finish(null);
    dialog.setAttribute('aria-labelledby', 'dialog-title');
    const h = el('h2', '', title); h.id = 'dialog-title';
    options.forEach((text, i) => actions.append(button(text, () => finish(i), i === 0 ? 'primary' : '')));
    actions.append(button('キャンセル', () => finish(null)));
    dialog.append(h, el('p', '', description), actions); document.body.append(dialog);
    dialog.addEventListener('cancel', e => { e.preventDefault(); finish(null); });
    signal.addEventListener('abort', abort, { once: true }); dialog.showModal();
  });
}
export const promotion = (signal: AbortSignal): Promise<number | null> => chooseDialog('駒を成りますか', '敵陣に関わる手です。成るか、成らずに進むかを選んでください。', ['成る', '成らない'], signal);
