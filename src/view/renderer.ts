import type { AnimationType, Color, PiecesMap, PromotionType, Square } from '../types';
import type { BoardOptions } from '../options';
import { pointerToBoard, squareOffset, type PointerPosition } from '../squares';
import { SteppedAnimator, TweenAnimator, type AnimationContext, type Animator } from '../animation';
import { Layers, layerOrder } from './layers';
import { PieceLayer, type RenderedMove } from './pieces';
import { Highlights, Hints, HoverSquare, blinkSquare, type HighlightSpec } from './overlays';
import type { EffectsHost } from './effects';
import type { CustomItemsHost } from './custom-items';
import { Arrows, type ArrowSpec } from './arrows';
import { Coordinates } from './coordinates';
import { PromotionWindow, type PromotionHandlers } from './promotion';
import { boardCss, boardImageValue, ensureBaseStyles } from './styles';
import { durationFor } from '../animation';
import type { VfxHost } from '../vfx/vfx';
import { PieceSway } from './sway';
import { Animator as KeyframeAnimator } from '../fx/tween';
import { createPieceStyleFx } from '../fx/styles';
import type { FxHost, PieceStyleFx } from '../fx/piece-fx';

/**
 * DOM renderer. Owns the board element and every visual layer; knows nothing
 * about chess rules or interaction state.
 */
export class BoardRenderer {
  readonly el: HTMLDivElement;
  readonly pieces: PieceLayer;
  private layers: Layers;
  private highlights: Highlights;
  private hints: Hints;
  private hover: HoverSquare;
  private arrows: Arrows;
  private coordinates: Coordinates;
  private promotion: PromotionWindow;
  private styleEl: HTMLStyleElement;
  private doc: Document;
  private animating = false;
  private fxBusy = false;
  private waiters: Array<() => void> = [];
  private blinkers = new Set<() => void>();
  private resizeObserver: ResizeObserver | null = null;
  private sway: PieceSway | null = null;
  private lastAnimationType: AnimationType;
  private fx: PieceStyleFx | null = null;
  private fxAnimator = new KeyframeAnimator();
  private fxHost: FxHost;
  private heldSquare: Square | undefined;

