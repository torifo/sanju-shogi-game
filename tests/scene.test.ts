// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createBoard } from '../src/render/boardMesh';
import { CameraRig } from '../src/render/camera';
import { PieceFactory } from '../src/render/pieceMesh';
import { BoardView } from '../src/render/scene';

vi.mock('three', async importOriginal => {
  const actual = await importOriginal<typeof import('three')>();
  return { ...actual, WebGLRenderer: vi.fn(class {
    domElement = document.createElement('canvas');
    setPixelRatio = vi.fn(); setClearColor = vi.fn(); setSize = vi.fn(); render = vi.fn();
    dispose = vi.fn(); forceContextLoss = vi.fn();
  }) };
});
vi.mock('../src/render/camera', () => ({ CameraRig: vi.fn(class {
  camera = {}; controls = { enabled: true, update: vi.fn() };
  preset = vi.fn(); dispose = vi.fn();
}) }));
vi.mock('../src/render/pieceMesh', () => ({ PieceFactory: vi.fn(class { dispose = vi.fn(); }) }));
vi.mock('../src/render/boardMesh', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/render/boardMesh')>();
  const three = await import('three');
  return { ...actual, createBoard: vi.fn(() => {
    const group = new three.Group();
    group.add(new three.Mesh(new three.BoxGeometry(), new three.MeshBasicMaterial({ map: new three.Texture() })));
    return group;
  }) };
});
vi.mock('../src/render/picking', () => ({ pickSquare: vi.fn(() => ({ sq: { x: 5, y: 7, z: 1 }, piece: true })) }));

