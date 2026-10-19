/**
 * Effects: the little classification badges drawn on a square (Brilliant,
 * Blunder, Checkmate, …), used by game review and the end-of-game markers.
 *
 * Two looks, like the original:
 *  - **static** – a coloured disc with a glyph in the top-right corner of the
 *    square;
 *  - **animated** – the square flashes in the badge colour, a big glyph grows
 *    in the middle with a pill of text, then both settle into the corner badge.
 *    Optionally the finished badge then flies (`flyOut`) to a point on the page
 *    (e.g. an accuracy counter).
 *
 * One effect per square; a new effect replaces the old one. Badges on the edge
 * of the board are "tucked" inwards so they are never cut off. DOM order follows
 * the board (upper rows first) so a badge overlaps the squares above and to its
 * right, never its own neighbours' badges.
 *
 * The glyphs are drawn with plain SVG text and the colours are the ones the
 * original uses for each classification; no artwork is copied.
 */
import type { Square } from '../types';
import { fileOf, rankOf } from '../squares';
import { placeOnSquare } from './pieces';

export type EffectType =
  | 'Abandon' | 'Alternative' | 'BestMove' | 'Blunder' | 'Book' | 'Brilliant' | 'BughouseWhite' | 'BughouseBlack'
  | 'CheckmateBlack' | 'CheckmateWhite' | 'Correct' | 'Critical' | 'Custom' | 'DefeatBlack' | 'DefeatWhite'
  | 'Deviation' | 'DrawBlack' | 'DrawWhite' | 'Excellent' | 'FastWin' | 'Forced' | 'FreePiece' | 'Gamechanger'
  | 'Good' | 'GreatFind' | 'Inaccuracy' | 'Incorrect' | 'Mate' | 'Miss' | 'MissedWin' | 'Mistake' | 'ResignBlack'
  | 'ResignWhite' | 'Sharp' | 'Skills' | 'Stalemate' | 'Takeback' | 'Threat' | 'TimeoutBlack' | 'TimeoutWhite'
  | 'Tricky' | 'Undo' | 'Winner' | 'WinnerWhite' | 'Interesting' | 'Warning' | 'Equal';

export interface EffectSpec {
  square: Square;
  type: EffectType;
  /** Play the flash / grow-in / settle animation instead of just showing the badge. */
  animated?: boolean;
  /** Animated only: after settling, a copy of the badge flies to this point (px, board coordinates). */
  flyOut?: { target: { x: number; y: number } };
  /** Replace the glyph with other text (e.g. `"+3"`). */
  iconText?: string;
  /** SVG path data (`viewBox="0 0 20 20"`) drawn instead of the glyph; used by type `Custom`. */
  path?: string;
  /** Static only: glyph size, a CSS length (default `100%`). */
  size?: string;
  /** Animated only: text of the pill (default: the label of the type). */
  pillText?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  pillBackgroundColor?: string;
  pillForegroundColor?: string;
  /** `'normal'` (default), `'large'` or any CSS length relative to the square. */
  badgeSize?: 'normal' | 'large' | string;
}

export interface EffectEvents {
  /** The animated badge finished settling into the corner. */
  'effect-animation-end': { effect: EffectSpec };
  /** The settled badge was replaced by a copy that flies away. */
  'effect-flyout-begin': EffectSpec;
  'effect-flyout-end': EffectSpec;
  'effect-fade-out-end': { square: Square };
}

export interface EffectsHost {
  doc: Document;
  root: HTMLElement;
  /** End of the effects layer: new badges are inserted before it. */
  placeholder(): Comment;
  flipped(): boolean;
  squareSize(): number;
  labels(): Partial<Record<EffectType, string>>;
  fadeIn(): boolean;
  emit<K extends keyof EffectEvents>(type: K, payload: EffectEvents[K]): void;
}

interface Look {
  /** Badge colour. */
  color: string;
  /** Square flash colour (rgb triple, drawn at 80 % alpha). */
  flash?: string;
  glyph: string;
  /** Default pill text; falls back to the type name. */
  label?: string;
}

