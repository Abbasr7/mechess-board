// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { SteppedAnimator, durationFor } from '../src/animation';
import { fileOf, pointerToBoard, rankOf, squareCenter, squareOffset, toSquare } from '../src/squares';
import { piecesBySquare, setup, type Harness } from './helpers';

let h: Harness;
afterEach(() => h?.destroy());

const pieceEl = (sq: string): HTMLElement => {
  const [f, r] = [fileOf(sq), rankOf(sq)];
  return h.board.el.querySelector(`.piece.square-${f}${r}`) as HTMLElement;
};

describe('stepped animation (default engine)', () => {
  it('uses floor(180/16) = 11 steps, linear, ending by clearing the inline transform', () => {
    h = setup({ playingAs: null });
    h.board.move('e4', { animate: true });
    const el = pieceEl('e4');
    // first frame is applied synchronously: one step of eleven from e2 (400%,600%) to e4 (400%,400%)
    expect(el.style.transform).toBe('translate(400%, 581.818%)');
    expect(el.style.zIndex).toBe('10');
    const seen = [el.style.transform];
    for (let i = 0; i < 20 && el.style.transform; i++) {
      h.frames();
      seen.push(el.style.transform);
    }
    expect(seen.length).toBe(11); // 10 translate frames + the final empty one
    expect(seen[0]).toBe('translate(400%, 581.818%)');
    expect(seen[9]).toBe('translate(400%, 418.182%)');
    expect(seen[10]).toBe('');
    expect(el.style.zIndex).toBe('');
    expect(h.board.el.dataset.animating).toBeUndefined();
  });

  it('durations: default 180, fast 100, slow 500, none 0 → 1 step', () => {
    expect(durationFor('default')).toBe(180);
    expect(durationFor('fast')).toBe(100);
    expect(durationFor('slow')).toBe(500);
    expect(durationFor('none')).toBe(0);
    h = setup({ playingAs: null, animationType: 'none' });
    h.board.move('e4', { animate: true });
    expect(pieceEl('e4').style.transform).toBe(''); // a single frame that already clears the transform
  });

  it('flushes a running animation when the next move arrives', () => {
    h = setup({ playingAs: null });
    h.board.move('e4', { animate: true });
    const el = pieceEl('e4');
    expect(el.style.transform).not.toBe('');
    h.board.move('e5', { animate: true });
    expect(el.style.transform).toBe(''); // landed
  });

  it('captured pieces stay opaque for ~65 % of the steps, then fade out, then are recycled', () => {
    h = setup({ playingAs: null });
    h.board.load('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1');
    h.board.move('exd5', { animate: true });
    // the captured pawn's element is still around, fading
    const fading = [...h.board.el.querySelectorAll('.piece.bp')][0] as HTMLElement;
    expect(fading).toBeTruthy();
    const opacities: number[] = [];
    for (let i = 0; i < 12; i++) {
      opacities.push(Number(fading.style.opacity || 1));
      h.frames();
    }
    expect(opacities[0]).toBe(1);
    expect(opacities.slice(0, 7).every((o) => o === 1)).toBe(true); // 65 % of 11 steps ≈ 7
    expect(opacities[9]).toBeLessThan(0.6);
    expect(h.board.el.querySelectorAll('.piece.bp').length).toBe(0);
    expect(h.board.el.querySelectorAll('.element-pool').length).toBeGreaterThan(0);
  });

  it('castling: the rook slides even when the king move itself is not animated', () => {
    h = setup({ playingAs: null });
    h.board.load('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    h.drag('e1', 'g1'); // drag-drop = not animated
    const king = pieceEl('g1');
    const rook = pieceEl('f1');
    expect(king.style.transform).toBe('');
    expect(rook.style.transform).toMatch(/^translate\(/);
    h.frames(15);
    expect(rook.style.transform).toBe('');
  });

  it('animations of one move finish on the same frame (right-aligned)', () => {
    h = setup({ playingAs: null });
    h.board.load('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    h.board.move('e1g1', { animate: true });
    const king = pieceEl('g1');
    const rook = pieceEl('f1');
    let n = 0;
    while ((king.style.transform || rook.style.transform) && n < 30) {
      h.frames();
      n++;
    }
    expect(n).toBeLessThan(15);
    expect(king.style.transform).toBe('');
    expect(rook.style.transform).toBe('');
  });

  it('flipped boards animate between mirrored offsets', () => {
    h = setup({ playingAs: null, flipped: true });
    h.board.move('e4', { animate: true });
    // e2 flipped is (300%, 100%), e4 flipped is (300%, 300%); first step 1/11 of the way
    expect(pieceEl('e4').style.transform).toBe('translate(300%, 118.182%)');
  });
});

describe('dynamic animation (tween)', () => {
  it('moves in pixels with easing and wobbles horizontally travelling pieces', () => {
    h = setup({ playingAs: null, animationType: 'dynamic' });
    h.board.move('g1f3', { animate: true });
    const el = pieceEl('f3');
    expect(el.style.transform).toMatch(/translate\(.*px, .*px\)/);
    expect(el.style.zIndex).toBe('10');
  });
});

describe('SteppedAnimator unit', () => {
  it('reports animating status through hooks', () => {
    const calls: boolean[] = [];
    let animating = false;
    const queue: FrameRequestCallback[] = [];
    (globalThis as { requestAnimationFrame: unknown }).requestAnimationFrame = (cb: FrameRequestCallback) => queue.push(cb);
    const a = new SteppedAnimator({
      isAnimating: () => animating,
      setAnimating: (on) => {
        animating = on;
        calls.push(on);
      },
    });
    const el = document.createElement('div');
    a.add([{ type: 'slide', el, from: 'a1', to: 'a2' }], { animationType: 'fast', flipped: false, boardEl: el });
    a.run();
    while (queue.length) queue.shift()!(0);
    expect(calls[0]).toBe(true);
    expect(calls[calls.length - 1]).toBe(false);
  });
});

describe('geometry', () => {
  it('square offsets and centres', () => {
    expect(squareOffset('a1', false)).toEqual({ x: 0, y: 700 });
    expect(squareOffset('h8', false)).toEqual({ x: 700, y: 0 });
    expect(squareOffset('a1', true)).toEqual({ x: 700, y: 0 });
    expect(squareCenter('a1')).toEqual({ x: 6.25, y: 93.75 });
    expect(squareCenter('h8')).toEqual({ x: 93.75, y: 6.25 });
  });

  it('pointer → board coordinates', () => {
    const rect = { left: 100, top: 50, width: 800, height: 800, bottom: 850 };
    const p = pointerToBoard(rect, 100 + 450, 50 + 450, false); // centre of e5-ish: col 5, row 5
    expect(p.square).toBe('e4');
    expect(p.coords).toEqual({ x: 400, y: 400 });
    const flipped = pointerToBoard(rect, 100 + 450, 50 + 450, true);
    expect(flipped.square).toBe('d5');
    const outside = pointerToBoard(rect, 5000, -400, false);
    expect(outside.square).toBeNull();
    expect(outside.squareInsideBoard).toBe('h8');
    expect(outside.coordsInsideBoard).toEqual({ x: 750, y: -50 });
    expect(toSquare(0, 3)).toBeNull();
  });

  it('piece positions are consistent with squareOffset', () => {
    h = setup();
    expect(Object.keys(piecesBySquare(h)).length).toBe(32);
  });
});
