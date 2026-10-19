// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { knightMinProgress, knightPolygon, straightMinProgress, straightPolygon, ARROW_TIMING } from '../src/view/arrows';
import { setup, type Harness } from './helpers';

let h: Harness;
let now = 1000;
const advance = (ms: number, step = 16): void => {
  const end = now + ms;
  while (now < end) {
    now = Math.min(now + step, end);
    h.frames();
  }
};

beforeEach(() => {
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => h?.destroy());

describe('accessibility', () => {
  it('lays a labelled grid over the board and announces moves', () => {
    h = setup({ playingAs: null, accessibility: true });
    const cells = [...h.board.el.querySelectorAll('.a11y-overlay [role="gridcell"] div')].map((d) => d.getAttribute('aria-label'));
    expect(cells.length).toBe(64);
    expect(cells[0]).toBe('black rook on a8'); // top-left
    expect(cells[63]).toBe('white rook on h1'); // bottom-right
    expect(cells).toContain('e4');
    h.board.move('e2e4', { animate: false });
    expect((h.board.el.querySelector('.a11y-announcement') as HTMLElement).textContent).toBe('pawn to e4.');
    expect(h.board.a11y.isAttached()).toBe(true);
    const labels = [...h.board.el.querySelectorAll('.a11y-overlay div')].map((d) => d.getAttribute('aria-label'));
    expect(labels).toContain('white pawn on e4');
    expect(labels).toContain('e2');
    h.board.move('d7d5', { animate: false });
    h.board.move('e4d5', { animate: false });
    expect((h.board.el.querySelector('.a11y-announcement') as HTMLElement).textContent).toBe('pawn takes d5.');
  });

  it('follows the board when it is flipped and can be switched off', () => {
    h = setup({ accessibility: true });
    h.board.setOptions({ flipped: true });
    const first = h.board.el.querySelector('.a11y-overlay [role="gridcell"] div')!.getAttribute('aria-label');
    expect(first).toBe('white rook on h1');
    h.board.setOptions({ accessibility: false });
    expect(h.board.el.querySelector('.a11y-overlay')).toBeNull();
  });

  it('announces promotion', () => {
    h = setup({ playingAs: null, accessibility: true });
    h.board.load('k7/4P3/8/8/8/8/8/K7 w - - 0 1');
    h.board.move('e7e8n', { animate: false });
    expect((h.board.el.querySelector('.a11y-announcement') as HTMLElement).textContent).toBe('pawn to e8. Promoted to knight.');
  });
});

describe('analysis overlay and fade-in', () => {
  it('toggles a veil class', () => {
    h = setup();
    expect(h.board.el.classList.contains('analysis-overlay')).toBe(false);
    h.board.setOptions({ analysisOverlay: true });
    expect(h.board.el.classList.contains('analysis-overlay')).toBe(true);
    h.board.setOptions({ analysisOverlay: false });
    expect(h.board.el.classList.contains('analysis-overlay')).toBe(false);
  });

  it('fadeSetup covers the position and fades out over the given time', () => {
    h = setup({ fadeSetup: 800 });
    const o = h.board.el.querySelector('.fade-in-overlay') as HTMLElement;
    expect(o).toBeTruthy();
    expect(o.classList.contains('animate')).toBe(true);
    expect(o.style.animationDuration).toBe('0.8s');
    h.board.load('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
    expect((h.board.el.querySelector('.fade-in-overlay') as HTMLElement).classList.contains('animate')).toBe(true);
    h.board.setOptions({ fadeSetup: 0 });
    h.board.load();
    expect(h.board.el.querySelector('.fade-in-overlay')).toBeNull();
  });
});

describe('arrow geometry with growth progress', () => {
  it('a half-grown straight arrow is shorter than a full one; min progress leaves the origin square', () => {
    const full = straightPolygon(37.5, 1);
    const half = straightPolygon(37.5, 0.5);
    expect(half[3][1]).toBeLessThan(full[3][1]); // arrow tip
    const min = straightMinProgress(37.5);
    expect(min).toBeGreaterThan(0);
    expect(min).toBeLessThan(1);
    // at min progress the tip sits just beyond the edge of the origin square (half a square = 6.25)
    expect(straightPolygon(37.5, min)[3][1]).toBeGreaterThanOrEqual(6.25 - 0.01);
  });

  it('knight arrow: straight until the corner, then L-shaped', () => {
    expect(knightPolygon(0.3).length).toBe(7);
    expect(knightPolygon(1).length).toBe(9);
    expect(knightMinProgress()).toBeGreaterThan(0.3);
  });
});

describe('arrow width', () => {
  it('scales the shaft and the head; 1 (or none) is the original arrow', () => {
    const base = straightPolygon(37.5, 1);
    expect(straightPolygon(37.5, 1, 1)).toEqual(base);
    const wide = straightPolygon(37.5, 1, 2);
    expect(wide[0][0]).toBeCloseTo(base[0][0] * 2); // half shaft width
    expect(wide[2][0]).toBeCloseTo(base[2][0] * 2); // half head width
    // the tip still ends at the same place
    expect(wide[3][1]).toBeCloseTo(base[3][1]);
  });

  it('a marking keeps its width, and a different width redraws the arrow', () => {
    h = setup({ playingAs: null });
    h.board.markings.add({ kind: 'arrow', from: 'e2', to: 'e4', width: 1.5 });
    const first = h.board.el.querySelector('polygon[data-arrow="e2e4"]');
    expect(first).not.toBeNull();
    h.board.markings.add({ kind: 'arrow', from: 'e2', to: 'e4', width: 0.6 });
    const second = h.board.el.querySelector('polygon[data-arrow="e2e4"]');
    expect(second).not.toBe(first);
    expect(second!.getAttribute('points')).not.toBe(first!.getAttribute('points'));
  });
});

describe('animated arrows', () => {
  it('grow in over 400 ms (opacity ramps up) and then breathe on a 1.4 s cycle', () => {
    h = setup({ userMarkings: { animated: true } });
    h.rightDrag('a1', 'a5');
    const poly = h.board.el.querySelector('.arrows polygon') as SVGPolygonElement;
    expect(poly.getAttribute('data-animated')).toBe('true');
    expect(Number(poly.style.opacity)).toBeLessThan(0.1); // starts invisible
    advance(120);
    const mid = Number(poly.style.opacity);
    expect(mid).toBeGreaterThan(0.2);
    advance(ARROW_TIMING.growDuration);
    expect(Number(poly.style.opacity)).toBeCloseTo(0.8, 2);
    // breathing: the arrow shortens and lengthens
    const tips: number[] = [];
    for (let i = 0; i < 20; i++) {
      advance(70);
      tips.push(Number(poly.getAttribute('points')!.split(',')[3].trim().split(' ')[1]));
    }
    expect(Math.max(...tips) - Math.min(...tips)).toBeGreaterThan(1.2); // the shaft breathes by 1.75 units
    // removing the arrow stops the loop
    h.rightDrag('a1', 'a5');
    expect(h.board.el.querySelectorAll('.arrows polygon').length).toBe(0);
  });

  it('pointer-finger arrows are a hand that glides from origin to target', () => {
    h = setup({ userMarkings: { pointerFinger: true } });
    h.rightDrag('a1', 'a3');
    const g = h.board.el.querySelector('.pointer-finger-container') as SVGGElement;
    expect(g).toBeTruthy();
    expect(g.style.getPropertyValue('--from-x')).toBe('6.25px');
    expect(g.style.getPropertyValue('--to-y')).toBe('68.75px');
    // 2 squares × 314 ms of travel, after a 350 ms fade-in
    expect(g.style.animation).toContain('finger-move 628ms ease-in-out 350ms');
    expect(g.style.animation).toContain('finger-fade-out 100ms ease-out 1278ms');
    // after fading out it waits 800 ms and starts over
    vi.useFakeTimers();
    g.dispatchEvent(Object.assign(new Event('animationend'), { animationName: 'finger-fade-out' }));
    expect(g.style.animation).toBe('');
    vi.advanceTimersByTime(850);
    expect(g.style.animation).toContain('finger-fade-in');
    vi.useRealTimers();
  });

  it('persistent user markings survive board clicks', () => {
    h = setup({ userMarkings: { persistent: true } });
    h.rightDrag('a1', 'a5');
    h.click('d4');
    expect(h.board.el.querySelectorAll('.arrows polygon').length).toBe(1);
  });
});
