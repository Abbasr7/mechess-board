// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { piecesBySquare, setup, type Harness } from './helpers';

let h: Harness;
afterEach(() => h?.destroy());

const over = (): Array<{ result: unknown; reason: unknown }> => h.events.filter((e) => e.type === 'game-over').map((e) => e.payload as { result: unknown; reason: unknown });

describe('ending the game from outside', () => {
  it('resign: the other side wins, input stops, premoves are dropped', () => {
    h = setup({ animationType: 'none' });
    h.board.move('e2e4', { animate: false });
    expect(h.board.resign('w')).toBe(true);
    expect(h.board.isGameOver()).toBe(true);
    expect(h.board.getResult()).toBe('0-1');
    expect(h.board.getGameOverReason()).toBe('resignation');
    expect(over()).toEqual([{ result: '0-1', reason: 'resignation' }]);
    expect(h.board.move('e7e5')).toBeNull(); // no moves once the game is over
    expect(h.board.getFen().split(' ')[1]).toBe('b');
  });

  it('after the game ended the user cannot move any more', () => {
    h = setup({ animationType: 'none' });
    h.board.resign('b');
    expect(h.board.getResult()).toBe('1-0');
    h.drag('e2', 'e4');
    expect(piecesBySquare(h).e2).toBe('wp');
    expect(h.board.getLegalMoves()).toEqual([]);
    expect(h.board.isLegalMove('e2e4')).toBe(false);
  });

  it('ending twice is refused; load() and undo() reopen the game', () => {
    h = setup({ animationType: 'none' });
    expect(h.board.agreeDraw()).toBe(true);
    expect(h.board.getResult()).toBe('1/2-1/2');
    expect(h.board.resign('w')).toBe(false);
    expect(h.board.setResult('1-0')).toBe(false);
    h.board.load();
    expect(h.board.isGameOver()).toBe(false);
    expect(h.board.getResult()).toBeNull();

    h.board.move('e2e4', { animate: false });
    h.board.resign('w');
    expect(h.board.isGameOver()).toBe(true);
    h.board.undo();
    expect(h.board.isGameOver()).toBe(false);
  });

  it('flag fall: the opponent wins, or the game is drawn when it cannot mate', () => {
    h = setup({ animationType: 'none' });
    h.board.outOfTime('b');
    expect(h.board.getResult()).toBe('1-0');
    expect(over().at(-1)).toEqual({ result: '1-0', reason: 'timeout' });

    h.board.load('4k3/8/8/8/8/8/8/3NK3 w - - 0 1'); // white has king + knight only
    h.board.outOfTime('b');
    expect(h.board.getResult()).toBe('1/2-1/2');

    h.board.load('4k3/8/8/8/8/8/8/2NNK3 w - - 0 1'); // two knights can still mate
    h.board.outOfTime('b');
    expect(h.board.getResult()).toBe('1-0');

    h.board.load('4k3/p7/8/8/8/8/8/4K3 w - - 0 1');
    h.board.outOfTime('w'); // black has a pawn
    expect(h.board.getResult()).toBe('0-1');
  });

  it('setResult accepts any reason and a null result', () => {
    h = setup({ animationType: 'none' });
    expect(h.board.setResult(null, 'abandon')).toBe(true);
    expect(h.board.getResult()).toBeNull();
    expect(h.board.getGameOverReason()).toBe('abandon');
    expect(h.board.isGameOver()).toBe(true);
  });

  it('resign() defaults to the local player', () => {
    h = setup({ animationType: 'none', playingAs: 'b' });
    h.board.resign();
    expect(h.board.getResult()).toBe('1-0');
  });

  it('plays the game-end sound once and cancels premoves', () => {
    h = setup({ animationType: 'none' });
    h.board.move('e2e4', { animate: false });
    // white is the local player and black is to move → white may premove
    h.drag('d2', 'd4');
    expect(h.board.getPremoves().length).toBe(1);
    const sounds: string[] = [];
    h.board.on('sound', (s) => sounds.push(s));
    h.board.agreeDraw();
    expect(h.board.getPremoves().length).toBe(0);
    expect(sounds.filter((s) => s === 'game-end')).toEqual(['game-end']);
  });
});

