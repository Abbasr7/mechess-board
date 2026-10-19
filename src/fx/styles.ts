/**
 * "natural" and "arcade" piece animation styles.
 *
 * Constants and keyframes come from the original's two WebGL animation types;
 * graphics that were bitmaps/sprite sheets there (trail textures, grab/release
 * bursts, hint sprites) are replaced by simple CSS shapes of the same size and
 * timing.
 */
import type { Color, Square } from '../types';
import { clamp, inOutQuad, lerp, outCirc, outCubic, outElastic, outQuad, outSine } from './easing';
import {
  createRipple,
  createTrail,
  currentScale,
  noop,
  setScale,
  squareDiv,
  type FxHost,
  type FxPiece,
  type HintHandle,
  type KingAttackFx,
  type MoveFx,
  type PieceStyleFx,
  type Pos,
} from './piece-fx';
import type { Tween } from './tween';

interface DragShadow {
  scale: number;
  blur: number;
  opacity: number;
  sizeRatio: number;
}

abstract class BaseFx implements PieceStyleFx {
  abstract readonly name: 'natural' | 'arcade';
  abstract readonly moveDuration: number;
  abstract readonly dropDuration: number;
  protected readonly captureDuration = 150;
  protected readonly captureDelayRatio = 0.3;
  protected readonly rookArcRatio = 0.5;

  constructor(protected host: FxHost) {}

  abstract dragStart(p: FxPiece): Tween;
  abstract drop(p: FxPiece, to: Pos, color: Color): Tween;
  abstract move(p: FxPiece, m: MoveFx): Tween;
  abstract attackKing(a: KingAttackFx): Tween;

  protected get sq(): number {
    return this.host.squareSize();
  }

  capture(p: FxPiece, fromDrop: boolean): Tween {
    const delay = this.captureDelayRatio * (fromDrop ? this.dropDuration : this.moveDuration);
    return this.host.animator.play({
      delay,
      duration: this.captureDuration,
      keyframes: { 0: { alpha: p.alpha, scale: p.scale }, 100: { alpha: 0, scale: 0 } },
      onUpdate: (t) => p.setProps(t.animatedProps),
    });
  }

  restore(p: FxPiece): Tween {
    p.alpha = 0;
    p.scale = 0;
    p.apply();
    return this.host.animator.play({
      duration: 150,
      keyframes: { 0: { alpha: 0, scale: 0 }, 100: { alpha: 1, scale: 1 } },
      onUpdate: (t) => p.setProps(t.animatedProps),
      onEnd: () => p.reset(),
    });
  }

  /** Keyframes shared by the normal piece move of both styles. */
  protected moveKeyframes(p: FxPiece, m: MoveFx, scaleAt30: number, withShadow: Shadow | null) {
    const kf: Record<number, Record<string, number>> = {
      0: { x: m.from.x, y: m.from.y, scale: 1, trailEndX: m.from.x, trailEndY: m.from.y, trailOpacity: 1 },
      30: { scale: scaleAt30, trailEndX: m.from.x, trailEndY: m.from.y },
      60: { x: m.to.x, y: m.to.y, scale: 1, trailOpacity: 1 },
      100: { x: m.to.x, y: m.to.y, trailEndX: m.to.x, trailEndY: m.to.y, trailOpacity: 0 },
    };
    if (withShadow) {
      kf[0].shadowBlur = 0;
      kf[0].shadowDistance = 0;
      kf[0].shadowOpacity = 0;
      kf[30].shadowBlur = withShadow.blur;
      kf[30].shadowDistance = withShadow.distance;
      kf[30].shadowOpacity = withShadow.opacity;
      kf[60].shadowBlur = 0;
      kf[60].shadowDistance = 0;
      kf[60].shadowOpacity = 0;
      kf[100].shadowBlur = 0;
      kf[100].shadowDistance = 0;
      kf[100].shadowOpacity = 0;
    }
    // rook (castling): hop over the arc half a square up (or down when on the top row)
    if (m.castling && p.el.className.includes('r')) {
      const up = m.from.y > 100;
      kf[30].y = m.from.y + this.rookArcRatio * 100 * (up ? -1 : 1);
    }
    return kf;
  }

