import type { Color, MoveFlags, Piece, PieceType, PiecesMap, PromotionType, Square } from '../types';
import { squareClass } from '../squares';
import type { Layers } from './layers';
import type { Animator, AnimationContext, PieceAnimation } from '../animation';
import { FxPiece, type FxHost, type PieceStyleFx, type Pos } from '../fx/piece-fx';
import type { Tween } from '../fx/tween';

/** What the piece layer needs to know about a move. */
export interface RenderedMove {
  from: Square;
  to: Square;
  color: Color;
  piece: PieceType;
  promotion?: PromotionType;
  capturedSquare?: Square;
  flags: MoveFlags;
  rookMove?: { from: Square; to: Square };
  /** Slide the moving piece(s) and fade out the captured one. */
  animate: boolean;
  /** The move was made by dropping a dragged piece (the piece is already at the pointer). */
  fromDrop?: boolean;
  check?: boolean;
  checkmate?: boolean;
}

interface PieceView {
  el: HTMLElement;
  color: Color;
  type: PieceType;
}

const POOL_CLASS = 'element-pool';

/** `className` with every class that starts with `prefix` removed. */
function stripClassPrefix(el: HTMLElement, prefix: string): void {
  for (const c of [...el.classList]) if (c.startsWith(prefix)) el.classList.remove(c);
}

/** Put an element on a square (class-based) and drop any inline transform. */
export function placeOnSquare(el: HTMLElement, square: Square): void {
  stripClassPrefix(el, 'square-');
  el.classList.add(squareClass(square));
  el.style.transform = '';
}

export class PieceLayer {
  private views = new Map<Square, PieceView>();
  private pool: HTMLElement[] = [];
  private dragging: Square | undefined;
  private animator: Animator | null = null;
  private animatorFactory: () => Animator;
  /** Notifications used by the sway effect. */
  onDragStart: (() => void) | null = null;
  onDragEnd: ((square: Square) => void) | null = null;

  // ── "natural" / "arcade" style state ──
  private fx: PieceStyleFx | null = null;
  private fxHost: FxHost | null = null;
  private fxPieces = new WeakMap<HTMLElement, FxPiece>();
  private dragTween: Tween | null = null;
  private pendingDrop: { square: Square; pos: Pos } | null = null;
  private kingTween: Tween | null = null;
  private over: { square: Square; el: HTMLElement } | null = null;
  private busy = 0;
  /** Called when the number of running piece animations goes between zero and non-zero. */
  onFxBusy: ((busy: boolean) => void) | null = null;

  constructor(
    private layers: Layers,
    private doc: Document,
    animatorFactory: () => Animator,
    private animationContext: () => AnimationContext,
  ) {
    this.animatorFactory = animatorFactory;
    for (let i = 0; i < 32; i++) this.pool.push(this.makeElement());
  }

  // ── element pool ────────────────────────────────────────────────────────

  private makeElement(): HTMLElement {
    const el = this.doc.createElement('div');
    el.className = POOL_CLASS;
    this.layers.add(el, 'pieces');
    return el;
  }

  private acquire(): HTMLElement {
    const el = this.pool.pop() ?? this.makeElement();
    el.className = '';
    el.style.cssText = '';
    return el;
  }

  private release(el: HTMLElement): void {
    el.className = POOL_CLASS;
    el.style.cssText = '';
    this.pool.push(el);
  }

  // ── animations ──────────────────────────────────────────────────────────

  /** (Re)create the animator, e.g. after the animation type changed. */
  resetAnimator(): void {
    this.animator?.flush();
    this.animator?.destroy();
    this.animator = null;
  }

  private anim(): Animator {
    return (this.animator ??= this.animatorFactory());
  }

  flushAnimations(): void {
    this.animator?.flush();
    if (this.fxHost) {
      // finish running piece effects (but not open-ended ones such as a held drag)
      for (const t of [...this.fxHost.animator.playingAnimations]) {
        if (t !== this.dragTween && t.params.duration !== undefined) this.fxHost.animator.end(t);
      }
    }
  }

