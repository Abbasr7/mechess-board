/**
 * Shared building blocks for the "natural" and "arcade" piece styles.
 *
 * In the original these are the two WebGL animation types. Here the same
 * motion (timings, keyframes, easing, shadows, trails, ripples) is reproduced
 * with DOM elements: every moving piece is wrapped in an {@link FxPiece} whose
 * numeric properties are tweened and written to `transform` / `opacity` /
 * `filter`; trails, ripples and flashes are small absolutely positioned
 * elements in the board's effect layers.
 */
import type { Color, Square } from '../types';
import type { LayerName } from '../view/layers';
import type { Animator, Tween } from './tween';

/** Position of a piece's top-left corner in "percent of a square" units (100 = one square). */
export interface Pos {
  x: number;
  y: number;
}

export interface FxHost {
  animator: Animator;
  boardEl: HTMLElement;
  doc: Document;
  /** Rendered size of one square in CSS pixels. */
  squareSize(): number;
  flipped(): boolean;
  addToLayer(el: HTMLElement, layer: LayerName): void;
  /** Top-left offset of a square in percent units. */
  offsetOf(square: Square): Pos;
}

export interface Shadow {
  /** Blur in pixi-style units (multiplied by the square size to get pixels). */
  blur: number;
  /** Distance in pixels. */
  distance: number;
  opacity: number;
}

/** A piece element plus the numeric state the tweens write to. */
export class FxPiece {
  x = 0;
  y = 0;
  scale = 1;
  angle = 0;
  alpha = 1;
  shadow: Shadow | null = null;
  /** Colour of the piece, for accent colours. */
  constructor(readonly el: HTMLElement, readonly color: Color, private host: FxHost) {}

  /** Write the state to the element. */
  apply(): void {
    const s = this.el.style;
    s.transform = `translate(${this.x}%, ${this.y}%) rotate(${this.angle}deg) scale(${this.scale})`;
    s.opacity = this.alpha === 1 ? '' : String(this.alpha);
    if (this.shadow && this.shadow.opacity > 0) {
      const sq = this.host.squareSize();
      // pixi's drop-shadow filter points 45° down-right
      const d = this.shadow.distance * Math.SQRT1_2;
      s.filter = `drop-shadow(${d}px ${d}px ${Math.max(this.shadow.blur * sq * 0.06, 0)}px rgba(0,0,0,${this.shadow.opacity}))`;
    } else s.filter = '';
  }

  /** Remove every inline style set by the effects; the CSS square class takes over again. */
  reset(): void {
    const s = this.el.style;
    s.transform = '';
    s.opacity = '';
    s.filter = '';
    s.zIndex = '';
    this.scale = 1;
    this.angle = 0;
    this.alpha = 1;
    this.shadow = null;
  }

  /** Lift the piece above its neighbours while it animates. */
  elevate(): void {
    this.el.style.zIndex = '10';
  }

  /** Copy tweened numbers onto the piece and re-apply it. Unknown names are ignored. */
  setProps(p: Record<string, number>): void {
    if ('x' in p) this.x = p.x;
    if ('y' in p) this.y = p.y;
    if ('scale' in p) this.scale = p.scale;
    if ('angle' in p) this.angle = p.angle;
    if ('alpha' in p) this.alpha = p.alpha;
    if ('shadowBlur' in p || 'shadowDistance' in p || 'shadowOpacity' in p) {
      const sh = (this.shadow ??= { blur: 0, distance: 0, opacity: 0 });
      if ('shadowBlur' in p) sh.blur = p.shadowBlur;
      if ('shadowDistance' in p) sh.distance = p.shadowDistance;
      if ('shadowOpacity' in p) sh.opacity = p.shadowOpacity;
    }
    this.apply();
  }
}

export interface MoveFx {
  from: Pos;
  to: Pos;
  castling: boolean;
  capturing: boolean;
}

export interface KingAttackFx {
  /** The checked king, or `null` when only the square should flash. */
  piece: FxPiece | null;
  square: Square;
  /** An illegal move was attempted while in check: no scale pulse on the piece. */
  illegal: boolean;
  checkmate: boolean;
}

export interface HintHandle {
  el: HTMLElement;
  kind: 'move' | 'capture';
  /** The kept-alive hover tween; ended before the hover-out starts. */
  over?: Tween;
}