  protected runMove(p: FxPiece, m: MoveFx, opts: { trailWidth: number; trailCss: (w: number) => string; scaleAt30: number; shadow: Shadow | null; startOffsetRatio: number; arcEasing: boolean }): Tween {
    p.angle = 0;
    p.elevate();
    const trail = createTrail(this.host, { widthRatio: opts.trailWidth, css: opts.trailCss });
    const vertical = m.from.x === m.to.x;
    // moving straight down the screen starts the trail a little lower so it emerges from behind the piece
    const startOffset = vertical ? 100 * opts.startOffsetRatio : 0;
    const kf = this.moveKeyframes(p, m, opts.scaleAt30, opts.shadow);
    const isRook = m.castling && /\br$/.test(p.el.className.replace(/\b[wb]r\b/, 'r'));
    return this.host.animator.play({
      duration: this.moveDuration,
      easing: isRook && opts.arcEasing ? inOutQuad : undefined,
      keyframes: kf,
      onUpdate: (t) => {
        const a = t.animatedProps;
        p.setProps(a);
        trail.update({ x: a.x, y: a.y + startOffset }, { x: a.trailEndX, y: a.trailEndY + startOffset }, a.trailOpacity);
      },
      onEnd: () => {
        trail.remove();
        p.reset();
      },
    });
  }

  // ── hover / hint / highlight defaults (overridden where the styles differ) ─

  showHighlight(el: HTMLElement, opacity: number): Tween {
    el.style.opacity = '0';
    return this.host.animator.play({
      duration: 150,
      easing: outQuad,
      keyframes: { 0: { alpha: 0 }, 100: { alpha: opacity } },
      onUpdate: (t) => {
        el.style.opacity = String(t.animatedProps.alpha);
      },
    });
  }

  hideHighlight(el: HTMLElement): Tween {
    const start = Number(el.style.opacity || 1);
    return this.host.animator.play({
      duration: 150,
      easing: outQuad,
      keyframes: { 0: { alpha: start }, 100: { alpha: 0 } },
      onUpdate: (t) => {
        el.style.opacity = String(t.animatedProps.alpha);
      },
    });
  }

  showPromotion(el: HTMLElement): Tween {
    return this.host.animator.play({
      duration: 150,
      keyframes: { 0: { alpha: 0 }, 100: { alpha: 1 } },
      onUpdate: (t) => {
        el.style.opacity = String(t.animatedProps.alpha);
      },
      onEnd: () => {
        el.style.opacity = '';
      },
    });
  }

  hidePromotion(el: HTMLElement): Tween {
    return this.host.animator.play({
      duration: 150,
      keyframes: { 0: { alpha: 1 }, 100: { alpha: 0 } },
      onUpdate: (t) => {
        el.style.opacity = String(t.animatedProps.alpha);
      },
    });
  }
}

interface Shadow {
  blur: number;
  distance: number;
  opacity: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Natural
// ═══════════════════════════════════════════════════════════════════════════

export class NaturalFx extends BaseFx {
  readonly name = 'natural' as const;
  readonly moveDuration = 300;
  readonly dropDuration = 20;
  private readonly drag: DragShadow = { scale: 1.1, blur: 0.8, opacity: 0.3, sizeRatio: 0.08 };
  private readonly dragStrength = 100;
  private readonly maxRotation = 10;
  private readonly rotationSpeed = 20;
  private readonly rippleDuration = 1000;
  private readonly rippleColor = 'rgba(0,0,0,0.125)';

  private shadow(): Shadow {
    return { blur: this.drag.blur, distance: this.sq * this.drag.sizeRatio, opacity: this.drag.opacity };
  }

  /** Lift: 1.1× larger with a soft shadow, tilting with horizontal speed until the piece is dropped. */
  dragStart(p: FxPiece): Tween {
    p.elevate();
    p.scale = this.drag.scale;
    p.shadow = this.shadow();
    p.apply();
    let lastX = p.x;
    return this.host.animator.play({
      onUpdate: (t) => {
        const dt = t.frameInfo.deltaTime;
        const dxPx = ((p.x - lastX) * this.sq) / 100;
        const target = clamp(this.dragStrength * dxPx * dt, -this.maxRotation, this.maxRotation);
        p.angle = lerp(p.angle, target, this.rotationSpeed * dt);
        lastX = p.x;
        p.apply();
      },
      onEnd: () => {
        p.scale = 1;
        p.shadow = null;
        p.apply();
      },
    });
  }

