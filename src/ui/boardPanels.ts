import { layerName } from '../core/notation';
import type { BoardView } from '../render/scene';
import type { CameraPreset } from '../render/camera';
import { button, el } from './dom';
import type { Game } from '../core/game';
import type { OnlineUI } from './online';
export { banner } from './banner';
export { hands } from './hands';
export { moveLog } from './log';
export { chooseDialog, promotion } from './promotion';

export function buildViewToolbar(toolbar: HTMLElement, layers: number, getView: () => BoardView | undefined): void {
  const camera = el('div', 'toolbar-group'); camera.append(el('span', '', '視点'));
  for (const [preset, label] of [['oblique', '斜め'], ['top', '真上'], ['side', '横']] as const) {
    const b = button(label, () => {
      getView()?.setCameraPreset(preset as CameraPreset);
      camera.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === b)));
    }); b.setAttribute('aria-pressed', String(preset === 'oblique')); camera.append(b);
  }
  const focus = el('label', 'toolbar-group'); focus.append(el('span', '', '注目'));
  const select = el('select'); select.setAttribute('aria-label', '注目する層'); select.append(new Option('全層', 'all'));
  for (let z = 0; z < layers; z++) select.append(new Option(layerName(z, layers), String(z)));
  select.addEventListener('change', () => getView()?.setFocusLayer(select.value === 'all' ? null : Number(select.value))); focus.append(select);
  const gap = button('間隔を広げる', () => { const wide = gap.getAttribute('aria-pressed') !== 'true'; gap.setAttribute('aria-pressed', String(wide)); gap.textContent = wide ? '間隔を戻す' : '間隔を広げる'; getView()?.setLayerGap(wide ? 3.5 : 2.2); }); gap.setAttribute('aria-pressed', 'false');
  toolbar.append(camera, focus, gap);
}

export function gameControls(game: Game, busy: boolean, online: OnlineUI | undefined, undoAction: () => void, resignAction: () => void): HTMLElement {
  const session = online?.session;
  const row = el('div', 'game-controls button-row');
  const undo = button(online ? '待ったを申し込む' : '待った（一手戻す）', undoAction); undo.disabled = busy || game.moves.length === 0 || !!session && (session.status !== 'playing' || !!session.pendingUndo);
  const resign = button('投了', resignAction, 'danger'); resign.disabled = busy || game.phase.kind !== 'playing' || !!session && session.status !== 'playing';
  row.append(undo, resign, el('span', 'muted', game.phase.kind === 'ended' ? '対局終了。タイトルから新しい対局を始められます。' : '黄：選択 / 緑：合法手 / 青：直前の手 / 赤：王手'));
  return row;
}
