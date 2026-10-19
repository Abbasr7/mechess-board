/**
 * Piece animation engines.
 *
 * Observed in the original:
 *  - the default engine ("js") plays a *stepped* animation: one `requestAnimationFrame`
 *    per step, `floor(duration / 16)` steps, each step setting an inline
 *    `transform: translate(x%, y%)` (linear) and the last step clearing it so
 *    the CSS square class takes over. Several animations (e.g. king + rook when
 *    castling) are right-aligned so they finish on the same frame.
 *  - captured pieces fade out: opacity stays at 1 for the first ~65 % of the
 *    steps and then drops linearly to 0 (`min(1, 2.86 - 2.86 * progress)`), after
 *    which the element is recycled.
 *  - the "dynamic" animation type uses a time-based tween (ease-in-out quad) in
 *    pixels and, for horizontal moves, a short rotational wobble afterwards.
 */
import type { AnimationType, Square } from './types';
import { ANIMATION_DURATION } from './options';
import { fileOf, squareOffset } from './squares';
import { Animator as KeyframeAnimator, type TweenParams } from './fx/tween';
import { inOutQuad, inQuad } from './fx/easing';

export interface SlideAnimation {
  type: 'slide';
  el: HTMLElement;
  from: Square;
  to: Square;
}

export interface FadeOutAnimation {
  type: 'fade-out';
  el: HTMLElement;
  /** Runs once the fade has finished (the board recycles the element here). */
  callback?: () => void;
}

export type PieceAnimation = SlideAnimation | FadeOutAnimation;

export interface AnimationContext {
  animationType: AnimationType;
  flipped: boolean;
  /** Board element, needed for pixel-based tweens. */
  boardEl: HTMLElement;
}

export interface Animator {
  add(anims: PieceAnimation[], ctx: AnimationContext): void;
  /** Jump every pending animation to its final state. */
  flush(): void;
  /** Start playing what was added. */
  run(): void;
  destroy(): void;
}

export interface AnimatorHooks {
  setAnimating(on: boolean): void;
  isAnimating(): boolean;
}

export const durationFor = (type: AnimationType): number => ANIMATION_DURATION[type] ?? ANIMATION_DURATION.default;

const FRAME_MS = 16;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

interface Frame {
  el: HTMLElement;
  style: Partial<Pick<CSSStyleDeclaration, 'transform' | 'zIndex' | 'opacity'>>;
  callback?: () => void;
}

/** Default engine: requestAnimationFrame-stepped inline transforms. */
export class SteppedAnimator implements Animator {
  private queue: Frame[][] = [];
  private last = false;
  private raf = 0;

  constructor(private hooks: AnimatorHooks) {}

  add(anims: PieceAnimation[], ctx: AnimationContext): void {
    const steps = Math.max(Math.floor(durationFor(ctx.animationType) / FRAME_MS), 1);
    for (const anim of anims) {
      const frames = anim.type === 'slide' ? this.slideFrames(anim, ctx.flipped, steps) : this.fadeFrames(anim, steps);
      if (frames.length > this.queue.length) {
        const pad: Frame[][] = Array.from({ length: frames.length - this.queue.length }, () => []);
        this.queue.unshift(...pad);
      }
      frames.forEach((frame, i) => {
        const fromEnd = frames.length - i;
        this.queue[this.queue.length - fromEnd].push(frame);
      });
    }
  }

  private slideFrames(a: SlideAnimation, flipped: boolean, steps: number): Frame[] {
    const o = squareOffset(a.from, flipped);
    const s = squareOffset(a.to, flipped);
    const dx = (s.x - o.x) / steps;
    const dy = (s.y - o.y) / steps;
    return Array.from({ length: steps }, (_, i) => {
      const last = i === steps - 1;
      const x = round3(o.x + dx * (i + 1));
      const y = round3(o.y + dy * (i + 1));
      return {
        el: a.el,
        style: { transform: last ? '' : `translate(${x}%, ${y}%)`, zIndex: last ? '' : '10' },
      };
    });
  }

  private fadeFrames(a: FadeOutAnimation, steps: number): Frame[] {
    return Array.from({ length: steps }, (_, i) => {
      const o = Math.min(1, 2.86 - 2.86 * ((i + 1) / steps));
      return {
        el: a.el,
        style: { opacity: String(o) },
        callback: i === steps - 1 ? a.callback : undefined,
      };
    });
  }

  flush(): void {
    if (this.queue.length === 0) {
      this.last = true;
      return;
    }
    // keep only the final frame group so everything lands in its end state
    this.queue.splice(0, this.queue.length - 1);
    this.run();
  }

