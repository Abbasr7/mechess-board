/**
 * Square overlays: highlights, move/capture hints, the hover outline and the
 * blinking highlight shown after an illegal move.
 */
import type { AnimationType, Color, Square } from '../types';
import type { HintHandle, PieceStyleFx } from '../fx/piece-fx';
import type { Tween } from '../fx/tween';
import type { Layers } from './layers';
import { placeOnSquare } from './pieces';

export interface HighlightSpec {
  /** Stable identity, e.g. `move|e4`. */
  key: string;
  square: Square;
  /** CSS colour; omit to use the board theme's highlight colour. */
  color?: string;
  opacity: number;
  /**
   * "dynamic" animation type: the highlight grows in as a circle that fills
   * the square. `color` must be set when this is true.
   */
  growing?: boolean;
  /** What the highlight marks; the arcade style draws last-move highlights as outlines. */
  kind?: 'move' | 'selection' | 'analysis' | 'premove';
  /** Side that made the move (arcade accent colour). */
  turn?: Color;
}

interface HighlightView {
  el: HTMLElement;
  sig: string;
}

export interface HighlightFxContext {
  fx(): PieceStyleFx | null;
  squareSize(): number;
}

export class Highlights {
  private bySquare = new Map<Square, HighlightView>();
  private pool: HTMLElement[] = [];

  constructor(private layers: Layers, private doc: Document, private ctx?: HighlightFxContext) {}

  private acquire(): HTMLElement {
    const el = this.pool.pop() ?? this.doc.createElement('div');
    el.className = 'highlight';
    el.style.cssText = '';
    this.layers.add(el, 'squares');
    return el;
  }

  private discard(sq: Square, v: HighlightView): void {
    this.bySquare.delete(sq);
    const fx = this.ctx?.fx();
    if (fx?.hideHighlight && !v.el.classList.contains('growing-circle')) {
      fx.hideHighlight(v.el).onEnd(() => {
        v.el.remove();
        this.pool.push(v.el);
      });
      return;
    }
    v.el.remove();
    this.pool.push(v.el);
  }

  /**
   * Show exactly `specs`. Only one highlight is drawn per square: the first
   * spec for a square wins (callers order specs by priority).
   */
  set(specs: HighlightSpec[]): void {
    const wanted = new Map<Square, HighlightSpec>();
    for (const s of specs) if (!wanted.has(s.square)) wanted.set(s.square, s);
    const fx = this.ctx?.fx() ?? null;

    for (const [sq, v] of [...this.bySquare]) {
      if (wanted.has(sq)) continue;
      this.discard(sq, v);
    }
    for (const [sq, spec] of wanted) {
      const outline = !!fx && fx.name === 'arcade' && spec.kind === 'move';
      const sig = `${spec.color ?? ''}|${spec.opacity}|${spec.growing ? 'g' : ''}|${outline ? 'o' + (spec.turn ?? '') : ''}`;
      let v = this.bySquare.get(sq);
      if (v && v.sig === sig) continue;
      if (v && (spec.growing !== v.sig.includes('|g|') || outline !== v.sig.includes('|o'))) {
        // switching look: rebuild so CSS animations restart
        v.el.remove();
        this.pool.push(v.el);
        this.bySquare.delete(sq);
        v = undefined;
      }
      const created = !v;
      if (!v) {
        const el = this.acquire();
        placeOnSquare(el, sq);
        v = { el, sig: '' };
        this.bySquare.set(sq, v);
      }
      const { el } = v;
      if (spec.growing) {
        el.classList.add('growing-circle');
        el.style.backgroundColor = 'transparent';
        el.style.opacity = '';
        el.style.setProperty('--background-color', spec.color ?? '#ffff33');
        el.style.setProperty('--opacity', String(spec.opacity));
      } else if (outline && fx?.accent) {
        el.classList.remove('growing-circle');
        el.style.backgroundColor = 'transparent';
        el.style.boxSizing = 'border-box';
        el.style.border = `${Math.max((this.ctx?.squareSize() ?? 80) * 0.05, 1)}px solid ${fx.accent(spec.turn ?? 'w')}`;
        el.style.opacity = '1';
      } else {
        el.classList.remove('growing-circle');
        el.style.border = '';
        el.style.backgroundColor = spec.color ?? '';
        el.style.opacity = String(spec.opacity);
        if (created && fx?.showHighlight) fx.showHighlight(el, spec.opacity);
      }
      v.sig = sig;
    }
  }

  clear(): void {
    this.set([]);
  }
}

export class Hints {
  private move = new Map<Square, HTMLElement>();
  private capture = new Map<Square, HTMLElement>();
  private over: { square: Square; handle: HintHandle } | null = null;

  constructor(
    private layers: Layers,
    private doc: Document,
    private animationType: () => AnimationType,
    private fx: () => PieceStyleFx | null = () => null,
  ) {}