  /** Install (or remove) a natural/arcade style. */
  setFx(style: PieceStyleFx | null, host: FxHost | null): void {
    if (this.fx && this.fxHost) this.fxHost.animator.endAll();
    this.fx = style;
    this.fxHost = host;
    this.dragTween = null;
    this.over = null;
    this.kingTween = null;
    this.pendingDrop = null;
    this.busy = 0;
  }

  get hasFx(): boolean {
    return !!this.fx;
  }

  private fxp(sq: Square): FxPiece | null {
    const v = this.views.get(sq);
    if (!v || !this.fxHost) return null;
    let f = this.fxPieces.get(v.el);
    if (!f || f.color !== v.color) {
      f = new FxPiece(v.el, v.color, this.fxHost);
      this.fxPieces.set(v.el, f);
    }
    return f;
  }

  /** Track a piece animation so `isBusy` / `animationComplete` know about it. */
  private track(tw: Tween): Tween {
    this.busy++;
    if (this.busy === 1) this.onFxBusy?.(true);
    tw.onEnd(() => {
      this.busy = Math.max(0, this.busy - 1);
      if (this.busy === 0) this.onFxBusy?.(false);
    });
    return tw;
  }

  // ── queries ─────────────────────────────────────────────────────────────

  has(sq: Square): boolean {
    return this.views.has(sq);
  }

  getElement(sq: Square): HTMLElement | undefined {
    return this.views.get(sq)?.el;
  }

  pieces(): PiecesMap {
    const m: PiecesMap = new Map();
    for (const [sq, v] of this.views) m.set(sq, { color: v.color, type: v.type });
    return m;
  }

  draggingSquare(): Square | undefined {
    return this.dragging;
  }

  private hiders = new WeakMap<HTMLElement, Set<symbol>>();

  /** Hide the piece on `square` (an effect shows its own copy). Returns the function that shows it again. */
  hide(sq: Square): () => void {
    const v = this.views.get(sq);
    if (!v) return () => undefined;
    const token = Symbol('hide');
    const set = this.hiders.get(v.el) ?? new Set<symbol>();
    set.add(token);
    this.hiders.set(v.el, set);
    v.el.classList.add('piece-hidden');
    return () => {
      set.delete(token);
      if (set.size === 0) v.el.classList.remove('piece-hidden');
    };
  }

  /** Show every hidden piece again. */
  revealAll(): void {
    for (const v of this.views.values()) {
      v.el.classList.remove('piece-hidden');
      this.hiders.delete(v.el);
    }
  }

  /** Square of the king of `color`, if it is on the board. */
  kingSquare(color: Color): Square | null {
    for (const [sq, v] of this.views) if (v.type === 'k' && v.color === color) return sq;
    return null;
  }

  // ── building blocks ─────────────────────────────────────────────────────

  create(sq: Square, piece: Piece): void {
    const el = this.acquire();
    el.classList.add('piece', `${piece.color}${piece.type}`);
    placeOnSquare(el, sq);
    this.views.set(sq, { el, color: piece.color, type: piece.type });
  }

  private setDetails(sq: Square, color: Color, type: PieceType): void {
    const v = this.views.get(sq);
    if (!v) return;
    v.el.classList.remove(`${v.color}${v.type}`);
    v.el.classList.add(`${color}${type}`);
    v.color = color;
    v.type = type;
  }

  private forgetDragging(sq: Square): void {
    if (this.dragging !== sq) return;
    this.dragging = undefined;
    this.endDragTween();
    this.onDragEnd?.(sq);
  }

  /** Remove pieces; with `animate` they fade out first. */
  remove(squares: Square[], animate = false, fromDrop = false): void {
    const fades: PieceAnimation[] = [];
    for (const sq of squares) {
      const v = this.views.get(sq);
      if (!v) continue;
      const f = this.fx && animate ? this.fxp(sq) : null;
      this.views.delete(sq);
      this.forgetDragging(sq);
      if (f && this.fx && this.fxHost) {
        // position inline so the shrinking piece stays on its square
        const o = this.fxHost.offsetOf(sq);
        f.x = o.x;
        f.y = o.y;
        f.apply();
        this.track(this.fx.capture(f, fromDrop)).onEnd(() => this.release(v.el));
      } else if (animate) fades.push({ type: 'fade-out', el: v.el, callback: () => this.release(v.el) });
      else this.release(v.el);
    }
    if (fades.length) this.anim().add(fades, this.animationContext());
  }

