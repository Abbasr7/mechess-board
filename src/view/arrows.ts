/**
 * Arrow overlay. Arrows live in a 100×100 viewBox (one square = 12.5 units),
 * are drawn pointing "down" and then rotated about the origin square.
 * Knight moves get the characteristic L-shaped arrow (two squares along the
 * long leg, one across).
 *
 * Two optional behaviours from the original:
 *  - **animated** arrows grow out of the origin square over 400 ms (ease-out,
 *    fading in) and then keep "breathing": the shaft contracts to just past
 *    the origin square and re-extends on a shared 1.4 s cycle;
 *  - **pointer finger** arrows are not arrows at all but a hand that fades in
 *    on the origin square, glides to the target (314 ms per square), fades
 *    out and repeats after a short pause.
 */
import type { Square } from '../types';
import type { Layers } from './layers';
import { squareCenter } from '../squares';
import { inOutQuad, outQuad } from '../fx/easing';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SQUARE = 12.5;

/** Arrow proportions as percentages of the board width. */
const SHAPE = { headHeight: 4.5, headWidth: 6.5, tailPadding: 4.5, width: 2.75 };
const KNIGHT_SLOPES = [2, 0.5, -0.5, -2];
const MIRRORED_SLOPES = [0.5, -2];
const KNIGHT_LENGTH = Math.hypot(2 * SQUARE, SQUARE);

/** Timings of the animated variants (ms). */
export const ARROW_TIMING = {
  growDuration: 400,
  pulsePeriod: 1400,
  finger: { fadeIn: 350, movePerSquare: 314, fadeOutDelay: 300, fadeOut: 100, loopDelay: 800 },
} as const;

type Pt = [number, number];

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

const geom = () => {
  const board = SQUARE * 8;
  return {
    halfBody: (board * SHAPE.width * 0.01) / 2,
    headH: board * SHAPE.headHeight * 0.01,
    headHalf: (board * SHAPE.headWidth * 0.01) / 2,
    tail: board * SHAPE.tailPadding * 0.01,
  };
};

/** Straight arrow; `progress` 0..1 grows the shaft (1 = full length). */
export function straightPolygon(length: number, progress = 1): Pt[] {
  const { halfBody, headH, headHalf, tail } = geom();
  const shaft = length - headH - tail;
  const shaftEnd = tail + shaft * Math.min(progress, 1);
  return [
    [-halfBody, tail],
    [-halfBody, shaftEnd],
    [-headHalf, shaftEnd],
    [0, shaftEnd + headH],
    [headHalf, shaftEnd],
    [halfBody, shaftEnd],
    [halfBody, tail],
  ];
}

/** Smallest growth at which the head tip has just left the origin square. */
export function straightMinProgress(length: number): number {
  const { headH, tail } = geom();
  return clamp01((length - SQUARE / 2 - tail) / (length - headH - tail));
}

/** L-shaped knight arrow; `progress` 0..1 grows it (the long leg first, then the turn). */
export function knightPolygon(progress = 1): Pt[] {
  const { halfBody: n, headH, headHalf, tail } = geom();
  const shaftDistance = SQUARE * 2; // long leg: two squares
  const phase1 = shaftDistance - tail;
  const turn = SQUARE - n - headH; // short leg after the corner
  const total = phase1 + turn;
  const l = total * Math.min(progress, 1);
  if (l <= phase1) return straightPolygon(tail + phase1 + headH, l / phase1);
  const tip = n + headH + (l - phase1);
  const h = tip - headH;
  const d = shaftDistance;
  return [
    [-n, tail],
    [-n, d + n],
    [h, d + n],
    [h, d + headHalf],
    [tip, d],
    [h, d - headHalf],
    [h, d - n],
    [n, d - n],
    [n, tail],
  ];
}

export function knightMinProgress(): number {
  const { halfBody: n, headH, tail } = geom();
  const phase1 = SQUARE * 2 - tail;
  const total = phase1 + (SQUARE - n - headH);
  return clamp01((phase1 + (SQUARE / 2 - n)) / total);
}

const translate = (pts: Pt[], o: { x: number; y: number }): string => pts.map(([x, y]) => `${o.x + x} ${o.y + y}`).join(', ');

function knightRotation(from: { x: number }, to: { x: number }, slope: number): number {
  switch (slope) {
    case 2:
      return from.x > to.x ? 180 : 0;
    case -2:
      return from.x > to.x ? 0 : 180;
    case 0.5:
    case -0.5:
      return from.x > to.x ? 90 : 270;
    default:
      return 0;
  }
}

