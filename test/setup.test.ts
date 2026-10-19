// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { clonePieces, inferCastling, piecesToFen, piecesToPlacement, placementToPieces, sanitizeCastling, SetupSession, validateSetup } from '../src/setup';
import { piecesBySquare, setup, type Harness } from './helpers';

let h: Harness;
afterEach(() => h?.destroy());

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

describe('setup helpers', () => {
  it('placement ↔ pieces round-trips', () => {
    const p = placementToPieces(START)!;
    expect(p.size).toBe(32);
    expect(p.get('e1')).toEqual({ color: 'w', type: 'k' });
    expect(piecesToPlacement(p)).toBe(START);
    expect(placementToPieces('8/8/8')).toBeNull();
    expect(placementToPieces('9/8/8/8/8/8/8/8')).toBeNull();
    expect(placementToPieces('x7/8/8/8/8/8/8/8')).toBeNull();
    expect(piecesToPlacement(placementToPieces('8/8/8/3q4/8/8/8/8')!)).toBe('8/8/8/3q4/8/8/8/8');
  });

  it('infers castling from kings and rooks on their home squares', () => {
    expect(inferCastling(placementToPieces(START)!)).toBe('KQkq');
    expect(inferCastling(placementToPieces('4k3/8/8/8/8/8/8/R3K3')!)).toBe('Q');
    expect(inferCastling(placementToPieces('4k3/8/8/8/8/8/8/4K3')!)).toBe('-');
  });

  it('explicit castling rights are cut down to what is still possible', () => {
    const p = placementToPieces('r3k3/8/8/8/8/8/8/4K2R')!;
    expect(sanitizeCastling('KQkq', p)).toBe('Kq');
    expect(sanitizeCastling('-', p)).toBe('-');
    expect(piecesToFen(p, { turn: 'b', castling: null })).toBe('r3k3/8/8/8/8/8/8/4K2R b Kq - 0 1');
    expect(piecesToFen(p, { turn: 'w', castling: 'Q' })).toBe('r3k3/8/8/8/8/8/8/4K2R w - - 0 1');
  });

  it('validates a set-up position', () => {
    const v = (placement: string, turn: 'w' | 'b' = 'w'): string[] => validateSetup(placementToPieces(placement)!, turn);
    expect(v(START)).toEqual([]);
    expect(v('8/8/8/8/8/8/8/8')).toEqual(['no-white-king', 'no-black-king']);
    expect(v('4k3/8/8/8/8/8/8/8')).toEqual(['no-white-king']);
    expect(v('kk6/8/8/8/8/8/8/K7')).toContain('multiple-black-kings');
    expect(v('k7/8/8/8/8/8/8/KK6')).toContain('multiple-white-kings');
    expect(v('k7/8/8/8/8/8/8/K6P')).toContain('pawn-on-back-rank');
    expect(v('kP6/8/8/8/8/8/8/K7')).toContain('pawn-on-back-rank');
    expect(v('k7/8/8/8/8/8/8/K7')).toEqual([]);
    expect(v('8/8/8/3kK3/8/8/8/8')).toEqual(['kings-adjacent']);
    expect(v('k7/pppppppp/p7/8/8/8/8/K7')).toContain('too-many-pawns');
    // the side that is not to move may not be in check
    expect(v('k6R/8/8/8/8/8/8/K7', 'w')).toEqual(['side-not-to-move-in-check']); // black is in check but white is to move
    expect(v('k6R/8/8/8/8/8/8/K7', 'b')).toEqual([]); // black to move: a normal check
    expect(v('k7/8/8/8/8/8/8/K6R', 'w')).toEqual([]);
  });

  it('SetupSession edits a copy', () => {
    const original = placementToPieces(START)!;
    const s = new SetupSession(original, 'w', null);
    s.drop('e4', { color: 'w', type: 'q' });
    expect(s.pieces.get('e4')).toEqual({ color: 'w', type: 'q' });
    expect(original.has('e4')).toBe(false);
    expect(s.move('e4', 'e5')).toMatchObject({ piece: { type: 'q' } });
    expect(s.move('e4', 'e5')).toBeNull();
    expect(s.remove('e5')).toEqual({ color: 'w', type: 'q' });
    expect(s.remove('e5')).toBeUndefined();
    const taken = s.move('e1', 'e8');
    expect(taken?.captured).toEqual({ color: 'b', type: 'k' });
    s.clear();
    expect(s.pieces.size).toBe(0);
    s.reset();
    expect(s.fen()).toBe(`${START} w KQkq - 0 1`);
    expect(SetupSession.fromFen('4k3/8/8/8/8/8/8/4K3 b - - 0 1')?.turn).toBe('b');
    expect(SetupSession.fromFen('nonsense')).toBeNull();
    expect(clonePieces(original).get('a1')).not.toBe(original.get('a1'));
  });
});

