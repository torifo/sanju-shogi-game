import { SANJU } from '../core/config';
import { Game } from '../core/game';
import { layerLabel } from '../core/notation';
import { isInCheck } from '../core/rules';
import type { HandKind, Move, Square } from '../core/types';
import { BoardView, isWebGLAvailable } from '../render/scene';
import type { CameraPreset } from '../render/camera';
import { sameSquare, squareKey, type Highlights, type RenderPiece } from '../render/types';
import { banner } from './banner';
import { button, colorName, el, heading } from './dom';
import { handoff } from './handoff';
import { hands } from './hands';
import { moveLog } from './log';
import { Minimap } from './minimap';
import { Placement } from './placement';
import { chooseDialog, promotion } from './promotion';
import { clearSavedGame, persistGame, readSavedGame } from './storage';

type Screen = 'title' | 'handoff' | 'placement' | 'reveal' | 'game';
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

  constructor(private readonly root: HTMLElement) {
    window.addEventListener('keydown', e => {
      if (this.screen !== 'placement' || !this.draft || e.ctrlKey || e.metaKey || e.altKey || /INPUT|SELECT|TEXTAREA/.test((e.target as HTMLElement)?.tagName)) return;
      if (/^[1-9]$/.test(e.key)) {
        const z = Number(e.key) - 1;
        if (z < this.game.config.layers) { e.preventDefault(); this.draft.setLayer(z); this.update(); }
      }
    }, { signal: this.events.signal });
    this.title();
  }

  private resetScreen(screen: Screen): void {
    this.epoch++; this.screenEvents.abort(); this.screenEvents = new AbortController();
    this.view?.dispose(); this.view = undefined; this.minimap = undefined; this.panels = undefined;
    this.selection = undefined; this.busy = false; this.screen = screen; this.root.replaceChildren();
  }
  private header(): HTMLElement {
    const header = el('header', 'site-header');
    header.append(el('span', 'brand', '三重将棋'), el('span', 'brand-sub', 'SANJU SHOGI / 九 × 九 × 三'));
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
    if (!persistGame(this.game)) this.savedWarning = '保存できませんでした。対局は続けられますが、この画面を閉じると続きから再開できません。';
  }
  private title(): void {
    this.resetScreen('title'); this.unsubscribe?.(); this.unsubscribe = undefined; this.draft = undefined;
    const saved = readSavedGame();
    const hero = el('main', 'title-screen'); const intro = el('section', 'title-intro');
    intro.append(heading('立体で、次の一手を。', '三重将棋', '九筋、九段、三つの層。\n馴染みの駒に、高さという選択肢を。'));
    const actions = el('div', 'title-actions');
    actions.append(button('新規対局', () => this.newGame(), 'primary'));
    const resume = button('続きから', () => {
      if (!saved.game) return;
      this.attachGame(saved.game); this.mountBoard('game'); this.legal = this.game.legalMoves(); this.update();
    }); resume.disabled = !saved.game; actions.append(resume);
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
    this.root.append(this.header(), hero, guide, el('footer', '', '三重将棋 · ローカル2人対戦 / 持ち時間なし'));
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
  private mountBoard(screen: 'placement' | 'reveal' | 'game'): void {
    this.resetScreen(screen);
    const main = el('main', 'play-screen'); const top = el('div', 'play-heading');
    top.append(heading(screen === 'placement' ? '秘密配置' : screen === 'reveal' ? '同時公開' : '対局', screen === 'placement' && this.draft ? `${colorName(this.draft.color)}の配置` : screen === 'reveal' ? 'ふたつの布陣が、出会う。' : '三層の盤', screen === 'placement' ? '表示されるのは自分の駒だけです。20枚の層を自由に選んでください。' : '駒を選び、緑のマスへ。展開図からも同じ操作ができます。'));
    const status = el('div'); const controls = el('div'); const layout = el('div', 'board-layout');
    const left = el('aside', 'side-panel paper'); const center = el('section', 'board-center'); const right = el('aside', 'side-panel paper');
    const stage = el('div', 'board-stage'); const toolbar = el('div', 'view-toolbar'); const message = el('p', 'notice');
    stage.append(el('span', 'stage-caption', '三重将棋 / 3D BOARD'));
    this.fallback = !isWebGLAvailable();
    if (!this.fallback) {
      try {
        this.view = new BoardView(stage, { layers: this.game.config.layers, layerGap: 2.2 });
        this.view.onPick(({ sq }) => { void this.pick(sq); });
        if (screen === 'placement') this.view.onLayerDrag((sq, delta) => { this.draft?.drag(sq, delta); this.update(); });
      } catch { this.fallback = true; this.view?.dispose(); this.view = undefined; stage.querySelector('canvas')?.remove(); }
    }
    const makeMinimap = (): void => {
      this.minimap?.element.remove();
      this.minimap = new Minimap(this.game.config.layers, sq => { void this.pick(sq); }, screen === 'placement' ? (sq, delta) => { this.draft?.drag(sq, delta); this.update(); } : undefined, this.fallback);
      center.append(this.minimap.element);
    };
    const fallback = (): void => {
      this.fallback = true; this.view?.dispose(); this.view = undefined;
      toolbar.hidden = true; stage.classList.add('unavailable');
      stage.replaceChildren(el('p', '', '3D表示を利用できません。下の展開図で、配置から対局まですべて操作できます。'));
    };
    stage.addEventListener('board-context-lost', () => { fallback(); makeMinimap(); this.update(); }, { signal: this.screenEvents.signal });
    if (this.fallback) fallback();
    else this.buildViewToolbar(toolbar);
    center.append(stage, toolbar); makeMinimap(); layout.append(left, center, right); main.append(top, status, layout, controls, message);
    this.panels = { status, controls, left, right, message }; this.root.append(this.header(), main);
  }
  private buildViewToolbar(toolbar: HTMLElement): void {
    const camera = el('div', 'toolbar-group'); camera.append(el('span', '', '視点'));
    for (const [preset, label] of [['oblique', '斜め'], ['top', '真上'], ['side', '横']] as const) {
      const b = button(label, () => {
        this.view?.setCameraPreset(preset as CameraPreset);
        camera.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === b)));
      }); b.setAttribute('aria-pressed', String(preset === 'oblique')); camera.append(b);
    }
    const focus = el('label', 'toolbar-group'); focus.append(el('span', '', '注目'));
    const select = el('select'); select.setAttribute('aria-label', '注目する層'); select.append(new Option('全層', 'all'));
    for (let z = 0; z < this.game.config.layers; z++) select.append(new Option(`${layerLabel(z, this.game.config.layers)}層`, String(z)));
    select.addEventListener('change', () => this.view?.setFocusLayer(select.value === 'all' ? null : Number(select.value))); focus.append(select);
    const gap = button('間隔を広げる', () => { const wide = gap.getAttribute('aria-pressed') !== 'true'; gap.setAttribute('aria-pressed', String(wide)); gap.textContent = wide ? '間隔を戻す' : '間隔を広げる'; this.view?.setLayerGap(wide ? 3.5 : 2.2); }); gap.setAttribute('aria-pressed', 'false');
    toolbar.append(camera, focus, gap);
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
    this.minimap?.update(pieces, highlights, this.screen !== 'reveal' && !this.busy);
    const { status, controls, left, right, message } = this.panels;
    message.textContent = this.savedWarning;
    if (this.screen === 'placement' && this.draft) {
      status.replaceChildren(el('p', 'status-banner', `${colorName(this.draft.color)}のみ表示中 — 相手の配置は非公開です`));
      controls.replaceChildren(this.draft.controls(() => this.update(), () => this.submitPlacement()));
      left.replaceChildren(el('h2', '', '配置の手順'), el('p', '', '1. 駒を選ぶ\n2. 上・中・下を選ぶ\n3. 20枚を確認して確定'));
      right.replaceChildren(el('h2', '', '自由な布陣'), el('p', '', '初期位置の筋と段は固定です。すべて同じ層でも、ランダムでも構いません。'));
    } else if (this.screen === 'reveal') {
      status.replaceChildren(el('p', 'status-banner', '両者の配置を公開しています…'));
      left.replaceChildren(el('h2', '', '先手')); right.replaceChildren(el('h2', '', '後手')); controls.replaceChildren();
    } else if (this.screen === 'game') {
      status.replaceChildren(banner(this.game));
      const selectedHand = this.selection?.kind === 'hand' ? this.selection.piece : undefined;
      left.replaceChildren(hands(this.game, 'sente', selectedHand, p => this.selectHand(p)));
      right.replaceChildren(hands(this.game, 'gote', selectedHand, p => this.selectHand(p)), moveLog(this.game.notation));
      const row = el('div', 'game-controls button-row');
      const undo = button('待った（一手戻す）', () => this.act(() => this.game.undo())); undo.disabled = this.busy || this.game.moves.length === 0;
      const resign = button('投了', () => { void this.resign(); }, 'danger'); resign.disabled = this.busy || this.game.phase.kind !== 'playing';
      row.append(undo, resign, el('span', 'muted', this.game.phase.kind === 'ended' ? '対局終了。タイトルから新しい対局を始められます。' : '黄：選択 / 緑：合法手 / 青：直前の手 / 赤：王手'));
      controls.replaceChildren(row);
    }
  }
  private submitPlacement(): void {
    if (this.screen !== 'placement' || !this.draft || this.busy) return;
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
    this.mountBoard('reveal'); this.update(); const epoch = this.epoch;
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
    if (this.screen === 'placement') { this.draft?.select(sq); this.update(); return; }
    if (this.screen !== 'game' || this.game.phase.kind !== 'playing') return;
    const candidates = this.selectedMoves().filter(m => sameSquare(m.to, sq));
    if (candidates.length) {
      this.busy = true; this.update(); const epoch = this.epoch;
      let move = candidates[0]!;
      if (candidates.some(m => m.kind === 'move' && m.promote) && candidates.some(m => m.kind === 'move' && !m.promote)) {
        const choice = await promotion(this.screenEvents.signal);
        if (this.epoch !== epoch) return;
        if (choice === null) { this.busy = false; this.update(); return; }
        move = candidates.find(m => m.kind === 'move' && m.promote === (choice === 0))!;
      }
      this.busy = false; this.act(() => this.game.play(move)); return;
    }
    const piece = this.game.position?.get(sq);
    this.selection = piece?.color === this.game.position?.sideToMove && piece ? this.selection?.kind === 'board' && sameSquare(this.selection.sq, sq) ? undefined : { kind: 'board', sq: { ...sq } } : undefined;
    this.update();
  }
  private selectHand(piece: HandKind): void {
    if (this.busy || this.game.phase.kind !== 'playing') return;
    this.selection = this.selection?.kind === 'hand' && this.selection.piece === piece ? undefined : { kind: 'hand', piece }; this.update();
  }
  private async resign(): Promise<void> {
    if (this.busy || this.game.phase.kind !== 'playing' || !this.game.position) return;
    this.busy = true; this.update(); const epoch = this.epoch;
    const choice = await chooseDialog('投了しますか', `${colorName(this.game.position.sideToMove)}が投了すると対局が終了します。`, ['投了する'], this.screenEvents.signal);
    if (this.epoch !== epoch) return;
    this.busy = false;
    if (choice === 0) this.act(() => this.game.resign(this.game.position!.sideToMove)); else this.update();
  }
  private act(action: () => void): void {
    if (this.busy) return;
    try { action(); } catch (error) { this.error(error); }
  }
  private error(error: unknown): void {
    if (this.panels) { this.panels.message.textContent = error instanceof Error ? error.message : '操作できませんでした。もう一度お試しください。'; this.panels.message.setAttribute('role', 'alert'); }
  }
  dispose(): void {
    this.resetScreen('title'); this.unsubscribe?.(); this.events.abort();
  }
}