/** Angle (degrees) to rotate a downward-pointing arrow so it points from `from` to `to`. */
function straightRotation(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const dist = Math.hypot(from.x - to.x, from.y - to.y);
  const down = { x: from.x - from.x, y: from.y - (from.y + dist) };
  const delta = { x: from.x - to.x, y: from.y - to.y };
  const cos = (down.x * delta.x + down.y * delta.y) / dist ** 2;
  const angle = Math.floor((180 / Math.PI) * Math.acos(Math.max(-1, Math.min(1, cos))) * 100) / 100;
  return from.x < to.x ? 360 - angle : angle;
}

export interface ArrowSpec {
  key: string;
  from: Square;
  to: Square;
  /** CSS fill colour. */
  color: string;
  opacity: number;
  /** Grow in, then breathe. */
  animated?: boolean;
  /** Draw a gliding hand instead of an arrow. */
  pointerFinger?: boolean;
}

interface Built {
  node: SVGPolygonElement;
  /** Re-draw the shaft at `progress` (animated arrows). */
  draw: (progress: number) => void;
  minProgress: number;
}

/** Build one arrow polygon. Exposed for tests. */
export function buildArrowPolygon(doc: Document, spec: ArrowSpec): SVGPolygonElement | null {
  return build(doc, spec)?.node ?? null;
}

function build(doc: Document, spec: ArrowSpec): Built | null {
  const from = squareCenter(spec.from);
  const to = squareCenter(spec.to);
  const length = Math.hypot(from.x - to.x, from.y - to.y);
  if (length === 0) return null;
  const poly = doc.createElementNS(SVG_NS, 'polygon');
  poly.setAttribute('id', `arrow-${spec.from}${spec.to}`);
  poly.setAttribute('data-arrow', `${spec.from}${spec.to}`);
  poly.setAttribute('class', 'arrow');
  if (spec.animated) poly.setAttribute('data-animated', 'true');
  poly.style.fill = spec.color;
  poly.style.opacity = String(spec.opacity);

  const slope = Number(((from.y - to.y) / (from.x - to.x)).toFixed(1));
  const isKnight = KNIGHT_SLOPES.includes(slope) && Math.abs(length - KNIGHT_LENGTH) < 1e-6;
  if (isKnight) {
    let t = `rotate(${knightRotation(from, to, slope)} ${from.x} ${from.y})`;
    if (MIRRORED_SLOPES.includes(slope)) t += ` scale(-1, 1) translate(${-2 * from.x}, 0)`;
    poly.setAttribute('transform', t);
    const draw = (p: number): void => poly.setAttribute('points', translate(knightPolygon(p), from));
    draw(spec.animated ? 0 : 1);
    return { node: poly, draw, minProgress: knightMinProgress() };
  }
  poly.setAttribute('transform', `rotate(${straightRotation(from, to)} ${from.x} ${from.y})`);
  const draw = (p: number): void => poly.setAttribute('points', translate(straightPolygon(length, p), from));
  draw(spec.animated ? 0 : 1);
  return { node: poly, draw, minProgress: straightMinProgress(length) };
}

/** Shared clock for the "breathing" of animated arrows. */
class PulseClock {
  private items = new Map<string, (p: number) => void>();
  private raf = 0;
  private start = 0;

  register(key: string, cb: (progress: number) => void): void {
    if (this.items.size === 0) {
      this.start = performance.now();
      this.loop();
    }
    this.items.set(key, cb);
  }

