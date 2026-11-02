/// <reference types="node" />
// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SANJU } from '../src/core/config';
import { defaultAssignment } from '../src/core/setup';
import { createMemoryRoom, type MemoryRoom, type MemoryTransport } from '../src/net/memoryTransport';
import { OnlineSession } from '../src/net/session';
import { loadRoom, saveRoom } from '../src/net/storage';
import type { TransportOptions } from '../src/net/transport';
import { App } from '../src/ui/app';
import { STORAGE_KEY } from '../src/ui/storage';
import { MemoryRoleLocks } from './helpers/roleLocks';

const network = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../src/net/transport', () => ({ createTrysteroTransport: network.create }));
vi.mock('../src/render/scene', () => ({ isWebGLAvailable: () => false }));
let root: HTMLElement, app: App | undefined, room: MemoryRoom, transport: MemoryTransport;
let remote: OnlineSession | undefined;
let options: TransportOptions;
let locks: MemoryRoleLocks;
const key = 'AAAAAAAAAAAAAAAAAAAAAA';
beforeEach(() => {
  localStorage.clear(); history.replaceState(null, '', '/');
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  locks = new MemoryRoleLocks();
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute('open'); } });
  room = createMemoryRoom(); network.create.mockReset().mockImplementation(async (_key, config) => {
    options = config; transport = room.connect(); vi.spyOn(transport, 'leave'); return transport;
  });
  root = document.createElement('div'); document.body.append(root);
});
afterEach(() => {
  app?.dispose(); app = undefined; remote?.dispose(); remote = undefined; root?.remove();
  document.querySelectorAll('dialog').forEach(dialog => dialog.remove());
  history.replaceState(null, '', '/'); vi.restoreAllMocks(); vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'locks');
});
function click(label: string, scope: ParentNode = root): void {
  const b = [...scope.querySelectorAll('button')].find(b => b.textContent === label);
  expect(b, label).toBeDefined(); expect(b!.disabled, label).toBe(false); b!.click();
}
function btn(label: string): HTMLButtonElement { return [...root.querySelectorAll('button')].find(b => b.textContent === label)!; }
async function host(): Promise<void> {
  app = new App(root); click('オンライン対戦');
  await vi.waitFor(() => expect(root.querySelector('select')).not.toBeNull());
  root.querySelector('select')!.value = 'sente'; click('部屋を作る');
  await vi.waitFor(() => expect(network.create).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(root.textContent).toContain('相手を待っています'));
  remote = new OnlineSession({ role: 'guest', transport: room.connect(), roomKey: location.hash.slice(6), config: SANJU, storage: null });
  await vi.waitFor(() => expect(root.querySelectorAll('.mini-piece')).toHaveLength(20));
}
async function playing(): Promise<void> {
  await host(); click('配置を確定');
  await remote!.submitPlacement(defaultAssignment(SANJU));
  await vi.waitFor(() => expect(btn('投了')).toBeDefined());
  expect(root.querySelectorAll('.mini-piece')).toHaveLength(40);
}

