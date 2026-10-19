// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { piecesBySquare, setup, type Harness } from './helpers';
import { keyName } from '../src/keyboard';

let h: Harness;
afterEach(() => h?.destroy());

const key = (code: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...init });
  document.dispatchEvent(e);
  return e;
};

function play(...moves: string[]): void {
  for (const m of moves) h.board.move(m, { animate: false });
}

describe('history navigation', () => {
  it('steps back and forward through the moves', () => {
    h = setup({ playingAs: null });
    play('e2e4', 'e7e5', 'g1f3');
    expect(h.board.getPly()).toBe(3);
    expect(h.board.isAtEnd()).toBe(true);

    expect(h.board.back()).toBe(true);
    h.frames(30);
    expect(h.board.getPly()).toBe(2);
    expect(h.board.isAtEnd()).toBe(false);
    expect(piecesBySquare(h).f3).toBeUndefined();
    expect(piecesBySquare(h).g1).toBe('wn');
    expect(h.highlightSquares()).toEqual(['e5', 'e7']);

    expect(h.board.forward()).toBe(true);
    h.frames(30);
    expect(piecesBySquare(h).f3).toBe('wn');
    expect(h.board.isAtEnd()).toBe(true);
    expect(h.board.forward()).toBe(false); // already at the end
  });

  it('start / end jumps, clamped to the game', () => {
    h = setup({ playingAs: null });
    play('e2e4', 'e7e5', 'g1f3');
    h.board.toStart();
    expect(h.board.getPly()).toBe(0);
    expect(Object.keys(piecesBySquare(h)).length).toBe(32);
    expect(piecesBySquare(h).e2).toBe('wp');
    expect(h.highlightSquares()).toEqual([]);
    expect(h.board.back()).toBe(false);
    h.board.goTo(99);
    expect(h.board.getPly()).toBe(3);
    expect(piecesBySquare(h).f3).toBe('wn');
  });

  it('a single step animates; captured pieces come back', () => {
    h = setup({ playingAs: null });
    h.board.load('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1');
    play('e4d5');
    h.board.back();
    expect(piecesBySquare(h).e4).toBe('wp');
    expect(piecesBySquare(h).d5).toBe('bp');
    h.frames(30);
    expect(piecesBySquare(h).d5).toBe('bp');
  });

  it('moves are not allowed while looking at an earlier position', () => {
    h = setup({ playingAs: null });
    play('e2e4', 'e7e5');
    h.board.back();
    h.drag('g1', 'f3');
    expect(h.board.getPly()).toBe(1);
    expect(h.board.getFen()).toContain('4p3'); // the live game is untouched
    expect(h.events.find((e) => e.type === 'move-rejected')).toBeTruthy();
    // hints are off too
    h.click('g1');
    expect(h.hintSquares()).toEqual([]);
  });

  it('a move that arrives meanwhile does not yank the view; returning to the end shows it', () => {
    h = setup({ playingAs: null });
    play('e2e4', 'e7e5');
    h.board.toStart();
    h.board.move('g1f3', { animate: true }); // opponent/server move
    expect(h.board.getPlyCount()).toBe(3);
    expect(h.board.getPly()).toBe(0);
    expect(piecesBySquare(h).e2).toBe('wp'); // still the start position
    h.board.toEnd();
    expect(piecesBySquare(h).f3).toBe('wn');
    expect(piecesBySquare(h).e5).toBe('bp');
    expect(h.board.isAtEnd()).toBe(true);
  });

  it('emits navigate events', () => {
    h = setup({ playingAs: null });
    const seen: Array<{ ply: number; atEnd: boolean }> = [];
    h.board.on('navigate', (e) => seen.push({ ply: e.ply, atEnd: e.atEnd }));
    play('e2e4', 'e7e5');
    h.board.back();
    h.board.forward();
    expect(seen).toEqual([
      { ply: 1, atEnd: false },
      { ply: 2, atEnd: true },
    ]);
  });
});

describe('keyboard', () => {
  it('arrow keys and the numpad step through the game', () => {
    h = setup({ playingAs: null });
    play('e2e4', 'e7e5', 'g1f3');
    const e = key('ArrowLeft');
    expect(e.defaultPrevented).toBe(true);
    expect(h.board.getPly()).toBe(2);
    key('Numpad4');
    expect(h.board.getPly()).toBe(1);
    key('ArrowRight');
    expect(h.board.getPly()).toBe(2);
    key('Numpad6');
    expect(h.board.getPly()).toBe(3);
    key('ArrowUp');
    expect(h.board.getPly()).toBe(0);
    key('ArrowDown');
    expect(h.board.getPly()).toBe(3);
    key('Numpad8');
    expect(h.board.getPly()).toBe(0);
    key('Numpad5');
    expect(h.board.getPly()).toBe(3);
  });

  it('x flips the board', () => {
    h = setup();
    expect(h.board.el.classList.contains('flipped')).toBe(false);
    key('KeyX');
    expect(h.board.el.classList.contains('flipped')).toBe(true);
    key('KeyX');
    expect(h.board.el.classList.contains('flipped')).toBe(false);
  });

  it('ignores keys while typing in a field, with ctrl/meta, or when disabled', () => {
    h = setup({ playingAs: null });
    play('e2e4');
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    key('ArrowLeft');
    expect(h.board.getPly()).toBe(1);
    input.remove();
    key('ArrowLeft', { ctrlKey: true });
    expect(h.board.getPly()).toBe(1);
    h.board.setOptions({ disableUserNavigation: true });
    key('ArrowLeft');
    expect(h.board.getPly()).toBe(1);
    h.board.setOptions({ disableUserNavigation: false, captureKeyStrokes: false });
    key('ArrowLeft');
    expect(h.board.getPly()).toBe(1);
    h.board.setOptions({ captureKeyStrokes: true });
    key('ArrowLeft');
    expect(h.board.getPly()).toBe(0);
  });

  it('reports raw key events and tracks pressed keys', () => {
    h = setup();
    const got: string[] = [];
    h.board.on('keydown', (e) => got.push(e.key));
    key('KeyB');
    expect(got).toEqual(['b']);
    expect(h.board.isKeyPressed('b')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyB' }));
    expect(h.board.isKeyPressed('b')).toBe(false);
  });

  it('key names', () => {
    expect(keyName('KeyX')).toBe('x');
    expect(keyName('Digit5')).toBe('5');
    expect(keyName('ArrowLeft')).toBe('arrowleft');
    expect(keyName('ShiftLeft')).toBe('shift');
    expect(keyName('ControlRight')).toBe('control');
    expect(keyName('F5')).toBeUndefined();
  });
});
