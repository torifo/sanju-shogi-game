import './online.css';
import type { Color } from '../core/types';
import { buildInviteUrl, createRoomKey, readRoomKey } from '../net/roomKey';
import { chooseHostColor, parseMessage, type Role, type Transport } from '../net/protocol';
import { OnlineSession } from '../net/session';
import { acquireRoleLock, ROOM_OPEN_IN_ANOTHER_TAB, type RoleLockManager, type ReleaseRoleLock } from '../net/roleLock';
import { loadRoom, saveRoom, hasLegacyPublicRoom, type StorageLike } from '../net/storage';
import { createTrysteroTransport } from '../net/transport';
import { button, colorName, el, heading } from './dom';
import { canPlayOnline, onlineBoardScreen, onlineEntry } from './onlineRouting';
import { chooseDialog } from './promotion';

interface OnlineUIOptions {
  show: (content: HTMLElement) => void;
  changed: () => void;
  locks?: RoleLockManager;
}
/** Loaded only by the online entry point. Session remains the source of truth. */
export class OnlineUI {
  session?: OnlineSession;
  roomKey = '';
  role: Role = 'guest';
  submitted = false;
  peerCommitted = false;
  assignment?: number[];
  notice = '';
  publicSeen = false;
  private disposed = false;
  private unsubscribe?: () => void;
  private starting = false;
  private releaseRoleLock?: ReleaseRoleLock;
  private statusMessage?: HTMLElement;
  private shareMessage?: HTMLElement;

