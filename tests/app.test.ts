// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CUBE, SANJU } from '../src/core/config';
import { Game } from '../src/core/game';
import { saveGame } from '../src/core/serialize';
import { defaultAssignment } from '../src/core/setup';
import { Placement } from '../src/ui/placement';
import { STORAGE_KEY } from '../src/ui/storage';

let root: HTMLElement;
let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.resetModules(); localStorage.clear();
  root = document.createElement('div'); document.body.append(root);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
});
afterEach(() => {
  dispose?.(); dispose = undefined; root.remove();
  vi.doUnmock('../src/render/scene'); vi.unstubAllGlobals();
});

function click(label: string): void {
  const button = [...root.querySelectorAll('button')].find(item => item.textContent === label);
  expect(button, label).toBeDefined(); button!.click();
}
function sceneModule(gate = Promise.resolve(), failure?: 'import' | 'constructor' | 'webgl') {
  const imported = vi.fn();
  const released = vi.fn();
  const BoardView = vi.fn(class {
    private canvas = document.createElement('canvas');
    constructor(container: HTMLElement) {
      if (failure === 'constructor') throw new Error('initialization failed');
      container.append(this.canvas);
    }
    onPick() {} onLayerDrag() {} setPieces() {} setHighlights() {}
    dispose() { released(); this.canvas.remove(); }
  });
  vi.doMock('../src/render/scene', async () => {
    imported(); await gate;
    if (failure === 'import') throw new Error('loading failed');
    return { BoardView, isWebGLAvailable: () => failure !== 'webgl' };
  });
  return { imported, BoardView, released };
}
async function createApp(): Promise<void> {
  const { App } = await import('../src/ui/app');
  const app = new App(root); dispose = () => app.dispose();
}
function beginPlacement(): void { click('新規対局'); click('配置を始める'); }
function savedGame(layers = 3): string {
  const config = layers === 9 ? CUBE : SANJU;
  const game = new Game(config), assignment = defaultAssignment(config);
  game.submitPlacement('sente', assignment); game.submitPlacement('gote', assignment);
  return JSON.stringify(saveGame(game));
}