const RED = '#e02828';
const GREY = '#555351';
const LOOKS: Record<EffectType, Look> = {
  Brilliant: { color: '#26c2a3', flash: '27,172,166', glyph: '!!', label: 'Brilliant!' },
  GreatFind: { color: '#749bbf', flash: '92,139,176', glyph: '!', label: 'Great!' },
  BestMove: { color: '#81b64c', flash: '151,189,77', glyph: '★', label: 'Best Move' },
  Inaccuracy: { color: '#f7c631', flash: '247,192,69', glyph: '?!', label: 'Inaccuracy' },
  Miss: { color: '#ff7769', flash: '255,119,105', glyph: '×', label: 'Miss' },
  Mistake: { color: '#ffa459', flash: '229,143,42', glyph: '?', label: 'Mistake' },
  Blunder: { color: '#fa412d', flash: '202,52,49', glyph: '??', label: 'Blunder' },
  DrawBlack: { color: GREY, glyph: '=', label: 'Draw' },
  DrawWhite: { color: GREY, glyph: '=', label: 'Draw' },
  Stalemate: { color: GREY, glyph: '=', label: 'Stalemate' },
  CheckmateBlack: { color: RED, glyph: '#', label: 'Checkmate' },
  CheckmateWhite: { color: RED, glyph: '#', label: 'Checkmate' },
  Mate: { color: RED, glyph: '#', label: 'Checkmate' },
  ResignBlack: { color: RED, glyph: '⚑', label: 'Resign' },
  ResignWhite: { color: RED, glyph: '⚑', label: 'Resign' },
  TimeoutBlack: { color: RED, glyph: 'T', label: 'Timeout' },
  TimeoutWhite: { color: RED, glyph: 'T', label: 'Timeout' },
  Abandon: { color: RED, glyph: '⏻', label: 'Abandon' },
  BughouseWhite: { color: RED, glyph: '#', label: 'Partner Loss' },
  BughouseBlack: { color: RED, glyph: '#', label: 'Partner Loss' },
  DefeatBlack: { color: RED, glyph: '#' },
  DefeatWhite: { color: RED, glyph: '#' },
  Winner: { color: '#83b84f', glyph: '♛', label: 'Winner' },
  WinnerWhite: { color: '#83b84f', glyph: '♛', label: 'Winner' },
  Skills: { color: '#008cd1', glyph: '★' },
  Tricky: { color: '#7a66f4', glyph: '!?', label: 'Tricky' },
  Book: { color: '#a88865', glyph: 'B' },
  Good: { color: '#95b776', glyph: '✓' },
  Excellent: { color: '#81b64c', glyph: '✓✓' },
  Correct: { color: '#81b64c', glyph: '✓' },
  Incorrect: { color: '#fa412d', glyph: '✗' },
  Forced: { color: '#96af8b', glyph: '→' },
  FreePiece: { color: '#96af8b', glyph: '+' },
  Critical: { color: '#5c8bb0', glyph: '!' },
  Gamechanger: { color: '#7a66f4', glyph: '⚡' },
  Sharp: { color: '#7a66f4', glyph: '⚔' },
  Interesting: { color: '#5c8bb0', glyph: '!?' },
  Warning: { color: '#f7c631', glyph: '!' },
  Threat: { color: '#fa412d', glyph: '!' },
  Alternative: { color: '#96af8b', glyph: '↔' },
  Deviation: { color: '#96af8b', glyph: '↯' },
  Equal: { color: GREY, glyph: '=' },
  FastWin: { color: '#83b84f', glyph: '»' },
  MissedWin: { color: '#ff7769', glyph: '×' },
  Takeback: { color: GREY, glyph: '↶' },
  Undo: { color: GREY, glyph: '↶' },
  Custom: { color: '#5c8bb0', glyph: '•' },
};

export const BADGE_SIZE = { normal: '18.75%', large: '24.5%' } as const;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Edge squares are tucked inwards: rank 8 / file h at the top-right (mirrored when flipped). */
function tuckOf(square: Square, flipped: boolean): { top: boolean; right: boolean } {
  return { top: rankOf(square) === (flipped ? 1 : 8), right: fileOf(square) === (flipped ? 1 : 8) };
}

