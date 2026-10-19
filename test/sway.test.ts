// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SWAY, easeOutBack, initialRotation, scaleAt, stepRotation } from '../src/view/sway';
import { setup, type Harness } from './helpers';

let h: Harness;
afterEach(() => h?.destroy());

describe('sway physics', () => {
  it('tilts towards the direction of travel and is capped at ±10°', () => {
    let s = initialRotation();
    for (let i = 0; i < 60; i++) s = stepRotation(s, 40, 1 / 60); // fast to the right
    expect(s.rotation).toBeGreaterThan(9);
    expect(s.rotation).toBeLessThanOrEqual(SWAY.maxAngle);
    let l = initialRotation();
    for (let i = 0; i < 60; i++) l = stepRotation(l, -40, 1 / 60);
    expect(l.rotation).toBeLessThan(-9);
    expect(l.rotation).toBeGreaterThanOrEqual(-SWAY.maxAngle);
  });

  it('slow movement does not tilt; stopping returns to upright', () => {
    let s = initialRotation();
    for (let i = 0; i < 5; i++) s = stepRotation(s, 0.5, 1 / 60);
    expect(Math.abs(s.rotation)).toBeLessThan(0.01);

    for (let i = 0; i < 30; i++) s = stepRotation(s, 25, 1 / 60);
    expect(s.rotation).toBeGreaterThan(5);
    for (let i = 0; i < 240; i++) s = stepRotation(s, 0, 1 / 60);
    expect(Math.abs(s.rotation)).toBeLessThan(SWAY.deadZone); // rests inside the dead zone (a sub-0.3° counter-swing may linger, as in the original)
  });

  it('the pick-up pop starts at 1.25, overshoots below 1 and ends at exactly 1', () => {
    expect(scaleAt(0)).toBeCloseTo(1.25, 5);
    expect(easeOutBack(1)).toBeCloseTo(1, 5);
    const mid = Array.from({ length: 20 }, (_, i) => scaleAt((i / 20) * 0.2));
    expect(Math.min(...mid)).toBeLessThan(1); // ease-out-back overshoot
    expect(scaleAt(0.2)).toBe(1);
    expect(scaleAt(5)).toBe(1);
  });
});

describe('sway on the board', () => {
  const tick = (ms: number): void => {
    vi.advanceTimersByTime(ms);
  };

  it('is off for the default animation type and on for "dynamic"', () => {
    h = setup();
    h.down('e2');
    h.moveTo('e3');
    expect((h.board.el.querySelector('.dragging') as HTMLElement).style.transform).toContain('rotate(0deg) scale(1)');
    h.up('e3');
    h.destroy();

    h = setup({ animationType: 'dynamic' });
    h.board.setOptions({ pieceSway: true });
    h.down('e2');
    expect(h.board.el.querySelector('.dragging')).toBeTruthy();
  });

  it('applies the pop on pick-up and a tilt while moving right (dynamic)', () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const rafs: FrameRequestCallback[] = [];
    h = setup({ animationType: 'dynamic' });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => rafs.push(cb));
    const frame = (dt = 16): void => {
      now += dt;
      const batch = rafs.splice(0);
      batch.forEach((cb) => cb(now));
    };

    h.down('e2');
    const el = h.board.el.querySelector('.dragging') as HTMLElement;
    frame(); // first frame of the loop: scale pop begins
    const first = /scale\(([\d.]+)\)/.exec(el.style.transform);
    expect(first).toBeTruthy();
    expect(Number(first![1])).toBeGreaterThan(1.1);

    // drag to the right, a few px per frame (board-space units)
    let x = h.pt('e2').x;
    for (let i = 0; i < 12; i++) {
      x += 30;
      h.moveTo({ x, y: h.pt('e2').y });
      frame();
    }
    const rot = Number(/rotate\((-?[\d.]+)deg\)/.exec(el.style.transform)![1]);
    expect(rot).toBeGreaterThan(3);
    expect(rot).toBeLessThanOrEqual(10);

    // keep still: the tilt relaxes
    for (let i = 0; i < 120; i++) frame();
    const rest = Number(/rotate\((-?[\d.]+)deg\)/.exec(el.style.transform)![1]);
    expect(Math.abs(rest)).toBeLessThan(0.5);
    // scale settled
    expect(el.style.transform).toMatch(/scale\(1\)$/);

    // drop: transform is cleared by the class-based position
    h.up('e2');
    expect(el.style.transform).toBe('');
    tick(10);
    vi.useRealTimers();
  });
});
