/**
 * Visual effects ("vfx").
 *
 * Each effect is a small DOM element, `div.vfx.vfx-<type>`, placed on a board
 * square and animated by CSS (see css.ts). Some effects replace the real piece
 * for their duration: they hide it (`hidePiece`) and show their own copy,
 * which is shown again when the effect ends.
 */
import type { Square } from '../types';
import type { LayerName } from '../view/layers';
import { fileOf, rankOf, squareClass } from '../squares';

export type VfxType =
  | 'piece-capture'
  | 'piece-jump'
  | 'piece-throw'
  | 'hand-throw'
  | 'king-check-square'
  | 'king-check'
  | 'piece-trail'
  | 'illegal-move-tap'
  | 'growing-circle'
  | 'piece-flip'
  | 'charge-jump'
  | 'piece-promote'
  | 'promote-ripple';

export interface VfxInput {
  type: VfxType;
  square: Square;
  key?: string;
  /** Remove automatically after this many ms. */
  duration?: number;
  cleanupFn?: () => void;
  data?: Record<string, unknown>;
}

interface VfxEntry {
  type: VfxType;
  key: string;
  square: Square;
  data?: Record<string, unknown>;
  element: HTMLElement;
  cleanupFn?: () => void;
  timer?: number;
}

export interface VfxHost {
  doc: Document;
  /** Board image for effects that show a slice of the board (CSS `url(...)` value). */
  boardImage(): string;
  flipped(): boolean;
  /** Duration of one piece move in ms (trail speed). */
  moveDuration(): number;
  addToLayer(el: Node, layer: LayerName): void;
  /** Hide the real piece on `square`; returns the function that shows it again. */
  hidePiece(square: Square): () => void;
}

const LAYER: Record<VfxType, 'vfx-below' | 'vfx-above'> = {
  'piece-capture': 'vfx-below',
  'piece-jump': 'vfx-above',
  'piece-throw': 'vfx-above',
  'hand-throw': 'vfx-above',
  'king-check-square': 'vfx-below',
  'king-check': 'vfx-above',
  'piece-trail': 'vfx-below',
  'illegal-move-tap': 'vfx-below',
  'growing-circle': 'vfx-below',
  'piece-flip': 'vfx-above',
  'piece-promote': 'vfx-above',
  'promote-ripple': 'vfx-below',
  'charge-jump': 'vfx-above',
};

const rand = (): number => Math.random();

function pieceEl(doc: Document, piece: string): HTMLElement {
  const el = doc.createElement('div');
  el.classList.add('element', piece);
  return el;
}

/** Fire `fn` once when the CSS animation `name` ends on `el` (or after `fallbackMs` where animations do not run). */
function onAnimationEnd(el: HTMLElement, name: string | null, fn: () => void, fallbackMs: number): () => void {
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    el.removeEventListener('animationend', handler);
    el.removeEventListener('animationcancel', handler);
    window.clearTimeout(timer);
    fn();
  };
  const handler = (e: Event): void => {
    if (name === null || (e as AnimationEvent).animationName === name) finish();
  };
  el.addEventListener('animationend', handler);
  el.addEventListener('animationcancel', handler);
  const timer = window.setTimeout(finish, fallbackMs);
  return finish;
}

export class VfxManager {
  private entries = new Map<string, VfxEntry>();
  private counter = 0;

  constructor(private host: VfxHost) {}