/** A piece animation style. */
export interface PieceStyleFx {
  readonly name: 'natural' | 'arcade';
  /** Duration of a normal piece move in ms. */
  readonly moveDuration: number;
  /** Duration of the drop animation in ms. */
  readonly dropDuration: number;
  dragStart(p: FxPiece): Tween;
  /** Animate a released piece from its current position to `to`. */
  drop(p: FxPiece, to: Pos, color: Color): Tween;
  move(p: FxPiece, m: MoveFx): Tween;
  capture(p: FxPiece, fromDrop: boolean): Tween;
  restore(p: FxPiece): Tween;
  pieceOver?(p: FxPiece, square: Square): { tween: Tween; el: HTMLElement };
  pieceOut?(square: Square, outline: HTMLElement | null): Tween;
  attackKing(a: KingAttackFx): Tween;
  showHint?(h: HintHandle): Tween;
  hideHint?(h: HintHandle): Tween;
  hintOver?(h: HintHandle): Tween;
  hintOut?(h: HintHandle): Tween;
  showHighlight?(el: HTMLElement, opacity: number): Tween;
  hideHighlight?(el: HTMLElement): Tween;
  showPromotion?(el: HTMLElement): Tween;
  hidePromotion?(el: HTMLElement): Tween;
  /** Accent colour for a side (arcade). */
  accent?(color: Color): string;
}

// ── DOM helpers ─────────────────────────────────────────────────────────────

/**
 * Scale an element that sits on its square through a `square-FR` class. The
 * class transform already holds the translation, so the scale goes through the
 * `--s` hook (see the base stylesheet) rather than an inline `transform`.
 */
export function setScale(el: HTMLElement, scale: number | null): void {
  if (scale === null) el.style.removeProperty('--s');
  else el.style.setProperty('--s', String(scale));
}

export const currentScale = (el: HTMLElement): number => Number(el.style.getPropertyValue('--s') || 1);

/** A div positioned on a square via its class (so it follows flipping). */
export function squareDiv(host: FxHost, square: Square, cls: string): HTMLElement {
  const el = host.doc.createElement('div');
  el.className = cls;
  el.classList.add(squareClassOf(square));
  return el;
}

const squareClassOf = (sq: Square): string => `square-${sq.charCodeAt(0) - 96}${sq[1]}`;

/** Convert pixel-ish pixi geometry helpers. */
export const px = (v: number): string => `${v}px`;

/**
 * Trail between two points given in percent-of-square units. Returns the
 * element and an `update` function.
 */
export function createTrail(
  host: FxHost,
  opts: { widthRatio: number; css: (width: number) => string },
): {
  el: HTMLElement;
  update(start: Pos, end: Pos, opacity: number): void;
  remove(): void;
} {
  const el = host.doc.createElement('div');
  el.className = 'fx-trail';
  el.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;transform-origin:0 50%;will-change:transform,opacity;';
  host.addToLayer(el, 'vfx-below');
  return {
    el,
    update(start, end, opacity) {
      const sq = host.squareSize();
      // percent units → px, then to the square *centres*
      const k = sq / 100;
      const sx = (start.x + 50) * k;
      const sy = (start.y + 50) * k;
      const ex = (end.x + 50) * k;
      const ey = (end.y + 50) * k;
      const dx = ex - sx;
      const dy = ey - sy;
      const len = Math.hypot(dx, dy);
      const width = sq * opts.widthRatio;
      const r = (v: number): number => Math.round(v * 100) / 100;
      el.style.width = px(r(len));
      el.style.height = px(r(width));
      el.style.background = opts.css(width);
      el.style.opacity = String(opacity);
      el.style.transform = `translate(${r(sx)}px, ${r(sy - width / 2)}px) rotate(${Math.atan2(dy, dx)}rad)`;
    },
    remove() {
      el.remove();
    },
  };
}

/** Expanding dark circle clipped to a square (the "natural" drop ripple). */
export function createRipple(host: FxHost, square: Square, rgba: string): { circle: HTMLElement; mask: HTMLElement; remove(): void } {
  const mask = squareDiv(host, square, 'fx-ripple');
  mask.style.cssText += 'position:absolute;left:0;top:0;width:12.5%;height:12.5%;overflow:hidden;pointer-events:none;';
  const circle = host.doc.createElement('div');
  circle.style.cssText = `position:absolute;left:-50%;top:-50%;width:200%;height:200%;border-radius:50%;background:${rgba};transform:scale(0.2);will-change:transform,opacity;`;
  mask.appendChild(circle);
  host.addToLayer(mask, 'vfx-below');
  return { circle, mask, remove: () => mask.remove() };
}

/** Make sure a tween that has nothing to animate still completes asynchronously. */
export const noop = (host: FxHost, duration = 1): Tween => host.animator.play({ duration });
