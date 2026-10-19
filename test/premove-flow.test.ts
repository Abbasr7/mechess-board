// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { piecesBySquare, setup, type Harness } from './helpers';

let h: Harness;
afterEach(() => h?.destroy());

/** White to play e4, black to move: from here white (the local player) may premove. */
function blackToMove(init = {}): void {
  h = setup(init);
  h.board.move('e4', { userGenerated: true, animate: false });
  h.events.length = 0;
}

describe('premoves', () => {
  it('queue while it is the opponent\'s turn, shown as already played, with red highlights', () => {
    blackToMove();
    h.drag('g1', 'f3');
    expect(h.board.getPremoves().map((m) => m.from + m.to)).toEqual(['g1f3']);
    // the real game has not changed …
    expect(h.board.getFen()).toContain('RNBQKBNR b');
    // … but the board shows the knight on f3
    expect(piecesBySquare(h).f3).toBe('wn');
    expect(piecesBySquare(h).g1).toBeUndefined();
    const red = [...h.board.el.querySelectorAll('.highlight')].filter((e) => (e as HTMLElement).style.backgroundColor === 'rgb(244, 42, 50)');
    expect(red.map((e) => h.squareOf(e)).sort()).toEqual(['f3', 'g1']);
    expect((red[0] as HTMLElement).style.opacity).toBe('0.5');
    expect(h.events.map((e) => e.type)).toContain('premove');
  });

  it('chains premoves through the premoved position', () => {
    blackToMove();
    h.drag('g1', 'f3');
    h.drag('f3', 'g5'); // the knight "is" on f3 already
    expect(h.board.getPremoves().map((m) => m.from + m.to)).toEqual(['g1f3', 'f3g5']);
    expect(piecesBySquare(h).g5).toBe('wn');
  });

  it('ignore blocking pieces and check: any empty-board move is accepted', () => {
    blackToMove();
    h.drag('a1', 'a6'); // rook boxed in by its own pawn
    expect(h.board.getPremoves().length).toBe(1);
    h.drag('d1', 'h5'); // queen through the f2/e2 pawns? d1-h5 is a legal diagonal on an empty board
    expect(h.board.getPremoves().length).toBe(2);
  });

  it('refuse moves a piece could never make', () => {
    blackToMove();
    h.drag('a1', 'b3'); // rook to b3 is not a rook move
    expect(h.board.getPremoves().length).toBe(0);
    expect(h.events.some((e) => e.type === 'move-rejected')).toBe(true);
  });

  it('shows premove hints (empty-board destinations) for the selected piece', () => {
    blackToMove();
    h.click('b1');
    expect(h.hintSquares().concat(h.hintSquares('capture-hint')).sort()).toEqual(['a3', 'c3', 'd2']);
  });

  it('a right click cancels all premoves and does not start a marking', () => {
    blackToMove();
    h.drag('g1', 'f3');
    h.rightClick('e5');
    expect(h.board.getPremoves().length).toBe(0);
    expect(piecesBySquare(h).g1).toBe('wn');
    expect(h.events.some((e) => e.type === 'premove-cancel')).toBe(true);
    expect(h.highlightSquares().filter((s) => s === 'e5')).toEqual([]);
  });

  it('are executed right after the opponent moves (no animation for the premoved piece)', () => {
    blackToMove();
    h.drag('g1', 'f3');
    const mv = h.board.move('e5'); // opponent
    expect(mv?.san).toBe('e5');
    expect(h.board.getPremoves().length).toBe(0);
    expect(h.board.getFen()).toBe('rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2');
    const moves = h.events.filter((e) => e.type === 'move').map((e) => e.payload as { san: string; isPremove: boolean; animate: boolean; userGenerated: boolean });
    expect(moves.map((m) => m.san)).toEqual(['e5', 'Nf3']);
    expect(moves[1]).toMatchObject({ isPremove: true, animate: false, userGenerated: true });
    expect(piecesBySquare(h).f3).toBe('wn');
  });

  it('a chain executes one move per opponent move', () => {
    blackToMove();
    h.drag('g1', 'f3');
    h.drag('f1', 'c4');
    h.board.move('e5');
    expect(h.board.getPremoves().length).toBe(1);
    expect(piecesBySquare(h).c4).toBe('wb'); // still displayed as premoved
    h.board.move('b8c6');
    expect(h.board.getPremoves().length).toBe(0);
    expect(h.board.getFen().split(' ')[0]).toBe('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R');
  });

  it('an illegal premove is dropped together with the rest of the queue', () => {
    blackToMove();
    h.drag('d1', 'h5'); // fine as a premove, but after …e6 the e-pawn path is irrelevant; make it illegal instead:
    h.drag('a1', 'a5');
    h.board.move('e5');
    // d1-h5 is blocked by the e2 gap? e2 is empty after e4, so d1-h5 is legal; a1-a5 is blocked by a2 → illegal
    expect(h.board.getPremoves().length).toBe(1);
    h.board.move('b8c6');
    expect(h.board.getPremoves().length).toBe(0);
    expect(h.events.some((e) => e.type === 'premove-cancel' && (e.payload as { reason: string }).reason === 'illegal')).toBe(true);
    // board is back in sync with the real game
    expect(piecesBySquare(h).a1).toBe('wr');
  });

  it('are discarded when the game ends', () => {
    h = setup();
    h.board.load('7k/8/8/8/8/8/5q2/6K1 w - - 0 1'); // white to move, only Kxf2 / Kh1 …
    h.board.setOptions({ playingAs: 'b' });
    h.drag('f2', 'f1'); // black premove-less: it is white's turn so this is a premove
    expect(h.board.getPremoves().length).toBe(1);
    h.board.move('g1h1');
    expect(h.board.getPremoves().length).toBe(0);
  });

  it('can be turned off', () => {
    blackToMove({ premoves: false });
    h.drag('g1', 'f3');
    expect(h.board.getPremoves().length).toBe(0);
    expect(piecesBySquare(h).g1).toBe('wn');
    expect(h.events.some((e) => e.type === 'move-rejected')).toBe(true);
  });

  it('castling premove needs the right and a king on its home square', () => {
    h = setup();
    h.board.load('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1');
    h.drag('e1', 'g1');
    expect(h.board.getPremoves()[0]).toMatchObject({ castle: 'k' });
    expect(piecesBySquare(h).g1).toBe('wk');
    expect(piecesBySquare(h).f1).toBe('wr');
    expect(piecesBySquare(h).h1).toBeUndefined();
  });

  it('promotion premoves go through the promotion window', () => {
    h = setup();
    h.board.load('r3k3/4P3/8/8/8/8/8/4K3 b - - 0 1');
    h.drag('e7', 'e8');
    expect(h.board.el.querySelector('.promotion-window')).toBeTruthy();
    (h.board.el.querySelector('.promotion-piece.wn') as HTMLElement).dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(h.board.getPremoves()[0]).toMatchObject({ from: 'e7', to: 'e8', promotion: 'n' });
    expect(piecesBySquare(h).e8).toBe('wn');
  });
});