/** Upper rows first, then from the right: a badge overlaps what is above and to the right of it. */
function compare(a: Square, b: Square, flipped: boolean): number {
  const i = flipped ? 1 : -1;
  if (a[1] !== b[1]) return a[1] > b[1] ? i : -i;
  return a[0] > b[0] ? i : -i;
}

interface Entry {
  spec: EffectSpec;
  els: HTMLElement[];
  timers: number[];
}

export class Effects {
  private entries = new Map<Square, Entry>();
  private flying = new Set<HTMLElement>();
  private destroyed = false;

  constructor(private host: EffectsHost) {}

  // ── API ─────────────────────────────────────────────────────────────────

  all(): EffectSpec[] {
    return [...this.entries.values()].map((e) => e.spec);
  }

  get(square: Square): EffectSpec | undefined {
    return this.entries.get(square)?.spec;
  }

  add(spec: EffectSpec): void {
    if (this.destroyed) return;
    this.remove(spec.square);
    const animated = !!spec.animated;
    const els = animated ? this.buildAnimated(spec) : [this.buildStatic(spec)];
    const entry: Entry = { spec, els, timers: [] };
    this.entries.set(spec.square, entry);
    const before = this.insertionPoint(spec.square);
    for (const el of els) this.host.root.insertBefore(el, before);
    if (animated) this.watch(entry, els[0]);
  }

  addAll(specs: EffectSpec[]): void {
    specs.forEach((s) => this.add(s));
  }

  remove(square: Square): void {
    const e = this.entries.get(square);
    if (!e) return;
    this.entries.delete(square);
    e.timers.forEach((t) => window.clearTimeout(t));
    e.els.forEach((el) => el.remove());
  }

  clear(): void {
    [...this.entries.keys()].forEach((sq) => this.remove(sq));
  }

