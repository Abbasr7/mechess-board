// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { piecesBySquare, setup, type Harness } from './helpers';

let h: Harness;
afterEach(() => h?.destroy());

const CASTLE_FEN = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';

describe('rook castling (king dropped on its own rook)', () => {
  it('shows the rook squares as capture rings next to the two-file destinations', () => {
    h = setup();
    h.board.load(CASTLE_FEN);
    h.click('e1');
    expect(h.hintSquares('hint')).toContain('g1');
    expect(h.hintSquares('hint')).toContain('c1');
    expect(h.hintSquares('capture-hint')).toEqual(['a1', 'h1']);
  });

  it('dragging the king onto the h1 rook castles king-side', () => {
    h = setup({ animationType: 'none' });
    h.board.load(CASTLE_FEN);
    h.drag('e1', 'h1');
    const pieces = piecesBySquare(h);
    expect(pieces.g1).toBe('wk');
    expect(pieces.f1).toBe('wr');
    expect(pieces.h1).toBeUndefined();
    expect((h.events.find((e) => e.type === 'move')!.payload as { san: string }).san).toBe('O-O');
  });

  it('click-to-move onto the a1 rook castles queen-side', () => {
    h = setup({ animationType: 'none' });
    h.board.load(CASTLE_FEN);
    h.click('e1');
    h.click('a1');
    const pieces = piecesBySquare(h);
    expect(pieces.c1).toBe('wk');
    expect(pieces.d1).toBe('wr');
    expect((h.events.find((e) => e.type === 'move')!.payload as { san: string }).san).toBe('O-O-O');
  });

  it('still castles by moving the king two files', () => {
    h = setup({ animationType: 'none' });
    h.board.load(CASTLE_FEN);
    h.drag('e1', 'g1');
    expect(piecesBySquare(h).f1).toBe('wr');
  });

  it('is not offered when castling is illegal (squares attacked)', () => {
    h = setup();
    h.board.load('r3k2r/8/8/8/8/5q2/8/R3K2R w KQkq - 0 1'); // queen covers f1 and f-file
    h.click('e1');
    expect(h.hintSquares('capture-hint')).not.toContain('h1');
    h.drag('e1', 'h1');
    expect(piecesBySquare(h).h1).toBe('wr');
  });

  it('disableRookCastling removes the shortcut but keeps the normal castle', () => {
    h = setup({ animationType: 'none', disableRookCastling: true });
    h.board.load(CASTLE_FEN);
    h.click('e1');
    expect(h.hintSquares('capture-hint')).toEqual([]);
    h.click('h1'); // not a king move: reselects the rook instead
    expect(piecesBySquare(h).h1).toBe('wr');
    expect(piecesBySquare(h).e1).toBe('wk');
    h.drag('e1', 'g1');
    expect(piecesBySquare(h).g1).toBe('wk');
  });

  it('works for premoves too (king onto rook queues the castle)', () => {
    h = setup({ animationType: 'none' });
    h.board.load('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1'); // black to move: white is premoving
    h.drag('e1', 'h1');
    const premove = h.events.find((e) => e.type === 'premove')!.payload as { move: { from: string; to: string } };
    expect(premove.move).toMatchObject({ from: 'e1', to: 'g1' });
    expect(piecesBySquare(h).g1).toBe('wk');
    expect(piecesBySquare(h).f1).toBe('wr');
  });
});
