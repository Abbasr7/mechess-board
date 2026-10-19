/**
 * Keyframe animator.
 *
 * A port of the behaviour of the original's `animator.play({...})`:
 *  - keyframes are keyed by integer percent (0..100); a property only has to
 *    appear in the keyframes where it changes;
 *  - the easing is applied to the *local* progress of the segment between two
 *    keyframes of that property, not to the whole timeline;
 *  - elapsed time is quantised to whole percents;
 *  - `delay`, `repeat` (Infinity allowed), `repeatDelay`, `keepAlive` (stay
 *    "playing" at the end until `end()` is called) and open-ended animations
 *    (no duration) are supported.
 */
import { linear, type Easing } from './easing';

export type Keyframes = Record<number, Record<string, number>>;

export interface TweenParams<D = unknown> {
  duration?: number;
  delay?: number;
  easing?: Easing;
  keyframes?: Keyframes;
  repeat?: number;
  repeatDelay?: number;
  keepAlive?: boolean;
  /** Receives the interpolated numbers as properties (like `target[prop] = value`). */
  target?: Record<string, number>;
  data?: D;
  onStart?: (t: Tween<D>) => void;
  onUpdate?: (t: Tween<D>) => void;
  onEnd?: (t: Tween<D>) => void;
  /** Render the first frame synchronously instead of on the next animation frame. */
  immediateFirstFrame?: boolean;
}

export interface Tween<D = unknown> {
  params: TweenParams<D>;
  data: D | undefined;
  animatedProps: Record<string, number>;
  frameInfo: { elapsedInterval: number; elapsedPercentage: number; deltaTime: number };
  started: boolean;
  ended: boolean;
  forcedEnd: boolean;
  keptAlive: boolean;
  /** Register a callback for when the animation ends. Returns the tween for chaining. */
  onEnd(cb: (t: Tween<D>) => void): Tween<D>;
}

interface Internal<D> extends Tween<D> {
  startTime: number;
  endTime: number;
  repeatCount: number;
  keyframeTimes: Record<string, number[]>;
  endCallbacks: Array<(t: Tween<D>) => void>;
}

export class Animator {
  private list: Internal<unknown>[] = [];
  private raf = 0;
  private last = 0;
  private manual: boolean;

  /** `manual`: do not schedule animation frames; the owner calls `update(now)`. */
  constructor(manual = false) {
    this.manual = manual;
  }

  get playingAnimations(): readonly Tween[] {
    return this.list;
  }

  playingCount(): number {
    return this.list.length;
  }

  play<D = unknown>(params: TweenParams<D>): Tween<D> {
    const keyframeTimes: Record<string, number[]> = {};
    const animatedProps: Record<string, number> = {};
    if (params.keyframes) {
      const pcts = Object.keys(params.keyframes)
        .map(Number)
        .sort((a, b) => a - b);
      for (const pct of pcts) {
        for (const prop of Object.keys(params.keyframes[pct])) {
          (keyframeTimes[prop] ||= []).push(pct);
          if (!(prop in animatedProps)) animatedProps[prop] = params.keyframes[pct][prop];
        }
      }
    }
    const t: Internal<D> = {
      params,
      data: params.data,
      animatedProps,
      frameInfo: { elapsedInterval: 0, elapsedPercentage: 0, deltaTime: 0 },
      started: false,
      ended: false,
      forcedEnd: false,
      keptAlive: false,
      startTime: 0,
      endTime: 0,
      repeatCount: params.repeat ?? 1,
      keyframeTimes,
      endCallbacks: params.onEnd ? [params.onEnd] : [],
      onEnd(cb) {
        this.endCallbacks.push(cb);
        return this;
      },
    };
    this.list.push(t as Internal<unknown>);
    if (!this.raf && !this.manual) this.start(params.immediateFirstFrame);
    return t;
  }

  /** Jump one animation to its end state and finish it. */
  end(t: Tween): void {
    const a = t as Internal<unknown>;
    if (a.ended || this.list.indexOf(a) < 0) return;
    a.frameInfo.elapsedInterval = 1;
    a.frameInfo.elapsedPercentage = 100;
    this.apply(a);
    this.finish(a, true);
  }

  endAll(): void {
    [...this.list].forEach((a) => this.end(a));
  }

  /** Advance all animations to `now` (ms). Called by the internal loop or by the owner in manual mode. */
  update(now: number): void {
    const dt = (now - this.last) * 0.001;
    for (const a of [...this.list]) {
      if (a.startTime > now) continue;
      a.frameInfo.deltaTime = dt;
      if (!a.started && !this.begin(a, now)) continue;
      if (a.endTime) {
        a.frameInfo.elapsedInterval = Math.min((now - a.startTime) / (a.endTime - a.startTime), 1);
        a.frameInfo.elapsedPercentage = Math.round(a.frameInfo.elapsedInterval * 100);
      }
      this.apply(a);
      if (a.endTime && a.endTime <= now) this.finish(a);
    }
    this.last = now;
  }

  private start(immediate = false): void {
    this.last = performance.now();
    if (immediate) this.tick(this.last);
    else this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    this.raf = 0;
    this.update(now);
    if (this.list.length && !this.manual) this.raf = requestAnimationFrame(this.tick);
  };

  private begin(a: Internal<unknown>, now: number): boolean {
    const { duration, delay, onStart } = a.params;
    if (!a.startTime) {
      a.startTime = now + (delay || 0);
      if (duration !== undefined && duration !== Infinity) a.endTime = a.startTime + duration;
    }
    if (a.startTime > now) return false;
    a.started = true;
    onStart?.(a);
    return true;
  }

  private apply(a: Internal<unknown>): void {
    this.interpolate(a);
    a.params.onUpdate?.(a);
  }

  private interpolate(a: Internal<unknown>): void {
    const { keyframes, target } = a.params;
    if (!keyframes) return;
    const ease = a.params.easing ?? linear;
    const pct = a.frameInfo.elapsedPercentage;
    for (const prop of Object.keys(a.animatedProps)) {
      const times = a.keyframeTimes[prop];
      let from = times[0];
      let to = times[0];
      let u = keyframes[from][prop];
      let d = u;
      for (let i = 1; i < times.length; i++) {
        from = times[i - 1];
        to = times[i];
        u = keyframes[from][prop];
        d = keyframes[to][prop];
        if (pct >= from && pct <= to) break;
      }
      let m = to === from ? 1 : (pct - from) / (to - from);
      m = ease(m);
      a.animatedProps[prop] = u + (d - u) * m;
      if (target) target[prop] = a.animatedProps[prop];
    }
  }

  private finish(a: Internal<unknown>, forced = false): void {
    const { duration, keepAlive, repeatDelay } = a.params;
    a.repeatCount--;
    a.forcedEnd = forced;
    if (!forced && a.repeatCount > 0 && duration && duration !== Infinity) {
      a.startTime = a.endTime + (repeatDelay || 0);
      a.endTime = a.startTime + duration;
      return;
    }
    if (!forced && keepAlive) {
      a.keptAlive = true;
      return;
    }
    a.ended = true;
    // leave the list first: end callbacks ask `playingCount()` whether this was the last animation
    const i = this.list.indexOf(a);
    if (i >= 0) this.list.splice(i, 1);
    a.endCallbacks.forEach((cb) => cb(a));
  }
}
