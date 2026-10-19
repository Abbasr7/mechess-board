/**
 * Layer manager.
 *
 * The board is a flat list of absolutely-positioned children of the root
 * element; their stacking order is the DOM order. Each layer is represented by
 * a comment node placeholder and new elements are inserted *before* it, so a
 * layer keeps its place no matter when its elements are created.
 */
import type { AnimationType } from '../types';

export type LayerName =
  | 'coordinates'
  | 'squares'
  | 'blinking-highlights'
  | 'effects'
  | 'hover-square'
  | 'vfx-below'
  | 'pieces'
  | 'custom-items'
  | 'vfx-above'
  | 'move-hints'
  | 'capture-hints'
  | 'arrows'
  | 'promotion-window'
  | 'fade-setup';

/** Back-to-front order. With the "dynamic" animation type hints sit *below* the pieces. */
export function layerOrder(type: AnimationType): LayerName[] {
  return type === 'dynamic'
    ? [
        'coordinates', 'squares', 'blinking-highlights', 'effects', 'hover-square',
        'move-hints', 'capture-hints', 'vfx-below', 'pieces', 'custom-items', 'vfx-above',
        'arrows', 'promotion-window', 'fade-setup',
      ]
    : [
        'coordinates', 'squares', 'blinking-highlights', 'effects', 'hover-square',
        'vfx-below', 'pieces', 'custom-items', 'vfx-above', 'move-hints', 'capture-hints',
        'arrows', 'promotion-window', 'fade-setup',
      ];
}

export class Layers {
  private placeholders = new Map<LayerName, Comment>();

  constructor(private root: HTMLElement, order: LayerName[]) {
    for (const name of order) {
      const c = root.ownerDocument.createComment(`/${name}`);
      root.appendChild(c);
      this.placeholders.set(name, c);
    }
  }

  /** Insert `el` at the front of `layer` (just before its placeholder). */
  add(el: Node, layer: LayerName): void {
    const ph = this.placeholders.get(layer);
    if (!ph) throw new Error(`Unknown layer ${layer}`);
    this.root.insertBefore(el, ph);
  }

  placeholder(layer: LayerName): Comment {
    return this.placeholders.get(layer)!;
  }

  /**
   * Re-position the hint placeholders after the animation type changed to or
   * from "dynamic". Elements already inside those layers must be re-created by
   * the caller (they are transient).
   */
  moveHintLayers(type: AnimationType): void {
    const move = this.placeholders.get('move-hints')!;
    const capture = this.placeholders.get('capture-hints')!;
    if (type === 'dynamic') {
      const anchor = this.placeholders.get('vfx-below')!;
      this.root.insertBefore(move, anchor);
      this.root.insertBefore(capture, anchor);
    } else {
      const after = this.placeholders.get('vfx-above')!.nextSibling;
      this.root.insertBefore(move, after);
      this.root.insertBefore(capture, after);
    }
  }
}