  unregister(key: string): void {
    this.items.delete(key);
    if (this.items.size === 0 && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  /** 1 → 0 over the first half of the period (contract), 0 → 1 over the second (extend). */
  progressAt(now: number): number {
    const period = ARROW_TIMING.pulsePeriod;
    const half = period / 2;
    const n = (now - this.start) % period;
    return n < half ? 1 - inOutQuad(n / half) : inOutQuad((n - half) / half);
  }

  private tick = (now: number): void => {
    const p = this.progressAt(now);
    this.items.forEach((cb) => cb(p));
    if (this.items.size > 0) this.raf = requestAnimationFrame(this.tick);
  };

  private loop(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  clear(): void {
    this.items.clear();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}

/** A simple pointing-hand glyph (47×47 viewBox). */
const FINGER_SVG =
  '<path d="M18 6c-1.7 0-3 1.3-3 3v16.2l-2.4-2.4c-1.2-1.2-3.1-1.2-4.2 0-1.2 1.2-1.2 3.1 0 4.2l8.2 8.2c1.7 1.7 4 2.7 6.4 2.7h6c4.1 0 7.5-3.4 7.5-7.5V24c0-1.7-1.3-3-3-3-.6 0-1.2.2-1.7.5-.5-1.2-1.6-2-2.8-2-.6 0-1.2.2-1.7.5-.5-1-1.5-1.7-2.8-1.7-.4 0-.7.1-1 .2V9c0-1.7-1.3-3-3-3z" fill="#fff" stroke="#312e2b" stroke-width="2.2" stroke-linejoin="round"/>';

function buildFinger(doc: Document, spec: ArrowSpec, onDone: () => void): { node: SVGGElement; stop: () => void } {
  const from = squareCenter(spec.from);
  const to = squareCenter(spec.to);
  const t = ARROW_TIMING.finger;
  const g = doc.createElementNS(SVG_NS, 'g');
  g.setAttribute('id', `arrow-${spec.from}${spec.to}`);
  g.setAttribute('data-arrow', `${spec.from}${spec.to}`);
  g.setAttribute('class', 'arrow pointer-finger-container');
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(SQUARE));
  svg.setAttribute('height', String(SQUARE));
  svg.setAttribute('viewBox', '0 0 47 47');
  svg.setAttribute('class', 'pointer-finger');
  svg.innerHTML = FINGER_SVG;
  g.appendChild(svg);
  const squares = Math.hypot(to.x - from.x, to.y - from.y) / SQUARE;
  const move = squares * t.movePerSquare;
  const fadeOutAt = t.fadeIn + move + t.fadeOutDelay;
  g.style.setProperty('--from-x', `${from.x}px`);
  g.style.setProperty('--from-y', `${from.y}px`);
  g.style.setProperty('--to-x', `${to.x}px`);
  g.style.setProperty('--to-y', `${to.y}px`);
  g.style.setProperty('--offset-x', '5.05px');
  g.style.setProperty('--offset-y', '1.86px');
  const anim = `finger-fade-in ${t.fadeIn}ms ease-out forwards,finger-move ${move}ms ease-in-out ${t.fadeIn}ms forwards,finger-fade-out ${t.fadeOut}ms ease-out ${fadeOutAt}ms forwards`;
  g.style.animation = anim;
  let timer = 0;
  const handler = (e: Event): void => {
    if ((e as AnimationEvent).animationName !== 'finger-fade-out') return;
    g.style.animation = '';
    timer = window.setTimeout(() => {
      g.style.animation = anim;
    }, t.loopDelay);
    onDone();
  };
  g.addEventListener('animationend', handler);
  g.addEventListener('animationcancel', handler);
  return {
    node: g,
    stop: () => {
      window.clearTimeout(timer);
      g.removeEventListener('animationend', handler);
      g.removeEventListener('animationcancel', handler);
    },
  };
}

export class Arrows {
  private svg: SVGSVGElement;
  private items = new Map<string, { node: SVGElement; sig: string; cleanup?: () => void }>();
  private pulse = new PulseClock();

  constructor(layers: Layers, private doc: Document) {
    this.svg = doc.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('viewBox', '0 0 100 100');
    this.svg.classList.add('arrows');
    layers.add(this.svg, 'arrows');
  }

  private drop(key: string): void {
    const v = this.items.get(key);
    if (!v) return;
    v.cleanup?.();
    this.pulse.unregister(key);
    v.node.remove();
    this.items.delete(key);
  }

  /** Show exactly `specs` (diffed by key and appearance). */
  set(specs: ArrowSpec[]): void {
    const keys = new Set(specs.map((s) => s.key));
    for (const key of [...this.items.keys()]) if (!keys.has(key)) this.drop(key);
    for (const spec of specs) {
      const sig = `${spec.from}${spec.to}|${spec.color}|${spec.opacity}|${spec.animated ? 'a' : ''}${spec.pointerFinger ? 'f' : ''}`;
      const prev = this.items.get(spec.key);
      if (prev && prev.sig === sig) continue;
      this.drop(spec.key);

      if (spec.pointerFinger) {
        if (spec.from === spec.to) continue;
        const f = buildFinger(this.doc, spec, () => undefined);
        this.svg.appendChild(f.node);
        this.items.set(spec.key, { node: f.node, sig, cleanup: f.stop });
        continue;
      }

      const built = build(this.doc, spec);
      if (!built) continue;
      this.svg.appendChild(built.node);
      let cleanup: (() => void) | undefined;
      if (spec.animated) {
        // grow in (ease-out, fading in), then register for the shared breathing cycle
        const startedAt = performance.now();
        let raf = 0;
        let alive = true;
        const base = spec.opacity;
        const frame = (): void => {
          if (!alive) return;
          const t = Math.min((performance.now() - startedAt) / ARROW_TIMING.growDuration, 1);
          const e = outQuad(t);
          built.draw(e);
          built.node.style.opacity = String(base * e);
          if (t < 1) raf = requestAnimationFrame(frame);
          else {
            const min = built.minProgress;
            this.pulse.register(spec.key, (r) => built.draw(min + r * (1 - min)));
          }
        };
        frame();
        cleanup = () => {
          alive = false;
          cancelAnimationFrame(raf);
        };
      }
      this.items.set(spec.key, { node: built.node, sig, cleanup });
    }
  }

  destroy(): void {
    this.pulse.clear();
    for (const k of [...this.items.keys()]) this.drop(k);
  }
}