describe('online screens with memory transport (no real network)', () => {
  it('shares localStorage across two Apps, assigns host/guest, plays and resumes each role', async () => {
    network.create.mockImplementation(async (_key, config) => {
      options = config;
      const endpoint = room.connect(); vi.spyOn(endpoint, 'leave');
      // MemoryRoom discovers peers immediately; model real discovery after async UI setup.
      endpoint.disconnect(); setTimeout(() => endpoint.reconnect(), 0);
      transport = endpoint; return endpoint;
    });
    app = new App(root); click('オンライン対戦');
    await vi.waitFor(() => expect(root.querySelector('select')).not.toBeNull());
    root.querySelector('select')!.value = 'sente'; click('部屋を作る');
    const roomKey = location.hash.slice(6);
    await vi.waitFor(() => expect(loadRoom(roomKey, undefined, 'host')).not.toBeNull());
    expect(locks.held.has(`sanju-shogi:${roomKey}:host`)).toBe(true);
    const guestRoot = document.createElement('div'); document.body.append(guestRoot);
    let guest: App | undefined;
    try {
      guest = new App(guestRoot);
      await vi.waitFor(() => expect(guestRoot.textContent).toContain('あなたは後手'));
      expect(network.create.mock.calls.map(([, config]) => config.role)).toEqual(['host', 'guest']);
      click('配置を確定'); click('配置を確定', guestRoot);
      await vi.waitFor(() => expect(guestRoot.querySelectorAll('.mini-piece')).toHaveLength(40));
      await vi.waitFor(() => expect(root.querySelectorAll('.mini-piece')).toHaveLength(40));
      await vi.waitFor(() => expect(root.textContent).toContain('あなたの手番です'));
      await vi.waitFor(() => expect(guestRoot.textContent).toContain('相手の手番です'));
      root.querySelector<HTMLButtonElement>('[data-square="9,7,1"]')!.click();
      root.querySelector<HTMLButtonElement>('[data-square="9,6,1"]')!.click();
      await vi.waitFor(() => expect(guestRoot.querySelectorAll('.notation li')).toHaveLength(1));
      expect(loadRoom(roomKey, undefined, 'host')?.myColor).toBe('sente');
      expect(loadRoom(roomKey, undefined, 'guest')?.myColor).toBe('gote');
      // Reload guest while host remains open, then reload host while guest remains open.
      guest.dispose();
      await vi.waitFor(() => expect(locks.held.has(`sanju-shogi:${roomKey}:guest`)).toBe(false));
      guest = new App(guestRoot);
      await vi.waitFor(() => expect(guestRoot.textContent).toContain('あなたの手番です'));
      expect(network.create).toHaveBeenLastCalledWith(roomKey, expect.objectContaining({ role: 'guest' }));
      app.dispose();
      await vi.waitFor(() => expect(locks.held.has(`sanju-shogi:${roomKey}:host`)).toBe(false));
      app = new App(root);
      await vi.waitFor(() => expect(root.textContent).toContain('相手の手番です'));
      expect(network.create).toHaveBeenLastCalledWith(roomKey, expect.objectContaining({ role: 'host' }));
      expect(root.querySelectorAll('.notation li')).toHaveLength(1);
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    } finally { guest?.dispose(); guestRoot.remove(); }
  });
  it.each([false, true])('shows an occupied-tab error without joining the network (host save=%s)', async hostSaved => {
    if (hostSaved) saveRoom(key, { v: 1, role: 'host', myColor: null, sync: { layers: 3, placements: null, moves: [] },
      setup: { assignment: null, salt: null, hash: null, peerHash: null } });
    locks.held.add(`sanju-shogi:${key}:guest`);
    if (hostSaved) locks.held.add(`sanju-shogi:${key}:host`);
    history.replaceState(null, '', `/#room=${key}`); app = new App(root);
    await vi.waitFor(() => expect(root.querySelector('[role="alert"]')?.textContent).toContain('この部屋はこのブラウザの別のタブで開かれています'));
    expect(network.create).not.toHaveBeenCalled();
    expect(locks.requested).toEqual(hostSaved ? [`sanju-shogi:${key}:host`, `sanju-shogi:${key}:guest`] : [`sanju-shogi:${key}:guest`]);
  });
  it('reads a legacy host save before acquiring its seat and keeps the saved draft', async () => {
    localStorage.setItem(`sanju-shogi:online:${key}`, JSON.stringify({ v: 1, role: 'host', myColor: 'gote',
      sync: { layers: 3, placements: null, moves: [] },
      setup: { assignment: Array<number>(20).fill(2), salt: key, hash: 'a'.repeat(64), peerHash: null } }));
    history.replaceState(null, '', `/#room=${key}`); app = new App(root);
    await vi.waitFor(() => expect(root.querySelectorAll('.mini-piece.gote')).toHaveLength(20));
    expect(locks.held.has(`sanju-shogi:${key}:host`)).toBe(true);
    expect(localStorage.getItem(`sanju-shogi:online:${key}`)).toBeNull();
    expect(loadRoom(key, undefined, 'host')?.setup?.assignment).toEqual(Array<number>(20).fill(2));
  });
  it('displays the specific duplicate-role error from hello', async () => {
    history.replaceState(null, '', `/#room=${key}`); app = new App(root);
    await vi.waitFor(() => expect(network.create).toHaveBeenCalledOnce());
    remote = new OnlineSession({ role: 'guest', roomKey: key, config: SANJU, transport: room.connect(), storage: null });
    await vi.waitFor(() => expect(root.querySelector('[role="alert"]')?.textContent).toContain('同じ役割の端末どうしがつながりました。招待リンクは作成者以外の人が開いてください'));
    expect(root.textContent).not.toContain('対局の記録が食い違ったため中断しました');
  });
  it('releases the role after transport creation fails', async () => {
    network.create.mockRejectedValueOnce(Error('offline'));
    history.replaceState(null, '', `/#room=${key}`); app = new App(root);
    await vi.waitFor(() => expect(root.textContent).toContain('オンライン対戦を開始できませんでした'));
    await vi.waitFor(() => expect(locks.held.size).toBe(0));
  });
  it('releases a late lock acquisition after the online UI has been disposed', async () => {
    const { OnlineUI } = await import('../src/ui/online');
    let proceed!: () => void;
    const gate = new Promise<void>(resolve => { proceed = resolve; });
    const ui = new OnlineUI({ show: content => root.replaceChildren(content), changed() {}, locks: {
      async request(name, config, callback) { await gate; await locks.request(name, config, callback); },
    } });
    ui.open(`#room=${key}`); ui.dispose(); proceed();
    await vi.waitFor(() => expect(locks.requested).toHaveLength(1));
    await vi.waitFor(() => expect(locks.held.size).toBe(0));
    expect(network.create).not.toHaveBeenCalled();
  });
  it('keeps host resumption working when Web Locks is unavailable', async () => {
    Reflect.deleteProperty(navigator, 'locks');
    saveRoom(key, { v: 1, role: 'host', myColor: null, sync: { layers: 3, placements: null, moves: [] },
      setup: { assignment: null, salt: null, hash: null, peerHash: null } });
    history.replaceState(null, '', `/#room=${key}`); app = new App(root);
    await vi.waitFor(() => expect(network.create).toHaveBeenCalledWith(key, expect.objectContaining({ role: 'host' })));
    expect(locks.requested).toEqual([]);
  });
  it('keeps online code idle on local entry and handles invalid invitations', async () => {
    app = new App(root); expect(network.create).not.toHaveBeenCalled();
    click('新規対局'); click('配置を始める'); expect(root.querySelectorAll('.mini-piece')).toHaveLength(20);
    expect(network.create).not.toHaveBeenCalled(); app.dispose();
    history.replaceState(null, '', '/#room=bad'); app = new App(root);
    await vi.waitFor(() => expect(root.textContent).toContain('招待リンクが正しくありません'));
    expect(network.create).not.toHaveBeenCalled(); click('タイトルへ'); expect(location.hash).toBe('');
  });
  it('creates a host invitation, copies and shares it, leaves and clears hash on return', async () => {
    const copy = vi.fn().mockResolvedValue(undefined), share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: copy }, configurable: true });
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    app = new App(root); click('オンライン対戦');
    await vi.waitFor(() => expect(root.querySelector('select')).not.toBeNull()); click('部屋を作る');
    await vi.waitFor(() => expect(network.create).toHaveBeenCalledOnce());
    expect(location.hash).toMatch(/^#room=[A-Za-z0-9_-]{22}$/);
    const invite = root.querySelector<HTMLInputElement>('input')!.value;
    expect(invite).toContain(location.hash); click('リンクをコピー'); click('共有');
    await vi.waitFor(() => expect(root.textContent).toContain('リンクをコピーしました'));
    expect(copy).toHaveBeenCalledWith(invite); expect(share).toHaveBeenCalledWith({ title: '三重将棋 — 対戦への招待', url: invite });
    click('タイトルへ'); expect(transport.leave).toHaveBeenCalledOnce(); expect(location.hash).toBe('');
    expect(root.querySelector('.title-screen')).not.toBeNull();
    Reflect.deleteProperty(navigator, 'clipboard'); Reflect.deleteProperty(navigator, 'share');
  });
  it('never renders the opponent during placement, reports commit as text and locks confirmed draft', async () => {
    await host(); expect(root.textContent).not.toContain('端末を');
    await remote!.submitPlacement(Array<number>(20).fill(2));
    await vi.waitFor(() => expect(root.textContent).toContain('相手は配置を確定しました'));
    expect(root.querySelectorAll('.mini-piece')).toHaveLength(20);
    expect(root.querySelectorAll('.mini-piece.gote')).toHaveLength(0);
    // Delay own digest so confirmed state can be inspected before reveal.
    const digest = webcrypto.subtle.digest.bind(webcrypto.subtle);
    let finish!: () => void;
    vi.spyOn(webcrypto.subtle, 'digest').mockImplementation(async (...args) => { await new Promise<void>(resolve => { finish = resolve; }); return digest(...args); });
    click('配置を確定');
    expect(btn('ランダム').disabled).toBe(true); expect(btn('配置を確定').disabled).toBe(true);
    expect(root.querySelectorAll('.mini-piece')).toHaveLength(20); expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    // Disposal must not draw a late reveal or touch the local save slot.
    click('タイトルへ'); finish();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(root.querySelectorAll('.mini-piece')).toHaveLength(0);
  });
  it('routes guest links directly to connecting, shows timeout and accepts a late host', async () => {
    history.replaceState(null, '', `/#room=${key}`); app = new App(root);
    await vi.waitFor(() => expect(network.create).toHaveBeenCalledWith(key, expect.objectContaining({ role: 'guest' })));
    expect(root.textContent).toContain('接続しています');
    options.onIssue!('部屋が見つかりません'); expect(root.textContent).toContain('部屋が見つかりません');
    remote = new OnlineSession({ role: 'host', hostColorChoice: 'gote', roomKey: key, config: SANJU, transport: room.connect(), storage: null });
    await vi.waitFor(() => expect(root.textContent).toContain('あなたは先手'));
    expect(root.querySelectorAll('.mini-piece.gote')).toHaveLength(0);
  });
  it('shows a full-room error and keeps the local game slot untouched', async () => {
    const leave = vi.fn();
    network.create.mockResolvedValueOnce({ send() {}, onPeerJoin() {}, onPeerLeave() {}, leave,
      onMessage(fn: (raw: unknown) => void) { queueMicrotask(() => fn({ type: 'full' })); } });
    history.replaceState(null, '', `/#room=${key}`); app = new App(root);
    await vi.waitFor(() => expect(root.textContent).toContain('この部屋は満員です'));
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull(); click('タイトルへ'); expect(leave).toHaveBeenCalledOnce();
  });
  it('disables the other turn and disconnected input, negotiates undo and resigns as own color', async () => {
    await playing(); expect(root.textContent).toContain('あなたの手番です');
    // Play by the same minimap interaction used locally.
    root.querySelector<HTMLButtonElement>('[data-square="9,7,1"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-square="9,6,1"]')!.click();
    await vi.waitFor(() => expect(remote!.game.moves).toHaveLength(1));
    expect(root.textContent).toContain('相手の手番です');
    expect([...root.querySelectorAll<HTMLButtonElement>('.square')].every(b => b.disabled)).toBe(true);
    remote!.requestUndo();
    await vi.waitFor(() => expect(document.querySelector('dialog')).not.toBeNull()); click('断る', document);
    await vi.waitFor(() => expect(remote!.pendingUndo).toBeUndefined()); expect(remote!.game.moves).toHaveLength(1);
    remote!.requestUndo(); await vi.waitFor(() => expect(document.querySelector('dialog')).not.toBeNull()); click('承認する', document);
    await vi.waitFor(() => expect(remote!.game.moves).toHaveLength(0));
    transport.disconnect(); await vi.waitFor(() => expect(root.textContent).toContain('相手との接続が切れました'));
    expect(btn('投了').disabled).toBe(true); expect(btn('待ったを申し込む').disabled).toBe(true);
    expect([...root.querySelectorAll<HTMLButtonElement>('.square')].every(b => b.disabled)).toBe(true);
    transport.reconnect(); await vi.waitFor(() => expect(btn('投了').disabled).toBe(false));
    // Opponent makes the next turn available to gote; host still resigns as sente.
    root.querySelector<HTMLButtonElement>('[data-square="9,7,1"]')!.click(); root.querySelector<HTMLButtonElement>('[data-square="9,6,1"]')!.click();
    await vi.waitFor(() => expect(remote!.game.moves).toHaveLength(1));
    click('投了'); expect(document.querySelector('dialog')!.textContent).toContain('先手が投了'); click('投了する', document);
    await vi.waitFor(() => expect(remote!.status).toBe('ended'));
    expect(root.textContent).toContain('後手の勝ち'); expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    click('タイトルへ'); expect(location.hash).toBe(''); expect(transport.leave).toHaveBeenCalledOnce();
  });
  it('resumes a saved host as host and renders only the saved own committed draft', async () => {
    saveRoom(key, { v: 1, role: 'host', myColor: 'gote', sync: { layers: 3, placements: null, moves: [] },
      setup: { assignment: Array<number>(20).fill(2), salt: key, hash: 'a'.repeat(64), peerHash: null } });
    history.replaceState(null, '', `/#room=${key}`); app = new App(root);
    await vi.waitFor(() => expect(network.create).toHaveBeenCalledWith(key, expect.objectContaining({ role: 'host' })));
    await vi.waitFor(() => expect(root.querySelectorAll('.mini-piece')).toHaveLength(20));
    expect(root.querySelectorAll('.mini-piece.gote')).toHaveLength(20); expect(btn('配置を確定').disabled).toBe(true);
  });
  it('resumes public saved state directly and follows a replacement Game after synchronization', async () => {
    const assignment = defaultAssignment(SANJU);
    saveRoom(key, { v: 1, role: 'host', myColor: 'sente', sync: { layers: 3, placements: { sente: assignment, gote: assignment }, moves: [] } });
    history.replaceState(null, '', `/#room=${key}`); app = new App(root);
    await vi.waitFor(() => expect(root.querySelectorAll('.mini-piece')).toHaveLength(40));
    expect(btn('投了').disabled).toBe(true);
    // Peer is one move ahead; hello.resume must replace the UI's Game.
    const peerGame = new (await import('../src/core/game')).Game(SANJU);
    peerGame.submitPlacement('sente', assignment); peerGame.submitPlacement('gote', assignment);
    const move = peerGame.legalMoves()[0]!;
    const { encodeMove } = await import('../src/core/serialize');
    const saved = { v: 1 as const, role: 'guest' as const, myColor: 'gote' as const, sync: { layers: 3, placements: { sente: assignment, gote: assignment }, moves: [encodeMove(move)] } };
    remote = new OnlineSession({ role: 'guest', config: SANJU, roomKey: key, transport: room.connect(), storage: { load: () => saved, save() {}, clear() {} } });
    await vi.waitFor(() => expect(root.querySelectorAll('.notation li')).toHaveLength(1));
    expect(root.textContent).toContain('相手の手番です'); expect(root.textContent).not.toContain('両者の配置を公開しています');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
  it('leaves a transport whose asynchronous creation finishes after navigating away', async () => {
    let finish!: (transport: MemoryTransport) => void;
    network.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    history.replaceState(null, '', `/#room=${key}`); app = new App(root);
    await vi.waitFor(() => expect(network.create).toHaveBeenCalledOnce()); click('タイトルへ');
    await vi.waitFor(() => expect(locks.held.size).toBe(0));
    const late = room.connect(); const leave = vi.spyOn(late, 'leave'); finish(late);
    await vi.waitFor(() => expect(leave).toHaveBeenCalledOnce()); expect(root.querySelector('.title-screen')).not.toBeNull();
  });
  it('restores the same online host on BFCache return while dropping rendered private pieces', async () => {
    saveRoom(key, { v: 1, role: 'host', myColor: 'sente', sync: { layers: 3, placements: null, moves: [] },
      setup: { assignment: defaultAssignment(SANJU), salt: key, hash: 'a'.repeat(64), peerHash: null } });
    history.replaceState(null, '', `/#room=${key}`);
    const { mountApp } = await import('../src/main'); const cleanup = mountApp(root);
    try {
      await vi.waitFor(() => expect(root.querySelectorAll('.mini-piece')).toHaveLength(20));
      const first = transport;
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      expect(root.childElementCount).toBe(0); expect(first.leave).toHaveBeenCalledOnce();
      expect(location.hash).toBe(`#room=${key}`);
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      await vi.waitFor(() => expect(network.create).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(root.querySelectorAll('.mini-piece')).toHaveLength(20));
      expect(network.create).toHaveBeenLastCalledWith(key, expect.objectContaining({ role: 'host' }));
    } finally { cleanup(); }
  });
});
