import { layerLabel } from '../core/notation';
import type { Square } from '../core/types';
import { PIECE_NAMES, RANKS, sameSquare, squareKey, type Highlights, type RenderPiece } from '../render/types';
import { button, colorName, el } from './dom';

export class Minimap {
  readonly element = el('details', 'minimap paper');
  private readonly boards = el('div', 'mini-boards');
  private readonly cells = new Map<string, HTMLButtonElement>();
  private drag?: { id: number; sq: Square; x: number; y: number };
  private suppressClick = false;
  constructor(readonly layers: number, pick: (sq: Square) => void, drag?: (sq: Square, delta: number) => void, fallback = false) {
    this.element.open = fallback || !matchMedia('(max-width: 767px)').matches;
    this.element.classList.toggle('fallback', fallback);
    this.element.append(el('summary', '', fallback ? '展開図で操作' : '展開図を開く / 閉じる'), this.boards);
    for (let z = layers - 1; z >= 0; z--) {
      const section = el('section', 'mini-layer'); section.append(el('h3', '', `${layerLabel(z, layers)}${layers === 3 ? '層' : ''}`));
      const coords = el('div', 'mini-files');
      for (let x = 9; x >= 1; x--) coords.append(el('span', '', String(x)));
      const grid = el('div', 'mini-grid'); grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', `${layerLabel(z, layers)}層の盤`);
      for (let y = 1; y <= 9; y++) for (let x = 9; x >= 1; x--) {
        const sq = { x, y, z };
        const cell = button('', () => { if (!this.suppressClick) pick(sq); });
        cell.className = 'square'; cell.dataset.square = squareKey(sq);
        if (drag) {
          cell.addEventListener('pointerdown', e => {
            if (!e.isPrimary || e.button !== 0 || !cell.dataset.piece) return;
            this.suppressClick = false; this.drag = { id: e.pointerId, sq, x: e.clientX, y: e.clientY }; cell.setPointerCapture(e.pointerId);
          });
          cell.addEventListener('pointerup', e => {
            const start = this.drag; this.drag = undefined;
            if (start?.id === e.pointerId && Math.abs(e.clientY - start.y) > 28 && Math.abs(e.clientX - start.x) < 70) {
              this.suppressClick = true; drag(start.sq, e.clientY < start.y ? 1 : -1);
              setTimeout(() => { this.suppressClick = false; }, 0);
            }
          });
          cell.addEventListener('pointercancel', () => { this.drag = undefined; this.suppressClick = false; });
        }
        grid.append(cell); this.cells.set(squareKey(sq), cell);
      }
      const ranks = el('div', 'mini-ranks'); for (const rank of RANKS) ranks.append(el('span', '', rank));
      const wrap = el('div', 'mini-board-wrap'); wrap.append(grid, ranks); section.append(coords, wrap); this.boards.append(section);
    }
  }
  update(pieces: RenderPiece[], highlights: Highlights, interactive = true): void {
    const bySquare = new Map(pieces.map(p => [squareKey(p.sq), p.piece]));
    const targets = new Set(highlights.targets.map(squareKey)); const last = new Set(highlights.lastMove?.map(squareKey));
    for (const [key, cell] of this.cells) {
      const [x, y, z] = key.split(',').map(Number); const sq = { x: x!, y: y!, z: z! }; const piece = bySquare.get(key);
      cell.replaceChildren(); cell.disabled = !interactive;
      if (piece) {
        const label = el('span', `mini-piece ${piece.color} ${piece.type.startsWith('+') ? 'promoted' : ''}`, PIECE_NAMES[piece.type]); cell.append(label);
        cell.dataset.piece = piece.type; cell.dataset.color = piece.color;
      } else { delete cell.dataset.piece; delete cell.dataset.color; }
      cell.classList.toggle('target', targets.has(key)); cell.classList.toggle('selected', sameSquare(highlights.selected, sq));
      cell.classList.toggle('last-move', last.has(key)); cell.classList.toggle('check', sameSquare(highlights.check, sq));
      const name = `${layerLabel(z!, this.layers)}層 ${x}${RANKS[y! - 1]} ${piece ? `${colorName(piece.color)} ${PIECE_NAMES[piece.type]}` : '空き'}${targets.has(key) ? ' 移動先' : ''}`;
      cell.setAttribute('aria-label', name); cell.setAttribute('aria-pressed', String(sameSquare(highlights.selected, sq))); cell.title = name;
    }
  }
}