  // ── position sync ───────────────────────────────────────────────────────

  /**
   * Make the DOM match `target`: delete pieces that are gone, create new ones
   * and re-skin pieces whose identity changed. Pieces are not slid around.
   */
  load(target: PiecesMap, reloadAll = false): void {
    this.flushAnimations();
    this.anim().flush();
    const gone = [...this.views.keys()].filter((sq) => !target.has(sq));
    this.remove(reloadAll ? [...this.views.keys()] : gone);
    for (const [sq, piece] of target) {
      const v = this.views.get(sq);
      if (!v) this.create(sq, piece);
      else if (v.type !== piece.type || v.color !== piece.color) this.setDetails(sq, piece.color, piece.type);
    }
    this.anim().run();
  }

  /** Apply a move to the DOM. */
  move(m: RenderedMove): void {
    if (this.fx && this.fxHost) {
      this.moveFx(m);
      return;
    }
    this.anim().flush();

    // 1) captured piece
    if (m.flags.enPassant && m.capturedSquare) this.remove([m.capturedSquare], m.animate);
    else if (this.views.has(m.to)) this.remove([m.to], m.animate);

    // 2) movers (the rook of a castling move always slides, even when the king was dragged)
    const movers: Array<{ from: Square; to: Square; animate: boolean; promotion?: PromotionType }> = [
      { from: m.from, to: m.to, animate: m.animate, promotion: m.promotion },
    ];
    if (m.rookMove) movers.push({ from: m.rookMove.from, to: m.rookMove.to, animate: true });

    const slides: PieceAnimation[] = [];
    const destinations = movers.map((x) => x.to);
    const lifted = movers.map((x) => ({ ...x, view: this.views.get(x.from) }));
    for (const x of lifted) {
      if (!x.view) continue;
      placeOnSquare(x.view.el, x.to);
      if (x.animate) slides.push({ type: 'slide', el: x.view.el, from: x.from, to: x.to });
      this.views.set(x.to, x.view);
      if (!destinations.includes(x.from)) this.views.delete(x.from);
      if (x.promotion) this.setDetails(x.to, x.view.color, x.promotion);
    }
    if (this.dragging && !this.views.has(this.dragging)) this.dragging = undefined;
    if (slides.length) this.anim().add(slides, this.animationContext());
    this.anim().run();
  }

  /** The natural / arcade version of {@link move}. */
  private moveFx(m: RenderedMove): void {
    const fx = this.fx!;
    const host = this.fxHost!;
    this.flushAnimations();
    this.endKingAttack();

    // a drop whose destination is this move's origin keeps its pointer position as the start of the animation
    const drop = m.fromDrop && this.pendingDrop && this.pendingDrop.square === m.from ? this.pendingDrop : null;
    this.pendingDrop = null;

    // 1) captured piece
    const capSq = m.flags.enPassant && m.capturedSquare ? m.capturedSquare : this.views.has(m.to) ? m.to : null;
    if (capSq) this.remove([capSq], true, !!m.fromDrop);

    // 2) movers
    const movers: Array<{ from: Square; to: Square; animate: boolean; castling: boolean; promotion?: PromotionType; main: boolean }> = [
      { from: m.from, to: m.to, animate: m.animate || !!drop, castling: false, promotion: m.promotion, main: true },
    ];
    if (m.rookMove) movers.push({ from: m.rookMove.from, to: m.rookMove.to, animate: true, castling: true, main: false });
    const destinations = movers.map((x) => x.to);
    const lifted = movers.map((x) => ({ ...x, view: this.views.get(x.from) }));
    let mainTween: Tween | null = null;
    for (const x of lifted) {
      if (!x.view) continue;
      const f = this.fxp(x.from)!;
      const fromOff = host.offsetOf(x.from);
      const toOff = host.offsetOf(x.to);
      placeOnSquare(x.view.el, x.to); // class position = destination; inline state animates from the origin
      this.views.set(x.to, x.view);
      if (!destinations.includes(x.from)) this.views.delete(x.from);
      if (x.promotion) this.setDetails(x.to, x.view.color, x.promotion);
      if (x.from === x.to) continue;
      let tween: Tween | null = null;
      if (x.main && drop) {
        f.x = drop.pos.x;
        f.y = drop.pos.y;
        f.apply();
        tween = fx.drop(f, toOff, x.view.color);
      } else if (x.animate) {
        f.x = fromOff.x;
        f.y = fromOff.y;
        f.apply();
        tween = fx.move(f, { from: fromOff, to: toOff, castling: x.castling, capturing: !!capSq });
      }
      if (tween) {
        this.track(tween);
        if (x.main) mainTween = tween;
      }
    }
    if (this.dragging && !this.views.has(this.dragging)) this.forgetDragging(this.dragging);

    // 3) check animation on the king once the move has landed
    if (m.check) {
      const kingSq = this.kingSquare(m.color === 'w' ? 'b' : 'w');
      if (kingSq) {
        const go = (): void => this.startKingAttack(kingSq, false, !!m.checkmate);
        if (mainTween) (mainTween as Tween).onEnd((t) => !t.forcedEnd && go());
        else go();
      }
    }
  }

