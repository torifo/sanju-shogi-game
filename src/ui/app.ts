import { SANJU } from '../core/config';
import { Game } from '../core/game';
import { kanjiNumber, layerNames } from '../core/notation';
import { isInCheck } from '../core/rules';
import type { HandKind, Move, Square } from '../core/types';
import type { BoardView } from '../render/scene';
import { sameSquare, squareKey, type Highlights, type RenderPiece } from '../render/types';
import { button, colorName, el, heading } from './dom';
import { handoff } from './handoff';
import { Minimap } from './minimap';
import { Placement } from './placement';
import { clearSavedGame, persistGame, readSavedGame } from './storage';
import type { OnlineUI } from './online';

type Screen = 'title' | 'online' | 'handoff' | 'placement' | 'reveal' | 'game';
type Selection = { kind: 'board'; sq: Square } | { kind: 'hand'; piece: HandKind };

export class App {
  private game = new Game(SANJU);
  private screen: Screen = 'title';
  private draft?: Placement;
  private view?: BoardView;
  private minimap?: Minimap;
  private selection?: Selection;
  private legal: Move[] = [];
  private unsubscribe?: () => void;
  private screenEvents = new AbortController();
  private readonly events = new AbortController();
  private panels?: { status: HTMLElement; controls: HTMLElement; left: HTMLElement; right: HTMLElement; message: HTMLElement };
  private busy = false;
  private epoch = 0;
  private savedWarning = '';
  private fallback = false;
  private online?: OnlineUI;
  private boardPanels?: typeof import('./boardPanels');
  private actionEvents = new AbortController();

  constructor(private readonly root: HTMLElement) {
    window.addEventListener('keydown', e => {
      if (this.screen !== 'placement' || !this.draft || (this.online && !this.online.canPlace()) || e.ctrlKey || e.metaKey || e.altKey || /INPUT|SELECT|TEXTAREA/.test((e.target as HTMLElement)?.tagName)) return;
      if (/^[1-9]$/.test(e.key)) {
        const z = Number(e.key) - 1;
        if (z < this.game.config.layers) { e.preventDefault(); this.draft.setLayer(z); this.update(); }
      }
    }, { signal: this.events.signal });
    this.title(false);
    if (location.hash.startsWith('#room=')) void this.startOnline(location.hash);
    window.addEventListener('hashchange', () => {
      if (location.hash.startsWith('#room=')) void this.startOnline(location.hash);
      else if (this.online || this.screen === 'online') this.title();
    }, { signal: this.events.signal });
  }

