// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setup, type Harness } from './helpers';

let h: Harness;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  h?.destroy();
  vi.useRealTimers();
});

const vfx = (type: string): HTMLElement[] => [...h.board.el.querySelectorAll(`.vfx-${type}`)] as HTMLElement[];
const keyDown = (code: string): void => void document.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
const keyUp = (code: string): void => void document.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));

describe('board slam', () => {
  it('every piece jumps; a click puts everything back', () => {
    h = setup();
    h.board.triggerSlam();
    expect(h.board.el.classList.contains('hide-pieces')).toBe(true);
    expect(vfx('piece-jump').length).toBe(32);
    h.board.triggerSlam(); // re-roll
    expect(vfx('piece-jump').length).toBe(32);
    h.click('e4');
    expect(h.board.el.classList.contains('hide-pieces')).toBe(false);
    expect(vfx('piece-jump').length).toBe(0);
  });
});

describe('fidgets (opt-in)', () => {
  it('triple-clicking your own piece while the opponent is to move flips it', () => {
    h = setup({ extras: { fidgets: true } });
    h.board.move('e4', { userGenerated: true, animate: false }); // now black to move
    h.click('g1');
    h.click('g1');
    expect(vfx('piece-flip').length).toBe(0);
    h.click('g1');
    expect(vfx('piece-flip').length).toBe(1);
    expect(h.board.el.querySelector('.piece.wn.piece-hidden')).toBeTruthy();
  });

  it('slow clicks do not count', () => {
    h = setup({ extras: { fidgets: true } });
    h.board.move('e4', { userGenerated: true, animate: false });
    h.click('g1');
    vi.advanceTimersByTime(700);
    h.click('g1');
    vi.advanceTimersByTime(700);
    h.click('g1');
    expect(vfx('piece-flip').length).toBe(0);
  });

  it("holding an opponent's piece for 500 ms charges it; releasing makes it jump", () => {
    h = setup({ extras: { fidgets: true } });
    h.down('e7'); // white to move: e7 is the opponent's pawn
    vi.advanceTimersByTime(400);
    expect(vfx('charge-jump').length).toBe(0);
    vi.advanceTimersByTime(150);
    expect(vfx('charge-jump').length).toBe(1);
    h.up('e7');
    expect((vfx('charge-jump')[0].querySelector('.element') as HTMLElement).classList.contains('jumping')).toBe(true);
  });

  it('releasing early or moving away cancels the charge', () => {
    h = setup({ extras: { fidgets: true } });
    h.down('e7');
    vi.advanceTimersByTime(200);
    h.up('e7');
    vi.advanceTimersByTime(600);
    expect(vfx('charge-jump').length).toBe(0);
  });

  it('is off by default', () => {
    h = setup();
    h.down('e7');
    vi.advanceTimersByTime(700);
    expect(vfx('charge-jump').length).toBe(0);
  });
});

describe('piece throw', () => {
  it('throwPiece() shows the hand and throws the piece away, then it comes back', () => {
    h = setup({ extras: { handImageUrl: '/hand.png' } });
    h.board.throwPiece('e2');
    expect(vfx('hand-throw').length).toBe(1);
    expect(vfx('piece-throw').length).toBe(1);
    expect(h.board.el.querySelector('.piece.wp.piece-hidden')).toBeTruthy();
    vi.advanceTimersByTime(2200);
    expect(vfx('piece-throw').length).toBe(0);
    expect(h.board.el.querySelector('.piece.piece-hidden')).toBeNull();
  });

  it('does nothing without a hand image', () => {
    h = setup();
    h.board.throwPiece('e2');
    expect(vfx('hand-throw').length).toBe(0);
  });
});

describe('boxing glove', () => {
  it('holding b shows a glove cursor that follows the pointer; fast movement over a piece punches it', () => {
    h = setup({ extras: { boxingGlove: true } });
    keyDown('KeyB');
    const glove = h.board.el.querySelector('.boxing-glove-cursor') as HTMLElement;
    expect(glove).toBeTruthy();
    const ev = (x: number, y: number, t: number): PointerEvent => {
      const e = new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y }) as unknown as PointerEvent;
      Object.defineProperty(e, 'timeStamp', { value: t });
      return e;
    };
    document.dispatchEvent(ev(10, 10, 0));
    expect(glove.classList.contains('boxing-glove-cursor--active')).toBe(true);
    // a fast sweep across the e2 pawn (centre 450,650 in the 800 px board)
    document.dispatchEvent(ev(300, 650, 10));
    document.dispatchEvent(ev(450, 650, 20));
    expect(vfx('piece-throw').length).toBeGreaterThan(0);
    const throwEl = vfx('piece-throw')[0].querySelector('.element') as HTMLElement;
    expect(throwEl.style.getPropertyValue('--throw-x')).not.toBe('');
    keyUp('KeyB');
    expect(h.board.el.querySelector('.boxing-glove-cursor')).toBeNull();
  });

  it('slow movement does not punch', () => {
    h = setup({ extras: { boxingGlove: true } });
    keyDown('KeyB');
    const ev = (x: number, y: number, t: number): PointerEvent => {
      const e = new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y }) as unknown as PointerEvent;
      Object.defineProperty(e, 'timeStamp', { value: t });
      return e;
    };
    document.dispatchEvent(ev(440, 650, 0));
    document.dispatchEvent(ev(450, 650, 1000)); // 0.01 px/ms
    expect(vfx('piece-throw').length).toBe(0);
  });
});
