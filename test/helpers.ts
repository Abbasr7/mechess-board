import { vi } from 'vitest';
import { ChessBoard, type BoardInit } from '../src/board';
import { fileOf, rankOf } from '../src/squares';

/** Board is rendered 800×800 at (0,0) so a square is 100 px and coordinates are easy to reason about. */
export const BOARD_PX = 800;

export interface Harness {
  board: ChessBoard;
  host: HTMLElement;
  /** Run `n` animation frames (each queued rAF callback once). */
  frames(n?: number): void;
  pt(sq: string): { x: number; y: number };
  down(sq: string, extra?: MouseEventInit): void;
  downOutside(extra?: MouseEventInit): void;
  moveTo(target: string | { x: number; y: number }): void;
  up(target: string | { x: number; y: number }, extra?: MouseEventInit): void;
  drag(from: string, to: string, extra?: MouseEventInit): void;
  click(sq: string, extra?: MouseEventInit): void;
  rightClick(sq: string, extra?: MouseEventInit): void;
  rightDrag(from: string, to: string, extra?: MouseEventInit): void;
  /** Class lists of all matching elements inside the board. */
  all(selector: string): string[];
  pieceClasses(): string[];
  highlightSquares(): string[];
  hintSquares(kind?: 'hint' | 'capture-hint'): string[];
  squareOf(el: Element): string | null;
  events: Array<{ type: string; payload: unknown }>;
  destroy(): void;
}

const sqName = (cls: string): string => {
  const m = /square-([1-8])([1-8])/.exec(cls);
  return m ? 'abcdefgh'[Number(m[1]) - 1] + m[2] : '?';
};

export function setup(init: BoardInit = {}): Harness {
  const host = document.createElement('div');
  document.body.appendChild(host);

  const rafQueue: Array<FrameRequestCallback> = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);

  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const isBoard = this.classList.contains('board');
    const w = isBoard ? BOARD_PX : 0;
    return { left: 0, top: 0, right: w, bottom: w, width: w, height: w, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });

  const board = new ChessBoard(host, { sounds: false, animationType: 'default', ...init });
  const boardEl = board.el;
  const events: Harness['events'] = [];
  for (const type of ['move', 'premove', 'premove-cancel', 'move-rejected', 'piece-select', 'promotion-start', 'promotion-cancel', 'game-over'] as const) {
    board.on(type, (payload) => events.push({ type, payload }));
  }

  const flipped = (): boolean => boardEl.classList.contains('flipped');
  const pt = (sq: string): { x: number; y: number } => {
    const f = fileOf(sq);
    const r = rankOf(sq);
    const col = flipped() ? 8 - f : f - 1;
    const row = flipped() ? r - 1 : 8 - r;
    return { x: col * 100 + 50, y: row * 100 + 50 };
  };
  const ev = (type: string, p: { x: number; y: number }, extra: MouseEventInit = {}): MouseEvent =>
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0, ...extra });
  const where = (t: string | { x: number; y: number }): { x: number; y: number } => (typeof t === 'string' ? pt(t) : t);

  const h: Harness = {
    board,
    host,
    events,
    frames(n = 1) {
      for (let i = 0; i < n; i++) {
        const batch = rafQueue.splice(0);
        batch.forEach((cb) => cb(performance.now()));
      }
    },
    pt,
    down: (sq, extra) => void boardEl.dispatchEvent(ev('pointerdown', pt(sq), extra)),
    downOutside: (extra) => void document.body.dispatchEvent(ev('pointerdown', { x: -500, y: -500 }, extra)),
    moveTo: (t) => void document.dispatchEvent(ev('pointermove', where(t))),
    up: (t, extra) => void document.dispatchEvent(ev('pointerup', where(t), extra)),
    drag(from, to, extra) {
      h.down(from, extra);
      h.moveTo(to);
      h.up(to, extra);
    },
    click(sq, extra) {
      h.down(sq, extra);
      h.up(sq, extra);
    },
    rightClick(sq, extra) {
      h.down(sq, { button: 2, ...extra });
      h.up(sq, { button: 2, ...extra });
    },
    rightDrag(from, to, extra) {
      h.down(from, { button: 2, ...extra });
      h.moveTo(to);
      h.up(to, { button: 2, ...extra });
    },
    all: (selector) => [...boardEl.querySelectorAll(selector)].map((e) => e.className),
    pieceClasses: () => [...boardEl.querySelectorAll('.piece')].map((e) => [...e.classList].filter((c) => /^[wb][pnbrqk]$|^square-/.test(c)).join(' ')),
    highlightSquares: () => [...boardEl.querySelectorAll('.highlight')].map((e) => sqName(e.className)).sort(),
    hintSquares: (kind = 'hint') => [...boardEl.querySelectorAll(`.${kind}`)].map((e) => sqName(e.className)).sort(),
    squareOf: (el) => sqName(el.className),
    destroy() {
      board.destroy();
      host.remove();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    },
  };
  return h;
}

/** `wn square-63`-style list → `{ f3: 'wn' }` */
export function piecesBySquare(h: Harness): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of h.pieceClasses()) {
    const m = /^([wb][pnbrqk]) (square-\d\d)$|^(square-\d\d) ([wb][pnbrqk])$/.exec(c);
    if (!m) continue;
    const piece = m[1] ?? m[4];
    const sq = sqName(m[2] ?? m[3]);
    out[sq] = piece;
  }
  return out;
}
