// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setup, type Harness } from './helpers';

let h: Harness;
afterEach(() => {
  vi.useRealTimers();
  h?.destroy();
});

const win = (): HTMLElement => h.board.el.querySelector('.promotion-window') as HTMLElement;
const FEN = 'k7/4P3/8/8/8/8/8/K7 w - - 0 1';

function open(type: 'default' | 'dynamic'): void {
  h = setup({ animationType: type });
  h.board.load(FEN);
  h.drag('e7', 'e8');
  expect(win()).toBeTruthy();
}

describe('promotion window', () => {
  it('default: closes at once', () => {
    open('default');
    h.click('a1'); // click elsewhere cancels
    expect(win().style.display).toBe('none');
    expect(win().classList.contains('closing')).toBe(false);
  });

  it('dynamic: plays the closing state, then hides after 280 ms', () => {
    vi.useFakeTimers();
    open('dynamic');
    expect(win().classList.contains('promotion-window--visible')).toBe(true);
    vi.advanceTimersByTime(800); // opening done
    h.board.el.querySelector('.promotion-window .close-button')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    expect(win().classList.contains('closing')).toBe(true);
    expect(win().classList.contains('promotion-window--visible')).toBe(false);
    expect(win().style.getPropertyValue('--promotion-close-duration')).toBe('200ms');
    vi.advanceTimersByTime(270);
    expect(win().style.display).not.toBe('none');
    vi.advanceTimersByTime(20);
    expect(win().style.display).toBe('none');
    expect(win().classList.contains('closing')).toBe(false);
  });

  it('dynamic: hides when the queen has faded out', () => {
    vi.useFakeTimers();
    open('dynamic');
    vi.advanceTimersByTime(800);
    h.board.el.querySelector('.promotion-window .close-button')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    const queen = win().querySelector('.promotion-piece.wq')!;
    queen.dispatchEvent(Object.assign(new Event('transitionend', { bubbles: true }), { propertyName: 'opacity' }));
    expect(win().style.display).toBe('none');
  });

  it('dynamic: the close button ignores presses while the window is still opening', () => {
    vi.useFakeTimers();
    open('dynamic');
    const events: string[] = [];
    h.board.on('promotion-cancel', () => events.push('cancel'));
    const press = (): void => void h.board.el.querySelector('.promotion-window .close-button')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    press();
    expect(events).toEqual([]);
    expect(win().classList.contains('closing')).toBe(false);
    // the clip-path transition ends → presses work
    win().dispatchEvent(Object.assign(new Event('transitionend'), { propertyName: 'clip-path' }));
    press();
    expect(events).toEqual(['cancel']);
  });

  it('dynamic: re-opening during the close animation shows the window again', () => {
    vi.useFakeTimers();
    open('dynamic');
    vi.advanceTimersByTime(800);
    h.board.el.querySelector('.promotion-window .close-button')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    h.drag('e7', 'e8');
    expect(win().classList.contains('closing')).toBe(false);
    expect(win().style.display).toBe('');
    expect(win().classList.contains('promotion-window--visible')).toBe(true);
    vi.advanceTimersByTime(500);
    expect(win().style.display).toBe('');
  });
});
