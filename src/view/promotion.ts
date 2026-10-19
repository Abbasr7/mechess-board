/**
 * Promotion window: a one-square-wide column anchored at the promotion
 * square's edge of the board, with queen / knight / rook / bishop and a close
 * button at the far end.
 */
import type { Color, PromotionType, Square } from '../types';
import type { Layers } from './layers';

export interface PromotionHandlers {
  onPick(piece: PromotionType): void;
  onClose(): void;
  /** Right mouse button on the window cancels like a click elsewhere would. */
  onRightClick(): void;
}

const PIECES: PromotionType[] = ['q', 'n', 'r', 'b'];
/** Ms after which a closing dynamic window is hidden whatever the transitions did. */
const CLOSE_TIMEOUT = 280;

export class PromotionWindow {
  private el: HTMLElement | null = null;
  private pieceEls = new Map<PromotionType, HTMLElement>();
  private closeBtn: HTMLElement | null = null;
  private handlers: PromotionHandlers | null = null;
  private closeTimer = 0;
  /** The opening transition of the dynamic window is running: the close button ignores presses. */
  private opening = false;
  private closing = false;
  private openTimer = 0;

  constructor(private layers: Layers, private doc: Document) {}

  /** The window element (null until first opened). */
  element(): HTMLElement | null {
    return this.el;
  }

  isOpen(): boolean {
    return !!this.el && this.el.style.display !== 'none';
  }

  private build(): void {
    const el = this.doc.createElement('div');
    el.classList.add('promotion-window');
    this.layers.add(el, 'promotion-window');

    const stop = (e: Event): void => e.stopPropagation();

    const close = this.doc.createElement('i');
    close.className = 'close-button';
    close.textContent = '✕';
    close.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (this.opening) {
        e.preventDefault();
        return;
      }
      this.handlers?.onClose();
    });
    el.appendChild(close);
    this.closeBtn = close;

    for (const p of PIECES) {
      const d = this.doc.createElement('div');
      d.classList.add('promotion-piece');
      d.addEventListener('pointerdown', (e) => {
        stop(e);
        if (e.button === 2) {
          this.handlers?.onRightClick();
          return;
        }
        this.handlers?.onPick(p);
      });
      el.appendChild(d);
      this.pieceEls.set(p, d);
    }
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    // the opening transition is done when the clip-path finishes
    const openingDone = (e: Event): void => {
      if (e.target !== el || (e.type === 'transitionend' && (e as TransitionEvent).propertyName !== 'clip-path')) return;
      this.opening = false;
    };
    el.addEventListener('transitionend', openingDone);
    el.addEventListener('animationend', openingDone);
    el.addEventListener('animationcancel', openingDone);
    // closing is done when the queen has faded out
    el.addEventListener('transitionend', (e) => {
      if (this.closing && e.target === this.pieceEls.get('q') && (e as TransitionEvent).propertyName === 'opacity') this.finishClose();
    });
    this.el = el;
  }

  open(opts: { to: Square; color: Color; flipped: boolean; dynamic: boolean }, handlers: PromotionHandlers): void {
    this.handlers = handlers;
    if (!this.el) this.build();
    const el = this.el!;
    if (this.closing) this.finishClose();

    // column of the target file, counted from the left edge of the screen
    const col = (opts.flipped ? 'hgfedcba' : 'abcdefgh').indexOf(opts.to[0]);
    // the window hangs from the board edge nearest the promotion square
    const top = opts.flipped ? opts.color === 'b' : opts.color === 'w';

    el.classList.toggle('top', top);
    el.classList.toggle('dynamic', opts.dynamic);
    el.style.transform = `translateX(${col * 100}%)`;
    for (const [p, d] of this.pieceEls) d.className = `promotion-piece ${opts.color}${p}`;

    el.style.display = '';
    el.classList.remove('promotion-window--visible');
    void el.offsetHeight; // restart the CSS transition
    if (opts.dynamic) {
      this.opening = true;
      window.clearTimeout(this.openTimer);
      // safety net: no transitionend when animations are off or the page is hidden
      this.openTimer = window.setTimeout(() => (this.opening = false), 700);
    }
    el.classList.add('promotion-window--visible');
  }

  close(): void {
    const el = this.el;
    if (!el) return;
    this.opening = false;
    window.clearTimeout(this.openTimer);
    if (!el.classList.contains('dynamic')) {
      el.classList.remove('promotion-window--visible');
      el.style.display = 'none';
      return;
    }
    this.closing = true;
    el.style.setProperty('--promotion-close-duration', '200ms');
    el.classList.add('closing');
    el.classList.remove('promotion-window--visible');
    window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => this.finishClose(), CLOSE_TIMEOUT);
  }

  private finishClose(): void {
    window.clearTimeout(this.closeTimer);
    this.closing = false;
    if (!this.el) return;
    this.el.style.display = 'none';
    this.el.classList.remove('closing');
  }

  destroy(): void {
    window.clearTimeout(this.closeTimer);
    window.clearTimeout(this.openTimer);
    this.el?.remove();
    this.el = null;
    this.pieceEls.clear();
  }
}
