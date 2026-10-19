/**
 * `<re-chess-board>` custom element – the declarative way to use the board.
 *
 *   <re-chess-board fen="…" playing-as="w" pieces="/pieces/staunty/{piece}.svg"
 *                   coordinates="inside" board-style="green" animation="default"></re-chess-board>
 *
 * The underlying {@link ChessBoard} is available as `el.board` once the element is connected.
 */
import { ChessBoard } from './board';
import { defaultOptions, type BoardOptions } from './options';
import type { AnimationType, Color, CoordinatesPosition, MoveMethod } from './types';

const ATTRS = [
  'fen',
  'flipped',
  'playing-as',
  'mode',
  'coordinates',
  'board-style',
  'pieces',
  'animation',
  'move-method',
  'auto-promote',
  'premoves',
  'sounds',
] as const;

const bool = (v: string | null): boolean => v !== null && v !== 'false';

/** The option each observed attribute controls. */
const OPTION_OF: Record<string, keyof BoardOptions | undefined> = {
  flipped: 'flipped',
  'playing-as': 'playingAs',
  mode: 'mode',
  coordinates: 'coordinates',
  'board-style': 'boardStyle',
  pieces: 'pieces',
  animation: 'animationType',
  'move-method': 'moveMethod',
  'auto-promote': 'autoPromote',
  premoves: 'premoves',
  sounds: 'playSounds',
};

export class ReChessBoardElement extends HTMLElement {
  static observedAttributes = ATTRS;

  board: ChessBoard | null = null;

  connectedCallback(): void {
    if (this.board) return;
    if (!this.style.display) this.style.display = 'block';
    this.board = new ChessBoard(this, { ...this.readOptions(), fen: this.getAttribute('fen') ?? undefined });
    this.dispatchEvent(new CustomEvent('board-ready', { detail: this.board }));
  }

  disconnectedCallback(): void {
    this.board?.destroy();
    this.board = null;
  }

  attributeChangedCallback(name: string, prev: string | null, next: string | null): void {
    if (!this.board || prev === next) return;
    if (name === 'fen') {
      if (next) this.board.load(next);
      return;
    }
    const patch = this.readOptions();
    // a removed attribute goes back to the option's default
    const key = OPTION_OF[name];
    if (next === null && key) (patch as Record<string, unknown>)[key] = defaultOptions()[key];
    this.board.setOptions(patch);
  }

  private readOptions(): Partial<BoardOptions> {
    const o: Partial<BoardOptions> = {};
    const get = (n: string): string | null => this.getAttribute(n);
    if (this.hasAttribute('flipped')) o.flipped = bool(get('flipped'));
    const as = get('playing-as');
    if (as !== null) o.playingAs = as === 'both' ? null : (as as Color);
    if (get('mode')) o.mode = get('mode') as BoardOptions['mode'];
    if (get('coordinates')) o.coordinates = get('coordinates') as CoordinatesPosition;
    if (get('board-style')) o.boardStyle = get('board-style')!;
    if (get('pieces')) o.pieces = get('pieces')!;
    if (get('animation')) o.animationType = get('animation') as AnimationType;
    if (get('move-method')) o.moveMethod = get('move-method') as MoveMethod;
    if (this.hasAttribute('auto-promote')) o.autoPromote = bool(get('auto-promote'));
    if (this.hasAttribute('premoves')) o.premoves = bool(get('premoves'));
    if (this.hasAttribute('sounds')) {
      o.playSounds = bool(get('sounds'));
    }
    return o;
  }
}

export function defineChessBoardElement(tag = 're-chess-board'): void {
  if (typeof customElements !== 'undefined' && !customElements.get(tag)) customElements.define(tag, ReChessBoardElement);
}
