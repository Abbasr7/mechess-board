import { describe, expect, it } from 'vitest';
import { Chess, START_FEN, perft } from '../src/rules/chess';

describe('perft (move generation correctness)', () => {
  const cases: Array<[string, string, number[]]> = [
    ['start position', START_FEN, [20, 400, 8902, 197281]],
    ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
    ['position 3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
    ['position 4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
    ['position 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
  ];
  for (const [name, fen, counts] of cases) {
    it(name, () => {
      counts.forEach((expected, i) => expect(perft(fen, i + 1)).toBe(expected));
    });
  }
});

describe('Chess', () => {
  it('plays moves, produces SAN and tracks check/mate', () => {
    const g = new Chess();
    expect(g.move({ from: 'e2', to: 'e4' })?.san).toBe('e4');
    expect(g.move({ from: 'e7', to: 'e5' })?.san).toBe('e5');
    expect(g.move({ from: 'g1', to: 'f3' })?.san).toBe('Nf3');
    expect(g.move({ from: 'b8', to: 'c6' })?.san).toBe('Nc6');
    expect(g.move({ from: 'f1', to: 'c4' })?.san).toBe('Bc4');
    expect(g.move({ from: 'g8', to: 'f6' })?.san).toBe('Nf6');
    expect(g.move({ from: 'e1', to: 'g1' })?.san).toBe('O-O');
    expect(g.fen().split(' ')[2]).toBe('kq');
  });

  it("detects fool's mate", () => {
    const g = new Chess();
    for (const [from, to] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4']] as const) g.move({ from, to });
    const mate = g.move({ from: 'd8', to: 'h4' });
    expect(mate?.san).toBe('Qh4#');
    expect(g.isCheckmate()).toBe(true);
    expect(g.result()).toBe('0-1');
  });

  it('handles en passant, promotion and undo', () => {
    const g = new Chess('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    const ep = g.move({ from: 'e5', to: 'd6' });
    expect(ep?.flags.enPassant).toBe(true);
    expect(ep?.capturedSquare).toBe('d5');
    expect(g.get('d5')).toBeNull();
    g.undo();
    expect(g.get('d5')?.type).toBe('p');

    const p = new Chess('8/P6k/8/8/8/8/7K/8 w - - 0 1');
    expect(p.move({ from: 'a7', to: 'a8' })?.promotion).toBe('q');
    p.undo();
    expect(p.move({ from: 'a7', to: 'a8', promotion: 'n' })?.san).toBe('a8=N');
  });

  it('disambiguates SAN', () => {
    const g = new Chess('k7/8/8/8/8/8/4K3/R6R w - - 0 1');
    expect(g.move({ from: 'a1', to: 'd1' })?.san).toBe('Rad1');
  });

  it('refuses illegal moves', () => {
    const g = new Chess();
    expect(g.move({ from: 'e2', to: 'e5' })).toBeNull();
    expect(g.move({ from: 'e7', to: 'e5' })).toBeNull();
    expect(g.move({ from: 'a1', to: 'a3' })).toBeNull();
  });

  it('detects draws', () => {
    expect(new Chess('7k/8/8/8/8/8/8/K7 w - - 0 1').isInsufficientMaterial()).toBe(true);
    expect(new Chess('7k/8/8/8/8/8/8/KB6 w - - 0 1').isInsufficientMaterial()).toBe(true);
    expect(new Chess('7k/8/8/8/8/8/p7/KB6 w - - 0 1').isInsufficientMaterial()).toBe(false);
    const stale = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(stale.isStalemate()).toBe(true);
    expect(stale.result()).toBe('1/2-1/2');

    const g = new Chess();
    for (let i = 0; i < 2; i++) {
      g.move({ from: 'g1', to: 'f3' });
      g.move({ from: 'g8', to: 'f6' });
      g.move({ from: 'f3', to: 'g1' });
      g.move({ from: 'f6', to: 'g8' });
    }
    expect(g.isThreefoldRepetition()).toBe(true);
  });

  it('rejects malformed FEN', () => {
    expect(() => new Chess('nonsense')).toThrow();
    expect(() => new Chess('8/8/8/8/8/8/8/8 w - - 0 1')).toThrow();
  });
});