  drop(p: FxPiece, to: Pos): Tween {
    p.elevate();
    p.angle = 0;
    const sh = this.shadow();
    p.scale = this.drag.scale;
    p.shadow = { ...sh };
    return this.host.animator.play({
      duration: this.dropDuration,
      keyframes: {
        0: { x: p.x, y: p.y, scale: this.drag.scale, shadowBlur: sh.blur, shadowDistance: sh.distance, shadowOpacity: sh.opacity },
        100: { x: to.x, y: to.y, scale: 1, shadowBlur: 0, shadowDistance: 0, shadowOpacity: 0 },
      },
      onUpdate: (t) => p.setProps(t.animatedProps),
      onEnd: (t) => {
        p.reset();
        if (t.forcedEnd) return;
        this.ripple(p.el);
      },
    });
  }

  /** Expanding dark circle clipped to the square the piece landed on. */
  private ripple(el: HTMLElement): void {
    const sqCls = [...el.classList].find((c) => /^square-\d\d$/.test(c));
    if (!sqCls) return;
    const square = 'abcdefgh'[Number(sqCls[7]) - 1] + sqCls[8];
    const r = createRipple(this.host, square, this.rippleColor);
    this.host.animator.play({
      duration: this.rippleDuration,
      easing: outCirc,
      keyframes: { 0: { scale: 0.2, opacity: 1 }, 100: { scale: 1, opacity: 0 } },
      onUpdate: (t) => {
        r.circle.style.transform = `scale(${t.animatedProps.scale})`;
        r.circle.style.opacity = String(t.animatedProps.opacity);
      },
      onEnd: () => r.remove(),
    });
  }

  move(p: FxPiece, m: MoveFx): Tween {
    const shadow = this.shadow();
    return this.runMove(p, m, {
      trailWidth: 0.8,
      trailCss: () => 'linear-gradient(to right, rgba(0,0,0,0), rgba(0,0,0,0.10) 55%, rgba(0,0,0,0.22))',
      scaleAt30: this.drag.scale,
      shadow,
      startOffsetRatio: 0.35,
      arcEasing: true,
    });
  }

  attackKing(a: KingAttackFx): Tween {
    const host = this.host;
    const flash = squareDiv(host, a.square, 'fx-check-square');
    flash.style.cssText += 'position:absolute;left:0;top:0;width:12.5%;height:12.5%;background:#ff0000;opacity:0;pointer-events:none;';
    host.addToLayer(flash, 'vfx-below');
    const dur = a.checkmate ? 800 : 600;
    const flashTween = host.animator.play({
      duration: dur,
      easing: a.checkmate ? undefined : outSine,
      keyframes: a.checkmate ? { 0: { alpha: 0 }, 50: { alpha: 0.75 }, 100: { alpha: 0.75 } } : { 0: { alpha: 0 }, 10: { alpha: 0.75 }, 100: { alpha: 0 } },
      onUpdate: (t) => {
        flash.style.opacity = String(t.animatedProps.alpha);
      },
    });
    return host.animator.play({
      duration: dur,
      easing: a.checkmate ? outElastic : outSine,
      keepAlive: a.checkmate,
      keyframes: { 0: { scale: 1 }, 10: { scale: 1.1 }, 100: { scale: 1 } },
      onUpdate: (t) => {
        if (a.piece && !a.illegal && !t.keptAlive) a.piece.setProps({ scale: t.animatedProps.scale });
      },
      onEnd: () => {
        host.animator.end(flashTween);
        flash.remove();
        a.piece?.reset();
      },
    });
  }

  pieceOver(_p: FxPiece, square: Square): { tween: Tween; el: HTMLElement } {
    const el = squareDiv(this.host, square, 'fx-piece-over');
    const w = Math.max(this.sq * 0.06, 1);
    el.style.cssText += `position:absolute;left:0;top:0;width:12.5%;height:12.5%;box-sizing:border-box;border:${w}px solid #fff;opacity:0;pointer-events:none;`;
    this.host.addToLayer(el, 'vfx-below');
    const tween = this.host.animator.play({
      duration: 50,
      keepAlive: true,
      easing: outCubic,
      keyframes: { 0: { alpha: 0 }, 100: { alpha: 1 } },
      onUpdate: (tw) => {
        el.style.opacity = String(tw.animatedProps.alpha);
      },
    });
    return { tween, el };
  }

