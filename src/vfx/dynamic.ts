/**
 * The effects that the "dynamic" animation type adds around moves:
 *
 *  - a ghost of the captured piece that grows and fades,
 *  - a short gradient trail from the origin to the destination square,
 *  - a growing circle on the destination square (white on dark squares,
 *    black on light ones),
 *  - a king in check: the square pops with a pulsing red overlay and the king
 *    wiggles (not when the game just ended),
 *  - a pop + ripple when a pawn promotes,
 *  - a red tap effect on the square of a rejected move.
 *
 * Every position change first clears all running effects.
 */
import type { BoardMove, Color, Square } from '../types';
import { fileOf, rankOf } from '../squares';
import type { VfxManager } from './vfx';

export interface DynamicVfxContext {
  /** Are the dynamic effects switched on? */
  enabled(): boolean;
  /** Square of the checked king (side to move) or `null`. */
  checkedKing(): Square | null;
  /** Colour of the side to move (the checked side). */
  turn(): Color;
  isGameOver(): boolean;
  isDragging(square: Square): boolean;
  /** Duration of a piece move, in ms. */
  moveDuration(): number;
  autoPromote(): boolean;
  revealPieces(): void;
}

const darkCircle = { color: '#fff', initialOpacity: 0.25 };
const lightCircle = { color: '#000000', initialOpacity: 0.07 };
const TRAIL: Record<Color, string> = { w: '#f0f0f0', b: '#404040' };
const PROMOTE_DELAY = 230;

const isDark = (sq: Square): boolean => (fileOf(sq) + rankOf(sq)) % 2 === 0;
const key = (parts: string[]): string => `vfx|${parts.join('|')}`;

export class DynamicVfx {
  private timers = new Set<number>();

  constructor(private vfx: VfxManager, private ctx: DynamicVfxContext) {}

  private later(fn: () => void, ms: number): void {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
  }

  private clear(): void {
    this.timers.forEach((t) => window.clearTimeout(t));
    this.timers.clear();
    this.vfx.removeAll();
    this.ctx.revealPieces();
  }

  /** The position changed (load, undo, navigation). */
  positionChanged(): void {
    this.clear();
    if (this.ctx.enabled()) this.showCheck(0);
  }

  /** A move was made. */
  moved(m: BoardMove): void {
    this.clear();
    if (!this.ctx.enabled()) return;

    // captured piece
    if (m.captured) {
      const sq = m.capturedSquare ?? m.to;
      const colour: Color = m.color === 'w' ? 'b' : 'w';
      this.vfx.add({ type: 'piece-capture', square: sq, data: { piece: `${colour}${m.captured}` }, key: key([sq]) });
    }

    // check
    if (m.check && !this.ctx.isGameOver()) this.showCheck(this.ctx.moveDuration());

    // trail (not for the drop of a dragged piece, not for an executed premove)
    if (!m.isPremove && !(m.userGenerated && !m.animate)) {
      this.vfx.add({ type: 'piece-trail', square: m.from, data: { targetSquare: m.to, color: TRAIL[m.color] }, key: key([m.to, 'piece-trail']) });
      if (m.rookMove) {
        this.vfx.add({ type: 'piece-trail', square: m.rookMove.from, data: { targetSquare: m.rookMove.to, color: TRAIL[m.color] }, key: key([m.rookMove.to, 'piece-trail']) });
      }
    }

    // growing circle on the landing square(s)
    const circle = (sq: Square): void => {
      this.vfx.add({ type: 'growing-circle', square: sq, data: isDark(sq) ? darkCircle : lightCircle, key: key([sq, 'growing-circle']) });
    };
    circle(m.to);
    if (m.rookMove) circle(m.rookMove.to);

    // promotion
    if (m.promotion) {
      const piece = `${m.color}${m.promotion}`;
      const go = (): void => {
        this.vfx.add({ type: 'piece-promote', square: m.to, data: { piece }, key: key([m.to, 'piece-promote']) });
        this.vfx.add({ type: 'promote-ripple', square: m.to, key: key([m.to, 'promote-ripple']) });
      };
      if (m.userGenerated && !this.ctx.autoPromote()) this.later(go, PROMOTE_DELAY);
      else go();
    }
  }

  /** The user stepped back over `m`: a reversed trail, then the check effect of the position reached. */
  stepped(m: { from: Square; to: Square; color: Color; rookMove?: { from: Square; to: Square } }, dir: 'back', position: { checkedKing(): Square | null; turn(): Color }): void {
    void dir;
    this.clear();
    if (!this.ctx.enabled()) return;
    this.vfx.add({ type: 'piece-trail', square: m.to, data: { targetSquare: m.from, color: TRAIL[m.color] }, key: key([m.from, 'piece-trail']) });
    if (m.rookMove) {
      this.vfx.add({ type: 'piece-trail', square: m.rookMove.to, data: { targetSquare: m.rookMove.from, color: TRAIL[m.color] }, key: key([m.rookMove.from, 'piece-trail']) });
    }
    const king = position.checkedKing();
    if (king) {
      this.later(() => {
        this.vfx.add({ type: 'king-check-square', square: king, key: key([king, 'king-check-square']) });
        if (!this.ctx.isDragging(king)) this.vfx.add({ type: 'king-check', square: king, data: { piece: `${position.turn()}k` }, key: key([king, 'king-check']) });
      }, this.ctx.moveDuration());
    }
  }

  /** The user tried an illegal move onto `to`. */
  rejected(to: Square | null): void {
    if (!to || !this.ctx.enabled()) return;
    this.vfx.add({ type: 'illegal-move-tap', square: to, key: key([to, 'illegal-move-tap']) });
  }

  private showCheck(delay: number): void {
    const king = this.ctx.checkedKing();
    if (!king) return;
    const go = (): void => {
      this.vfx.add({ type: 'king-check-square', square: king, key: key([king, 'king-check-square']) });
      if (!this.ctx.isDragging(king)) {
        this.vfx.add({ type: 'king-check', square: king, data: { piece: `${this.ctx.turn()}k` }, key: key([king, 'king-check']) });
      }
    };
    if (delay > 0) this.later(go, delay);
    else go();
  }

  destroy(): void {
    this.clear();
  }
}
