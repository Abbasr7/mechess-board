/**
 * Premove model.
 *
 * Observed behaviour of the original board: a premove is a move that is legal
 * for the piece *on an otherwise empty board* — nothing blocks a slider, own
 * pieces do not obstruct, check is ignored and the opponent's pieces do not
 * matter. Only a few things are looked at in the real position:
 *
 *  - which piece stands on the source square (and its colour),
 *  - castling rights (a king still on its home square may castle either way
 *    when the right exists),
 *  - pawns may step one or two squares forward (two only from the start rank)
 *    and capture on either diagonal, because the empty-board trick places a
 *    phantom enemy on both diagonals.
 *
 * Queued premoves are validated against the position *as if the earlier
 * premoves had been played*, so chains such as e2-e4, e4-e5 work. When the
 * opponent finally moves, the first queued move is tried on the real board; if
 * it is illegal there the whole queue is dropped.
 */
import type { Color, Piece, PiecesMap, PromotionType, Square, PieceType } from '../types';
import { fileOf, rankOf, toSquare } from '../squares';

export interface PremoveMove {
  from: Square;
  to: Square;
  color: Color;
  piece: PieceType;
  promotion?: PromotionType;
  /** Set for castling premoves (king moves two files). */
  castle?: 'k' | 'q';
}

export interface PremovePosition {
  pieces: PiecesMap;
  /** FEN castling field of the real position, e.g. `KQkq` or `-`. */
  castling: string;
}

const KNIGHT: ReadonlyArray<readonly [number, number]> = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const KING: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];
const BISHOP: ReadonlyArray<readonly [number, number]> = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ROOK: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const PROMOS: PromotionType[] = ['q', 'n', 'r', 'b'];

export const clonePosition = (p: PremovePosition): PremovePosition => ({
  pieces: new Map([...p.pieces].map(([sq, pc]) => [sq, { ...pc }])),
  castling: p.castling,
});

/** Empty-board destinations for the piece standing on `from` (must belong to `color`). */
export function premoveMovesFrom(pos: PremovePosition, from: Square, color: Color): PremoveMove[] {
  const piece = pos.pieces.get(from);
  if (!piece || piece.color !== color) return [];
  const f = fileOf(from);
  const r = rankOf(from);
  const out: PremoveMove[] = [];
  const add = (to: Square | null, extra: Partial<PremoveMove> = {}): void => {
    if (to) out.push({ from, to, color, piece: piece.type, ...extra });
  };

  switch (piece.type) {
    case 'p': {
      const dir = color === 'w' ? 1 : -1;
      const startRank = color === 'w' ? 2 : 7;
      const lastRank = color === 'w' ? 8 : 1;
      const target = (file: number, rank: number): void => {
        const to = toSquare(file, rank);
        if (!to) return;
        if (rank === lastRank) for (const promotion of PROMOS) add(to, { promotion });
        else add(to);
      };
      target(f, r + dir);
      if (r === startRank) target(f, r + 2 * dir);
      target(f - 1, r + dir);
      target(f + 1, r + dir);
      break;
    }
    case 'n':
      for (const [df, dr] of KNIGHT) add(toSquare(f + df, r + dr));
      break;
    case 'k': {
      for (const [df, dr] of KING) add(toSquare(f + df, r + dr));
      const home = color === 'w' ? 1 : 8;
      if (f === 5 && r === home) {
        const k = color === 'w' ? 'K' : 'k';
        const q = color === 'w' ? 'Q' : 'q';
        if (pos.castling.includes(k)) add(toSquare(7, home), { castle: 'k' });
        if (pos.castling.includes(q)) add(toSquare(3, home), { castle: 'q' });
      }
      break;
    }
    default: {
      const dirs = piece.type === 'b' ? BISHOP : piece.type === 'r' ? ROOK : [...BISHOP, ...ROOK];
      for (const [df, dr] of dirs) {
        let ff = f + df;
        let rr = r + dr;
        while (ff >= 1 && ff <= 8 && rr >= 1 && rr <= 8) {
          add(toSquare(ff, rr));
          ff += df;
          rr += dr;
        }
      }
    }
  }
  return out;
}

/** True when `move` is among the empty-board moves of its source piece. */
export function findPremove(
  pos: PremovePosition,
  move: { from: Square; to: Square; promotion?: PromotionType },
  color: Color,
): PremoveMove | null {
  const cands = premoveMovesFrom(pos, move.from, color).filter((m) => m.to === move.to);
  if (cands.length === 0) return null;
  if (cands.length === 1 && !cands[0].promotion) return cands[0];
  const wanted = move.promotion ?? 'q';
  return cands.find((m) => m.promotion === wanted) ?? null;
}

/** Play `move` on a copy of `pos` and return the resulting position. */
export function applyPremove(pos: PremovePosition, move: PremoveMove): PremovePosition {
  const next = clonePosition(pos);
  const piece = next.pieces.get(move.from);
  if (!piece) return next;
  next.pieces.delete(move.from);
  const placed: Piece = move.promotion ? { color: move.color, type: move.promotion } : piece;
  next.pieces.set(move.to, placed);
  if (move.castle) {
    const rank = rankOf(move.from);
    const rookFrom = toSquare(move.castle === 'k' ? 8 : 1, rank)!;
    const rookTo = toSquare(move.castle === 'k' ? 6 : 4, rank)!;
    const rook = next.pieces.get(rookFrom);
    if (rook && rook.type === 'r' && rook.color === move.color) {
      next.pieces.delete(rookFrom);
      next.pieces.set(rookTo, rook);
    }
  }
  return next;
}

/**
 * A queue of premoves plus the position they lead to.
 *
 * `base` is the real position (re-set whenever the real game changes);
 * `current` is `base` with every queued move applied.
 */
export class PremoveQueue {
  private moves: PremoveMove[] = [];
  private base: PremovePosition | null = null;
  private cur: PremovePosition | null = null;

  /** Re-anchor the queue on a new real position; queued moves are re-applied. */
  setBase(base: PremovePosition): void {
    this.base = clonePosition(base);
    this.rebuild();
  }

  private rebuild(): void {
    if (!this.base) return;
    let pos = clonePosition(this.base);
    for (const m of this.moves) pos = applyPremove(pos, m);
    this.cur = pos;
  }

  get length(): number {
    return this.moves.length;
  }

  list(): readonly PremoveMove[] {
    return this.moves;
  }

  /** Position with all queued moves applied (or `null` before `setBase`). */
  position(): PremovePosition | null {
    return this.cur ?? this.base;
  }

  /** Empty-board moves for `from` in the *premoved* position. */
  movesFrom(from: Square, color: Color): PremoveMove[] {
    const pos = this.position();
    return pos ? premoveMovesFrom(pos, from, color) : [];
  }

  /** Try to queue a move. Returns the stored move or `null` when it is not a legal premove. */
  tryAdd(move: { from: Square; to: Square; promotion?: PromotionType }, color: Color): PremoveMove | null {
    const pos = this.position();
    if (!pos) return null;
    const found = findPremove(pos, move, color);
    if (!found) return null;
    this.moves.push(found);
    this.cur = applyPremove(pos, found);
    return found;
  }

  /** Remove and return the first queued move (the real base is *not* advanced). */
  shift(): PremoveMove | undefined {
    const m = this.moves.shift();
    this.rebuild();
    return m;
  }

  clear(): void {
    this.moves = [];
    this.cur = this.base ? clonePosition(this.base) : null;
  }
}
