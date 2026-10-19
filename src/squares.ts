import type { Square } from './types';

export const FILES = 'abcdefgh';

/** 1-based file number (a=1). */
export const fileOf = (sq: Square): number => sq.charCodeAt(0) - 96;
/** 1-based rank number. */
export const rankOf = (sq: Square): number => sq.charCodeAt(1) - 48;

export const isSquare = (s: unknown): s is Square =>
  typeof s === 'string' && /^[a-h][1-8]$/.test(s);

/** Build a square name from 1-based file/rank, or `null` when off the board. */
export function toSquare(file: number, rank: number): Square | null {
  if (file < 1 || file > 8 || rank < 1 || rank > 8) return null;
  return FILES[file - 1] + String(rank);
}

export const ALL_SQUARES: readonly Square[] = (() => {
  const out: Square[] = [];
  for (let r = 1; r <= 8; r++) for (let f = 1; f <= 8; f++) out.push(toSquare(f, r)!);
  return out;
})();

/** `e4` → `square-54`. The CSS class that positions an element on a square. */
export const squareClass = (sq: Square): string => `square-${fileOf(sq)}${rankOf(sq)}`;

export function squareFromClass(cls: string): Square | null {
  const m = /^square-([1-8])([1-8])$/.exec(cls);
  return m ? toSquare(Number(m[1]), Number(m[2])) : null;
}

/** Is the square a light one? (a1 is dark.) */
export const isLightSquare = (sq: Square): boolean => (fileOf(sq) + rankOf(sq)) % 2 === 1;

/**
 * Top-left corner of a square in "percent of a square" units, i.e. the value to
 * use in `translate(x%, y%)` on a piece that is one square in size.
 */
export function squareOffset(sq: Square, flipped: boolean): { x: number; y: number } {
  const f = fileOf(sq);
  const r = rankOf(sq);
  return flipped
    ? { x: (8 - f) * 100, y: (r - 1) * 100 }
    : { x: (f - 1) * 100, y: (8 - r) * 100 };
}

/** Centre of a square in the 100×100 arrow/coordinate viewBox (unflipped). */
export function squareCenter(sq: Square): { x: number; y: number } {
  return { x: (fileOf(sq) - 1) * 12.5 + 6.25, y: (8 - rankOf(sq)) * 12.5 + 6.25 };
}

export interface PointerPosition {
  /** Piece-translation coordinates in the 800×800 board space (centre of piece under pointer). */
  coords: { x: number; y: number };
  /** `coords` clamped to the range a dragged piece may reach (half a square outside the board). */
  coordsInsideBoard: { x: number; y: number };
  /** Square under the pointer, or `null` when the pointer is outside the board. */
  square: Square | null;
  /** Nearest square, clamped to the board. */
  squareInsideBoard: Square;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** Translate a pointer location into board coordinates. `rect` is the board's bounding box. */
export function pointerToBoard(
  rect: { left: number; top: number; width: number; height: number; bottom: number },
  clientX: number,
  clientY: number,
  flipped: boolean,
): PointerPosition {
  const size = rect.width / 8;
  const col = Math.ceil((clientX - rect.left) / size);
  const row = Math.ceil((rect.bottom - clientY) / size);
  const file = flipped ? 9 - col : col;
  const rank = flipped ? 9 - row : row;
  const coords = {
    x: ((clientX - rect.left - size / 2) / rect.width) * 800,
    y: ((clientY - rect.top - size / 2) / rect.height) * 800,
  };
  return {
    coords,
    coordsInsideBoard: { x: clamp(coords.x, -50, 750), y: clamp(coords.y, -50, 750) },
    square: toSquare(file, rank),
    squareInsideBoard: toSquare(clamp(file, 1, 8), clamp(rank, 1, 8))!,
  };
}