  run(): void {
    this.last = this.queue.length < 2;
    const frames = this.queue.shift();
    if (frames) {
      if (!this.hooks.isAnimating()) this.hooks.setAnimating(true);
      for (const f of frames) {
        Object.assign(f.el.style, f.style);
        f.callback?.();
      }
      if (this.queue.length === 0) this.hooks.setAnimating(false);
      if (!this.last) this.raf = requestAnimationFrame(() => this.run());
    }
  }

  destroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.queue.length = 0;
    this.last = false;
    this.hooks.setAnimating(false);
  }
}

// ── tween engine ("dynamic") ──────────────────────────────────────────────

/** Pixel-based keyframe tweens: eased slide, a rotational wobble and a delayed fade. */
export class TweenAnimator implements Animator {
  private animator = new KeyframeAnimator();
  private pending: TweenParams[] = [];

  constructor(private hooks: AnimatorHooks) {}

  add(anims: PieceAnimation[], ctx: AnimationContext): void {
    const duration = durationFor(ctx.animationType);
    const boardWidth = ctx.boardEl.getBoundingClientRect().width || 800;
    const size = boardWidth / 8;
    for (const a of anims) {
      if (a.type === 'fade-out') {
        this.pending.push({
          delay: duration * 0.75,
          duration: duration * 0.25,
          keyframes: { 0: { opacity: 1 }, 100: { opacity: 0 } },
          onUpdate: (t) => {
            a.el.style.opacity = String(t.animatedProps.opacity);
          },
          onEnd: () => a.callback?.(),
          immediateFirstFrame: true,
        });
        continue;
      }
      const o = squareOffset(a.from, ctx.flipped);
      const s = squareOffset(a.to, ctx.flipped);
      const dFile = fileOf(a.to) - fileOf(a.from);
      this.pending.push({
        duration,
        easing: inOutQuad,
        keyframes: {
          0: { x: (o.x / 100) * size, y: (o.y / 100) * size },
          100: { x: (s.x / 100) * size, y: (s.y / 100) * size },
        },
        onUpdate: (t) => {
          const { x, y } = t.animatedProps;
          a.el.style.transform = replaceFn(a.el.style.transform, 'translate', `translate(${x}px, ${y}px)`);
          a.el.style.zIndex = '10';
        },
        onEnd: () => {
          // with a wobble the transform is cleared when the wobble ends
          if (dFile === 0) {
            a.el.style.transform = '';
            a.el.style.zIndex = '';
          }
        },
        immediateFirstFrame: true,
      });
      if (dFile !== 0) {
        // rotate towards the direction of travel, overshoot back, settle
        const alpha = (Math.abs(dFile) - 1) / 6;
        const peak = Math.sign(dFile) * (5 + (20 - 5) * alpha);
        this.pending.push({
          duration: duration * 1.5,
          easing: inQuad,
          keyframes: { 0: { angle: 0 }, 60: { angle: peak }, 80: { angle: peak * -0.5 }, 100: { angle: 0 } },
          onUpdate: (t) => {
            a.el.style.transform = replaceFn(a.el.style.transform, 'rotate', `rotate(${t.animatedProps.angle}deg)`);
          },
          onEnd: () => {
            a.el.style.transform = '';
            a.el.style.zIndex = '';
          },
          immediateFirstFrame: true,
        });
      }
    }
  }

  run(): void {
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    this.hooks.setAnimating(true);
    for (const params of batch) {
      const done = params.onEnd;
      this.animator.play({
        ...params,
        onEnd: (t) => {
          done?.(t);
          if (this.animator.playingCount() === 0) this.hooks.setAnimating(false);
        },
      });
    }
  }

  flush(): void {
    // anything not yet started is still finished in its end state
    const batch = this.pending;
    this.pending = [];
    for (const params of batch) {
      const t = this.animator.play({ ...params, duration: params.duration });
      this.animator.end(t);
    }
    this.animator.endAll();
    this.hooks.setAnimating(false);
  }

  destroy(): void {
    this.flush();
  }
}

/** Replace (or append) one CSS function, e.g. the `rotate(…)` part of a transform string. */
function replaceFn(transform: string, fn: 'translate' | 'rotate', value: string): string {
  if (!transform || transform === 'none') return value;
  const re = new RegExp(`${fn}\\(\\s*[^)]+\\)`);
  return re.test(transform) ? transform.replace(re, value) : `${transform} ${value}`.trim();
}