describe('setup mode on the board', () => {
  it('lets any piece go anywhere and shows no move hints', () => {
    h = setup({ animationType: 'none', mode: 'setup' });
    expect(h.board.setup.isActive()).toBe(true);
    h.click('e2');
    expect(h.hintSquares('hint')).toEqual([]);
    expect(h.hintSquares('capture-hint')).toEqual([]);
    h.click('e2'); // deselect
    h.drag('a1', 'a5'); // a rook jumping over its own pawn … and onto empty space
    const p = piecesBySquare(h);
    expect(p.a5).toBe('wr');
    expect(p.a1).toBeUndefined();
    // black pieces move as well, and may land on friends (replacing them)
    h.drag('b8', 'c8');
    expect(piecesBySquare(h).c8).toBe('bn');
    expect(piecesBySquare(h).b8).toBeUndefined();
  });

  it('click-to-move works too', () => {
    h = setup({ animationType: 'none', mode: 'setup', moveMethod: 'click' });
    h.click('d2');
    h.click('d6');
    expect(piecesBySquare(h).d6).toBe('wp');
    expect(piecesBySquare(h).d2).toBeUndefined();
  });

  it('dragging a piece off the board deletes it', () => {
    h = setup({ animationType: 'none', mode: 'setup' });
    h.down('e2');
    h.moveTo({ x: -120, y: 300 });
    h.up({ x: -120, y: 300 });
    expect(piecesBySquare(h).e2).toBeUndefined();
    expect(h.board.setup.getPieces().has('e2')).toBe(false);
    expect(h.board.setup.getFen().split(' ')[0]).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPP1PPP/RNBQKBNR');
  });

  it('emits setup-change with the FEN and the problems', () => {
    h = setup({ animationType: 'none', mode: 'setup' });
    const seen: Array<{ fen: string; problems: string[] }> = [];
    h.board.on('setup-change', (e) => seen.push(e));
    h.board.setup.removePiece('e8');
    expect(seen.at(-1)!.problems).toEqual(['no-black-king']);
    h.board.setup.dropPiece('e8', { color: 'b', type: 'k' });
    expect(seen.at(-1)!.problems).toEqual([]);
    expect(seen.at(-1)!.fen).toBe(`${START} w KQkq - 0 1`);
  });

  it('API edits: drop, remove, move, clear, reset, turn, castling', () => {
    h = setup({ animationType: 'none', mode: 'setup' });
    const s = h.board.setup;
    s.clear();
    expect(piecesBySquare(h)).toEqual({});
    s.dropPiece('e1', { color: 'w', type: 'k' });
    s.dropPiece('e8', { color: 'b', type: 'k' });
    s.dropPiece('h1', { color: 'w', type: 'r' });
    expect(piecesBySquare(h)).toEqual({ e1: 'wk', e8: 'bk', h1: 'wr' });
    expect(s.getFen()).toBe('4k3/8/8/8/8/8/8/4K2R w K - 0 1');
    s.setCastling('-');
    s.setTurn('b');
    expect(s.getFen()).toBe('4k3/8/8/8/8/8/8/4K2R b - - 0 1');
    s.setCastling(null);
    expect(s.getFen()).toBe('4k3/8/8/8/8/8/8/4K2R b K - 0 1');
    expect(s.movePiece('h1', 'h5')).toBe(true);
    expect(s.movePiece('h1', 'h5')).toBe(false);
    expect(s.removePiece('h5')).toBe(true);
    expect(s.removePiece('h5')).toBe(false);
    s.reset();
    expect(piecesBySquare(h).a1).toBe('wr');
    expect(Object.keys(piecesBySquare(h)).length).toBe(32);
    expect(s.getFen()).toBe(`${START} w KQkq - 0 1`);
  });

  it('commit() refuses an illegal position and stays in setup mode', () => {
    h = setup({ animationType: 'none', mode: 'setup' });
    h.board.setup.removePiece('e1');
    expect(h.board.setup.commit()).toEqual(['no-white-king']);
    expect(h.board.getOptions().mode).toBe('setup');
    expect(h.board.setup.isActive()).toBe(true);
  });

  it('commit() loads the edited position and returns to the previous mode', () => {
    h = setup({ animationType: 'none' }); // mode: play
    const ended: Array<{ committed: boolean; fen: string | null }> = [];
    h.board.on('setup-end', (e) => ended.push(e));
    h.board.setOptions({ mode: 'setup' });
    h.board.setup.clear();
    h.board.setup.dropPiece('e1', { color: 'w', type: 'k' });
    h.board.setup.dropPiece('e8', { color: 'b', type: 'k' });
    h.board.setup.dropPiece('d1', { color: 'w', type: 'q' });
    h.board.setup.setTurn('b');
    expect(h.board.setup.commit()).toEqual([]);
    expect(h.board.getOptions().mode).toBe('play');
    expect(h.board.setup.isActive()).toBe(false);
    expect(h.board.getFen()).toBe('4k3/8/8/8/8/8/8/3QK3 b - - 0 1');
    expect(ended).toEqual([{ committed: true, fen: '4k3/8/8/8/8/8/8/3QK3 b - - 0 1', problems: [] }]);
    expect(h.board.getTurn()).toBe('b');
    expect(piecesBySquare(h)).toEqual({ e1: 'wk', e8: 'bk', d1: 'wq' });
  });

  it('commit() can switch to another mode', () => {
    h = setup({ animationType: 'none' });
    h.board.setOptions({ mode: 'setup' });
    h.board.setup.removePiece('a2');
    h.board.setup.commit('analysis');
    expect(h.board.getOptions().mode).toBe('analysis');
    expect(h.board.getFen().split(' ')[0]).toBe('rnbqkbnr/pppppppp/8/8/8/8/1PPPPPPP/RNBQKBNR');
  });

  it('cancel() restores the game position', () => {
    h = setup({ animationType: 'none' });
    h.board.move('e2e4', { animate: false });
    const fen = h.board.getFen();
    h.board.setOptions({ mode: 'setup' });
    h.board.setup.clear();
    h.board.setup.cancel();
    expect(h.board.getOptions().mode).toBe('play');
    expect(h.board.getFen()).toBe(fen);
    expect(piecesBySquare(h).e4).toBe('wp');
    expect(Object.keys(piecesBySquare(h)).length).toBe(32);
  });

  it('leaving via setOptions commits a legal position and discards an illegal one', () => {
    h = setup({ animationType: 'none' });
    h.board.setOptions({ mode: 'setup' });
    h.board.setup.removePiece('a7');
    h.board.setOptions({ mode: 'analysis' });
    expect(h.board.getFen().split(' ')[0]).toBe('rnbqkbnr/1ppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');

    const before = h.board.getFen();
    h.board.setOptions({ mode: 'setup' });
    h.board.setup.removePiece('e8');
    const ended: boolean[] = [];
    h.board.on('setup-end', (e) => ended.push(e.committed));
    h.board.setOptions({ mode: 'play' });
    expect(ended).toEqual([false]);
    expect(h.board.getFen()).toBe(before);
    expect(piecesBySquare(h).e8).toBe('bk');
  });

  it('starting in setup mode works, and entering from a history position edits that position', () => {
    h = setup({ animationType: 'none', mode: 'setup' });
    expect(h.board.setup.isActive()).toBe(true);
    expect(h.board.setup.getFen()).toBe(`${START} w KQkq - 0 1`);
    h.board.setOptions({ mode: 'play' });

    h.board.move('e2e4', { animate: false });
    h.board.move('e7e5', { animate: false });
    h.board.goTo(1, { animate: false });
    h.board.setOptions({ mode: 'setup' });
    expect(h.board.setup.getFen().split(' ')[0]).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR');
    expect(h.board.setup.getFen().split(' ')[1]).toBe('b');
  });

  it('game API is frozen while editing; load() replaces the edited position', () => {
    h = setup({ animationType: 'none' });
    h.board.move('e2e4', { animate: false });
    h.board.setOptions({ mode: 'setup' });
    expect(h.board.move('e7e5')).toBeNull();
    expect(h.board.undo()).toBeNull();
    expect(h.board.goTo(0)).toBe(false);
    h.board.load('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
    expect(piecesBySquare(h)).toEqual({ e1: 'wk', e8: 'bk' });
    expect(h.board.setup.isActive()).toBe(true);
    h.board.load('garbage'); // ignored
    expect(piecesBySquare(h)).toEqual({ e1: 'wk', e8: 'bk' });
    h.board.setup.cancel();
    expect(h.board.getFen().split(' ')[0]).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR');
  });

  it('shows no last-move highlight while editing', () => {
    h = setup({ animationType: 'none' });
    h.board.move('e2e4', { animate: false });
    expect(h.highlightSquares()).toEqual(['e2', 'e4']);
    h.board.setOptions({ mode: 'setup' });
    expect(h.highlightSquares()).toEqual([]);
    h.board.setup.cancel();
    expect(h.highlightSquares()).toEqual(['e2', 'e4']);
  });

  it('refuses nonsense squares and pieces', () => {
    h = setup({ animationType: 'none', mode: 'setup' });
    expect(() => h.board.setup.dropPiece('i9' as never, { color: 'w', type: 'q' })).toThrow(/Invalid square/);
    expect(() => h.board.setup.dropPiece('e4', { color: 'x', type: 'q' } as never)).toThrow(/Invalid piece/);
    expect(() => h.board.setup.dropPiece('e4', { color: 'w', type: 'kq' } as never)).toThrow(/Invalid piece/);
    expect(h.board.setup.getPieces().has('e4')).toBe(false);
  });

  it('the setup API throws outside setup mode', () => {
    h = setup();
    expect(() => h.board.setup.dropPiece('e4', { color: 'w', type: 'q' })).toThrow(/setup mode/);
    expect(() => h.board.setup.getFen()).toThrow(/setup mode/);
    expect(h.board.setup.isActive()).toBe(false);
  });
});
