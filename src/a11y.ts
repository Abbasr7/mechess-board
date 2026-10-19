/**
 * Screen-reader support, like the original's `accessibilityOverlay` plugin:
 *
 *  - an invisible 8×8 `role="grid"` table laid over the board whose cells carry
 *    an `aria-label` per square (`a1`, or `white pawn on e4`);
 *  - a polite-but-assertive live region that announces every move
 *    (`knight to f3.`, `pawn takes d5. Promoted to queen.`).
 */
import type { Color, MoveDetails, PiecesMap, Square } from './types';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'];
const NAMES: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const COLORS: Record<Color, string> = { w: 'white', b: 'black' };

export class A11yOverlay {
  private root: HTMLElement | null = null;
  private status: HTMLElement | null = null;
  private cells = new Map<Square, HTMLElement>();

  constructor(private board: HTMLElement, private flipped: () => boolean) {}

  isAttached(): boolean {
    return !!this.root;
  }

  attach(pieces: PiecesMap): void {
    if (this.root) return;
    const doc = this.board.ownerDocument;
    const root = doc.createElement('div');
    const table = doc.createElement('table');
    table.className = 'a11y-overlay';
    table.style.width = '100%';
    table.style.height = '100%';
    table.setAttribute('role', 'grid');
    const body = doc.createElement('tbody');
    table.appendChild(body);
    const flipped = this.flipped();
    const files = flipped ? [...FILES].reverse() : FILES;
    const ranks = flipped ? RANKS : [...RANKS].reverse();
    for (const rank of ranks) {
      const tr = doc.createElement('tr');
      tr.setAttribute('role', 'row');
      for (const file of files) {
        const td = doc.createElement('td');
        td.setAttribute('role', 'gridcell');
        const cell = doc.createElement('div');
        const sq = `${file}${rank}`;
        cell.setAttribute('aria-label', sq);
        td.appendChild(cell);
        tr.appendChild(td);
        this.cells.set(sq, cell);
      }
      body.appendChild(tr);
    }
    root.appendChild(table);
    const status = doc.createElement('div');
    status.className = 'a11y-announcement';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'assertive');
    status.setAttribute('aria-atomic', 'true');
    root.appendChild(status);
    this.root = root;
    this.status = status;
    this.board.prepend(root);
    this.updateAll(pieces);
  }

  detach(): void {
    this.root?.remove();
    this.root = null;
    this.status = null;
    this.cells.clear();
  }

  /** Rebuild after the board was flipped. */
  reattach(pieces: PiecesMap): void {
    if (!this.root) return;
    this.detach();
    this.attach(pieces);
  }

  updateSquare(sq: Square, piece: { color: Color; type: string } | undefined): void {
    const cell = this.cells.get(sq);
    if (!cell) return;
    cell.setAttribute('aria-label', piece ? `${COLORS[piece.color]} ${NAMES[piece.type]} on ${sq}`.trim() : sq);
  }

  updateAll(pieces: PiecesMap): void {
    if (!this.root) return;
    for (const sq of this.cells.keys()) this.updateSquare(sq, pieces.get(sq));
  }

  announce(m: Pick<MoveDetails, 'piece' | 'to' | 'captured' | 'promotion'>): string {
    if (!this.status) return '';
    let text = m.captured ? `${NAMES[m.piece]} takes ${m.to}. ` : `${NAMES[m.piece]} to ${m.to}. `;
    if (m.promotion) text += `Promoted to ${NAMES[m.promotion]}. `;
    text = text.trim();
    this.status.textContent = text;
    return text;
  }
}