  constructor(host: HTMLElement, private opts: () => BoardOptions) {
    this.doc = host.ownerDocument;
    ensureBaseStyles(this.doc);

    const o = opts();
    this.el = this.doc.createElement('div');
    this.el.id = o.id;
    this.el.className = 'board square-host';
    this.el.classList.toggle('not-rounded', !o.rounded);
    this.el.classList.toggle('flipped', o.flipped);
    host.appendChild(this.el);

    this.styleEl = this.doc.createElement('style');
    this.styleEl.dataset.board = o.id;
    this.doc.head.appendChild(this.styleEl);
    this.updateStyles();

    this.lastAnimationType = o.animationType;
    this.layers = new Layers(this.el, layerOrder(o.animationType));
    this.fxHost = {
      animator: this.fxAnimator,
      boardEl: this.el,
      doc: this.doc,
      squareSize: () => (this.el.getBoundingClientRect().width || 640) / 8,
      flipped: () => this.opts().flipped,
      addToLayer: (el, layer) => this.layers.add(el, layer),
      offsetOf: (sq) => squareOffset(sq, this.opts().flipped),
    };
    this.pieces = new PieceLayer(
      this.layers,
      this.doc,
      () => this.makeAnimator(),
      () => this.animationContext(),
    );
    this.pieces.onFxBusy = (busy) => {
      this.fxBusy = busy;
      this.refreshAnimating();
    };
    this.highlights = new Highlights(this.layers, this.doc, { fx: () => this.fx, squareSize: () => this.fxHost.squareSize() });
    this.hints = new Hints(this.layers, this.doc, () => this.opts().animationType, () => this.fx);
    this.hover = new HoverSquare(this.layers, this.doc);
    this.arrows = new Arrows(this.layers, this.doc);
    this.coordinates = new Coordinates(this.layers, this.doc);
    this.promotion = new PromotionWindow(this.layers, this.doc);
    this.coordinates.set(o.coordinates, o.flipped);
    this.syncFx();
    this.syncSway();

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.hints.refreshSizes());
      this.resizeObserver.observe(this.el);
    }
    this.el.addEventListener('pointermove', this.onHoverMove);
    this.el.addEventListener('pointerleave', this.onHoverLeave);
  }

  // ── animation plumbing ──────────────────────────────────────────────────

  private makeAnimator(): Animator {
    const hooks = {
      isAnimating: () => this.animating,
      setAnimating: (on: boolean) => this.setAnimating(on),
    };
    return this.opts().animationType === 'dynamic' ? new TweenAnimator(hooks) : new SteppedAnimator(hooks);
  }

  private animationContext(): AnimationContext {
    const o = this.opts();
    return { animationType: o.animationType, flipped: o.flipped, boardEl: this.el };
  }

  private setAnimating(on: boolean): void {
    this.animating = on;
    this.refreshAnimating();
  }

  private refreshAnimating(): void {
    const busy = this.animating || this.fxBusy;
    if (busy) this.el.dataset.animating = 'true';
    else {
      delete this.el.dataset.animating;
      const w = this.waiters.splice(0);
      w.forEach((fn) => fn());
    }
  }

  isAnimating(): boolean {
    return this.animating || this.fxBusy;
  }

  /** Resolves once every running animation has finished. */
  animationComplete(): Promise<void> {
    return this.isAnimating() ? new Promise((res) => this.waiters.push(res)) : Promise.resolve();
  }

  // ── piece style (natural / arcade) ──────────────────────────────────────

  /** Install the natural/arcade style that matches the options (or none). */
  private syncFx(): void {
    const type = this.opts().animationType;
    const want = type === 'natural' || type === 'arcade' ? type : null;
    if ((this.fx?.name ?? null) === want) return;
    this.fxAnimator.endAll();
    this.fx = want ? createPieceStyleFx(want, this.fxHost) : null;
    this.pieces.setFx(this.fx, this.fx ? this.fxHost : null);
    this.el.classList.toggle('fx-style', !!this.fx);
    this.hints.clear();
  }

  private onHoverMove = (e: PointerEvent): void => {
    if (!this.fx || e.buttons !== 0) return;
    const sq = this.pointer(e.clientX, e.clientY).square;
    this.pieces.hover(sq, this.heldSquare);
    this.hints.hover(sq);
  };

  private onHoverLeave = (): void => {
    this.pieces.hover(null);
    this.hints.hover(null);
  };

  // ── options-driven refresh ──────────────────────────────────────────────

  updateStyles(): void {
    this.styleEl.textContent = boardCss(this.opts());
  }

  /** Call after options changed. */
  optionsChanged(prev: BoardOptions): void {
    const o = this.opts();
    this.el.classList.toggle('not-rounded', !o.rounded);
    if (o.flipped !== prev.flipped) this.setFlipped(o.flipped);
    else if (o.coordinates !== prev.coordinates) this.coordinates.set(o.coordinates, o.flipped);
    if (o.boardStyle !== prev.boardStyle || o.boardImage !== prev.boardImage || o.pieces !== prev.pieces || o.highlightColor !== prev.highlightColor) {
      this.updateStyles();
    }
    if (o.animationType !== this.lastAnimationType) {
      const wasDynamic = this.lastAnimationType === 'dynamic';
      this.lastAnimationType = o.animationType;
      this.pieces.resetAnimator();
      this.syncFx();
      if (wasDynamic !== (o.animationType === 'dynamic')) {
        this.hints.clear();
        this.layers.moveHintLayers(o.animationType);
      }
    }
    this.syncSway();
  }

  setFlipped(flipped: boolean): void {
    this.el.classList.toggle('flipped', flipped);
    this.coordinates.set(this.opts().coordinates, flipped);
  }

  // ── pointer geometry ────────────────────────────────────────────────────

  pointer(clientX: number, clientY: number): PointerPosition {
    return pointerToBoard(this.el.getBoundingClientRect(), clientX, clientY, this.opts().flipped);
  }

  // ── pieces ──────────────────────────────────────────────────────────────

  loadPieces(pieces: PiecesMap, reloadAll = false): void {
    this.pieces.load(pieces, reloadAll);
  }

  makeMove(move: RenderedMove): void {
    this.pieces.move(move);
  }

  /** What the effect manager needs from the renderer. */
  vfxHost(): VfxHost {
    return {
      doc: this.doc,
      boardImage: () => boardImageValue(this.opts()),
      flipped: () => this.opts().flipped,
      moveDuration: () => durationFor(this.opts().animationType),
      addToLayer: (el, layer) => this.layers.add(el, layer),
      hidePiece: (sq) => this.pieces.hide(sq),
    };
  }

  effectsHost(emit: EffectsHost['emit']): EffectsHost {
    return {
      doc: this.doc,
      root: this.el,
      placeholder: () => this.layers.placeholder('effects'),
      flipped: () => this.opts().flipped,
      squareSize: () => this.el.getBoundingClientRect().width / 8,
      labels: () => this.opts().effectLabels ?? {},
      fadeIn: () => this.opts().fadeInEffects,
      emit,
    };
  }

  customItemsHost(playSound: CustomItemsHost['playSound']): CustomItemsHost {
    return { doc: this.doc, root: this.el, layers: this.layers, playSound };
  }

  revealPieces(): void {
    this.pieces.revealAll();
  }

  /** Square currently selected or dragged (hover effects skip it). */
  setHeld(square: Square | undefined): void {
    this.heldSquare = square;
  }

  dragPiece(sq: Square, coords?: { x: number; y: number }, toSquare?: Square): void {
    const tilt = this.sway?.dragged(sq, coords ?? null);
    if (toSquare) this.pieces.suspendOver(sq, toSquare);
    else if (coords) this.pieces.dragTo(sq, coords, tilt?.rotation ?? 0, tilt?.scale ?? 1);
  }

  /** The state machine selected (picked up) a piece. */
  pieceSelected(sq: Square): void {
    this.sway?.pieceSelected(sq);
  }

  /** Position changed with nothing being dragged: stop any residual sway transforms. */
  swayStop(): void {
    this.sway?.stop();
  }

  /** Create / destroy the sway effect to match the options (`pieceSway`, defaulting to the dynamic animation type). */
  private syncSway(): void {
    const o = this.opts();
    const want = !this.fx && (o.pieceSway ?? o.animationType === 'dynamic');
    if (want && !this.sway) {
      this.sway = new PieceSway({
        setPiecePosition: (sq, c, rot, s) => this.pieces.setTransform(sq, c, rot, s),
        clearPieceTransform: (sq) => this.pieces.clearTransform(sq),
        coordsOfSquare: (sq) => squareOffset(sq, this.opts().flipped),
      });
      this.pieces.onDragStart = () => this.sway?.dragStarted();
      this.pieces.onDragEnd = (sq) => this.sway?.dragEnded(sq);
    } else if (!want && this.sway) {
      this.sway.destroy();
      this.sway = null;
      this.pieces.onDragStart = null;
      this.pieces.onDragEnd = null;
    }
  }

  /** Release the dragged piece; `to` is the square it was dropped on. */
  dropPiece(to?: Square): void {
    this.pieces.drop(to);
  }

  flushAnimations(): void {
    this.pieces.flushAnimations();
  }

  // ── overlays ────────────────────────────────────────────────────────────

  setHighlights(specs: HighlightSpec[]): void {
    this.highlights.set(specs);
  }

  setHints(quiet: Square[], captures: Square[]): void {
    this.hints.set(quiet, captures);
  }

  showHoverSquare(sq: Square, heldColor?: Color): void {
    this.hover.tint(this.fx?.accent && heldColor ? this.fx.accent(heldColor) : null);
    this.hover.show(sq);
  }

  hideHoverSquare(): void {
    this.hover.hide();
  }

  /** King-in-check feedback after an illegal move: blinking square, or the style's own king animation. */
  blink(square: Square, color: string): void {
    if (this.fx) {
      this.pieces.startKingAttack(square, true, false);
      return;
    }
    const stop = blinkSquare(this.layers, this.doc, square, color);
    this.blinkers.add(stop);
  }

  setArrows(specs: ArrowSpec[]): void {
    this.arrows.set(specs);
  }

  setAnalysisOverlay(on: boolean): void {
    this.el.classList.toggle('analysis-overlay', on);
  }

  private fadeEl: HTMLElement | null = null;

  /** Cover the position with the empty board and fade it away over `ms`. */
  fadeSetup(ms: number): void {
    if (ms <= 0) {
      this.fadeEl?.remove();
      this.fadeEl = null;
      return;
    }
    if (!this.fadeEl) {
      this.fadeEl = this.doc.createElement('div');
      this.fadeEl.classList.add('fade-in-overlay');
      this.layers.add(this.fadeEl, 'fade-setup');
      this.fadeEl.addEventListener('animationend', () => {
        if (!this.fadeEl) return;
        this.fadeEl.style.animationDuration = '';
        this.fadeEl.classList.remove('animate');
      });
    }
    const el = this.fadeEl;
    el.classList.remove('animate');
    void el.offsetHeight;
    el.style.animationDuration = `${ms / 1000}s`;
    el.classList.add('animate');
  }

  // ── promotion window ────────────────────────────────────────────────────

  openPromotionWindow(opts: { to: Square; color: 'w' | 'b' }, handlers: PromotionHandlers): void {
    const o = this.opts();
    this.promotion.open({ ...opts, flipped: o.flipped, dynamic: o.animationType === 'dynamic' }, handlers);
    const el = this.promotion.element();
    if (this.fx?.showPromotion && el) this.fx.showPromotion(el);
  }

  closePromotionWindow(): void {
    this.promotion.close();
  }

  isPromotionOpen(): boolean {
    return this.promotion.isOpen();
  }

  destroy(): void {
    this.el.removeEventListener('pointermove', this.onHoverMove);
    this.el.removeEventListener('pointerleave', this.onHoverLeave);
    this.resizeObserver?.disconnect();
    this.arrows.destroy();
    this.fxAnimator.endAll();
    this.sway?.destroy();
    this.blinkers.forEach((stop) => stop());
    this.blinkers.clear();
    this.pieces.destroy();
    this.promotion.destroy();
    this.styleEl.remove();
    this.el.remove();
    // nothing is animating any more: let `animationComplete()` callers go
    this.waiters.splice(0).forEach((fn) => fn());
  }
}

export type { RenderedMove, HighlightSpec, ArrowSpec, PromotionType };
