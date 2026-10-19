/**
 * Custom items: decorations you pin to a square - a star, an image, a text
 * box or a sprite-sheet "frame" (optionally animated at 24 fps).
 *
 * Items sit just above the pieces unless `visualOrder` puts them above or
 * below the arrows, the effect badges or the pieces. One item per square. An
 * item can play a creation animation (`grow-in`, `captured`) and leaves with
 * a removal animation (default: a quick fade-and-grow) before it is detached.
 */
import type { SoundName, Square } from '../types';
import { placeOnSquare } from './pieces';
import type { Layers, LayerName } from './layers';

export type CustomItemType = 'Image' | 'Star' | 'TextBox';

export interface CustomItemFrame {
  /** Sprite sheet. */
  imageURL: string;
  /** The sheet is a strip of square frames played at 24 fps when the item is removed. */
  imageAnimated?: boolean;
  /** Which cell of the sheet to show, as a ratio of its size (0…1). */
  positionRatioX: number;
  positionRatioY: number;
  /** Size of one cell as a ratio of the sheet (1 = the sheet is a single image). */
  widthRatio: number;
  heightRatio: number;
}

export interface CustomItemSpec {
  square: Square;
  type?: CustomItemType;
  color?: string;
  opacity?: number;
  image?: { url: string; percentOfSquare?: number };
  text?: { value: string; color?: string };
  visualOrder?: { target: 'arrows' | 'effects' | 'pieces'; position: 'above' | 'below' };
  frame?: CustomItemFrame;
  /** Animation played when the item appears. */
  creationAnimation?: 'captured' | 'grow-in';
  /** Class added when the item is removed (default `basic-item-animation-captured`). */
  removalClass?: string;
  /** Ms the removal animation gets before the element is detached (default 400). */
  removalTimeout?: number;
  removalSound?: SoundName;
}

