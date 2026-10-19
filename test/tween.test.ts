import { describe, expect, it } from 'vitest';
import { Animator } from '../src/fx/tween';
import { inOutQuad, inQuad, outBack, outCubic, outElastic, outQuad } from '../src/fx/easing';

const run = (a: Animator, from: number, to: number, step = 5): void => {
  for (let t = from; t <= to; t += step) a.update(t);
};

describe('easings', () => {
  it('all start at 0 and end at 1', () => {
    for (const f of [inQuad, outQuad, inOutQuad, outCubic, outBack, outElastic]) {
      expect(f(0)).toBeCloseTo(0, 6);
      expect(f(1)).toBeCloseTo(1, 6);
    }
    expect(inOutQuad(0.5)).toBeCloseTo(0.5, 6);
  });
});

describe('keyframe animator', () => {
  it('interpolates linearly between keyframes and quantises time to whole percents', () => {
    const a = new Animator(true);
    const target: Record<string, number> = {};
    a.play({ duration: 1000, keyframes: { 0: { x: 0 }, 100: { x: 100 } }, target });
    a.update(1); // starts (startTime = 1)
    a.update(501);
    expect(target.x).toBeCloseTo(50, 5);
    a.update(1001);
    expect(target.x).toBe(100);
  });

  it('applies the easing to each segment, not to the whole timeline', () => {
    const a = new Animator(true);
    const target: Record<string, number> = {};
    // two segments: 0..50 and 50..100, ease-in each
    a.play({ duration: 1000, easing: inQuad, keyframes: { 0: { v: 0 }, 50: { v: 10 }, 100: { v: 20 } }, target });
    a.update(1);
    a.update(251); // 25 % overall = 50 % into the first segment → inQuad(0.5) * 10
    expect(target.v).toBeCloseTo(2.5, 5);
    a.update(751); // 75 % overall = 50 % into the second segment → 10 + inQuad(0.5) * 10
    expect(target.v).toBeCloseTo(12.5, 5);
  });

  it('properties only need to appear where they change', () => {
    const a = new Animator(true);
    const t: Record<string, number> = {};
    a.play({ duration: 100, keyframes: { 0: { x: 0, y: 5 }, 60: { x: 60 }, 100: { x: 60, y: 9 } }, target: t });
    a.update(1);
    a.update(31); // 30 %
    expect(t.x).toBeCloseTo(30, 5); // 0→60 over 0..60 %
    expect(t.y).toBeCloseTo(5 + (4 * 30) / 100, 5); // y spans 0..100
  });

  it('honours delay, repeat and onEnd', () => {
    const a = new Animator(true);
    const log: string[] = [];
    a.play({ delay: 100, duration: 100, repeat: 2, onStart: () => log.push('start'), onEnd: () => log.push('end'), keyframes: { 0: { z: 0 }, 100: { z: 1 } } });
    a.update(0);
    expect(log).toEqual([]); // still waiting
    run(a, 101, 200, 10);
    expect(log).toEqual(['start']);
    run(a, 201, 320, 10); // second repetition
    expect(log).toEqual(['start', 'end']);
    expect(a.playingCount()).toBe(0);
  });

  it('keepAlive animations stay until ended explicitly', () => {
    const a = new Animator(true);
    const t = a.play({ duration: 50, keepAlive: true, keyframes: { 0: { q: 0 }, 100: { q: 1 } } });
    run(a, 1, 200, 10);
    expect(a.playingCount()).toBe(1);
    expect(t.keptAlive).toBe(true);
    a.end(t);
    expect(a.playingCount()).toBe(0);
    expect(t.forcedEnd).toBe(true);
  });

  it('endAll jumps to the end state', () => {
    const a = new Animator(true);
    const t: Record<string, number> = {};
    a.play({ duration: 1000, keyframes: { 0: { x: 0 }, 100: { x: 7 } }, target: t });
    a.update(1);
    a.update(100);
    a.endAll();
    expect(t.x).toBe(7);
  });

  it('open-ended animations (no duration) run until ended and still call onUpdate', () => {
    const a = new Animator(true);
    let n = 0;
    const t = a.play({ onUpdate: () => n++ });
    run(a, 1, 100, 10);
    expect(n).toBeGreaterThan(5);
    expect(a.playingCount()).toBe(1);
    a.end(t);
    expect(a.playingCount()).toBe(0);
  });
});
