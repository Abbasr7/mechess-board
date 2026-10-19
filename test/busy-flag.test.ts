// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setup, type Harness } from './helpers';

let h: Harness;
let now = 1000;
const advance = (ms: number): void => {
  const end = now + ms;
  while (now < end) {
    now = Math.min(now + 16, end);
    h.frames();
  }
};

beforeEach(() => {
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => h?.destroy());

// Regression: the "animating" flag of the dynamic engine never cleared (the last tween was still counted
// while its own end callback ran), so animationComplete() hung forever in a real browser.
describe('animating flag', () => {
  for (const type of ['default', 'dynamic', 'natural', 'arcade'] as const) {
    it(`${type}: clears after a slide and resolves animationComplete()`, async () => {
      h = setup({ animationType: type });
      h.click('g1');
      h.click('f3'); // click-to-move slides
      expect(h.board.el.dataset.animating).toBe('true');
      let done = false;
      void h.board.animationComplete().then(() => (done = true));
      advance(1200);
      await Promise.resolve();
      expect(h.board.el.dataset.animating).toBeUndefined();
      expect(done).toBe(true);
    });
  }
});

describe('drag cancel by the right button', () => {
  it('a pointermove that gains the right button (how browsers report a chorded press) cancels the drag', () => {
    h = setup({ animationType: 'none' });
    h.down('e2');
    document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 450, clientY: 450, buttons: 3, button: 2 }));
    h.up('e4');
    expect(h.board.getFen().split(' ')[0]).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
  });
});