  private resetScreen(screen: Screen): void {
    this.epoch++; this.screenEvents.abort(); this.screenEvents = new AbortController();
    this.actionEvents.abort(); this.actionEvents = new AbortController();
    this.view?.dispose(); this.view = undefined; this.minimap = undefined; this.panels = undefined;
    this.selection = undefined; this.busy = false; this.screen = screen; this.root.replaceChildren();
  }
  private header(): HTMLElement {
    const config = this.screen === 'title' ? SANJU : this.game.config;
    const header = el('header', 'site-header');
    header.append(el('span', 'brand', '三重将棋'), el('span', 'brand-sub', `SANJU SHOGI / ${kanjiNumber(config.files)} × ${kanjiNumber(config.ranks)} × ${kanjiNumber(config.layers)}`));
    if (this.screen !== 'title') header.append(button('タイトルへ', () => this.title(), 'quiet'));
    return header;
  }
  private attachGame(game: Game): void {
    this.unsubscribe?.(); this.game = game;
    this.unsubscribe = game.subscribe(() => {
      if (this.screen !== 'game') return;
      this.selection = undefined; this.legal = this.game.legalMoves(); this.save(); this.update();
    });
  }
  private save(): void {
    if (this.online) return;
    if (!persistGame(this.game)) this.savedWarning = '保存できませんでした。対局は続けられますが、この画面を閉じると続きから再開できません。';
  }
  private title(clearInvite = true): void {
    this.online?.dispose(); this.online = undefined;
    if (clearInvite && location.hash.startsWith('#room=')) history.replaceState(null, '', location.pathname + location.search);
    this.resetScreen('title'); this.unsubscribe?.(); this.unsubscribe = undefined; this.draft = undefined;
    const saved = readSavedGame();
    const hero = el('main', 'title-screen'); const intro = el('section', 'title-intro');
    intro.append(heading('立体で、次の一手を。', '三重将棋', '九筋、九段、三つの層。\n馴染みの駒に、高さという選択肢を。'));
    const actions = el('div', 'title-actions');
    actions.append(button('新規対局', () => this.newGame(), 'primary'));
    const resume = button('続きから', () => {
      if (!saved.game) return;
      this.attachGame(saved.game); this.mountBoard('game'); this.legal = this.game.legalMoves(); this.update();
    }); resume.disabled = !saved.game; actions.append(resume, button('オンライン対戦', () => { void this.startOnline(); }));
    intro.append(actions, el('p', 'muted', '1台で、ふたり。秘密の配置を同時に公開して始めます。'));
    if (saved.message) intro.append(el('p', 'notice', saved.message));
    const illustration = el('div', 'title-illustration'); illustration.setAttribute('aria-hidden', 'true');
    for (let z = 0; z < 3; z++) { const slab = el('div', `title-slab slab-${z}`); slab.append(el('span', 'title-piece', ['歩', '角', '玉'][z]!)); illustration.append(slab); }
    hero.append(intro, illustration);
    const guide = el('section', 'title-guide');
    for (const [n, title, text] of [
      ['一', '層を決める', '駒の筋・段はそのままに、自分だけの配置を。'],
      ['二', '同時に公開', '互いの配置を見せずに確定。三層へ一斉に展開。'],
      ['三', '立体を読む', '平面の動きに上下の一層。展開図でも指せます。'],
    ]) { const item = el('article'); item.append(el('span', 'guide-number', n), el('h2', '', title), el('p', '', text)); guide.append(item); }
    this.root.append(this.header(), hero, guide, el('footer', '', '三重将棋 · ローカル / オンライン2人対戦 · 持ち時間なし'));
  }
  private async startOnline(hash = ''): Promise<void> {
    this.online?.dispose(); this.online = undefined;
    this.unsubscribe?.(); this.unsubscribe = undefined; this.draft = undefined; this.savedWarning = '';
    this.game = new Game(SANJU);
    this.resetScreen('online'); this.root.append(this.header(), el('p', 'status-banner', 'オンライン対戦を準備しています'));
    const epoch = this.epoch;
    try {
      const { OnlineUI } = await import('./online');
      if (epoch !== this.epoch) return;
      this.online = new OnlineUI({ show: content => {
        this.resetScreen('online'); this.root.append(this.header(), content);
      }, changed: () => this.syncOnline() });
      this.online.open(hash);
    } catch {
      if (epoch === this.epoch) this.root.append(el('p', 'notice', 'オンライン対戦を読み込めませんでした。ページを再読み込みしてください。'));
    }
  }
  private syncOnline(): void {
    const online = this.online, session = online?.session;
    if (!online || !session || !session.myColor) return;
    // Reconnection may replace Game. Never retain a subscription to an older Game.
    this.game = session.game; this.selection = undefined;
    this.actionEvents.abort(); this.actionEvents = new AbortController(); this.busy = false;
    if (this.game.phase.kind === 'placing') {
      if (this.screen !== 'placement') {
        this.draft = new Placement(this.game.config, session.myColor);
        if (online.assignment) this.draft.assignment = [...online.assignment];
        void this.mountBoard('placement');
      }
    } else if (!online.publicSeen) {
      online.publicSeen = true; this.draft = undefined; void this.reveal();
    } else if (this.screen !== 'game' && this.screen !== 'reveal') {
      this.draft = undefined; void this.mountBoard('game');
    }
    this.legal = this.game.legalMoves(); this.update();
    if (session.pendingUndo?.direction === 'incoming' && session.status === 'playing') void online.promptUndo(this.actionEvents.signal);
  }
  private newGame(): void {
    this.savedWarning = clearSavedGame() ? '' : '保存領域を利用できません。配置は保存せず、この画面内で対局できます。';
    this.attachGame(new Game(SANJU)); this.showHandoff();
  }
  private showHandoff(): void {
    this.resetScreen('handoff'); this.draft = undefined;
    if (this.game.phase.kind !== 'placing') return;
    const color = this.game.phase.color;
    this.root.append(this.header(), handoff(color, () => {
      this.draft = new Placement(this.game.config, color); this.mountBoard('placement'); this.update();
    })); this.root.querySelector<HTMLButtonElement>('.primary')?.focus();
  }
  private async mountBoard(screen: 'placement' | 'reveal' | 'game'): Promise<void> {
    this.resetScreen(screen);
    const main = el('main', 'play-screen'); const top = el('div', 'play-heading');
    top.append(heading(screen === 'placement' ? '秘密配置' : screen === 'reveal' ? '同時公開' : '対局', screen === 'placement' && this.draft ? `${colorName(this.draft.color)}の配置` : screen === 'reveal' ? 'ふたつの布陣が、出会う。' : `${kanjiNumber(this.game.config.layers)}層の盤`, screen === 'placement' ? '表示されるのは自分の駒だけです。20枚の層を自由に選んでください。' : '駒を選び、緑のマスへ。展開図からも同じ操作ができます。'));
    const status = el('div'); const controls = el('div'); const layout = el('div', 'board-layout');
    const left = el('aside', 'side-panel paper'); const center = el('section', 'board-center'); const right = el('aside', 'side-panel paper');
    const stage = el('div', 'board-stage'); const toolbar = el('div', 'view-toolbar'); const message = el('p', 'notice');
    stage.append(el('span', 'stage-caption', '三重将棋 / 3D BOARD'));
    const epoch = this.epoch;
    this.fallback = false;
    toolbar.hidden = true;
    const loading = el('p', '', '盤を準備しています'); loading.setAttribute('role', 'status'); stage.append(loading);
    const makeMinimap = (): void => {
      this.minimap?.element.remove();
      this.minimap = new Minimap(this.game.config.layers, sq => { void this.pick(sq); }, screen === 'placement' ? (sq, delta) => { if (this.online && !this.online.canPlace()) return; this.draft?.drag(sq, delta); this.update(); } : undefined, this.fallback);
      center.append(this.minimap.element);
    };
    const fallback = (): void => {
      this.fallback = true; this.view?.dispose(); this.view = undefined;
      toolbar.hidden = true; stage.classList.add('unavailable');
      stage.replaceChildren(el('p', '', '3D表示を利用できません。下の展開図で、配置から対局まですべて操作できます。'));
    };
    stage.addEventListener('board-context-lost', () => { fallback(); makeMinimap(); this.update(); }, { signal: this.screenEvents.signal });
    center.append(stage, toolbar); makeMinimap(); layout.append(left, center, right); main.append(top, status, layout, controls, message);
    this.panels = { status, controls, left, right, message }; this.root.append(this.header(), main);
    try {
      this.boardPanels ??= await import('./boardPanels');
      if (epoch !== this.epoch) return;
      const { BoardView, isWebGLAvailable } = await import('../render/scene');
      if (epoch !== this.epoch) return;
      if (!isWebGLAvailable()) { fallback(); makeMinimap(); this.update(); return; }
      stage.replaceChildren(el('span', 'stage-caption', '三重将棋 / 3D BOARD'));
      this.view = new BoardView(stage, { layers: this.game.config.layers, layerGap: 2.2 });
      this.view.onPick(({ sq }) => { void this.pick(sq); });
      if (screen === 'placement') this.view.onLayerDrag((sq, delta) => { if (this.online && !this.online.canPlace()) return; this.draft?.drag(sq, delta); this.update(); });
      this.boardPanels.buildViewToolbar(toolbar, this.game.config.layers, () => this.view); toolbar.hidden = false;
      this.update();
    } catch {
      if (epoch !== this.epoch) return;
      fallback(); makeMinimap(); this.update();
    }
  }
  private pieces(): RenderPiece[] {
    if (this.screen === 'placement') return this.draft?.pieces() ?? [];
    const pos = this.game.position;
    if (!pos || (this.screen !== 'game' && this.screen !== 'reveal')) return [];
    return pos.cells.flatMap((piece, i) => piece ? [{ sq: { x: i % 9 + 1, y: Math.floor(i / 9) % 9 + 1, z: Math.floor(i / 81) }, piece: { ...piece } }] : []);
  }
  private selectedMoves(): Move[] {
    const selection = this.selection;
    return !selection ? [] : this.legal.filter(m => selection.kind === 'board' ? m.kind === 'move' && sameSquare(selection.sq, m.from) : m.kind === 'drop' && m.piece === selection.piece);
  }
  private highlights(): Highlights {
    if (this.screen === 'placement') return { targets: [], selected: this.draft?.selected != null ? this.draft.pieces()[this.draft.selected]?.sq : undefined };
    const pos = this.game.position; const last = this.game.moves.at(-1);
    const check = pos && isInCheck(pos, pos.sideToMove) ? pos.findKing(pos.sideToMove) ?? undefined : undefined;
    return { selected: this.selection?.kind === 'board' ? this.selection.sq : undefined, targets: [...new Map(this.selectedMoves().map(m => [squareKey(m.to), m.to])).values()], lastMove: last ? last.kind === 'move' ? [last.from, last.to] : [last.to] : [], check };
  }
  private update(): void {
    if (!this.panels) return;
    const pieces = this.pieces(); const highlights = this.highlights();
    this.view?.setPieces(pieces); this.view?.setHighlights(highlights);
    const online = this.online, session = online?.session;
    const editable = !online || (this.screen === 'placement' ? online.canPlace() : online.canPlay());
    this.minimap?.update(pieces, highlights, this.screen !== 'reveal' && !this.busy && editable);
    const { status, controls, left, right, message } = this.panels;
    message.textContent = session?.error || online?.notice || this.savedWarning;
    message.setAttribute('role', 'status');
    if (this.screen === 'placement' && this.draft) {
      status.replaceChildren(el('p', 'status-banner', `${colorName(this.draft.color)}のみ表示中 — 相手の配置は非公開です`));
      controls.replaceChildren(this.draft.controls(() => this.update(), () => this.submitPlacement()));
      left.replaceChildren(el('h2', '', '配置の手順'), el('p', '', `1. 駒を選ぶ\n2. ${layerNames(this.game.config.layers).reverse().join('・')}を選ぶ\n3. 20枚を確認して確定`));
      right.replaceChildren(el('h2', '', '自由な布陣'), el('p', '', '初期位置の筋と段は固定です。すべて同じ層でも、ランダムでも構いません。'));
    } else if (this.screen === 'reveal') {
      status.replaceChildren(el('p', 'status-banner', '両者の配置を公開しています…'));
      left.replaceChildren(el('h2', '', '先手')); right.replaceChildren(el('h2', '', '後手')); controls.replaceChildren();
    } else if (this.screen === 'game' && this.boardPanels) {
      const { banner, hands, moveLog } = this.boardPanels;
      status.replaceChildren(banner(this.game, this.selection !== undefined));
      const selectedHand = this.selection?.kind === 'hand' ? this.selection.piece : undefined;
      left.replaceChildren(hands(this.game, 'sente', selectedHand, p => this.selectHand(p)));
      right.replaceChildren(hands(this.game, 'gote', selectedHand, p => this.selectHand(p)), moveLog(this.game.notation));
      controls.replaceChildren(this.boardPanels.gameControls(this.game, this.busy, online,
        () => this.act(() => online ? online.session!.requestUndo() : this.game.undo()), () => { void this.resign(); }));
    }
    online?.decorateBoard(this.screen, this.panels, this.busy);
  }
  private submitPlacement(): void {
    if (this.screen !== 'placement' || !this.draft || this.busy) return;
    if (this.online) {
      if (!this.online.canPlace()) return;
      const online = this.online; this.busy = true;
      void online.submit(this.draft.assignment).catch(error => { if (this.online === online) this.error(error); }).finally(() => {
        if (this.online === online) { this.busy = false; this.update(); }
      });
      this.update(); return;
    }
    const draft = this.draft; this.busy = true;
    // Remove all secret draft data from renderers before changing the active player.
    this.resetScreen(draft.color === 'sente' ? 'handoff' : 'reveal');
    try {
      this.game.submitPlacement(draft.color, draft.assignment); this.draft = undefined;
      if (draft.color === 'sente') this.showHandoff(); else void this.reveal();
    } catch (error) {
      this.draft = draft; this.mountBoard('placement'); this.update(); this.error(error);
    }
  }
  private async reveal(): Promise<void> {
    const mounting = this.mountBoard('reveal'); this.update(); const epoch = this.epoch;
    await mounting;
    if (this.epoch !== epoch) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Both renderers receive both sides for the first time only in this public screen.
    this.minimap?.element.classList.add('revealing');
    if (this.view) await this.view.animateReveal(reduced ? 1 : 1400);
    else await new Promise(resolve => window.setTimeout(resolve, reduced ? 1 : 900));
    if (this.epoch !== epoch) return;
    this.mountBoard('game'); this.legal = this.game.legalMoves(); this.save(); this.update();
  }
  private async pick(sq: Square): Promise<void> {
    if (this.busy) return;
    if (this.online && !(this.screen === 'placement' ? this.online.canPlace() : this.online.canPlay())) return;
    if (this.screen === 'placement') { this.draft?.select(sq); this.update(); return; }
    if (this.screen !== 'game' || this.game.phase.kind !== 'playing' || !this.boardPanels) return;
    const candidates = this.selectedMoves().filter(m => sameSquare(m.to, sq));
    if (candidates.length) {
      this.busy = true; this.update(); const epoch = this.epoch;
      let move = candidates[0]!;
      if (candidates.some(m => m.kind === 'move' && m.promote) && candidates.some(m => m.kind === 'move' && !m.promote)) {
        const signal = this.actionEvents.signal;
        const choice = await this.boardPanels!.promotion(signal);
        if (this.epoch !== epoch || signal.aborted) return;
        if (choice === null) { this.busy = false; this.update(); return; }
        move = candidates.find(m => m.kind === 'move' && m.promote === (choice === 0))!;
      }
      this.busy = false; this.act(() => this.online ? this.online.session!.play(move) : this.game.play(move)); return;
    }
    const piece = this.game.position?.get(sq);
    this.selection = piece?.color === this.game.position?.sideToMove && piece ? this.selection?.kind === 'board' && sameSquare(this.selection.sq, sq) ? undefined : { kind: 'board', sq: { ...sq } } : undefined;
    this.update();
  }
  private selectHand(piece: HandKind): void {
    if (this.busy || this.game.phase.kind !== 'playing' || this.online && !this.online.canPlay()) return;
    this.selection = this.selection?.kind === 'hand' && this.selection.piece === piece ? undefined : { kind: 'hand', piece }; this.update();
  }
  private async resign(): Promise<void> {
    if (this.busy || this.game.phase.kind !== 'playing' || !this.game.position || this.online && this.online.session?.status !== 'playing') return;
    this.busy = true; this.update(); const epoch = this.epoch;
    const signal = this.actionEvents.signal;
    const choice = await this.boardPanels!.chooseDialog('投了しますか', `${colorName(this.online?.session?.myColor ?? this.game.position.sideToMove)}が投了すると対局が終了します。`, ['投了する'], signal);
    if (this.epoch !== epoch || signal.aborted) return;
    this.busy = false;
    if (choice === 0) this.act(() => this.online ? this.online.session!.resign() : this.game.resign(this.game.position!.sideToMove)); else this.update();
  }
  private act(action: () => void): void {
    if (this.busy) return;
    try { action(); } catch (error) { this.error(error); }
  }
  private error(error: unknown): void {
    if (this.panels) { this.panels.message.textContent = error instanceof Error ? error.message : '操作できませんでした。もう一度お試しください。'; this.panels.message.setAttribute('role', 'alert'); }
  }
  dispose(): void {
    this.online?.dispose(); this.online = undefined;
    this.resetScreen('title'); this.unsubscribe?.(); this.unsubscribe = undefined; this.events.abort();
    this.draft = undefined; this.legal = []; this.game = new Game(SANJU);
  }
}