  /** Pulse the checked king; `illegal` when the user tried a move that does not resolve the check. */
  startKingAttack(square: Square, illegal: boolean, checkmate: boolean): void {
    if (!this.fx || !this.fxHost) return;
    this.endKingAttack();
    const f = this.fxp(square);
    if (!f) return;
    const o = this.fxHost.offsetOf(square);
    f.x = o.x;
    f.y = o.y;
    this.kingTween = this.fx.attackKing({ piece: f, square, illegal, checkmate });
  }

  endKingAttack(): void {
    if (this.kingTween && this.fxHost) this.fxHost.animator.end(this.kingTween);
    this.kingTween = null;
  }

  /** Reverse a move (slide back, restore the captured piece, demote a promoted pawn). */
  undo(m: RenderedMove & { captured?: PieceType }, animate = true): void {
    this.flushAnimations();
    this.anim().flush();
    this.endKingAttack();
    const fx = this.fx;
    const host = this.fxHost;
    const back: Array<{ from: Square; to: Square; castling: boolean }> = [{ from: m.to, to: m.from, castling: false }];
    if (m.rookMove) back.push({ from: m.rookMove.to, to: m.rookMove.from, castling: true });
    const slides: PieceAnimation[] = [];
    const targets = back.map((b) => b.to);
    const lifted = back.map((b) => ({ ...b, view: this.views.get(b.from) }));
    for (const b of lifted) {
      if (!b.view) continue;
      const f = fx && host ? this.fxp(b.from) : null;
      placeOnSquare(b.view.el, b.to);
      this.views.set(b.to, b.view);
      if (!targets.includes(b.from)) this.views.delete(b.from);
      if (!animate) continue;
      if (f && fx && host) {
        const a = host.offsetOf(b.from);
        const z = host.offsetOf(b.to);
        f.x = a.x;
        f.y = a.y;
        f.apply();
        this.track(fx.move(f, { from: a, to: z, castling: b.castling, capturing: false }));
      } else slides.push({ type: 'slide', el: b.view.el, from: b.from, to: b.to });
    }
    if (m.promotion) this.setDetails(m.from, m.color, 'p');
    if (m.captured) {
      const capSq = m.capturedSquare ?? m.to;
      this.create(capSq, { color: m.color === 'w' ? 'b' : 'w', type: m.captured });
      const f = fx && host ? this.fxp(capSq) : null;
      if (f && fx) {
        this.track(fx.restore(f));
      }
    }
    if (slides.length) this.anim().add(slides, this.animationContext());
    this.anim().run();
  }

  // ── hover (natural style) ───────────────────────────────────────────────

  /** Pointer is over `square` (or off the board when null) while no button is pressed. */
  hover(square: Square | null, selected?: Square): void {
    const fx = this.fx;
    if (!fx?.pieceOver || !this.fxHost) return;
    if (this.over && this.over.square !== square) {
      const { el, square: was } = this.over;
      this.over = null;
      fx.pieceOut?.(was, el);
    }
    if (square && !this.over && !this.dragging && square !== selected && this.views.has(square)) {
      const f = this.fxp(square)!;
      const r = fx.pieceOver(f, square);
      this.over = { square, el: r.el };
    }
  }