  /** Fade the badge on `square` out and remove it. Rejects when there is no badge there. */
  fadeOut(square: Square, opts: { scale?: boolean } = {}): Promise<void> {
    const e = this.entries.get(square);
    if (!e) return Promise.reject(new Error(`Effect at ${square} doesn't exist`));
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        if (this.entries.get(square) === e) this.remove(square);
        this.host.emit('effect-fade-out-end', { square });
        resolve();
      };
      for (const el of e.els) {
        if (opts.scale) el.querySelector('.icon-background')?.classList.add('scale-animation');
        el.classList.add('fade-out');
        el.addEventListener('animationend', (ev) => {
          if ((ev as AnimationEvent).animationName === 'reboard-fx-fade-out') finish();
        });
      }
      // no animationend when animations are off or the page is hidden
      e.timers.push(window.setTimeout(finish, 400));
    });
  }

  /** The board was flipped: tucked badges and DOM order follow. */
  flipChanged(): void {
    const flipped = this.host.flipped();
    const sorted = [...this.entries.entries()];
    for (const [sq, e] of sorted) {
      const t = tuckOf(sq, flipped);
      for (const el of e.els) {
        el.classList.toggle('tuck-top', t.top);
        el.classList.toggle('tuck-right', t.right);
      }
    }
    sorted.sort((a, b) => compare(a[0], b[0], flipped));
    const end = this.host.placeholder();
    for (const [, e] of sorted) for (const el of e.els) this.host.root.insertBefore(el, end);
  }

  destroy(): void {
    this.destroyed = true;
    this.clear();
    this.flying.forEach((el) => el.remove());
    this.flying.clear();
  }

  // ── building ────────────────────────────────────────────────────────────

  private look(spec: EffectSpec): Look {
    return LOOKS[spec.type] ?? LOOKS.Custom;
  }

  private insertionPoint(square: Square): Node {
    const flipped = this.host.flipped();
    const keys = [...this.entries.keys()].filter((k) => k !== square).sort((a, b) => compare(a, b, flipped));
    const next = keys.find((k) => compare(square, k, flipped) < 0);
    return (next && this.entries.get(next)?.els[0]) || this.host.placeholder();
  }

  private icon(spec: EffectSpec, className: string, size: string): SVGSVGElement {
    const doc = this.host.doc;
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', className);
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.style.overflow = 'visible';
    const fill = spec.foregroundColor ?? '#fff';
    if (spec.type === 'Custom' && spec.path) {
      const p = doc.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', spec.path);
      p.setAttribute('fill', fill);
      svg.appendChild(p);
      return svg;
    }
    const text = spec.iconText ?? this.look(spec).glyph;
    const t = doc.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', '10');
    t.setAttribute('y', text.length > 1 ? '14' : '14.6');
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('font-family', 'Arial, Helvetica, sans-serif');
    t.setAttribute('font-weight', '800');
    t.setAttribute('font-size', text.length > 2 ? '8' : text.length > 1 ? '11' : '15');
    t.setAttribute('fill', fill);
    t.textContent = text;
    svg.appendChild(t);
    return svg;
  }

  private buildStatic(spec: EffectSpec): HTMLElement {
    const el = this.host.doc.createElement('div');
    el.classList.add('effect', spec.type.toLowerCase());
    placeOnSquare(el, spec.square);
    el.style.backgroundColor = spec.backgroundColor ?? this.look(spec).color;
    el.appendChild(this.icon(spec, 'icon', spec.size ?? '100%'));
    const t = tuckOf(spec.square, this.host.flipped());
    if (t.top) el.classList.add('tuck-top');
    if (t.right) el.classList.add('tuck-right');
    if (this.host.fadeIn()) el.classList.add('fade-in');
    return el;
  }

  private buildAnimated(spec: EffectSpec): HTMLElement[] {
    const doc = this.host.doc;
    const look = this.look(spec);
    const color = spec.backgroundColor ?? look.color;
    const el = doc.createElement('div');
    el.classList.add('animated-effect', spec.type.toLowerCase());
    placeOnSquare(el, spec.square);
    el.style.setProperty('--effect-square', `${this.host.squareSize()}px`);
    el.style.setProperty('--effect-badge', BADGE_SIZE[spec.badgeSize as 'normal' | 'large'] ?? spec.badgeSize ?? BADGE_SIZE.normal);
    el.style.setProperty('--effect-color', spec.pillBackgroundColor ?? color);
    if (spec.backgroundColor) el.style.setProperty('--effect-opacity', '0.8');
    const t = tuckOf(spec.square, this.host.flipped());
    if (t.top) el.classList.add('tuck-top');
    if (t.right) el.classList.add('tuck-right');

    const flash = doc.createElement('div');
    flash.classList.add('square', spec.type.toLowerCase());
    flash.style.backgroundColor = spec.backgroundColor ?? (look.flash ? `rgba(${look.flash},0.8)` : withAlpha(color, 0.8));
    el.appendChild(flash);

    el.appendChild(this.icon(spec, 'icon slide', '70%'));

    const badge = doc.createElement('div');
    badge.classList.add('icon-background', spec.type.toLowerCase());
    el.appendChild(badge);

    const pill = doc.createElement('div');
    pill.classList.add('text');
    pill.textContent = spec.pillText ?? this.host.labels()[spec.type] ?? look.label ?? spec.type;
    pill.style.color = spec.pillForegroundColor ?? color;
    if (spec.pillBackgroundColor) pill.style.backgroundColor = spec.pillBackgroundColor;
    el.appendChild(pill);
    return [el];
  }

  // ── animation hooks ─────────────────────────────────────────────────────

  private watch(entry: Entry, el: HTMLElement): void {
    el.addEventListener('animationend', (ev) => {
      if ((ev as AnimationEvent).animationName !== 'reboard-fx-badge') return;
      this.host.emit('effect-animation-end', { effect: entry.spec });
      const target = entry.spec.flyOut?.target;
      if (!target) return;
      entry.timers.push(window.setTimeout(() => this.flyOut(entry, el, target), 50));
    });
  }

  private flyOut(entry: Entry, badge: HTMLElement, target: { x: number; y: number }): void {
    if (this.destroyed || this.entries.get(entry.spec.square) !== entry) return;
    const { spec } = entry;
    const doc = this.host.doc;
    const flipped = this.host.flipped();
    const size = this.host.squareSize();
    const t = tuckOf(spec.square, flipped);
    const col = flipped ? 8 - fileOf(spec.square) : fileOf(spec.square) - 1;
    const row = flipped ? rankOf(spec.square) - 1 : 8 - rankOf(spec.square);
    const fly = doc.createElement('div');
    fly.classList.add('flying-points', spec.type.toLowerCase());
    if (t.top) fly.classList.add('tuck-top');
    if (t.right) fly.classList.add('tuck-right');
    fly.style.backgroundColor = spec.pillBackgroundColor ?? spec.backgroundColor ?? this.look(spec).color;
    fly.style.setProperty('--effect-badge', badge.style.getPropertyValue('--effect-badge'));
    fly.style.setProperty('--fly-x', `${size * (col + 1) + (t.right ? 0 : -0.05 * size)}px`);
    fly.style.setProperty('--fly-y', `${size * row + (t.top ? 0 : 0.05 * size)}px`);
    fly.style.setProperty('--target-x', `${target.x}px`);
    fly.style.setProperty('--target-y', `${target.y}px`);
    const icon = this.icon(spec, 'icon', `${size * 0.7 * 0.55}px`);
    fly.appendChild(icon);
    fly.addEventListener('animationend', (ev) => {
      if ((ev as AnimationEvent).animationName !== 'reboard-fx-fly') return;
      fly.remove();
      this.flying.delete(fly);
      this.host.emit('effect-flyout-end', spec);
    });
    this.flying.add(fly);
    this.host.root.insertBefore(fly, badge);
    // the settled badge is replaced by the flying copy
    this.remove(spec.square);
    this.host.emit('effect-flyout-begin', spec);
  }
}

