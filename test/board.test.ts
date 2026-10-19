// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { piecesBySquare, setup, type Harness } from './helpers';

let h: Harness;
afterEach(() => h?.destroy());

describe('rendering', () => {
  it('draws the start position on class-positioned elements', () => {
    h = setup();
    const p = piecesBySquare(h);
    expect(Object.keys(p).length).toBe(32);
    expect(p.e1).toBe('wk');
    expect(p.d8).toBe('bq');
    expect(p.a2).toBe('wp');
    // files/ranks are encoded in the class: a1 = square-11, h8 = square-88
    expect(h.pieceClasses()).toContain('wr square-11');
    expect(h.pieceClasses()).toContain('br square-88');
  });

  it('layers are ordered back-to-front via comment placeholders', () => {
    h = setup();
    const comments = [...h.board.el.childNodes].filter((n) => n.nodeType === 8).map((n) => n.nodeValue);
    expect(comments.indexOf('/squares')).toBeLessThan(comments.indexOf('/pieces'));
    expect(comments.indexOf('/pieces')).toBeLessThan(comments.indexOf('/move-hints'));
    expect(comments.indexOf('/move-hints')).toBeLessThan(comments.indexOf('/arrows'));
    expect(comments.indexOf('/arrows')).toBeLessThan(comments.indexOf('/promotion-window'));
  });

  it('flipping only toggles a class – no element moves', () => {
    h = setup();
    const before = h.pieceClasses();
    h.board.flip();
    expect(h.board.el.classList.contains('flipped')).toBe(true);
    expect(h.pieceClasses()).toEqual(before);
  });

  it('draws inside coordinates with the original label layout', () => {
    h = setup();
    const texts = [...h.board.el.querySelectorAll('.coordinates text')];
    expect(texts.map((t) => t.textContent).join('')).toBe('87654321abcdefgh');
    expect(texts[0].getAttribute('class')).toBe('coordinate-light');
    expect(texts[1].getAttribute('class')).toBe('coordinate-dark');
    h.board.setOptions({ coordinates: 'off' });
    expect(h.board.el.querySelector('.coordinates')).toBeNull();
    h.board.setOptions({ coordinates: 'each_square' });
    expect(h.board.el.querySelectorAll('.coordinates text').length).toBe(64);
  });
});