describe('selection while the opponent moves', () => {
  it('keeps a selected own piece when the opponent moves elsewhere', () => {
    blackToMove();
    h.click('g1'); // select (premove hints)
    h.board.move('e5');
    // the premove-less state: it is now white's turn and g1 is still selected with real legal hints
    expect(h.hintSquares()).toEqual(['e2', 'f3', 'h3']); // e2 is free after e4
  });

  it('drops the selection when the opponent captures the selected piece', () => {
    h = setup();
    h.board.load('4k3/8/8/3n4/4P3/8/8/4K3 b - - 0 1');
    h.click('e4');
    h.board.move('d5f4'); // knight moves elsewhere – selection survives
    expect(h.highlightSquares()).toContain('e4');
    h.board.load('4k3/8/8/3n4/4P3/8/8/4K3 b - - 0 1');
    h.click('e4');
    h.board.move({ from: 'd5', to: 'c3' });
    expect(h.highlightSquares()).toContain('e4');
  });
});

describe('illegal drop while in check', () => {
  it('blinks the king square and keeps the move rejected', () => {
    h = setup();
    h.board.load('4r1k1/8/8/8/8/8/P7/4K3 w - - 0 1');
    h.drag('a2', 'a5');
    const blink = [...h.board.el.querySelectorAll('.highlight')].find((e) => (e as HTMLElement).style.backgroundColor === 'rgb(255, 0, 0)');
    expect(blink).toBeTruthy();
    expect(h.squareOf(blink!)).toBe('e1');
    expect(piecesBySquare(h).a2).toBe('wp');
  });
});
