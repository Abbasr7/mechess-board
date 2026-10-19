import { describe, expect, it } from 'vitest';
import { Chess } from '../src/rules/chess';
import { PremoveQueue, premoveMovesFrom, type PremovePosition } from '../src/rules/premove';

const posOf = (fen: string): PremovePosition => {
  const g = new Chess(fen);
  return { pieces: g.pieces(), castling: g.castlingRights() };
};
const dests = (pos: PremovePosition, from: string, color: 'w' | 'b' = 'w'): string[] =>
  premoveMovesFrom(pos, from, color)
    .map((m) => m.to)
    .sort();

describe('premove generation (empty-board semantics)', () => {
  const start = posOf('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

  it('sliders are not blocked by pieces', () => {
    // the a1 rook is boxed in by its own pawn and knight, yet can premove along its lines
    expect(dests(start, 'a1')).toEqual(
      ['a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1'].sort(),
    );
  });

  it('pawns: single/double push and both diagonals, regardless of occupancy', () => {
    expect(dests(start, 'e2')).toEqual(['d3', 'e3', 'e4', 'f3']);
    expect(dests(start, 'a2')).toEqual(['a3', 'a4', 'b3']);
    expect(dests(start, 'e7', 'b')).toEqual(['d6', 'e5', 'e6', 'f6']);
  });

  it('pawns on the last step offer all four promotions', () => {
    const p = posOf('8/P6k/8/8/8/8/7K/8 w - - 0 1');
    const m = premoveMovesFrom(p, 'a7', 'w');
    expect(m.filter((x) => x.to === 'a8').map((x) => x.promotion).sort()).toEqual(['b', 'n', 'q', 'r']);
    expect(m.filter((x) => x.to === 'b8').length).toBe(4);
  });

  it('knights may land on own pieces', () => {
    expect(dests(start, 'g1')).toEqual(['e2', 'f3', 'h3']);
  });

  it('the king gets castling premoves only while the right exists', () => {
    expect(premoveMovesFrom(start, 'e1', 'w').filter((m) => m.castle).map((m) => m.to).sort()).toEqual(['c1', 'g1']);
    const noRights = posOf('r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1');
    expect(premoveMovesFrom(noRights, 'e1', 'w').filter((m) => m.castle)).toEqual([]);
    const oneSide = posOf('r3k2r/8/8/8/8/8/8/R3K2R w Kq - 0 1');
    expect(premoveMovesFrom(oneSide, 'e1', 'w').filter((m) => m.castle).map((m) => m.to)).toEqual(['g1']);
  });

  it("only returns moves for the requested colour's piece", () => {
    expect(premoveMovesFrom(start, 'e7', 'w')).toEqual([]);
    expect(premoveMovesFrom(start, 'e4', 'w')).toEqual([]);
  });
});

describe('PremoveQueue', () => {
  const black = () => {
    const g = new Chess();
    g.move({ from: 'e2', to: 'e4' }); // it is now black to move; white may premove
    const q = new PremoveQueue();
    q.setBase({ pieces: g.pieces(), castling: g.castlingRights() });
    return q;
  };

  it('chains premoves through the premoved position', () => {
    const q = black();
    expect(q.tryAdd({ from: 'e4', to: 'e5' }, 'w')).not.toBeNull();
    // the pawn now "stands" on e5, so e5-e6 is acceptable even though the real pawn is on e4
    expect(q.tryAdd({ from: 'e5', to: 'e6' }, 'w')).not.toBeNull();
    expect(q.position()!.pieces.get('e6')).toEqual({ color: 'w', type: 'p' });
    expect(q.position()!.pieces.has('e4')).toBe(false);
    expect(q.length).toBe(2);
  });

  it('rejects impossible premoves', () => {
    const q = black();
    expect(q.tryAdd({ from: 'e4', to: 'e7' }, 'w')).toBeNull();
    expect(q.tryAdd({ from: 'a8', to: 'a7' }, 'w')).toBeNull(); // not white's piece
    expect(q.length).toBe(0);
  });

  it('applies castling to king and rook', () => {
    const g = new Chess('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1');
    const q = new PremoveQueue();
    q.setBase({ pieces: g.pieces(), castling: g.castlingRights() });
    q.tryAdd({ from: 'e1', to: 'g1' }, 'w');
    const p = q.position()!;
    expect(p.pieces.get('g1')?.type).toBe('k');
    expect(p.pieces.get('f1')?.type).toBe('r');
    expect(p.pieces.has('h1')).toBe(false);
  });

  it('clear() restores the real position, shift() pops the oldest move', () => {
    const q = black();
    q.tryAdd({ from: 'e4', to: 'e5' }, 'w');
    q.tryAdd({ from: 'g1', to: 'f3' }, 'w');
    expect(q.shift()?.to).toBe('e5');
    expect(q.length).toBe(1);
    q.clear();
    expect(q.length).toBe(0);
    expect(q.position()!.pieces.get('e4')).toEqual({ color: 'w', type: 'p' });
  });
});