  count(): number {
    return this.entries.size;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  add(input: VfxInput): string {
    const key = input.key ?? `vfx|${input.square}|${input.type}|${this.counter++}`;
    const existing = this.entries.get(key);
    if (existing) this.remove(key);
    const el = this.host.doc.createElement('div');
    el.classList.add('vfx', `vfx-${input.type}`, squareClass(input.square));
    const entry: VfxEntry = { type: input.type, key, square: input.square, data: input.data, element: el, cleanupFn: input.cleanupFn };
    this.entries.set(key, entry);
    this.build(entry);
    this.host.addToLayer(entry.element, LAYER[input.type]);
    if (input.duration && input.duration > 0) entry.timer = window.setTimeout(() => this.remove(key), input.duration);
    return key;
  }

  update(key: string, data?: Record<string, unknown>): void {
    const e = this.entries.get(key);
    if (!e) return;
    if (e.type === 'piece-jump') this.randomiseJump(e.element.querySelector('.element') as HTMLElement | null, e.square);
    else if (e.type === 'charge-jump' && data?.phase === 'jump') this.chargeJump(e);
  }

  remove(key: string): void {
    const e = this.entries.get(key);
    if (!e) return;
    if (e.timer) window.clearTimeout(e.timer);
    e.cleanupFn?.();
    e.element.remove();
    this.entries.delete(key);
  }

  removeAll(): void {
    for (const k of [...this.entries.keys()]) this.remove(k);
  }

  removeByPredicate(pred: (e: { type: VfxType; key: string; square: Square }) => boolean): void {
    for (const e of [...this.entries.values()]) if (pred(e)) this.remove(e.key);
  }

  // ── builders ────────────────────────────────────────────────────────────

  private build(e: VfxEntry): void {
    const d = this.host.doc;
    const data = e.data ?? {};
    const done = (): void => this.remove(e.key);
    switch (e.type) {
      case 'piece-capture': {
        const el = pieceEl(d, String(data.piece));
        onAnimationEnd(el, 'vfx-capture-fade', done, 500);
        e.element.appendChild(el);
        break;
      }
      case 'growing-circle': {
        const c = d.createElement('div');
        c.classList.add('growing-circle');
        c.style.setProperty('--growing-circle-color', String(data.color ?? '#000000'));
        c.style.setProperty('--growing-circle-initial-opacity', String(data.initialOpacity ?? 0.07));
        onAnimationEnd(c, 'vfx-circle-expand', done, 600);
        e.element.appendChild(c);
        break;
      }
      case 'piece-trail': {
        const to = String(data.targetSquare);
        const dx = fileOf(to) - fileOf(e.square);
        const dy = rankOf(e.square) - rankOf(to);
        const dist = Math.hypot(dx, dy);
        const seg = d.createElement('div');
        if (dist === 0) {
          e.element.appendChild(seg);
          break;
        }
        const angle = Math.atan2(dy, dx);
        const color = String(data.color ?? '#f0f0f0');
        seg.classList.add('trail-segment');
        seg.style.setProperty('--piece-move-duration', `${this.host.moveDuration()}ms`);
        seg.style.setProperty('--trail-width', `${dist * 100}%`);
        seg.style.setProperty('--rotation', `${this.host.flipped() ? angle + Math.PI : angle}rad`);
        seg.style.background = `linear-gradient(to right, ${color}00 0%, ${color}10 50%, ${color}52 100%)`;
        onAnimationEnd(seg, 'vfx-trail-fadeout', done, this.host.moveDuration() + 400);
        e.element.appendChild(seg);
        const raf = requestAnimationFrame(() => seg.classList.add('animating'));
        e.cleanupFn = ((prev) => () => {
          cancelAnimationFrame(raf);
          prev?.();
        })(e.cleanupFn);
        break;
      }
      case 'king-check-square': {
        const sq = d.createElement('div');
        sq.classList.add('square');
        sq.style.setProperty('--bg-image', this.host.boardImage());
        sq.style.setProperty('--file', `${(fileOf(e.square) - 1) * (100 / 7)}%`);
        sq.style.setProperty('--rank', `${(8 - rankOf(e.square)) * (100 / 7)}%`);
        const ov = d.createElement('div');
        ov.classList.add('color-overlay');
        sq.appendChild(ov);
        e.element.appendChild(sq);
        break;
      }
      case 'king-check': {
        const el = pieceEl(d, String(data.piece));
        const release = this.host.hidePiece(e.square);
        let finished = false;
        const finish = (): void => {
          if (finished) return;
          finished = true;
          release();
          this.remove(e.key);
        };
        e.cleanupFn = finish;
        onAnimationEnd(el, 'king-check-shrink', finish, 1500);
        e.element.appendChild(el);
        break;
      }
      case 'illegal-move-tap': {
        const ov = d.createElement('div');
        ov.classList.add('illegal-move-tap-overlay');
        const circle = d.createElement('div');
        circle.classList.add('illegal-move-tap-circle');
        onAnimationEnd(ov, 'illegal-move-tap-overlay-fade', done, 800);
        e.element.appendChild(ov);
        e.element.appendChild(circle);
        break;
      }
      case 'piece-promote': {
        const el = pieceEl(d, String(data.piece));
        const release = this.host.hidePiece(e.square);
        e.cleanupFn = release;
        onAnimationEnd(el, 'piece-promote-scale', done, 300);
        e.element.appendChild(el);
        break;
      }
      case 'promote-ripple': {
        const a = d.createElement('div');
        a.classList.add('circle', 'circle-out-cubic');
        const b = d.createElement('div');
        b.classList.add('circle', 'circle-in-out-back');
        onAnimationEnd(a, 'promote-ripple-fade', done, 450);
        e.element.appendChild(a);
        e.element.appendChild(b);
        break;
      }
      case 'piece-jump': {
        const el = pieceEl(d, String(data.piece));
        this.randomiseJump(el, e.square);
        el.addEventListener('animationend', (ev) => {
          if ((ev as AnimationEvent).animationName === 'piece-jump') {
            el.classList.remove('piece-jump-and-wiggle', 'piece-jump-and-fall-over', 'fallen-piece-jump');
            el.classList.add('piece-fall-and-rest');
          }
        });
        e.element.appendChild(el);
        break;
      }
      case 'piece-throw': {
        const el = pieceEl(d, String(data.piece));
        const throwMs = Number(data.throwDuration ?? 1000);
        const delay = Number(data.delay ?? 0);
        el.style.setProperty('--throw-duration', `${throwMs}ms`);
        el.style.setProperty('--initial-delay', `${delay}ms`);
        const release = this.host.hidePiece(e.square);
        this.randomiseThrow(el, data);
        e.cleanupFn = release;
        e.timer = window.setTimeout(() => {
          if (data.disablePieceReset) {
            e.cleanupFn = undefined;
            e.element.remove();
            this.entries.delete(e.key);
            return;
          }
          this.remove(e.key);
        }, delay + throwMs);
        e.element.appendChild(el);
        break;
      }
      case 'hand-throw': {
        const url = String(data.url ?? '');
        const img = d.createElement('img');
        img.classList.add('hand-throw-image');
        img.src = url;
        img.alt = '';
        const appear = Number(data.appearDurationMs ?? 150);
        const throwMs = Number(data.throwDurationMs ?? 200);
        const fade = Number(data.fadeDurationMs ?? 800);
        img.style.setProperty('--hand-throw-appear-duration', `${appear}ms`);
        img.style.setProperty('--hand-throw-throw-duration', `${throwMs}ms`);
        img.style.setProperty('--hand-throw-fade-duration', `${fade}ms`);
        img.style.setProperty('--hand-throw-appear-rotation', `${Number(data.appearRotationDeg ?? 90)}deg`);
        img.style.setProperty('--hand-throw-throw-scale-x', String(data.throwScaleX ?? 1.5));
        img.style.setProperty('--hand-throw-throw-scale-y', String(data.throwScaleY ?? 1.5));
        img.style.setProperty('--hand-throw-throw-dy', `${Number(data.throwDyPercent ?? -8)}%`);
        img.classList.add('hand-throw-animate');
        e.timer = window.setTimeout(done, appear + throwMs + fade);
        e.element.appendChild(img);
        break;
      }
      case 'piece-flip': {
        const el = pieceEl(d, String(data.piece));
        const release = this.host.hidePiece(e.square);
        e.element.classList.add(rand() < 0.5 ? 'flip-cw' : 'flip-ccw');
        let finished = false;
        const finish = (): void => {
          if (finished) return;
          finished = true;
          release();
          (data.onFlipComplete as (() => void) | undefined)?.();
          this.remove(e.key);
        };
        e.cleanupFn = release;
        onAnimationEnd(el, 'piece-flip-scale', finish, 1100);
        e.element.appendChild(el);
        break;
      }
      case 'charge-jump': {
        const el = pieceEl(d, String(data.piece));
        const release = this.host.hidePiece(e.square);
        e.cleanupFn = release;
        onAnimationEnd(el, 'charge-jump-scale', () => {
          this.remove(e.key);
          (data.onFidgetComplete as (() => void) | undefined)?.();
        }, 1000 + 1600);
        e.element.appendChild(el);
        break;
      }
    }
  }

  /** Jump height / direction for the board-slam jump (centre pieces jump later than edge pieces). */
  private randomiseJump(el: HTMLElement | null, square: Square): void {
    if (!el) return;
    const fall = el.style.getPropertyValue('--fall-deg') || '0deg';
    el.style.setProperty('--initial-rotation', fall);
    const f = fileOf(square);
    const r = rankOf(square);
    const dist = Math.sqrt((f - 4.5) ** 2 + (r - 4.5) ** 2);
    el.style.setProperty('--initial-delay', `${(dist / (3.5 * Math.SQRT2)) * 0.2}s`);
    const jumpY = 200 * 0.1 * rand() + 100 * (0.6 - 0.1);
    const jumpX = 200 * 0.1 * rand() - 100 * 0.1;
    el.style.setProperty('--jump-y', `-${jumpY}%`);
    el.style.setProperty('--jump-x', `${jumpX}%`);
    el.classList.remove('piece-jump-and-wiggle', 'piece-jump-and-fall-over', 'piece-fall-and-rest', 'fallen-piece-jump');
    if (fall !== '0deg') {
      el.style.setProperty('--fall-deg', fall);
      el.classList.add('fallen-piece-jump');
      return;
    }
    if (rand() < 0.8) {
      const w = (rand() < 0.5 ? 1 : -1) * (rand() * 4 + 6);
      el.style.setProperty('--wiggle-deg', `${w}deg`);
      el.classList.add('piece-jump-and-wiggle');
    } else {
      const fd = (rand() < 0.5 ? 1 : -1) * 90;
      el.style.setProperty('--fall-deg', `${fd}deg`);
      el.classList.add('piece-jump-and-fall-over');
    }
  }

  /** Throw parameters: random spin and a high lob unless explicit values are given. */
  private randomiseThrow(el: HTMLElement, data: Record<string, unknown>): void {
    el.style.setProperty('--initial-rotation', '0deg');
    const k = 0.3;
    const lob = 200 * k * rand() + 100 * (8 - k);
    const sideways = rand() * 1200 - 600;
    const x = data.throwX == null ? `${sideways}%` : `${data.throwX}%`;
    const y = data.throwY == null ? `-${lob}%` : `${data.throwY}%`;
    const spin = 270 + rand() * 270;
    el.style.setProperty('--throw-y', y);
    el.style.setProperty('--throw-x', x);
    el.style.setProperty('--spin-deg', `${(rand() < 0.5 ? 1 : -1) * spin}deg`);
    el.style.setProperty('--scale', String(data.scale ?? 1.5));
    el.classList.add('piece-throw-and-spin');
  }

  /** Let a held "charge" piece leap: height grows with how far it was compressed. */
  private chargeJump(e: VfxEntry): void {
    const el = e.element.querySelector('.element') as HTMLElement | null;
    if (!el) return;
    const sy = Number(/^[\d.]+\s+([\d.]+)$/.exec(getComputedStyle(el).scale)?.[1] ?? 1);
    const compress = 0.6;
    const t = Math.min((1 - sy) / (1 - compress), 1);
    const height = 20 + t * (150 - 20);
    e.element.style.setProperty('--start-compression', String(sy));
    e.element.style.setProperty('--jump-height', `-${height}%`);
    el.classList.add('jumping');
  }
}