describe('3Dの遅延読み込みとフォールバック', () => {
  it('タイトルと交代画面では読まず、盤に入ると読み込み中を表示する', async () => {
    let finish!: () => void;
    const scene = sceneModule(new Promise<void>(resolve => { finish = resolve; }));
    await createApp();
    expect(scene.imported).not.toHaveBeenCalled();
    click('新規対局'); expect(scene.imported).not.toHaveBeenCalled();
    click('配置を始める');
    await vi.waitFor(() => expect(scene.imported).toHaveBeenCalledOnce());
    expect(root.querySelector('[role="status"]')!.textContent).toBe('盤を準備しています');
    expect(root.querySelectorAll('.mini-piece')).toHaveLength(20);
    expect(scene.BoardView).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(scene.BoardView).toHaveBeenCalledOnce());
    expect(root.textContent).not.toContain('盤を準備しています');
    expect(root.querySelector<HTMLElement>('.view-toolbar')!.hidden).toBe(false);
  });
  it.each(['import', 'constructor', 'webgl'] as const)('%sの失敗後も展開図で配置を変えられる', async failure => {
    sceneModule(Promise.resolve(), failure); await createApp(); beginPlacement();
    await vi.waitFor(() => expect(root.querySelector('.minimap.fallback')).not.toBeNull());
    expect(root.querySelector<HTMLDetailsElement>('.minimap')!.open).toBe(true);
    expect(root.querySelector<HTMLElement>('.view-toolbar')!.hidden).toBe(true);
    expect(root.textContent).not.toContain('盤を準備しています');
    root.querySelector<HTMLButtonElement>('[data-square="9,7,1"]')!.click();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    expect(root.querySelector('[data-square="9,7,2"] .mini-piece')).not.toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
  it('読み込み中にタイトルへ戻ると遅れて盤を作らない', async () => {
    let finish!: () => void;
    const scene = sceneModule(new Promise<void>(resolve => { finish = resolve; }));
    await createApp(); beginPlacement();
    await vi.waitFor(() => expect(scene.imported).toHaveBeenCalled());
    click('タイトルへ'); finish();
    // Let the import continuation run after the screen epoch has changed.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(scene.BoardView).not.toHaveBeenCalled();
    expect(root.querySelector('.title-screen')).not.toBeNull();
  });
  it('コンテキスト喪失時も作成済みの3Dを破棄して展開図へ切り替える', async () => {
    const scene = sceneModule(); await createApp(); beginPlacement();
    await vi.waitFor(() => expect(scene.BoardView).toHaveBeenCalled());
    root.querySelector('.board-stage')!.dispatchEvent(new CustomEvent('board-context-lost'));
    expect(scene.released).toHaveBeenCalledOnce();
    expect(root.querySelector('canvas')).toBeNull();
    expect(root.querySelector('.minimap.fallback')).not.toBeNull();
    expect(root.querySelectorAll('.mini-piece')).toHaveLength(20);
  });
});

describe('BFCacheからの復帰', () => {
  it.each(['先手', '後手'])('%sの秘密配置を残さずタイトルを再生成する', async player => {
    sceneModule(Promise.resolve(), 'webgl');
    const { mountApp } = await import('../src/main'); dispose = mountApp(root);
    beginPlacement();
    await vi.waitFor(() => expect(root.querySelector('.minimap.fallback')).not.toBeNull());
    if (player === '後手') {
      click('配置を確定'); click('配置を始める');
      await vi.waitFor(() => expect(root.querySelector('.minimap.fallback')).not.toBeNull());
    }
    expect(root.querySelectorAll('.mini-piece')).toHaveLength(20);
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    expect(root.childElementCount).toBe(0);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    expect(root.querySelector('.title-screen')).not.toBeNull();
    expect(root.querySelectorAll('.mini-piece')).toHaveLength(0);
    expect([...root.querySelectorAll('button')].find(b => b.textContent === '続きから')!.disabled).toBe(true);
    // Repeated navigation must keep restoring a usable app without duplicate listeners.
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    beginPlacement();
    expect(root.querySelectorAll('.play-screen')).toHaveLength(1);
  });
  it('公開後の保存は復帰後も続きから再開できる', async () => {
    sceneModule(Promise.resolve(), 'webgl');
    const saved = savedGame(); localStorage.setItem(STORAGE_KEY, saved);
    const { mountApp } = await import('../src/main'); dispose = mountApp(root);
    click('続きから');
    await vi.waitFor(() => expect(root.querySelectorAll('.mini-piece')).toHaveLength(40));
    expect(root.querySelector('h1')!.textContent).toBe('三層の盤');
    expect(root.querySelector('.brand-sub')!.textContent).toBe('SANJU SHOGI / 九 × 九 × 三');
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    expect(root.querySelector('.title-screen')).not.toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(saved);
    click('続きから');
    await vi.waitFor(() => expect(root.querySelectorAll('.mini-piece')).toHaveLength(40));
  });
});

describe('9層の画面表示', () => {
  it('再開した対局と注目メニューと展開図は9層を表示し、層を重複させない', async () => {
    sceneModule(); localStorage.setItem(STORAGE_KEY, savedGame(9));
    await createApp(); click('続きから');
    await vi.waitFor(() => expect(root.querySelector('.view-toolbar select')).not.toBeNull());
    expect(root.querySelector('h1')!.textContent).toBe('九層の盤');
    expect(root.querySelector('.brand-sub')!.textContent).toBe('SANJU SHOGI / 九 × 九 × 九');
    expect(root.querySelectorAll('.mini-layer')).toHaveLength(9);
    expect([...root.querySelectorAll('.mini-layer h3')].map(h => h.textContent)).toEqual(['9層', '8層', '7層', '6層', '5層', '4層', '3層', '2層', '1層']);
    expect([...root.querySelectorAll('select option')].map(o => o.textContent)).toEqual(['全層', '1層', '2層', '3層', '4層', '5層', '6層', '7層', '8層', '9層']);
    expect(root.innerHTML).not.toContain('層層');
  });
  it('配置ボタンと数字キーの説明は1〜9、中央層は5層', () => {
    const placement = new Placement(CUBE, 'sente');
    root.append(placement.controls(() => {}, () => {}));
    expect(root.textContent).toContain('9層 / 9');
    expect(root.textContent).toContain('全部を5層');
    expect(root.textContent).toContain('1＝1層・2＝2層・3＝3層・4＝4層・5＝5層・6＝6層・7＝7層・8＝8層・9＝9層');
    expect(root.textContent).not.toContain('層層');
  });
});