function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export const EFFECT_COLORS: Readonly<Record<EffectType, string>> = Object.fromEntries(
  (Object.keys(LOOKS) as EffectType[]).map((k) => [k, LOOKS[k].color]),
) as Record<EffectType, string>;

export const EFFECTS_CSS = `
.effect{background-clip:content-box;border-radius:50%;box-sizing:border-box;height:12.5%;left:5.5%;padding:3.75%;pointer-events:none;position:absolute;top:-5.5%;width:12.5%;z-index:1}
.effect.tuck-right{margin-left:-2%}
.effect.tuck-top{margin-top:2%}
.effect svg{display:block;height:100%;overflow:visible;width:100%}
.effect.fade-in{animation:reboard-fx-fade-in .15s cubic-bezier(0,0,.4,1) forwards}
.effect.fade-out,.animated-effect.fade-out{animation:reboard-fx-fade-out .3s cubic-bezier(0,0,.4,1) forwards}
.animated-effect{--first:.3s;--second:.3s;--wait:.7s;--effect-square:80px;--effect-badge:18.75%;--effect-color:#000;--x:95%;--y:5%;--text-x:var(--x);--text-y:var(--y);--text-tx:-50%;--text-ty:-50%;--text-origin:center center;--icon-start:62.5%;box-sizing:border-box;color:#000;height:12.5%;left:0;pointer-events:none;position:absolute;top:0;width:12.5%;z-index:1}
.animated-effect.tuck-top{--y:var(--effect-badge);--text-y:calc(var(--effect-square) * .18)}
.animated-effect.tuck-right{--x:calc(100% - var(--effect-badge));--text-x:100%;--text-tx:-100%;--text-origin:100% center}
.animated-effect .square{animation:reboard-fx-sq-in var(--first) forwards,reboard-fx-sq-out var(--second) calc(var(--first) + var(--wait)) forwards;height:100%;opacity:0;position:absolute;width:100%}
.animated-effect .icon{animation:reboard-fx-icon-in var(--first) forwards,reboard-fx-icon-corner var(--second) calc(var(--first) + var(--wait)) forwards;filter:drop-shadow(0 1px 0 rgba(0,0,0,.35));left:50%;opacity:0;position:absolute;top:var(--icon-start);transform:translate(-50%,-50%);z-index:2}
.animated-effect .icon-background{animation:reboard-fx-badge var(--second) calc(var(--first) + var(--wait)) forwards;background-color:var(--effect-color);border-radius:50%;box-shadow:0 1px rgba(0,0,0,.35);left:var(--x);opacity:0;pointer-events:none;position:absolute;top:var(--y);transform:translate(-50%,-50%) scale(var(--icon-bg-scale,1));transition:transform .3s cubic-bezier(0,0,.4,1);z-index:1}
.animated-effect .icon-background.scale-animation{--icon-bg-scale:2}
.animated-effect .text{animation:reboard-fx-text-in var(--first) forwards,reboard-fx-text-out var(--second) calc(var(--first) + var(--wait)) forwards;background-color:#fff;border-radius:500px;box-shadow:0 1px rgba(0,0,0,.35);font-size:calc(var(--effect-square) * .218);font-weight:700;left:var(--text-x);line-height:calc(var(--effect-square) * .364);opacity:0;padding:0 calc(var(--effect-square) * .17);pointer-events:none;position:absolute;top:var(--text-y);transform:translate(var(--text-tx),var(--text-ty));transform-origin:var(--text-origin);white-space:nowrap;z-index:1}
.flying-points{--fly-tx:-50%;--fly-ty:-50%;align-items:center;animation:reboard-fx-fly .5s cubic-bezier(.5,0,.8,0) 50ms forwards;border-radius:50%;box-shadow:0 1px rgba(0,0,0,.35);color:#fff;display:flex;height:calc(var(--effect-badge) * .25);justify-content:center;left:var(--fly-x);pointer-events:none;position:absolute;top:var(--fly-y);transform:translate(var(--fly-tx),var(--fly-ty));width:calc(var(--effect-badge) * .25);z-index:2}
.flying-points.tuck-top{--fly-ty:0%}
.flying-points.tuck-right{--fly-tx:-100%}
.flying-points .icon{filter:drop-shadow(0 1px 0 rgba(0,0,0,.35));flex:none}
@keyframes reboard-fx-fade-in{0%{opacity:0}to{opacity:1}}
@keyframes reboard-fx-fade-out{0%{opacity:1}to{opacity:0}}
@keyframes reboard-fx-sq-in{0%{opacity:0}to{opacity:var(--effect-opacity,1)}}
@keyframes reboard-fx-sq-out{0%{opacity:var(--effect-opacity,1)}to{opacity:0}}
@keyframes reboard-fx-icon-in{0%{opacity:0;transform:translate(-50%,-50%) scale(.4)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
@keyframes reboard-fx-icon-corner{0%{left:50%;opacity:1;top:var(--icon-start);transform:translate(-50%,-50%)}to{left:var(--x);opacity:1;top:calc(var(--y) + 1%);transform:translate(-50%,-50%) scale(.55)}}
@keyframes reboard-fx-text-in{0%{opacity:0;top:calc(var(--text-y) + 20%)}to{opacity:1;top:var(--text-y)}}
@keyframes reboard-fx-text-out{0%{opacity:1;transform:translate(var(--text-tx),var(--text-ty))}to{opacity:0;transform:translate(var(--text-tx),var(--text-ty)) scaleX(0)}}
@keyframes reboard-fx-badge{0%{opacity:0;padding:var(--effect-badge) 40%}to{opacity:1;padding:var(--effect-badge)}}
@keyframes reboard-fx-fly{0%{left:var(--fly-x);opacity:1;top:var(--fly-y);transform:translate(var(--fly-tx),var(--fly-ty)) rotate(0)}to{left:var(--target-x);opacity:.2;top:var(--target-y);transform:translate(var(--fly-tx),var(--fly-ty)) rotate(90deg)}}
`;