export interface CustomItemsHost {
  doc: Document;
  root: HTMLElement;
  layers: Layers;
  playSound(name: SoundName): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const animationClass = (name: string): string => `basic-item-animation-${name}`;
/** The CSS animation whose end finishes a creation animation. */
const CREATION_ANIMATION_NAME = { captured: 'reboard-ci-captured', 'grow-in': 'reboard-ci-grow-in' } as const;
const FRAME_RATE = 24;

/** Five-pointed star inscribed in a 100×100 box. */
function starPoints(): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 48 : 20;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(2)},${(52 + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

interface Item {
  el: HTMLElement;
  spec: CustomItemSpec;
  removeTimer?: number;
  stopSprite?: () => void;
}

export class CustomItems {
  private items = new Map<Square, Item>();
  private destroyed = false;

  constructor(private host: CustomItemsHost) {}

  all(): CustomItemSpec[] {
    return [...this.items.values()].map((i) => i.spec);
  }

  get(square: Square): CustomItemSpec | undefined {
    return this.items.get(square)?.spec;
  }

  /** Add an item, replacing whatever sits on that square. */
  add(spec: CustomItemSpec): void {
    if (this.destroyed) return;
    const prev = this.items.get(spec.square);
    if (prev) this.detach(spec.square, prev);
    const el = spec.frame ? this.buildFrame(spec.frame) : this.buildSvg(spec);
    el.classList.add('custom-item');
    placeOnSquare(el, spec.square);
    const item: Item = { el, spec };
    if (spec.frame?.imageAnimated) el.classList.add('custom-item__frame--animated');
    if (!spec.frame && spec.creationAnimation) this.playCreation(el, spec.creationAnimation);
    this.items.set(spec.square, item);
    this.insert(el, spec.visualOrder);
  }

  addAll(specs: CustomItemSpec[]): void {
    specs.forEach((s) => this.add(s));
  }

  /** Remove the item on `square` with its removal animation. */
  remove(square: Square): void {
    const item = this.items.get(square);
    if (!item || item.removeTimer !== undefined || item.stopSprite) return;
    const { spec, el } = item;
    if (spec.removalSound) this.host.playSound(spec.removalSound);
    if (spec.frame?.imageAnimated) {
      item.stopSprite = this.playSprite(el, spec.frame.imageURL, () => this.detach(square, item));
      return;
    }
    el.classList.add(spec.removalClass ?? animationClass('captured'));
    item.removeTimer = window.setTimeout(() => this.detach(square, item), spec.removalTimeout ?? 400);
  }

  clear(): void {
    for (const [sq, item] of [...this.items]) this.detach(sq, item);
  }

  destroy(): void {
    this.destroyed = true;
    this.clear();
  }

  // ── internals ───────────────────────────────────────────────────────────

  private detach(square: Square, item: Item): void {
    if (item.removeTimer !== undefined) window.clearTimeout(item.removeTimer);
    item.stopSprite?.();
    item.el.remove();
    if (this.items.get(square) === item) this.items.delete(square);
  }

  private insert(el: HTMLElement, order: CustomItemSpec['visualOrder']): void {
    if (!order) {
      this.host.layers.add(el, 'custom-items');
      return;
    }
    // Same placement rules as the original: for arrows and effects "below" goes at the end of that layer and
    // "above" right after it; for pieces "below" goes right after the effects layer (under the pieces) and
    // "above" at the end of the pieces layer.
    const below = order.position === 'below';
    const layer: LayerName = order.target === 'pieces' ? (below ? 'effects' : 'pieces') : order.target;
    const before = order.target === 'pieces' ? !below : below;
    const placeholder = this.host.layers.placeholder(layer);
    this.host.root.insertBefore(el, before ? placeholder : placeholder.nextSibling);
  }

  private playCreation(el: HTMLElement, type: 'captured' | 'grow-in'): void {
    const cls = animationClass(type);
    el.classList.add(cls);
    const done = (e: Event): void => {
      if ((e as AnimationEvent).animationName === CREATION_ANIMATION_NAME[type] || e.type === 'animationcancel') el.classList.remove(cls);
    };
    el.addEventListener('animationend', done);
    el.addEventListener('animationcancel', done);
  }

  private buildSvg(spec: CustomItemSpec): HTMLElement {
    const doc = this.host.doc;
    const el = doc.createElement('div');
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.style.cssText = 'display:block;width:100%;height:100%;overflow:visible';
    if (spec.opacity !== undefined) svg.style.opacity = String(spec.opacity);
    const type = spec.type ?? 'Star';
    if (type === 'Star') {
      const star = doc.createElementNS(SVG_NS, 'polygon');
      star.setAttribute('points', starPoints());
      star.setAttribute('fill', spec.color ?? '#f7c631');
      star.setAttribute('stroke', 'rgba(0,0,0,.25)');
      star.setAttribute('stroke-width', '2');
      star.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(star);
    } else if (type === 'Image') {
      const img = doc.createElementNS(SVG_NS, 'image');
      const pct = spec.image?.percentOfSquare ?? 100;
      const size = pct;
      const off = (100 - size) / 2;
      if (spec.image) img.setAttribute('href', spec.image.url);
      img.setAttribute('x', String(off));
      img.setAttribute('y', String(off));
      img.setAttribute('width', String(size));
      img.setAttribute('height', String(size));
      svg.appendChild(img);
    } else {
      const box = doc.createElementNS(SVG_NS, 'rect');
      box.setAttribute('x', '4');
      box.setAttribute('y', '28');
      box.setAttribute('width', '92');
      box.setAttribute('height', '44');
      box.setAttribute('rx', '9');
      box.setAttribute('fill', spec.color ?? '#ffffff');
      box.setAttribute('stroke', 'rgba(0,0,0,.3)');
      box.setAttribute('stroke-width', '2');
      svg.appendChild(box);
      const text = doc.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', '50');
      text.setAttribute('y', '58');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-family', 'Arial, Helvetica, sans-serif');
      text.setAttribute('font-weight', '700');
      text.setAttribute('font-size', '26');
      text.setAttribute('fill', spec.text?.color ?? '#000');
      text.textContent = spec.text?.value ?? '';
      svg.appendChild(text);
    }
    el.appendChild(svg);
    return el;
  }

  private buildFrame(f: CustomItemFrame): HTMLElement {
    const doc = this.host.doc;
    const el = doc.createElement('div');
    el.classList.add('custom-item__frame');
    const cell = doc.createElement('div');
    // percent background-position of a cell inside a sheet that is 1/ratio times larger than the box
    const percent = (pos: number, ratio: number): number => {
      const scale = 1 / ratio;
      return scale === 1 ? 0 : (pos / ratio / (scale - 1)) * 100;
    };
    cell.style.backgroundImage = `url(${JSON.stringify(f.imageURL)})`;
    cell.style.backgroundSize = f.imageAnimated ? 'auto 100%' : `${(1 / f.widthRatio) * 100}% ${(1 / f.heightRatio) * 100}%`;
    cell.style.backgroundPositionX = `${percent(f.positionRatioX, f.widthRatio)}%`;
    cell.style.backgroundPositionY = `${percent(f.positionRatioY, f.heightRatio)}%`;
    el.appendChild(cell);
    return el;
  }

  /** Play a strip of square frames at 24 fps, then call `done`. Returns a stop function. */
  private playSprite(el: HTMLElement, url: string, done: () => void): () => void {
    const cell = el.querySelector('div');
    let stopped = false;
    let raf = 0;
    const stop = (): void => {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
    };
    if (!cell) {
      done();
      return stop;
    }
    const img = new Image();
    img.onerror = () => !stopped && done();
    img.onload = () => {
      if (stopped) return;
      const frames = Math.max(1, Math.ceil(img.naturalWidth / img.naturalHeight));
      const height = el.clientHeight;
      const start = performance.now();
      let shown = 0;
      const tick = (now: number): void => {
        if (stopped) return;
        const frame = Math.floor(((now - start) / 1000) * FRAME_RATE);
        if (frame >= frames) {
          done();
          return;
        }
        if (frame !== shown) {
          shown = frame;
          cell.style.backgroundPositionX = `-${height * frame}px`;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    img.src = url;
    return stop;
  }
}

export const CUSTOM_ITEMS_CSS = `
.custom-item{height:12.5%;left:0;pointer-events:none;position:absolute;top:0;width:12.5%}
.custom-item__frame{opacity:1;overflow:hidden}
.custom-item__frame div{background-repeat:no-repeat;filter:drop-shadow(0 .5rem 0 rgba(0,0,0,.3));height:115%;margin:-7.5%;opacity:1;width:115%}
.custom-item__frame--animated div{height:100%;margin:0;width:100%}
.custom-item__frame--disappear{opacity:0;transition:opacity .5s}
.basic-item-animation-grow-in>*{animation:reboard-ci-grow-in .3s cubic-bezier(.33,1,.68,1) both}
.basic-item-animation-captured>*{animation:reboard-ci-captured .4s ease-out forwards}
@keyframes reboard-ci-grow-in{0%{opacity:0;transform:scale(1.8)}to{opacity:1;transform:scale(1)}}
@keyframes reboard-ci-captured{0%{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(1.5)}}
`;
