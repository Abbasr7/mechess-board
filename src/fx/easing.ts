/** Easing functions used by the original's animations (all map 0..1 to 0..1). */
export type Easing = (t: number) => number;

export const linear: Easing = (t) => t;
export const inQuad: Easing = (t) => t * t;
export const outQuad: Easing = (t) => t * (2 - t);
export const inOutQuad: Easing = (t) => ((t *= 2) < 1 ? 0.5 * t * t : -0.5 * (--t * (t - 2) - 1));
export const outCubic: Easing = (t) => --t * t * t + 1;
export const inOutCubic: Easing = (t) => ((t *= 2) < 1 ? 0.5 * t * t * t : 0.5 * ((t -= 2) * t * t + 2));
export const inOutQuart: Easing = (t) => ((t *= 2) < 1 ? 0.5 * t * t * t * t : -0.5 * ((t -= 2) * t * t * t - 2));
export const outCirc: Easing = (t) => Math.sqrt(1 - --t * t);
export const outSine: Easing = (t) => Math.sin((t * Math.PI) / 2);
export const outElastic: Easing = (t) => (t === 0 ? 0 : t === 1 ? 1 : 2 ** (-10 * t) * Math.sin((t - 0.1) * 5 * Math.PI) + 1);
export const outBack: Easing = (t) => --t * t * (2.70158 * t + 1.70158) + 1;

export const clamp = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max);

/** Linear interpolation; `alpha` is clamped to 0..1 unless `restrict` is false. */
export const lerp = (from: number, to: number, alpha: number, restrict = true): number => {
  const a = restrict ? clamp(alpha, 0, 1) : alpha;
  return from * (1 - a) + to * a;
};