  pieceOut(_square: Square, outline: HTMLElement | null): Tween {
    if (!outline) return noop(this.host);
    return this.host.animator.play({
      duration: 50,
      easing: outCubic,
      keyframes: { 0: { alpha: Number(outline.style.opacity || 1) }, 100: { alpha: 0 } },
      onUpdate: (t) => {
        outline.style.opacity = String(t.animatedProps.alpha);
      },
      onEnd: () => outline.remove(),
    });
  }

  showHint(h: HintHandle): Tween {
    const from = h.kind === 'capture' ? 0.4 : 0;
    setScale(h.el, from);
    return this.host.animator.play({
      duration: 80,
      easing: outQuad,
      keyframes: { 0: { scale: from }, 100: { scale: 1 } },
      onUpdate: (t) => {
        setScale(h.el, t.animatedProps.scale);
      },
      onEnd: () => {
        setScale(h.el, null);
      },
    });
  }

  hideHint(h: HintHandle): Tween {
    return this.host.animator.play({
      duration: 80,
      easing: outQuad,
      keyframes: { 0: { scale: 1 }, 100: { scale: 0 } },
      onUpdate: (t) => {
        setScale(h.el, t.animatedProps.scale);
      },
      onEnd: () => h.el.remove(),
    });
  }

  hintOver(h: HintHandle): Tween {
    // quiet dot grows to 1.5×; the capture ring thickens (hole shrinks from 0.41 to 0.1 of the square)
    h.over = this.host.animator.play({
      duration: 100,
      easing: outCirc,
      keepAlive: true,
      keyframes: h.kind === 'move' ? { 0: { scale: 1 }, 100: { scale: 1.5 } } : { 0: { scale: 1 }, 100: { scale: 1.12 } },
      onUpdate: (t) => {
        setScale(h.el, t.animatedProps.scale);
      },
    });
    return h.over;
  }