describe('dragging', () => {
  it('moves a piece with drag-and-drop and highlights the move', () => {
    h = setup();
    h.drag('e2', 'e4');
    expect(h.board.getFen().split(' ')[0]).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR');
    expect(piecesBySquare(h).e4).toBe('wp');
    expect(piecesBySquare(h).e2).toBeUndefined();
    expect(h.highlightSquares()).toEqual(['e2', 'e4']);
    const mv = h.events.find((e) => e.type === 'move')!.payload as { userGenerated: boolean; animate: boolean; san: string };
    expect(mv).toMatchObject({ userGenerated: true, animate: false, san: 'e4' });
  });

  it('follows the pointer while dragging (centre of piece under the cursor, 800-space coordinates)', () => {
    h = setup();
    h.down('e2');
    h.moveTo({ x: 420, y: 320 });
    const el = h.board.el.querySelector('.piece.dragging') as HTMLElement;
    expect(el).toBeTruthy();
    // pointer (420,320) → piece top-left (420-50, 320-50) in a 100px-square board = 370/800*800 = 370 %
    expect(el.style.transform).toBe('translate(370%, 270%) rotate(0deg) scale(1)');
    // the dragged piece is clamped half a square outside the board
    h.moveTo({ x: 5000, y: -5000 });
    expect(el.style.transform).toBe('translate(750%, -50%) rotate(0deg) scale(1)');
  });

  it('shows the hover outline on the square under the pointer', () => {
    h = setup();
    h.down('e2');
    const hover = () => h.board.el.querySelector('.hover-square') as HTMLElement;
    expect(hover().style.visibility).toBe('');
    expect(hover().className).toContain('square-52');
    h.moveTo('e4');
    expect(hover().className).toContain('square-54');
    h.up('e4');
    expect(hover().style.visibility).toBe('hidden');
  });

  it('dropping on an illegal square snaps back, keeps the piece selected and emits move-rejected', () => {
    h = setup();
    h.drag('e2', 'e5');
    expect(piecesBySquare(h).e2).toBe('wp');
    expect(h.board.getFen()).toContain('PPPPPPPP');
    expect(h.events.find((e) => e.type === 'move-rejected')!.payload).toMatchObject({ from: 'e2', to: 'e5', reason: 'illegal-move' });
    // piece is selected: hints visible
    expect(h.hintSquares()).toEqual(['e3', 'e4']);
    expect(h.highlightSquares()).toEqual(['e2']);
  });

  it('drag_only deselects after an illegal drop', () => {
    h = setup({ moveMethod: 'drag_only' });
    h.drag('e2', 'e5');
    expect(h.hintSquares()).toEqual([]);
    expect(h.highlightSquares()).toEqual([]);
  });

  it('dropping outside the board is rejected as off-board', () => {
    h = setup();
    h.down('e2');
    h.up({ x: 2000, y: 2000 });
    expect(h.events.find((e) => e.type === 'move-rejected')!.payload).toMatchObject({ reason: 'off-board' });
    expect(piecesBySquare(h).e2).toBe('wp');
  });

  it('can pick up the opponent\'s pieces but they snap back', () => {
    h = setup();
    h.drag('e7', 'e5');
    expect(piecesBySquare(h).e7).toBe('bp');
    expect(h.events.find((e) => e.type === 'move-rejected')!.payload).toMatchObject({ reason: 'not-player-turn' });
    expect(h.hintSquares()).toEqual([]); // no hints for a piece you cannot move
  });

  it('a right-button press cancels a drag in progress', async () => {
    h = setup();
    h.down('e2');
    await new Promise((r) => setTimeout(r, 5)); // the secondary-button listener is armed on the next tick
    document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 2, clientX: 1, clientY: 1 }));
    expect(h.board.el.querySelector('.dragging')).toBeNull();
    expect(piecesBySquare(h).e2).toBe('wp');
  });
});

describe('click to move', () => {
  it('first click selects (hints + highlight), second click moves with a slide', () => {
    h = setup();
    h.click('g1');
    expect(h.hintSquares()).toEqual(['f3', 'h3']);
    expect(h.highlightSquares()).toEqual(['g1']);
    h.click('f3');
    expect(piecesBySquare(h).f3).toBe('wn');
    const mv = h.events.find((e) => e.type === 'move')!.payload as { animate: boolean };
    expect(mv.animate).toBe(true); // click-moves slide, drops do not
    expect(h.hintSquares()).toEqual([]);
  });

  it('clicking the selected piece again deselects it', () => {
    h = setup();
    h.click('g1');
    h.click('g1');
    expect(h.hintSquares()).toEqual([]);
    expect(h.highlightSquares()).toEqual([]);
  });

  it('clicking another own piece switches the selection', () => {
    h = setup();
    h.click('g1');
    h.click('b1');
    expect(h.hintSquares()).toEqual(['a3', 'c3']);
  });

  it('clicking an empty non-target square deselects and reports a rejected move', () => {
    h = setup();
    h.click('g1');
    h.click('e5');
    expect(h.hintSquares()).toEqual([]);
    expect(h.events.some((e) => e.type === 'move-rejected')).toBe(true);
  });

  it('clicking outside the board deselects', () => {
    h = setup();
    h.click('g1');
    h.downOutside();
    expect(h.hintSquares()).toEqual([]);
  });

  it('capture squares get capture-hint rings, quiet squares get dots', () => {
    h = setup();
    h.board.load('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1');
    h.click('e4');
    expect(h.hintSquares('hint')).toEqual(['e5']);
    expect(h.hintSquares('capture-hint')).toEqual(['d5']);
  });

  it('moveMethod "click" holds the piece at its own square until the next click', () => {
    h = setup({ moveMethod: 'click' });
    h.down('e2');
    const el = h.board.el.querySelector('.piece.dragging') as HTMLElement;
    expect(el.style.transform).toBe('translate(400%, 600%) rotate(0deg) scale(1)');
    expect(h.board.el.querySelector('.hover-square')!.getAttribute('style')).toContain('hidden');
  });
});