let container: HTMLElement;
let view: BoardView | undefined;
const disconnect = vi.fn();
const observe = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div'); document.body.append(container);
  vi.stubGlobal('ResizeObserver', class { observe = observe; disconnect = disconnect; });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 17));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  Object.defineProperty(HTMLCanvasElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
});
afterEach(() => {
  view?.dispose(); view = undefined; container.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

function resources() {
  return {
    renderer: vi.mocked(THREE.WebGLRenderer).mock.results[0]!.value as THREE.WebGLRenderer,
    rig: vi.mocked(CameraRig).mock.results[0]?.value as CameraRig | undefined,
    factory: vi.mocked(PieceFactory).mock.results[0]?.value as PieceFactory | undefined,
  };
}
function pointer(type: string, pointerId = 1, clientX = 100, clientY = 100): void {
  const event = new Event(type);
  Object.assign(event, { pointerId, clientX, clientY, isPrimary: pointerId === 1, button: 0 });
  container.querySelector('canvas')!.dispatchEvent(event);
}

describe('BoardViewの初期化と解放', () => {
  it('rendererの生成に失敗した場合も元の例外を投げ直す', () => {
    vi.mocked(THREE.WebGLRenderer).mockImplementationOnce(function () { throw new Error('renderer failed'); });
    expect(() => new BoardView(container, { layers: 3, layerGap: 2.2 })).toThrow('renderer failed');
    expect(container.querySelector('canvas')).toBeNull();
    expect(PieceFactory).not.toHaveBeenCalled();
  });
  it('PieceFactoryの生成失敗でも先に確保したrendererを解放する', () => {
    vi.mocked(PieceFactory).mockImplementationOnce(function () { throw new Error('factory failed'); });
    expect(() => new BoardView(container, { layers: 3, layerGap: 2.2 })).toThrow('factory failed');
    const { renderer } = resources();
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(renderer.forceContextLoss).toHaveBeenCalledOnce();
    expect(container.querySelector('canvas')).toBeNull();
  });
  it('2枚目の盤の生成失敗で1枚目のgeometry・material・textureとカメラを解放する', () => {
    const board = new THREE.Group();
    const geometry = new THREE.BoxGeometry(), texture = new THREE.Texture();
    const material = new THREE.MeshBasicMaterial({ map: texture });
    board.add(new THREE.Mesh(geometry, material));
    const disposals = [geometry, material, texture].map(resource => vi.spyOn(resource, 'dispose'));
    vi.mocked(createBoard).mockReturnValueOnce(board).mockImplementationOnce(() => { throw new Error('board failed'); });
    expect(() => new BoardView(container, { layers: 3, layerGap: 2.2 })).toThrow('board failed');
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
    const { renderer, rig, factory } = resources();
    expect(rig!.dispose).toHaveBeenCalledOnce(); expect(factory!.dispose).toHaveBeenCalledOnce();
    expect(renderer.dispose).toHaveBeenCalledOnce(); expect(renderer.forceContextLoss).toHaveBeenCalledOnce();
    expect(container.querySelector('canvas')).toBeNull();
  });
  it('監視開始の失敗でも監視と描画資源を解放する', () => {
    observe.mockImplementationOnce(() => { throw new Error('observe failed'); });
    expect(() => new BoardView(container, { layers: 3, layerGap: 2.2 })).toThrow('observe failed');
    expect(disconnect).toHaveBeenCalledOnce();
    expect(resources().renderer.dispose).toHaveBeenCalledOnce();
    expect(container.querySelector('canvas')).toBeNull();
  });
  it('フレーム予約の失敗でも登録済みイベントを解除する', () => {
    vi.mocked(requestAnimationFrame).mockImplementationOnce(() => { throw new Error('frame failed'); });
    expect(() => new BoardView(container, { layers: 3, layerGap: 2.2 })).toThrow('frame failed');
    const { renderer } = resources();
    const contextLost = vi.fn(); container.addEventListener('board-context-lost', contextLost);
    renderer.domElement.dispatchEvent(new Event('webglcontextlost'));
    expect(contextLost).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledOnce(); expect(renderer.dispose).toHaveBeenCalledOnce();
  });
  it('9層の案内を設定から生成し、通常のdisposeを二度呼んでも一度だけ解放する', () => {
    view = new BoardView(container, { layers: 9, layerGap: 2.2 });
    expect(container.querySelector('canvas')!.getAttribute('aria-label')).toMatch(/^9層の将棋盤/);
    view.dispose(); view.dispose();
    expect(resources().renderer.dispose).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(17);
  });
});

describe('BoardViewへのジェスチャー接続', () => {
  it('クリックは選択し、往復ドラッグと2本指は選択も層変更もしない', () => {
    view = new BoardView(container, { layers: 3, layerGap: 2.2 });
    const pick = vi.fn(), drag = vi.fn(); view.onPick(pick); view.onLayerDrag(drag);
    pointer('pointerdown'); pointer('pointerup');
    expect(pick).toHaveBeenCalledOnce(); pick.mockClear();
    pointer('pointerdown'); pointer('pointermove', 1, 140); pointer('pointerup');
    expect(pick).not.toHaveBeenCalled();
    pointer('pointerdown');
    expect(resources().rig!.controls.enabled).toBe(false);
    pointer('pointerdown', 2);
    expect(resources().rig!.controls.enabled).toBe(true);
    pointer('pointerup', 2); pointer('pointerup', 1, 100, 40);
    expect(pick).not.toHaveBeenCalled(); expect(drag).not.toHaveBeenCalled();
    pointer('pointerdown'); pointer('pointerup', 1, 100, 60);
    expect(drag).toHaveBeenCalledWith({ x: 5, y: 7, z: 1 }, 1);
  });
});

describe('盤の生成途中の失敗', () => {
  it('目盛りの描画失敗でも既に作った盤の資源を解放する', async () => {
    const actual = await vi.importActual<typeof import('../src/render/boardMesh')>('../src/render/boardMesh');
    const geometry = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const material = vi.spyOn(THREE.Material.prototype, 'dispose');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => { throw new Error('canvas failed'); });
    expect(() => actual.createBoard(0)).toThrow('canvas failed');
    expect(geometry).toHaveBeenCalledTimes(2); expect(material).toHaveBeenCalledTimes(2);
  });
  it('駒ファクトリーの初期化失敗でも確保済みの2つのgeometryを解放する', async () => {
    const actual = await vi.importActual<typeof import('../src/render/pieceMesh')>('../src/render/pieceMesh');
    const dispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    vi.spyOn(THREE.ExtrudeGeometry.prototype, 'rotateX').mockImplementation(() => { throw new Error('geometry failed'); });
    expect(() => new actual.PieceFactory()).toThrow('geometry failed');
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});