  /** Show hint dots on `quiet` squares and capture rings on `captures`. */
  set(quiet: Square[], captures: Square[]): void {
    this.sync(this.move, quiet, 'hint', 'move-hints');
    this.sync(this.capture, captures, 'capture-hint', 'capture-hints');
  }

  private sync(store: Map<Square, HTMLElement>, squares: Square[], cls: string, layer: 'move-hints' | 'capture-hints'): void {
    const want = new Set(squares);
    const dynamic = this.animationType() === 'dynamic';
    const fx = this.fx();
    const kind = layer === 'move-hints' ? 'move' : 'capture';
    for (const [sq, el] of [...store]) {
      if (want.has(sq)) continue;
      store.delete(sq);
      if (this.over?.square === sq && this.over.handle.el === el) this.over = null;
      if (fx?.hideHint) fx.hideHint({ el, kind });
      else this.dispose(el, dynamic);
    }
    for (const sq of want) {
      if (store.has(sq)) continue;
      const el = this.doc.createElement('div');
      el.classList.add(cls);
      if (dynamic) {
        el.classList.add('dynamic');
        const circle = this.doc.createElement('div');
        circle.classList.add('circle');
        el.appendChild(circle);
      }
      placeOnSquare(el, sq);
      this.layers.add(el, layer);
      store.set(sq, el);
      // the ring's thickness is 10 % of the square, like the original
      if (layer === 'capture-hints' && !dynamic) el.style.borderWidth = `${el.clientWidth * 0.1}px`;
      fx?.showHint?.({ el, kind });
    }
  }

  /** Remove a hint; in "dynamic" mode it shrinks away first. */
  private dispose(el: HTMLElement, dynamic: boolean): void {
    const circle = el.querySelector('.circle');
    if (!dynamic || !circle) {
      el.remove();
      return;
    }
    el.classList.add('removing');
    circle.classList.add('removing');
    const done = (): void => el.remove();
    circle.addEventListener('animationend', done, { once: true });
    circle.addEventListener('animationcancel', done, { once: true });
    window.setTimeout(done, 250); // safety net when animations are disabled
  }

  /** Pointer hover over a hint square (natural/arcade grow/shrink effect). */
  hover(square: Square | null): void {
    const fx = this.fx();
    if (!fx?.hintOver) return;
    if (this.over && this.over.square !== square) {
      fx.hintOut?.(this.over.handle);
      this.over = null;
    }
    if (!square || this.over) return;
    const quiet = this.move.get(square);
    const cap = this.capture.get(square);
    const el = cap ?? quiet;
    if (!el) return;
    const handle: HintHandle = { el, kind: cap ? 'capture' : 'move' };
    fx.hintOver(handle);
    this.over = { square, handle };
  }

  /** Ring thickness depends on the rendered size; call after a resize. */
  refreshSizes(): void {
    for (const el of this.capture.values()) if (!el.classList.contains('dynamic')) el.style.borderWidth = `${el.clientWidth * 0.1}px`;
  }

  clear(): void {
    this.set([], []);
  }
}

export class HoverSquare {
  private el: HTMLElement;
  private current: Square | undefined;

  constructor(layers: Layers, doc: Document) {
    this.el = doc.createElement('div');
    this.el.classList.add('hover-square');
    this.el.style.visibility = 'hidden';
    this.el.innerHTML =
      '<svg viewBox="0 0 100 100"><rect x="0" y="0" width="100" height="100" stroke="rgba(255, 255, 255, 0.65)" stroke-width="10" fill="none"/></svg>';
    layers.add(this.el, 'hover-square');
  }

  /** Outline colour (arcade tints it with the accent colour of the held piece). */
  tint(color: string | null): void {
    const rect = this.el.querySelector('rect');
    rect?.setAttribute('stroke', color ?? 'rgba(255, 255, 255, 0.65)');
  }

  show(sq: Square): void {
    if (this.current === sq) return;
    this.el.style.visibility = '';
    placeOnSquare(this.el, sq);
    this.current = sq;
  }

  hide(): void {
    this.el.style.visibility = 'hidden';
    this.current = undefined;
  }
}

/** Blink a square: 3 on/off cycles over 500 ms each, then remove. */
export function blinkSquare(
  layers: Layers,
  doc: Document,
  square: Square,
  color: string,
  opts: { interval?: number; opacity?: number; times?: number } = {},
): () => void {
  const { interval = 500, opacity = 0.5, times = 3 } = opts;
  const el = doc.createElement('div');
  el.className = 'highlight';
  el.style.backgroundColor = color;
  el.style.opacity = String(opacity);
  placeOnSquare(el, square);
  layers.add(el, 'blinking-highlights');
  let ticks = 0;
  let visible = true;
  const timer = window.setInterval(() => {
    ticks += 1;
    if (ticks === times * 2) {
      window.clearInterval(timer);
      el.remove();
      return;
    }
    visible = !visible;
    el.style.opacity = visible ? String(opacity) : '0';
  }, interval / 2);
  return () => {
    window.clearInterval(timer);
    el.remove();
  };
}