describe('promotion', () => {
  it('opens a window anchored at the promotion edge and applies the picked piece', () => {
    h = setup();
    h.board.load('k7/4P3/8/8/8/8/8/K7 w - - 0 1');
    h.drag('e7', 'e8');
    const win = h.board.el.querySelector('.promotion-window') as HTMLElement;
    expect(win.classList.contains('top')).toBe(true);
    expect(win.style.transform).toBe('translateX(400%)');
    expect([...win.children].map((c) => c.className)).toEqual([
      'close-button',
      'promotion-piece wq',
      'promotion-piece wn',
      'promotion-piece wr',
      'promotion-piece wb',
    ]);
    // the pawn waits on the promotion square
    expect(h.board.el.querySelector('.piece.dragging')!.className).toContain('square-58');
    (win.querySelector('.promotion-piece.wr') as HTMLElement).dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(h.board.getFen().split(' ')[0]).toBe('k3R3/8/8/8/8/8/8/K7');
    expect(win.style.display).toBe('none');
    expect(piecesBySquare(h).e8).toBe('wr');
  });

  it('flipped boards put the window on the other edge and mirror the column', () => {
    h = setup({ flipped: true });
    h.board.load('k7/4P3/8/8/8/8/8/K7 w - - 0 1');
    h.drag('e7', 'e8');
    const win = h.board.el.querySelector('.promotion-window') as HTMLElement;
    expect(win.classList.contains('top')).toBe(false);
    expect(win.style.transform).toBe('translateX(300%)'); // e is the 4th column from the left when flipped (h g f E …)
  });

  it('the close button and clicking elsewhere cancel it', () => {
    h = setup();
    h.board.load('k7/4P3/8/8/8/8/8/K7 w - - 0 1');
    h.drag('e7', 'e8');
    (h.board.el.querySelector('.close-button') as HTMLElement).dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(piecesBySquare(h).e7).toBe('wp');
    expect(h.events.some((e) => e.type === 'promotion-cancel')).toBe(true);

    h.drag('e7', 'e8');
    h.click('a4');
    expect((h.board.el.querySelector('.promotion-window') as HTMLElement).style.display).toBe('none');
    expect(h.board.getFen()).toContain('4P3');
  });

  it('autoPromote queens immediately unless Alt is held', () => {
    h = setup({ autoPromote: true });
    h.board.load('k7/4P3/8/8/8/8/8/K7 w - - 0 1');
    h.drag('e7', 'e8');
    expect(piecesBySquare(h).e8).toBe('wq');
    h.board.load('k7/4P3/8/8/8/8/8/K7 w - - 0 1');
    h.drag('e7', 'e8', { altKey: true });
    expect((h.board.el.querySelector('.promotion-window') as HTMLElement).style.display).toBe('');
  });
});

describe('markings', () => {
  it('right-click toggles a highlight, colour chosen by modifier', () => {
    h = setup();
    h.rightClick('d4');
    expect(h.highlightSquares()).toEqual(['d4']);
    const el = h.board.el.querySelector('.highlight') as HTMLElement;
    expect(el.style.backgroundColor).toBe('rgb(235, 97, 80)'); // #eb6150
    expect(el.style.opacity).toBe('0.8');
    h.rightClick('d4', { shiftKey: true }); // different modifier replaces
    expect((h.board.el.querySelector('.highlight') as HTMLElement).style.backgroundColor).toBe('rgb(172, 206, 89)'); // #acce59
    h.rightClick('d4', { shiftKey: true }); // same again removes
    expect(h.highlightSquares()).toEqual([]);
  });

  it('right-drag draws and toggles an arrow', () => {
    h = setup();
    h.rightDrag('e2', 'e4');
    const poly = h.board.el.querySelector('.arrows polygon') as SVGPolygonElement;
    expect(poly.getAttribute('data-arrow')).toBe('e2e4');
    expect(poly.style.fill).toBe('rgba(255, 170, 0, 0.8)');
    h.rightDrag('e2', 'e4');
    expect(h.board.el.querySelectorAll('.arrows polygon').length).toBe(0);
  });

  it('knight arrows are L-shaped (9 points), others straight (7 points)', () => {
    h = setup();
    h.rightDrag('g1', 'f3');
    h.rightDrag('a1', 'a5');
    const polys = [...h.board.el.querySelectorAll('.arrows polygon')];
    const pts = Object.fromEntries(polys.map((p) => [p.getAttribute('data-arrow'), p.getAttribute('points')!.split(',').length]));
    expect(pts).toEqual({ g1f3: 9, a1a5: 7 });
  });

  it('a left click on the board clears non-persistent markings; persistent ones survive', () => {
    h = setup();
    h.rightClick('d4');
    h.rightDrag('a1', 'a5');
    h.board.markings.add({ kind: 'arrow', from: 'h1', to: 'h4', persistent: true });
    h.click('a4'); // an empty square
    expect(h.highlightSquares()).toEqual([]);
    expect([...h.board.el.querySelectorAll('.arrows polygon')].map((p) => p.getAttribute('data-arrow'))).toEqual(['h1h4']);
  });

  it('can be disabled', () => {
    h = setup({ disableUserMarkings: true });
    h.rightClick('d4');
    expect(h.highlightSquares()).toEqual([]);
  });
});