  // ── dragging ────────────────────────────────────────────────────────────

  private endDragTween(): void {
    if (this.dragTween && this.fxHost) this.fxHost.animator.end(this.dragTween);
    this.dragTween = null;
  }

  private setDraggingState(sq: Square, on: boolean): void {
    const v = this.views.get(sq);
    if (!v) {
      if (!on && this.dragging === sq) {
        this.dragging = undefined;
        this.endDragTween();
      }
      return;
    }
    if (on && sq === this.dragging) return;
    v.el.classList.toggle('dragging', on);
    this.dragging = on ? sq : undefined;
    if (on) {
      if (this.fx && this.fxHost) {
        const f = this.fxp(sq)!;
        this.hover(null);
        this.dragTween = this.fx.dragStart(f);
      }
      this.onDragStart?.();
    } else {
      this.endDragTween();
      this.onDragEnd?.(sq);
    }
  }

  /** Set an explicit transform on a piece without touching its drag state. */
  setTransform(sq: Square, coords: { x: number; y: number }, rotation: number, scale: number): void {
    const v = this.views.get(sq);
    if (v) v.el.style.transform = `translate(${coords.x}%, ${coords.y}%) rotate(${rotation}deg) scale(${scale})`;
  }

  clearTransform(sq: Square): void {
    const v = this.views.get(sq);
    if (v) v.el.style.transform = '';
  }

  /** Follow the pointer: `coords` are in the 800×800 board space (piece centred on pointer). */
  dragTo(sq: Square, coords: { x: number; y: number }, rotation = 0, scale = 1): void {
    if (this.dragging && this.dragging !== sq) this.setDraggingState(this.dragging, false);
    if (this.fx) {
      const f = this.fxp(sq);
      if (f) {
        f.x = coords.x;
        f.y = coords.y;
        if (this.dragging === sq) f.apply();
        else {
          f.apply();
          this.setDraggingState(sq, true);
        }
        return;
      }
    }
    this.setTransform(sq, coords, rotation, scale);
    this.setDraggingState(sq, true);
  }

  /** Park the dragged piece visually on `over` (used while the promotion window is open). */
  suspendOver(sq: Square, over: Square): void {
    const v = this.views.get(sq);
    if (v) placeOnSquare(v.el, over);
    this.setDraggingState(sq, true);
  }

  /**
   * Release the dragged piece. `to` is where the user dropped it: the piece's own
   * square (or nothing) animates back; another square means a move follows
   * immediately and will take over from the pointer position.
   */
  drop(to?: Square): void {
    const sq = this.dragging;
    if (!sq) return;
    const v = this.views.get(sq);
    if (this.fx && this.fxHost && v) {
      const f = this.fxp(sq)!;
      const pos = { x: f.x, y: f.y };
      this.setDraggingState(sq, false); // ends the drag tween (scale/shadow restored)
      if (!to || to === sq) {
        placeOnSquare(v.el, sq);
        f.x = pos.x;
        f.y = pos.y;
        f.apply();
        this.track(this.fx.drop(f, this.fxHost.offsetOf(sq), v.color));
      } else {
        this.pendingDrop = { square: sq, pos };
        // if no move follows in this tick, glide back to the origin
        queueMicrotask(() => {
          if (this.pendingDrop && this.pendingDrop.square === sq && this.fx && this.fxHost) {
            const p = this.pendingDrop;
            this.pendingDrop = null;
            const cur = this.views.get(sq);
            if (!cur) return;
            const ff = this.fxp(sq)!;
            placeOnSquare(cur.el, sq);
            ff.x = p.pos.x;
            ff.y = p.pos.y;
            ff.apply();
            this.track(this.fx.drop(ff, this.fxHost.offsetOf(sq), cur.color));
          }
        });
      }
      return;
    }
    if (v) placeOnSquare(v.el, sq);
    this.setDraggingState(sq, false);
  }

  destroy(): void {
    this.fxHost?.animator.endAll();
    this.animator?.destroy();
    this.animator = null;
    this.views.clear();
    this.pool = [];
  }
}