describe('autoClaimDraw', () => {
  it('on (default): the fifty-move rule ends the game by itself', () => {
    h = setup({ animationType: 'none' });
    h.board.load('k7/8/8/8/8/8/R7/K7 w - - 99 80');
    h.board.move('a2a3', { animate: false });
    expect(h.board.getGameOverReason()).toBe('fifty');
    expect(h.board.claimDraw()).toBe(false); // already over
  });

  it('off: the draw has to be claimed', () => {
    h = setup({ animationType: 'none', autoClaimDraw: false });
    h.board.load('k7/8/8/8/8/8/R7/K7 w - - 99 80');
    h.board.move('a2a3', { animate: false });
    expect(h.board.isGameOver()).toBe(false);
    expect(h.board.claimDraw()).toBe(true);
    expect(h.board.getResult()).toBe('1/2-1/2');
    expect(h.board.getGameOverReason()).toBe('fifty');
  });

  it('off: threefold repetition is claimable but does not end the game alone', () => {
    h = setup({ animationType: 'none', autoClaimDraw: false });
    expect(h.board.claimDraw()).toBe(false); // nothing to claim
    for (const m of ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8']) h.board.move(m, { animate: false });
    expect(h.board.isGameOver()).toBe(false);
    expect(h.board.claimDraw()).toBe(true);
    expect(h.board.getGameOverReason()).toBe('threefold');
  });

  it('checkmate and stalemate always end the game', () => {
    h = setup({ animationType: 'none', autoClaimDraw: false });
    for (const m of ['f2f3', 'e7e5', 'g2g4', 'd8h4']) h.board.move(m, { animate: false });
    expect(h.board.getGameOverReason()).toBe('checkmate');
    expect(h.board.getResult()).toBe('0-1');
  });
});

describe('position queries', () => {
  it('legal moves, piece lookup, last move and check', () => {
    h = setup({ animationType: 'none' });
    expect(h.board.getLegalMoves().length).toBe(20);
    expect(h.board.getLegalMoves('g1').map((m) => m.to).sort()).toEqual(['f3', 'h3']);
    expect(h.board.isLegalMove('e2e4')).toBe(true);
    expect(h.board.isLegalMove({ from: 'e2', to: 'e5' })).toBe(false);
    expect(h.board.getPiece('e1')).toEqual({ color: 'w', type: 'k' });
    expect(h.board.getPiece('e4')).toBeUndefined();
    expect(h.board.getLastMove()).toBeNull();
    h.board.move('e2e4', { animate: false });
    expect(h.board.getLastMove()?.san).toBe('e4');
    expect(h.board.isCheck()).toBe(false);
    for (const m of ['f7f5', 'd1h5']) h.board.move(m, { animate: false });
    expect(h.board.getLastMove()?.san).toBe('Qh5+');
    expect(h.board.isCheck()).toBe(true);
  });

  it('history as SANs and FENs', () => {
    h = setup({ animationType: 'none' });
    for (const m of ['e2e4', 'e7e5', 'g1f3']) h.board.move(m, { animate: false });
    expect(h.board.getHistorySANs()).toEqual(['e4', 'e5', 'Nf3']);
    const fens = h.board.getHistoryFENs();
    expect(fens.length).toBe(4);
    expect(fens[0]).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(fens[3]).toBe(h.board.getFen());
  });

  it('material', () => {
    h = setup({ animationType: 'none' });
    expect(h.board.getMaterial()).toEqual({ white: 39, black: 39, diff: 0 });
    for (const m of ['e2e4', 'd7d5', 'e4d5']) h.board.move(m, { animate: false });
    expect(h.board.getMaterial()).toEqual({ white: 39, black: 38, diff: 1 });
  });

  it('PGN with headers, result and a custom start position', () => {
    h = setup({ animationType: 'none' });
    for (const m of ['e2e4', 'e7e5', 'g1f3']) h.board.move(m, { animate: false });
    expect(h.board.getPGN()).toBe('[Result "*"]\n\n1. e4 e5 2. Nf3 *');
    h.board.resign('b');
    expect(h.board.getPGN({ White: 'Ann', Black: 'Bo "the" Bot' })).toBe(
      '[White "Ann"]\n[Black "Bo \\"the\\" Bot"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 1-0',
    );

    h.board.load('4k3/8/8/8/8/8/8/4K2R b - - 0 7');
    h.board.move('e8d8', { animate: false });
    h.board.move('h1h2', { animate: false });
    expect(h.board.getPGN()).toBe('[Result "*"]\n[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/8/4K2R b - - 0 7"]\n\n7... Kd8 8. Rh2 *');
  });

  it('blinkSquare is public', () => {
    h = setup({ animationType: 'none' });
    h.board.blinkSquare('e1');
    expect(h.board.el.querySelectorAll('.highlight').length).toBeGreaterThan(0);
  });
});