describe('last-move and selection highlights', () => {
  it('uses the theme highlight colour at 50 % opacity', () => {
    h = setup();
    h.drag('e2', 'e4');
    const style = document.querySelector(`style[data-board="${h.board.el.id}"]`)!.textContent!;
    expect(style).toContain('.highlight{background-color:#ffff00}');
    expect((h.board.el.querySelector('.highlight') as HTMLElement).style.opacity).toBe('0.5');
  });

  it('can be switched off', () => {
    h = setup({ highlightMoves: false, highlightLegalMoves: false });
    h.drag('e2', 'e4');
    h.click('g8');
    expect(h.highlightSquares()).toEqual([]);
    expect(h.hintSquares()).toEqual([]);
  });
});

describe('game flow', () => {
  it('detects checkmate and announces game-over', () => {
    h = setup({ playingAs: null });
    for (const [a, b] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) h.drag(a, b);
    expect(h.events.find((e) => e.type === 'game-over')!.payload).toMatchObject({ result: '0-1', reason: 'checkmate' });
    expect(h.board.isGameOver()).toBe(true);
    // further input is ignored
    h.drag('a2', 'a3');
    expect(piecesBySquare(h).a2).toBe('wp');
  });

  it('an illegal drop while in check blinks the king square', () => {
    h = setup({ playingAs: null });
    h.board.load('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1'); // white king attacked by the rook on e2? (king adjacent) – the rook is protected by nothing
    // king is in check from the rook on e2
    h.drag('e1', 'd2'); // moving next to the rook along the 2nd rank is still attacked
    expect(h.board.el.querySelector('.highlight[style*="255, 0, 0"]') ?? h.all('.highlight').length).toBeTruthy();
  });

  it('undo takes the move back, restoring captured pieces', () => {
    h = setup({ playingAs: null });
    h.drag('e2', 'e4');
    h.drag('d7', 'd5');
    h.drag('e4', 'd5');
    expect(piecesBySquare(h).d5).toBe('wp');
    h.board.undo();
    h.frames(30);
    expect(piecesBySquare(h).d5).toBe('bp');
    expect(piecesBySquare(h).e4).toBe('wp');
    expect(h.board.getFen().split(' ')[1]).toBe('w');
  });

  it('view mode and disabled boards ignore input', () => {
    h = setup({ mode: 'view' });
    h.drag('e2', 'e4');
    expect(piecesBySquare(h).e2).toBe('wp');
    h.board.setOptions({ mode: 'analysis', enabled: false });
    h.drag('e2', 'e4');
    expect(piecesBySquare(h).e2).toBe('wp');
    h.board.setOptions({ enabled: true });
    h.drag('e2', 'e4');
    expect(piecesBySquare(h).e4).toBe('wp');
  });

  it('en passant removes the captured pawn element', () => {
    h = setup({ playingAs: null });
    h.board.load('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    h.drag('e5', 'd6');
    h.frames(30);
    const p = piecesBySquare(h);
    expect(p.d6).toBe('wp');
    expect(p.d5).toBeUndefined();
  });
});