  hintOut(h: HintHandle): Tween {
    const cur = currentScale(h.el);
    if (h.over) this.host.animator.end(h.over);
    h.over = undefined;
    return this.host.animator.play({
      duration: 100,
      easing: outCirc,
      keyframes: { 0: { scale: cur }, 100: { scale: 1 } },
      onUpdate: (t) => {
        setScale(h.el, t.animatedProps.scale);
      },
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Arcade
// ═══════════════════════════════════════════════════════════════════════════

export class ArcadeFx extends BaseFx {
  readonly name = 'arcade' as const;
  readonly moveDuration = 400;
  readonly dropDuration = 40;
  private readonly drag = { blur: 0.8, opacity: 0.4, sizeRatio: 0.08, pulseScale: 1.1, pulseDuration: 500 };

  accent(color: Color): string {
    return color === 'w' ? '#38DCFF' : '#FF5252';
  }

  private shadow(): Shadow {
    return { blur: this.drag.blur, distance: this.sq * this.drag.sizeRatio, opacity: this.drag.opacity };
  }

  /** A ring that expands from a piece and fades (stands in for the original's sprite-sheet bursts). */
  private burst(at: Pos, color: string, opts: { from: number; to: number; duration: number; layer?: 'vfx-below' | 'vfx-above'; size?: number }): Tween {
    const host = this.host;
    const el = host.doc.createElement('div');
    const size = opts.size ?? 1.75;
    el.style.cssText = `position:absolute;left:0;top:0;width:${size * 12.5}%;height:${size * 12.5}%;border-radius:50%;box-sizing:border-box;border:${Math.max(this.sq * 0.05, 2)}px solid ${color};pointer-events:none;opacity:0;`;
    host.addToLayer(el, opts.layer ?? 'vfx-below');
    const place = (scale: number, alpha: number): void => {
      // centre the (size × size) ring on the piece centre; at is top-left in percent-of-square
      const off = ((size - 1) / 2) * 100;
      el.style.transform = `translate(${((at.x - off) / size)}%, ${((at.y - off) / size)}%) scale(${scale})`;
      el.style.opacity = String(alpha);
    };
    place(opts.from, 1);
    return host.animator.play({
      duration: opts.duration,
      easing: outQuad,
      keyframes: { 0: { scale: opts.from, alpha: 1 }, 100: { scale: opts.to, alpha: 0 } },
      onUpdate: (t) => place(t.animatedProps.scale, t.animatedProps.alpha),
      onEnd: () => el.remove(),
    });
  }

  /** Lift: shadow, a one-off ring "grab" burst and a pulsing size until released. */
  dragStart(p: FxPiece): Tween {
    p.elevate();
    p.shadow = this.shadow();
    p.apply();
    const color = this.accent(p.color);
    this.burst({ x: p.x, y: p.y }, color, { from: 0.5, to: 1, duration: 300 });
    const base = p.scale;
    return this.host.animator.play({
      duration: this.drag.pulseDuration,
      easing: inOutQuad,
      repeat: Infinity,
      keyframes: { 0: { scale: base }, 50: { scale: base * this.drag.pulseScale }, 100: { scale: base } },
      onUpdate: (t) => p.setProps({ scale: t.animatedProps.scale }),
      onEnd: () => {
        p.scale = 1;
        p.shadow = null;
        p.apply();
      },
    });
  }

  drop(p: FxPiece, to: Pos, color: Color): Tween {
    p.elevate();
    p.angle = 0;
    const sh = this.shadow();
    const accent = this.accent(color);
    p.shadow = { ...sh };
    // contracting "release" ring where the piece was let go
    this.burst({ x: p.x, y: p.y }, accent, { from: 1, to: 0.4, duration: this.dropDuration + 120 });
    return this.host.animator.play({
      duration: this.dropDuration,
      keyframes: {
        0: { x: p.x, y: p.y, scale: p.scale, shadowBlur: sh.blur, shadowDistance: sh.distance, shadowOpacity: sh.opacity },
        100: { x: to.x, y: to.y, scale: 1, shadowBlur: sh.blur, shadowDistance: 0, shadowOpacity: sh.opacity },
      },
      onUpdate: (t) => p.setProps(t.animatedProps),
      onEnd: (t) => {
        p.reset();
        if (t.forcedEnd) return;
        this.squareFill(p.el, accent);
      },
    });
  }

  /** Accent-coloured flash on the landing square. */
  private squareFill(el: HTMLElement, color: string): void {
    const sqCls = [...el.classList].find((c) => /^square-\d\d$/.test(c));
    if (!sqCls) return;
    const square = 'abcdefgh'[Number(sqCls[7]) - 1] + sqCls[8];
    const fill = squareDiv(this.host, square, 'fx-square-fill');
    fill.style.cssText += `position:absolute;left:0;top:0;width:12.5%;height:12.5%;background:${color};opacity:0;pointer-events:none;`;
    this.host.addToLayer(fill, 'vfx-below');
    this.host.animator.play({
      duration: 400,
      easing: outQuad,
      keyframes: { 0: { alpha: 0.55 }, 100: { alpha: 0 } },
      onUpdate: (t) => {
        fill.style.opacity = String(t.animatedProps.alpha);
      },
      onEnd: () => fill.remove(),
    });
  }

  move(p: FxPiece, m: MoveFx): Tween {
    const color = this.accent(p.color);
    return this.runMove(p, m, {
      trailWidth: 0.55,
      trailCss: () => `linear-gradient(to right, ${withAlpha(color, 0)}, ${withAlpha(color, 0.32)} 60%, ${withAlpha(color, 0.75)})`,
      scaleAt30: 1.1,
      shadow: null,
      startOffsetRatio: 0.35,
      arcEasing: true,
    });
  }

  override capture(p: FxPiece, fromDrop: boolean): Tween {
    const delay = this.captureDelayRatio * (fromDrop ? this.dropDuration : this.moveDuration);
    const at = { x: p.x, y: p.y };
    const color = this.accent(p.color === 'w' ? 'b' : 'w');
    return this.host.animator.play({
      delay,
      duration: this.captureDuration,
      keyframes: { 0: { alpha: p.alpha, scale: p.scale }, 100: { alpha: 0, scale: 0 } },
      onStart: () => {
        this.burst(this.pieceHome(p, at), color, { from: 0.4, to: 1.2, duration: 220, size: 1 });
      },
      onUpdate: (t) => p.setProps(t.animatedProps),
    });
  }

  /** Where a captured piece sits (its inline position may be empty). */
  private pieceHome(p: FxPiece, fallback: Pos): Pos {
    const sqCls = [...p.el.classList].find((c) => /^square-\d\d$/.test(c));
    if (!sqCls) return fallback;
    return this.host.offsetOf('abcdefgh'[Number(sqCls[7]) - 1] + sqCls[8]);
  }

  attackKing(a: KingAttackFx): Tween {
    const host = this.host;
    const ring = host.doc.createElement('div');
    const sqCls = `square-${a.square.charCodeAt(0) - 96}${a.square[1]}`;
    const w = Math.max(this.sq * 0.06, 2);
    ring.className = `fx-king-check ${sqCls}`;
    ring.style.cssText = `position:absolute;left:0;top:0;width:12.5%;height:12.5%;border-radius:50%;box-sizing:border-box;border:${w}px solid #ff5252;box-shadow:0 0 ${w * 3}px #ff5252;pointer-events:none;opacity:0;`;
    host.addToLayer(ring, 'vfx-above');
    const dur = a.checkmate ? 800 : 600;
    const pulse = host.animator.play({
      duration: dur,
      keyframes: { 0: { alpha: 0, scale: 0.9 }, 15: { alpha: 1, scale: 1.1875 }, 100: { alpha: a.checkmate ? 1 : 0, scale: 1.1875 } },
      easing: outSine,
      onUpdate: (t) => {
        ring.style.opacity = String(t.animatedProps.alpha);
        setScale(ring, t.animatedProps.scale);
      },
    });
    return host.animator.play({
      duration: dur,
      easing: a.checkmate ? outElastic : outSine,
      keepAlive: a.checkmate,
      keyframes: { 0: { scale: 1 }, 10: { scale: 1.1 }, 100: { scale: 1 } },
      onUpdate: (t) => {
        if (a.piece && !a.illegal && !t.keptAlive) a.piece.setProps({ scale: t.animatedProps.scale });
      },
      onEnd: () => {
        host.animator.end(pulse);
        ring.remove();
        a.piece?.reset();
      },
    });
  }

  showHint(h: HintHandle): Tween {
    setScale(h.el, 0);
    return this.host.animator.play({
      duration: 300,
      easing: outElastic,
      keyframes: { 0: { scale: 0 }, 100: { scale: 1 } },
      onUpdate: (t) => {
        setScale(h.el, t.animatedProps.scale);
      },
      onEnd: () => {
        setScale(h.el, null);
      },
    });
  }

  hideHint(h: HintHandle): Tween {
    return this.host.animator.play({
      duration: 300,
      easing: outQuad,
      keyframes: { 0: { scale: 1 }, 100: { scale: 0 } },
      onUpdate: (t) => {
        setScale(h.el, t.animatedProps.scale);
      },
      onEnd: () => h.el.remove(),
    });
  }

  hintOver(h: HintHandle): Tween {
    h.over = this.host.animator.play({
      duration: 150,
      easing: outCubic,
      keepAlive: true,
      keyframes: { 0: { scale: 1 }, 100: { scale: h.kind === 'move' ? 1.6 : 1.12 } },
      onUpdate: (t) => {
        setScale(h.el, t.animatedProps.scale);
      },
    });
    return h.over;
  }

  hintOut(h: HintHandle): Tween {
    const cur = currentScale(h.el);
    if (h.over) this.host.animator.end(h.over);
    h.over = undefined;
    return this.host.animator.play({
      duration: 150,
      easing: outCubic,
      keyframes: { 0: { scale: cur }, 100: { scale: 1 } },
      onUpdate: (t) => {
        setScale(h.el, t.animatedProps.scale);
      },
    });
  }
}

const withAlpha = (hex: string, a: number): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

export function createPieceStyleFx(type: string, host: FxHost): PieceStyleFx | null {
  if (type === 'natural') return new NaturalFx(host);
  if (type === 'arcade') return new ArcadeFx(host);
  return null;
}