  private readonly tabStorage?: StorageLike;
  private rememberedRole?: Role;
  constructor(private readonly options: OnlineUIOptions) {
    try { this.tabStorage = globalThis.sessionStorage; } catch { /* Storage may be denied. */ }
  }
  open(hash: string): void {
    const key = readRoomKey(hash);
    this.rememberedRole = undefined;
    try {
      const role = key ? this.tabStorage?.getItem(`sanju-shogi:tab-role:${key}`) : null;
      if (role === 'host' || role === 'guest') this.rememberedRole = role;
    } catch { /* Fall back to role-specific persistent saves. */ }
    if (key && hasLegacyPublicRoom(key, this.rememberedRole)) {
      this.showError('保存された対局は旧形式のため安全に再開できません。新しい部屋を作成してください。'); return;
    }
    const saved = key ? loadRoom(key, undefined, this.rememberedRole) : null;
    const entry = onlineEntry(hash, this.rememberedRole ? { role: this.rememberedRole, layers: saved?.sync.layers ?? 3 }
      : saved ? { role: saved.role, layers: saved.sync.layers } : null);
    if (entry.kind === 'invalid') { this.showError('招待リンクが正しくありません。送られたリンク全体を開いてください。'); return; }
    if (entry.kind === 'room') { void this.connect(entry.roomKey, entry.role, entry.layers); return; }
    this.showCreate();
  }
  private page(title: string, description: string): HTMLElement {
    const main = el('main', 'online-screen paper');
    main.append(heading('オンライン対戦 / 招待リンク', title, description));
    return main;
  }
  private showCreate(): void {
    const main = this.page('部屋を作る', '招待リンクを相手に送って、ふたりの端末で対局します。');
    const label = el('label', 'online-color'); label.append(el('span', '', 'あなたの手番'));
    const select = el('select'); select.setAttribute('aria-label', 'あなたの手番');
    for (const [value, text] of [['random', 'ランダム'], ['sente', '先手'], ['gote', '後手']]) select.append(new Option(text, value));
    label.append(select);
    main.append(label, button('部屋を作る', () => {
      if (this.starting || this.disposed) return;
      const key = createRoomKey();
      const color = chooseHostColor(select.value as Color | 'random');
      // Save at the click, before lock acquisition or the network module can yield.
      saveRoom(key, { v: 2, role: 'host', myColor: color,
        sync: { layers: 3, placements: null, reveals: null, undo: null, moves: [] },
        setup: { assignment: null, salt: null, hash: null, peerHash: null } });
      try { this.tabStorage?.setItem(`sanju-shogi:tab-role:${key}`, 'host'); } catch { /* Best effort. */ }
      history.replaceState(null, '', buildInviteUrl(location.href, key));
      void this.connect(key, 'host', 3, color);
    }, 'primary'));
    this.options.show(main);
  }
  private async connect(key: string, role: Role, layers: number, hostColorChoice?: Color | 'random'): Promise<void> {
    if (this.disposed || this.starting) return;
    this.starting = true; this.roomKey = key; this.role = role;
    this.showLobby();
    let transport: Transport | undefined;
    try {
      // A creator needs the host seat. Invitations may use guest if another tab owns host.
      const candidates: Role[] = !this.rememberedRole && role === 'host' && hostColorChoice === undefined ? ['host', 'guest'] : [role];
      for (const candidate of candidates) {
        const release = await acquireRoleLock(key, candidate, this.options.locks);
        if (this.disposed) { release?.(); return; }
        if (release) { this.releaseRoleLock = release; role = candidate; break; }
      }
      if (!this.releaseRoleLock) { this.showError(ROOM_OPEN_IN_ANOTHER_TAB); return; }
      this.role = role;
      try { this.tabStorage?.setItem(`sanju-shogi:tab-role:${key}`, role); } catch { /* Best effort. */ }
      const saved = loadRoom(key, undefined, role);
      layers = saved?.sync.layers ?? layers;
      this.submitted = saved?.setup?.assignment != null;
      this.assignment = saved?.setup?.assignment ? [...saved.setup.assignment] : undefined;
      this.peerCommitted = saved?.setup?.peerHash != null;
      this.publicSeen = saved?.sync.placements != null;
      this.showLobby();
      transport = await createTrysteroTransport(key, { role, onIssue: message => {
        if (this.disposed) return;
        this.notice = message; this.refresh();
      } });
      if (this.disposed) { transport.leave(); return; }
      // Observe only the fact of a commit, never the opponent's private assignment.
      const observed: Transport = {
        send: msg => transport!.send(msg),
        onMessage: fn => transport!.onMessage(raw => {
          if (parseMessage(raw)?.type === 'commit') this.peerCommitted = true;
          fn(raw);
        }),
        onPeerJoin: fn => transport!.onPeerJoin(fn), onPeerLeave: fn => transport!.onPeerLeave(fn),
        leave: () => transport!.leave(),
      };
      this.session = new OnlineSession({ role, roomKey: key, hostColorChoice, transport: observed, config: { files: 9, ranks: 9, layers } });
      this.unsubscribe = this.session.subscribe(() => this.refresh());
      this.refresh();
    } catch {
      transport?.leave();
      this.releaseRoleLock?.(); this.releaseRoleLock = undefined;
      if (!this.disposed) this.showError('オンライン対戦を開始できませんでした。ページを再読み込みしてお試しください。');
    }
  }
  private refresh(): void {
    if (this.disposed) return;
    const session = this.session;
    if (!session || (session.status === 'waiting' && !this.submitted && !this.publicSeen) || onlineBoardScreen(session.game.phase.kind, session.myColor) === 'lobby') {
      if (session?.error) this.showError(session.error);
      else if (this.statusMessage) this.statusMessage.textContent = this.notice || (session?.status === 'disconnected'
        ? '相手との接続が切れました。相手がリンクを開き直すと再開します'
        : this.role === 'host' ? '相手を待っています' : '接続しています');
      return;
    }
    this.options.changed();
  }
  showLobby(): void {
    const main = this.page(this.role === 'host' ? '招待リンクを送る' : '部屋に接続', 'この画面を開いたままお待ちください。再開するときも同じリンクを使います。');
    this.statusMessage = el('p', 'status-banner', this.role === 'host' ? '相手を待っています' : '接続しています');
    this.statusMessage.setAttribute('role', 'status'); main.append(this.statusMessage);
    if (this.role === 'host') {
      const label = el('label', 'invite-label', '招待リンク');
      const input = el('input', 'invite-link'); input.readOnly = true; input.value = buildInviteUrl(location.href, this.roomKey);
      input.setAttribute('aria-label', '招待リンク'); input.addEventListener('click', () => input.select()); label.append(input);
      const actions = el('div', 'button-row'); this.shareMessage = el('p', 'muted'); this.shareMessage.setAttribute('role', 'status');
      actions.append(button('リンクをコピー', () => { void this.copy(input.value); }));
      if (typeof navigator.share === 'function') actions.append(button('共有', () => { void this.share(input.value); }));
      main.append(label, actions, this.shareMessage);
    }
    main.append(el('p', 'muted', '会社のネットワークや一部の回線では接続できないことがあります。リンクを知っている人だけが参加できます。'));
    this.options.show(main);
  }
  private async copy(url: string): Promise<void> {
    try { await navigator.clipboard.writeText(url); if (!this.disposed && this.shareMessage) this.shareMessage.textContent = 'リンクをコピーしました'; }
    catch { if (!this.disposed && this.shareMessage) this.shareMessage.textContent = 'コピーできませんでした。上のリンクを選択してコピーしてください。'; }
  }
  private async share(url: string): Promise<void> {
    try { await navigator.share({ title: '三重将棋 — 対戦への招待', url }); }
    catch (error) { if (!this.disposed && this.shareMessage && !(error instanceof DOMException && error.name === 'AbortError')) this.shareMessage.textContent = '共有できませんでした。リンクをコピーして送ってください。'; }
  }
  private showError(message: string): void {
    const main = this.page('接続を確認してください', message); main.setAttribute('role', 'alert'); this.options.show(main);
  }
  canPlay(): boolean {
    const s = this.session;
    return !!s && canPlayOnline(s.status, s.myColor, s.game.position?.sideToMove, !!s.pendingUndo);
  }
  canPlace(): boolean { return !!this.session && this.session.status === 'placing' && !this.submitted; }
  /** Online-specific panel text and input policy stay in this lazy module. */
  decorateBoard(screen: string, panels: { status: HTMLElement; controls: HTMLElement; left: HTMLElement; right: HTMLElement }, busy: boolean): void {
    const s = this.session;
    if (!s) return;
    if (screen === 'placement') {
      panels.status.replaceChildren(el('p', 'status-banner', this.placementText()));
      if (!this.canPlace() || busy) panels.controls.querySelectorAll('button').forEach(b => { b.disabled = true; });
    } else if (screen === 'game') {
      const text = s.error || (s.status === 'disconnected' ? '相手との接続が切れました。相手がリンクを開き直すと再開します'
        : ['waiting', 'connected'].includes(s.status) ? '接続しています'
          : s.pendingUndo ? s.pendingUndo.direction === 'outgoing' ? '待ったの返事を待っています' : '相手から待ったの申し入れがあります'
            : `あなたは${colorName(s.myColor!)}です。${s.game.phase.kind === 'ended' ? '対局終了' : this.canPlay() ? 'あなたの手番です' : '相手の手番です'}`);
      panels.status.append(el('p', 'status-banner', text));
      if (!this.canPlay()) for (const panel of [panels.left, panels.right]) panel.querySelectorAll('button').forEach(b => { b.disabled = true; });
    }
  }
  async promptUndo(signal: AbortSignal): Promise<void> {
    const session = this.session, pending = session?.pendingUndo;
    if (!session || !pending) return;
    const choice = await chooseDialog('待ったの申し入れ', '相手が一手戻すことを希望しています。承認しますか。', ['承認する', '断る'], signal);
    if (signal.aborted || this.disposed || session.pendingUndo !== pending) return;
    try { session.replyUndo(choice === 0); }
    catch (error) { this.notice = error instanceof Error ? error.message : '待ったに返事できませんでした'; this.refresh(); }
  }
  placementText(): string {
    if (this.session?.error) return this.session.error;
    if (this.session?.status === 'disconnected') return '相手との接続が切れました。相手がリンクを開き直すと再開します';
    if (this.session && ['waiting', 'connected'].includes(this.session.status)) return '接続しています';
    return [this.session?.myColor ? `あなたは${colorName(this.session.myColor)}です。自分の配置のみ表示中。` : '',
      this.submitted ? '配置を確定しました。相手の確定と照合を待っています。' : '相手の配置は非公開です。',
      this.peerCommitted ? '相手は配置を確定しました' : ''].filter(Boolean).join('\n');
  }
  async submit(assignment: number[]): Promise<void> {
    if (!this.canPlace()) return;
    this.submitted = true; this.assignment = [...assignment];
    await this.session!.submitPlacement(assignment);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.unsubscribe?.(); this.session?.dispose(); this.assignment = undefined;
    this.releaseRoleLock?.(); this.releaseRoleLock = undefined;
  }
}
